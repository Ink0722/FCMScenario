export interface ResearcherSession { actor: string; expiresAt: string; csrfToken: string }
export interface ModelProfile {
  id: string; label: string; baseUrl: string; modelName: string; hasApiKey: boolean;
  configured: boolean; runtimeReady: boolean; probeSupported: boolean;
}
export interface ModelBudget {
  currency: string; limitUsd: number; spentUsd: number; reservedUsd: number; remainingUsd: number;
  requestCount: number; nextRequestReserveUsd: number; canRequest: boolean; scope: string;
}
export interface BudgetCheck {
  applies: boolean; taskCount: number; minimumTurns: number; estimatedPerTurnUsd: number;
  estimatedMinimumUsd: number; remainingUsd: number; canIssue: boolean; message: string | null; basis: string;
}
export interface ModelProbeRecord {
  outputTokenLimit?: number; stage?: string;
  jobId: string; createdAt: string; providerRequestId: string | null; providerResponseId: string | null;
  modelLabel: string; modelName: string | null; httpStatus: number | null; failureKind: string | null; canReconcile: boolean;
  reconciliation: { providerReference: string; evidence: string; reconciledAt: string } | null;
  requestId: string; modelId: string; status: string; message: string; responseText: string | null;
  usage: { inputTokens: number; outputTokens: number } | null;
  costUsd: number; costStatus: string; finishedAt: string | null;
}
export interface ModelProbeResult extends ModelProbeRecord { budget: ModelBudget }
export interface ProbeHistory { items: ModelProbeRecord[]; total: number; page: number; pageSize: number; budget: ModelBudget }
export interface AdvisorValidation {
  taskCode?: string; caseId?: string; condition?: string; targetOptionId?: string | null; turnCount?: number; completedTurns?: number;
  jobId: string; status: string; message: string; modelId: string; scope: string;
  selectedStrategy: { strategy_id: string } | null;
  modelCalls: unknown[]; toolCalls: unknown[]; responseText: string | null; budget: ModelBudget;
}
export interface WorkerState {
  status: 'online' | 'offline'; activeWorkers: number; lastSeenAt: string | null; lastProcessedAt: string | null;
  queued: number; running: number; oldestPendingSeconds: number; queueStalled: boolean;
}
export interface BatchPlan {
  sourceKey: string; sourceBatch: string | null; taskCodes: string[]; maxTurns: number;
  modelId: string | null; groups: { condition: 'neutral' | 'goal'; count: number }[];
}
export interface BatchRow {
  allocationPlanRef: string | null;
  key: string; batchId: string | null; configRef: string; participantCount: number;
  groups: BatchPlan['groups']; statuses: Record<RecordStatus, number>; firstAssignedAt: string; lastAssignedAt: string;
  taskTotal: number; tasksCompleted: number; taskNumbers: string[]; runtimeMode: string; modelLabel: string; copyPlan: BatchPlan;
}
export interface BatchPage { items: BatchRow[]; total: number; page: number; pageSize: number }
export interface CaseQuota { caseId: string; neutral: number; goal: number }
export interface AllocationRequest {
  requestId: string; quotas: CaseQuota[]; tasksPerPerson: number; maxTurns: number; modelId: string | null;
  batchId: string | null; expiresAt: string | null; seed: string | null;
}
export interface AllocationPlan {
  budgetCheck?: BudgetCheck;
  planRef: string; configRef: string; batchId: string; createdAt: string; expiresAt: string | null;
  seed: string; algorithm: string; tasksPerPerson: number; participantCount: number; taskCount: number;
  counts: { neutral: number; goal: number }; issued: boolean; archived: boolean; canIssue: boolean; runtimeMode: string;
  quotas: CaseQuota[]; maxTurns: number;
  cooccurrence: { cases: [string, string]; neutral: number; goal: number }[];
  readinessMessage: string | null; model: ModelProfile | null;
  members: { slot: string; condition: 'neutral' | 'goal'; participantId: string | null; code: string | null;
    tasks: { caseId: string; taskCode: string; position: number; targetOptionId: string; optionOrder: string[] }[] }[];
  checks: { caseId: string; neutral: QuotaCheck; goal: QuotaCheck }[];
}
export interface QuotaCheck {
  requested: number; planned: number; issued: number; completed: number; positions: number[];
  targets: { A: number; B: number }; optionOrders: { AB: number; BA: number };
  combinations: { A_AB: number; A_BA: number; B_AB: number; B_BA: number };
}
export interface AllocationHistory { items: {
  planRef: string; batchId: string; createdAt: string; tasksPerPerson: number; participantCount: number;
  caseCount: number; counts: { neutral: number; goal: number }; status: string;
}[]; total: number; page: number; pageSize: number }
export interface EnvironmentConfig {
  revision: number; environmentName: string; notes: string; updatedAt: string | null;
  models: ModelProfile[];
  modelBudget: ModelBudget;
  runtime: {
    mode: string; apiStatus: string; databaseStatus: string; databaseEngine: string; databaseLocation: string;
    worker: WorkerState;
    artifactDirectory: string; studyFile: string; timeZone: string; pythonVersion: string;
    fastapiVersion: string; sqlalchemyVersion: string; activeModel: string; modelConnectionActive: boolean;
  };
}
export type RecordStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'expired';
export interface ParticipantRow {
  participantId: string; codeDisplay: string; testCode: string | null; studyId: string; batchId: string | null;
  condition: 'neutral' | 'goal'; status: RecordStatus; profileStatus: string;
  taskCount: number; completedTasks: number; assignedAt: string; startedAt: string | null;
  completedAt: string | null; expiresAt: string | null;
}
export interface ParticipantPage { items: ParticipantRow[]; total: number; page: number; pageSize: number }
export interface Overview {
  worker: WorkerState;
  runtimeMode: string; participants: Record<RecordStatus, number>; tasks: Record<string, number>;
  jobs: Record<string, number>; batches: string[];
}
export interface Catalog {
  studyId: string; runtimeMode: string; minimumTurns: number; defaultMaxTurns: number; modelRef: string;
  models: ModelProfile[];
  tasks: { taskCode: string; number: string; caseId: string; enabled: boolean }[];
}
export interface Preview {
  budgetCheck?: BudgetCheck;
  configRef: string; runtimeMode: string; maxTurns: number;
  model: (ModelProfile & { configRef: string }) | null; canIssue: boolean; readinessMessage: string | null;
  tasks: { taskCode: string; number: string; caseId: string }[];
}
export interface CodeRow { participantId: string; code: string | null; condition?: 'neutral' | 'goal'; batchId?: string | null }
export interface Codes { codes: CodeRow[]; participants: string[]; replayed: boolean; notice?: string }
export interface TaskSummary {
  sequence?: number;
  id: string; number: string; title: string; status: string; taskCode: string; scenarioId: string;
  modelRef: string; targetOptionId: string; optionOrder: string[]; attemptCount: number;
  startedAt: string | null; completedAt: string | null; revision: number;
}
export interface Measurement {
  submission_status: string; answers: { choice: string; confidence: number } | null;
  submitted_at: string | null; instrument_ref: string;
}
export interface ParticipantDetail extends ParticipantRow {
  configRef: string; runtimeMode: string; policy: { minimum: number; maximum: number };
  profile: { answers: Record<string, string> | null; submission_status: string; submitted_at: string | null; instrument_ref: string };
  questions: { id: string; title: string; options: { value: string; label: string }[] }[];
  tasks: TaskSummary[];
}
export interface Message { id: string; role: string; text: string; timestamp: string; status?: string;
  citations?: { documentId?: string; title: string; page?: number; revision?: string }[] }
export interface Turn {
  turn_id: string; turn_no: number; status: string; started_at: string; finished_at: string | null;
  messages: Message[]; selected_strategy: unknown; tool_calls: unknown[]; model_calls: unknown[];
  execution: { runtime_mode: string; model_calls: number; job_id: string };
}
export interface Attempt {
  attempt_id: string; attempt_no: number; status: string; phase: string; started_at: string;
  ended_at: string | null; stop_reason: string | null; opening: Message;
  measurements: { pre: Measurement; post: Measurement }; turns: Turn[];
  events: unknown[]; receipt: string;
}
export interface TaskDetail extends TaskSummary {
  strategyCatalog?: { id: string; name: string }[];
  participantId: string; codeDisplay: string; condition: string; configRef: string; runtimeMode: string;
  targetRule: string; policy: { minimum: number; maximum: number }; attempts: Attempt[];
  scenario: { title: string; context: string; options: { id: string; title?: string; label?: string; text?: string; description?: string }[]; [key: string]: unknown };
}
