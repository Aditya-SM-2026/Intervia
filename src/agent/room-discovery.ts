import "server-only";
import { AccessToken } from "livekit-server-sdk";
import { getLiveKitConfig } from "@/lib/livekit/config";
import { ROOM_NAME_PREFIX } from "@/lib/livekit/room";
import { AI_AGENT_IDENTITY } from "@/lib/ai/agent-protocol";

/**
 * Discovery of interview rooms that need the AI agent, via the LiveKit server
 * API (RoomService over HTTP). The worker polls this on an interval instead of
 * relying on job dispatch, which keeps the setup deployment-agnostic.
 */

interface RoomSummary {
  name: string;
  /** LiveKit's Twirp API returns proto3 snake_case JSON. */
  num_participants?: number;
  numParticipants?: number;
}

interface ParticipantSummary {
  identity: string;
}

const REQUEST_TIMEOUT_MS = 10_000;

function serverApiBase(wsUrl: string): string {
  return new URL(wsUrl.replace(/^ws/, "http")).origin;
}

async function serverRequest<T>(path: string, grants: Record<string, unknown>, room?: string): Promise<T> {
  const config = getLiveKitConfig();
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: "interview-agent-worker",
    ttl: 60,
  });
  token.addGrant({ ...grants, ...(room ? { room } : {}) });

  const response = await fetch(`${serverApiBase(config.url)}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await token.toJwt()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(room ? { room } : {}),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`LiveKit server API ${path} failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

/**
 * Returns interview room names that currently have a human participant but no
 * AI agent yet, i.e. rooms the worker should join.
 */
export async function findRoomsNeedingAgent(): Promise<string[]> {
  const { rooms } = await serverRequest<{ rooms: RoomSummary[] }>(
    "/twirp/livekit.RoomService/ListRooms",
    { roomList: true },
  );

  const interviewRooms = rooms.filter((room) => {
    const participantCount = room.num_participants ?? room.numParticipants ?? 0;
    return room.name.startsWith(ROOM_NAME_PREFIX) && participantCount > 0;
  });

  const needingAgent: string[] = [];
  for (const room of interviewRooms) {
    const { participants } = await serverRequest<{ participants: ParticipantSummary[] }>(
      "/twirp/livekit.RoomService/ListParticipants",
      { roomList: true, roomAdmin: true },
      room.name,
    );

    const identities = participants.map((participant) => participant.identity);
    const hasAgent = identities.includes(AI_AGENT_IDENTITY);
    const hasCandidate = identities.some((identity) => identity.startsWith("candidate-"));
    if (hasCandidate && !hasAgent) {
      needingAgent.push(room.name);
    }
  }

  return needingAgent;
}