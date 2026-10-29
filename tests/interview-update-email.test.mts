import { buildInterviewUpdateEmail, sendInterviewUpdate } from "../src/lib/emails/email.service.ts";
import type { Transporter } from "nodemailer";

let passed = 0;
let total = 0;
function check(name: string, ok: boolean, extra = "") {
  total++;
  if (ok) { passed++; console.log(`PASS ${name}`); }
  else console.log(`FAIL ${name} ${extra}`);
}

const input = {
  to: "candidate@example.com",
  candidateName: "Aditya Rao",
  roleTitle: "Backend Engineer",
  recruiterName: "Priya Sharma",
  candidateUrl: "https://intervia.ai/interview/room-1",
  scheduledAt: "2026-10-20T10:00:00.000Z",
  expiresAt: "2026-10-21T06:00:00.000Z",
  durationMinutes: 25,
  changes: ["Length: 20 to 25 minutes", "Role: Backend Engineer to Senior Backend Engineer"],
};

// 1. Content
const msg = buildInterviewUpdateEmail(input);
check("to is candidate email", msg.to === "candidate@example.com");
check("subject marks an update", /updated/i.test(msg.subject), msg.subject);
check("subject has role", msg.subject.includes("Backend Engineer"), msg.subject);
check("html has link", msg.html.includes(input.candidateUrl));
check("text has link", msg.text.includes(input.candidateUrl));
check("text lists every change", input.changes.every((c) => msg.text.includes(c)), msg.text);
check("html lists every change", input.changes.every((c) => msg.html.includes(c)));
check("html has duration", msg.html.includes("25"));
check("html has recruiter", msg.html.includes("Priya Sharma"));
check("html escapes changes", buildInterviewUpdateEmail({ ...input, changes: ["<b>x</b>"] }).html.includes("&lt;b&gt;x&lt;/b&gt;"));

// 2. No changes recorded still renders a sentence rather than an empty list
const empty = buildInterviewUpdateEmail({ ...input, changes: [] });
check("empty changes fallback", /details were updated/i.test(empty.text), empty.text);

// 3. Sent path with a fake transport
const sent: unknown[] = [];
const fakeTransport = { sendMail: async (m: unknown) => { sent.push(m); } } as unknown as Transporter;
process.env.SMTP_HOST = "smtp.example.com";
process.env.SMTP_USER = "user";
process.env.SMTP_PASSWORD = "pass";
const sentResult = await sendInterviewUpdate(input, fakeTransport);
check("sent status", sentResult.status === "sent", JSON.stringify(sentResult));
check("transport got exactly one mail", sent.length === 1);

// 4. Failure path must not throw
const throwing = { sendMail: async () => { throw new Error("ECONNREFUSED 127.0.0.1:587"); } } as unknown as Transporter;
const failResult = await sendInterviewUpdate(input, throwing);
check("failed status", failResult.status === "failed", JSON.stringify(failResult));
check("failure detail captured", (failResult.detail ?? "").includes("ECONNREFUSED"), failResult.detail);

// 5. Not configured -> nothing sent
process.env.SMTP_HOST = "";
process.env.SMTP_USER = "";
process.env.SMTP_PASSWORD = "";
const ncResult = await sendInterviewUpdate(input);
check("not_configured status", ncResult.status === "not_configured", JSON.stringify(ncResult));
check("nothing sent on not-configured", sent.length === 1);

console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
