import "server-only";
import { createHash } from "node:crypto";
import { generateStructured, isStructuredLlmAvailable } from "@/lib/ai/structured";
import { screenInvitedCandidate } from "./invited.ts";
import { getRolesRepository } from "@/server/repositories/roles-repository";
import { completeSections, verifySectionEvidence } from "./evidence.ts";
import { keywordMatch } from "./keywords.ts";
import { buildScreeningPrompt, screeningReplySchema } from "./prompt.ts";
import { screeningTotal, sanitizeWeights, weightsTotal, weightsAreValid } from "./score.ts";
import {
  DEFAULT_SCREENING_WEIGHTS,
  RESUME_SECTION_IDS,
  type ResumeSectionId,
  type ScreeningSnapshot,
  type ScreeningWeights,
  type SectionResult,
  type SectionStatus,
} from "./types.ts";

/**
 * Resume screening for the roles section: one model call per application,
 * six section scores, weighted into a total with the role's own weights.
 *
 * The stored result is the section scores, so changing a weight later is
 * arithmetic on read, never a new model call. Everything that can go wrong
 * (no readable resume text, no model configured, a failed call) leaves the
 * application with the free keyword chips and a plain reason instead of a
 * misleading zero.
 */

/** Rough cost of one resume call, in USD, used for the estimate before a run. */
export const ESTIMATE_USD_PER_RESUME = 0.0025;

function repository() {
  return getRolesRepository();
}

export interface ScreeningSettings {
  enabled: boolean;
  weights: ScreeningWeights;
}

export async function getScreeningSettings(roleId: string): Promise<ScreeningSettings | null> {
  const stored = await repository().getRoleScreeningSettings(roleId);
  if (!stored) return null;
  return { enabled: stored.enabled, weights: sanitizeWeights(stored.weights) };
}

export type SaveScreeningSettingsResult =
  | { ok: true; settings: ScreeningSettings }
  | { ok: false; code: "not_found" | "invalid"; message: string };

export async function saveScreeningSettings(
  roleId: string,
  input: { enabled?: unknown; weights?: unknown },
): Promise<SaveScreeningSettingsResult> {
  const current = await getScreeningSettings(roleId);
  if (!current) {
    return { ok: false, code: "not_found", message: "This role no longer exists." };
  }
  const weights = sanitizeWeights(input.weights ?? current.weights);
  if (!weightsAreValid(weights)) {
    return {
      ok: false,
      code: "invalid",
      message: `The weights must add up to 100. They currently add up to ${weightsTotal(weights)}.`,
    };
  }
  const enabled = typeof input.enabled === "boolean" ? input.enabled : current.enabled;
  const saved = await repository().updateRoleScreeningSettings(roleId, { enabled, weights });
  if (!saved) {
    return { ok: false, code: "not_found", message: "This role no longer exists." };
  }
  return { ok: true, settings: { enabled: saved.enabled, weights: sanitizeWeights(saved.weights) } };
}

/** What the resume says about the role's skills, computed locally and free. */
function keywordSnapshot(resumeText: string, skills: readonly string[]) {
  return keywordMatch(resumeText, skills);
}

function hashInput(description: string, skills: readonly string[], resumeText: string): string {
  return createHash("sha256")
    .update(description)
    .update("\u0000")
    .update(skills.join("\u0001"))
    .update("\u0000")
    .update(resumeText)
    .digest("hex");
}

function toSectionResult(entry: {
  id: ResumeSectionId;
  status: SectionStatus;
  score: number | null;
  rationale: string;
  evidence: { quote: string }[];
}): SectionResult {
  const scored = entry.status === "scored" && entry.score !== null;
  return {
    id: entry.id,
    status: entry.status,
    score: scored ? Math.round(entry.score as number) : null,
    rationale: entry.rationale,
    evidence: entry.evidence.map((item) => ({ quote: item.quote.trim() })).filter((item) => item.quote !== ""),
  };
}

export type ScreenResult =
  | { ok: true; snapshot: ScreeningSnapshot; skipped: boolean }
  | { ok: false; code: "not_found"; message: string };

/**
 * Screens one application and stores the result. Safe to call again: the same
 * role description and resume text are not re-billed unless `force` is set.
 */
