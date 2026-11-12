import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireRecruiter } from "@/lib/auth/guards";
import { accountDisplayName } from "@/lib/auth/session";
import { DuplicateInterviewError } from "@/lib/interviews/interview-errors";
import { createInterviewRoom, resolveScheduledAt } from "@/lib/interviews/interview.service";
import {
  createInterviewSchema,
  formatValidationIssues,
} from "@/lib/interviews/interview.validation";
import { ROOM_ID_PATTERN } from "@/lib/interviews/interview.validation";
import { invitationInputFromRoom, sendInterviewInvitation } from "@/lib/emails/email.service";
import { describeRoleError, roleErrorResponse } from "@/lib/roles/role-errors";
import { getRolesRepository } from "@/server/repositories/roles-repository";

type RouteParams = { params: Promise<{ roleId: string }> };

/** One interview plan takes a few seconds, so a batch is capped. */
const MAX_BATCH = 40;

interface BulkResult {
  email: string;
  name: string | null;
  status: "created" | "skipped" | "failed";
  /** The candidate's own link; each person gets a different one. */
  url?: string;
  emailed?: boolean;
  reason?: string;
}

/**
 * Schedules one interview per selected candidate, each with its own link and
 * its own invitation email.
 *
 * The recruiter sets the interview up once: length, difficulty, voice mode and
 * an optional HR email. Every selected candidate gets those settings, a fresh
 * room, and the resume they already gave us (their application resume, or the
 * one uploaded for an earlier interview). Candidates are worked through one at
 * a time so one failure does not stop the rest, and the response lists every
 * outcome rather than a single number.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roleId } = await params;
  if (!ROOM_ID_PATTERN.test(roleId)) {
    return roleErrorResponse("INVALID_INPUT", "This role ID is invalid.");
  }

  const body = (await request.json().catch(() => null)) as
    | {
        candidateIds?: unknown;
        durationMinutes?: unknown;
        difficulty?: unknown;
        voiceMode?: unknown;
        scheduledDate?: unknown;
        scheduledTime?: unknown;
        hrEmail?: unknown;
      }
    | null;
  if (!body) {
    return roleErrorResponse("INVALID_INPUT", "Send the candidates and the interview settings.");
  }

  const candidateIds = Array.isArray(body.candidateIds)
    ? [...new Set(body.candidateIds.filter((value): value is string => typeof value === "string"))]
    : [];
  if (candidateIds.length === 0) {
    return roleErrorResponse("INVALID_INPUT", "Choose at least one candidate.");
  }
  if (candidateIds.length > MAX_BATCH) {
    return roleErrorResponse(
      "INVALID_INPUT",
      `Schedule at most ${MAX_BATCH} candidates at a time; each interview plan takes a few seconds.`,
    );
  }

  try {
    const repository = getRolesRepository();
    const role = await repository.getRole(roleId);
    if (!role) return roleErrorResponse("ROLE_NOT_FOUND", "This role does not exist.");

    const scheduled = resolveScheduledAt(
      typeof body.scheduledDate === "string" ? body.scheduledDate : undefined,
      typeof body.scheduledTime === "string" ? body.scheduledTime : undefined,
    );
    if (scheduled.error) return roleErrorResponse("INVALID_INPUT", scheduled.error);

    const settings = createInterviewSchema.safeParse({
      recruiterName: accountDisplayName(),
      candidateName: "placeholder",
      candidateEmail: "placeholder@example.com",
      roleTitle: role.title,
      roleId: role.id,
      durationMinutes: body.durationMinutes,
      difficulty: body.difficulty,
      voiceMode: body.voiceMode,
      hrEmail: body.hrEmail,
      scheduledDate: body.scheduledDate,
      scheduledTime: body.scheduledTime,
    });
    if (!settings.success) {
      return roleErrorResponse("INVALID_INPUT", formatValidationIssues(settings.error));
    }

    const origin = publicOrigin(request);
    const results: BulkResult[] = [];

    for (const rawId of candidateIds) {
      const email = rawId.trim().toLowerCase();
      let name: string | null = null;
      try {
        const application = await repository.getApplicationByEmail(role.id, email);
        const interviewResume = application
          ? await repository.getApplicationResumeText(role.id, application.id)
          : await repository.getCandidateResume(role.id, role.title, email);
        name =
          application?.name ??
          (await repository.getCandidateInterviews(role.id, role.title, email))[0]?.candidateName ??
          null;

        if (!name) {
          results.push({
            email,
            name: null,
            status: "skipped",
            reason: "No candidate with this email is on the role.",
          });
          continue;
        }

        if (!application) {
          // Invited candidates may already have a live interview; making a
          // second one is allowed, but say so instead of doing it silently.
          const existing = await repository.getCandidateInterviews(role.id, role.title, email);
          if (existing.some((item) => item.status === "scheduled")) {
            results.push({
              email,
              name,
              status: "skipped",
              reason: "This candidate already has an interview waiting.",
            });
            continue;
          }
        }

        const resumeText = interviewResume?.text?.trim() ?? "";
        const room = await createInterviewRoom({
          ...settings.data,
          candidateName: name,
          candidateEmail: email,
          roleTitle: role.title,
          roleId: role.id,
          scheduledAt: scheduled.value,
          jobDescription: { source: "text", text: describeJob(role) },
          resume: interviewResume
            ? { fileName: interviewResume.fileName ?? "resume.pdf", text: resumeText }
            : null,
        });

        const url = new URL(`/interview/${room.id}`, origin).toString();
        const emailed = await sendInterviewInvitation(invitationInputFromRoom(room, url));

        // Keep the application in step with its interview, so the role page
        // shows the person as scheduled rather than still new.
        if (application) {
          await repository.updateApplicationStatus(role.id, application.id, "scheduled", room.id);
        }

        results.push({
          email,
          name,
          status: "created",
          url,
          emailed: emailed.status === "sent",
          reason: emailed.status === "sent" ? undefined : emailProblem(emailed),
        });
      } catch (error) {
        if (error instanceof DuplicateInterviewError) {
          results.push({
            email,
            name,
            status: "skipped",
            reason: "An identical interview is already scheduled for this moment.",
          });
          continue;
        }
        console.error(`[bulk-schedule] ${email} failed: ${describeRoleError(error)}`);
        results.push({
          email,
          name,
          status: "failed",
          reason: error instanceof Error ? error.message : "Could not create this interview.",
        });
      }
    }

    return NextResponse.json({
      created: results.filter((item) => item.status === "created").length,
      skipped: results.filter((item) => item.status === "skipped").length,
      failed: results.filter((item) => item.status === "failed").length,
      results,
    });
  } catch (error) {
    console.error(`[bulk-schedule] failed: ${describeRoleError(error)}`);
    return roleErrorResponse("SERVER_ERROR", "Could not schedule the interviews.");
  }
}

/**
 * Why an invitation did not go out, in words a recruiter can act on. The
 * interview itself still exists: only the email is missing.
 */
function emailProblem(result: { status: string; detail?: string }): string {
  if (result.status === "not_configured") {
    return "Interview created, but this deployment has no mail server configured, so no email was sent.";
  }
  return `Interview created, but the email failed: ${result.detail ?? result.status}`;
}

/** The role's own wording is the job description for its interviews. */function describeJob(role: {
  title: string;
  description: string;
  skills: readonly string[];
}): string {
  const skills = role.skills.length > 0 ? `\n\nRequired skills: ${role.skills.join(", ")}` : "";
  return `${role.title}\n\n${role.description}${skills}`;
}

function publicOrigin(request: NextRequest): string {
  const configured = process.env.INTERVIA_PUBLIC_ORIGIN?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto =
    forwardedProto === "https" || forwardedProto === "http"
      ? forwardedProto
      : request.nextUrl.protocol.replace(":", "");
  const host = request.headers.get("host") ?? request.nextUrl.host;
  const safeHost = /^[a-zA-Z0-9.\-:]+$/.test(host) ? host : "localhost";
  return `${proto}://${safeHost}`;
}
