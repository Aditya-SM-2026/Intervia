import "server-only";
import type { LlmProvider } from "./ai.types";
import { getLlmProviderName, getLlmConfig } from "@/lib/config/env";
import { createOminibotProvider } from "./ominibot-provider";
import { createMockProvider } from "./mock-provider";

/**
 * Single entry point the rest of the app uses to obtain an LLM provider.
 * Provider selection: OMINIBOT_PROVIDER=mock forces the mock; OMINIBOT_PROVIDER=ominibot
 * forces Ominibot; otherwise Ominibot is used when a key is configured, with
 * the mock as a safe fallback during initial setup.
 */
export function createLlmProvider(): LlmProvider {
  const providerName = getLlmProviderName();

  if (providerName === "mock") {
    return createMockProvider();
  }

  return createOminibotProvider(getLlmConfig());
}