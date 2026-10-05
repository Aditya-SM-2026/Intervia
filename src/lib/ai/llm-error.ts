/** Error thrown when an LLM provider call fails, with a safe (non-secret) message. */
export class LlmError extends Error {
  readonly status?: number;

  constructor(message: string, options?: { status?: number; cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "LlmError";
    this.status = options?.status;
  }
}