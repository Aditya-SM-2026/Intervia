import type { HumanDecision, InterviewStatus } from "@/lib/interviews/interview.types";
import type { ScoreSuggestion } from "@/lib/interviews/scorecard.types";
import type { RoleStats } from "@/lib/roles/role.types";

/**
 * Pure candidate aggregation shared by the in-memory repository and the
 * unit tests: no database, no server-only imports.
 *
 * A candidate is one lowercased candidate email inside one role. The latest
 * interview (by createdAt, then id) carries the candidate's status, score
 * and decision; counts cover every interview of that candidate in the role.
 */

/** The fields of an interview the aggregation needs. */
export interface AggregationInterview {
  id: string;
  title: string;
  candidateName: string | null;
  candidateEmail: string | null;
  status: string;
  createdAt: string;
  completedAt: string | null;
  decision: HumanDecision | null;
  resumeFileName: string | null;
  resumeText: string | null;
  /** Role association: id (new) or legacy title match. */
  roleId: string | null;
  roleTitle: string | null;
}

/** The fields of a scorecard summary the aggregation needs. */
export interface AggregationScorecard {
  overallScore: number | null;
  suggestion: string;
  needsHumanReview: boolean;
}

/** True when the interview belongs to the role (id match or legacy title). */
export function matchesRoleAssociation(
  roleId: string,
  roleTitle: string,
  interview: Pick<AggregationInterview, "roleId" | "roleTitle">,
): boolean {
  if (interview.roleId === roleId) return true;
  return interview.roleId === null && interview.roleTitle === roleTitle;
}

export function parseSuggestion(value: string | null | undefined): ScoreSuggestion | null {
  return value === "strong" ||
    value === "positive" ||
    value === "mixed" ||
    value === "weak" ||
    value === "insufficient"
    ? value
    : null;
}

export interface AggregatedCandidate {
  roomId: string;
  candidateId: string;
  candidateEmail: string;
  candidateName: string | null;
  interviews: number;
  completed: number;
  latestStatus: InterviewStatus;
  latestInterviewAt: string;
  overallScore: number | null;
  suggestion: ScoreSuggestion | null;
  decision: HumanDecision | null;
}

/** One interview row of a candidate inside a role (detail views). */
export interface CandidateInterviewRow {
  roomId: string;
  title: string;
  status: InterviewStatus;
  createdAt: string;
  completedAt: string | null;
  candidateName: string | null;
  hasResume: boolean;
  overallScore: number | null;
  suggestion: ScoreSuggestion | null;
  needsHumanReview: boolean;
  decision: HumanDecision | null;
}

/**
 * Groups the role's interviews by candidate email, newest interview first.
 * `pending` is derived by the caller: interviews - completed.
 */
export function aggregateCandidates(
  roleId: string,
  roleTitle: string,
  interviews: readonly AggregationInterview[],
  scorecards: ReadonlyMap<string, AggregationScorecard>,
): AggregatedCandidate[] {
  const latest = new Map<string, AggregationInterview>();
  const counts = new Map<string, { interviews: number; completed: number }>();
  const names = new Map<string, string | null>();

  for (const interview of interviews) {
    if (!matchesRoleAssociation(roleId, roleTitle, interview)) continue;
    const email = interview.candidateEmail?.trim().toLowerCase() ?? "";
    if (email === "") continue;
    counts.set(email, {
      interviews: (counts.get(email)?.interviews ?? 0) + 1,
      completed:
        (counts.get(email)?.completed ?? 0) + (interview.status === "completed" ? 1 : 0),
    });
    if (!names.has(email) || (interview.candidateName !== null && names.get(email) === null)) {
      names.set(email, interview.candidateName);
    }
    const current = latest.get(email);
    const isNewer =
      !current ||
      interview.createdAt > current.createdAt ||
      (interview.createdAt === current.createdAt && interview.id > current.id);
    if (isNewer) latest.set(email, interview);
  }

  const rows = [...latest.entries()].map(([email, interview]) => {
    const scorecard = scorecards.get(interview.id);
    const count = counts.get(email)!;
    return {
      roomId: interview.id,
      candidateId: email,
      candidateEmail: email,
      candidateName: names.get(email) ?? null,
      interviews: count.interviews,
      completed: count.completed,
      latestStatus: interview.status as InterviewStatus,
      latestInterviewAt: interview.createdAt,
      overallScore: scorecard?.overallScore ?? null,
      suggestion: parseSuggestion(scorecard?.suggestion ?? null),
      decision: interview.decision,
    };
  });

  return rows.sort(
    (a, b) =>
      b.latestInterviewAt.localeCompare(a.latestInterviewAt) || b.roomId.localeCompare(a.roomId),
  );
}

/** Mean of completed interviews' overall scores, rounded; null when none. */
export function computeRoleStats(
  roleId: string,
  roleTitle: string,
  interviews: readonly AggregationInterview[],
  scorecards: ReadonlyMap<string, AggregationScorecard>,
): RoleStats {
  const associated = interviews.filter((interview) =>
    matchesRoleAssociation(roleId, roleTitle, interview),
  );
  const emails = new Set(
    associated
      .map((interview) => interview.candidateEmail?.trim().toLowerCase() ?? "")
      .filter((email) => email !== ""),
  );
  const completed = associated.filter((interview) => interview.status === "completed");
  const scored = completed
    .map((interview) => scorecards.get(interview.id)?.overallScore)
    .filter((score): score is number => typeof score === "number");
  return {
    interviews: associated.length,
    candidates: emails.size,
    completed: completed.length,
    pending: associated.length - completed.length,
    avgOverallScore:
      scored.length === 0
        ? null
        : Math.round(scored.reduce((sum, score) => sum + score, 0) / scored.length),
  };
}