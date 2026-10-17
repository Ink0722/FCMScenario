import { UI_VERSION, UI_LOCALE, errors } from '../app/copy';
import { loadExperimentInstructions, loadMaterials } from '../content/load';
import type { MaterialBundle } from '../content/types';
import { previewQuestions } from '../questionnaire/config';
import study from '../generated/study.json';
import type { AccessGrant, DecisionSubmission, DialoguePolicy, ExperimentEvent, ExperimentGateway, StartedTask, TestTask } from './contracts';

const pause = () => new Promise<void>(resolve => setTimeout(resolve, 350));
const databaseKey = 'fcm.mock-service.v2';
interface TaskDefinition { id: string; number: string; caseId: string; probeEnabled: boolean }
const taskCatalog: TaskDefinition[] = study.tasks;
const taskById = new Map(taskCatalog.map(task => [task.id, task]));
const codeTasks: Record<string, TaskDefinition[]> = Object.fromEntries(
  Object.entries(study.codes).map(([code, ids]) => [code, ids.map(id => {
    const task = taskById.get(id);
    if (!task) throw new Error(`Invalid development assignment: ${id}`);
    return task;
  })]),
);
interface GrantRecord { codeKey: string; expiresAt: string; activeSessionId: string | null }
interface SessionRecord {
  accessToken: string; started: StartedTask; completedTurns: number; probeDone: boolean;
  dialogueEnded: boolean; probeEnabled: boolean;
  decisionsByRequest: Record<string, DecisionSubmission>;
  repliesByRequest: Record<string, { message: StartedTask['session']['initialMessage']; policy: DialoguePolicy }>;
  events: ExperimentEvent[];
}
interface Database {
  grants: Record<string, GrantRecord>; sessions: Record<string, SessionRecord>;
  starts: Record<string, string>; abandoned: Record<string, string>;
  profiles: Record<string, { answers: Record<string, string>; submittedAt: string }>;
}

