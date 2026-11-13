import "server-only";
import { accountDisplayName } from "@/lib/auth/session";
import { invitationInputFromRoom, sendInterviewInvitation } from "@/lib/emails/email.service";
import { configuredOrigin } from "@/lib/http/base-url";
import { DuplicateInterviewError } from "@/lib/interviews/interview-errors";
import { createInterviewRoom } from "@/lib/interviews/interview.service";
import { ROOM_ID_PATTERN } from "@/lib/interviews/interview.validation";
import { sanitizeWeights, screeningTotal } from "@/lib/screening/score";
import {
  clearsAutoInviteBar,
  DEFAULT_AUTO_INVITE_SETTINGS,
  sanitizeAutoInviteSettings,
  type AutoInviteSettings,
  type AutoInviteDifficulty,
} from "@/lib/roles/auto-invite";
import { describeRoleError } from "@/lib/roles/role-errors";
import type { Role } from "@/lib/roles/role.types";
import {
  getRolesRepository,
  type AutoInviteApplicationRow,
} from "@/server/repositories/roles-repository";

/**
 * Sends the role's interview invitation to candidates whose resume screening
 * result clears the bar. One interview and one link per candidate; nobody is
 * invited twice, and anyone already scheduled or finished is left alone.
 *
 * Runs are deliberately small: an interview plan is a model call, so one pass
 * handles a few candidates and the next pass continues. The periodic scan in
 * the reminder scheduler is what makes the automation feel automatic.
 */

/** How many invitations one explicit run may send. */
const MAX_PER_RUN = 10;
/** Roles one background pass may touch. */
const MAX_ROLES_PER_SCAN = 5;
/** Invitations one background pass may send per role. */
const MAX_PER_SCAN_ROLE = 3;

export interface AutoInviteActivity {
  candidateName: string;
  candidateEmail: string;
  status: string;
  note: string | null;
  interviewId: string | null;
  at: string | null;
}

export interface AutoInviteState {
  settings: AutoInviteSettings;
  /** Candidates who clear the bar and have not been invited yet. */
  eligible: number;
  activity: AutoInviteActivity[];
}

export interface AutoInviteRunResult {
  invited: number;
  failed: number;
  skipped: number;
  eligible: number;
  results: {
    candidateEmail: string;
    candidateName: string;
    status: "invited" | "failed" | "skipped";
    note?: string;
  }[];
}

const running = new Set<string>();

function repository() {
  return getRolesRepository();
}

function storedSettings(role: Role): AutoInviteSettings {
  return sanitizeAutoInviteSettings(role.autoInvite ?? DEFAULT_AUTO_INVITE_SETTINGS);
}

/** True when a stored row already counts as handled. */
function alreadyAttempted(row: AutoInviteApplicationRow): boolean {
  return row.autoInviteStatus !== null;
}

function scoreFor(row: AutoInviteApplicationRow, weightSource: unknown): number | null {
  const totals = screeningTotal(row.screeningSections, sanitizeWeights(weightSource));
  return totals.score === null ? null : Math.round(totals.score);
}

/**
 * The settings, how many candidates are waiting, and the last invitations.
 * Null when the role no longer exists.
 */
export async function getAutoInviteState(roleId: string): Promise<AutoInviteState | null> {
  const role = await repository().getRole(roleId);
  if (!role) return null;
  const settings = storedSettings(role);
  const screening = await repository().getRoleScreeningSettings(roleId);
  const weights = screening?.weights;
  const rows = await repository().listAutoInviteApplications(roleId, role.title);
  const eligible = rows.filter(
    (row) =>
      !alreadyAttempted(row) &&
      !row.hasBlockingInterview &&
      clearsAutoInviteBar(scoreFor(row, weights), settings.threshold),
  ).length;
  const activity = rows
    .filter((row) => row.autoInviteStatus !== null)
    .sort((a, b) => (b.autoInvitedAt ?? "").localeCompare(a.autoInvitedAt ?? ""))
    .slice(0, 8)
    .map((row) => ({
      candidateName: row.candidateName,
      candidateEmail: row.candidateEmail,
      status: row.autoInviteStatus ?? "",
      note: row.autoInviteNote,
      interviewId: row.autoInviteInterviewId,
      at: row.autoInvitedAt,
    }));
  return { settings, eligible, activity };
}

/** Saves the role's automation settings; null when the role is gone. */
export async function saveAutoInviteSettings(
  roleId: string,
  input: unknown,
): Promise<AutoInviteSettings | null> {
  if (!ROOM_ID_PATTERN.test(roleId)) return null;
  const settings = sanitizeAutoInviteSettings(input);
  const updated = await repository().updateRole(roleId, { autoInvite: settings });
  return updated ? sanitizeAutoInviteSettings(updated.autoInvite) : null;
}

/** Whose invitation failed and why, in words HR can act on. */
function emailProblem(result: { status: string; detail?: string }): string {
  if (result.status === "not_configured") {
    return "Interview created, but this deployment has no mail server configured, so no email was sent.";
  }
  return `Interview created, but the email failed: ${result.detail ?? result.status}`;
}

