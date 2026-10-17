import type {
  AccessGrant, DecisionSubmission, DialoguePolicy, ExperimentEvent,
  ExperimentInstructions, Message, ParticipantProfile, StartedTask, TestTask,
} from './generated/types';

// Application capabilities, not guessed HTTP endpoints. The backend owns
// authentication, session ownership, conditions, policy and durable storage.
export interface ExperimentGateway {
  getExperimentInstructions(): Promise<ExperimentInstructions>;
  verifyTestCode(code: string, requestId: string): Promise<AccessGrant>;
  getAccessGrant(accessToken: string): Promise<AccessGrant>;
  getParticipantProfile(accessToken: string): Promise<ParticipantProfile>;
  submitProfile(accessToken: string, requestId: string, answers: Record<string, string>): Promise<void>;
  getTasks(accessToken: string): Promise<TestTask[]>;
  startTask(accessToken: string, taskId: string, requestId: string): Promise<StartedTask>;
  resumeTask(accessToken: string, sessionId: string): Promise<StartedTask>;
  // Discard an unfinished session, keeping completed results and profile.
  abandonTask(accessToken: string, sessionId: string, requestId: string): Promise<void>;
  submitDecision(sessionId: string, submission: DecisionSubmission): Promise<DialoguePolicy>;
  sendMessage(sessionId: string, message: Message): Promise<{ message: Message; policy: DialoguePolicy }>;
  endDialogue(sessionId: string, requestId: string): Promise<void>;
  recordEvent(sessionId: string, event: ExperimentEvent): Promise<void>;
  completeSession(sessionId: string, requestId: string): Promise<{ receipt: string }>;
}
