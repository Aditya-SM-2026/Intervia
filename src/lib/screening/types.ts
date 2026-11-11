/**
 * Resume screening: one score per section of the resume, weighted into a total.
 *
 * The shape deliberately mirrors the interview scorecard (see scoring.ts and
 * scorecard.types.ts): a section that could not be scored is left out and the
 * remaining weights carry the total, and a weight of 0 removes a section for
 * everyone. Nothing here talks to a database or a model; it is pure maths over
 * a stored result, so a changed weight is applied without re-running anything.
 */

/** The six parts every resume is read in. Order is fixed for display. */
export const RESUME_SECTION_IDS = [
  "summary",
  "skills",
  "experience",
  "projects",
  "education",
  "certifications",
] as const;

export type ResumeSectionId = (typeof RESUME_SECTION_IDS)[number];

export const RESUME_SECTION_LABELS: Record<ResumeSectionId, string> = {
  summary: "Profile summary",
  skills: "Technical skills",
  experience: "Experience",
  projects: "Projects",
  education: "Education",
  certifications: "Certifications",
};

/** What one line of the form's weight editor says under the label. */
export const RESUME_SECTION_HINTS: Record<ResumeSectionId, string> = {
  summary: "How well their own pitch matches this role",
  skills: "Coverage of the role's skills, including implied ones",
  experience: "Internships and jobs: relevance, duration, responsibility",
  projects: "What they actually built, and how relevant it is",
  education: "Degree, institute, year",
  certifications: "Relevant certifications only",
};

/**
 * - scored: the section exists and supports a number.
 * - not_found: the resume has no such section.
 * - insufficient_evidence: the section exists but says nothing usable.
 */
export type SectionStatus = "scored" | "not_found" | "insufficient_evidence";

export interface SectionEvidence {
  /** Verbatim words from the resume; checked in code before it is kept. */
  quote: string;
}

export interface SectionResult {
  id: ResumeSectionId;
  status: SectionStatus;
  /** 0-100, null unless status is "scored". */
  score: number | null;
  /** One sentence, readable to a recruiter. */
  rationale: string;
  evidence: SectionEvidence[];
  /** Set in code when evidence had to be withdrawn. */
  note?: string | null;
}

/** Weights in percent of the whole. They are expected to add up to 100. */
export type ScreeningWeights = Record<ResumeSectionId, number>;

export const DEFAULT_SCREENING_WEIGHTS: ScreeningWeights = {
  summary: 20,
  skills: 20,
  experience: 20,
  projects: 20,
  education: 10,
  certifications: 10,
};

/**
 * - scored: the model read the resume and returned sections.
 * - not_screened: nothing readable to send (no text, scanned PDF, DOCX).
 * - failed: the call was made and did not produce a usable result.
 */
export type ScreeningStatus = "scored" | "not_screened" | "failed";

/** Free, exact keyword chips: always available, even when the model fails. */
export interface KeywordMatch {
  matched: string[];
  missing: string[];
}

export interface ScreeningTotals {
  /** Weighted 0-100, null when no section could be scored. */
  score: number | null;
  /** Sections that contributed a number. */
  scoredSections: number;
  /** Sections carrying weight for this role, whether scored or not. */
  weightedSections: number;
}

/** Everything stored for one screened application. */
export interface ScreeningSnapshot extends ScreeningTotals {
  status: ScreeningStatus;
  sections: SectionResult[];
  keywords: KeywordMatch;
  /** Two or three plain sentences for the drawer. */
  summary: string;
  /** Why there is no score, when there is none. */
  reason: string | null;
  model: string | null;
  costUsd: number | null;
  createdAt: string;
  /** Role description + skills + resume text, so an unchanged resume is not re-billed. */
  inputHash: string;
}
