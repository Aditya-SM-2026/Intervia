"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { EASE_OUT } from "@/components/ui/animated";
import { ScoreRing } from "@/components/ui/ScoreRing";
import { Menu } from "./menu";
import { StatusBadge } from "./primitives";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { estimateVoiceCost } from "@/lib/interviews/cost";
import type {
  HumanDecision,
  InterviewEvent,
  InterviewRoom,
  InterviewTurn,
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
} from "@/lib/interviews/scorecard.types";
import { FACTOR_META } from "./factors";
import { buildReportInsights, type ReportInsights } from "@/lib/interviews/report-insights";
import { GAZE_GRID, GAZE_LABEL } from "./gaze";
import { CandidateAssistant } from "./CandidateAssistant";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Briefcase,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Download,
  ExternalLink,
  FileSearch,
  FileText,
  Fingerprint,
  Flag,
  Gauge,
  ListChecks,
  Maximize2,
  Mic,
  MessageSquare,
  MessagesSquare,
  Minimize2,
  Minus,
  MoreHorizontal,
  Pencil,
  Play,
  Quote,
  RotateCcw,
  ScrollText,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trophy,
  User,
  Video,
  X,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Premium recruiter assessment view:
 * Clean single-column assessment layout, sticky left navigation rail,
 * prominent candidate header with quick actions, white cards on subtle light-gray canvas,
 * and high-fidelity sections matching the design reference.
 */

type Tone = "good" | "warn" | "bad" | "muted";

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
  partly_supported: "Partially supported",
  not_supported: "Not supported",
  not_discussed: "Not discussed",
};


const VERDICT_STYLES: Record<
  ResumeVerdict,
  { bg: string; text: string; border: string; icon: LucideIcon }
> = {
  confirmed: {
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    text: "text-emerald-700 dark:text-emerald-400",
    border: "border-emerald-200/70 dark:border-emerald-800/50",
    icon: Check,
  },
  partly_supported: {
    bg: "bg-amber-50 dark:bg-amber-950/30",
    text: "text-amber-700 dark:text-amber-400",
    border: "border-amber-200/70 dark:border-amber-800/50",
    icon: AlertCircle,
  },
  not_supported: {
    bg: "bg-rose-50 dark:bg-rose-950/30",
    text: "text-rose-700 dark:text-rose-400",
    border: "border-rose-200/70 dark:border-rose-800/50",
    icon: XCircle,
  },
  not_discussed: {
    bg: "bg-slate-50 dark:bg-slate-900/40",
    text: "text-muted",
    border: "border-border dark:border-slate-800",
    icon: Minus,
  },
};

const TONE_TEXT: Record<Tone, string> = {
  good: "text-emerald-700 dark:text-emerald-400",
  warn: "text-amber-700 dark:text-amber-400",
  bad: "text-rose-700 dark:text-rose-400",
  muted: "text-muted",
};

const cardClasses =
  "rounded-2xl border border-border bg-surface p-5 shadow-sm shadow-black/[0.02] sm:p-7";

/** Tinted tiles behind section icons. */
const ICON_TINTS: Record<string, string> = {
  purple: "bg-violet-500/10 text-violet-600 dark:text-violet-300",
  violet: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-300",
  indigo: "bg-accent/10 text-accent",
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  rose: "bg-rose-500/10 text-rose-600 dark:text-rose-300",
  sky: "bg-sky-500/10 text-sky-600 dark:text-sky-300",
};

const TONE_TILE: Record<Tone, string> = {
  good: "bg-emerald-500/[0.08] text-emerald-700 dark:text-emerald-300",
  warn: "bg-amber-500/[0.1] text-amber-800 dark:text-amber-300",
  bad: "bg-rose-500/[0.08] text-rose-700 dark:text-rose-300",
  muted: "bg-foreground/[0.035] text-foreground",
};

const TONE_STROKE: Record<Tone, string> = {
  good: "stroke-emerald-500",
  warn: "stroke-amber-500",
  bad: "stroke-rose-500",
  muted: "stroke-foreground/30",
};

/** Report sections, in page order, for the sticky section bar. */
const REPORT_SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "answers", label: "Answers" },
  { id: "resume", label: "Resume" },
  { id: "authenticity", label: "Originality" },
  { id: "recording", label: "Recording" },
  { id: "video", label: "On camera" },
  { id: "comments", label: "Decision" },
] as const;

/** Tracks which report section is currently in view. */
function useActiveReportSection() {
  const [activeId, setActiveId] = useState<string>(REPORT_SECTIONS[0].id);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveId(entry.target.id);
        }
      },
      { rootMargin: "-20% 0px -65% 0px", threshold: 0 },
    );
    for (const { id } of REPORT_SECTIONS) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return activeId;
}

/**
 * Sticky section bar under the page header: one row of tabs with an
 * underline that slides to the section in view. Replaces the old sidebar so
 * the report itself gets the full width.
 */
