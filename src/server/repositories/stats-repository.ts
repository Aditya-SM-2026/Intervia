import "server-only";
import { Pool } from "pg";
import { estimateVoiceCost } from "@/lib/interviews/cost";
import type { SessionOutcome } from "@/lib/interviews/interview.types";
import type { DashboardStats, StatsRange, StatsRoleRow } from "@/lib/dashboard/stats.types";

/**
 * Aggregates for the Stats page. The data set is small (one row per
 * interview), so rows are read once and summarised here rather than in a
 * dozen GROUP BY queries. Without DATABASE_URL (local, in-memory mode) the
 * page shows empty stats.
 */

const globalRefs = globalThis as unknown as { __statsPgPool?: Pool };

function getPool(): Pool | null {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) return null;
  if (!globalRefs.__statsPgPool) globalRefs.__statsPgPool = new Pool({ connectionString, max: 2 });
  return globalRefs.__statsPgPool;
}

interface InterviewRow {
  id: string;
  role_id: string | null;
  role_title: string | null;
  title: string;
  status: string;
  created_at: Date;
  candidate_email: string | null;
  candidate_name: string | null;
  difficulty: string | null;
  outcome: SessionOutcome | null;
  decision: { outcome?: string } | null;
  score: string | number | null;
  legacy_score: string | number | null;
}

const SCORE_BANDS = [
  { label: "Below 40", min: 0, max: 39 },
  { label: "40–49", min: 40, max: 49 },
  { label: "50–59", min: 50, max: 59 },
  { label: "60–69", min: 60, max: 69 },
  { label: "70–79", min: 70, max: 79 },
  { label: "80+", min: 80, max: 100 },
];

function rangeStart(range: StatsRange, now: Date): Date | null {
  if (range === "all") return null;
  return new Date(now.getTime() - Number(range) * 86_400_000);
}

