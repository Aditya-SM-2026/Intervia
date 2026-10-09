import "server-only";
import { randomBytes } from "node:crypto";
import type {
  CreateInterviewInput,
  InterviewApiError,
  InterviewRepository,
  InterviewRoom,
  InterviewStatus,
} from "./interview.types";
import { getInterviewRepository } from "@/server/repositories";

const MS_PER_MINUTE = 60_000;
// The interview length (5-10 min) is enforced by the agent session; the link
// itself stays joinable for a day so candidates are not blocked by short
// durations between creation and joining.
const LINK_VALIDITY_HOURS = 24;
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
  const expiresAt = new Date(Date.now() + LINK_VALIDITY_HOURS * 60 * MS_PER_MINUTE).toISOString();

  const room: InterviewRoom = {
    id,
    title: input.title || input.roleTitle,
    candidateName: input.candidateName,
    status: "scheduled",
    createdAt,
    expiresAt,
    recruiterName: input.recruiterName,
    candidateEmail: input.candidateEmail,
    roleTitle: input.roleTitle,
    difficulty: input.difficulty,
    durationMinutes: input.durationMinutes,
    jobDescription: input.jobDescription,
    resume: input.resume,
    consent: null,
    completedAt: null,
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

export type EmailVerifyResult =
  | { ok: true; room: InterviewRoom }
  | { ok: false; code: RoomAccessErrorCode | "EMAIL_MISMATCH"; message: string };

/**
 * Email gate: checks the candidate's email against the session, and on
 * success records consent. Sessions created before the gate (no email on
 * file) skip the match but still record consent.
 */
export async function verifyCandidateEmail(
  roomId: string,
  email: string,
  consentedAt: string,
): Promise<EmailVerifyResult> {
  const repository = getInterviewRepository();
  const room = await applyExpiry(repository, roomId);

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

  if (room.candidateEmail && normalizeEmail(room.candidateEmail) !== normalizeEmail(email)) {
    return {
      ok: false,
      code: "EMAIL_MISMATCH",
      message: "This email does not match the one registered for this interview link.",
    };
  }

  await repository.save({ ...room, consent: { givenAt: consentedAt } });
  return { ok: true, room };
}

/**
 * Marks a finished session completed (status + completedAt). Terminal states
 * (expired/cancelled/completed) are never overwritten.
 */
export async function completeSession(roomId: string): Promise<void> {
  const repository = getInterviewRepository();
  const room = await repository.get(roomId);
  if (!room || room.status === "completed") return;

  if (room.status === "expired" || room.status === "cancelled") return;
  await repository.save({
    ...room,
    status: "completed",
    completedAt: new Date().toISOString(),
  });
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
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