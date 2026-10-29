import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { uploadStoredObject } from "@/lib/storage/gcs";
import type { ResumeUploadFileKind } from "@/lib/uploads/resume-upload";

/** Where uploaded resume files are stored (env UPLOADS_DIR, default .data/uploads). */
function uploadsDir(): string {
  return process.env.UPLOADS_DIR?.trim() || path.join(".data", "uploads");
}

const MIME_TYPES: Record<ResumeUploadFileKind, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export interface StoredResumeFile {
  /** Absolute path of the stored file on this instance. */
  filePath: string;
  bytes: number;
  /**
   * Path of the durable copy in the recordings bucket. Null when storage is
   * not configured or the upload failed; the interview still works.
   */
  objectPath: string | null;
}

/**
 * Stores a candidate resume: on disk for this instance, and in the recordings
 * bucket so the recruiter can open the original later (the web container's
 * disk does not survive a deploy). Only the extracted text goes into the
 * interview record itself.
 */
export async function storeResumeFile(
  roomId: string,
  kind: ResumeUploadFileKind,
  data: Buffer,
  fileName: string,
): Promise<StoredResumeFile> {
  const dir = path.join(uploadsDir(), roomId);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `candidate-resume-${Date.now()}.${kind}`);
  await writeFile(filePath, data);

  const bucket = process.env.RECORDINGS_GCS_BUCKET?.trim();
  let objectPath: string | null = null;
  if (bucket) {
    const safeName = fileName.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80) || `resume.${kind}`;
    const candidatePath = `resumes/${roomId}/${Date.now()}-${safeName}`;
    try {
      const uploaded = await uploadStoredObject(
        { bucket, path: candidatePath },
        new Uint8Array(data),
        MIME_TYPES[kind],
      );
      if (uploaded) objectPath = candidatePath;
    } catch {
      // The original is a convenience; never fail the upload because of it.
    }
  }

  return { filePath, bytes: data.byteLength, objectPath };
}

/** The MIME type a stored resume is served with, from its file name. */
export function resumeMimeType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return MIME_TYPES.pdf;
  if (lower.endsWith(".docx")) return MIME_TYPES.docx;
  if (lower.endsWith(".doc")) return MIME_TYPES.doc;
  return "application/octet-stream";
}