function SectionBar({ ids }: { ids: ReadonlySet<string> }) {
  const activeId = useActiveReportSection();
  const present = REPORT_SECTIONS.filter(({ id }) => ids.has(id));
  return (
    <div className="sticky top-16 z-20 -mx-4 border-b border-border bg-background/85 px-4 backdrop-blur-xl sm:-mx-6 sm:px-6">
      <nav aria-label="Report sections" className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {present.map(({ id, label }) => {
          const active = id === activeId;
          return (
            <a
              key={id}
              href={`#${id}`}
              aria-current={active ? "true" : undefined}
              className={`relative shrink-0 px-3 py-3 text-sm font-medium transition-colors ${
                active ? "text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {label}
              {active && (
                <motion.span
                  layoutId="report-section-underline"
                  className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-accent"
                  transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
                />
              )}
            </a>
          );
        })}
      </nav>
    </div>
  );
}

const alertClasses =
  "rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-400";

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
  const [isVideoRequesting, setIsVideoRequesting] = useState(false);
  const [isResumeRequesting, setIsResumeRequesting] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const router = useRouter();

  function openAssistant() {
    setAssistantOpen(true);
  }

  function closeAssistant() {
    setAssistantOpen(false);
  }

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

  // While the analyser is working, refresh the report until the result lands.
  const videoQueued = detail?.scorecard?.video?.status === "queued";
  useEffect(() => {
    if (!videoQueued) return;
    let cancelled = false;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (attempts > 40) {
        clearInterval(timer);
        return;
      }
      fetchDetail(`/api/dashboard/interviews/${roomId}`, "GET")
        .then((result) => {
          if (cancelled || result === "unauthorized") return;
          setDetail(result);
        })
        .catch(() => {
          // Keep trying; a single failed poll should not stop the wait.
        });
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [videoQueued, roomId]);

  async function handleRegenerate() {
    setIsRegenerating(true);
    try {
      const result = await fetchDetail(`/api/dashboard/interviews/${roomId}/regenerate`, "POST");
      if (result === "unauthorized") router.replace(`/login?next=/dashboard/${roomId}`);
      else {
        setDetail(result);
        setError(null);
        showToast("Scorecard regenerated successfully");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not regenerate the scorecard.");
    } finally {
      setIsRegenerating(false);
    }
  }

  /** Asks the analyser to look at this recording, even though scoring skipped it. */
  async function handleAnalyseVideo() {
    setIsVideoRequesting(true);
    try {
      const response = await fetch(`/api/dashboard/interviews/${roomId}/video`, { method: "POST" });
      if (response.status === 401) {
        router.replace(`/login?next=/dashboard/${roomId}`);
        return;
      }
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        showToast(body?.error?.message ?? "Could not start the video analysis.");
        return;
      }
      showToast("Video analysis started");
      const result = await fetchDetail(`/api/dashboard/interviews/${roomId}`, "GET");
      if (result !== "unauthorized") setDetail(result);
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Could not start the video analysis.");
    } finally {
      setIsVideoRequesting(false);
    }
  }

  /** Reruns the resume check against this candidate's answers. */
  async function handleAnalyseResume() {
    setIsResumeRequesting(true);
    try {
      const response = await fetch(`/api/dashboard/interviews/${roomId}/resume-analysis`, {
        method: "POST",
      });
      if (response.status === 401) {
        router.replace(`/login?next=/dashboard/${roomId}`);
        return;
      }
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        showToast(body?.error?.message ?? "Could not analyse the resume.");
        return;
      }
      showToast(
        typeof body?.score === "number"
          ? `Resume match updated: ${body.score}/100`
          : "Resume analysis finished. There was too little to score.",
      );
      const result = await fetchDetail(`/api/dashboard/interviews/${roomId}`, "GET");
      if (result !== "unauthorized") setDetail(result);
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Could not analyse the resume.");
    } finally {
      setIsResumeRequesting(false);
    }
  }

  function showToast(message: string) {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 3000);
  }

  /** Jumps the recording to a moment and brings the player into view. */
  function playFrom(seconds: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, seconds);
    void video.play().catch(() => {});
    video.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /** Scrolls to the transcript turn cited by the assistant and flashes it. */
  function jumpToCitedTurn(seq: number) {
    const row = document.querySelector<HTMLButtonElement>(`button[data-seq="${seq}"]`);
    if (!row) return;
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    // Clicking the transcript row jumps the recording and marks the turn
    // active; a disabled row (no recording) simply stays put.
    row.click();
    // On a phone the panel covers the whole report, so step out of the way.
    if (window.innerWidth < 640) setAssistantOpen(false);
    row.classList.add("ring-2", "ring-blue-400", "ring-offset-1");
    window.setTimeout(() => {
      row.classList.remove("ring-2", "ring-blue-400", "ring-offset-1");
    }, 1800);
  }

  /** Finds the smallest rendered element that contains the cited report quote. */
  function findReportQuoteElement(root: HTMLElement, quote: string): HTMLElement | null {
    const needle = quote.replace(/\s+/g, " ").trim().toLowerCase();
    if (needle.length < 8) return null;
    let best: HTMLElement | null = null;
    let bestLength = Number.POSITIVE_INFINITY;
    for (const element of root.querySelectorAll<HTMLElement>(
      "p, li, td, th, span, strong, em, div",
    )) {
      const text = (element.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
      if (!text.includes(needle)) continue;
      if (text.length < bestLength) {
        best = element;
        bestLength = text.length;
      }
    }
    return best;
  }

  /** Scrolls to the exact report evidence cited by the assistant and flashes it. */
  function jumpToReportSection(sectionId: string, quote?: string) {
    const section = document.getElementById(sectionId);
    if (!section) return;
    const exact = quote ? findReportQuoteElement(section, quote) : null;
    const target = exact ?? section;
    target.scrollIntoView({
      behavior: "smooth",
      block: exact ? "center" : "start",
    });
    if (window.innerWidth < 640) setAssistantOpen(false);
    target.classList.add("ring-2", "ring-blue-400", "ring-offset-2");
    window.setTimeout(() => {
      target.classList.remove("ring-2", "ring-blue-400", "ring-offset-2");
    }, 1800);
  }

  if (error && !detail) {
    return (
      <div className="mx-auto max-w-7xl grid gap-4">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-slate-900 dark:text-muted dark:hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          <span>Back to interviews</span>
        </Link>
        <p role="alert" className={alertClasses}>
          {error}
        </p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="mx-auto grid max-w-6xl gap-6 pt-6" aria-busy="true">
        <div className="skeleton h-4 w-40 rounded" />
        <div className="flex items-center gap-4">
          <div className="skeleton size-14 rounded-full" />
          <div className="grid gap-2">
            <div className="skeleton h-7 w-56 rounded" />
            <div className="skeleton h-4 w-80 rounded" />
          </div>
        </div>
        <div className="skeleton h-11 rounded-lg" />
        <div className="skeleton h-72 rounded-2xl" />
        <div className="skeleton h-56 rounded-2xl" />
      </div>
    );
  }

  const { session, turns, events, scorecard, reason, peers, hasRecording } = detail;
  const competencies = session.plan?.competencies ?? [];
  const insights = scorecard ? buildReportInsights({ session, scorecard, turns, peers }) : null;

  const timelineStart =
    [detail.recordingStartedAt, session.outcome?.startedAt, turns[0]?.startedAt ?? null]
      .filter((value): value is string => Boolean(value))
      .sort()[0] ?? null;

  const recordingOffset = (turn: InterviewTurn): number | null =>
    hasRecording && timelineStart && turn.startedAt
      ? Math.max(0, (Date.parse(turn.startedAt) - Date.parse(timelineStart)) / 1000)
      : null;

  // Sits between the originality section and the on-camera analysis.
  const recordingSection = (
    <RecordingPanel
      roomId={roomId}
      hasRecording={hasRecording}
      turns={turns}
      candidateName={session.candidateName || "Candidate"}
      offsetFor={recordingOffset}
      videoRef={videoRef}
      moments={scorecard?.video?.moments ?? []}
      durationSeconds={session.outcome?.elapsedSeconds ?? null}
    />
  );

  return (
    <div className="mx-auto flex max-w-[1500px] gap-6 xl:items-start">
      <div className="mx-auto grid w-full min-w-0 max-w-6xl flex-1 gap-6">
        {toastMessage && (
          <div
            role="status"
            className="animate-pop-in fixed bottom-6 right-6 z-50 flex items-center gap-2.5 rounded-xl border border-border bg-surface px-4 py-3 text-sm shadow-xl shadow-black/10 dark:shadow-black/50"
          >
            <CheckCircle2 className="size-4 text-emerald-500" aria-hidden />
            <span>{toastMessage}</span>
          </div>
        )}

        {resumeOpen && (
          <ResumeModal
            resume={session.resume}
            roomId={roomId}
            candidateName={session.candidateName || "Candidate"}
            onClose={() => setResumeOpen(false)}
          />
        )}

        <CandidateHeader
          session={session}
          peers={peers}
          roomId={roomId}
          canDownload={scorecard !== null}
          hasResume={session.resume !== null}
          onOpenResume={() => setResumeOpen(true)}
          onRegenerate={handleRegenerate}
          isRegenerating={isRegenerating}
          onShare={() => {
            if (typeof window !== "undefined") {
              navigator.clipboard.writeText(window.location.href);
              showToast("Link copied");
            }
          }}
          onOpenAssistant={openAssistant}
          canAsk={scorecard !== null}
        />

        {error && (
          <p role="alert" className={alertClasses}>
            {error}
          </p>
        )}

        <SectionBar
          ids={
            new Set(
              scorecard
                ? [
                    "overview",
                    "answers",
                    ...(scorecard.resumeMatch ? ["resume"] : []),
                    ...(scorecard.authenticity ? ["authenticity"] : []),
                    "recording",
                    ...(scorecard.video ? ["video"] : []),
                    "comments",
                  ]
                : ["overview", "recording", "comments"],
            )
          }
        />

        <div className="grid min-w-0 gap-5">
          {scorecard ? (
            <>
              <OverallAssessment scorecard={scorecard} insights={insights} peers={peers} roomId={roomId} />
              <SummarySection scorecard={scorecard} insights={insights} />
              <AnswerQualityTable
                scorecard={scorecard}
                competencies={competencies}
                turns={turns}
                offsetFor={recordingOffset}
                onPlay={playFrom}
              />
              <CustomParametersSection scorecard={scorecard} />
              <ResumeTable
                scorecard={scorecard}
                turns={turns}
                competencies={competencies}
                onAnalyseResume={handleAnalyseResume}
                isAnalysing={isResumeRequesting}
              />
              <OwnAnswersSection scorecard={scorecard} />
              {recordingSection}
              <VideoSection
                scorecard={scorecard}
                hasRecording={hasRecording}
                onPlay={playFrom}
                onAnalyseVideo={handleAnalyseVideo}
                isAnalysing={isVideoRequesting}
              />
            </>
          ) : (
            <>
              <section id="overview" className={`${cardClasses} scroll-mt-32`}>
                <CardHeading icon={Gauge} title="No report yet" />
                <p className="mt-2 text-sm text-muted">
                  {reason ?? "The report appears here once the candidate finishes the interview."}
                </p>
                {competencies.length > 0 && <PlanPreview competencies={competencies} />}
              </section>
              {recordingSection}
            </>
          )}

          <CommentsDecisionSection
            roomId={roomId}
            decision={session.decision}
            onSaved={(decision) => setDetail({ ...detail, session: { ...session, decision } })}
          />

          {peers.length > 1 && <PeersSection peers={peers} currentId={roomId} />}

          <VoiceSection session={session} events={events} hasRecording={hasRecording} />
        </div>
        <footer className="px-1 pb-10 pt-4 text-xs text-muted">
          {scorecard ? `Report generated ${formatDateTime(scorecard.generatedAt)}` : null}
        </footer>
      </div>

      <CandidateAssistant
        roomId={roomId}
        candidateName={session.candidateName || "Candidate"}
        open={assistantOpen}
        onClose={closeAssistant}
        onJumpToTurn={jumpToCitedTurn}
        onJumpToReportSection={jumpToReportSection}
      />
    </div>
  );
}

/** Section heading: tinted icon, title, optional one-line description, right-hand figures. */
function CardHeading({
  icon: Icon,
  iconColor,
  title,
  subtitle,
  right,
}: {
  icon?: LucideIcon;
  iconColor?: string;
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <span
            className={`grid size-10 shrink-0 place-items-center rounded-xl ${ICON_TINTS[iconColor ?? ""] ?? "bg-foreground/[0.05] text-foreground/70"}`}
          >
            <Icon className="size-[18px]" aria-hidden />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-[-0.01em] text-foreground">{title}</h2>
          {subtitle && <p className="mt-0.5 max-w-prose text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}

/** Section score at the right of a heading: a ring, then what it means. */
function HeadingScore({ score, tone, label }: { score: number | null; tone: Tone; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${TONE_TILE[tone]}`}>{label}</span>
      <ScoreRing score={score} size={48} stroke={4.5} toneClass={TONE_STROKE[tone]} />
    </div>
  );
}

/** Page header: breadcrumb, candidate identity, one meta line, actions. */
function CandidateHeader({
  session,
  peers,
  roomId,
  canDownload,
  hasResume,
  onOpenResume,
  onRegenerate,
  isRegenerating,
  onShare,
  onOpenAssistant,
  canAsk,
}: {
  session: InterviewRoom;
  peers: PeerSummary[];
  roomId: string;
  canDownload: boolean;
  hasResume: boolean;
  onOpenResume: () => void;
  onRegenerate: () => void;
  isRegenerating: boolean;
  onShare: () => void;
  onOpenAssistant: () => void;
  canAsk: boolean;
}) {
  const router = useRouter();
  const outcome = session.outcome;
  const position = peers.findIndex((peer) => peer.roomId === roomId);
  const previous = position > 0 ? peers[position - 1] : null;
  const next = position >= 0 && position < peers.length - 1 ? peers[position + 1] : null;
  const when = session.completedAt ?? session.scheduledAt ?? null;

  const ghost =
    "inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-medium transition hover:border-foreground/20 hover:bg-foreground/[0.03]";

  return (
    <header className="grid gap-5 pt-6">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-muted">
          <Link href="/dashboard" className="transition hover:text-foreground">
            Interviews
          </Link>
          <ChevronRight className="size-3.5 shrink-0 opacity-60" aria-hidden />
          <span className="truncate">{session.roleTitle || session.title}</span>
        </nav>
        {peers.length > 1 && position >= 0 && (
          <div className="flex items-center gap-1 text-muted">
            <span className="mr-1 text-xs tabular-nums">
              {position + 1} of {peers.length} for this role
            </span>
            <Link
              href={previous ? `/dashboard/${previous.roomId}` : "#"}
              aria-label="Previous candidate"
              aria-disabled={!previous}
              className={`grid size-8 place-items-center rounded-lg transition ${previous ? "hover:bg-foreground/[0.06] hover:text-foreground" : "pointer-events-none opacity-40"}`}
            >
              <ChevronLeft className="size-4" />
            </Link>
            <Link
              href={next ? `/dashboard/${next.roomId}` : "#"}
              aria-label="Next candidate"
              aria-disabled={!next}
              className={`grid size-8 place-items-center rounded-lg transition ${next ? "hover:bg-foreground/[0.06] hover:text-foreground" : "pointer-events-none opacity-40"}`}
            >
              <ChevronRight className="size-4" />
            </Link>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden
            className="grid size-14 shrink-0 place-items-center rounded-full bg-accent-soft text-lg font-semibold text-accent ring-1 ring-inset ring-accent/15"
          >
            {initials(session.candidateName)}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="truncate text-[26px] font-semibold leading-tight tracking-[-0.02em]">
                {session.candidateName || "Candidate"}
              </h1>
              <StatusBadge status={session.status} />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
              {session.candidateEmail && <span>{session.candidateEmail}</span>}
              <span className="inline-flex items-center gap-1.5">
                <Briefcase className="size-3.5" aria-hidden />
                {session.roleTitle || session.title}
              </span>
              {when && (
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="size-3.5" aria-hidden />
                  {formatDateTime(when)}
                </span>
              )}
              <span
                className="inline-flex items-center gap-1.5"
                title={outcome?.reason ? (END_REASONS[outcome.reason] ?? undefined) : undefined}
              >
                <Clock className="size-3.5" aria-hidden />
                {outcome ? formatDuration(outcome.elapsedSeconds) : `${session.durationMinutes} min planned`}
              </span>
              {session.recruiterName && (
                <span className="inline-flex items-center gap-1.5">
                  <User className="size-3.5" aria-hidden />
                  {session.recruiterName}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canAsk && (
            <button
              type="button"
              onClick={onOpenAssistant}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3.5 text-sm font-medium text-white shadow-sm shadow-accent/20 transition hover:bg-accent/90 active:scale-[0.98]"
            >
              <Sparkles className="size-4" aria-hidden />
              Ask AI
            </button>
          )}
          {hasResume && (
            <button type="button" onClick={onOpenResume} className={ghost}>
              <FileText className="size-4 text-muted" aria-hidden />
              Resume
            </button>
          )}
          {canDownload && (
            <a href={`/api/dashboard/interviews/${roomId}/report/download`} className={ghost}>
              <Download className="size-4 text-muted" aria-hidden />
              PDF
            </a>
          )}
          <Menu
            label="More actions"
            align="end"
            trigger={
              <button type="button" aria-label="More actions" className={`${ghost} w-9 justify-center px-0`}>
                <MoreHorizontal className="size-4" aria-hidden />
              </button>
            }
            items={[
              { id: "copy", label: "Copy link to this report", icon: <Copy className="size-4" aria-hidden />, onSelect: onShare },
              ...(session.status === "expired"
                ? [{ id: "edit", label: "Edit interview", icon: <Pencil className="size-4" aria-hidden />, onSelect: () => router.push(`/dashboard/${roomId}/edit`) }]
                : []),
              ...(session.status === "completed"
                ? [{
                    id: "regenerate",
                    label: isRegenerating ? "Re-scoring…" : "Re-score this interview",
                    icon: <RotateCcw className="size-4" aria-hidden />,
                    disabled: isRegenerating,
                    onSelect: onRegenerate,
                  }]
                : []),
            ]}
          />
        </div>
      </div>
    </header>
  );
}

/** 1. Overall Assessment Section: Circular gauge, status label, concise summary, and expandable factor progress rows */
function OverallAssessment({
  scorecard,
  insights,
  peers,
  roomId,
}: {
  scorecard: Scorecard;
  insights: ReportInsights | null;
  peers: PeerSummary[];
  roomId: string;
}) {
  const reduce = useReducedMotion();
  const overall = scorecard.overall;

  if (!overall) {
    return (
      <section id="overview" className={`${cardClasses} scroll-mt-32`}>
        <CardHeading title="Overall assessment" />
        <p className="mt-4 text-5xl font-semibold leading-none tabular-nums">
          {scorecard.overallScore === null ? "–" : scorecard.overallScore.toFixed(1)}
          <span className="text-lg font-normal text-muted"> of 5</span>
        </p>
        <p className="mt-3 max-w-xl text-sm text-muted">
          This report was made before the 0–100 score existed. Re-score it from the menu at the top to get the full
          breakdown.
        </p>
      </section>
    );
  }

  const score = overall.score;
  const band = scoreBand(score);
  const verdict = insights?.hireBand.label ?? band.label;
  const verdictTone: Tone =
    insights?.hireBand.band === "strong-hire" || insights?.hireBand.band === "hire"
      ? "good"
      : insights?.hireBand.band === "insufficient"
        ? "muted"
        : insights
          ? "bad"
          : band.tone;

  const claims = scorecard.resumeMatch?.claims ?? [];
  const backed = claims.filter((claim) => claim.verdict === "confirmed").length;
  const partly = claims.filter((claim) => claim.verdict === "partly_supported").length;
  const contradicted = claims.filter((claim) => claim.verdict === "not_supported").length;
  const ranked = [...peers].sort((x, y) => (y.overall?.score ?? -1) - (x.overall?.score ?? -1));
  const rank = ranked.findIndex((peer) => peer.roomId === roomId) + 1;
  const flags = insights?.redFlags.items ?? [];
  const coverage = insights?.coverage;
  const talk = insights?.talk.candidatePercent ?? null;
  const medianAnswer = insights?.speaking.medianAnswerSeconds ?? null;

  const outcomes: { label: string; value: string; note: string; tone: Tone; href?: string }[] = [
    {
      label: "Topics covered",
      value: coverage && coverage.planned > 0 ? `${coverage.scored} of ${coverage.planned}` : "—",
      note:
        coverage && coverage.planned > 0
          ? coverage.scored < coverage.planned
            ? "The interview ended early"
            : "Every planned topic"
          : "No plan recorded",
      tone: coverage && coverage.planned > 0 && coverage.scored < coverage.planned ? "warn" : "muted",
      href: "#answers",
    },
    {
      label: "Resume claims backed up",
      value: claims.length > 0 ? `${backed} of ${claims.length}` : "—",
      note:
        claims.length === 0
          ? "Resume not checked"
          : contradicted > 0
            ? `${contradicted} contradicted`
            : partly > 0
              ? `${partly} only partly`
              : "No contradictions",
      tone: contradicted > 0 ? "bad" : partly > 0 ? "warn" : "muted",
      href: "#resume",
    },
    {
      label: "Red flags",
      value: flags.length === 0 ? "None" : String(flags.length),
      note: flags.length === 0 ? "Nothing unusual" : flags[0],
      tone: flags.length === 0 ? "muted" : insights?.redFlags.level === "high" ? "bad" : "warn",
      href: "#authenticity",
    },
    {
      label: "Rank for this role",
      value: rank > 0 && peers.length > 1 ? `${rank} of ${peers.length}` : "—",
      note:
        insights?.benchmark.average != null
          ? `Role average ${Math.round(insights.benchmark.average)}`
          : peers.length > 1
            ? "Among interviewed"
            : "Only candidate so far",
      tone: "muted",
      href: "#peers",
    },
    {
      label: "Candidate talk time",
      value: talk !== null ? `${talk}%` : "—",
      note: medianAnswer !== null ? `About ${Math.round(medianAnswer)}s per answer` : "Not measured",
      tone: talk !== null && talk < 40 ? "warn" : "muted",
      href: "#recording",
    },
  ];

  const outcomeIcons: Record<string, LucideIcon> = {
    "Topics covered": ListChecks,
    "Resume claims backed up": FileSearch,
    "Red flags": Flag,
    "Rank for this role": Trophy,
    "Candidate talk time": Mic,
  };

  return (
    <section id="overview" className={`${cardClasses} scroll-mt-32 overflow-hidden`}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] lg:gap-8">
        {/* verdict */}
        <div className={`relative flex items-center gap-5 rounded-2xl p-5 lg:flex-col lg:items-start ${TONE_TILE[verdictTone]}`}>
          <ScoreRing score={score} size={112} stroke={9} toneClass={TONE_STROKE[band.tone]} label="of 100" />
          <div className="min-w-0">
            <p className="text-sm font-medium opacity-75">Recommendation</p>
            <motion.p
              className="mt-0.5 text-[30px] font-semibold leading-tight tracking-[-0.03em]"
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.2, ease: EASE_OUT }}
            >
              {verdict}
            </motion.p>
            <p className="mt-1 text-sm opacity-75">Overall {band.label.toLowerCase()}</p>
          </div>
        </div>

        {/* factors */}
        <div className="grid grid-cols-2 gap-3">
          {overall.factors.map((factor, index) => {
            const meta = FACTOR_META[factor.id];
            const chip = factorChip(factor.id, factor.score);
            return (
              <a
                key={factor.id}
                href={`#${factorLink(factor.id)}`}
                title={meta.explains}
                className="group flex items-center gap-3.5 rounded-2xl border border-border p-4 transition hover:-translate-y-px hover:border-foreground/15 hover:shadow-md hover:shadow-black/[0.04]"
              >
                <ScoreRing
                  score={factor.score}
                  size={56}
                  stroke={5}
                  toneClass={TONE_STROKE[chip.tone]}
                  delay={0.15 + index * 0.08}
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{meta.name}</span>
                  <span className={`mt-0.5 block text-xs font-medium ${TONE_TEXT[chip.tone]}`}>{chip.label}</span>
                  <span className="mt-0.5 block text-[11px] text-muted">{factor.weight}% of the score</span>
                </span>
                <ChevronRight className="ml-auto size-4 shrink-0 text-muted opacity-0 transition group-hover:opacity-100" aria-hidden />
              </a>
            );
          })}
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {outcomes.map((item) => {
          const Icon = outcomeIcons[item.label] ?? Gauge;
          return (
            <a
              key={item.label}
              href={item.href}
              className={`group min-w-0 rounded-2xl p-4 transition hover:brightness-[0.98] ${TONE_TILE[item.tone]}`}
            >
              <Icon className="size-4 opacity-70" aria-hidden />
              <dd className="mt-3 text-xl font-semibold leading-none tabular-nums tracking-[-0.02em]">{item.value}</dd>
              <dt className="mt-1.5 text-xs font-medium">{item.label}</dt>
              <dd className="mt-0.5 truncate text-[11px] opacity-70" title={item.note}>
                {item.note}
              </dd>
            </a>
          );
        })}
      </dl>

      {scorecard.needsHumanReview && (
        <p className="mt-5 flex items-start gap-2 rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          The two graders disagreed on part of this report. Read the evidence before deciding.
        </p>
      )}
    </section>
  );
}

/** Clamped text with a quiet "More" toggle, for long model-written notes. */
function Clamp({ text, lines = 2, className }: { text: string; lines?: 1 | 2 | 3; className?: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > (lines === 1 ? 90 : lines === 2 ? 170 : 260);
  const clamp = lines === 1 ? "line-clamp-1" : lines === 2 ? "line-clamp-2" : "line-clamp-3";
  return (
    <div className={className}>
      <p className={!open && long ? clamp : undefined}>{text}</p>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="mt-1 text-xs font-medium text-muted transition hover:text-foreground"
        >
          {open ? "Less" : "More"}
        </button>
      )}
    </div>
  );
}

/** One coloured panel of short points. */
function TakeawayList({
  title,
  icon,
  items,
  empty,
  tint,
}: {
  title: string;
  icon: ReactNode;
  items: string[];
  empty: string;
  tint: string;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 3);
  return (
    <div className={`min-w-0 rounded-2xl p-4 sm:p-5 ${tint}`}>
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <span className="grid size-6 place-items-center rounded-full bg-surface/80 shadow-sm shadow-black/[0.04]">{icon}</span>
        {title}
        <span className="ml-auto rounded-full bg-surface/70 px-2 text-xs font-medium tabular-nums">{items.length}</span>
      </h3>
      {items.length === 0 ? (
        <p className="mt-3 text-sm opacity-70">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {shown.map((item, index) => (
            <li key={index} className="rounded-xl bg-surface/75 px-3 py-2.5 text-[13px] leading-5 text-foreground/85">
              <Clamp text={item} lines={2} />
            </li>
          ))}
        </ul>
      )}
      {items.length > 3 && (
        <button
          type="button"
          onClick={() => setAll((current) => !current)}
          className="mt-2.5 text-xs font-semibold hover:underline"
        >
          {all ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}

function SummarySection({
  scorecard,
  insights,
}: {
  scorecard: Scorecard;
  insights: ReportInsights | null;
}) {
  const [full, setFull] = useState(false);
  const integrity = scorecard.integrity;
  const summary = plain(scorecard.summary);
  const lead = firstSentence(summary);
  const rest = summary.slice(lead.length).trim();
  const nextSteps = insights?.nextSteps ?? [];
  const behaviour: { label: string; value: string; warn: boolean }[] = [
    {
      label: "Left the tab",
      value: integrity.tabHiddenCount === 0 ? "Never" : `${integrity.tabHiddenCount}×`,
      warn: integrity.tabHiddenCount > 0,
    },
    { label: "Time away", value: `${Math.round(integrity.tabHiddenSeconds)}s`, warn: integrity.tabHiddenSeconds > 10 },
    { label: "Switched windows", value: `${integrity.windowBlurCount}×`, warn: integrity.windowBlurCount > 2 },
    { label: "Connection drops", value: String(integrity.candidateDisconnects), warn: integrity.candidateDisconnects > 0 },
  ];

  return (
    <section id="summary" className={`${cardClasses} scroll-mt-32`}>
      <CardHeading icon={ScrollText} iconColor="indigo" title="Takeaways" />

      <div className="mt-5 flex gap-3 rounded-2xl border border-accent/15 bg-accent-soft/50 p-4 sm:p-5">
        <Quote className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
        <div className="min-w-0">
          <p className="text-[16px] font-medium leading-7 text-foreground">{lead}</p>
          {rest && (
            <>
              {full && <p className="mt-2 text-sm leading-6 text-foreground/75">{rest}</p>}
              <button
                type="button"
                onClick={() => setFull((current) => !current)}
                aria-expanded={full}
                className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
              >
                {full ? "Hide the full summary" : "Read the full summary"}
                <ChevronDown className={`size-3.5 transition-transform ${full ? "rotate-180" : ""}`} aria-hidden />
              </button>
            </>
          )}
        </div>
      </div>

      <div className={`mt-4 grid gap-3 ${nextSteps.length > 0 ? "lg:grid-cols-3" : "sm:grid-cols-2"}`}>
        <TakeawayList
          title="Strengths"
          tint="bg-emerald-500/[0.07] text-emerald-900 dark:text-emerald-100"
          icon={<Check className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />}
          items={scorecard.strengths}
          empty="Nothing stood out."
        />
        <TakeawayList
          title="Concerns"
          tint="bg-amber-500/[0.09] text-amber-900 dark:text-amber-100"
          icon={<AlertCircle className="size-3.5 text-amber-600 dark:text-amber-400" aria-hidden />}
          items={scorecard.concerns}
          empty="No concerns were raised."
        />
        {nextSteps.length > 0 && (
          <TakeawayList
            title="Ask in the next round"
            tint="bg-accent/[0.06] text-foreground"
            icon={<ArrowRight className="size-3.5 text-accent" aria-hidden />}
            items={nextSteps}
            empty=""
          />
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {behaviour.map((item) => (
          <div
            key={item.label}
            className={`flex items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 text-sm ${
              item.warn ? "bg-amber-500/10 text-amber-800 dark:text-amber-300" : "bg-foreground/[0.035]"
            }`}
          >
            <span className={item.warn ? "" : "text-muted"}>{item.label}</span>
            <span className="font-semibold tabular-nums">{item.value}</span>
          </div>
        ))}
      </div>
      {scorecard.notes.length > 0 && (
        <details className="group mt-3">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-muted transition hover:text-foreground">
            Scoring notes
            <ChevronDown className="size-3.5 transition group-open:rotate-180" aria-hidden />
          </summary>
          <ul className="mt-2 space-y-1 text-sm text-muted">
            {scorecard.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** 3. Answer Quality Section: Structured Table with Scores, Feedback, and Jump-to Recording Pill Buttons */
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
  const score = scorecard.answerQuality ?? (scorecard.overallScore ? Math.round((scorecard.overallScore / 5) * 100) : null);
  const chip = factorChip("answers", score);

  return (
    <section id="answers" className={`${cardClasses} scroll-mt-32`}>
      <CardHeading
        icon={MessagesSquare}
        iconColor="purple"
        title="Answer quality"
        subtitle="Each question, how it was scored and why."
        right={<HeadingScore score={score} tone={chip.tone} label={chip.label} />}
      />

      {scorecard.competencies.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No competency questions were scored for this interview.</p>
      ) : (
        <ol className="mt-6 grid gap-3">
          {scorecard.competencies.map((item, index) => {
            const plan = competencies.find((c) => c.id === item.competencyId);
            const window = evidenceWindow(item.evidence, bySeq, offsetFor);
            const scoreOut10 = item.score !== null ? item.score * 2 : null;
            const tone: Tone =
              scoreOut10 === null ? "muted" : scoreOut10 >= 7 ? "good" : scoreOut10 >= 5 ? "warn" : "bad";
            return (
              <li
                key={item.competencyId}
                className="grid grid-cols-[auto_minmax(0,1fr)] gap-4 rounded-2xl border border-border p-4 transition hover:border-foreground/15 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
              >
                <div className={`grid size-14 place-content-center rounded-xl text-center ${TONE_TILE[tone]}`}>
                  <span className="text-xl font-semibold leading-none tabular-nums">{scoreOut10 ?? "–"}</span>
                  <span className="mt-0.5 text-[10px] font-medium opacity-70">of 10</span>
                </div>
                <div className="min-w-0">
                  <p className="flex items-baseline gap-2">
                    <span className="text-xs font-semibold tabular-nums text-muted">Q{index + 1}</span>
                    <span className="font-semibold text-foreground">{item.name}</span>
                  </p>
                  {plan?.question && <p className="mt-0.5 line-clamp-1 text-xs text-muted">{plan.question}</p>}
                  <Clamp text={plain(item.rationale)} lines={2} className="mt-2 max-w-[75ch] text-sm leading-6 text-foreground/80" />
                </div>
                <div className="col-span-2 flex items-start sm:col-span-1">
                  {window ? (
                    <button
                      type="button"
                      onClick={() => onPlay(window.from)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-full bg-accent-soft px-3 text-xs font-semibold tabular-nums text-accent transition hover:bg-accent hover:text-white"
                    >
                      <Play className="size-3 fill-current" aria-hidden />
                      {formatClock(window.from)}–{formatClock(window.to)}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/**
 * 3b. Custom parameters: the skills the recruiter weighted when creating the
 * interview, scored from the resume and the candidate's own answers.
 */
function CustomParametersSection({ scorecard }: { scorecard: Scorecard }) {
  const parameters = scorecard.customParameters ?? [];
  if (parameters.length === 0) return null;

  const total = scorecard.customScore ?? null;
  const tone: Tone = total === null ? "muted" : total >= 75 ? "good" : total >= 50 ? "warn" : "bad";

  return (
    <section id="custom" className={`${cardClasses} scroll-mt-32`}>
      <CardHeading
        icon={SlidersHorizontal}
        iconColor="indigo"
        title="Custom parameters"
        subtitle="The skills you weighted for this role, assessed from the resume and the candidate's answers."
        right={<HeadingScore score={total} tone={tone} label={total === null ? "Not scored" : "Custom score"} />}
      />


      <div className="-mx-3 mt-6 overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-border text-xs font-medium text-muted">
              <th className="px-3 py-2.5">Parameter</th>
              <th className="w-24 px-4 py-3 text-center">Emphasis</th>
              <th className="w-24 px-4 py-3 text-center">Score</th>
              <th className="px-3 py-2.5">Assessment</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border align-top">
            {parameters.map((item) => {
              const scoreTone =
                item.status !== "scored" || item.score === null
                  ? TONE_TEXT.muted
                  : item.score >= 75
                    ? TONE_TEXT.good
                    : item.score >= 50
                      ? TONE_TEXT.warn
                      : TONE_TEXT.bad;
              return (
                <tr key={item.skill} className="align-top hover:bg-foreground/[0.02]">
                  <td className="px-3 py-4">
                    <p className="font-medium text-foreground">{item.skill}</p>
                    {item.gaps.length > 0 && (
                      <p className="mt-0.5 text-[11px] text-muted line-clamp-1">
                        Gap: {item.gaps[0]}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-4 text-center">
                    <span className="text-xs font-medium tabular-nums text-foreground/80">
                      {item.weight}
                    </span>
                  </td>
                  <td className="px-3 py-4 text-center">
                    <span className={`text-sm font-semibold tabular-nums ${scoreTone}`}>
                      {item.status === "scored" && item.score !== null
                        ? `${item.score}/100`
                        : item.status === "not_assessed"
                          ? "Not assessed"
                          : "Thin evidence"}
                    </span>
                  </td>
                  <td className="px-3 py-4 text-foreground/80">
                    <p className="line-clamp-3">{firstSentence(item.rationale)}</p>
                    {item.resumeEvidence && (
                      <p className="mt-1 text-[11px] text-muted line-clamp-2">
                        Resume: {item.resumeEvidence}
                      </p>
                    )}
                    {item.evidence.length > 0 && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[11px] font-medium text-accent">
                          {item.evidence.length} quote{item.evidence.length === 1 ? "" : "s"}
                        </summary>
                        <ul className="mt-1 space-y-1">
                          {item.evidence.map((quote) => (
                            <li key={`${quote.turnSeq}-${quote.quote.slice(0, 12)}`} className="text-[11px] italic text-muted">
                              “{quote.quote}”
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] text-muted">
        Emphasis is the weight set when the interview was created, not a pass mark. Scores use the
        resume for what the candidate claims and their answers for what they demonstrated.
      </p>
    </section>
  );
}

/** Counts of each verdict as one bar and a tile per verdict. */
function VerdictTally({ claims }: { claims: { verdict: ResumeVerdict }[] }) {
  const reduce = useReducedMotion();
  const order: { verdict: ResumeVerdict; bar: string; tile: string }[] = [
    { verdict: "confirmed", bar: "bg-emerald-500", tile: TONE_TILE.good },
    { verdict: "partly_supported", bar: "bg-amber-400", tile: TONE_TILE.warn },
    { verdict: "not_supported", bar: "bg-rose-500", tile: TONE_TILE.bad },
    { verdict: "not_discussed", bar: "bg-foreground/15", tile: TONE_TILE.muted },
  ];
  const total = claims.length;
  return (
    <div className="mt-6">
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-foreground/[0.05]">
        {order.map(({ verdict, bar }, index) => {
          const count = claims.filter((claim) => claim.verdict === verdict).length;
          return count > 0 ? (
            <motion.span
              key={verdict}
              className={bar}
              initial={reduce ? false : { width: 0 }}
              animate={{ width: `${(count / total) * 100}%` }}
              transition={{ duration: 0.7, delay: 0.1 + index * 0.06, ease: EASE_OUT }}
            />
          ) : null;
        })}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {order.map(({ verdict, tile }) => {
          const count = claims.filter((claim) => claim.verdict === verdict).length;
          return (
            <div key={verdict} className={`rounded-xl px-3.5 py-2.5 ${count > 0 ? tile : "bg-foreground/[0.03] text-muted"}`}>
              <dd className="text-xl font-semibold leading-none tabular-nums">{count}</dd>
              <dt className="mt-1 text-xs font-medium opacity-80">{VERDICT_LABELS[verdict]}</dt>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

/** 4. Resume Match Section: Table showing claims, verdict badges, interview evidence, and notes */
function ResumeTable({
  scorecard,
  turns,
  competencies,
  onAnalyseResume,
  isAnalysing,
}: {
  scorecard: Scorecard;
  turns: InterviewTurn[];
  competencies: PlanCompetency[];
  onAnalyseResume: () => void;
  isAnalysing: boolean;
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
    <section id="resume" className={`${cardClasses} scroll-mt-32`}>
      <CardHeading
        icon={FileSearch}
        iconColor="violet"
        title="Resume match"
        subtitle="Claims from the resume, checked against what the candidate said."
        right={<HeadingScore score={resume.score} tone={chip.tone} label={chip.label} />}
      />

      {resume.claims.length > 0 && <VerdictTally claims={resume.claims} />}

      {resume.claims.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          {resume.reason ?? "No resume claims were evaluated for this interview."}
        </p>
      ) : (
        <>
          <ul className="mt-5 grid gap-2.5 md:grid-cols-2">
            {resume.claims
              .filter((claim) => claim.verdict !== "not_discussed")
              .map((claim) => {
                const questions = [
                  ...new Set(
                    claim.turnSeqs
                      .map((seq) => turnToQuestion.get(seq))
                      .filter((val): val is number => typeof val === "number"),
                  ),
                ];
                const style = VERDICT_STYLES[claim.verdict];
                const Icon = style.icon;
                return (
                  <li key={claim.claim} className={`flex gap-3 rounded-xl border p-3.5 ${style.border} ${style.bg}`}>
                    <span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-surface ${style.text}`}>
                      <Icon className="size-3.5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-5 text-foreground">{claim.claim}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                        <span className={`font-semibold ${style.text}`}>{VERDICT_LABELS[claim.verdict]}</span>
                        {questions.map((q) => (
                          <span key={q} className="rounded-md bg-surface px-1.5 py-0.5 font-medium text-muted">
                            Q{q}
                          </span>
                        ))}
                      </p>
                      {claim.note && <Clamp text={claim.note} lines={1} className="mt-1.5 text-xs leading-5 text-muted" />}
                    </div>
                  </li>
                );
              })}
          </ul>
          {resume.claims.some((claim) => claim.verdict === "not_discussed") && (
            <details className="group mt-3 rounded-xl border border-dashed border-border">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-muted transition hover:text-foreground">
                <Minus className="size-3.5" aria-hidden />
                Not discussed in the interview
                <span className="rounded-md bg-foreground/[0.06] px-1.5 text-xs tabular-nums">
                  {resume.claims.filter((claim) => claim.verdict === "not_discussed").length}
                </span>
                <ChevronDown className="ml-auto size-4 transition group-open:rotate-180" aria-hidden />
              </summary>
              <ul className="flex flex-wrap gap-2 px-4 pb-4">
                {resume.claims
                  .filter((claim) => claim.verdict === "not_discussed")
                  .map((claim) => (
                    <li
                      key={claim.claim}
                      title={claim.note ?? undefined}
                      className="rounded-lg bg-foreground/[0.04] px-2.5 py-1.5 text-xs leading-5 text-foreground/75"
                    >
                      {claim.claim}
                    </li>
                  ))}
              </ul>
            </details>
          )}
        </>
      )}

      {resume.score === null && resume.reason && resume.claims.length > 0 && (
        <p className="mt-4 text-sm text-muted">
          {resume.reason}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onAnalyseResume}
          disabled={isAnalysing}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-medium transition hover:border-foreground/20 hover:bg-foreground/[0.03] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RotateCcw className={`size-3.5 ${isAnalysing ? "animate-spin" : ""}`} />
          {isAnalysing
            ? "Analysing resume"
            : resume.score === null
              ? "Analyse resume"
              : "Re-check resume"}
        </button>
        <span className="text-[11px] text-muted">
          Checks the resume against what the candidate actually said. Takes a few seconds.
        </span>
      </div>
    </section>
  );
}

/** 5. Own Answers (Originality) Section: Originality assessment, indicators, expandable signal descriptions */
function OwnAnswersSection({ scorecard }: { scorecard: Scorecard }) {
  const authenticity = scorecard.authenticity;
  if (!authenticity) return null;
  const chip = factorChip("authenticity", authenticity.score);
  const signals = authenticity.signals ?? [];

  return (
    <section id="authenticity" className={`${cardClasses} scroll-mt-32`}>
      <CardHeading
        icon={Fingerprint}
        iconColor="emerald"
        title="Originality"
        subtitle="Whether the answers read as the candidate's own."
        right={<HeadingScore score={authenticity.score} tone={chip.tone} label={chip.label} />}
      />

      {signals.length === 0 ? (
        <p className="mt-5 flex items-center gap-2 text-[15px] text-foreground/85">
          <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
          Nothing suggests the answers were read out or prepared by someone else.
        </p>
      ) : (
        <ul className="mt-5 divide-y divide-border border-y border-border">
          {signals.map((signal, idx) => {
            const serious = signal.severity >= 2;
            return (
              <li key={idx} className="grid gap-1 py-4 sm:grid-cols-[minmax(0,1fr)_9rem] sm:gap-6">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{signal.title}</p>
                  <p className="mt-1 max-w-prose text-sm leading-6 text-muted">{signal.detail}</p>
                </div>
                <div className="text-sm sm:text-right">
                  <p className={`font-medium ${serious ? TONE_TEXT.bad : TONE_TEXT.warn}`}>
                    {serious ? "Serious" : "Worth a look"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {signal.source === "measured" ? "Measured from timings" : "Read from the transcript"}
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

/** 6. On-camera Behaviour Section: analysis and per-answer gaze table. */
function VideoSection({
  scorecard,
  hasRecording,
  onPlay,
  onAnalyseVideo,
  isAnalysing,
}: {
  scorecard: Scorecard;
  hasRecording: boolean;
  onPlay: (seconds: number) => void;
  onAnalyseVideo: () => void;
  isAnalysing: boolean;
}) {
  const video = scorecard.video;
  if (!video) return null;
  const integrity = scorecard.integrity;
  const answers = video.answers ?? [];
  const pattern = video.pattern ?? null;
  const chip = factorChip("video", video.score ?? null);

  const onSpot = (answer: AnswerGaze) =>
    pattern !== null &&
    pattern.direction !== null &&
    pattern.sameSpotAnswers >= 2 &&
    answer.steady &&
    answer.whileAnswering === pattern.direction;

  // Turns with no spoken answer have no footage to look at, so they are left
  // out of the timeline and the table entirely.
  const answerRows = answers.filter((answer) => answer.durationSeconds > 0);
  const measurable = answerRows.filter(
    (answer) => answer.whileAnswering !== "unclear" && !answer.reason,
  ).length;

  return (
    <section id="video" className={`${cardClasses} scroll-mt-32`} data-video-model={video.model ?? undefined}>
      <CardHeading
        icon={Video}
        iconColor="rose"
        title="On-camera behaviour"
        subtitle="Analysis based on the recorded interview video."
        right={<HeadingScore score={video.score} tone={chip.tone} label={chip.label} />}
      />

      <div className="mt-5 grid gap-6">
        <div className="grid grid-cols-3 content-start gap-6 border-y border-border py-4">
          <div>
            <span className="text-sm text-muted">Same-spot answers</span>
            <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
              {pattern && pattern.answersObserved > 0
                ? `${pattern.sameSpotAnswers >= 2 ? pattern.sameSpotAnswers : 0} of ${pattern.answersObserved}`
                : "Not measured"}
            </p>
          </div>
          <div>
            <span className="text-sm text-muted">Left the interview tab</span>
            <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
              {integrity.tabHiddenCount === 0
                ? "Never"
                : `${integrity.tabHiddenCount}× (${integrity.tabHiddenSeconds}s)`}
            </p>
          </div>
          <div>
            <span className="text-sm text-muted">Connection drops</span>
            <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
              {integrity.candidateDisconnects}
            </p>
          </div>
        </div>

        <div>

          {video.status === "analysed" ? (
            <>
              {video.summary && (
                <p className="mt-3.5 text-xs leading-relaxed text-foreground/85">
                  {video.summary}
                </p>
              )}
              {video.moments.length > 0 && (
                <ul className="mt-3 divide-y divide-slate-100 border-y border-border text-xs dark:divide-border dark:border-border">
                  {video.moments.map((moment, index) => (
                    <li key={index} className="flex items-center gap-3 py-2">
                      <button
                        type="button"
                        onClick={() => onPlay(moment.atSeconds - 2)}
                        className="font-bold tabular-nums text-accent hover:underline"
                      >
                        {formatClock(moment.atSeconds)}
                      </button>
                      <span className="text-foreground/80">{moment.description}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-muted">
                {video.reason ?? "The recording has not been analysed."}
              </p>
              {video.status === "queued" && (
                <p className="flex items-center gap-2 text-xs font-medium text-blue-600 dark:text-accent">
                  <span className="size-1.5 animate-pulse rounded-full bg-blue-500 dark:bg-accent" />
                  The analyser is working on this recording. This card updates by itself.
                </p>
              )}
            </div>
          )}

          {hasRecording && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onAnalyseVideo}
                disabled={isAnalysing || video.status === "queued"}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-medium transition hover:border-foreground/20 hover:bg-foreground/[0.03] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCcw
                  className={`size-3.5 ${isAnalysing || video.status === "queued" ? "animate-spin" : ""}`}
                />
                {isAnalysing || video.status === "queued"
                  ? "Analysing recording"
                  : video.status === "analysed"
                    ? "Re-check video"
                    : video.status === "failed"
                      ? "Try video analysis again"
                      : "Analyse this video"}
              </button>
              <span className="text-[11px] text-muted">
                Re-watches the recording for eye contact and presence. Takes about a minute.
              </span>
            </div>
          )}

          <p className="mt-4 text-xs text-muted">
            An automated reading of the recording. Watch the moments it points to before relying on it.
          </p>
        </div>

        {/* Where the candidate looked table */}
        {answerRows.length > 0 && (
          <div className="lg:col-span-2 mt-2">
            <h3 className="text-sm font-medium text-foreground">Where the candidate looked, answer by answer</h3>
            <p className="mt-1 text-[11px] text-muted dark:text-muted">
              {measurable === answerRows.length
                ? `${answerRows.length} of ${answerRows.length} answers could be measured on camera.`
                : `${measurable} of ${answerRows.length} answers could be measured on camera. The rest say why not.`}
            </p>
            <div className="-mx-3 mt-3 overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-border text-xs font-medium text-muted">
                    <th className="px-3.5 py-2.5">Answer at</th>
                    <th className="px-3.5 py-2.5">While listening</th>
                    <th className="px-3.5 py-2.5">While answering</th>
                    <th className="px-3.5 py-2.5">Observations</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border align-top">
                  {answerRows.map((answer) => (
                    <tr
                      key={answer.turnSeq}
                      className={onSpot(answer) ? "bg-amber-500/[0.06]" : undefined}
                    >
                      <td className="px-3.5 py-2.5 align-top">
                        <button
                          type="button"
                          onClick={() => onPlay(answer.atSeconds - 2)}
                          className="font-semibold tabular-nums text-accent hover:underline"
                        >
                          {formatClock(answer.atSeconds)}
                        </button>
                        <span className="ml-1.5 text-[11px] text-muted">({answer.durationSeconds}s)</span>
                      </td>
                      <td className="px-3.5 py-2.5 align-top">
                        <GazeCell direction={answer.whileListening} />
                      </td>
                      <td className="px-3.5 py-2.5 align-top">
                        <GazeCell direction={answer.whileAnswering} strong={onSpot(answer)} />
                      </td>
                      <td className="px-3.5 py-2.5 align-top text-muted">
                        {answer.reason ? (
                          <span className="block text-[11px] font-medium text-amber-700 dark:text-amber-400">
                            {answer.reason}
                          </span>
                        ) : (
                          [
                            onSpot(answer) ? "Held on the same spot as other answers." : null,
                            answer.reading ? "Reading-like eye movement." : null,
                            answer.note ? answer.note.replace(/_/g, " ") : null,
                          ]
                            .filter(Boolean)
                            .join(" ") || <span className="text-muted">Nothing notable.</span>
                        )}
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

/** 9-cell gaze grid cell */
function GazeCell({ direction, strong = false }: { direction: GazeDirection; strong?: boolean }) {
  const active = GAZE_GRID.indexOf(direction);
  return (
    <span className="inline-flex items-center gap-2">
      <span className="grid grid-cols-3 gap-0.5" aria-hidden="true">
        {GAZE_GRID.map((cell, index) => (
          <span
            key={cell}
            className={`size-1.5 rounded-[1px] ${
              index === active ? (strong ? "bg-amber-500" : "bg-blue-600") : "bg-slate-200 dark:bg-slate-700"
            }`}
          />
        ))}
      </span>
      <span className={strong ? "font-semibold text-amber-700 dark:text-amber-400" : "text-foreground/85"}>
        {GAZE_LABEL[direction]}
      </span>
    </span>
  );
}

/** Recording and transcript, side by side and locked to the same clock. */
function RecordingPanel({
  roomId,
  hasRecording,
  turns,
  candidateName,
  offsetFor,
  videoRef,
  moments,
  durationSeconds,
}: {
  roomId: string;
  hasRecording: boolean;
  turns: InterviewTurn[];
  candidateName: string;
  offsetFor: (turn: InterviewTurn) => number | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  moments: { atSeconds: number; description: string }[];
  durationSeconds: number | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationSeconds ?? 0);
  const [playing, setPlaying] = useState(false);
  const [filter, setFilter] = useState<"all" | "candidate" | "interviewer">("all");
  const [query, setQuery] = useState("");
  const [pickedSeq, setPickedSeq] = useState<number | null>(null);
  const [videoFailed, setVideoFailed] = useState(false);
  const [attempt, setVideoAttempt] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const total = duration > 0 ? duration : (durationSeconds ?? 0);

  // Every turn that has a real recording timestamp, in speaking order.
  const timed = turns
    .map((turn) => ({ turn, at: offsetFor(turn) }))
    .filter((entry): entry is { turn: InterviewTurn; at: number } => entry.at !== null);

  // The segment being spoken is the most recently started turn at or before
  // the playhead. Real-time transcription can start turns slightly out of
  // order, so every entry is checked instead of stopping at the first gap.
  let active: { turn: InterviewTurn; at: number } | null = null;
  for (const entry of timed) {
    if (entry.at <= currentTime + 0.05 && (active === null || entry.at >= active.at)) {
      active = entry;
    }
  }
  // A line the recruiter just clicked wins until the playhead moves on, so
  // two fragments that start on the same second do not steal the highlight.
  if (pickedSeq !== null) {
    const picked = timed.find((entry) => entry.turn.seq === pickedSeq);
    if (picked && Math.abs(picked.at - currentTime) <= 0.8) active = picked;
  }
  const activeSeq = active ? active.turn.seq : null;

  useEffect(() => {
    if (activeSeq === null) return;
    const container = listRef.current;
    const row = container?.querySelector<HTMLElement>(`[data-seq="${activeSeq}"]`);
    if (!container || !row) return;
    const rowTop = row.offsetTop;
    const rowBottom = rowTop + row.offsetHeight;
    const visibleTop = container.scrollTop;
    const visibleBottom = visibleTop + container.clientHeight;
    // Follow only when the segment leaves the panel, so a reader is not
    // yanked around by every overlapping fragment.
    if (rowTop >= visibleTop + 8 && rowBottom <= visibleBottom - 8) return;
    const top = rowTop - container.clientHeight / 2 + row.offsetHeight / 2;
    container.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, [activeSeq]);

  const needle = query.trim().toLowerCase();
  const visible = turns.filter(
    (turn) =>
      (filter === "all" || turn.speaker === filter) &&
      (needle === "" || turn.text.toLowerCase().includes(needle)),
  );

  function seek(seconds: number) {
    const video = videoRef.current;
    setCurrentTime(seconds);
    if (video) video.currentTime = seconds;
  }

  function jumpTo(turn: InterviewTurn) {
    if (!hasRecording || videoFailed) return;
    const at = offsetFor(turn);
    if (at === null) return;
    setPickedSeq(turn.seq);
    seek(at);
    void videoRef.current?.play().catch(() => {});
  }

  const progress = total > 0 ? Math.min(100, (currentTime / total) * 100) : 0;
  const markers = [
    ...timed.map((entry) => ({
      at: entry.at,
      kind: "answer" as const,
      label: `${entry.turn.speaker === "candidate" ? candidateName : "Interviewer"} at ${formatClock(entry.at)}`,
    })),
    ...moments.map((moment) => ({
      at: moment.atSeconds,
      kind: "moment" as const,
      label: `${formatClock(moment.atSeconds)} ${moment.description}`,
    })),
  ].filter((marker) => marker.at >= 0 && (total === 0 || marker.at <= total));

  return (
    <section id="recording" className={`${cardClasses} scroll-mt-32`}>
      <CardHeading
        icon={Video}
        iconColor="rose"
        title="Recording & transcript"
        subtitle="Watch the interview and follow every answer in step."
        right={
          <div className="flex items-center gap-2">
            <span className="hidden text-[11px] font-medium tabular-nums text-muted sm:inline">
              {hasRecording && !videoFailed && total > 0 ? `${formatClock(currentTime)} / ${formatClock(total)}` : ""}
            </span>
            <button
              type="button"
              onClick={() => setExpanded((previous) => !previous)}
              aria-pressed={expanded}
              aria-label={expanded ? "Collapse video" : "Expand video"}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-xs transition hover:border-accent hover:text-accent dark:border-border dark:bg-surface dark:text-slate-200"
            >
              {expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
              <span>{expanded ? "Collapse" : "Expand"}</span>
            </button>
          </div>
        }
      />

      <div
        className={`mt-5 grid grid-cols-1 gap-5 ${
          expanded ? "" : "lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]"
        }`}
      >
        {/* Left: the recording, its controls and the shared timeline */}
        <div className="min-w-0">
          {hasRecording && !videoFailed ? (
            <video
              key={attempt}
              ref={videoRef}
              controls
              playsInline
              preload="metadata"
              src={`/api/dashboard/interviews/${roomId}/recording`}
              onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
              onLoadedMetadata={(event) => {
                setDuration(
                  Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0,
                );
                setVideoFailed(false);
              }}
              onError={() => {
                setVideoFailed(true);
                setPlaying(false);
              }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onSeeked={(event) => setCurrentTime(event.currentTarget.currentTime)}
              className={`aspect-video w-full rounded-xl bg-slate-950 shadow-xs ${
                expanded ? "max-h-[70vh]" : ""
              }`}
            />
          ) : (
            <div className="grid aspect-video place-items-center rounded-xl bg-slate-900 p-6 text-center">
              {hasRecording ? (
                <div>
                  <AlertTriangle className="mx-auto size-5 text-amber-400" />
                  <p className="mt-2 text-xs font-semibold text-slate-200">
                    This recording could not be loaded
                  </p>
                  <p className="mt-1 text-[11px] text-muted">
                    The file may still be uploading, or it is missing from storage.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setVideoFailed(false);
                      setVideoAttempt((value) => value + 1);
                    }}
                    className="mt-3 rounded-lg border border-white/20 px-3 py-1 text-[11px] font-semibold text-slate-200 transition hover:border-white/40 hover:text-white"
                  >
                    Try again
                  </button>
                </div>
              ) : (
                <span className="text-xs text-muted">This interview was not recorded.</span>
              )}
            </div>
          )}

          {hasRecording && !videoFailed && total > 0 && (
            <div className="mt-3">
              <div className="relative h-2.5">
                <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-slate-200 dark:bg-slate-700" />
                <div
                  className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-blue-600"
                  style={{ width: `${progress}%` }}
                />
                {markers.map((marker, index) => (
                  <span
                    key={index}
                    title={marker.label}
                    className={`pointer-events-none absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white dark:ring-surface ${
                      marker.kind === "moment" ? "bg-rose-500" : "bg-blue-500"
                    }`}
                    style={{ left: `${Math.min(100, (marker.at / total) * 100)}%` }}
                  />
                ))}
                <input
                  type="range"
                  min={0}
                  max={total}
                  step={0.1}
                  value={Math.min(currentTime, total)}
                  onChange={(event) => seek(Number(event.target.value))}
                  aria-label="Seek recording"
                  className="absolute inset-0 w-full cursor-pointer opacity-0"
                />
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] tabular-nums text-muted">
                <span>{formatClock(currentTime)}</span>
                <span className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full bg-blue-500" /> Turn
                  </span>
                  {moments.length > 0 && (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="size-1.5 rounded-full bg-rose-500" /> Moment
                    </span>
                  )}
                  <span>{formatClock(total)}</span>
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Right: transcript that follows the playhead */}
        <div
          id="transcript"
          className="flex min-w-0 scroll-mt-32 flex-col overflow-hidden rounded-xl border border-border bg-white dark:border-border dark:bg-surface"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-3.5 py-2.5 dark:border-border">
            <div className="flex min-w-0 items-center gap-2">
              <ScrollText className="size-3.5 shrink-0 text-muted" />
              <span className="text-xs font-semibold text-foreground">Transcript</span>
              {playing && active ? (
                <span className="inline-flex min-w-0 items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                  <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500" />
                  <span className="truncate">
                    Following · {formatClock(active.at)}
                  </span>
                </span>
              ) : active ? (
                <span className="text-[10px] font-medium tabular-nums text-muted">
                  {formatClock(active.at)}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-1">
              {(["all", "candidate", "interviewer"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  aria-pressed={filter === value}
                  className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold capitalize transition ${
                    filter === value
                      ? "bg-accent-soft text-accent"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  {value === "all" ? "All" : value === "candidate" ? "Candidate" : "Interviewer"}
                </button>
              ))}
            </div>
          </div>

          <div className="border-b border-border px-3 py-2 dark:border-border">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search this conversation…"
                className="w-full rounded-lg border border-border bg-background/50 py-1.5 pl-8 pr-3 text-xs outline-none transition placeholder:text-muted focus:border-accent focus:bg-surface"
              />
            </div>
          </div>

          {turns.length === 0 ? (
            <p className="px-3.5 py-6 text-xs text-muted">
              Nothing has been said in this interview yet.
            </p>
          ) : (
            <div
              ref={listRef}
              className="relative min-h-[220px] flex-1 overflow-y-auto p-2"
              style={{ maxHeight: expanded ? 300 : 290 }}
            >
              {visible.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-muted">
                  No lines match that filter.
                </p>
              ) : (
                <div className="grid gap-1">
                  {visible.map((turn) => {
                    const candidate = turn.speaker === "candidate";
                    const at = offsetFor(turn);
                    const isActive = turn.seq === activeSeq;
                    const canJump = hasRecording && !videoFailed && at !== null;
                    return (
                      <button
                        key={turn.seq}
                        type="button"
                        data-seq={turn.seq}
                        onClick={() => jumpTo(turn)}
                        disabled={!canJump}
                        aria-current={isActive ? "true" : undefined}
                        className={`relative w-full rounded-lg border px-2.5 py-2 text-left transition ${
                          isActive
                            ? "border-blue-200 bg-blue-50/80 dark:border-accent/30 dark:bg-accent/10"
                            : "border-transparent hover:border-border hover:bg-slate-50 dark:hover:border-border dark:hover:bg-background/40"
                        } ${canJump ? "cursor-pointer" : "cursor-default"}`}
                      >
                        {isActive && (
                          <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-blue-600 dark:bg-accent" />
                        )}
                        <span className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span
                              className={`grid size-5 shrink-0 place-items-center rounded-full text-[9px] font-semibold uppercase ${
                                candidate
                                  ? "bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300"
                                  : "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                              }`}
                            >
                              {candidate ? initials(candidateName) : "I"}
                            </span>
                            <span className="truncate text-[11px] font-semibold text-foreground">
                              {candidate ? candidateName : "Interviewer"}
                            </span>
                          </span>
                          <span
                            className={`shrink-0 text-[10px] tabular-nums ${
                              isActive
                                ? "font-semibold text-blue-600 dark:text-accent"
                                : "text-muted"
                            }`}
                          >
                            {at !== null ? formatClock(at) : `#${turn.seq}`}
                          </span>
                        </span>
                        <span
                          className={`mt-1 text-xs leading-relaxed ${
                            isActive ? "block" : "line-clamp-4"
                          } ${
                            isActive
                              ? "text-foreground"
                              : "text-foreground/80"
                          }`}
                        >
                          {turn.text}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <p className="border-t border-border px-3.5 py-2 text-[10px] text-muted dark:border-border">
            {!hasRecording
              ? "Transcript only. No recording is available for this interview."
              : videoFailed
                ? "Transcript only. The recording could not be loaded."
                : "Click any line to jump the recording to that moment."}
          </p>
        </div>
      </div>
    </section>
  );
}

/** 8. Voice Session Section: Technical Recording Details and Audio Download */
function VoiceSection({
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

  const facts = [
    { label: "Duration", value: session.outcome ? formatDuration(session.outcome.elapsedSeconds) : "—" },
    { label: "Recording size", value: bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : "—" },
    { label: "Voice AI cost", value: cost ? `$${cost.usd.toFixed(2)}` : "—" },
    { label: "Ended", value: session.outcome?.reason ? (END_REASONS[session.outcome.reason] ?? "—") : "—" },
  ];

  return (
    <details id="voice" className="group rounded-2xl border border-border bg-surface px-5 shadow-sm shadow-black/[0.02] sm:px-7">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-5 text-sm font-medium text-muted transition hover:text-foreground">
        Interview details
        <ChevronDown className="size-4 text-muted transition group-open:rotate-180" aria-hidden />
      </summary>
      <div className="flex flex-wrap items-end justify-between gap-4 pb-8">
        <dl className="grid grid-cols-2 gap-x-10 gap-y-4 sm:grid-cols-4">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt className="text-xs text-muted">{fact.label}</dt>
              <dd className="mt-1 text-sm font-medium">{fact.value}</dd>
            </div>
          ))}
        </dl>
        {hasRecording && (
          <a
            href={`/api/dashboard/interviews/${session.id}/recording`}
            download
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium transition hover:bg-foreground/[0.03]"
          >
            <Download className="size-4 text-muted" aria-hidden />
            Download audio
          </a>
        )}
      </div>
    </details>
  );
}

/** 9. Comments & Hiring Decision Section: Recruiter Decision & Notes */
function CommentsDecisionSection({
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
  const [savedSuccess, setSavedSuccess] = useState(false);

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
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the decision.");
    } finally {
      setIsSaving(false);
    }
  }

  const unchanged = decision !== null && decision.outcome === outcome && decision.note === note;

  return (
    <section id="comments" className={`${cardClasses} scroll-mt-32`}>
      <CardHeading
        icon={MessageSquare}
        iconColor="sky"
        title="Your decision"
        subtitle="The score is advice. The hiring team sees what you record here."
        right={
          decision ? (
            <span className="text-xs text-muted">
              Saved {formatDateTime(decision.decidedAt)}
            </span>
          ) : undefined
        }
      />

      <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
        {DECISION_OPTIONS.map((option) => {
          const selected = outcome === option.value;
          const selectedClasses =
            option.value === "advance"
              ? "border-emerald-500/60 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
              : option.value === "hold"
                ? "border-amber-500/60 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
                : "border-rose-500/60 bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400";
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => setOutcome(option.value)}
              className={`flex h-11 items-center justify-center gap-2 rounded-xl border text-sm font-medium transition ${
                selected ? selectedClasses : "border-border text-foreground/80 hover:border-foreground/20 hover:bg-foreground/[0.03]"
              }`}
            >
              <span
                className={`grid size-4 place-items-center rounded-full border ${
                  selected ? "border-current" : "border-foreground/25"
                }`}
              >
                {selected && <Check className="size-2.5 stroke-[3]" />}
              </span>
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={2000}
        rows={3}
        placeholder="Why this decision? Notes for the hiring team"
        className="mt-3 w-full resize-y rounded-xl border border-border bg-background/50 p-3.5 text-sm leading-6 outline-none transition placeholder:text-muted focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/15"
      />

      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
      {savedSuccess && (
        <p className="mt-2 text-xs font-medium text-emerald-600 flex items-center gap-1.5">
          <Check className="size-3.5" />
          <span>Decision saved.</span>
        </p>
      )}

      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-muted">{note.length > 0 ? `${note.length} / 2000` : ""}</span>
        <button
          type="button"
          onClick={handleSave}
          disabled={!outcome || isSaving || unchanged}
          className="h-9 rounded-lg bg-accent px-4 text-sm font-medium text-white shadow-sm shadow-accent/20 transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
        >
          {isSaving ? "Saving…" : "Save decision"}
        </button>
      </div>
    </section>
  );
}

/** Other candidates for the same role, ranked by score. */
function PeersSection({ peers, currentId }: { peers: PeerSummary[]; currentId: string }) {
  const ranked = [...peers].sort((a, b) => (b.overall?.score ?? -1) - (a.overall?.score ?? -1));
  return (
    <section id="peers" className={`${cardClasses} scroll-mt-32`}>
      <CardHeading title="Compared with this role" subtitle="Everyone interviewed for the same role, on the same plan and scale." />
      <ol className="mt-5 grid gap-1">
        {ranked.map((peer, index) => {
          const isCurrent = peer.roomId === currentId;
          const score = peer.overall?.score ?? null;
          const tone = scoreBand(score).tone;
          const row = (
            <div
              className={`grid grid-cols-[1.5rem_minmax(0,1fr)_minmax(0,12rem)_2.5rem_6rem] items-center gap-4 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                isCurrent ? "bg-accent-soft" : "hover:bg-foreground/[0.03]"
              }`}
            >
              <span className="text-xs text-muted">{index + 1}</span>
              <span className="flex min-w-0 items-center gap-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-foreground/[0.06] text-[11px] font-semibold">
                  {initials(peer.candidateName)}
                </span>
                <span className="truncate font-medium">
                  {peer.candidateName || "Candidate"}
                  {isCurrent && <span className="ml-2 text-xs font-normal text-accent">This report</span>}
                </span>
              </span>
              <span className="h-1.5 overflow-hidden rounded-full bg-foreground/[0.07]">
                {score !== null && <span className={`block h-full rounded-full ${isCurrent ? "bg-accent" : "bg-foreground/60"}`} style={{ width: `${score}%` }} />}
              </span>
              <span className={`text-right font-semibold tabular-nums ${score !== null ? TONE_TEXT[tone] : ""}`}>{score ?? "—"}</span>
              <span className="text-right text-xs text-muted">
                {peer.decision ? DECISION_LABELS[peer.decision.outcome] : "No decision"}
              </span>
            </div>
          );
          return (
            <li key={peer.roomId}>
              {isCurrent ? row : <Link href={`/dashboard/${peer.roomId}`}>{row}</Link>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Resume Viewer Modal */
function ResumeModal({
  resume,
  roomId,
  candidateName,
  onClose,
}: {
  resume: InterviewRoom["resume"];
  roomId: string;
  candidateName: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const fileUrl = `/api/dashboard/interviews/${roomId}/resume`;
  const fileName = resume?.fileName || `${candidateName}_Resume.pdf`;
  const isPdf = fileName.toLowerCase().endsWith(".pdf");
  const hasOriginal = Boolean(resume?.objectPath);

  function copyText() {
    if (resume?.text) {
      navigator.clipboard.writeText(resume.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs">
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-2xl border border-border bg-white p-6 shadow-2xl dark:border-border dark:bg-surface">
        <div className="flex items-start justify-between gap-4 border-b border-border pb-4 dark:border-border">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-foreground">
              Candidate resume
            </h3>
            <p className="truncate text-xs text-muted">{fileName}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <a
              href={fileUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-accent hover:text-accent dark:border-border dark:bg-surface dark:text-slate-300"
            >
              <ExternalLink className="size-3.5 text-muted" />
              <span>Open in new tab</span>
            </a>
            <a
              href={fileUrl}
              download={fileName}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-accent hover:text-accent dark:border-border dark:bg-surface dark:text-slate-300"
            >
              <Download className="size-3.5 text-muted" />
              <span>Download</span>
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close resume"
              className="grid size-8 place-items-center rounded-lg text-muted hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {hasOriginal && isPdf ? (
          <iframe
            src={`${fileUrl}#view=FitH`}
            title={`Resume of ${candidateName}`}
            className="mt-4 h-[62vh] w-full rounded-xl border border-border bg-slate-50 dark:border-border"
          />
        ) : (
          <div className="mt-4 flex-1 overflow-y-auto rounded-xl border border-border bg-slate-50/50 p-4 text-xs leading-relaxed font-mono text-slate-700 dark:border-border dark:bg-background/40 dark:text-slate-300 whitespace-pre-wrap">
            {resume?.text ||
              (hasOriginal
                ? "This is a Word document. Use Download to open the original."
                : "No resume is available for this candidate.")}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between">
          {resume?.text ? (
            <button
              type="button"
              onClick={copyText}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-border dark:bg-surface dark:text-slate-300"
            >
              <Copy className="size-3.5 text-muted" />
              <span>{copied ? "Copied!" : "Copy text"}</span>
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-accent px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** Fallback Plan Preview */
function PlanPreview({ competencies }: { competencies: PlanCompetency[] }) {
  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold">Interview plan</h3>
      <ol className="mt-2 grid list-decimal gap-1.5 pl-5 text-xs text-muted">
        {competencies.map((c) => (
          <li key={c.id}>
            <span className="font-semibold text-slate-800 dark:text-slate-200">{c.name}:</span>{" "}
            <span>{c.question}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------------- Helper Functions ---------------- //

function initials(name: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "C";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

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
        : start + 30;
    offsets.push({ start, end });
  }
  if (offsets.length === 0) return null;
  offsets.sort((a, b) => a.start - b.start);
  return { from: offsets[0].start, to: Math.max(offsets[offsets.length - 1].end, offsets[0].start + 10) };
}

function scoreBand(score: number | null): { label: string; tone: Tone } {
  if (score === null) return { label: "Not scored", tone: "muted" };
  if (score >= 65) return { label: "Good match", tone: "good" };
  if (score >= 50) return { label: "Needs improvement", tone: "warn" };
  return { label: "Needs attention", tone: "bad" };
}

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
  if (id === "answers") return "answers";
  if (id === "resume") return "resume";
  if (id === "authenticity") return "authenticity";
  if (id === "video") return "video";
  return id;
}

function recordingBytes(events: InterviewEvent[]): number | null {
  const finished = events.find((event) => event.type === "recording_finished");
  const bytes = finished?.data?.bytes;
  return typeof bytes === "number" && bytes > 0 ? bytes : null;
}

function formatClock(totalSeconds: number): string {
  const whole = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

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
