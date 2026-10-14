import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/** Where uploaded resume files are stored (env UPLOADS_DIR, default .data/uploads). */
function uploadsDir(): string {
  return process.env.UPLOADS_DIR?.trim() || path.join(".data", "uploads");
}

export interface StoredResumeFile {
  /** Absolute path of the stored file. */
  filePath: string;
  bytes: number;
}

/**
 * Stores a candidate-uploaded resume on disk under a per-interview folder.
 * The original file is kept for the recruiter; only the extracted text goes
 * into the interview record.
 */
export async function storeResumeFile(
  roomId: string,
  kind: "pdf" | "doc" | "docx",
  data: Buffer,
): Promise<StoredResumeFile> {
  const dir = path.join(uploadsDir(), roomId);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `candidate-resume-${Date.now()}.${kind}`);
  await writeFile(filePath, data);
  return { filePath, bytes: data.byteLength };
}