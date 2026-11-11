import "server-only";
import { AccessToken, RoomAgentDispatch, RoomConfiguration } from "livekit-server-sdk";
import { getLiveKitConfig } from "./config";

export interface LiveKitTokenParams {
  roomName: string;
  identity: string;
  displayName?: string;
  /**
   * When set, joining with this token creates the room with the interviewer
   * agent dispatched to it for this interview (explicit dispatch: no polling).
   */
  dispatchInterviewId?: string;
  /** HR joins to listen and speak; the agent still only hears the candidate. */
  canPublish?: boolean;
}

/**
 * Must match the agent worker's AGENT_NAME (agent/intervia_agent/config.py).
 * Read from the environment so a second stack in the same LiveKit project
 * dispatches only its own worker.
 */
export const AGENT_NAME = process.env.AGENT_NAME?.trim() || "intervia-interviewer";

/** Matches the agent's CANDIDATE_REJOIN_GRACE_SECONDS (5 minutes). */
const CANDIDATE_REJOIN_WINDOW_SECONDS = 300;

/**
 * Token lifetime. Short-lived on purpose: it covers the longest interview
 * (45 minutes) and its reconnection window, but never days.
 */
const TOKEN_TTL_MINUTES = 120;

export interface LiveKitToken {
  token: string;
  url: string;
}

export async function generateLiveKitToken({
  roomName,
  identity,
  displayName,
  dispatchInterviewId,
  canPublish = true,
}: LiveKitTokenParams): Promise<LiveKitToken> {
  const config = getLiveKitConfig();

  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity,
    name: displayName,
    ttl: TOKEN_TTL_MINUTES * 60,
  });
  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish,
    canSubscribe: true,
    canPublishData: true,
  });
  if (dispatchInterviewId) {
    token.roomConfig = new RoomConfiguration({
      // Keeps the room (and the interviewer) available for 5 minutes after
      // the candidate drops, so they can rejoin and resume the same interview.
      departureTimeout: CANDIDATE_REJOIN_WINDOW_SECONDS,
      agents: [
        new RoomAgentDispatch({
          agentName: AGENT_NAME,
          metadata: JSON.stringify({ interviewId: dispatchInterviewId }),
        }),
      ],
    });
  }

  return { token: await token.toJwt(), url: config.url };
}