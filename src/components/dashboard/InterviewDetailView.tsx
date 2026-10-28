"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { estimateVoiceCost } from "@/lib/interviews/cost";
import type {
  HumanDecision,
  InterviewEvent,
  InterviewRoom,
  InterviewStatus,
  InterviewTurn,
  VoiceMode,
} from "@/lib/interviews/interview.types";
import type { PlanCompetency } from "@/lib/interviews/plan.types";
import type {
  AnswerGaze,
  FactorId,
  GazeDirection,
  InterviewDetailResponse,
  PeerSummary,
  ResumeVerdict,
  Scorecard,
  ScoreEvidence,
  VideoMoment,
} from "@/lib/interviews/scorecard.types";
import { FACTOR_META } from "./factors";
import { buildReportInsights, type ReportInsights } from "@/lib/interviews/report-insights";
import { GAZE_GRID, GAZE_LABEL } from "./gaze";
import {
  AlertTriangle,
  AudioLines,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSearch,
  FileText,
  Fingerprint,
  Gauge,
  MessagesSquare,
  ScrollText,
  Search,
  Users,
  Video,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * One interview for the recruiter. A header card, the overall score with its
 * four factors, then the evidence behind each factor: the answers, the resume
 * claims, the originality signals, the recording and the transcript.
 */

const DECISION_OPTIONS: { value: HumanDecision["outcome"]; label: string }[] = [
  { value: "advance", label: "Advance" },
  { value: "hold", label: "Hold" },
  { value: "reject", label: "Reject" },
];

const DECISION_LABELS = { advance: "Advanced", hold: "On hold", reject: "Rejected" } as const;

const END_REASONS: Record<string, string> = {
  interviewer_ended: "Completed by the interviewer",
  time_up: "Ended at the time limit",
  candidate_left: "Candidate left early",
  session_closed: "Session closed unexpectedly",
};

const VERDICT_LABELS: Record<ResumeVerdict, string> = {
  confirmed: "Supported",
  partly_supported: "Partly supported",
  not_supported: "Not supported",
  not_discussed: "Not discussed",
};

const VERDICT_TONES: Record<ResumeVerdict, Tone> = {
  confirmed: "good",
  partly_supported: "warn",
  not_supported: "bad",
  not_discussed: "muted",
};

const STATUS_META: Record<InterviewStatus, { label: string; tone: Tone }> = {
  scheduled: { label: "Scheduled", tone: "muted" },
  waiting: { label: "Waiting to join", tone: "warn" },
  active: { label: "Live", tone: "warn" },
  completed: { label: "Completed", tone: "good" },
  expired: { label: "Expired", tone: "muted" },
  cancelled: { label: "Cancelled", tone: "bad" },
};

type Tone = "good" | "warn" | "bad" | "muted";

const CHIP_TONES: Record<Tone, string> = {
  good: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  bad: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400",
  muted: "border-border bg-surface text-muted",
};

const STROKE_TONES: Record<Tone, string> = {
  good: "text-emerald-500",
  warn: "text-amber-500",
  bad: "text-red-500",
  muted: "text-muted",
};

const FACTOR_TONES: Record<FactorId, { tile: string; bar: string }> = {
  answers: { tile: "bg-accent/10 text-accent", bar: "bg-accent" },
  resume: {
    tile: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    bar: "bg-violet-500",
  },
  authenticity: {
    tile: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    bar: "bg-emerald-500",
  },
  video: { tile: "bg-amber-500/10 text-amber-600 dark:text-amber-400", bar: "bg-amber-500" },
};

const FACTOR_ICONS: Record<FactorId, LucideIcon> = {
  answers: MessagesSquare,
  resume: FileSearch,
  authenticity: Fingerprint,
  video: Video,
};

const cardClasses = "rounded-2xl border border-border bg-surface p-5 sm:p-6";
const mutedCardClasses = "rounded-xl border border-border bg-background/40";

/** Sections of the report, in reading order — the rail keeps them one click away. */
const REPORT_SECTIONS = [
  ["overview", "Overview", Gauge],
  ["answers", "Answer quality", MessagesSquare],
  ["resume", "Resume match", FileSearch],
  ["authenticity", "Own answers", Fingerprint],
  ["video", "On-camera", Video],
  ["transcript", "Transcript", ScrollText],
  ["voice", "Voice session", AudioLines],
  ["peers", "Other interviews", Users],
] as const satisfies readonly (readonly [string, string, LucideIcon])[];

/** Left rail: pinned on desktop, follows the section you are reading. */
function ReportNav({ candidateName, score }: { candidateName: string; score: number | null }) {
  const [activeId, setActiveId] = useState<string>(REPORT_SECTIONS[0][0]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveId(entry.target.id);
        }
      },
      { rootMargin: "-15% 0px -65% 0px", threshold: 0 },
    );
    for (const [id] of REPORT_SECTIONS) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <nav aria-label="Report sections" className="sticky top-6 hidden lg:block">
      <div className="rounded-2xl border border-border bg-surface p-2.5">
        <p className="truncate px-3 pb-2 pt-1 text-[11px] font-medium text-muted">
          {candidateName}
          {score !== null && <span className="ml-1 tabular-nums">· {score}/100</span>}
        </p>
        <ul className="grid gap-0.5">
          {REPORT_SECTIONS.map(([id, label, Icon]) => {
            const active = id === activeId;
            return (
              <li key={id}>
                <a
                  href={`#${id}`}
                  aria-current={active ? "true" : undefined}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] transition ${
                    active
                      ? "bg-accent/10 font-medium text-foreground"
                      : "text-muted hover:bg-accent/5 hover:text-foreground"
                  }`}
                >
                  <Icon className={`size-4 shrink-0 ${active ? "text-accent" : ""}`} />
                  <span className="truncate">{label}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

const alertClasses =
  "rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400";

async function fetchDetail(
  path: string,
  method: "GET" | "POST",
): Promise<InterviewDetailResponse | "unauthorized"> {
  const response = await fetch(path, { method });
  if (response.status === 401) return "unauthorized";
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message ?? "Could not load this interview.");
  return data as InterviewDetailResponse;
}

export function InterviewDetailView({ roomId }: { roomId: string }) {
  const [detail, setDetail] = useState<InterviewDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    fetchDetail(`/api/dashboard/interviews/${roomId}`, "GET")
      .then((result) => {
        if (cancelled) return;
        if (result === "unauthorized") router.replace(`/login?next=/dashboard/${roomId}`);
        else setDetail(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Could not load this interview.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [roomId, router]);

  async function handleRegenerate() {
    setIsRegenerating(true);
    try {
      const result = await fetchDetail(`/api/dashboard/interviews/${roomId}/regenerate`, "POST");
      if (result === "unauthorized") router.replace(`/login?next=/dashboard/${roomId}`);
      else {
        setDetail(result);
        setError(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not regenerate the scorecard.");
    } finally {
      setIsRegenerating(false);
    }
  }

  /** Jumps the recording to a moment and brings the player into view. */
  function playFrom(seconds: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, seconds);
    void video.play().catch(() => {});
    video.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  if (error && !detail) {
    return (
      <div className="grid gap-3">
        <BackLink />
        <p role="alert" className={alertClasses}>
          {error}
        </p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="grid gap-3" aria-busy="true">
        <BackLink />
        <p className="text-sm text-muted">
          Loading the interview. A new scorecard can take a minute or two…
        </p>
        {[0, 1, 2].map((index) => (
          <div key={index} className="h-28 animate-pulse rounded-2xl border border-border bg-surface" />
        ))}
      </div>
    );
  }

  const { session, turns, events, scorecard, reason, peers, hasRecording } = detail;
  const competencies = session.plan?.competencies ?? [];
  const insights = scorecard ? buildReportInsights({ session, scorecard, turns, peers }) : null;
  // Where the recording timeline begins. Older recordings carry the upload
  // time rather than the moment capture started, so the interview's own start
  // is used when it is earlier — offsets past the file are no use to anyone.
  const timelineStart =
    [detail.recordingStartedAt, session.outcome?.startedAt, turns[0]?.startedAt ?? null]
      .filter((value): value is string => Boolean(value))
      .sort()[0] ?? null;
  /** Seconds into the recording at which a transcript turn starts. */
  const recordingOffset = (turn: InterviewTurn): number | null =>
    hasRecording && timelineStart && turn.startedAt
      ? Math.max(0, (Date.parse(turn.startedAt) - Date.parse(timelineStart)) / 1000)
      : null;

  return (
    <div className="grid gap-6">
      <BackLink />
      <Header
        session={session}
        peers={peers}
        roomId={roomId}
        canDownload={scorecard !== null}
      />
      {error && (
        <p role="alert" className={alertClasses}>
          {error}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start">
        <ReportNav
          candidateName={session.candidateName || "Candidate"}
          score={scorecard?.overall?.score ?? null}
        />
        <div className="grid min-w-0 gap-6">
          {scorecard ? (
            <>
              <OverallAssessment scorecard={scorecard} insights={insights} />
              <SummaryPanel scorecard={scorecard} insights={insights} />
              <DecisionPanel
                roomId={roomId}
                decision={session.decision}
                onSaved={(decision) => setDetail({ ...detail, session: { ...session, decision } })}
              />
              <AnswerQualityTable
                scorecard={scorecard}
                competencies={competencies}
                turns={turns}
                offsetFor={recordingOffset}
                onPlay={playFrom}
              />
              <ResumeTable scorecard={scorecard} turns={turns} competencies={competencies} />
              <OwnAnswersPanel scorecard={scorecard} />
              {/* The recording section holds a wide table; let it scroll on its
                  own rather than stretching the whole report sideways. */}
              <div className="min-w-0 overflow-x-auto">
                <VideoSection
                  scorecard={scorecard}
                  hasRecording={hasRecording}
                  roomId={roomId}
                  videoRef={videoRef}
                  durationSeconds={session.outcome?.elapsedSeconds ?? null}
                  onPlay={playFrom}
                />
              </div>
            </>
          ) : (
            <>
              <section className={cardClasses}>
                <CardHeading icon={Gauge} title="Scorecard" />
                <p className="mt-2 text-sm">
                  {reason ?? "No scorecard is available for this interview yet."}
                </p>
              </section>
              {competencies.length > 0 && <PlanPreview competencies={competencies} />}
            </>
          )}

          <Transcript
            turns={turns}
            competencies={competencies}
            offsetFor={recordingOffset}
            onPlay={playFrom}
          />

          <VoicePanel session={session} events={events} hasRecording={hasRecording} />

          {scorecard && <PeersPanel peers={peers} currentId={roomId} />}

          <footer className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
            <span>
              {scorecard
                ? `Scored ${formatDateTime(scorecard.generatedAt)} with ${scorecard.model}. `
                : ""}
              {turns.length} turns and {events.length} logged events. {recordingNote(events)}
            </span>
            {session.status === "completed" && (
              <button
                type="button"
                onClick={handleRegenerate}
                disabled={isRegenerating}
                className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isRegenerating ? "Scoring…" : scorecard ? "Regenerate scorecard" : "Generate scorecard"}
              </button>
            )}
          </footer>
        </div>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/dashboard"
      className="w-fit text-sm text-muted transition hover:text-foreground"
    >
      ← All interviews
    </Link>
  );
}

/** Small coloured square with an icon, used at the head of every card. */
function CardHeading({
  icon: Icon,
  title,
  note,
  right,
}: {
  icon: LucideIcon;
  title: string;
  note?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
          <Icon className="size-4" />
        </span>
        <div>
          <h2 className="text-lg font-semibold leading-6">{title}</h2>
          {note && <p className="mt-0.5 text-sm text-muted">{note}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}

/** The heading the video section already used. Kept as-is so it reads the same. */
function SectionHeading({ title, note }: { title: string; note: string }) {
  return (
    <>
      <h2 className="text-2xl font-semibold">{title}</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">{note}</p>
    </>
  );
}

function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${CHIP_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

function Header({
  session,
  peers,
  roomId,
  canDownload,
}: {
  session: InterviewRoom;
  peers: PeerSummary[];
  roomId: string;
  canDownload: boolean;
}) {
  const outcome = session.outcome;
  const status = STATUS_META[session.status];
  const position = peers.findIndex((peer) => peer.roomId === roomId);
  const previous = position > 0 ? peers[position - 1] : null;
  const next = position >= 0 && position < peers.length - 1 ? peers[position + 1] : null;

  const facts: [string, string][] = [
    ["Interviewed by", session.recruiterName || "—"],
    [
      "Date",
      session.completedAt
        ? formatDateTime(session.completedAt)
        : session.scheduledAt
          ? formatDateTime(session.scheduledAt)
          : "Not scheduled",
    ],
    [
      "Duration",
      outcome
        ? `${formatDuration(outcome.elapsedSeconds)} of ${session.durationMinutes} min`
        : `${session.durationMinutes} min planned`,
    ],
    ["Outcome", outcome ? (END_REASONS[outcome.reason] ?? outcome.reason) : "Not finished"],
  ];

  return (
    <header className={`${cardClasses} !p-4 sm:!p-5`}>
      <div className="flex flex-wrap items-start gap-4">
        <span
          aria-hidden
          className="grid size-14 shrink-0 place-items-center rounded-full bg-accent/10 text-xl font-semibold uppercase text-accent"
        >
          {initials(session.candidateName)}
        </span>

        <div className="min-w-0 flex-1 basis-64">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold leading-tight">
              {session.candidateName || "Candidate"}
            </h1>
            <Chip tone={status.tone}>{status.label}</Chip>
            {position >= 0 && peers.length > 1 && (
              <span className="text-xs text-muted">
                {position + 1} of {peers.length} interviews
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-muted">
            {session.roleTitle || session.title}
            {session.candidateEmail ? ` · ${session.candidateEmail}` : ""}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:flex sm:flex-wrap sm:gap-x-7 sm:gap-y-2">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt className="text-muted">{label}</dt>
                <dd className="mt-0.5 font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {canDownload && (
            <a
              href={`/api/dashboard/interviews/${roomId}/report/download`}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition hover:border-accent"
            >
              <Download className="size-4" />
              Download report
            </a>
          )}
          <div className="flex items-center rounded-lg border border-border">
            <a
              href={previous ? `/dashboard/${previous.roomId}` : undefined}
              aria-disabled={previous === null}
              aria-label="Previous interview"
              className={`grid size-9 place-items-center rounded-l-lg ${
                previous
                  ? "text-muted transition hover:text-foreground"
                  : "pointer-events-none text-muted/40"
              }`}
            >
              <ChevronLeft className="size-4" />
            </a>
            <span className="h-6 w-px bg-border" aria-hidden />
            <a
              href={next ? `/dashboard/${next.roomId}` : undefined}
              aria-disabled={next === null}
              aria-label="Next interview"
              className={`grid size-9 place-items-center rounded-r-lg ${
                next ? "text-muted transition hover:text-foreground" : "pointer-events-none text-muted/40"
              }`}
            >
              <ChevronRight className="size-4" />
            </a>
          </div>
        </div>
      </div>
    </header>
  );
}

/** The overall score as a ring, with the four factors beside it. */
function OverallAssessment({
  scorecard,
  insights,
}: {
  scorecard: Scorecard;
  insights: ReportInsights | null;
}) {
  const overall = scorecard.overall;

  if (!overall) {
    return (
      <section id="overview" className={`${cardClasses} scroll-mt-24`}>
        <CardHeading icon={Gauge} title="Overall assessment" />
        <p className="mt-4 font-display text-5xl font-semibold leading-none tabular-nums">
          {scorecard.overallScore === null ? "–" : scorecard.overallScore.toFixed(1)}
          <span className="text-lg font-normal text-muted"> of 5</span>
        </p>
        <p className="mt-3 max-w-xl text-sm text-muted">
          This scorecard was made before resume match, own-answer signals and on-camera
          analysis were added. Regenerate it, at the bottom of the page, to get the full
          analysis and an overall score.
        </p>
      </section>
    );
  }

  const score = overall.score;
  const band = scoreBand(score);

  return (
    <section id="overview" className={`${cardClasses} scroll-mt-24`}>
      <CardHeading
        icon={Gauge}
        title="Overall assessment"
        right={
          insights?.hireBand.label ? (
            <Chip tone={hireBandTone(insights.hireBand.band)}>{insights.hireBand.label}</Chip>
          ) : undefined
        }
      />

      <div className="mt-5 grid gap-5 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <div className={`${mutedCardClasses} flex flex-col items-center justify-center gap-2 p-5`}>
          <ScoreRing score={score} tone={band.tone} />
          <Chip tone={band.tone}>{band.label}</Chip>
          <p className="mt-1 text-center text-[11px] leading-relaxed text-muted">
            A weighted average of the factors that could be scored. It advises; the decision
            is yours.
          </p>
        </div>

        <ul className="grid content-start gap-4">
          {overall.factors.map((factor) => {
            const meta = FACTOR_META[factor.id];
            const chip = factorChip(factor.id, factor.score);
            const Icon = FACTOR_ICONS[factor.id];
            return (
              <li key={factor.id}>
                <div className="flex items-center gap-3">
                  <span
                    className={`grid size-7 shrink-0 place-items-center rounded-lg ${FACTOR_TONES[factor.id].tile}`}
                  >
                    <Icon className="size-4" />
                  </span>
                  <a href={`#${factorLink(factor.id)}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:text-accent">
                    {meta.name}
                  </a>
                  <span className="shrink-0 text-sm tabular-nums">
                    {factor.score === null ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <>
                        <span className="text-base font-semibold">{factor.score}</span>
                        <span className="text-muted">/100</span>
                      </>
                    )}
                  </span>
                  <Chip tone={chip.tone}>{chip.label}</Chip>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-border" aria-hidden="true">
                  {factor.score !== null && (
                    <div
                      className={`h-full rounded-full ${FACTOR_TONES[factor.id].bar}`}
                      style={{ width: `${Math.max(2, factor.score)}%` }}
                    />
                  )}
                </div>
                {factor.score === null && (
                  <p className="mt-1 text-[11px] text-muted">Left out of the total.</p>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {scorecard.needsHumanReview && (
        <p className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          Check the evidence before deciding: graders disagreed, or some evidence could not be
          verified.
        </p>
      )}
      {insights?.benchmark.label && (
        <p className="mt-3 text-xs text-muted">{insights.benchmark.label}</p>
      )}
    </section>
  );
}

function ScoreRing({ score, tone }: { score: number | null; tone: Tone }) {
  const radius = 62;
  const circumference = 2 * Math.PI * radius;
  const filled = score === null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  return (
    <div className="relative size-[148px]">
      <svg viewBox="0 0 148 148" className={`size-full -rotate-90 ${STROKE_TONES[tone]}`}>
        <circle cx="74" cy="74" r={radius} fill="none" strokeWidth="10" className="stroke-border" />
        <circle
          cx="74"
          cy="74"
          r={radius}
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          stroke="currentColor"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - filled)}
          className="transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <p className="font-display text-4xl font-semibold tabular-nums leading-none">
          {score ?? "–"}
          <span className="text-base font-normal text-muted">/100</span>
        </p>
      </div>
    </div>
  );
}