function num(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function startOfWeek(date: Date): Date {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = (day.getUTCDay() + 6) % 7; // Monday = 0
  day.setUTCDate(day.getUTCDate() - weekday);
  return day;
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function readDashboardStats(range: StatsRange): Promise<DashboardStats> {
  const now = new Date();
  const from = rangeStart(range, now);
  const pool = getPool();

  let interviews: InterviewRow[] = [];
  let roles: { id: string; title: string; status: string }[] = [];
  let applications: { role_id: string; created_at: Date }[] = [];
  let assistant: { room_id: string; created_at: Date; cost: string | number | null }[] = [];

  if (pool) {
    const params = from ? [from.toISOString()] : [];
    const since = from ? "WHERE i.created_at >= $1" : "";
    interviews = (
      await pool.query<InterviewRow>(
        `SELECT i.id, i.role_id, i.role_title, i.title, i.status, i.created_at, i.candidate_email,
                i.candidate_name, i.difficulty, i.outcome, i.decision,
                s.scorecard->'overall'->>'score' AS score,
                s.scorecard->>'overallScore' AS legacy_score
           FROM interviews i
           LEFT JOIN scorecards s ON s.room_id = i.id
           ${since}`,
        params,
      )
    ).rows;
    // Roles and applications live in tables the roles feature creates; a
    // database without them still gets interview stats.
    try {
      roles = (await pool.query<{ id: string; title: string; status: string }>(`SELECT id, title, status FROM roles`)).rows;
      applications = (
        await pool.query<{ role_id: string; created_at: Date }>(
          `SELECT role_id, created_at FROM role_applications ${from ? "WHERE created_at >= $1" : ""}`,
          params,
        )
      ).rows;
    } catch {
      roles = [];
      applications = [];
    }
    try {
      assistant = (
        await pool.query<{ room_id: string; created_at: Date; cost: string | number | null }>(
          `SELECT c.room_id, m.created_at, m.cost_usd AS cost
             FROM assistant_messages m
             JOIN assistant_conversations c ON c.id = m.conversation_id
            WHERE m.cost_usd IS NOT NULL ${from ? "AND m.created_at >= $1" : ""}`,
          params,
        )
      ).rows;
    } catch {
      assistant = [];
    }
  }

  // Per-interview derived values.
  const derived = interviews.map((row) => {
    const legacy = num(row.legacy_score);
    const score = num(row.score) ?? (legacy !== null ? Math.round((legacy / 5) * 100) : null);
    const hasReport = row.score !== null || row.legacy_score !== null;
    const cost = estimateVoiceCost(row.outcome);
    return {
      row,
      score,
      hasReport,
      seconds: row.status === "completed" ? (row.outcome?.elapsedSeconds ?? 0) : 0,
      voiceUsd: cost?.usd ?? 0,
      hasCost: cost !== null,
      decision: row.decision?.outcome ?? null,
    };
  });

  const assistantByRoom = new Map<string, number>();
  let assistantUsd = 0;
  for (const message of assistant) {
    const cost = num(message.cost) ?? 0;
    assistantUsd += cost;
    assistantByRoom.set(message.room_id, (assistantByRoom.get(message.room_id) ?? 0) + cost);
  }

  const completed = derived.filter((item) => item.row.status === "completed");
  const scored = derived.filter((item) => item.score !== null).map((item) => item.score as number);
  const completedSeconds = completed.map((item) => item.seconds).filter((seconds) => seconds > 0);
  const voiceUsd = derived.reduce((sum, item) => sum + item.voiceUsd, 0);
  const withCost = derived.filter((item) => item.hasCost);
  const costedSeconds = withCost.reduce((sum, item) => sum + (item.row.outcome?.elapsedSeconds ?? 0), 0);
  const candidates = new Set(
    derived.map((item) => (item.row.candidate_email ?? item.row.candidate_name ?? item.row.id).toLowerCase()),
  );

  // Roles: saved roles first, then interviews made without one, grouped by title.
  const roleRows = new Map<string, StatsRoleRow & { scores: number[] }>();
  const keyFor = (roleId: string | null, title: string) => (roleId ? `id:${roleId}` : `t:${title.trim().toLowerCase()}`);
  for (const role of roles) {
    roleRows.set(keyFor(role.id, role.title), {
      roleId: role.id,
      title: role.title,
      status: role.status,
      applications: 0,
      interviews: 0,
      completed: 0,
      avgScore: null,
      advanced: 0,
      costUsd: 0,
      scores: [],
    });
  }
  for (const application of applications) {
    const entry = roleRows.get(`id:${application.role_id}`);
    if (entry) entry.applications += 1;
  }
  for (const item of derived) {
    const title = item.row.role_title ?? item.row.title;
    const key = item.row.role_id && roleRows.has(`id:${item.row.role_id}`) ? `id:${item.row.role_id}` : keyFor(null, title);
    let entry = roleRows.get(key);
    if (!entry) {
      entry = { roleId: null, title, status: null, applications: 0, interviews: 0, completed: 0, avgScore: null, advanced: 0, costUsd: 0, scores: [] };
      roleRows.set(key, entry);
    }
    entry.interviews += 1;
    if (item.row.status === "completed") entry.completed += 1;
    if (item.score !== null) entry.scores.push(item.score);
    if (item.decision === "advance") entry.advanced += 1;
    entry.costUsd += item.voiceUsd + (assistantByRoom.get(item.row.id) ?? 0);
  }
  const roleList: StatsRoleRow[] = [...roleRows.values()]
    .filter((entry) => entry.interviews > 0 || entry.applications > 0)
    .map(({ scores, ...entry }) => ({ ...entry, avgScore: mean(scores), costUsd: round2(entry.costUsd) }))
    .sort((a, b) => b.interviews + b.applications - (a.interviews + a.applications));

  // Weekly series: the range, capped at 26 weeks so bars stay readable.
  const weeks = Math.min(26, from ? Math.ceil((now.getTime() - from.getTime()) / (7 * 86_400_000)) : 26);
  const firstWeek = startOfWeek(new Date(now.getTime() - (weeks - 1) * 7 * 86_400_000));
  const weekly = Array.from({ length: weeks }, (_, index) => {
    const start = new Date(firstWeek.getTime() + index * 7 * 86_400_000);
    return { weekStart: start.toISOString().slice(0, 10), interviews: 0, completed: 0 };
  });
  for (const item of derived) {
    const index = Math.floor((startOfWeek(new Date(item.row.created_at)).getTime() - firstWeek.getTime()) / (7 * 86_400_000));
    if (index >= 0 && index < weekly.length) {
      weekly[index].interviews += 1;
      if (item.row.status === "completed") weekly[index].completed += 1;
    }
  }

  // Monthly cost, last 6 months.
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (5 - index), 1));
    return { month: monthKey(date), voiceUsd: 0, assistantUsd: 0 };
  });
  for (const item of derived) {
    const bucket = months.find((month) => month.month === monthKey(new Date(item.row.created_at)));
    if (bucket) bucket.voiceUsd += item.voiceUsd;
  }
  for (const message of assistant) {
    const bucket = months.find((month) => month.month === monthKey(new Date(message.created_at)));
    if (bucket) bucket.assistantUsd += num(message.cost) ?? 0;
  }

  const levels = ["easy", "medium", "hard", "extra-hard"];
  const difficulty = levels
    .map((level) => {
      const items = derived.filter((item) => (item.row.difficulty ?? "medium") === level);
      return {
        level,
        count: items.length,
        avgScore: mean(items.filter((item) => item.score !== null).map((item) => item.score as number)),
      };
    })
    .filter((entry) => entry.count > 0);

  const reports = derived.filter((item) => item.hasReport).length;
  const advanced = derived.filter((item) => item.decision === "advance").length;

  return {
    range,
    generatedAt: now.toISOString(),
    totals: {
      interviews: derived.length,
      completed: completed.length,
      reports,
      candidates: candidates.size,
      applications: applications.length,
      roles: roleList.length,
      minutesInterviewed: Math.round(completedSeconds.reduce((sum, seconds) => sum + seconds, 0) / 60),
      avgScore: mean(scored),
      avgMinutes: completedSeconds.length ? Math.round(completedSeconds.reduce((a, b) => a + b, 0) / completedSeconds.length / 60) : null,
    },
    funnel: [
      { key: "applied", label: "Applied", value: applications.length },
      { key: "invited", label: "Interview sent", value: derived.length },
      { key: "completed", label: "Finished", value: completed.length },
      { key: "reports", label: "Report ready", value: reports },
      { key: "advanced", label: "Advanced", value: advanced },
    ],
    weekly,
    scoreBands: SCORE_BANDS.map((band) => ({
      ...band,
      count: scored.filter((score) => score >= band.min && score <= band.max).length,
    })),
    roles: roleList,
    decisions: {
      advance: advanced,
      hold: derived.filter((item) => item.decision === "hold").length,
      reject: derived.filter((item) => item.decision === "reject").length,
      undecided: derived.filter((item) => item.hasReport && item.decision === null).length,
    },
    difficulty,
    cost: {
      totalUsd: round2(voiceUsd + assistantUsd),
      voiceUsd: round2(voiceUsd),
      assistantUsd: round2(assistantUsd),
      perInterviewUsd: withCost.length ? round2(voiceUsd / withCost.length) : null,
      perHourUsd: costedSeconds >= 60 ? round2((voiceUsd / costedSeconds) * 3600) : null,
      interviewsWithCost: withCost.length,
      monthly: months.map((month) => ({ ...month, voiceUsd: round2(month.voiceUsd), assistantUsd: round2(month.assistantUsd) })),
    },
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
