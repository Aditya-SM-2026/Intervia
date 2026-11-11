import type { ResumeSectionId, SectionResult } from "./types.ts";

/**
 * Every section quote must actually appear in the resume. A model that invents
 * a plausible line ("led a team of eight") would otherwise make the score look
 * evidenced. Quotes that cannot be found are dropped, and a section left with
 * no quote is downgraded rather than trusted.
 */

const MIN_QUOTE_LENGTH = 8;

/** Lowercase, collapse whitespace and normalise curly quotes/dashes. */
export function normaliseForMatch(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function quoteAppears(quote: string, normalizedHaystack: string): boolean {
  const needle = normaliseForMatch(quote);
  if (needle.length < MIN_QUOTE_LENGTH) return false;
  return normalizedHaystack.includes(needle);
}

export interface VerifiedSections {
  sections: SectionResult[];
  removedQuotes: number;
  /** Sections that lost their evidence and were downgraded as a result. */
  downgraded: number;
}

/**
 * Keeps only quotes that appear in the resume. A section whose every quote is
 * rejected becomes "insufficient_evidence" with no score, because nothing on
 * the resume supports the number the model gave.
 */
export function verifySectionEvidence(
  sections: readonly SectionResult[],
  resumeText: string,
): VerifiedSections {
  const haystack = normaliseForMatch(resumeText);
  let removedQuotes = 0;
  let downgraded = 0;

  const verified = sections.map((section): SectionResult => {
    if (section.evidence.length === 0) {
      if (section.status !== "scored") return section;
      downgraded += 1;
      return {
        ...section,
        status: "insufficient_evidence",
        score: null,
        note: "No supporting line could be found in the resume.",
      };
    }

    const seen = new Set<string>();
    const kept = section.evidence.filter((item) => {
      const key = normaliseForMatch(item.quote);
      if (seen.has(key)) {
        removedQuotes += 1;
        return false;
      }
      seen.add(key);
      if (!quoteAppears(item.quote, haystack)) {
        removedQuotes += 1;
        return false;
      }
      return true;
    });

    if (kept.length === section.evidence.length) return section;
    if (kept.length === 0) {
      if (section.status === "scored") {
        downgraded += 1;
        return {
          ...section,
          status: "insufficient_evidence",
          score: null,
          evidence: [],
          note: "The quoted lines were not found in the resume, so this section was not scored.",
        };
      }
      return {
        ...section,
        evidence: [],
        note: "The quoted lines were not found in the resume.",
      };
    }
    return {
      ...section,
      evidence: kept,
      note: "Some quoted lines were not found in the resume and were removed.",
    };
  });

  return { sections: verified, removedQuotes, downgraded };
}

/** The six ids in display order, with a placeholder for anything missing. */
export function completeSections(
  partial: readonly SectionResult[],
  ids: readonly string[],
): SectionResult[] {
  const byId = new Map(partial.map((section) => [section.id, section]));
  return ids.map(
    (id) =>
      byId.get(id as ResumeSectionId) ?? {
        id: id as ResumeSectionId,
        status: "not_found",
        score: null,
        rationale: "This section was not found on the resume.",
        evidence: [],
      },
  );
}
