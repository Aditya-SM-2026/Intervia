import "server-only";
import { randomBytes } from "node:crypto";
import type {
  CreateInterviewInput,
  DashboardListFilter,
  HumanDecision,
  InterviewApiError,
  InterviewRepository,
  InterviewRoom,
  InterviewStatus,
  SessionOutcome,
} from "./interview.types";
import { DuplicateInterviewError } from "./interview-errors";
import { generateUploadToken } from "@/lib/uploads/resume-upload";
import { generateInterviewPlan } from "./plan.service";
import type { DashboardInterviewSummary } from "./scorecard.types";
import { getInterviewRepository } from "@/server/repositories";

const MS_PER_MINUTE = 60_000;
// The interview length is enforced by the agent's controller; the link itself
// stays joinable for three days so the candidate can pick a time.
const LINK_VALIDITY_HOURS = 72;
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

/**
 * Resolves the recruiter's date + time selection to an ISO 8601 instant.
 * Interpreted in the server's local timezone (the scheduler's timezone) and
 * stored as UTC. Empty selections mean the link may be used immediately.
 */
export function resolveScheduledAt(
  scheduledDate?: string,
  scheduledTime?: string,
): { value: string | null; error?: string } {
  if (!scheduledDate && !scheduledTime) return { value: null };
  if (!scheduledDate) return { value: null, error: "Provide an interview date together with a time." };
  const time = scheduledTime || "09:00";
  const moment = new Date(`${scheduledDate}T${time}:00`);
  if (Number.isNaN(moment.getTime())) {
    return { value: null, error: "The interview date and time are not a valid moment." };
  }
  if (moment.getTime() < Date.now() + 60_000) {
    return { value: null, error: "Schedule the interview for a future date and time." };
  }
  if (moment.getTime() > Date.now() + 366 * 24 * 60 * 60_000) {
    return { value: null, error: "Schedule the interview less than a year ahead." };
  }
  return { value: moment.toISOString() };
}

/**
 * An accidental re-submit (double click, retry after a timeout) must not
 * create a second interview for the same candidate, role and moment. Returns
 * the earlier interview when an open duplicate exists.
 */
export async function findDuplicateInterview(
  input: Pick<CreateInterviewInput, "candidateEmail" | "roleTitle">,
  scheduledAt: string | null,
): Promise<InterviewRoom | null> {
  const repository = getInterviewRepository();
  const existing = await repository.list({ email: input.candidateEmail });
  return (
    existing.find(
      (room) =>
        room.status === "scheduled" &&
        room.completedAt === null &&
        room.roleTitle?.toLowerCase() === input.roleTitle.toLowerCase() &&
        room.scheduledAt === scheduledAt,
    ) ?? null
  );
}

export async function createInterviewRoom(input: CreateInterviewInput): Promise<InterviewRoom> {
  const repository = getInterviewRepository();
  const id = await generateUnusedRoomId(repository);
  const duplicate = await findDuplicateInterview(input, input.scheduledAt ?? null);
  if (duplicate) throw new DuplicateInterviewError(duplicate);
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + LINK_VALIDITY_HOURS * 60 * MS_PER_MINUTE).toISOString();

  // The plan is fixed before the candidate ever joins: it is what makes the
  // interview structured and the scorecard comparable across candidates.
  const plan = await generateInterviewPlan({
    roleTitle: input.roleTitle,
    durationMinutes: input.durationMinutes,
    difficulty: input.difficulty,
    jobDescription: input.jobDescription,
    resume: input.resume,
  });

  const room: InterviewRoom = {
    id,
    title: input.title || input.roleTitle,
    candidateName: input.candidateName,
    status: "scheduled",
    createdAt,
    expiresAt,
    recruiterName: input.recruiterName,
    scheduledAt: input.scheduledAt ?? null,
    reminderSentAt: null,
    uploadToken: generateUploadToken(),
    uploadUsedAt: null,
    candidateEmail: input.candidateEmail,
    roleTitle: input.roleTitle,
    roleId: input.roleId ?? null,
    difficulty: input.difficulty,
    durationMinutes: input.durationMinutes,
    voiceMode: input.voiceMode,
    jobDescription: input.jobDescription,
    resume: input.resume,
    consent: null,
    completedAt: null,
    plan,
    outcome: null,
    decision: null,
  };

  // The atomic insert closes the race where two identical creations pass the
  // pre-check above at the same moment and both go on to insert.
  const outcome = await repository.insertRoomAtomically(room, duplicateKeyFor(room));
  if (!outcome.created) throw new DuplicateInterviewError(outcome.existing);
  return room;
}

/** Identity of an interview slot: candidate + role + scheduled moment. */
function duplicateKeyFor(room: Pick<InterviewRoom, "candidateEmail" | "roleTitle" | "scheduledAt">): string {
  return `dup:${room.candidateEmail?.toLowerCase()}|${room.roleTitle?.toLowerCase()}|${room.scheduledAt ?? "now"}`;
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
 * Records how the live interview ended (written by the agent worker). The
 * session is marked completed unless the agent reports an early drop, in
 * which case the link stays usable. Terminal states are never overwritten.
 */
export async function recordSessionOutcome(
  roomId: string,
  outcome: SessionOutcome,
  completed: boolean,
): Promise<InterviewRoom | null> {
  const repository = getInterviewRepository();
  const room = await repository.get(roomId);
  if (!room) return null;
  if (room.status === "expired" || room.status === "cancelled") return room;

  const updated: InterviewRoom = completed
    ? { ...room, outcome, status: "completed", completedAt: outcome.endedAt }
    : { ...room, outcome };
  await repository.save(updated);
  return updated;
}

/** Stores the recruiter's hiring decision for an interview. */
export async function recordDecision(
  roomId: string,
  decision: HumanDecision,
): Promise<InterviewRoom | null> {
  const repository = getInterviewRepository();
  const room = await repository.get(roomId);
  if (!room) return null;
  const updated: InterviewRoom = { ...room, decision };
  await repository.save(updated);
  return updated;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Sessions for the recruiter dashboard, newest first, each with its scorecard
 * summary when one exists. Expiry is applied for display only (no writes).
 * Heavy fields the list does not show are stripped from the payload.
 */
export async function listDashboardInterviews(
  filter?: DashboardListFilter,
): Promise<DashboardInterviewSummary[]> {
  const repository = getInterviewRepository();
  const rooms = await repository.list(filter);
  const summaries = await repository.getScorecardSummaries(rooms.map((room) => room.id));

  return rooms.map((room) => ({
    room: {
      ...room,
      status: displayStatus(room),
      jobDescription: null,
      // Light resume marker so lists can show "resume received" without
      // shipping the extracted resume text to every list call.
      resume: room.resume
        ? { fileName: room.resume.fileName, text: "", ...(room.resume.unreadable ? { unreadable: true } : {}) }
        : null,
      plan: null,
      // The upload token is a credential; summaries must not carry it.
      uploadToken: null,
    },
    scorecard: summaries.get(room.id) ?? null,
  }));
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