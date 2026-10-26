import nodemailer, { type Transporter } from "nodemailer";
import type { InterviewRoom } from "@/lib/interviews/interview.types";

export type InviteEmailStatus = "sent" | "failed" | "not_configured";

export interface InviteEmailResult {
  status: InviteEmailStatus;
  /** Human-readable detail, e.g. the SMTP error when sending failed. */
  detail?: string;
}

export interface InvitationEmailInput {
  to: string;
  candidateName: string;
  roleTitle: string;
  recruiterName: string | null;
  candidateUrl: string;
  /** ISO 8601 scheduled moment; null when the link may be used immediately. */
  scheduledAt: string | null;
  /** ISO 8601 link expiry; shown for unscheduled interviews. */
  expiresAt: string | null;
  durationMinutes: number;
}

export interface InvitationEmailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Rendering timezone for the email's date and time (env EMAIL_TIMEZONE). */
function emailTimezone(): string {
  return process.env.EMAIL_TIMEZONE?.trim() || "Asia/Kolkata";
}

function fromAddress(): string {
  return (
    process.env.EMAIL_FROM?.trim() ||
    process.env.SMTP_USER?.trim() ||
    "interviews@intervia.ai"
  );
}

function formatMoment(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: emailTimezone(),
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

/** Builds the invitation message; exported so tests can inspect it. */
export function buildInvitationEmail(input: InvitationEmailInput): InvitationEmailMessage {
  const whenLine = input.scheduledAt
    ? formatMoment(input.scheduledAt)
    : input.expiresAt
      ? `any time before ${formatMoment(input.expiresAt)}`
      : "any time";

  const recruiterLine = input.recruiterName
    ? `<p style="margin:0 0 4px">Interviewer: <strong>${escapeHtml(input.recruiterName)}</strong></p>`
    : "";
  const recruiterText = input.recruiterName ? `Interviewer: ${input.recruiterName}\n` : "";

  const subject = `Interview invitation: ${input.roleTitle}`;
  const text = [
    `Hi ${input.candidateName},`,
    "",
    `You are invited to an AI-led interview for the ${input.roleTitle} role.`,
    "",
    `When: ${whenLine}`,
    `Duration: about ${input.durationMinutes} minutes`,
    recruiterText,
    "Join here:",
    input.candidateUrl,
    "",
    "Notes:",
    "- The link opens only for this email address.",
    "- You need a laptop with a working camera and microphone; the interview is recorded.",
    "- You can speak naturally and interrupt the interviewer at any point.",
    "",
    "Good luck!",
    "The Sreemedhas Agent team",
  ].join("\n");

  const html = `<!doctype html>
<html><body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1a1a2e">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="background:#ffffff;border-radius:12px;padding:28px">
      <p style="margin:0 0 16px;font-size:16px">Hi <strong>${escapeHtml(input.candidateName)}</strong>,</p>
      <p style="margin:0 0 16px;font-size:15px">
        You are invited to an AI-led interview for the
        <strong>${escapeHtml(input.roleTitle)}</strong> role.
      </p>
      <div style="background:#f4f5f7;border-radius:8px;padding:14px 16px;margin:0 0 20px;font-size:15px;line-height:1.7">
        <p style="margin:0 0 4px">When: <strong>${escapeHtml(whenLine)}</strong></p>
        <p style="margin:0 0 4px">Duration: about <strong>${input.durationMinutes}</strong> minutes</p>
        ${recruiterLine}
      </div>
      <p style="margin:0 0 16px">
        <a href="${input.candidateUrl}"
           style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;
                  padding:12px 22px;border-radius:8px;font-size:15px;font-weight:bold">
          Join the interview
        </a>
      </p>
      <p style="margin:0 0 6px;font-size:13px;color:#555">Or copy this link into your browser:</p>
      <p style="margin:0 0 20px;font-size:13px"><a href="${input.candidateUrl}" style="color:#4f46e5;word-break:break-all">${input.candidateUrl}</a></p>
      <ul style="margin:0;padding-left:18px;font-size:13px;color:#555;line-height:1.7">
        <li>The link opens only for this email address.</li>
        <li>You need a laptop with a working camera and microphone; the interview is recorded.</li>
        <li>You can speak naturally and interrupt the interviewer at any point.</li>
      </ul>
    </div>
    <p style="margin:16px 0 0;text-align:center;font-size:12px;color:#999">Sent by Sreemedhas Agent — please do not reply to this email.</p>
  </div>
</body></html>`;

  return { from: fromAddress(), to: input.to, subject, text, html };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isSmtpConfigured(): boolean {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASSWORD?.trim();
  return Boolean(host && user && password);
}

function createTransport(): Transporter {
  const port = Number(process.env.SMTP_PORT?.trim() || 587);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST!.trim(),
    port,
    // Port 465 speaks TLS from the first byte; everything else uses STARTTLS.
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER!.trim(),
      pass: process.env.SMTP_PASSWORD!.trim(),
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
}

/**
 * Sends the interview invitation. Never throws: a failure is reported in the
 * result so scheduling can proceed regardless of email delivery.
 */
export async function sendInterviewInvitation(
  input: InvitationEmailInput,
  transport?: Transporter,
): Promise<InviteEmailResult> {
  if (!isSmtpConfigured() && !transport) {
    console.warn(
      `[email] SMTP not configured; invitation for ${input.to} logged to console only`,
    );
    console.warn(`[email] would send to=${input.to} subject="${buildInvitationEmail(input).subject}"`);
    return { status: "not_configured" };
  }

  const message = buildInvitationEmail(input);
  const sender = transport ?? createTransport();
  try {
    await sender.sendMail(message);
    console.info(`[email] invitation sent to ${input.to} (${message.subject})`);
    return { status: "sent" };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    console.error(`[email] invitation failed for ${input.to}: ${detail}`);
    return { status: "failed", detail };
  }
}

export interface ReminderEmailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Builds the 30-minute reminder; exported so tests can inspect it. */
export function buildReminderEmail(
  input: InvitationEmailInput,
  startsInMinutes: number,
): ReminderEmailMessage {
  const invite = buildInvitationEmail(input);
  const when = input.scheduledAt ? formatMoment(input.scheduledAt) : "shortly";
  const subject = `Reminder: your interview starts in about ${startsInMinutes} minutes`;
  const text = [
    `Hi ${input.candidateName},`,
    "",
    `Your ${input.roleTitle} interview starts in about ${startsInMinutes} minutes (${when}).`,
    "",
    "Join now so you are ready to go when it begins:",
    input.candidateUrl,
    "",
    "Quick checklist:",
    "- Find a quiet room with a stable internet connection.",
    "- Allow camera and microphone access when the browser asks.",
    `- The interview takes about ${input.durationMinutes} minutes and is recorded.`,
    "",
    "See you very soon!",
    "The Sreemedhas Agent team",
  ].join("\n");
  const html = `<!doctype html>
<html><body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1a1a2e">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="background:#ffffff;border-radius:12px;padding:28px">
      <p style="margin:0 0 16px;font-size:16px">Hi <strong>${escapeHtml(input.candidateName)}</strong>,</p>
      <p style="margin:0 0 12px;font-size:15px">
        Your <strong>${escapeHtml(input.roleTitle)}</strong> interview starts in about
        <strong>${startsInMinutes} minutes</strong> (${escapeHtml(when)}).
      </p>
      <p style="margin:0 0 16px">
        <a href="${input.candidateUrl}"
           style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;
                  padding:12px 22px;border-radius:8px;font-size:15px;font-weight:bold">
          Join the interview
        </a>
      </p>
      <ul style="margin:0;padding-left:18px;font-size:13px;color:#555;line-height:1.7">
        <li>Find a quiet room with a stable internet connection.</li>
        <li>Allow camera and microphone access when the browser asks.</li>
        <li>The interview takes about ${input.durationMinutes} minutes and is recorded.</li>
      </ul>
    </div>
    <p style="margin:16px 0 0;text-align:center;font-size:12px;color:#999">Sent by Sreemedhas Agent — please do not reply to this email.</p>
  </div>
</body></html>`;
  return { from: invite.from, to: input.to, subject, text, html };
}

/**
 * Sends the 30-minute reminder. Same contract as the invitation: never
 * throws, the result carries the outcome.
 */
export async function sendInterviewReminder(
  input: InvitationEmailInput,
  startsInMinutes: number,
  transport?: Transporter,
): Promise<InviteEmailResult> {
  if (!input.scheduledAt) {
    // Nothing to remind about for immediate interviews.
    return { status: "not_configured", detail: "Interview has no scheduled time" };
  }
  if (!isSmtpConfigured() && !transport) {
    const message = buildReminderEmail(input, startsInMinutes);
    console.warn(`[email] SMTP not configured; reminder for ${input.to} logged to console only`);
    console.warn(`[email] would send to=${input.to} subject="${message.subject}"`);
    return { status: "not_configured" };
  }

  const message = buildReminderEmail(input, startsInMinutes);
  const sender = transport ?? createTransport();
  try {
    await sender.sendMail(message);
    console.info(`[email] reminder sent to ${input.to} (${message.subject})`);
    return { status: "sent" };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    console.error(`[email] reminder failed for ${input.to}: ${detail}`);
    return { status: "failed", detail };
  }
}

/** Adapts a room to the invitation input; the URL must be absolute. */
export function invitationInputFromRoom(
  room: InterviewRoom,
  candidateUrl: string,
): InvitationEmailInput {
  return {
    to: room.candidateEmail ?? "",
    candidateName: room.candidateName || "candidate",
    roleTitle: room.roleTitle || room.title || "your interview",
    recruiterName: room.recruiterName,
    candidateUrl,
    scheduledAt: room.scheduledAt,
    expiresAt: room.expiresAt,
    durationMinutes: room.durationMinutes,
  };
}