function SummaryPanel({
  scorecard,
  insights,
}: {
  scorecard: Scorecard;
  insights: ReportInsights | null;
}) {
  return (
    <section id="summary" className={`${cardClasses} scroll-mt-24`}>
      <CardHeading icon={FileText} title="Summary" />
      <p className="mt-3 text-sm leading-relaxed">{plain(scorecard.summary)}</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <PointList
          title="Strengths"
          items={scorecard.strengths}
          tone="good"
          empty="Nothing stood out as a strength."
        />
        <PointList
          title="Areas of concern"
          items={scorecard.concerns}
          tone="bad"
          empty="No concerns were recorded."
        />
      </div>

      {insights && (
        <p className="mt-3 text-xs text-muted">
          Coverage: {insights.coverage.scored} of {insights.coverage.planned} planned questions
          scored{insights.coverage.skipped > 0 ? `, ${insights.coverage.skipped} never reached` : ""}.
        </p>
      )}

      <details className="group mt-4 rounded-xl border border-border">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium">
          <span className="flex items-center gap-2">
            <span className="grid size-5 place-items-center rounded-full border border-border text-[10px] text-muted">
              i
            </span>
            About this assessment
          </span>
          <ChevronDown className="size-4 text-muted transition group-open:rotate-180" />
        </summary>
        <div className="grid gap-4 border-t border-border px-4 py-4 text-sm">
          {scorecard.notes.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Data quality</p>
              <ul className="mt-1.5 grid gap-1.5">
                {scorecard.notes.map((note) => (
                  <li key={note} className="text-sm text-muted">
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Integrity signals</p>
            <dl className="mt-1.5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniStat label="Tab hidden" value={`${scorecard.integrity.tabHiddenCount}×`} />
              <MiniStat label="Tab hidden time" value={`${Math.round(scorecard.integrity.tabHiddenSeconds)} s`} />
              <MiniStat label="Window blur" value={`${scorecard.integrity.windowBlurCount}×`} />
              <MiniStat
                label="Disconnects"
                value={String(scorecard.integrity.candidateDisconnects)}
              />
            </dl>
            {insights && insights.redFlags.items.length > 0 && (
              <ul className="mt-2 grid gap-1 text-xs text-muted">
                {insights.redFlags.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </div>

          {insights && insights.nextSteps.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Next steps</p>
              <ul className="mt-1.5 grid gap-1.5">
                {insights.nextSteps.map((step) => (
                  <li key={step} className="text-sm text-muted">
                    {step}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {scorecard.costGuard && (
            <p className="rounded-lg border border-border bg-background/40 px-3 py-2 text-xs text-muted">
              Deeper analyses were skipped to save cost: {scorecard.costGuard.reason}{" "}
              ≈ ${scorecard.costGuard.estimatedUsd.toFixed(2)} saved.
            </p>
          )}
        </div>
      </details>
    </section>
  );
}

function PointList({
  title,
  items,
  tone,
  empty,
}: {
  title: string;
  items: string[];
  tone: Tone;
  empty: string;
}) {
  const Icon = tone === "good" ? Check : AlertTriangle;
  return (
    <div
      className={`rounded-xl border p-4 ${
        tone === "good"
          ? "border-emerald-500/30 bg-emerald-500/[0.04]"
          : "border-red-500/30 bg-red-500/[0.04]"
      }`}
    >
      <p className="text-sm font-semibold">{title}</p>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="mt-2 grid gap-2">
          {items.map((item) => (
            <li key={item} className="flex gap-2 text-sm">
              <Icon
                className={`mt-0.5 size-4 shrink-0 ${
                  tone === "good"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
                }`}
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="mt-0.5 font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function DecisionPanel({
  roomId,
  decision,
  onSaved,
}: {
  roomId: string;
  decision: HumanDecision | null;
  onSaved: (decision: HumanDecision) => void;
}) {
  const [outcome, setOutcome] = useState<HumanDecision["outcome"] | null>(decision?.outcome ?? null);
  const [note, setNote] = useState(decision?.note ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!outcome) return;
    setIsSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/dashboard/interviews/${roomId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome, note }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message ?? "Could not save the decision.");
      onSaved(data.decision as HumanDecision);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the decision.");
    } finally {
      setIsSaving(false);
    }
  }

  const unchanged = decision !== null && decision.outcome === outcome && decision.note === note;

  return (
    <section className={cardClasses}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Interview decision</h2>
        <span className="text-xs text-muted">
          {decision ? `Saved ${formatDateTime(decision.decidedAt)}.` : "Visible to the hiring team."}
        </span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {DECISION_OPTIONS.map((option) => {
          const selected = outcome === option.value;
          const selectedClasses =
            option.value === "advance"
              ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : option.value === "hold"
                ? "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                : "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-400";
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => setOutcome(option.value)}
              className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition ${
                selected ? selectedClasses : "border-border text-muted hover:text-foreground"
              }`}
            >
              <span
                className={`grid size-5 place-items-center rounded-full border ${
                  selected ? "border-current" : "border-border"
                }`}
              >
                {selected && <Check className="size-3" />}
              </span>
              {option.label}
            </button>
          );
        })}
      </div>

      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={2000}
        rows={2}
        placeholder="Reason for the decision (optional)"
        aria-label="Reason for the decision"
        className="mt-3 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-accent"
      />
      {error && (
        <p role="alert" className={`mt-2 ${alertClasses}`}>
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={!outcome || isSaving || unchanged}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving ? "Saving…" : "Save decision"}
        </button>
        <span className="text-xs text-muted">The scores advise. The decision is yours.</span>
      </div>
    </section>
  );
}

function AnswerQualityTable({
  scorecard,
  competencies,
  turns,
  offsetFor,
  onPlay,
}: {
  scorecard: Scorecard;
  competencies: PlanCompetency[];
  turns: InterviewTurn[];
  offsetFor: (turn: InterviewTurn) => number | null;
  onPlay: (seconds: number) => void;
}) {
  const bySeq = new Map(turns.map((turn) => [turn.seq, turn]));
  const overallChip = factorChip("answers", scorecard.answerQuality ?? null);

  return (
    <section id="answers" className={`${cardClasses} scroll-mt-24`}>
      <CardHeading
        icon={MessagesSquare}
        title="Answer quality"
        note="Each planned question, scored against the rating scale for this role. Every score quotes the candidate."
        right={
          <span className="flex items-center gap-2 text-sm tabular-nums">
            <span className="font-semibold">
              {scorecard.answerQuality === null || scorecard.answerQuality === undefined
                ? "–"
                : `${scorecard.answerQuality}/100`}
            </span>
            <Chip tone={overallChip.tone}>{overallChip.label}</Chip>
          </span>
        }
      />

      {scorecard.competencies.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No answers were scored for this interview.</p>
      ) : (
        <div className="mt-4 overflow-hidden rounded-xl border border-border">
          <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="border-b border-border bg-background/40 text-left text-xs text-muted">
                <th className="w-10 px-3 py-2.5 text-center font-medium">#</th>
                <th className="px-3 py-2.5 font-medium">Question</th>
                <th className="w-20 px-3 py-2.5 font-medium">Score</th>
                <th className="hidden px-3 py-2.5 font-medium md:table-cell">Key feedback</th>
                <th className="hidden w-32 px-3 py-2.5 font-medium sm:table-cell">Jump to</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {scorecard.competencies.map((score, index) => {
                const plan = competencies.find((item) => item.id === score.competencyId);
                const window = evidenceWindow(score.evidence, bySeq, offsetFor);
                const tone = scoreTone(score.score);
                return (
                  <tr key={score.competencyId} className="align-top">
                    <td className="px-3 py-3 text-center text-xs tabular-nums text-muted">
                      {index + 1}
                    </td>
                    <td className="px-3 py-3">
                      <p className="line-clamp-2 font-medium">{plan?.question ?? score.name}</p>
                      {plan && <p className="mt-0.5 text-xs text-muted">{score.name}</p>}
                      <p className="mt-1 text-xs text-muted md:hidden">
                        {firstSentence(score.rationale)}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums ${
                          tone === "good"
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                            : tone === "warn"
                              ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                              : tone === "bad"
                                ? "bg-red-500/10 text-red-700 dark:text-red-400"
                                : "bg-border/60 text-muted"
                        }`}
                      >
                        {score.score === null ? "–" : `${score.score * 2}/10`}
                      </span>
                    </td>
                    <td className="hidden px-3 py-3 text-muted md:table-cell">
                      <span className="line-clamp-3">{firstSentence(score.rationale)}</span>
                    </td>
                    <td className="hidden px-3 py-3 sm:table-cell">
                      {window ? (
                        <button
                          type="button"
                          onClick={() => onPlay(window.from)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs tabular-nums text-muted transition hover:border-accent hover:text-foreground"
                        >
                          <Video className="size-3.5" />
                          {formatClock(window.from)}–{formatClock(window.to)}
                        </button>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ResumeTable({
  scorecard,
  turns,
  competencies,
}: {
  scorecard: Scorecard;
  turns: InterviewTurn[];
  competencies: PlanCompetency[];
}) {
  const resume = scorecard.resumeMatch;
  if (!resume) return null;
  const questionOf = new Map<string, number>();
  competencies.forEach((item, index) => questionOf.set(item.id, index + 1));
  const turnToQuestion = new Map<number, number>();
  for (const turn of turns) {
    if (turn.competencyId && questionOf.has(turn.competencyId)) {
      turnToQuestion.set(turn.seq, questionOf.get(turn.competencyId) as number);
    }
  }
  const chip = factorChip("resume", resume.score);

  return (
    <section id="resume" className={`${cardClasses} scroll-mt-24`}>
      <CardHeading
        icon={FileSearch}
        title="Resume match"
        note="How the candidate's background aligns with the role and project requirements."
        right={
          <span className="flex items-center gap-2 text-sm tabular-nums">
            <span className="font-semibold">
              {resume.score === null ? "–" : `${resume.score}/100`}
            </span>
            <Chip tone={chip.tone}>{chip.label}</Chip>
          </span>
        }
      />

      {resume.claims.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          {resume.reason ?? "No resume claims were checked for this interview."}
        </p>
      ) : (
        <div className="mt-4 overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-background/40 text-left text-xs text-muted">
                <th className="px-3 py-2.5 font-medium">Claim / skill from resume</th>
                <th className="w-36 px-3 py-2.5 font-medium">Status</th>
                <th className="hidden w-32 px-3 py-2.5 font-medium sm:table-cell">
                  Evidence from interview
                </th>
                <th className="hidden px-3 py-2.5 font-medium md:table-cell">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {resume.claims.map((claim) => {
                const questions = [
                  ...new Set(
                    claim.turnSeqs
                      .map((seq) => turnToQuestion.get(seq))
                      .filter((value): value is number => typeof value === "number"),
                  ),
                ];
                return (
                  <tr key={claim.claim} className="align-top">
                    <td className="px-3 py-3 font-medium">{claim.claim}</td>
                    <td className="px-3 py-3">
                      <Chip tone={VERDICT_TONES[claim.verdict]}>{VERDICT_LABELS[claim.verdict]}</Chip>
                    </td>
                    <td className="hidden px-3 py-3 text-xs text-muted sm:table-cell">
                      {questions.length === 0
                        ? "—"
                        : questions.map((question) => `Q${question}`).join(", ")}
                    </td>
                    <td className="hidden px-3 py-3 text-xs text-muted md:table-cell">
                      {claim.note}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {resume.reason && resume.claims.length > 0 && (
        <p className="mt-2 text-xs text-muted">{resume.reason}</p>
      )}
    </section>
  );
}

function OwnAnswersPanel({ scorecard }: { scorecard: Scorecard }) {
  const authenticity = scorecard.authenticity;
  if (!authenticity) return null;
  const chip = factorChip("authenticity", authenticity.score);
  const signals = [...authenticity.signals].sort((a, b) => b.severity - a.severity);

  return (
    <section id="authenticity" className={`${cardClasses} scroll-mt-24`}>
      <CardHeading
        icon={Fingerprint}
        title="Own answers (originality)"
        note="Whether the answers look like the candidate's own words, rather than read out or prompted."
        right={
          <span className="flex items-center gap-2 text-sm tabular-nums">
            <span className="font-semibold">{authenticity.score}/100</span>
            <Chip tone={chip.tone}>{chip.label}</Chip>
          </span>
        }
      />

      {signals.length === 0 ? (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.04] p-4">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <Check className="size-4" />
          </span>
          <div>
            <p className="text-sm font-medium">Responses appear original</p>
            <p className="mt-0.5 text-sm text-muted">
              No repetitive wording, suspicious timing or prompted answers were detected.
            </p>
          </div>
        </div>
      ) : (
        <ul className="mt-4 grid gap-2">
          {signals.map((signal) => {
            const serious = signal.severity >= 2;
            return (
              <li
                key={`${signal.title}-${signal.detail}`}
                className={`flex items-start gap-3 rounded-xl border p-3 ${
                  serious
                    ? "border-red-500/30 bg-red-500/[0.04]"
                    : "border-amber-500/30 bg-amber-500/[0.04]"
                }`}
              >
                <span
                  className={`grid size-7 shrink-0 place-items-center rounded-lg ${
                    serious
                      ? "bg-red-500/10 text-red-600 dark:text-red-400"
                      : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  }`}
                >
                  {serious ? <AlertTriangle className="size-4" /> : <Check className="size-4" />}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{signal.title}</p>
                  <p className="mt-0.5 text-sm text-muted">{signal.detail}</p>
                  <p className="mt-1 text-[11px] text-muted">
                    {signal.source === "measured"
                      ? "Measured from recorded timings"
                      : "From reading the transcript"}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function VideoSection({
  scorecard,
  hasRecording,
  roomId,
  videoRef,
  durationSeconds,
  onPlay,
}: {
  scorecard: Scorecard;
  hasRecording: boolean;
  roomId: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  durationSeconds: number | null;
  onPlay: (seconds: number) => void;
}) {
  const video = scorecard.video;
  if (!video) return null;
  const integrity = scorecard.integrity;
  const answers = video.answers ?? [];
  const pattern = video.pattern ?? null;
  const length = video.durationSeconds ?? durationSeconds;
  const total = length && length > 0 ? length : null;
  /** An answer given while holding the spot the pattern is about. */
  const onSpot = (answer: AnswerGaze) =>
    pattern !== null &&
    pattern.direction !== null &&
    pattern.sameSpotAnswers >= 2 &&
    answer.steady &&
    answer.whileAnswering === pattern.direction;

  return (
    <section id="video" className="scroll-mt-6" data-video-model={video.model ?? undefined}>
      <SectionHeading
        title="On-camera behaviour"
        note="From the recording of the candidate's own camera. Everyone looks away to think, so a single look counts for nothing. What is measured is whether the candidate kept returning to the same spot off the screen while answering, and not while listening. These are clips to watch, not proof."
      />
      <div className={`${cardClasses} mt-4 grid gap-6 lg:grid-cols-[1fr_1.1fr]`}>
        <div>
          {hasRecording ? (
            <video
              ref={videoRef}
              controls
              preload="metadata"
              src={`/api/dashboard/interviews/${roomId}/recording`}
              className="aspect-video w-full rounded-xl bg-[#0e1420]"
            />
          ) : (
            <div className="grid aspect-video place-items-center rounded-xl bg-[#0e1420] p-6 text-center text-sm text-[#8d98b3]">
              This interview was not recorded.
            </div>
          )}
          {total !== null && (answers.length > 0 || video.moments.length > 0) && (
            <>
              <div className="relative mt-4 h-3 rounded-full bg-border">
                {answers.map((answer) => (
                  <button
                    key={answer.turnSeq}
                    type="button"
                    title={`${formatClock(answer.atSeconds)} answer, looking ${GAZE_LABEL[answer.whileAnswering].toLowerCase()}`}
                    aria-label={`Play the answer at ${formatClock(answer.atSeconds)}`}
                    onClick={() => onPlay(answer.atSeconds - 2)}
                    className={`absolute inset-y-0 rounded-full ${onSpot(answer) ? "bg-amber-500" : "bg-accent/35"}`}
                    style={{
                      left: `${Math.min(100, (answer.atSeconds / total) * 100)}%`,
                      width: `${Math.max(0.8, Math.min(100, (answer.durationSeconds / total) * 100))}%`,
                    }}
                  />
                ))}
                {video.moments.map((moment, index) => (
                  <button
                    key={`moment-${index}`}
                    type="button"
                    title={`${formatClock(moment.atSeconds)} ${moment.description}`}
                    aria-label={`Play from ${formatClock(moment.atSeconds)}: ${moment.description}`}
                    onClick={() => onPlay(moment.atSeconds - 2)}
                    className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-red-500"
                    style={{ left: `${Math.min(100, (moment.atSeconds / total) * 100)}%` }}
                  />
                ))}
              </div>
              <div className="mt-1.5 flex justify-between text-xs tabular-nums text-muted">
                <span>0:00</span>
                <span className="flex flex-wrap justify-center gap-x-4">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-4 rounded-full bg-accent/35" /> Answer
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-4 rounded-full bg-amber-500" /> Answer on the same spot
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-red-500" /> Other moment
                  </span>
                </span>
                <span>{formatClock(total)}</span>
              </div>
            </>
          )}
        </div>

        <div>
          <dl className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <dt className="text-xs text-muted">Answers on the same spot</dt>
              <dd className="text-lg font-semibold tabular-nums">
                {pattern && pattern.answersObserved > 0
                  ? `${pattern.sameSpotAnswers >= 2 ? pattern.sameSpotAnswers : 0} of ${pattern.answersObserved}`
                  : "Not measured"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Left the interview tab</dt>
              <dd className="text-lg font-semibold tabular-nums">
                {integrity.tabHiddenCount === 0
                  ? "Never"
                  : `${integrity.tabHiddenCount}×, ${integrity.tabHiddenSeconds} s`}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Connection drops</dt>
              <dd className="text-lg font-semibold tabular-nums">{integrity.candidateDisconnects}</dd>
            </div>
          </dl>

          {video.status === "analysed" ? (
            <>
              {video.summary && <p className="mt-4 text-sm">{video.summary}</p>}
              {video.reason && <p className="mt-2 text-sm text-muted">{video.reason}</p>}
              {video.score === null && (
                <p className="mt-2 text-sm text-muted">
                  This factor is left out of the overall score.
                </p>
              )}
              {video.moments.length > 0 && (
                <ul className="mt-4 divide-y divide-border border-y border-border text-sm">
                  {video.moments.map((moment, index) => (
                    <VideoMomentRow key={index} moment={moment} onPlay={onPlay} />
                  ))}
                </ul>
              )}
            </>
          ) : video.status === "queued" ? (
            <div className="mt-4 space-y-2 text-sm text-muted">
              <p className="inline-flex items-center gap-2">
                <span className="size-2 animate-pulse rounded-full bg-accent" />
                The recording is being analysed in the background.
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink hover:bg-white/[0.04]"
              >
                Refresh
              </button>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted">
              {video.reason ?? "The recording has not been analysed."} This factor is left out of the
              overall score.
            </p>
          )}
        </div>

        {answers.length > 0 && (
          <div className="lg:col-span-2">
            <h3 className="text-sm font-semibold">Where the candidate looked, answer by answer</h3>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <thead className="text-xs text-muted">
                  <tr className="border-b border-border">
                    <th className="py-2 pr-4 font-medium">Answer at</th>
                    <th className="py-2 pr-4 font-medium">While listening</th>
                    <th className="py-2 pr-4 font-medium">While answering</th>
                    <th className="py-2 font-medium">What was seen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {answers.map((answer) => (
                    <tr key={answer.turnSeq} className={onSpot(answer) ? "bg-amber-500/10" : undefined}>
                      <td className="py-2 pr-4 align-top">
                        <button
                          type="button"
                          onClick={() => onPlay(answer.atSeconds - 2)}
                          className="font-semibold tabular-nums text-accent hover:underline"
                        >
                          {formatClock(answer.atSeconds)}
                        </button>
                        <span className="ml-1.5 text-xs text-muted">{answer.durationSeconds} s</span>
                      </td>
                      <td className="py-2 pr-4 align-top">
                        <GazeCell direction={answer.whileListening} />
                      </td>
                      <td className="py-2 pr-4 align-top">
                        <GazeCell direction={answer.whileAnswering} strong={onSpot(answer)} />
                      </td>
                      <td className="py-2 align-top">
                        {[
                          onSpot(answer) ? "Held on the same spot as other answers." : null,
                          answer.reading ? "Reading-like eye movement." : null,
                          answer.note || null,
                        ]
                          .filter(Boolean)
                          .join(" ") || <span className="text-muted">Nothing notable.</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** A direction, shown as a lit cell in a 3-by-3 grid (as seen in the picture). */
function GazeCell({ direction, strong = false }: { direction: GazeDirection; strong?: boolean }) {
  const active = GAZE_GRID.indexOf(direction);
  return (
    <span className="inline-flex items-center gap-2">
      <span className="grid grid-cols-3 gap-0.5" aria-hidden="true">
        {GAZE_GRID.map((cell, index) => (
          <span
            key={cell}
            className={`size-1.5 rounded-[1px] ${
              index === active ? (strong ? "bg-amber-500" : "bg-accent") : "bg-border"
            }`}
          />
        ))}
      </span>
      <span className={strong ? "font-semibold" : undefined}>{GAZE_LABEL[direction]}</span>
    </span>
  );
}

function VideoMomentRow({
  moment,
  onPlay,
}: {
  moment: VideoMoment;
  onPlay: (seconds: number) => void;
}) {
  return (
    <li className="flex gap-4 py-2.5">
      <button
        type="button"
        onClick={() => onPlay(moment.atSeconds - 2)}
        className="w-12 shrink-0 text-left font-semibold tabular-nums text-accent hover:underline"
      >
        {formatClock(moment.atSeconds)}
      </button>
      <span>
        {moment.description}
        {moment.durationSeconds > 0 && (
          <span className="text-muted"> ({moment.durationSeconds} s)</span>
        )}
      </span>
    </li>
  );
}

function Transcript({
  turns,
  competencies,
  offsetFor,
  onPlay,
}: {
  turns: InterviewTurn[];
  competencies: PlanCompetency[];
  offsetFor: (turn: InterviewTurn) => number | null;
  onPlay: (seconds: number) => void;
}) {
  const [filter, setFilter] = useState<"all" | "candidate" | "interviewer">("all");
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  const names = new Map(competencies.map((item) => [item.id, item.name]));
  const needle = query.trim().toLowerCase();
  const visible = turns.filter(
    (turn) =>
      (filter === "all" || turn.speaker === filter) &&
      (needle === "" || turn.text.toLowerCase().includes(needle)),
  );
  const shown = showAll ? visible : visible.slice(0, 8);

  return (
    <section id="transcript" className="scroll-mt-24">
      <CardHeader title="Transcript" note="The full interview, with timestamps. Jump to any line." />

      {turns.length === 0 ? (
        <p className="mt-4 text-sm text-muted">Nothing has been said in this interview yet.</p>
      ) : (
        <div className={`${cardClasses} mt-4`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="relative">
              <select
                value={filter}
                onChange={(event) => setFilter(event.target.value as typeof filter)}
                aria-label="Filter the transcript by speaker"
                className="rounded-lg border border-border bg-surface pl-3 pr-8 py-1.5 text-sm outline-none transition focus:border-accent"
              >
                <option value="all">All messages</option>
                <option value="candidate">Candidate</option>
                <option value="interviewer">Interviewer</option>
              </select>
            </div>
            <label className="relative flex items-center">
              <Search className="pointer-events-none absolute left-2.5 size-4 text-muted" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search transcript…"
                aria-label="Search the transcript"
                className="w-56 rounded-lg border border-border bg-surface py-1.5 pl-8 pr-3 text-sm outline-none transition focus:border-accent"
              />
            </label>
          </div>

          <ol className="mt-4 grid gap-3">
            {shown.map((turn) => {
              const candidate = turn.speaker === "candidate";
              const offset = offsetFor(turn);
              const topic = turn.competencyId ? names.get(turn.competencyId) : null;
              return (
                <li
                  key={turn.seq}
                  id={`turn-${turn.seq}`}
                  className="flex scroll-mt-24 gap-3 rounded-lg px-1 py-0.5 transition target:bg-accent/10"
                >
                  <span
                    aria-hidden
                    className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold uppercase ${
                      candidate
                        ? "bg-candidate/10 text-candidate"
                        : "bg-accent/10 text-accent"
                    }`}
                  >
                    {candidate ? "C" : "I"}
                  </span>
                  <div
                    className={`min-w-0 flex-1 rounded-2xl border px-4 py-2.5 ${
                      candidate ? "border-border bg-background/40" : "border-border/70 bg-surface"
                    }`}
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
                      <span className="font-semibold text-foreground">
                        {candidate ? "Candidate" : "Interviewer"}
                      </span>
                      {offset !== null && offset >= 0 ? (
                        <button
                          type="button"
                          onClick={() => onPlay(offset)}
                          className="tabular-nums text-muted transition hover:text-accent"
                        >
                          {formatClock(offset)}
                        </button>
                      ) : (
                        <span className="tabular-nums">turn {turn.seq}</span>
                      )}
                      {topic && <span className="truncate">· {topic}</span>}
                      {candidate && turn.responseLatencyMs !== null && (
                        <span>· answered after {(turn.responseLatencyMs / 1000).toFixed(1)}s</span>
                      )}
                      {turn.interrupted && <span>· interrupted</span>}
                    </div>
                    <p className="mt-1 text-sm leading-relaxed">{turn.text}</p>
                  </div>
                </li>
              );
            })}
          </ol>

          {visible.length === 0 && (
            <p className="mt-4 text-sm text-muted">No lines match that search.</p>
          )}

          {visible.length > 8 && (
            <button
              type="button"
              onClick={() => setShowAll((value) => !value)}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-xs font-medium text-muted transition hover:border-accent hover:text-foreground"
            >
              {showAll ? "Show less" : `Show all ${visible.length} messages`}
              <ChevronDown className={`size-3.5 transition ${showAll ? "rotate-180" : ""}`} />
            </button>
          )}
        </div>
      )}
    </section>
  );
}

const VOICE_MODE_NAME: Record<VoiceMode, string> = {
  standard: "Standard",
  rolling: "Rolling sessions",
};

/** How the voice model was run for this interview and what it cost. */
function VoicePanel({
  session,
  events,
  hasRecording,
}: {
  session: InterviewRoom;
  events: InterviewEvent[];
  hasRecording: boolean;
}) {
  const cost = estimateVoiceCost(session.outcome);
  const bytes = recordingBytes(events);
  const items: [string, string][] = [
    ["Voice mode", VOICE_MODE_NAME[session.voiceMode ?? "standard"]],
    ["Model sessions", String(session.outcome?.modelSessions ?? 1)],
    ["Duration", session.outcome ? formatDuration(session.outcome.elapsedSeconds) : "Not finished"],
    ["File size", bytes === null ? "Not reported" : `${(bytes / 1024 / 1024).toFixed(1)} MB`],
    ["Estimated cost", cost ? `$${cost.usd.toFixed(3)}` : "Not reported"],
    ["Processing", recordingState(events).label],
  ];

  return (
    <section id="voice" className="scroll-mt-24">
      <CardHeader
        title="Voice session"
        note="How the live voice model ran this interview. Costs are list-price estimates, not an invoice."
      />
      <div className={`${cardClasses} mt-4`}>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {items.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="mt-0.5 font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        {hasRecording && (
          <a
            href={`/api/dashboard/interviews/${session.id}/recording`}
            download
            className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition hover:border-accent"
          >
            <Download className="size-3.5" />
            Download recording
          </a>
        )}
      </div>
    </section>
  );
}

function PeersPanel({ peers, currentId }: { peers: PeerSummary[]; currentId: string }) {
  if (peers.length < 2) return null;
  return (
    <section id="peers" className="scroll-mt-24">
      <CardHeader
        title="Other interviews"
        note="Everyone scored for the same role, highest overall first. The same plan and the same scale."
      />
      <ul className={`${cardClasses} mt-4 divide-y divide-border !p-0`}>
        {peers.map((peer) => (
          <li
            key={peer.roomId}
            className={`flex flex-wrap items-center gap-3 px-5 py-3 text-sm ${
              peer.roomId === currentId ? "bg-accent/5" : ""
            }`}
          >
            <span
              aria-hidden
              className="grid size-8 shrink-0 place-items-center rounded-full bg-accent/10 text-xs font-semibold uppercase text-accent"
            >
              {initials(peer.candidateName)}
            </span>
            <span className="min-w-0 flex-1 font-medium">
              {peer.roomId === currentId ? (
                <>
                  {peer.candidateName || "Candidate"}
                  <span className="ml-2 text-xs font-normal text-muted">this interview</span>
                </>
              ) : (
                <Link href={`/dashboard/${peer.roomId}`} className="hover:text-accent">
                  {peer.candidateName || "Candidate"}
                </Link>
              )}
            </span>
            <span className="font-display text-lg font-semibold tabular-nums">
              {peer.overall?.score ?? "–"}
              <span className="text-xs font-normal text-muted">/100</span>
            </span>
            <span className="w-28 text-right">
              <Chip tone={decisionTone(peer.decision)}>
                {peer.decision ? DECISION_LABELS[peer.decision.outcome] : "Undecided"}
              </Chip>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PlanPreview({ competencies }: { competencies: PlanCompetency[] }) {
  return (
    <section className={cardClasses}>
      <h2 className="text-lg font-semibold">Interview plan</h2>
      <ol className="mt-3 grid list-decimal gap-2 pl-5 text-sm">
        {competencies.map((competency) => (
          <li key={competency.id}>
            <span className="font-medium">{competency.name}.</span>{" "}
            <span className="text-muted">{competency.question}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** A section heading outside a card, matching the video section's own heading. */
function CardHeader({ title, note }: { title: string; note: string }) {
  return (
    <>
      <h2 className="text-2xl font-semibold">{title}</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">{note}</p>
    </>
  );
}

function initials(name: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2);
  return `${parts[0][0]}${parts[parts.length - 1][0]}`;
}

/** Plain prose: the grader's markdown asterisks and links are stripped. */
function plain(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1")
    .replace(/\*\*|__/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstSentence(text: string): string {
  const clean = plain(text);
  const match = clean.match(/^(.{20,240}?[.!?])(?:\s|$)/);
  return match ? match[1] : clean.slice(0, 240);
}

function evidenceWindow(
  evidence: ScoreEvidence[],
  bySeq: Map<number, InterviewTurn>,
  offsetFor: (turn: InterviewTurn) => number | null,
): { from: number; to: number } | null {
  const offsets: { start: number; end: number }[] = [];
  for (const item of evidence) {
    const turn = bySeq.get(item.turnSeq);
    if (!turn) continue;
    const start = offsetFor(turn);
    if (start === null || start < 0) continue;
    const end =
      turn.endedAt && turn.startedAt
        ? start + (Date.parse(turn.endedAt) - Date.parse(turn.startedAt)) / 1000
        : start;
    offsets.push({ start, end });
  }
  if (offsets.length === 0) return null;
  offsets.sort((a, b) => a.start - b.start);
  return { from: offsets[0].start, to: Math.max(offsets[offsets.length - 1].end, offsets[0].start) };
}

function scoreTone(score: number | null): Tone {
  if (score === null) return "muted";
  if (score >= 4) return "good";
  if (score >= 3) return "warn";
  return "bad";
}

function scoreBand(score: number | null): { label: string; tone: Tone } {
  if (score === null) return { label: "Not scored", tone: "muted" };
  if (score >= 65) return { label: "Strong", tone: "good" };
  if (score >= 50) return { label: "Promising", tone: "warn" };
  return { label: "Needs improvement", tone: "bad" };
}

function hireBandTone(band: string): Tone {
  if (band === "strong-hire" || band === "hire") return "good";
  if (band === "no-hire" || band === "strong-no-hire") return "bad";
  return "muted";
}

/** Colour for the saved hiring decision of a peer interview. */
function decisionTone(decision: HumanDecision | null): Tone {
  if (!decision) return "muted";
  return decision.outcome === "advance" ? "good" : decision.outcome === "hold" ? "warn" : "bad";
}

/** The chip wording the report uses for each factor, by score. */
function factorChip(id: FactorId, score: number | null): { label: string; tone: Tone } {
  if (score === null) return { label: "Not scored", tone: "muted" };
  const tone: Tone = score >= 65 ? "good" : score >= 50 ? "warn" : "bad";
  const labels: Record<FactorId, [string, string, string]> = {
    answers: ["Below expected", "Mixed evidence", "Good answers"],
    resume: ["Weak match", "Partly supported", "Good match"],
    authenticity: ["Needs review", "Worth a look", "Original"],
    video: ["Needs attention", "Watch", "Good"],
  };
  const index = tone === "good" ? 2 : tone === "warn" ? 1 : 0;
  return { label: labels[id][index], tone };
}

function factorLink(id: FactorId): string {
  return id === "answers" ? "answers" : id;
}

function recordingBytes(events: InterviewEvent[]): number | null {
  const finished = events.find((event) => event.type === "recording_finished");
  const bytes = finished?.data?.bytes;
  return typeof bytes === "number" && bytes > 0 ? bytes : null;
}

function recordingState(events: InterviewEvent[]): { label: string; tone: Tone } {
  if (events.some((event) => event.type === "recording_uploaded")) {
    return { label: "Ready", tone: "good" };
  }
  if (events.some((event) => event.type === "recording_finished")) {
    return { label: "Saved", tone: "good" };
  }
  if (events.some((event) => event.type === "recording_failed")) {
    return { label: "Failed", tone: "bad" };
  }
  return { label: "Not recorded", tone: "muted" };
}

function recordingNote(events: InterviewEvent[]): string {
  const started = events.find((event) => event.type === "recording_started");
  if (started) return "The candidate was recorded.";
  if (events.some((event) => event.type === "recording_failed")) return "Recording failed to start.";
  return "Not recorded.";
}

function formatClock(totalSeconds: number): string {
  const whole = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** "1h 12m" style, for interview and recording lengths. */
function formatDuration(totalSeconds: number): string {
  const whole = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.round((whole % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
