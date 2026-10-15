import type { ExperimentGateway } from './contracts';

// Reserved integration point. Deliberately no guessed URLs, credentials, or
// network writes. Wire an implementation after the backend contract is agreed.
export function createHttpGateway(): ExperimentGateway {
  throw new Error('真实后端尚未接入；当前使用模拟服务。');
}
