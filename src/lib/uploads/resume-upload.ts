/**
 * Pure helpers for the candidate resume-upload link. No I/O here so the
 * rules stay unit-testable; the route wires these to storage and the repo.
 */
import type { InterviewRoom } from "@/lib/interviews/interview.types";

/** The upload link expires this long after the interview was created. */
export const UPLOAD_LINK_TTL_MS = 24 * 60 * 60_000;
/** Scheduled interviews stay uploadable until one hour after the start time. */
export const UPLOAD_GRACE_AFTER_START_MS = 60 * 60_000;
export const MAX_RESUME_UPLOAD_BYTES = 10 * 1024 * 1024;

export const RESUME_UPLOAD_EXTENSIONS = [".pdf", ".doc", ".docx"] as const;

export type ResumeUploadFileKind = "pdf" | "doc" | "docx";

export function generateUploadToken(): string {
  return randomToken(32);
}

function randomToken(bytes: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  const values = new Uint8Array(bytes);
  // lazily imported to keep this module usable outside Next's node runtime
  const crypto = globalThis.crypto;
  crypto.getRandomValues(values);
  for (const value of values) out += alphabet[value % alphabet.length];
  return out;
}

/** When the upload link stops working for this room. */
export function uploadLinkExpiresAt(room: Pick<InterviewRoom, "createdAt" | "scheduledAt">): string {
  const created = Date.parse(room.createdAt);
  const scheduled = room.scheduledAt ? Date.parse(room.scheduledAt) : Number.POSITIVE_INFINITY;
  return new Date(
    Math.min(created + UPLOAD_LINK_TTL_MS, scheduled + UPLOAD_GRACE_AFTER_START_MS),
  ).toISOString();
}

export interface UploadLinkRoom {
  createdAt: string;
  scheduledAt: string | null;
  uploadUsedAt?: string | null;
}

export function isUploadLinkValid(room: UploadLinkRoom, now = Date.now()): boolean {
  if (room.uploadUsedAt) return false;
  return now < Date.parse(uploadLinkExpiresAt(room));
}

export type ResumeUploadValidation =
  | { ok: true; kind: ResumeUploadFileKind; fileName: string }
  | { ok: false; reason: "empty" | "too_large" | "unsupported_type" };

/** Accepts PDF and Word documents by extension (mime types vary by browser). */
export function validateResumeUpload(file: { name: string; size: number }): ResumeUploadValidation {
  if (file.size === 0) return { ok: false, reason: "empty" };
  if (file.size > MAX_RESUME_UPLOAD_BYTES) return { ok: false, reason: "too_large" };
  const name = file.name.toLowerCase();
  const ext = RESUME_UPLOAD_EXTENSIONS.find((candidate) => name.endsWith(candidate));
  if (!ext) return { ok: false, reason: "unsupported_type" };
  return { ok: true, kind: ext.slice(1) as ResumeUploadFileKind, fileName: file.name };
}