export class GatewayError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
  get invalidAccess() { return this.status === 401 || this.status === 403; }
}
