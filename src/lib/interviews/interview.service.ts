import "server-only";
import { randomBytes } from "node:crypto";
import type {
  CreateInterviewInput,
  InterviewApiError,
  InterviewRepository,
  InterviewRoom,
  InterviewStatus,
} from "./interview.types";
import { getInterviewRepository } from "@/server/repositories/in-memory-interview-repository";

const MS_PER_MINUTE = 60_000;
// 16 random bytes → 22 URL-safe base64 characters, well above the minimum
// length the room ID validation pattern requires.
const ROOM_ID_RANDOM_BYTES = 16;

/** Error codes `validateRoomAccess` can produce (INVALID_INPUT never applies to lookups). */
export type RoomAccessErrorCode = Exclude<
  InterviewApiError["error"]["code"],
  "INVALID_INPUT"
>;

export type RoomAccessResult =
  | { ok: true; room: InterviewRoom }
  | { ok: false; code: RoomAccessErrorCode; message: string };

export function generateRoomId(): string {
  return randomBytes(ROOM_ID_RANDOM_BYTES).toString("base64url");
}

export async function createInterviewRoom(input: CreateInterviewInput): Promise<InterviewRoom> {
  const repository = getInterviewRepository();
  const id = await generateUnusedRoomId(repository);
  const createdAt = new Date().toISOString();
  const expiresAt = input.durationMinutes
    ? new Date(Date.now() + input.durationMinutes * MS_PER_MINUTE).toISOString()
    : null;

  const room: InterviewRoom = {
    id,
    title: input.title,
    candidateName: input.candidateName ?? null,
    status: "scheduled",
    createdAt,
    expiresAt,
  };

  await repository.save(room);
  return room;
}

export async function getInterviewRoom(roomId: string): Promise<InterviewRoom | null> {
  const repository = getInterviewRepository();
  return applyExpiry(repository, roomId);
}

/**
 * Determines whether a candidate may open a room, returning a user-facing
 * reason when they may not. Expiry is applied lazily on read (in-memory
 * storage has no timers).
 */
export async function validateRoomAccess(roomId: string): Promise<RoomAccessResult> {
  const room = await getInterviewRoom(roomId);

  if (!room) {
    return {
      ok: false,
      code: "ROOM_NOT_FOUND",
      message: "This interview link does not exist. Please ask your recruiter for a new link.",
    };
  }
  if (room.status === "expired") {
    return {
      ok: false,
      code: "ROOM_EXPIRED",
      message: "This interview link has expired. Please ask your recruiter for a new link.",
    };
  }
  if (room.status === "completed" || room.status === "cancelled") {
    return {
      ok: false,
      code: "ROOM_UNAVAILABLE",
      message: "This interview is no longer available.",
    };
  }

  return { ok: true, room };
}

/**
 * Marks a room `active` once join credentials are issued for it. Silently
 * ignores unknown rooms (access validation already reported them).
 */
export async function activateRoom(roomId: string): Promise<void> {
  const repository = getInterviewRepository();
  const room = await applyExpiry(repository, roomId);

  if (room && isActiveStatus(room.status) && room.status !== "active") {
    await repository.save({ ...room, status: "active" });
  }
}

async function generateUnusedRoomId(repository: InterviewRepository): Promise<string> {
  let id = generateRoomId();
  while ((await repository.get(id)) !== null) {
    id = generateRoomId();
  }
  return id;
}

async function applyExpiry(repository: InterviewRepository, roomId: string): Promise<InterviewRoom | null> {
  const room = await repository.get(roomId);
  if (!room) return null;

  if (isActiveStatus(room.status) && isExpired(room)) {
    const expiredRoom: InterviewRoom = { ...room, status: "expired" };
    await repository.save(expiredRoom);
    return expiredRoom;
  }
  return room;
}

function isExpired(room: InterviewRoom): boolean {
  return room.expiresAt !== null && Date.now() > Date.parse(room.expiresAt);
}

function isActiveStatus(status: InterviewStatus): boolean {
  return status === "scheduled" || status === "waiting" || status === "active";
}