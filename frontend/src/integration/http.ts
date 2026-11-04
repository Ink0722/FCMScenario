import type { AccessGrant, ExperimentGateway, TurnGateway, TurnSnapshot } from './contracts';
import { GatewayError } from './errors';

type Options = { baseUrl?: string; fetch?: typeof fetch };
const terminal = (state: TurnSnapshot) => ['completed', 'interrupted', 'cancelled'].includes(state.status);

export function createHttpGateway(options: Options = {}): ExperimentGateway & TurnGateway {
  const base = (options.baseUrl ?? '/api/v1').replace(/\/$/, '');
  const transport = options.fetch ?? fetch.bind(globalThis);
  let token = '';
  const call = async <T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> => {
    let response: Response;
    try {
      response = await transport(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', signal,
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new GatewayError(0, 'connection_lost', 'Connection interrupted. Your saved progress is retained. Reconnect to check the original request.');
    }
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new GatewayError(response.status, error.code ?? 'request_failed', error.message ?? 'The server could not complete this request.');
    }
    return response.status === 204 ? undefined as T : await response.json() as T;
  };
  const setGrant = (grant: AccessGrant) => { token = grant.accessToken; return grant; };
  const attemptPath = (id: string) => `/attempts/${encodeURIComponent(id)}`;
  const turns = (id: string, turnId?: string) => `${attemptPath(id)}/turns${turnId ? `/${encodeURIComponent(turnId)}` : ''}`;
  const getTurn: TurnGateway['getTurn'] = (id, turnId) => call(turns(id, turnId));
  const observeTurn: TurnGateway['observeTurn'] = async (id, turnId, onUpdate, signal) => {
    let failures = 0;
    let current = await getTurn(id, turnId);
    onUpdate(current);
    while (!terminal(current)) {
      if (signal?.aborted) throw new DOMException('Observation stopped', 'AbortError');
      try {
        const response = await transport(`${base}${turns(id, turnId)}/events`, {
          headers: { Authorization: `Bearer ${token}`, 'Last-Event-ID': String(current.revision) }, signal, cache: 'no-store',
        });
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new GatewayError(response.status, error.code ?? 'stream_failed', error.message ?? 'Unable to reconnect to this reply.');
        }
        if (!response.body) throw new Error('Reply stream unavailable');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = '';
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            pending += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
            let boundary: number;
            while ((boundary = pending.indexOf('\n\n')) !== -1) {
              const frame = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
              const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
              if (!data) continue;
              if (frame.includes('event: access.error')) {
                const error = JSON.parse(data);
                throw new GatewayError(401, error.code, error.message);
              }
              if (frame.includes('event: turn.snapshot')) {
                const snapshot = JSON.parse(data) as TurnSnapshot;
                if (snapshot.turnId !== turnId) throw new Error('Reply stream identity mismatch');
                if (snapshot.revision >= current.revision) { current = snapshot; onUpdate(current); }
                if (terminal(current)) return current;
              }
            }
          }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        current = await getTurn(id, turnId);
        onUpdate(current);
        failures = 0;
      } catch (error) {
        if (signal?.aborted || (error instanceof GatewayError && error.invalidAccess)) throw error;
        if (++failures >= 3) throw new GatewayError(0, 'connection_lost', 'Reply connection interrupted. Use Reconnect to check this same reply.');
        await new Promise(resolve => setTimeout(resolve, 500));
        current = await getTurn(id, turnId);
        onUpdate(current);
      }
    }
    return current;
  };
  const gateway: ExperimentGateway & TurnGateway = {
    getExperimentInstructions: () => call('/instructions'),
    async verifyTestCode(code, requestId) { return setGrant(await call<AccessGrant>('/access/exchange', { code, requestId })); },
    async getAccessGrant(accessToken) { token = accessToken; return setGrant(await call<AccessGrant>('/access')); },
    getParticipantProfile(accessToken) { token = accessToken; return call('/profile'); },
    async submitProfile(accessToken, requestId, answers) { token = accessToken; await call('/profile', { requestId, answers }); },
    getTasks(accessToken) { token = accessToken; return call('/tasks'); },
    startTask(accessToken, id, requestId) { token = accessToken; return call(`/tasks/${encodeURIComponent(id)}/start`, { requestId }); },
    resumeTask(accessToken, id) { token = accessToken; return call(attemptPath(id)); },
    async abandonTask(accessToken, id, requestId) { token = accessToken; await call(`${attemptPath(id)}/abandon`, { requestId }); },
    submitDecision: (id, submission) => call(`${attemptPath(id)}/measurements/${submission.stage}`, submission),
    submitMessage: (id, message) => call(turns(id), message), getTurn, observeTurn,
    async sendMessage(id, message, onUpdate = () => {}, signal) {
      let accepted: TurnSnapshot;
      try { accepted = await gateway.submitMessage(id, message); }
      catch (error) {
        if (!(error instanceof GatewayError) || error.status !== 0) throw error;
        accepted = await gateway.getTurn(id, message.id);
      }
      onUpdate(accepted);
      const result = terminal(accepted) ? accepted : await observeTurn(id, accepted.turnId, onUpdate, signal);
      if (result.status !== 'completed') throw new GatewayError(409, 'turn_interrupted', result.error ?? 'This reply was interrupted. Return to the task list to start a new attempt.');
      const reply = result.messages.find(item => item.role === 'assistant');
      if (!reply) throw new Error('The completed reply is missing.');
      return { message: reply, policy: result.policy };
    },
    async endDialogue(id, requestId) { await call(`${attemptPath(id)}/end-dialogue`, { requestId }); },
    async recordEvent(id, event) { await call(`${attemptPath(id)}/events`, event); },
    completeSession: (id, requestId) => call(`${attemptPath(id)}/complete`, { requestId }),
  };
  return gateway;
}
