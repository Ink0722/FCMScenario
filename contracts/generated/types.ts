// Generated from contracts/schemas/runtime.schema.json. Do not edit.

export type Choice = "A" | "B";

export type Question = { id: string; title: string; required: boolean; options: Array<{ value: string; label: string }> };

export type Scenario = { case_id: string; scenario_id: string; locale?: string; title: string; template: "table" | "cards"; background: string; common_facts: Array<string>; comparison: Array<{ attribute: string; A: string; B: string }>; additional_information: Array<{ kind: "terms" | "survey" | "history"; title: string; text: string }>; references: Array<{ document_id: string; title: string; url: string; revision: string }>; task: string; knowledge: Array<{ title: string; text: string }>; options: Array<{ id: Choice; label: string }>; revision: string };

export type SharedCopy = { locale?: string; source_revision?: string; welcome: string; choice_prompt: string; confidence_prompt: string; confidence_scale: string; confidence_notes?: string; pre_prompt: string; probe_prompt: string; post_prompt: string; revision: string };

export type Decision = { choice: Choice; confidence: number };

export type DecisionStage = "pre" | "probe" | "post";

export type Message = { id: string; role: "assistant" | "user"; text: string; timestamp: string; status?: "partial" | "complete" | "interrupted"; citations?: Array<Citation> };

export type DialoguePolicy = { canEnd: boolean; probeRequired: boolean; minTurnsBeforeEnd?: number; completedTurns?: number; maxTurns?: number; canSend?: boolean; stage?: ExperimentStage };

export type ExperimentStage = "pre" | "dialogue" | "post" | "finishing" | "complete";

export type TestTask = { sequence?: number; id: string; number: string; title: string; status: "available" | "in_progress" | "completed" | "unavailable" };

export type AccessGrant = { accessToken: string; expiresAt: string; testCode?: string; participantId: string; codeDisplay: string };

export type ExperimentInstructions = { welcome: string; revision: string };

export type ParticipantProfile = { questions: Array<Question>; answers: { [key: string]: string } | null };

export type SessionProgress = { stage: ExperimentStage; dialogueStatus: "ready" | "probe" | "queued" | "running" | "interrupted"; messages: Array<Message>; decisions: { pre?: Decision; probe?: Decision; post?: Decision }; receipt: string; activeTurn?: TurnHandle | null; revision?: number };

export type StartedTask = { task: TestTask; session: Session; scenario: Scenario; shared: SharedCopy; bundleRevision: string; progress: SessionProgress };

export type Session = { id: string; taskId: string; taskNumber: string; scenarioRevision: string; sharedRevision: string; uiVersion: string; uiLocale?: string; initialMessage: Message; policy: DialoguePolicy; runtimeMode?: "deterministic" | "agent" };

export type ExperimentEvent = { id: string; timestamp: string; kind: "stage_view" | "reference_open" | "information_toggle" | "dialogue_end"; details: { [key: string]: string | number | boolean } };

export type DecisionSubmission = { requestId: string; stage: DecisionStage; decision: Decision; timestamp: string };

export type MaterialBundle = { schema_version: string; bundle_revision: string; shared: SharedCopy; scenarios: Array<Scenario> };

export type Citation = { title: string; url: string; documentId?: string; page?: number; revision?: string };

export type TurnStatus = "queued" | "running" | "completed" | "interrupted" | "cancelled";

export type TurnHandle = { turnId: string; status: TurnStatus };

export type TurnSnapshot = { turnId: string; status: TurnStatus; messages: Array<Message>; policy: DialoguePolicy; stage: ExperimentStage; revision: number; error?: string };
