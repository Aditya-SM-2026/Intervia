import "server-only";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { InterviewAgentSession } from "./interview-agent-session";
import { findRoomsNeedingAgent } from "./room-discovery";
import { ROOM_NAME_PREFIX } from "@/lib/livekit/room";
import { getLiveKitConfig } from "@/lib/livekit/config";
import { getLlmProviderName } from "@/lib/config/env";
import { getInterviewRepository } from "@/server/repositories";
import { roomIdSchema } from "@/lib/interviews/interview.validation";

/**
 * AI agent worker: a separate long-running process (npm run agent) that joins
 * interview rooms as the AI interviewer participant and drives the
 * conversation. All AI logic and secrets stay in this server process.
 *
 * Discovery is polling-based: every few seconds the worker asks LiveKit for
 * interview rooms that have a candidate but no agent, and joins them. A room
 * whose interview ID is no longer valid (or malformed) is skipped. Before
 * joining, the worker takes an exclusive claim on the interview so that two
 * workers (e.g. a local dev worker and the deployed VM worker, which share
 * the same database) never both join the same room.
 */

const POLL_INTERVAL_MS = 4000;
/** How long a claim holds without the worker renewing it. */
const CLAIM_TTL_SECONDS = 120;

const sessions = new Map<string, InterviewAgentSession>();
const workerId = randomUUID();
let pollBusy = false;

async function pollOnce(): Promise<void> {
  if (pollBusy) return;
  pollBusy = true;

  try {
    const roomNames = await findRoomsNeedingAgent();

    for (const roomName of roomNames) {
      const roomId = roomName.slice(ROOM_NAME_PREFIX.length);
      if (!roomIdSchema.safeParse(roomId).success) continue;
      if (sessions.has(roomId)) continue;

      const claimed = await getInterviewRepository().claimForAgent(roomId, workerId, CLAIM_TTL_SECONDS);
      if (!claimed) continue;

      const session = new InterviewAgentSession(roomId);
      // Keep the claim alive for the whole interview; a lapsed claim would
      // let another worker join the same room during a LiveKit reconnect.
      const renewClaim = setInterval(() => {
        void getInterviewRepository()
          .claimForAgent(roomId, workerId, CLAIM_TTL_SECONDS)
          .catch(() => {});
      }, 45_000);
      session.onEnded = async () => {
        clearInterval(renewClaim);
        sessions.delete(roomId);
        try {
          await getInterviewRepository().releaseAgentClaim(roomId, workerId);
        } catch (error) {
          console.error(`[worker] could not release claim for ${roomId}: ${describeError(error)}`);
        }
      };
      try {
        await session.start();
        sessions.set(roomId, session);
      } catch (error) {
        console.error(`[worker] could not join interview ${roomId}: ${describeError(error)}`);
        clearInterval(renewClaim);
        sessions.delete(roomId);
        try {
          await getInterviewRepository().releaseAgentClaim(roomId, workerId);
        } catch {
          // Claim expires via TTL anyway.
        }
        await session.stop();
      }
    }
  } catch (error) {
    console.error(`[worker] discovery poll failed: ${describeError(error)}`);
  } finally {
    pollBusy = false;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  // next dev loads .env automatically; the standalone worker must do it itself.
  // Missing file is fine in production deployments that inject real env vars.
  try {
    process.loadEnvFile(".env");
  } catch {
    // No .env file — rely on the actual process environment.
  }

  const liveKit = getLiveKitConfig();
  const providerName = getLlmProviderName();

  console.log(`[worker] AI agent worker starting (LLM provider: ${providerName})`);
  console.log(`[worker] LiveKit host: ${new URL(liveKit.url.replace(/^ws/, "http")).host}`);

  if (providerName === "mock") {
    console.log("[worker] Running with the MOCK provider — replies are canned. Set OMINIBOT_API_KEY for real replies.");
  }

  const interval = setInterval(() => void pollOnce(), POLL_INTERVAL_MS);
  if ((process.env.AGENT_ENABLED ?? "").trim().toLowerCase() === "false") {
    // Voice provider is not the room agent (e.g. Gemini Live talks to the
    // candidate directly): keep the health endpoint but never join rooms.
    clearInterval(interval);
    console.log("[worker] AGENT_ENABLED=false — idling, will not join any rooms");
  }
  void pollOnce();

  // Health endpoint: Cloud Run probes the container port. The worker itself
  // only joins rooms, so this serves nothing but a readiness response.
  const healthPort = Number(process.env.PORT ?? 8080);
  const healthServer = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end(`ok sessions=${sessions.size}`);
  });
  healthServer.listen(healthPort, () => {
    console.log(`[worker] health endpoint listening on ${healthPort}`);
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      console.log(`[worker] received ${signal}, stopping ${sessions.size} session(s)`);
      clearInterval(interval);
      healthServer.close();
      for (const session of sessions.values()) {
        void session.stop();
      }
      setTimeout(() => process.exit(0), 1500).unref();
    });
  }
}

main().catch((error) => {
  console.error(`[worker] fatal: ${describeError(error)}`);
  process.exit(1);
});