export async function screenApplication(
  roleId: string,
  applicationId: string,
  options: { force?: boolean } = {},
): Promise<ScreenResult> {
  const role = await repository().getRole(roleId);
  if (!role) return { ok: false, code: "not_found", message: "This role no longer exists." };
  const settings = await getScreeningSettings(roleId);
  const weights = settings?.weights ?? DEFAULT_SCREENING_WEIGHTS;
  const source = await repository().getApplicationResumeText(roleId, applicationId);
  if (!source) return { ok: false, code: "not_found", message: "This application no longer exists." };

  const text = source.text.trim();
  const keywords = keywordSnapshot(text, role.skills);
  const inputHash = hashInput(role.description, role.skills, text);
  const now = new Date().toISOString();

  // Same role wording and same resume text as last time: reuse the stored
  // result rather than paying for the same answer twice.
  const existing = await repository().getApplication(roleId, applicationId);
  if (
    options.force !== true &&
    existing?.screening &&
    existing.screening.status !== "failed" &&
    existing.screening.inputHash === inputHash
  ) {
    return { ok: true, snapshot: existing.screening, skipped: true };
  }

  // Nothing readable to send: be explicit rather than showing a zero.
  if (text === "") {
    const snapshot: ScreeningSnapshot = {
      status: "not_screened",
      score: null,
      sections: completeSections([], RESUME_SECTION_IDS),
      keywords,
      summary: "",
      reason:
        source.fileName === null
          ? "No resume file was stored with this application."
          : "No readable text could be extracted from this resume (scanned PDF or Word file).",
      model: null,
      costUsd: null,
      createdAt: now,
      inputHash,
      scoredSections: 0,
      weightedSections: RESUME_SECTION_IDS.filter((id) => (weights[id] ?? 0) > 0).length,
    };
    await repository().saveApplicationScreening(applicationId, snapshot);
    return { ok: true, snapshot, skipped: true };
  }

  if (!isStructuredLlmAvailable()) {
    const snapshot: ScreeningSnapshot = {
      status: "failed",
      score: null,
      sections: completeSections([], RESUME_SECTION_IDS),
      keywords,
      summary: "",
      reason: "Resume screening is not configured on this deployment (no model key).",
      model: null,
      costUsd: null,
      createdAt: now,
      inputHash,
      scoredSections: 0,
      weightedSections: RESUME_SECTION_IDS.filter((id) => (weights[id] ?? 0) > 0).length,
    };
    await repository().saveApplicationScreening(applicationId, snapshot);
    return { ok: true, snapshot, skipped: true };
  }

  const prompt = buildScreeningPrompt({
    roleTitle: role.title,
    roleDescription: role.description,
    skills: role.skills,
    resumeText: text,
  });

  try {
    const reply = await generateStructured({
      system: prompt.system,
      user: prompt.user,
      schema: screeningReplySchema,
    });

    const partial = completeSections(
      reply.data.sections.map(toSectionResult),
      RESUME_SECTION_IDS,
    );
    const verified = verifySectionEvidence(partial, text);
    const totals = screeningTotal(verified.sections, weights);

    const snapshot: ScreeningSnapshot = {
      status: "scored",
      score: totals.score,
      sections: verified.sections,
      keywords,
      summary: reply.data.summary.trim(),
      reason:
        totals.score === null
          ? "The resume had no section that could be scored against this role."
          : null,
      model: reply.model,
      costUsd: reply.costUsd,
      createdAt: now,
      inputHash,
      scoredSections: totals.scoredSections,
      weightedSections: totals.weightedSections,
    };
    await repository().saveApplicationScreening(applicationId, snapshot);
    return { ok: true, snapshot, skipped: false };
  } catch (error) {
    const snapshot: ScreeningSnapshot = {
      status: "failed",
      score: null,
      sections: completeSections([], RESUME_SECTION_IDS),
      keywords,
      summary: "",
      reason:
        error instanceof Error
          ? `The screening call did not complete: ${error.message}`
          : "The screening call did not complete.",
      model: null,
      costUsd: null,
      createdAt: now,
      inputHash,
      scoredSections: 0,
      weightedSections: RESUME_SECTION_IDS.filter((id) => (weights[id] ?? 0) > 0).length,
    };
    await repository().saveApplicationScreening(applicationId, snapshot);
    return { ok: true, snapshot, skipped: true };
  }
}

/** How many applications still need screening, and the rough bill to do them. */
export async function screeningEstimate(roleId: string): Promise<{
  pending: number;
  withText: number;
  estimatedUsd: number;
} | null> {
  const role = await repository().getRole(roleId);
  if (!role) return null;
  const rows = await repository().listUnscreenedApplications(roleId, 200);
  const invited = await repository().listUnscreenedInvitedCandidates(roleId, role.title, 200);
  const withText = rows.filter((row) => row.hasText).length + invited.filter((row) => row.hasText).length;
  return {
    pending: rows.length + invited.length,
    withText,
    estimatedUsd: Number((withText * ESTIMATE_USD_PER_RESUME).toFixed(4)),
  };
}

/** Screens a small batch of applications that have no result yet. */
export async function screenPendingBatch(
  roleId: string,
  limit = 10,
): Promise<{ screened: number; failed: number; pending: number }> {
  const role = await repository().getRole(roleId);
  if (!role) return { screened: 0, failed: 0, pending: 0 };
  const rows = await repository().listUnscreenedApplications(roleId, limit);
  let screened = 0;
  let failed = 0;
  for (const row of rows) {
    const result = await screenApplication(roleId, row.id);
    if (result.ok && result.snapshot.status === "scored") screened += 1;
    else if (result.ok && result.snapshot.status === "failed") failed += 1;
    else if (result.ok) screened += 1;
  }

  // Candidates invited straight to an interview have no application, so their
  // resume comes from the interview and their result is stored per email.
  const invited = await repository().listUnscreenedInvitedCandidates(roleId, role.title, limit);
  const invitedWeights = (await getScreeningSettings(roleId))?.weights ?? DEFAULT_SCREENING_WEIGHTS;
  for (const candidate of invited) {
    if (!candidate.hasText) continue;
    const snapshot = await screenInvitedCandidate(role, candidate.email, { weights: invitedWeights });
    if (snapshot?.status === "scored") screened += 1;
    else if (snapshot?.status === "failed") failed += 1;
  }

  const remaining = await repository().listUnscreenedApplications(roleId, 200);
  const remainingInvited = await repository().listUnscreenedInvitedCandidates(roleId, role.title, 200);
  return { screened, failed, pending: remaining.length + remainingInvited.length };
}

/** The stored screening result for one application, or null. */
export async function getApplicationScreening(
  roleId: string,
  applicationId: string,
): Promise<ScreeningSnapshot | null> {
  const application = await repository().getApplication(roleId, applicationId);
  return application?.screening ?? null;
}
