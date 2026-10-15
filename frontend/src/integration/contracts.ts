import type { Choice, Scenario, SharedCopy } from '../content/types';
import type { Question } from '../questionnaire/config';

export interface Decision { choice: Choice; confidence: number }
export type DecisionStage = 'pre' | 'probe' | 'post';
export interface Message { id: string; role: 'assistant' | 'user'; text: string; timestamp: string }
export interface DialoguePolicy { canEnd: boolean; probeRequired: boolean }
export type ExperimentStage = 'pre' | 'dialogue' | 'post' | 'finishing' | 'complete';
export interface TestTask {
  id: string;
  number: string;
  title: string;
  status: 'available' | 'in_progress' | 'completed' | 'unavailable';
}
export interface AccessGrant {
  accessToken: string;
  expiresAt: string;
  testCode: string;
}
export type ExperimentInstructions = Pick<SharedCopy, 'welcome' | 'revision'>;
export interface ParticipantProfile {
  questions: Question[];
  answers: Record<string, string> | null;
}
export interface SessionProgress {
  stage: ExperimentStage;
  dialogueStatus: 'ready' | 'probe';
  messages: Message[];
  decisions: Partial<Record<DecisionStage, Decision>>;
  receipt: string;
}
export interface StartedTask {
  task: TestTask;
  session: Session;
  scenario: Scenario;
  shared: SharedCopy;
  bundleRevision: string;
  progress: SessionProgress;
}
export interface Session {
  id: string;
  taskId: string;
  taskNumber: string;
  scenarioRevision: string;
  sharedRevision: string;
  uiVersion: string;
  initialMessage: Message;
  policy: DialoguePolicy;
}
export interface ExperimentEvent {
  id: string;
  timestamp: string;
  kind: 'stage_view' | 'reference_open' | 'information_toggle' | 'dialogue_end';
  details: Record<string, string | number | boolean>;
}
export interface DecisionSubmission {
  requestId: string;
  stage: DecisionStage;
  decision: Decision;
  timestamp: string;
}
// Methods describe application needs, not assumed HTTP endpoints. The real
// backend owns hidden conditions, turn accounting, policy and durable storage.
export interface ExperimentGateway {
  getExperimentInstructions(): Promise<ExperimentInstructions>;
  verifyTestCode(code: string, requestId: string): Promise<AccessGrant>;
  // Restore the verified code for display, including older browser caches.
  getAccessGrant(accessToken: string): Promise<AccessGrant>;
  // Profile belongs to the code's participant, independently of task sessions.
  getParticipantProfile(accessToken: string): Promise<ParticipantProfile>;
  submitProfile(accessToken: string, requestId: string, answers: Record<string, string>): Promise<void>;
  getTasks(accessToken: string): Promise<TestTask[]>;
  startTask(accessToken: string, taskId: string, requestId: string): Promise<StartedTask>;
  resumeTask(accessToken: string, sessionId: string): Promise<StartedTask>;
  // Discard an unfinished session; completed results remain intact.
  abandonTask(accessToken: string, sessionId: string, requestId: string): Promise<void>;
  submitDecision(sessionId: string, submission: DecisionSubmission): Promise<DialoguePolicy>;
  sendMessage(sessionId: string, message: Message): Promise<{ message: Message; policy: DialoguePolicy }>;
  endDialogue(sessionId: string, requestId: string): Promise<void>;
  recordEvent(sessionId: string, event: ExperimentEvent): Promise<void>;
  completeSession(sessionId: string, requestId: string): Promise<{ receipt: string }>;
}