function describeJob(role: Role): string {
  const skills = role.skills.length > 0 ? `\n\nRequired skills: ${role.skills.join(", ")}` : "";
  return `${role.title}\n\n${role.description}${skills}`;
}

/**
 * Invites every eligible candidate, up to `limit`. Safe to call when the
 * automation is off: it does nothing.
 */
export async function runAutoInvite(
  roleId: string,
  options: { limit?: number; origin?: string } = {},
): Promise<AutoInviteRunResult | null> {
  if (!ROOM_ID_PATTERN.test(roleId)) return null;
  if (running.has(roleId)) {
    return { invited: 0, failed: 0, skipped: 0, eligible: 0, results: [] };
  }
  running.add(roleId);
  try {
    const role = await repository().getRole(roleId);
    if (!role) return null;
    const settings = storedSettings(role);
    if (!settings.enabled) {
      return { invited: 0, failed: 0, skipped: 0, eligible: 0, results: [] };
    }

    const screening = await repository().getRoleScreeningSettings(roleId);
    const weights = screening?.weights;
    const rows = await repository().listAutoInviteApplications(roleId, role.title);
    const limit = Math.max(1, Math.min(options.limit ?? MAX_PER_RUN, MAX_PER_RUN));
    const origin = options.origin ?? configuredOrigin();

    const results: AutoInviteRunResult["results"] = [];
    let eligible = 0;
    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const row of rows) {
      if (alreadyAttempted(row)) continue;
      if (row.hasBlockingInterview) continue;
      const score = scoreFor(row, weights);
      if (!clearsAutoInviteBar(score, settings.threshold)) continue;
      eligible += 1;
      if (sent + failed >= limit) continue;

      try {
        const resumeText = await repository().getApplicationResumeText(
          roleId,
          row.applicationId,
        );
        const room = await createInterviewRoom({
          recruiterName: accountDisplayName(),
          candidateName: row.candidateName,
          candidateEmail: row.candidateEmail,
          hrEmail: settings.hrEmail,
          roleTitle: role.title,
          roleId: role.id,
          durationMinutes: settings.durationMinutes,
          difficulty: settings.difficulty as AutoInviteDifficulty,
          voiceMode: "standard",
          scheduledAt: null,
          jobDescription: { source: "text", text: describeJob(role) },
          resume: resumeText
            ? { fileName: resumeText.fileName ?? "resume.pdf", text: resumeText.text }
            : null,
        });
        const url = new URL(`/interview/${room.id}`, origin).toString();
        const emailed = await sendInterviewInvitation(invitationInputFromRoom(room, url));
        const note = emailed.status === "sent" ? null : emailProblem(emailed);
        await repository().updateApplicationStatus(
          roleId,
          row.applicationId,
          "scheduled",
          room.id,
        );
        await repository().markAutoInvite(row.applicationId, {
          status: emailed.status === "sent" ? "sent" : "email_failed",
          interviewId: room.id,
          note,
        });
        results.push({
          candidateEmail: row.candidateEmail,
          candidateName: row.candidateName,
          status: "invited",
          note: note ?? undefined,
        });
        sent += 1;
      } catch (error) {
        if (error instanceof DuplicateInterviewError) {
          await repository().markAutoInvite(row.applicationId, {
            status: "skipped",
            interviewId: error.room.id,
            note: "An identical interview already exists.",
          });
          results.push({
            candidateEmail: row.candidateEmail,
            candidateName: row.candidateName,
            status: "skipped",
            note: "An identical interview already exists.",
          });
          skipped += 1;
          continue;
        }
        const note = error instanceof Error ? error.message : "Could not create the interview.";
        console.error(`[auto-invite] ${row.candidateEmail} failed: ${describeRoleError(error)}`);
        await repository()
          .markAutoInvite(row.applicationId, { status: "failed", interviewId: null, note })
          .catch(() => undefined);
        results.push({
          candidateEmail: row.candidateEmail,
          candidateName: row.candidateName,
          status: "failed",
          note,
        });
        failed += 1;
      }
    }

    return { invited: sent, failed, skipped, eligible, results };
  } finally {
    running.delete(roleId);
  }
}

/**
 * Background pass: takes a few roles with the automation on and sends a small
 * number of invitations for each. Called by the reminder scheduler.
 */
export async function runAutoInviteScanOnce(
  limitRoles = MAX_ROLES_PER_SCAN,
): Promise<{ roles: number; invited: number; failed: number }> {
  const roles = await repository().listRoles({});
  const enabled = roles.filter((role) => storedSettings(role).enabled).slice(0, limitRoles);
  let invited = 0;
  let failed = 0;
  for (const role of enabled) {
    try {
      const result = await runAutoInvite(role.id, { limit: MAX_PER_SCAN_ROLE });
      invited += result?.invited ?? 0;
      failed += result?.failed ?? 0;
    } catch (error) {
      console.error(`[auto-invite] scan for ${role.id} failed: ${describeRoleError(error)}`);
    }
  }
  return { roles: enabled.length, invited, failed };
}
