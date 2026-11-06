/** Shape of GET /api/dashboard/stats — the Stats page. */

export type StatsRange = "30" | "90" | "365" | "all";

export interface StatsRoleRow {
  roleId: string | null;
  title: string;
  /** "open" | "completed" etc. for saved roles; null for interviews made without one. */
  status: string | null;
  applications: number;
  interviews: number;
  completed: number;
  avgScore: number | null;
  advanced: number;
  costUsd: number;
}

export interface DashboardStats {
  range: StatsRange;
  generatedAt: string;
  totals: {
    interviews: number;
    completed: number;
    reports: number;
    candidates: number;
    applications: number;
    roles: number;
    /** Sum of time candidates spent in completed interviews. */
    minutesInterviewed: number;
    avgScore: number | null;
    avgMinutes: number | null;
  };
  /** Applied → interviewed → finished → report → advanced. */
  funnel: { key: string; label: string; value: number }[];
  /** Per week, oldest first. */
  weekly: { weekStart: string; interviews: number; completed: number }[];
  scoreBands: { label: string; min: number; max: number; count: number }[];
  roles: StatsRoleRow[];
  decisions: { advance: number; hold: number; reject: number; undecided: number };
  difficulty: { level: string; count: number; avgScore: number | null }[];
  cost: {
    totalUsd: number;
    voiceUsd: number;
    assistantUsd: number;
    /** Average voice cost per interview that recorded usage. */
    perInterviewUsd: number | null;
    perHourUsd: number | null;
    interviewsWithCost: number;
    monthly: { month: string; voiceUsd: number; assistantUsd: number }[];
  };
}
