import { useEffect, useRef, useState } from 'react';
import type { AccessGrant, ExperimentGateway, ParticipantProfile, StartedTask, TestTask } from '../integration/contracts';
import { clearAccessCache, readAccessCache, saveAccessCache } from './storage';

type AccessState = { stage: 'loading' } | { stage: 'code' }
  | { stage: 'profile'; grant: AccessGrant; profile: ParticipantProfile; sessionId: string | null }
  | { stage: 'tasks'; grant: AccessGrant; tasks: TestTask[]; profile: ParticipantProfile; sessionId: string | null }
  | { stage: 'active'; grant: AccessGrant; started: StartedTask };
export function useAccess(gateway: ExperimentGateway) {
  const [state, setState] = useState<AccessState>({ stage: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const requestIds = useRef(new Map<string, string>());
  const idFor = (key: string) => {
    if (!requestIds.current.has(key)) requestIds.current.set(key, crypto.randomUUID());
    return requestIds.current.get(key)!;
  };
  const activate = (grant: AccessGrant, started: StartedTask) => {
    saveAccessCache({ grant, sessionId: started.session.id });
    setState({ stage: 'active', grant, started });
  };
  const enterTasks = async (grant: AccessGrant, sessionId: string | null = null, active = () => true) => {
    const [profile, tasks] = await Promise.all([gateway.getParticipantProfile(grant.accessToken), gateway.getTasks(grant.accessToken)]);
    if (!active()) return;
    if (profile.answers !== null && sessionId) {
      const started = await gateway.resumeTask(grant.accessToken, sessionId);
      if (active()) activate(grant, started);
      return;
    }
    const ongoing = tasks.find(t => t.status === 'in_progress');
    if (profile.answers !== null && ongoing) {
      const started = await gateway.startTask(grant.accessToken, ongoing.id, idFor(`restore-${ongoing.id}`));
      if (active()) activate(grant, started);
    } else if (active()) setState({ stage: 'tasks', grant, tasks, profile, sessionId });
  };
  const run = async (operation: () => Promise<void>) => {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError('');
    try { await operation(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : '这次操作没能完成，请再试一次。'); return false; }
    finally { lock.current = false; setBusy(false); }
  };
  useEffect(() => {
    let active = true;
    const cache = readAccessCache();
    if (!cache) { setState({ stage: 'code' }); return; }
    const restore = async () => {
      try {
        const grant = await gateway.getAccessGrant(cache.grant.accessToken);
        if (!active) return;
        saveAccessCache({ grant, sessionId: cache.sessionId });
        await enterTasks(grant, cache.sessionId, () => active);
      } catch (e) {
        if (active) { clearAccessCache(); setState({ stage: 'code' }); setError(e instanceof Error ? e.message : '暂时没能恢复你的任务，请重新输入测试编码。'); }
      }
    };
    void restore();
    return () => { active = false; };
  }, [gateway]);
  const verifyCode = (code: string) => run(async () => {
    if (state.stage !== 'code' || !code.trim()) return;
    const grant = await gateway.verifyTestCode(code.trim(), idFor(`code-${code.trim()}`));
    saveAccessCache({ grant, sessionId: null });
    await enterTasks(grant);
  });
  const openProfile = () => {
    if (state.stage !== 'tasks' || lock.current || state.profile.answers !== null) return;
    setError('');
    setState({ stage: 'profile', grant: state.grant, profile: state.profile, sessionId: state.sessionId });
  };
  const returnFromProfile = () => run(async () => {
    if (state.stage !== 'profile') return;
    await enterTasks(state.grant, state.sessionId);
  });
  const submitProfile = (answers: Record<string, string>) => run(async () => {
    if (state.stage !== 'profile') return;
    await gateway.submitProfile(state.grant.accessToken, idFor(`profile-${state.grant.accessToken}`), answers);
    await enterTasks(state.grant, state.sessionId);
  });
  const start = (taskId: string) => run(async () => {
    if (state.stage !== 'tasks' || state.profile.answers === null || !state.tasks.some(t => t.id === taskId && t.status === 'available')) return;
    const started = await gateway.startTask(state.grant.accessToken, taskId, idFor(`start-${state.grant.accessToken}-${taskId}`));
    activate(state.grant, started);
  });
  const changeCode = () => {
    if ((state.stage !== 'tasks' && state.stage !== 'profile') || lock.current) return;
    clearAccessCache(); setError(''); setState({ stage: 'code' });
  };
  const returnToTasks = () => run(async () => {
    if (state.stage !== 'active') return;
    const current = await gateway.resumeTask(state.grant.accessToken, state.started.session.id);
    if (current.progress.stage !== 'complete') throw new Error('请先完成当前任务。');
    saveAccessCache({ grant: state.grant, sessionId: null });
    await enterTasks(state.grant);
  });
  const returnHome = () => run(async () => {
    if (state.stage !== 'active') return;
    const id = state.started.session.id;
    await gateway.abandonTask(state.grant.accessToken, id, idFor(`abandon-${id}`));
    saveAccessCache({ grant: state.grant, sessionId: null });
    requestIds.current.clear();
    await enterTasks(state.grant);
  });
  return { state, busy, error, verifyCode, openProfile, submitProfile, returnFromProfile, start, changeCode, returnToTasks, returnHome };
}