// Browser-tab persistence is a local stand-in for server session ownership.
// It is not authorization: the HTTP implementation must enforce ownership,
// expiration, task availability, locking and idempotency on the server.
export function createMockGateway(materialLoader: () => Promise<MaterialBundle> = loadMaterials): ExperimentGateway {
  let database: Database;
  try { database = JSON.parse(sessionStorage.getItem(databaseKey) ?? 'null') ?? { grants: {}, sessions: {}, starts: {}, abandoned: {}, profiles: {} }; }
  catch { database = { grants: {}, sessions: {}, starts: {}, abandoned: {}, profiles: {} }; }
  database.abandoned ??= {};
  database.profiles ??= {};
  // Preserve previously submitted profiles and task progress from the old UI.
  for (const record of Object.values(database.sessions)) {
    const legacy = record as SessionRecord & { profileSubmitted?: boolean };
    const progress = record.started.progress as unknown as { stage: string; profileAnswers?: Record<string, string> };
    const codeKey = database.grants[record.accessToken]?.codeKey;
    if (codeKey && legacy.profileSubmitted && progress.profileAnswers && !database.profiles[codeKey]) {
      database.profiles[codeKey] = { answers: progress.profileAnswers, submittedAt: new Date().toISOString() };
    }
    if (progress.stage === 'profile') progress.stage = 'finishing';
    delete progress.profileAnswers;
    delete legacy.profileSubmitted;
  }
  sessionStorage.setItem(databaseKey, JSON.stringify(database));
  let materialsPromise: Promise<MaterialBundle> | null = null;
  const materials = () => {
    materialsPromise ??= materialLoader().catch(error => { materialsPromise = null; throw error; });
    return materialsPromise;
  };
  const save = () => sessionStorage.setItem(databaseKey, JSON.stringify(database));
  const grantFor = (token: string) => {
    const grant = database.grants[token];
    if (!grant || Date.parse(grant.expiresAt) <= Date.now()) throw new Error(errors.codeInactive);
    return grant;
  };
  const recordFor = (id: string) => {
    const record = database.sessions[id];
    if (!record) throw new Error(errors.sessionMissing);
    grantFor(record.accessToken);
    return record;
  };
  const policyFor = (record: SessionRecord): DialoguePolicy => ({
    canEnd: record.completedTurns >= study.policy.minTurnsBeforeEnd,
    probeRequired: record.probeEnabled && !record.probeDone && record.completedTurns >= study.policy.probeAfterTurns,
  });
  const snapshot = (record: SessionRecord) => {
    record.started.session.policy = policyFor(record);
    record.started.progress.dialogueStatus = policyFor(record).probeRequired ? 'probe' : 'ready';
    return structuredClone(record.started);
  };
  const describe = (definition: TaskDefinition, bundle: MaterialBundle, grant: GrantRecord): TestTask => {
    const scenario = bundle.scenarios.find(s => s.case_id === definition.caseId)!;
    const sessions = Object.values(database.sessions).filter(s => s.started.task.id === definition.id && database.grants[s.accessToken] === grant);
    const status = sessions.some(s => s.started.progress.stage === 'complete') ? 'completed'
      : sessions.some(s => s.started.progress.stage !== 'complete') ? 'in_progress' : 'available';
    return { id: definition.id, number: definition.number, title: scenario.title, status };
  };
  return {
    getExperimentInstructions: loadExperimentInstructions,
    async verifyTestCode(code, _requestId): Promise<AccessGrant> {
      await pause();
      const codeKey = code.trim().toUpperCase();
      if (codeKey === 'FCM-EXPIRED') throw new Error(errors.codeExpired);
      if (!codeTasks[codeKey]) throw new Error(errors.codeUnknown);
      const existing = Object.entries(database.grants).find(([, g]) => g.codeKey === codeKey && Date.parse(g.expiresAt) > Date.now());
      if (existing) return { accessToken: existing[0], expiresAt: existing[1].expiresAt, testCode: codeKey };
      const accessToken = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      database.grants[accessToken] = { codeKey, expiresAt, activeSessionId: null }; save();
      return { accessToken, expiresAt, testCode: codeKey };
    },
    async getAccessGrant(token) {
      const grant = grantFor(token);
      return { accessToken: token, expiresAt: grant.expiresAt, testCode: grant.codeKey };
    },
    async getTasks(token) {
      const grant = grantFor(token);
      const bundle = await materials();
      return codeTasks[grant.codeKey].map(task => describe(task, bundle, grant));
    },
    async getParticipantProfile(token) {
      const grant = grantFor(token);
      return { questions: structuredClone(previewQuestions), answers: structuredClone(database.profiles[grant.codeKey]?.answers ?? null) };
    },
    async submitProfile(token, _requestId, answers) {
      await pause();
      const grant = grantFor(token);
      // A completed code-level profile remains unchanged on retries.
      if (database.profiles[grant.codeKey]) return;
      if (!previewQuestions.every(q => !q.required || q.options.some(o => o.value === answers[q.id]))) throw new Error(errors.profileRequired);
      const validated = Object.fromEntries(previewQuestions.filter(q => answers[q.id] !== undefined).map(q => [q.id, answers[q.id]]));
      database.profiles[grant.codeKey] = { answers: validated, submittedAt: new Date().toISOString() }; save();
    },
    async startTask(token, taskId, requestId) {
      await pause();
      const grant = grantFor(token);
      const definition = codeTasks[grant.codeKey].find(task => task.id === taskId);
      if (!definition) throw new Error(errors.taskUnassigned);
      if (!database.profiles[grant.codeKey]) throw new Error(errors.profileFirst);
      const bundle = await materials();
      grantFor(token);
      const priorId = database.starts[`${token}:${requestId}`];
      if (priorId) {
        if (database.abandoned[priorId]) throw new Error(errors.abandoned);
        const prior = recordFor(priorId);
        if (prior.started.task.id !== taskId) throw new Error(errors.taskMismatch);
        return snapshot(prior);
      }
      if (grant.activeSessionId) {
        const active = recordFor(grant.activeSessionId);
        if (active.started.progress.stage !== 'complete') {
          if (active.started.task.id === taskId) return snapshot(active);
          throw new Error(errors.taskLocked);
        }
      }
      const task = describe(definition, bundle, grant);
      if (task.status !== 'available') throw new Error(errors.taskCompleted);
      const scenario = bundle.scenarios.find(s => s.case_id === definition.caseId)!;
      const id = crypto.randomUUID();
      const record: SessionRecord = {
        accessToken: token, completedTurns: 0, probeDone: false, dialogueEnded: false,
        probeEnabled: definition.probeEnabled, decisionsByRequest: {}, repliesByRequest: {}, events: [],
        started: { task: { ...task, status: 'in_progress' }, scenario: structuredClone(scenario), shared: structuredClone(bundle.shared), bundleRevision: bundle.bundle_revision,
          session: { id, taskId: task.id, taskNumber: task.number, scenarioRevision: scenario.revision, sharedRevision: bundle.shared.revision, uiVersion: UI_VERSION, uiLocale: UI_LOCALE,
            policy: { canEnd: false, probeRequired: false }, initialMessage: { id: crypto.randomUUID(), role: 'assistant', timestamp: new Date().toISOString(),
              text: 'You can ask about the conditions in the materials or share what you are considering. We can discuss them one at a time.' } },
          progress: { stage: 'pre', dialogueStatus: 'ready', messages: [], decisions: {}, receipt: '' } },
      };
      database.sessions[id] = record; database.starts[`${token}:${requestId}`] = id; grant.activeSessionId = id; save();
      return snapshot(record);
    },
    async resumeTask(token, id) {
      await pause(); grantFor(token);
      const record = recordFor(id);
      if (record.accessToken !== token) throw new Error(errors.accessDenied);
      return snapshot(record);
    },
    async abandonTask(token, id, _requestId) {
      await pause();
      const grant = grantFor(token);
      if (database.abandoned[id] === token) return;
      const record = recordFor(id);
      if (record.accessToken !== token) throw new Error(errors.abandonDenied);
      if (record.started.progress.stage === 'complete') return;
      delete database.sessions[id];
      if (grant.activeSessionId === id) grant.activeSessionId = null;
      database.abandoned[id] = token; save();
    },
    async submitDecision(id, submission) {
      const record = recordFor(id); await pause();
      const { choice, confidence } = submission.decision;
      if (!['A', 'B'].includes(choice) || !Number.isInteger(confidence) || confidence < 0 || confidence > 100)
        throw new Error(errors.invalidDecision);
      if (record.decisionsByRequest[submission.requestId]) return policyFor(record);
      const progress = record.started.progress;
      if ((submission.stage === 'pre' && progress.stage !== 'pre') || (submission.stage === 'post' && progress.stage !== 'post')
        || (submission.stage === 'probe' && (progress.stage !== 'dialogue' || !policyFor(record).probeRequired)))
        throw new Error(errors.decisionStage);
      record.decisionsByRequest[submission.requestId] = structuredClone(submission);
      progress.decisions[submission.stage] = structuredClone(submission.decision);
      if (submission.stage === 'pre') { progress.stage = 'dialogue'; progress.messages = [record.started.session.initialMessage]; }
      if (submission.stage === 'probe') record.probeDone = true;
      if (submission.stage === 'post') progress.stage = 'finishing';
      save(); return policyFor(record);
    },
    async sendMessage(id, message) {
      const record = recordFor(id); await pause();
      if (record.repliesByRequest[message.id]) return structuredClone(record.repliesByRequest[message.id]);
      if (record.started.progress.stage !== 'dialogue' || record.dialogueEnded || policyFor(record).probeRequired)
        throw new Error(errors.probeFirst);
      record.completedTurns++;
      const texts = [
        'You can refer to the specific conditions in the materials on the left. Common terms are listed separately, and differences appear in the option details. You can also open the reference documents for contract details.',
        'You can compare the eligibility conditions, fees and timing of the two options, then consider which factors matter to you. If a passage is unclear, you can share the original wording here.',
        'The final choice is yours. You can discuss anything that remains unclear, or end the conversation when you have enough information and make your final choice independently.',
      ];
      const result = { message: { id: crypto.randomUUID(), role: 'assistant' as const, timestamp: new Date().toISOString(), text: texts[(record.completedTurns - 1) % texts.length] }, policy: policyFor(record) };
      record.repliesByRequest[message.id] = result;
      record.started.progress.messages.push(structuredClone(message), result.message); save(); return structuredClone(result);
    },
    async endDialogue(id, _requestId) {
      const record = recordFor(id); await pause();
      if (record.dialogueEnded) return;
      if (!policyFor(record).canEnd || policyFor(record).probeRequired) throw new Error(errors.cannotEnd);
      record.dialogueEnded = true; record.started.progress.stage = 'post'; save();
    },
    async recordEvent(id, event) { const record = recordFor(id); record.events.push(structuredClone(event)); save(); },
    async completeSession(id, _requestId) {
      const record = recordFor(id); await pause();
      if (!record.started.progress.decisions.post) throw new Error(errors.finalRequired);
      if (!database.profiles[grantFor(record.accessToken).codeKey]) throw new Error(errors.profileFirst);
      record.started.progress.stage = 'complete'; record.started.progress.receipt ||= `FCM-${id.slice(0, 8).toUpperCase()}`;
      record.started.task.status = 'completed'; save(); return { receipt: record.started.progress.receipt };
    },
  };
}
