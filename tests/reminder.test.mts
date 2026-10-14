/**
 * Integration test for the 30-minute reminder pipeline.
 *
 * Email building/sending is tested with a fake transport. The claim SQL is
 * run directly against the real schema (the repository method is a thin
 * wrapper around the same statement; repo modules carry `server-only` and
 * cannot be imported from a plain node process).
 *
 * Run: DATABASE_URL=$(grep '^DATABASE_URL=' .env | cut -d= -f2-) npx tsx tests/reminder.test.mts
 * All test rows use the "reminder-test-" id prefix and are deleted after.
 */
import { buildReminderEmail, sendInterviewReminder } from "../src/lib/emails/email.service.ts";
import type { InvitationEmailInput } from "../src/lib/emails/email.service.ts";
import { Client } from "pg";
import type { Transporter } from "nodemailer";

let passed = 0;
let total = 0;
function check(name: string, ok: boolean, extra = "") {
  total++;
  if (ok) { passed++; console.log(`PASS ${name}`); }
  else console.log(`FAIL ${name} ${extra}`);
}

const input: InvitationEmailInput = {
  to: "candidate@example.com",
  candidateName: "Aditya Rao",
  roleTitle: "Backend Engineer",
  recruiterName: "Priya Sharma",
  candidateUrl: "https://intervia.ai/interview/room-1",
  scheduledAt: "2026-10-20T10:00:00.000Z",
  expiresAt: null,
  durationMinutes: 15,
};

// --- reminder email content
const msg = buildReminderEmail(input, 30);
check("subject says minutes", msg.subject.includes("starts in about 30 minutes"), msg.subject);
check("html has link", msg.html.includes("https://intervia.ai/interview/room-1"));
check("html has scheduled time", /20\s+October,?\s+2026/.test(msg.html));
check("html has checklist", msg.html.includes("camera and microphone"));

// --- send paths with fake transports (never real SMTP)
const sent: { to: string; subject: string }[] = [];
const fakeTransport = {
  sendMail: async (m: { to: string; subject: string }) => { sent.push(m); },
} as unknown as Transporter;
const reminder = await sendInterviewReminder(input, 30, fakeTransport);
check("reminder sent status", reminder.status === "sent", JSON.stringify(reminder));
check("reminder captured", sent.length === 1 && sent[0].to === "candidate@example.com");
const failTransport = { sendMail: async () => { throw new Error("boom"); } } as unknown as Transporter;
const failed = await sendInterviewReminder(input, 30, failTransport);
check("reminder failure isolated", failed.status === "failed", JSON.stringify(failed));
check("immediate interview has no reminder", (await sendInterviewReminder({ ...input, scheduledAt: null }, 30, fakeTransport)).detail === "Interview has no scheduled time");

// --- claim SQL against the real schema
function isoInMinutes(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

const envUrl = process.env.DATABASE_URL;
if (!envUrl) {
  console.error("DATABASE_URL is required for the claim tests");
  process.exit(1);
}
const client = new Client({ connectionString: envUrl });
await client.connect();

const ids = {
  due: `reminder-test-due-${Date.now()}`,
  far: `reminder-test-far-${Date.now()}`,
  past: `reminder-test-past-${Date.now()}`,
  noSched: `reminder-test-nosched-${Date.now()}`,
  active: `reminder-test-active-${Date.now()}`,
};
const allIds = Object.values(ids);
try {
  for (const [id, scheduledAt, status] of [
    [ids.due, isoInMinutes(5), "scheduled"],
    [ids.far, isoInMinutes(90), "scheduled"],
    [ids.past, isoInMinutes(-10), "scheduled"],
    [ids.noSched, null, "scheduled"],
    [ids.active, isoInMinutes(5), "active"],
  ] as const) {
    await client.query(
      `INSERT INTO interviews (id, title, candidate_name, status, created_at, expires_at,
         recruiter_name, scheduled_at, candidate_email, role_title, difficulty,
         duration_minutes, voice_mode)
       VALUES ($1, 'Reminder test', 'Rem Test', $3, now(), now() + interval '1 day',
         'Recruiter', $2, 'reminder-test@example.com', 'Tester', 'medium', 10, 'standard')`,
      [id, scheduledAt, status],
    );
  }

  // Same statement as the repository's claimDueReminders.
  const CLAIM_SQL = `UPDATE interviews SET reminder_sent_at = $1
     WHERE reminder_sent_at IS NULL
       AND status = 'scheduled'
       AND scheduled_at IS NOT NULL
       AND scheduled_at > $1
       AND scheduled_at <= $1 + interval '30 minutes'
     RETURNING id`;
  const now = new Date().toISOString();

  const claim1 = await client.query<{ id: string }>(CLAIM_SQL, [now]);
  const mine1 = claim1.rows.map((r) => r.id).filter((id) => allIds.includes(id));
  check("claims only the due scheduled room", mine1.length === 1 && mine1[0] === ids.due, JSON.stringify(mine1));

  const claim2 = await client.query<{ id: string }>(CLAIM_SQL, [new Date().toISOString()]);
  check("never claims twice (dedup)", !claim2.rows.map((r) => r.id).includes(ids.due));

  const stamped = await client.query<{ reminder_sent_at: Date | null }>(
    "SELECT reminder_sent_at FROM interviews WHERE id = $1",
    [ids.due],
  );
  check("claim stamps reminder_sent_at", stamped.rows[0]?.reminder_sent_at !== null);
} finally {
  await client.query("DELETE FROM interviews WHERE id = ANY($1)", [allIds]);
  await client.end();
}

console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);