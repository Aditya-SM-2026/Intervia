import "server-only";
import { createHash } from "node:crypto";
import { generateStructured, isStructuredLlmAvailable } from "@/lib/ai/structured";
import type { Role } from "@/lib/roles/role.types";
import { getRolesRepository } from "@/server/repositories/roles-repository";
import { completeSections, verifySectionEvidence } from "./evidence.ts";
import { keywordMatch } from "./keywords.ts";
import { buildScreeningPrompt, screeningReplySchema } from "./prompt.ts";
import { screeningTotal } from "./score.ts";
import {
  DEFAULT_SCREENING_WEIGHTS,
  RESUME_SECTION_IDS,
  type ScreeningSnapshot,
  type ScreeningWeights,
} from "./types.ts";

/**
 * Screening for candidates who never filled the application form.
 *
 * They were invited straight to an interview, so the only resume that exists is
 * the one uploaded for that interview. It is read exactly like an application
 * resume: same prompt, same five sections, same quote checks. The result is
 * stored per role and email rather than per application, because there is no
 * application row to hang it on.
 */

function repository() {
  return getRolesRepository();
}

function keywordSnapshot(resumeText: string, skills: readonly string[]) {
  return keywordMatch(resumeText, skills);
}

function hashInput(description: string, skills: readonly string[], resumeText: string): string {
  return createHash("sha256")
    .update(description)
    .update("\u0000")
    .update(skills.join("\u0000"))
    .update("\u0000")
    .update(resumeText)
    .digest("hex");
}

/** Reads the interview resume for one candidate and scores it against the role. */
export async function screenInvitedCandidate(
  role: Role,
  email: string,
  options: { weights?: ScreeningWeights; force?: boolean } = {},
): Promise<ScreeningSnapshot | null> {
  const weights = options.weights ?? DEFAULT_SCREENING_WEIGHTS;
  const source = await repository().getCandidateResume(role.id, role.title, email.toLowerCase());
  if (!source) return null;

  const text = source.text.trim();
  const keywords = keywordSnapshot(text, role.skills);
  const inputHash = hashInput(role.description, role.skills, text);
  const now = new Date().toISOString();
  const emptySections = completeSections([], RESUME_SECTION_IDS);
  const weightedSections = RESUME_SECTION_IDS.filter((id) => (weights[id] ?? 0) > 0).length;

  const store = async (snapshot: ScreeningSnapshot) => {
    await repository().saveInvitedCandidateScreening(role.id, email.toLowerCase(), snapshot);
    return snapshot;
  };

  if (options.force !== true) {
    const existing = (await repository().getInvitedCandidateScreenings(role.id)).get(
      email.toLowerCase(),
    );
    if (
      existing &&
      existing.status !== "failed" &&
      existing.inputHash === inputHash
    ) {
      return existing;
    }
  }

  if (text === "") {
    return store({
      status: "not_screened",
      score: null,
      sections: emptySections,
      keywords,
      summary: "",
      reason: "No readable text could be extracted from the resume uploaded for this interview.",
      model: null,
      costUsd: null,
      createdAt: now,
      inputHash,
      scoredSections: 0,
      weightedSections,
    });
  }

  if (!isStructuredLlmAvailable()) {
    return store({
      status: "failed",
      score: null,
      sections: emptySections,
      keywords,
      summary: "",
      reason: "Resume screening is not configured on this deployment (no model key).",
      model: null,
      costUsd: null,
      createdAt: now,
      inputHash,
      scoredSections: 0,
      weightedSections,
    });
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
      reply.data.sections.map((entry) => ({
        id: entry.id,
        status: entry.status,
        score: entry.score === null ? null : Math.round(entry.score),
        rationale: entry.rationale,
        evidence:
          entry.score === null
            ? []
            : entry.evidence.map((item) => ({ quote: item.quote })),
      })) as Parameters<typeof completeSections>[0],
      RESUME_SECTION_IDS,
    );
    const verified = verifySectionEvidence(partial, text);
    const totals = screeningTotal(verified.sections, weights);
    return store({
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
    });
  } catch (error) {
    return store({
      status: "failed",
      score: null,
      sections: emptySections,
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
      weightedSections,
    });
  }
}
