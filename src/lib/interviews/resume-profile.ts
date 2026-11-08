import type { ResumeProfile } from "./scorecard.types";

/**
 * Keeps only what the resume itself supports. The model writing the profile
 * sometimes fills in a plausible employer, school or figure that the resume
 * never mentions; a recruiter must never see an invented fact, so every field
 * is checked against the resume text and dropped when its names are missing.
 */

const STOPWORDS = new Set([
  "and", "the", "for", "with", "from", "into", "over", "using", "used", "built", "end",
  "years", "year", "experience", "work", "worked", "team", "teams", "based", "level",
]);

function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(text: string): string[] {
  return normalise(text).split(" ").filter(Boolean);
}

/**
 * Proper names and figures in the phrase: capitalised words (except a plain
 * sentence-initial one such as "Built"), upper-case words, and anything with a
 * digit, so an invented company, school or number is caught.
 */
function nameTokens(phrase: string): string[] {
  return phrase
    .split(/[\s,()|]+/)
    .filter((word, index) => {
      if (/\d/.test(word)) return true;
      if (!/^[A-Z]/.test(word)) return false;
      const plainCapital = /^[A-Z][a-z]+$/.test(word);
      return !(index === 0 && plainCapital);
    })
    .flatMap((word) => tokens(word))
    .filter((token) => (token.length >= 3 || /\d/.test(token)) && !STOPWORDS.has(token));
}

/**
 * True when the phrase is grounded in the resume: every proper name in it
 * appears there, and most of its other meaningful words do too.
 */
export function isGrounded(phrase: string, resumeText: string): boolean {
  const resume = ` ${normalise(resumeText)} `;
  const resumeTokens = new Set(tokens(resumeText));
  const compact = resume.replace(/ /g, "");
  const has = (token: string) => resumeTokens.has(token) || (token.length >= 5 && compact.includes(token));

  const names = nameTokens(phrase);
  if (names.some((token) => !has(token))) return false;

  const words = tokens(phrase).filter((token) => token.length >= 4 && !STOPWORDS.has(token));
  if (words.length === 0) return names.length > 0;
  const found = words.filter(has).length;
  return found / words.length >= 0.6;
}

/** Total years the resume states outright ("5 years of experience", "3+ yrs exp"), if it does. */
export function statedYears(resumeText: string): number | null {
  const match = resumeText.match(
    /(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)(?:\s+of)?(?:\s+[\w-]+){0,3}?\s+(?:experience|exp)\b/i,
  );
  if (!match) return null;
  const years = Number(match[1]);
  return Number.isFinite(years) && years > 0 && years < 60 ? years : null;
}

/** The profile with every unsupported field removed; null when nothing survives. */
export function groundProfile(profile: ResumeProfile, resumeText: string): ResumeProfile | null {
  const keep = (value: string) => (value && isGrounded(value, resumeText) ? value : "");
  const stated = statedYears(resumeText);
  const grounded: ResumeProfile = {
    experienceYears: stated ?? profile.experienceYears,
    experienceNote: stated !== null ? "" : profile.experienceNote,
    currentRole: keep(profile.currentRole),
    education: keep(profile.education),
    topSkills: profile.topSkills.filter((skill) => isGrounded(skill, resumeText)),
    standouts: profile.standouts.filter((item) => isGrounded(item, resumeText)),
  };
  const empty =
    grounded.experienceYears === null &&
    !grounded.experienceNote &&
    !grounded.currentRole &&
    !grounded.education &&
    grounded.topSkills.length === 0 &&
    grounded.standouts.length === 0;
  return empty ? null : grounded;
}
