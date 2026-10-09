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
 *
 * `options.timeoutMs` lets long-running callers (e.g. report analysis, which
 * is a much bigger reasoning task than a live interview reply) raise the
 * request timeout without changing the default for everyone else.
 */
export function createLlmProvider(options?: { timeoutMs?: number }): LlmProvider {
  const providerName = getLlmProviderName();

  if (providerName === "mock") {
    return createMockProvider();
  }

  const config = getLlmConfig();
  if (options?.timeoutMs !== undefined && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0) {
    return createOminibotProvider({ ...config, timeoutMs: Math.round(options.timeoutMs) });
  }
  return createOminibotProvider(config);
}