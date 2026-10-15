import { loadExperimentInstructions, loadMaterials } from '../content/load';
import type { MaterialBundle } from '../content/types';
import { previewQuestions } from '../questionnaire/config';
import type { AccessGrant, DecisionSubmission, DialoguePolicy, ExperimentEvent, ExperimentGateway, StartedTask, TestTask } from './contracts';

const pause = () => new Promise<void>(resolve => setTimeout(resolve, 350));
const databaseKey = 'fcm.mock-service.v2';
const taskKeys = ['7K3M', '6H2W', '3J8T', '8D4L', '5B9V', '2R6X', '9F3P', '4W7H', '4P8R', '6N2C', '3T9D', '8M5K', '2V7S', '5Q4B', '9L6J', '7R2F', '9C2N', '4H8W', '6S3V', '2K5M'];
interface TaskDefinition { id: string; number: string; caseId: string; probeEnabled: boolean }
const taskCatalog: TaskDefinition[] = taskKeys.map((key, index) => ({
  id: `task-${key.toLowerCase()}`, number: `TASK-${key}`, caseId: String(index + 1).padStart(2, '0'), probeEnabled: false,
}));
const probeTask: TaskDefinition = { id: 'task-2x9q', number: 'TASK-2X9Q', caseId: '01', probeEnabled: true };
const codeTasks: Record<string, TaskDefinition[]> = {
  'FCM-2026': [taskCatalog[0], taskCatalog[8], taskCatalog[16]],
  'FCM-SINGLE': [taskCatalog[1]],
  'FCM-PROBE': [probeTask],
  'FCM-ALL': taskCatalog,
  'FCM-EMPTY': [],
};
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
    if (!grant || Date.parse(grant.expiresAt) <= Date.now()) throw new Error('这个编码已失效，请联系研究人员协助处理。');
    return grant;
  };
  const recordFor = (id: string) => {
    const record = database.sessions[id];
    if (!record) throw new Error('暂时无法找到这次任务的记录，请刷新页面再试一次。');
    grantFor(record.accessToken);
    return record;
  };
  const policyFor = (record: SessionRecord): DialoguePolicy => ({
    canEnd: record.completedTurns >= 3,
    probeRequired: record.probeEnabled && !record.probeDone && record.completedTurns >= 2,
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
      if (codeKey === 'FCM-EXPIRED') throw new Error('这个编码已过期，可以联系研究人员确认新的测试安排。');
      if (!codeTasks[codeKey]) throw new Error('没能识别这个编码，请核对后再试一次。');
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
      if (!previewQuestions.every(q => !q.required || q.options.some(o => o.value === answers[q.id]))) throw new Error('还有必填问题没有填写，请补充后再提交。');
      const validated = Object.fromEntries(previewQuestions.filter(q => answers[q.id] !== undefined).map(q => [q.id, answers[q.id]]));
      database.profiles[grant.codeKey] = { answers: validated, submittedAt: new Date().toISOString() }; save();
    },
    async startTask(token, taskId, requestId) {
      await pause();
      const grant = grantFor(token);
      const definition = codeTasks[grant.codeKey].find(task => task.id === taskId);
      if (!definition) throw new Error('这个编码下没有安排这项任务，可以返回列表选择其他任务。');
      if (!database.profiles[grant.codeKey]) throw new Error('请先在任务列表完成用户资料，之后就可以开始测试。');
      const bundle = await materials();
      grantFor(token);
      const priorId = database.starts[`${token}:${requestId}`];
      if (priorId) {
        if (database.abandoned[priorId]) throw new Error('这次任务已退出，请回到列表重新开始。');
        const prior = recordFor(priorId);
        if (prior.started.task.id !== taskId) throw new Error('你选择的任务与原任务不一致，请刷新页面再试一次。');
        return snapshot(prior);
      }
      if (grant.activeSessionId) {
        const active = recordFor(grant.activeSessionId);
        if (active.started.progress.stage !== 'complete') {
          if (active.started.task.id === taskId) return snapshot(active);
          throw new Error('测试已经开始，暂时不能更换任务。完成后可以回到列表继续选择。');
        }
      }
      const task = describe(definition, bundle, grant);
      if (task.status !== 'available') throw new Error('这项任务已完成，谢谢你的作答。可以返回列表选择其他任务。');
      const scenario = bundle.scenarios.find(s => s.case_id === definition.caseId)!;
      const id = crypto.randomUUID();
      const record: SessionRecord = {
        accessToken: token, completedTurns: 0, probeDone: false, dialogueEnded: false,
        probeEnabled: definition.probeEnabled, decisionsByRequest: {}, repliesByRequest: {}, events: [],
        started: { task: { ...task, status: 'in_progress' }, scenario: structuredClone(scenario), shared: structuredClone(bundle.shared), bundleRevision: bundle.bundle_revision,
          session: { id, taskId: task.id, taskNumber: task.number, scenarioRevision: scenario.revision, sharedRevision: bundle.shared.revision, uiVersion: '0.2.0',
            policy: { canEnd: false, probeRequired: false }, initialMessage: { id: crypto.randomUUID(), role: 'assistant', timestamp: new Date().toISOString(),
              text: '你可以从材料中想了解的条件开始，也可以说说你的考虑。我们可以逐项讨论。' } },
          progress: { stage: 'pre', dialogueStatus: 'ready', messages: [], decisions: {}, receipt: '' } },
      };
      database.sessions[id] = record; database.starts[`${token}:${requestId}`] = id; grant.activeSessionId = id; save();
      return snapshot(record);
    },
    async resumeTask(token, id) {
      await pause(); grantFor(token);
      const record = recordFor(id);
      if (record.accessToken !== token) throw new Error('这个编码不能访问这项任务，请确认使用的是研究人员提供的编码。');
      return snapshot(record);
    },
    async abandonTask(token, id, _requestId) {
      await pause();
      const grant = grantFor(token);
      if (database.abandoned[id] === token) return;
      const record = recordFor(id);
      if (record.accessToken !== token) throw new Error('这个编码不能退出这项任务，请联系研究人员协助处理。');
      if (record.started.progress.stage === 'complete') return;
      delete database.sessions[id];
      if (grant.activeSessionId === id) grant.activeSessionId = null;
      database.abandoned[id] = token; save();
    },
    async submitDecision(id, submission) {
      const record = recordFor(id); await pause();
      const { choice, confidence } = submission.decision;
      if (!['A', 'B'].includes(choice) || !Number.isInteger(confidence) || confidence < 0 || confidence > 100)
        throw new Error('请选择一个方案，并填写 0—100 的整数置信度。');
      if (record.decisionsByRequest[submission.requestId]) return policyFor(record);
      const progress = record.started.progress;
      if ((submission.stage === 'pre' && progress.stage !== 'pre') || (submission.stage === 'post' && progress.stage !== 'post')
        || (submission.stage === 'probe' && (progress.stage !== 'dialogue' || !policyFor(record).probeRequired)))
        throw new Error('这次判断暂时不能提交，请刷新页面再试一次。');
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
        throw new Error('先完成这次判断，就可以继续交流了。');
      record.completedTurns++;
      const texts = [
        '可以把你关注的问题对应到左侧材料中的具体条件。两个方案的共同条件已经单独列出，差异可以在方案资料中逐项查看；涉及合同细节时，也可以打开原始参考文件。',
        '你可以分别看看两个方案的适用条件、费用和时间安排，再判断哪些因素与你的考虑有关。若有某条材料难以理解，可以直接把原文发来。',
        '最后的选择由你自己作出。你可以继续讨论尚未澄清的内容，也可以在信息足够时结束交流，独立完成最终判断。',
      ];
      const result = { message: { id: crypto.randomUUID(), role: 'assistant' as const, timestamp: new Date().toISOString(), text: texts[(record.completedTurns - 1) % texts.length] }, policy: policyFor(record) };
      record.repliesByRequest[message.id] = result;
      record.started.progress.messages.push(structuredClone(message), result.message); save(); return structuredClone(result);
    },
    async endDialogue(id, _requestId) {
      const record = recordFor(id); await pause();
      if (record.dialogueEnded) return;
      if (!policyFor(record).canEnd || policyFor(record).probeRequired) throw new Error('暂时还不能结束交流，请先完成页面上的判断或继续交流。');
      record.dialogueEnded = true; record.started.progress.stage = 'post'; save();
    },
    async recordEvent(id, event) { const record = recordFor(id); record.events.push(structuredClone(event)); save(); },
    async completeSession(id, _requestId) {
      const record = recordFor(id); await pause();
      if (!record.started.progress.decisions.post) throw new Error('请先提交最终判断，再完成这项任务。');
      if (!database.profiles[grantFor(record.accessToken).codeKey]) throw new Error('请先在任务列表完成用户资料，之后就可以开始测试。');
      record.started.progress.stage = 'complete'; record.started.progress.receipt ||= `FCM-${id.slice(0, 8).toUpperCase()}`;
      record.started.task.status = 'completed'; save(); return { receipt: record.started.progress.receipt };
    },
  };
}
