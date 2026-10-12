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
}

/** Must match AGENT_NAME in agent/intervia_agent/config.py. */
export const AGENT_NAME = "intervia-interviewer";

/** Longer than the agent's own rejoin grace (CANDIDATE_REJOIN_GRACE_SECONDS). */
const CANDIDATE_REJOIN_WINDOW_SECONDS = 60;

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
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  if (dispatchInterviewId) {
    token.roomConfig = new RoomConfiguration({
      // Keeps the room (and the interviewer) for a minute after the candidate
      // drops, so a reload or a network blip can rejoin the same interview.
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