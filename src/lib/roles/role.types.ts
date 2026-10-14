import type { HumanDecision, InterviewStatus } from "@/lib/interviews/interview.types";
import type { ScoreSuggestion } from "@/lib/interviews/scorecard.types";

/** Lifecycle of a hiring role. */
export type RoleStatus = "open" | "completed";

/** A role HR is hiring for. Created and managed on the roles pages. */
export interface Role {
  id: string;
  title: string;
  description: string;
  /** Required skills and qualifications, one string each. */
  skills: string[];
  /** Hiring deadline or target closing date, YYYY-MM-DD; null when open-ended. */
  deadline: string | null;
  status: RoleStatus;
  createdAt: string;
  updatedAt: string;
}

/** Counts and score aggregates for one role, computed from real interviews. */
export interface RoleStats {
  /** Interview links associated with this role (id match or legacy title match). */
  interviews: number;
  /** Distinct candidate emails among those interviews. */
  candidates: number;
  /** Interviews whose agent session ended (status completed). */
  completed: number;
  /** Interviews not yet completed (any other status). */
  pending: number;
  /** Mean of the completed interviews' overall scores, 0-100; null when none. */
  avgOverallScore: number | null;
}

/** A role as returned by the list endpoint, with its live stats. */
export interface RoleSummary extends Role {
  stats: RoleStats;
}

/** One candidate (distinct candidate email) inside a role. */
export interface RoleCandidateSummary {
  /** Lowercased candidate email; the stable candidate identifier within a role. */
  candidateId: string;
  candidateEmail: string;
  candidateName: string | null;
  interviews: number;
  completed: number;
  pending: number;
  /** Room id of the most recent interview for this candidate in this role. */
  latestInterviewId: string;
  /** ISO 8601 creation timestamp of that interview. */
  latestInterviewAt: string;
  latestStatus: InterviewStatus;
  /** Overall score of that candidate's latest scored interview; null when unscored. */
  overallScore: number | null;
  suggestion: ScoreSuggestion | null;
  decision: HumanDecision | null;
}

/** One interview of a candidate inside a role, with its scorecard summary. */
export interface CandidateInterviewDetail {
  roomId: string;
  title: string;
  status: InterviewStatus;
  createdAt: string;
  completedAt: string | null;
  overallScore: number | null;
  suggestion: ScoreSuggestion | null;
  needsHumanReview: boolean;
  decision: HumanDecision | null;
}

/** A candidate's profile within one role: identity plus every interview. */
export interface RoleCandidateDetail {
  role: Role;
  candidateId: string;
  candidateEmail: string;
  candidateName: string | null;
  interviews: CandidateInterviewDetail[];
  /** Resume provenance for the latest interview that has one. */
  resume: {
    fileName: string | null;
    /** True when resume text exists and can be downloaded. */
    hasText: boolean;
  } | null;
}

/** Shape of GET /api/roles. */
export interface RolesResponse {
  roles: RoleSummary[];
}

/** Shape of GET /api/roles/[roleId]. */
export interface RoleResponse {
  role: RoleSummary;
}

/** Shape of GET /api/roles/[roleId]/candidates. */
export interface RoleCandidatesResponse {
  candidates: RoleCandidateSummary[];
  total: number;
  limit: number;
  offset: number;
}

/** Shape of GET /api/roles/[roleId]/candidates/[candidateId]. */
export interface RoleCandidateResponse {
  candidate: RoleCandidateDetail;
}