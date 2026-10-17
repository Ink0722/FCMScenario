import type { ExperimentGateway } from './contracts';

// Reserved integration point. Deliberately no guessed URLs, credentials, or
// network writes. Wire an implementation after the backend contract is agreed.
export function createHttpGateway(): ExperimentGateway {
  throw new Error('The HTTP gateway has not been configured.');
}
