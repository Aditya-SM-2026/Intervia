import type { AiMessage, LlmProvider, ProviderResponse } from "./ai.types";

function lastUserMessage(messages: readonly AiMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") return messages[i].content;
  }
  return null;
}

/**
 * Deterministic provider for local development and testing before the real
 * Ominibot API key is available. It never performs network calls.
 */
export function createMockProvider(): LlmProvider {
  return {
    name: "mock",

    async generateReply(messages) {
      const userText = lastUserMessage(messages)?.trim();

      if (!userText) {
        const response: ProviderResponse = {
          text: "Hello, and thank you for joining. Please tell me a little about yourself.",
          provider: "mock",
        };
        return response;
      }

      const response: ProviderResponse = {
        text: `You said: "${userText}". Can you tell me more about that?`,
        provider: "mock",
      };
      return response;
    },
  };
}