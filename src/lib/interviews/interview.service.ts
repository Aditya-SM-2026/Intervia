import "server-only";
import { randomBytes } from "node:crypto";
import type {
  CreateInterviewInput,
  DashboardAnalytics,
  DashboardListFilter,
  InterviewApiError,
  InterviewRepository,
  InterviewRoom,
  InterviewStatus,
} from "./interview.types";
import type { DashboardInterviewSummary } from "./report.types";
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

/**
 * Sessions for the recruiter dashboard, newest first, each with the report's
 * integrity summary when a report exists. Expiry is applied for display only
 * (no writes) so listing never mutates rooms. Supports the email filter and
 * pagination from the dashboard UI.
 */
export async function listDashboardInterviews(
  filter?: DashboardListFilter,
): Promise<DashboardInterviewSummary[]> {
  const repository = getInterviewRepository();
  const rooms = await repository.list(filter);
  const roomIds = rooms.map((room) => room.id);
  const [integrity, turnCounts] = await Promise.all([
    repository.getReportIntegrity(roomIds),
    repository.getCandidateTurnCounts(roomIds),
  ]);

  return rooms.map((room) => ({
    room: { ...room, status: displayStatus(room) },
    integrity: integrity.get(room.id) ?? null,
    candidateTurns: turnCounts.get(room.id) ?? 0,
  }));
}

/**
 * Permanently removes a session with its transcript and report. Intended for
 * the recruiter dashboard's delete action. Returns false when the room id is
 * unknown.
 */
export async function deleteInterviewSession(roomId: string): Promise<boolean> {
  const repository = getInterviewRepository();
  return repository.deleteInterview(roomId);
}

export interface BulkDeleteResult {
  /** Room ids that were deleted. */
  deleted: string[];
  /** Per-id failures with a recruiter-facing reason. */
  failed: { roomId: string; error: string }[];
}

/**
 * Bulk delete for the dashboard's multi-select. Each id is deleted through
 * the same transactional single-delete path, so one failure never blocks the
 * others and the caller can report exactly which rooms survived.
 */
export async function deleteInterviewSessions(roomIds: readonly string[]): Promise<BulkDeleteResult> {
  const repository = getInterviewRepository();
  const deleted: string[] = [];
  const failed: { roomId: string; error: string }[] = [];

  for (const roomId of roomIds) {
    try {
      if (await repository.deleteInterview(roomId)) {
        deleted.push(roomId);
      } else {
        failed.push({ roomId, error: "Interview not found (it may already have been deleted)." });
      }
    } catch (cause) {
      failed.push({
        roomId,
        error: cause instanceof Error ? cause.message.slice(0, 200) : "Deletion failed.",
      });
    }
  }
  return { deleted, failed };
}

/**
 * Total rooms matching the same filter — the pagination denominator for the
 * dashboard list.
 */
export async function countDashboardInterviews(filter?: DashboardListFilter): Promise<number> {
  const repository = getInterviewRepository();
  return repository.count(filter);
}

/**
 * Real-data analytics for the dashboard cards, bell and sparklines. Computed
 * in the repository so the semantics live next to the storage they query.
 */
export async function getDashboardAnalytics(): Promise<DashboardAnalytics> {
  const repository = getInterviewRepository();
  return repository.getDashboardAnalytics();
}

/** Expiry shown lazily for display; the stored row is not rewritten here. */
function displayStatus(room: InterviewRoom): InterviewStatus {
  return isExpired(room) ? "expired" : room.status;
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