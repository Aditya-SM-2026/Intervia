import { z } from "zod";
import { RESUME_SECTION_IDS, RESUME_SECTION_LABELS } from "./types.ts";

/**
 * The prompt and the reply shape for one resume. One call, six sections, and
 * every section must carry a line copied from the resume: the service drops
 * any quote it cannot find in the text, so a made-up line cannot prop up a
 * score.
 */

export const sectionReplySchema = z.object({
  id: z.enum(RESUME_SECTION_IDS),
  status: z.enum(["scored", "not_found", "insufficient_evidence"]),
  score: z.number().min(0).max(100).nullable(),
  rationale: z.string().min(1).max(400),
  evidence: z
    .array(z.object({ quote: z.string().min(1).max(500) }))
    .max(3)
    .default([]),
});

export const screeningReplySchema = z.object({
  summary: z.string().min(1).max(1200),
  sections: z.array(sectionReplySchema).min(1).max(RESUME_SECTION_IDS.length),
});

export type ScreeningReply = z.infer<typeof screeningReplySchema>;

export interface ScreeningPromptInput {
  roleTitle: string;
  roleDescription: string;
  skills: readonly string[];
  resumeText: string;
}

const MAX_RESUME_CHARS = 14_000;

export function buildScreeningPrompt(input: ScreeningPromptInput): {
  system: string;
  user: string;
} {
  const skills = input.skills.length > 0 ? input.skills.join(", ") : "(none listed)";
  const threshold = `0-39 does not show it, 40-59 weak, 60-79 solid, 80-94 strong, 95+ exceptional`;

  const system = [
    "You are helping a recruiter screen a resume for one specific role.",
    "Score only against this role, never against a generic ideal candidate.",
    "You must be conservative: a section with no real content is not scored highly.",
    "Every scored section needs one to three short lines copied word for word from the resume, in the same spelling, with no paraphrasing.",
    "Never invent a line. If you cannot find a supporting line, set status to insufficient_evidence and score to null.",
    "If the resume has no such section at all, set status to not_found and score to null.",
    "Scores are 0-100: " + threshold + ".",
  ].join(" ");

  const user = [
    `ROLE: ${input.roleTitle}`,
    "",
    "ROLE DESCRIPTION:",
    input.roleDescription.trim() || "(not provided)",
    "",
    `ROLE SKILLS: ${skills}`,
    "",
    "RESUME TEXT:",
    input.resumeText.slice(0, MAX_RESUME_CHARS),
    "",
    "Return one JSON object:",
    "{",
    '  "summary": "two or three sentences for the recruiter, plain and specific",',
    '  "sections": [',
    "    {",
    `      "id": one of ${RESUME_SECTION_IDS.map((id) => `"${id}"`).join(", ")}`,
    '      "status": "scored" | "not_found" | "insufficient_evidence",',
    '      "score": 0-100 or null,',
    '      "rationale": "one sentence saying why, referring to this role",',
    '      "evidence": [{ "quote": "exact words from the resume" }]',
    "    }",
    "  ]",
    "}",
    "",
    "Return all six sections exactly once, in this order: " +
      RESUME_SECTION_IDS.map((id) => RESUME_SECTION_LABELS[id]).join(", ") + ".",
    "Judge skills against the role's list, and credit a skill the resume clearly implies even when the exact word is missing.",
  ].join("\n");

  return { system, user };
}
