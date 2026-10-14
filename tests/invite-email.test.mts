import { buildInvitationEmail, sendInterviewInvitation, invitationInputFromRoom } from "../src/lib/emails/email.service";
import type { InterviewRoom } from "../src/lib/interviews/interview.types";
import type { Transporter } from "nodemailer";

let passed = 0;
let total = 0;
function check(name: string, ok: boolean, extra = "") {
  total++;
  if (ok) { passed++; console.log(`PASS ${name}`); }
  else console.log(`FAIL ${name} ${extra}`);
}

const room: InterviewRoom = {
  id: "room-1",
  title: "Backend Engineer",
  candidateName: "Aditya Rao",
  status: "scheduled",
  createdAt: "2026-10-14T06:00:00.000Z",
  expiresAt: "2026-10-15T06:00:00.000Z",
  scheduledAt: "2026-10-20T10:00:00.000Z",
  recruiterName: "Priya Sharma",
  candidateEmail: "candidate@example.com",
  roleTitle: "Backend Engineer",
  difficulty: "medium",
  durationMinutes: 15,
  voiceMode: "standard",
  jobDescription: null,
  resume: null,
  consent: null,
  completedAt: null,
  plan: null,
  outcome: null,
  decision: null,
};

const input = invitationInputFromRoom(room, "https://intervia.ai/interview/room-1");

// 1. Message content
const msg = buildInvitationEmail(input);
check("to is candidate email", msg.to === "candidate@example.com");
check("subject has role", msg.subject.includes("Backend Engineer"), msg.subject);
check("html has link", msg.html.includes("https://intervia.ai/interview/room-1"));
check("text has link", msg.text.includes("https://intervia.ai/interview/room-1"));
check("html has scheduled time", /20 October 2026|Monday, 20 October/i.test(msg.html), msg.html.match(/When: <strong>[^<]+/)?.[0]);
check("html has duration", msg.html.includes("15"));
check("html has recruiter", msg.html.includes("Priya Sharma"));
check("html escapes name", buildInvitationEmail({ ...input, candidateName: "<b>x</b>" }).html.includes("&lt;b&gt;x&lt;/b&gt;"));

// 2. Unscheduled room renders the expiry line
const msg2 = buildInvitationEmail({ ...input, scheduledAt: null });
check("unscheduled mentions expiry", /before.*2026/i.test(msg2.html));

// 3. Sent path with a fake transport
const sent: unknown[] = [];
const fakeTransport = { sendMail: async (m: unknown) => { sent.push(m); } } as unknown as Transporter;
const sentResult = await sendInterviewInvitation(input, fakeTransport);
check("sent status", sentResult.status === "sent", JSON.stringify(sentResult));
check("transport got exactly one mail", sent.length === 1);

// 4. Failure path: throwing transport must not throw
const throwing = { sendMail: async () => { throw new Error("ECONNREFUSED 127.0.0.1:587"); } } as unknown as Transporter;
const failResult = await sendInterviewInvitation(input, throwing);
check("failed status", failResult.status === "failed", JSON.stringify(failResult));
check("failure detail captured", (failResult.detail ?? "").includes("ECONNREFUSED"), failResult.detail);

// 5. Not configured (env unset in this script) -> not_configured, nothing sent
process.env.SMTP_HOST = "";
process.env.SMTP_USER = "";
process.env.SMTP_PASSWORD = "";
const ncResult = await sendInterviewInvitation(input);
check("not_configured status", ncResult.status === "not_configured", JSON.stringify(ncResult));
check("nothing sent on not-configured", sent.length === 1);

console.log(`\n${passed}/13 passed`);
process.exit(passed === total ? 0 : 1);