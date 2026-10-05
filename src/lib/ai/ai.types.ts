/** Roles in a conversation with the LLM (OpenAI-compatible message roles). */
export type AiMessageRole = "system" | "user" | "assistant";

export interface AiMessage {
  role: AiMessageRole;
  content: string;
}

export type LlmProviderName = "ominibot" | "mock";

/** Normalized reply returned by every LLM provider implementation. */
export interface ProviderResponse {
  text: string;
  provider: LlmProviderName;
  /** Model identifier as reported by the provider, when known. */
  model?: string;
}

/**
 * Boundary every LLM provider must implement. The rest of the app talks only
 * to this interface, so switching providers never touches call sites.
 */
export interface LlmProvider {
  readonly name: LlmProviderName;
  generateReply(messages: readonly AiMessage[]): Promise<ProviderResponse>;
}