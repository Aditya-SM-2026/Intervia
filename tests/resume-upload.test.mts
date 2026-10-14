/**
 * Unit tests for the candidate resume-upload link rules and file storage.
 * Storage writes go to a temp dir via UPLOADS_DIR; no database is touched.
 *
 * Run: npx tsx tests/resume-upload.test.mts
 */
import {
  generateUploadToken,
  isUploadLinkValid,
  uploadLinkExpiresAt,
  validateResumeUpload,
  MAX_RESUME_UPLOAD_BYTES,
} from "../src/lib/uploads/resume-upload.ts";
import { storeResumeFile } from "../src/lib/uploads/resume-storage.ts";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let passed = 0;
let total = 0;
function check(name: string, ok: boolean, extra = "") {
  total++;
  if (ok) { passed++; console.log(`PASS ${name}`); }
  else console.log(`FAIL ${name} ${extra}`);
}

// --- token generation
const t1 = generateUploadToken();
const t2 = generateUploadToken();
check("token is 32 lowercase alphanumeric", /^[a-z0-9]{32}$/.test(t1), t1);
check("tokens are unique", t1 !== t2);

// --- expiry rules
const now = Date.now();
const unscheduled = { createdAt: new Date(now - 60_000).toISOString(), scheduledAt: null };
check("unscheduled: valid now", isUploadLinkValid(unscheduled, now));
check("unscheduled: expires ~24h after creation", Math.abs(Date.parse(uploadLinkExpiresAt(unscheduled)) - (now - 60_000 + 24 * 3600_000)) < 1000);
check("unscheduled: invalid after 24h", !isUploadLinkValid(unscheduled, now + 24 * 3600_000));

const scheduled = {
  createdAt: new Date(now - 12 * 3600_000).toISOString(),
  scheduledAt: new Date(now + 2 * 3600_000).toISOString(),
};
check("scheduled: valid until start+1h", isUploadLinkValid(scheduled, now));
check("scheduled: expires 1h after start (not 24h after creation)", Math.abs(Date.parse(uploadLinkExpiresAt(scheduled)) - (now + 3 * 3600_000)) < 1000);
check("scheduled: invalid after start+1h", !isUploadLinkValid(scheduled, now + 3 * 3600_000 + 1000));

const farOut = {
  createdAt: new Date(now).toISOString(),
  scheduledAt: new Date(now + 10 * 24 * 3600_000).toISOString(),
};
check("far-out schedule capped by 24h TTL", Math.abs(Date.parse(uploadLinkExpiresAt(farOut)) - (now + 24 * 3600_000)) < 1000);

check("used link invalid", !isUploadLinkValid({ ...unscheduled, uploadUsedAt: new Date(now).toISOString() }, now));

// --- file validation
check("accepts pdf", validateResumeUpload({ name: "Aditya_Rao.pdf", size: 1024 }).ok === true);
check("accepts doc", validateResumeUpload({ name: "resume.DOC", size: 1024 }).ok === true);
check("accepts docx", validateResumeUpload({ name: "r.docx", size: 1024 }).ok === true);
check("rejects txt", validateResumeUpload({ name: "notes.txt", size: 1024 }).ok === false);
check("rejects exe", validateResumeUpload({ name: "evil.exe", size: 1024 }).ok === false);
check("rejects empty", (validateResumeUpload({ name: "a.pdf", size: 0 }) as { reason?: string }).reason === "empty");
check("rejects oversize", (validateResumeUpload({ name: "a.pdf", size: MAX_RESUME_UPLOAD_BYTES + 1 }) as { reason?: string }).reason === "too_large");
check("pdf kind detected", (validateResumeUpload({ name: "a.pdf", size: 1 }) as { kind?: string }).kind === "pdf");

// --- storage writes to UPLOADS_DIR
const savedDir = process.env.UPLOADS_DIR;
process.env.UPLOADS_DIR = await mkdtemp(path.join(tmpdir(), "intervia-uploads-"));
try {
  const payload = Buffer.from("%PDF-1.4 fake resume bytes");
  const stored = await storeResumeFile("room-upload-test", "pdf", payload);
  const written = await readFile(stored.filePath);
  check("file stored under room folder", stored.filePath.includes(path.join("room-upload-test")) && written.equals(payload));
  check("stored byte count matches", stored.bytes === payload.byteLength);
} finally {
  process.env.UPLOADS_DIR = savedDir;
  await rm(process.env.UPLOADS_DIR ?? path.join(tmpdir(), "intervia-uploads-does-not-exist"), { recursive: true, force: true });
}

console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);