import "server-only";
import { z } from "zod";

/**
 * LiveKit configuration. Server-only: API keys must never reach the browser.
 * The candidate client will receive the room URL and a short-lived token from
 * the backend token endpoint (built in a later phase), not from these values.
 */

const liveKitSchema = z.object({
  url: z.url("LIVEKIT_URL must be a valid WebSocket URL (e.g. wss://... or ws://localhost:7880)"),
  apiKey: z.string().min(1, "LIVEKIT_API_KEY is empty"),
  apiSecret: z.string().min(1, "LIVEKIT_API_SECRET is empty"),
});

export type LiveKitConfig = z.infer<typeof liveKitSchema>;

export function isLiveKitConfigured(): boolean {
  return Boolean(
    process.env.LIVEKIT_URL?.trim() &&
      process.env.LIVEKIT_API_KEY?.trim() &&
      process.env.LIVEKIT_API_SECRET?.trim(),
  );
}

export function getLiveKitConfig(): LiveKitConfig {
  const parsed = liveKitSchema.safeParse({
    url: process.env.LIVEKIT_URL?.trim() ?? "",
    apiKey: process.env.LIVEKIT_API_KEY?.trim() ?? "",
    apiSecret: process.env.LIVEKIT_API_SECRET?.trim() ?? "",
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`)
      .join("; ");
    throw new Error(
      `Invalid LiveKit configuration. Check the LIVEKIT_* variables in .env. Details: ${issues}`,
    );
  }

  return parsed.data;
}
