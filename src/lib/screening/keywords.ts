/**
 * Free skill matching: the chips shown next to the score, and the fallback
 * when the model cannot be reached.
 *
 * This is deliberately NOT a filter. A resume that says "AWS" against a role
 * that says "Amazon Web Services" used to be dropped before anything that
 * understands words read it. The alias groups below exist so the chips are
 * useful, not so they can decide who gets screened.
 */

import type { KeywordMatch } from "./types.ts";

/**
 * Surface forms of the same skill. Any resume or role form in a group matches
 * any other. Keep this list small and obvious; the model covers the rest.
 */
const ALIAS_GROUPS: readonly (readonly string[])[] = [
  ["aws", "amazon web services", "amazon aws"],
  ["gcp", "google cloud", "google cloud platform"],
  ["azure", "microsoft azure"],
  ["js", "javascript", "ecmascript"],
  ["ts", "typescript"],
  ["node", "nodejs", "node.js"],
  ["react", "reactjs", "react.js"],
  ["vue", "vuejs", "vue.js"],
  ["angular", "angularjs"],
  ["next", "nextjs", "next.js"],
  ["postgres", "postgresql", "psql"],
  ["mongo", "mongodb"],
  ["k8s", "kubernetes"],
  ["ml", "machine learning"],
  ["ai", "artificial intelligence"],
  ["nlp", "natural language processing"],
  ["ci/cd", "cicd", "continuous integration", "continuous delivery"],
  ["rest", "rest api", "restful", "rest apis"],
  ["sql", "structured query language"],
  ["html", "html5"],
  ["css", "css3"],
  ["sap", "sap erp"],
  ["ui/ux", "ui ux", "ux/ui", "user experience"],
  ["power bi", "powerbi"],
  ["ms excel", "microsoft excel", "excel"],
  ["git", "github", "gitlab"],
];

/** Lowercase, collapse spaces, drop a trailing ".js" style punctuation. */
function surface(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[\s.,;:()[\]]+|[\s.,;:()[\]]+$/g, "")
    .trim();
}

/** Every way this skill is likely to be written, itself included. */
export function skillTerms(skill: string): string[] {
  const key = surface(skill);
  if (key === "") return [];
  const group = ALIAS_GROUPS.find((forms) => forms.includes(key));
  return group ? [...group] : [key];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Matches a term on word boundaries without treating punctuation as part of
 * the word, so "React" does not match inside "Reactive" and "AWS" does not
 * match inside "laws".
 */
export function containsTerm(normalisedText: string, term: string): boolean {
  if (term === "") return false;
  const pattern = new RegExp(`(^|[^a-z0-9+#])${escapeRegExp(term)}([^a-z0-9+#]|$)`, "i");
  return pattern.test(normalisedText);
}

function normaliseResume(text: string): string {
  return ` ${text.toLowerCase().replace(/\s+/g, " ")} `;
}

/** Which of the role's skills the resume mentions, and which it does not. */
export function keywordMatch(resumeText: string, skills: readonly string[]): KeywordMatch {
  const text = normaliseResume(resumeText);
  const matched: string[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();

  for (const skill of skills) {
    const label = skill.trim();
    const key = surface(label);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    const hit = skillTerms(label).some((term) => containsTerm(text, term));
    (hit ? matched : missing).push(label);
  }

  return { matched, missing };
}
