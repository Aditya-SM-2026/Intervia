"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { EASE_OUT } from "@/components/ui/animated";
import { ScoreRing } from "@/components/ui/ScoreRing";
import { InfoTip } from "@/components/ui/InfoTip";
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
  FactorId,
  HrSpeechEntry,
  IntegrityCheck,
  IntegrityLevel,
  InterviewDetailResponse,
  PeerSummary,
  ResumeProfile,
  ResumeVerdict,
  Scorecard,
  ScoreEvidence,
} from "@/lib/interviews/scorecard.types";
import { FACTOR_META } from "./factors";
import { buildReportInsights, type ReportInsights } from "@/lib/interviews/report-insights";
import { CandidateAssistant } from "./CandidateAssistant";
import {
  AlertCircle,
  AlertTriangle,
  AppWindow,
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
  Eye,
  FileText,
  Gauge,
  Maximize2,
  Mic,
  MessageSquare,
  MessagesSquare,
  Minimize2,
  Minus,
  MoreHorizontal,
  Pencil,
  Play,
  RotateCcw,
  ScrollText,
  ScanFace,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  SlidersHorizontal,
  Sparkles,
  Trophy,
  User,
  Users,
  X,
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

const TONE_TEXT: Record<Tone, string> = {
  good: "text-emerald-700 dark:text-emerald-400",
  warn: "text-amber-700 dark:text-amber-400",
  bad: "text-rose-700 dark:text-rose-400",
  muted: "text-muted",
};

const cardClasses =
  "rounded-2xl border border-border bg-surface p-5 shadow-sm shadow-black/[0.02] sm:p-7";

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
  { id: "hr", label: "HR" },
  { id: "resume", label: "Resume" },
  { id: "recording", label: "Recording" },
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

export function InterviewDetailView({
  roomId,
  initialDetail,
}: {
  roomId: string;
  /** Sample data for the local design preview; skips loading from the API. */
  initialDetail?: InterviewDetailResponse;
}) {
  const [detail, setDetail] = useState<InterviewDetailResponse | null>(initialDetail ?? null);
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
    if (initialDetail) return;
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
  }, [roomId, router, initialDetail]);

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
          ? `Resume depth updated: ${body.score}/100`
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
    >
      {scorecard?.video && (
        <VideoSection
          scorecard={scorecard}
          turns={turns}
          hasRecording={hasRecording}
          onPlay={playFrom}
          onAnalyseVideo={handleAnalyseVideo}
          isAnalysing={isVideoRequesting}
        />
      )}
    </RecordingPanel>
  );

  return (
    <div className="mx-auto flex max-w-[1500px] gap-6 xl:items-start">
      <div className="mx-auto grid w-full min-w-0 max-w-6xl flex-1 grid-cols-[minmax(0,1fr)] gap-6">
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
                    ...(detail.hrSpeech.length > 0 ? ["hr"] : []),
                    ...(scorecard.resumeMatch ? ["resume"] : []),
                    "recording",
                    "comments",
                  ]
                : ["overview", "recording", "comments"],
            )
          }
        />

        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
          {scorecard ? (
            <>
              <OverallAssessment scorecard={scorecard} insights={insights} peers={peers} roomId={roomId} />
              <SummarySection scorecard={scorecard} />
              <AnswerQualityTable
                scorecard={scorecard}
                competencies={competencies}
                coverage={session.outcome?.coverage ?? []}
                turns={turns}
                offsetFor={recordingOffset}
                onPlay={playFrom}
              />
              {detail.hrSpeech.length > 0 && (
                <HrConversationSection
                  hrSpeech={detail.hrSpeech}
                  turns={turns}
                  candidateName={session.candidateName || "Candidate"}
                />
              )}
              <CustomParametersSection scorecard={scorecard} />
              <ResumeTable
                scorecard={scorecard}
                turns={turns}
                competencies={competencies}
                onAnalyseResume={handleAnalyseResume}
                isAnalysing={isResumeRequesting}
              />
              {recordingSection}
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
  // Icons stay in the signature for callers, but headings are plain text:
  // tinted icon tiles on every card made the page look busy.
  void Icon;
  void iconColor;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 items-center gap-1.5">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-foreground">{title}</h2>
        {subtitle && <InfoTip text={subtitle} />}
      </div>
      {right}
    </div>
  );
}

/** Section score at the right of a heading: the number, then one word on what it means. */
function HeadingScore({ score, tone, label }: { score: number | null; tone: Tone; label: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className={`whitespace-nowrap text-sm font-medium ${TONE_TEXT[tone]}`}>{label}</span>
      {score !== null && (
        <span className="text-lg font-semibold tabular-nums leading-none text-foreground">
          {score}
          <span className="text-xs font-normal text-muted">/100</span>
        </span>
      )}
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

        <div className="flex shrink-0 items-center gap-2">
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
          {(session.status === "expired" || session.status === "completed") && (
          <Menu
              label="More actions"
              align="end"
              trigger={
                <button type="button" aria-label="More actions" className={`${ghost} w-9 justify-center px-0`}>
                  <MoreHorizontal className="size-4" aria-hidden />
                </button>
              }
              items={[
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
          )}
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
        : insights?.hireBand.band === "borderline" || insights?.hireBand.band === "review"
          ? "warn"
          : insights
          ? "bad"
          : band.tone;

  const ranked = [...peers].sort((x, y) => (y.overall?.score ?? -1) - (x.overall?.score ?? -1));
  const rank = ranked.findIndex((peer) => peer.roomId === roomId) + 1;
  const coverage = insights?.coverage;
  const talk = insights?.talk.candidatePercent ?? null;
  const medianAnswer = insights?.speaking.medianAnswerSeconds ?? null;

  const outcomes: { label: string; value: string; note: string; tone: Tone; href?: string }[] = [
    {
      label: "topics covered",
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
      label: "rank for this role",
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
      label: "candidate talk time",
      value: talk !== null ? `${talk}%` : "—",
      note: medianAnswer !== null ? `About ${Math.round(medianAnswer)}s per answer` : "Not measured",
      tone: talk !== null && talk < 40 ? "warn" : "muted",
      href: "#recording",
    },
  ];

  return (
    <section id="overview" className={`${cardClasses} scroll-mt-32`}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
        {/* verdict: the ring and one word, no tinted tile */}
        <div className="flex items-center gap-5 lg:border-r lg:border-border lg:pr-8">
          <ScoreRing score={score} size={88} stroke={7} toneClass={TONE_STROKE[band.tone]} label="of 100" />
          <div className="min-w-0">
            <p className="text-sm text-muted">Recommendation</p>
            <motion.p
              className={`mt-0.5 text-[28px] font-semibold leading-tight tracking-[-0.03em] ${TONE_TEXT[verdictTone]}`}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.2, ease: EASE_OUT }}
            >
              {verdict}
            </motion.p>
          </div>
        </div>

        {/* what the score is made of, then the supporting numbers */}
        <div className="grid min-w-0 content-center gap-5 lg:pl-2">
          <div className="grid gap-x-8 gap-y-4 sm:grid-cols-3">
            {overall.factors.map((factor) => {
              const meta = FACTOR_META[factor.id];
              const chip = factorChip(factor.id, factor.score);
              return (
                <div
                  key={factor.id}
                  className="group relative -m-2 min-w-0 rounded-xl p-2 transition hover:bg-foreground/[0.03]"
                >
                  <a href={`#${factorLink(factor.id)}`} className="absolute inset-0 rounded-xl" aria-label={`Go to ${meta.name}`} />
                  <span className="flex items-center gap-1 text-sm text-muted">
                    {meta.name}
                    <span className="relative z-10 inline-flex">
                      <InfoTip text={`${meta.explains} Counts for ${factor.weight}% of the overall score.`} />
                    </span>
                  </span>
                  <span className="mt-1.5 flex items-baseline gap-2">
                    <span className="text-2xl font-semibold leading-none tabular-nums tracking-[-0.02em]">
                      {factor.score ?? "—"}
                    </span>
                    <span className={`text-sm font-medium ${TONE_TEXT[chip.tone]}`}>{chip.label}</span>
                  </span>
                  <span className="mt-2.5 block h-1 overflow-hidden rounded-full bg-foreground/[0.07]" aria-hidden>
                    <span
                      className={`block h-full rounded-full ${TONE_BAR[chip.tone]}`}
                      style={{ width: `${factor.score ?? 0}%` }}
                    />
                  </span>
                </div>
              );
            })}
            {scorecard.integrityCheck && <OnCameraTile check={scorecard.integrityCheck} />}
          </div>
          <dl className="flex flex-wrap gap-x-8 gap-y-2 border-t border-border pt-4 text-sm">
            {outcomes.filter((item) => item.value !== "—").map((item) => (
              <a
                key={item.label}
                href={item.href}
                title={item.note}
                className="flex items-baseline gap-1.5 text-muted transition hover:text-foreground"
              >
                <dt className="order-2">{item.label}</dt>
                <dd className={`order-1 font-semibold tabular-nums ${item.tone === "warn" ? TONE_TEXT.warn : "text-foreground"}`}>
                  {item.value}
                </dd>
              </a>
            ))}
          </dl>
        </div>
      </div>



      {scorecard.needsHumanReview && (
        <p className="mt-5 flex items-start gap-2 rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          The two graders disagreed on part of this report. Read the evidence before deciding.
        </p>
      )}
    </section>
  );
}

/**
 * The key phrase of a model-written point: the text up to its first clause
 * break (colon, semicolon, sentence end or comma), so a point reads in one
 * line and the full sentence opens on click.
 */
function keyPhrase(text: string, max = 64): string {
  const clean = plain(text);
  const breaks = [": ", "; ", ". ", ", "]
    .map((mark) => clean.indexOf(mark, 12))
    .filter((index) => index > 0);
  let head = breaks.length > 0 ? clean.slice(0, Math.min(...breaks)) : clean;
  head = head.replace(/[.!?]$/, "");
  if (head.length > max) {
    const cut = head.slice(0, max);
    head = `${cut.slice(0, cut.lastIndexOf(" "))}…`;
  }
  return head;
}

const TAKEAWAY_STYLE: Record<
  "strengths" | "concerns",
  { panel: string; badge: string; mark: string; icon: LucideIcon }
> = {
  strengths: {
    panel: "bg-emerald-500/[0.06] ring-emerald-500/15",
    badge: "bg-emerald-500 text-white",
    mark: "text-emerald-600 dark:text-emerald-400",
    icon: Check,
  },
  concerns: {
    panel: "bg-amber-500/[0.07] ring-amber-500/20",
    badge: "bg-amber-500 text-white",
    mark: "text-amber-600 dark:text-amber-400",
    icon: AlertCircle,
  },
};

/** One takeaway: its key phrase on a line, the full sentence on click. */
function TakeawayItem({ text, mark, icon: Icon }: { text: string; mark: string; icon: LucideIcon }) {
  const [open, setOpen] = useState(false);
  const full = plain(text);
  const head = keyPhrase(full);
  const more = head.replace(/…$/, "") !== full.replace(/[.!?]$/, "");
  const content = (
    <>
      <Icon className={`mt-[3px] size-4 shrink-0 ${mark}`} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-foreground">{head}</span>
        {open && <span className="mt-1 block font-normal leading-6 text-foreground/70">{full}</span>}
      </span>
      {more && (
        <ChevronDown className={`mt-[3px] size-4 shrink-0 text-muted transition ${open ? "rotate-180" : ""}`} aria-hidden />
      )}
    </>
  );
  return (
    <li>
      {more ? (
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          className="-mx-2 flex w-[calc(100%+1rem)] items-start gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm leading-6 transition hover:bg-foreground/[0.04]"
        >
          {content}
        </button>
      ) : (
        <div className="flex items-start gap-2.5 py-1.5 text-sm leading-6">{content}</div>
      )}
    </li>
  );
}

function SummarySection({ scorecard }: { scorecard: Scorecard }) {
  const [showSummary, setShowSummary] = useState(false);
  const summary = plain(scorecard.summary);
  const lead = summary ? keyPhrase(firstSentence(summary), 160) : "";
  const groups = (
    [
      { id: "strengths", label: "Strengths", items: scorecard.strengths },
      { id: "concerns", label: "Concerns", items: scorecard.concerns },
    ] as const
  ).filter((group) => group.items.length > 0);

  return (
    <section id="summary" className={`${cardClasses} scroll-mt-32`}>
      <CardHeading
        title="Takeaways"
        right={
          summary ? (
            <button
              type="button"
              onClick={() => setShowSummary((current) => !current)}
              aria-expanded={showSummary}
              className="inline-flex items-center gap-1 text-sm font-medium text-muted transition hover:text-foreground"
            >
              {showSummary ? "Hide full summary" : "Full summary"}
              <ChevronDown className={`size-4 transition ${showSummary ? "rotate-180" : ""}`} aria-hidden />
            </button>
          ) : undefined
        }
      />

      {lead && <p className="mt-3 text-base font-medium leading-7 text-foreground/90">{lead}.</p>}
      {showSummary && (
        <p className="mt-3 rounded-xl bg-foreground/[0.035] px-5 py-4 text-[15px] leading-7 text-foreground/85">
          {summary}
        </p>
      )}

      {groups.length > 0 && (
        <div className={`mt-5 grid gap-4 ${groups.length === 2 ? "md:grid-cols-2" : ""}`}>
          {groups.map((group) => {
            const style = TAKEAWAY_STYLE[group.id];
            return (
              <div key={group.id} className={`min-w-0 rounded-2xl px-5 py-4 ring-1 ring-inset ${style.panel}`}>
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <span className={`grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-xs font-semibold tabular-nums ${style.badge}`}>
                    {group.items.length}
                  </span>
                  {group.label}
                </h3>
                <ul className="mt-2 grid">
                  {group.items.map((item, index) => (
                    <TakeawayItem key={index} text={item} mark={style.mark} icon={style.icon} />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

    </section>
  );
}

/** 3. Answer Quality Section: Structured Table with Scores, Feedback, and Jump-to Recording Pill Buttons */
function AnswerQualityTable({
  scorecard,
  competencies,
  coverage,
  turns,
  offsetFor,
  onPlay,
}: {
  scorecard: Scorecard;
  competencies: PlanCompetency[];
  coverage: { competencyId: string; startedAtSeconds: number | null; endedAtSeconds: number | null }[];
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
        subtitle="Each planned topic is one question plus the follow-ups on it, graded together. Answers that sounded read out count for less."
        right={
          <div className="flex items-center gap-3">
            <span className="hidden text-sm tabular-nums text-muted sm:inline">
              {scorecard.competencies.length} topics · {turns.filter((turn) => turn.speaker === "candidate").length} answers
            </span>
            <HeadingScore score={score} tone={chip.tone} label={chip.label} />
          </div>
        }
      />

      {scorecard.partScores && (
        <div className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {(
            [
              { id: "projects", label: "Their own projects", hint: "Could they explain their own work in depth?" },
              { id: "requirements", label: "What this job needs", hint: "How they handled our scenarios." },
            ] as const
          ).map((part) => {
            const value = scorecard.partScores?.[part.id] ?? null;
            const tone: Tone = value === null ? "muted" : value >= 65 ? "good" : value >= 50 ? "warn" : "bad";
            return (
              <div key={part.id} className="min-w-0">
                <p className="flex items-center gap-1 text-sm text-muted">
                  {part.label}
                  <InfoTip text={part.hint} />
                </p>
                <p className={`mt-1 text-2xl font-semibold leading-none tabular-nums ${value === null ? "text-muted" : "text-foreground"}`}>
                  {value ?? "—"}
                </p>
                <span className="mt-2.5 block h-1 overflow-hidden rounded-full bg-foreground/[0.07]" aria-hidden>
                  <span className={`block h-full rounded-full ${TONE_BAR[tone]}`} style={{ width: `${value ?? 0}%` }} />
                </span>
              </div>
            );
          })}
        </div>
      )}

      {scorecard.competencies.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No competency questions were scored for this interview.</p>
      ) : (
        <ol className="mt-5 divide-y divide-border border-t border-border">
          {scorecard.competencies.map((item, index) => {
            const plan = competencies.find((c) => c.id === item.competencyId);
            const covered = coverage.find((entry) => entry.competencyId === item.competencyId);
            const actualMinutes =
              covered && covered.startedAtSeconds !== null && covered.endedAtSeconds !== null
                ? Math.round(((covered.endedAtSeconds - covered.startedAtSeconds) / 60) * 10) / 10
                : null;
            const window = evidenceWindow(item.evidence, bySeq, offsetFor);
            const verdict = ANSWER_VERDICT[item.score ?? 0] ?? ANSWER_VERDICT[0];
            const answerCount = turns.filter(
              (turn) => turn.speaker === "candidate" && turn.competencyId === item.competencyId,
            ).length;
            return (
              <li
                key={item.competencyId}
                className="grid gap-x-8 gap-y-2 py-5 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)_auto]"
              >
                <div className="min-w-0">
                  <p className="flex items-baseline gap-x-2.5">
                    <span className="w-6 shrink-0 text-xs font-medium tabular-nums text-muted">Q{index + 1}</span>
                    <span className="min-w-0">
                      <span className="text-[15px] font-semibold text-foreground">{item.name}</span>
                      {plan?.part && (
                        <span className="ml-2 text-xs text-muted">
                          {plan.part === "projects" ? `Own project${plan.project ? `: ${plan.project.name}` : ""}` : "This job's needs"}
                        </span>
                      )}
                    </span>
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2.5 pl-[34px]">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TONE_TILE[verdict.tone]}`}>{verdict.label}</span>
                    <span className="flex gap-0.5" aria-hidden>
                      {[1, 2, 3, 4, 5].map((step) => (
                        <span
                          key={step}
                          className={`h-1.5 w-4 rounded-full ${
                            item.score !== null && step <= item.score ? TONE_BAR[verdict.tone] : "bg-foreground/10"
                          }`}
                        />
                      ))}
                    </span>
                    {answerCount > 0 && (
                      <span className="text-xs tabular-nums text-muted">
                        {answerCount} answer{answerCount === 1 ? "" : "s"}
                      </span>
                    )}
                    {item.originality && item.originality !== "natural" && (
                      <span className="rounded-full bg-amber-500/[0.12] px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">
                        {item.originality === "likely_read" ? "Sounds read out" : "More polished than usual"}
                      </span>
                    )}
                  </div>
                </div>
                <div className="min-w-0 pl-[34px] lg:pl-0">
                  <p className="text-sm leading-6 text-foreground/85">{firstSentence(plain(item.rationale))}</p>
                  <details className="group mt-1.5">
                    <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-muted hover:text-foreground">
                      Details
                      <ChevronDown className="size-3.5 transition group-open:rotate-180" aria-hidden />
                    </summary>
                    <div className="mt-2.5 grid gap-2.5 text-sm">
                      {plan?.question && (
                        <p className="text-foreground/85">
                          <span className="text-muted">Asked: </span>
                          {plan.question}
                        </p>
                      )}
                      {item.dimensions && <DimensionChips dimensions={item.dimensions} definitionOnly={item.definitionOnly === true} />}
                      <p className="leading-6 text-foreground/80">{plain(item.rationale)}</p>
                      {(plan?.skill || plan?.minutes) && (
                        <p className="flex flex-wrap gap-x-3 text-xs text-muted">
                          {plan?.skill && <span>Skill: {plan.skill}</span>}
                          {plan?.minutes ? (
                            <span className="tabular-nums">
                              {plan.minutes} min planned{actualMinutes !== null ? ` · ${actualMinutes} min spent` : ""}
                            </span>
                          ) : null}
                        </p>
                      )}
                    </div>
                  </details>
                </div>
                <div className="flex items-start pl-[34px] lg:justify-end lg:pl-0">
                  {window ? (
                    <button
                      type="button"
                      onClick={() => onPlay(window.from)}
                      aria-label={`Play this answer from ${formatClock(window.from)}`}
                      className="inline-flex h-8 items-center gap-1.5 rounded-full bg-accent-soft px-3 text-xs font-semibold tabular-nums text-accent transition hover:bg-accent hover:text-white"
                    >
                      <Play className="size-3 fill-current" aria-hidden />
                      {formatClock(window.from)}
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
  const [open, setOpen] = useState<ResumeVerdict | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [tab, setTab] = useState<"fit" | "claims" | null>(null);
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
  const fit = resume.jobFit ?? [];
  const fitCovered = fit.filter((item) => item.level !== "none").length;
  const groups = (
    [
      { id: "confirmed", label: "Backed up", bar: "bg-emerald-500" },
      { id: "partly_supported", label: "Partly", bar: "bg-amber-500" },
      { id: "not_supported", label: "Not backed up", bar: "bg-rose-500" },
      { id: "not_discussed", label: "Not discussed", bar: "bg-foreground/20" },
    ] as const
  )
    .map((group) => ({ ...group, claims: resume.claims.filter((claim) => claim.verdict === group.id) }))
    .filter((group) => group.claims.length > 0);
  const total = resume.claims.length;
  const shown = groups.find((group) => group.id === open) ?? null;

  const backedUp = resume.claims.filter((claim) => claim.verdict === "confirmed").length;
  const activeTab = tab ?? (fit.length > 0 ? "fit" : "claims");

  return (
    <section id="resume" className={`${cardClasses} scroll-mt-32`}>
      <CardHeading
        title="Resume"
        subtitle="The resume at a glance, then how it fits this job and whether the candidate could back it up in the interview with real depth: how it works, their part, a problem they solved."
        right={<HeadingScore score={resume.score} tone={chip.tone} label={chip.label} />}
      />

      {resume.profile ? (
        <ResumeProfileView profile={resume.profile} />
      ) : (
        <p className="mt-4 rounded-xl bg-foreground/[0.035] px-4 py-3 text-sm text-muted">
          Re-check the resume to see experience, top skills and what stands out.
        </p>
      )}

      {(fit.length > 0 || total > 0) && (
        <div className="mt-5 rounded-2xl bg-foreground/[0.03]">
          <button
            type="button"
            onClick={() => setCompareOpen((current) => !current)}
            aria-expanded={compareOpen}
            className="flex w-full items-center gap-4 rounded-2xl px-5 py-4 text-left transition hover:bg-foreground/[0.02]"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">Compared with the job and the interview</span>
              <span className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
                {fit.length > 0 && (
                  <span>
                    <b className="font-semibold tabular-nums text-foreground">
                      {fitCovered} of {fit.length}
                    </b>{" "}
                    job needs on the resume
                  </span>
                )}
                {total > 0 && (
                  <span>
                    <b className="font-semibold tabular-nums text-foreground">
                      {backedUp} of {total}
                    </b>{" "}
                    claims backed up in the interview
                  </span>
                )}
              </span>
            </span>
            <ChevronDown className={`size-5 shrink-0 text-muted transition ${compareOpen ? "rotate-180" : ""}`} aria-hidden />
          </button>

          {compareOpen && (
            <div className="border-t border-border px-5 pb-5 pt-4">
              {fit.length > 0 && total > 0 && (
                <div className="mb-4 inline-flex rounded-xl bg-foreground/[0.05] p-1" role="tablist" aria-label="Resume comparison">
                  {(
                    [
                      { id: "fit", label: "Fit with this job" },
                      { id: "claims", label: "Backed up in the interview" },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={activeTab === item.id}
                      onClick={() => setTab(item.id)}
                      className={`h-8 rounded-lg px-3 text-sm font-medium transition ${
                        activeTab === item.id ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
              {activeTab === "fit" && fit.length > 0 ? (
                <>
          <ul className="grid gap-x-8 sm:grid-cols-2">
            {fit.map((item) => (
              <li
                key={item.requirement}
                title={item.evidence ? plain(item.evidence) : "Nothing on the resume for this"}
                className="flex items-center gap-3 border-b border-border py-2.5 text-sm"
              >
                <span
                  className={`grid size-5 shrink-0 place-items-center rounded-full ${
                    item.level === "strong"
                      ? "bg-emerald-500 text-white"
                      : item.level === "some"
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                        : "bg-foreground/[0.06] text-muted"
                  }`}
                  aria-hidden
                >
                  {item.level === "none" ? <Minus className="size-3" /> : <Check className="size-3 stroke-[3]" />}
                </span>
                <span className={`min-w-0 flex-1 ${item.level === "none" ? "text-muted" : "text-foreground"}`}>
                  {item.requirement}
                </span>
                <span className="shrink-0 text-xs text-muted">
                  {item.level === "strong" ? "Clear" : item.level === "some" ? "Some" : "Not on resume"}
                </span>
              </li>
            ))}
          </ul>
                </>
              ) : (
                <>
      {total === 0 ? (
        <p className="text-sm text-muted">{resume.reason ?? "No resume claims were checked for this interview."}</p>
      ) : (
        <div>
          <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden>
            {groups.map((group) => (
              <span key={group.id} className={group.bar} style={{ width: `${(group.claims.length / total) * 100}%` }} />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2" role="tablist" aria-label="Resume claims">
            {groups.map((group) => {
              const active = open === group.id;
              return (
                <button
                  key={group.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setOpen(active ? null : group.id)}
                  className={`inline-flex h-8 items-center gap-2 rounded-full border px-3 text-sm transition ${
                    active ? "border-foreground bg-foreground text-background" : "border-border hover:border-foreground/25"
                  }`}
                >
                  <span className={`size-2 rounded-full ${group.bar}`} aria-hidden />
                  {group.label}
                  <span className={`tabular-nums ${active ? "opacity-70" : "text-muted"}`}>{group.claims.length}</span>
                </button>
              );
            })}
          </div>
          {shown && (
            <ul role="tabpanel" className="mt-3 grid border-t border-border pt-2">
              {shown.claims.map((claim) => {
                const questions = [
                  ...new Set(
                    claim.turnSeqs
                      .map((seq) => turnToQuestion.get(seq))
                      .filter((value): value is number => typeof value === "number"),
                  ),
                ];
                return (
                  <ClaimItem
                    key={claim.claim}
                    claim={claim.claim}
                    note={claim.note}
                    questions={questions}
                    dot={shown.bar}
                  />
                );
              })}
            </ul>
          )}
        </div>
      )}

                </>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mt-5 flex items-center gap-1.5">
        <button
          type="button"
          onClick={onAnalyseResume}
          disabled={isAnalysing}
          className="inline-flex h-8 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-medium transition hover:border-foreground/20 hover:bg-foreground/[0.03] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RotateCcw className={`size-3.5 ${isAnalysing ? "animate-spin" : ""}`} />
          {isAnalysing ? "Checking resume" : resume.score === null ? "Check resume" : "Re-check resume"}
        </button>
        <InfoTip text="Checks the resume against the job description and against what the candidate actually said. Takes a few seconds." />
      </div>
    </section>
  );
}

/** The resume at a glance: experience, current role, education, top skills and what stands out. */
function ResumeProfileView({ profile }: { profile: ResumeProfile }) {
  const years =
    profile.experienceYears !== null
      ? `${Number.isInteger(profile.experienceYears) ? profile.experienceYears : profile.experienceYears.toFixed(1)}`
      : null;
  const facts = [
    profile.currentRole ? { label: "Current role", value: plain(profile.currentRole) } : null,
    profile.education ? { label: "Education", value: plain(profile.education) } : null,
  ].filter((fact): fact is { label: string; value: string } => fact !== null);

  return (
    <div className="mt-5 grid gap-6">
      <div className="grid gap-5 sm:grid-cols-[minmax(0,9rem)_repeat(2,minmax(0,1fr))] sm:gap-8">
        <div>
          <p className="text-3xl font-semibold leading-none tracking-[-0.02em] tabular-nums">
            {years ?? (profile.experienceNote ? plain(profile.experienceNote) : "—")}
            {years !== null && (
              <span className="ml-1 text-base font-medium tracking-normal text-muted">
                {profile.experienceYears === 1 ? "year" : "years"}
              </span>
            )}
          </p>
          <p className="mt-2 text-xs text-muted">Experience</p>
        </div>
        {facts.map((fact) => (
          <div key={fact.label} className="min-w-0 sm:border-l sm:border-border sm:pl-8">
            <p className="text-[15px] font-semibold leading-6">{fact.value}</p>
            <p className="mt-1 text-xs text-muted">{fact.label}</p>
          </div>
        ))}
      </div>

      {(profile.topSkills.length > 0 || profile.standouts.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
          {profile.topSkills.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted">Top skills</p>
              <ul className="mt-2.5 flex flex-wrap gap-2">
                {profile.topSkills.map((skill, index) => (
                  <li
                    key={skill}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                      index < 2 ? "bg-accent text-white" : "bg-accent/[0.08] text-accent"
                    }`}
                  >
                    {plain(skill)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {profile.standouts.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted">Stands out</p>
              <ul className="mt-2.5 grid gap-2.5">
                {profile.standouts.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm leading-6">
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-gold/15 text-gold" aria-hidden>
                      <Sparkles className="size-3" />
                    </span>
                    <span className="font-medium text-foreground/90">{plain(item)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** One resume claim: a short line with the questions it came up in; the full claim and the evidence on click. */
function ClaimItem({
  claim,
  note,
  questions,
  dot,
}: {
  claim: string;
  note: string;
  questions: number[];
  dot: string;
}) {
  const [open, setOpen] = useState(false);
  const full = plain(claim);
  const head = keyPhrase(full, 80);
  const detail = note ? plain(note) : "";
  const more = Boolean(detail) || head.replace(/…$/, "") !== full.replace(/[.!?]$/, "");
  return (
    <li>
      <button
        type="button"
        onClick={() => more && setOpen((current) => !current)}
        aria-expanded={more ? open : undefined}
        className={`-mx-2 flex w-[calc(100%+1rem)] items-start gap-3 rounded-lg px-2 py-2 text-left text-sm leading-6 transition ${
          more ? "hover:bg-foreground/[0.04]" : "cursor-default"
        }`}
      >
        <span className={`mt-[9px] size-2 shrink-0 rounded-full ${dot}`} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-foreground">{open ? full : head}</span>
          {open && detail && <span className="mt-1 block leading-6 text-foreground/70">{detail}</span>}
        </span>
        {questions.length > 0 && (
          <span className="mt-0.5 flex shrink-0 gap-1">
            {questions.map((q) => (
              <span key={q} className="rounded-md bg-foreground/[0.06] px-1.5 text-xs font-medium tabular-nums leading-5 text-muted">
                Q{q}
              </span>
            ))}
          </span>
        )}
        {more && (
          <ChevronDown className={`mt-[3px] size-4 shrink-0 text-muted transition ${open ? "rotate-180" : ""}`} aria-hidden />
        )}
      </button>
    </li>
  );
}

const DIMENSION_LABELS: { id: "relevance" | "ownership" | "correctness" | "depth"; label: string }[] = [
  { id: "relevance", label: "On the question" },
  { id: "ownership", label: "Own detail" },
  { id: "correctness", label: "Correct" },
  { id: "depth", label: "Depth" },
];

/** The four things an answer is judged on, as small labelled marks. */
function DimensionChips({
  dimensions,
  definitionOnly,
}: {
  dimensions: NonNullable<Scorecard["competencies"][number]["dimensions"]>;
  definitionOnly: boolean;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {DIMENSION_LABELS.map((item) => {
        const value = dimensions[item.id];
        if (value === null || value === undefined) return null;
        const tone: Tone = value >= 4 ? "good" : value >= 3 ? "muted" : value >= 2 ? "warn" : "bad";
        return (
          <span key={item.id} className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${TONE_TILE[tone]}`}>
            {item.label} {value}/5
          </span>
        );
      })}
      {definitionOnly && (
        <span className="rounded-md bg-amber-500/[0.1] px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-300">
          Definitions only
        </span>
      )}
    </div>
  );
}

const LEVEL_META: Record<IntegrityLevel, { label: string; tone: Tone; icon: LucideIcon }> = {
  clear: { label: "Nothing stood out", tone: "good", icon: ShieldCheck },
  review: { label: "Worth a look", tone: "warn", icon: ShieldAlert },
  high_risk: { label: "High risk", tone: "bad", icon: ShieldAlert },
  pending: { label: "Processing video", tone: "muted", icon: ShieldQuestion },
  not_checked: { label: "Not checked", tone: "muted", icon: ShieldQuestion },
};

/** The On camera tile in the overview, beside the scored factors. */
function OnCameraTile({ check }: { check: IntegrityCheck }) {
  const meta = LEVEL_META[check.level];
  const Icon = meta.icon;
  return (
    <div className="group relative -m-2 min-w-0 rounded-xl p-2 transition hover:bg-foreground/[0.03]">
      <a href="#recording" className="absolute inset-0 rounded-xl" aria-label="Go to the recording analysis" />
      <span className="flex items-center gap-1 text-sm text-muted">
        On camera
        <span className="relative z-10 inline-flex">
          <InfoTip text="What the recording shows: where the eyes go, lips against the voice, the voice itself, and who is in the picture. Not part of the score yet." />
        </span>
      </span>
      <span className={`mt-1.5 flex items-center gap-2 ${TONE_TEXT[meta.tone]}`}>
        <Icon className={`size-5 shrink-0 ${check.level === "pending" ? "animate-pulse" : ""}`} aria-hidden />
        <span className="text-lg font-semibold leading-6">{meta.label}</span>
      </span>
    </div>
  );
}

type AspectId = "reading" | "lips" | "voice" | "alone" | "tab";

interface Aspect {
  id: AspectId;
  state: "ok" | "bad" | "na";
  /** Chip text. */
  chip: string;
  /** Panel heading. */
  title: string;
  /** One plain sentence on what it means. */
  detail: string;
  /** Short phrase for the summary line when flagged. */
  phrase: string;
  icon: LucideIcon;
  /** Answers it applies to; null when it is not about answers (the browser tab). */
  seqs: Set<number> | null;
  /** Weight per answer, for picking the clearest moments. */
  weight: Map<number, number>;
}

/**
 * 6. Recording check, in the style of review highlights: one plain sentence,
 * then a chip per check (green passed, amber worth a look). Picking a chip
 * opens what it means, one square per answer grouped by question, and the
 * clearest moments to watch. Measurements stay under "More detail".
 */
function VideoSection({
  scorecard,
  turns,
  hasRecording,
  onPlay,
  onAnalyseVideo,
  isAnalysing,
}: {
  scorecard: Scorecard;
  turns: InterviewTurn[];
  hasRecording: boolean;
  onPlay: (seconds: number) => void;
  onAnalyseVideo: () => void;
  isAnalysing: boolean;
}) {
  const [picked, setPicked] = useState<AspectId | null>(null);
  const video = scorecard.video;
  if (!video) return null;
  const check = scorecard.integrityCheck ?? null;
  const measures = video.version === 2 ? (video.measures ?? null) : null;
  const running = isAnalysing || video.status === "queued";
  const meta = check ? LEVEL_META[check.level] : null;
  const badge: { label: string; tone: Tone } = running
    ? { label: "Processing video", tone: "muted" }
    : meta
      ? { label: meta.label, tone: meta.tone }
      : factorChip("video", video.score ?? null);

  // Recording findings only; transcript findings are part of the answers.
  const findings = (check?.findings ?? [])
    .filter((finding) => finding.source !== "text")
    .sort((a, b) => b.strength - a.strength);
  const turnsOf = (kinds: string[]) =>
    new Set(findings.filter((finding) => kinds.includes(finding.kind)).flatMap((finding) => finding.turnSeqs));
  const weightOf = (kinds: string[]) => {
    const weight = new Map<number, number>();
    for (const finding of findings.filter((item) => kinds.includes(item.kind))) {
      for (const seq of finding.turnSeqs) weight.set(seq, (weight.get(seq) ?? 0) + finding.strength);
    }
    return weight;
  };
  const READING = ["fixed_spot", "reading_eyes", "screen_reading", "stall_then_fluent"];
  const OTHERS = ["second_face", "phone", "left_frame"];
  const spotTurns = turnsOf(["fixed_spot"]);
  const readingTurns = turnsOf(["reading_eyes", "screen_reading"]);
  const lipTurns = turnsOf(["lip_sync"]);
  const voiceTurns = turnsOf(["voice_change"]);
  const otherTurns = turnsOf(OTHERS);
  const readingAll = turnsOf(READING);

  const answers = (measures?.answers ?? [])
    .filter((answer) => answer.end - answer.start >= 1)
    .sort((a, b) => a.start - b.start);
  const total = answers.length;
  const tabLeft = scorecard.integrity.tabHiddenCount;
  const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);

  const aspects: Aspect[] = measures
    ? [
        {
          id: "reading",
          state: readingAll.size > 0 ? "bad" : "ok",
          chip: readingAll.size > 0 ? "Possible reading" : "No sign of reading",
          title: readingAll.size > 0 ? "May have been reading answers" : "No sign of reading",
          detail:
            readingAll.size > 0
              ? `${[
                  spotTurns.size > 0 ? `The eyes kept going back to one spot off screen in ${spotTurns.size} of ${total} answers` : null,
                  readingTurns.size > 0 ? `${spotTurns.size > 0 ? "they" : "The eyes"} moved like reading in ${readingTurns.size}` : null,
                ]
                  .filter(Boolean)
                  .join(", and ") || `Reading-like behaviour in ${readingAll.size} answers`}. This can mean notes or a second screen.`
              : "The eyes moved naturally while answering.",
          phrase: `possible reading in ${readingAll.size} of ${total} answers`,
          icon: Eye,
          seqs: readingAll,
          weight: weightOf(READING),
        },
        {
          id: "lips",
          state: !measures.checks.audio ? "na" : lipTurns.size > 0 ? "bad" : "ok",
          chip: !measures.checks.audio ? "Lips not checked" : lipTurns.size > 0 ? "Lips off the voice" : "Lips match the voice",
          title: !measures.checks.audio ? "Lips not checked" : lipTurns.size > 0 ? "Lips did not match the voice" : "Lips match the voice",
          detail: !measures.checks.audio
            ? "There was no sound in the recording to compare with."
            : lipTurns.size > 0
              ? `In ${lipTurns.size} answers the lips did not move with the voice. Someone else may have been speaking.`
              : "The lips moved with the voice in every answer.",
          phrase: `lips off the voice in ${lipTurns.size} answers`,
          icon: ScanFace,
          seqs: lipTurns,
          weight: weightOf(["lip_sync"]),
        },
        {
          id: "voice",
          state: !measures.checks.voice ? "na" : voiceTurns.size > 0 ? "bad" : "ok",
          chip: !measures.checks.voice ? "Voice not checked" : voiceTurns.size > 0 ? "Voice changed" : "Same voice throughout",
          title: !measures.checks.voice ? "Voice not checked" : voiceTurns.size > 0 ? "A different voice answered" : "Same voice throughout",
          detail: !measures.checks.voice
            ? "The voice could not be compared across answers."
            : voiceTurns.size > 0
              ? `In ${voiceTurns.size} answers the voice sounded like a different person.`
              : "The same voice answered every question.",
          phrase: `a different voice in ${voiceTurns.size} answers`,
          icon: Mic,
          seqs: voiceTurns,
          weight: weightOf(["voice_change"]),
        },
        {
          id: "alone",
          state: otherTurns.size > 0 ? "bad" : "ok",
          chip: otherTurns.size > 0 ? "Someone else in view" : "Alone on camera",
          title: otherTurns.size > 0 ? "Someone else or a phone in view" : "Alone on camera",
          detail:
            otherTurns.size > 0
              ? `Another person, a phone, or an empty frame was seen in ${otherTurns.size} answers.`
              : "No other person or phone was seen, and the candidate stayed in the frame.",
          phrase: `someone else or a phone in view in ${otherTurns.size} answers`,
          icon: Users,
          seqs: otherTurns,
          weight: weightOf(OTHERS),
        },
        {
          id: "tab",
          state: tabLeft > 0 ? "bad" : "ok",
          chip: tabLeft > 0 ? `Left the tab ${times(tabLeft)}` : "Stayed in the tab",
          title: tabLeft > 0 ? "Left the interview tab" : "Stayed in the interview tab",
          detail:
            tabLeft > 0
              ? `The candidate switched away from the interview ${times(tabLeft)}${scorecard.integrity.tabHiddenSeconds > 0 ? `, for about ${Math.round(scorecard.integrity.tabHiddenSeconds)} seconds in all` : ""}.`
              : "The interview tab stayed open and in front the whole time.",
          phrase: `left the tab ${times(tabLeft)}`,
          icon: AppWindow,
          seqs: null,
          weight: new Map(),
        },
      ]
    : [];
  const order = { bad: 0, ok: 1, na: 2 } as const;
  aspects.sort((a, b) => order[a.state] - order[b.state]);
  const flagged = aspects.filter((aspect) => aspect.state === "bad");
  const selected = aspects.find((aspect) => aspect.id === (picked ?? flagged[0]?.id)) ?? null;

  const summary =
    flagged.length === 0
      ? "Nothing in the recording stood out. Everything below looked normal."
      : `${flagged
          .map((aspect, index) => (index === 0 ? aspect.phrase.charAt(0).toUpperCase() + aspect.phrase.slice(1) : aspect.phrase))
          .join(flagged.length > 2 ? ", " : " and ")}. ${
          aspects.some((aspect) => aspect.state === "ok") ? "Everything else looked normal." : ""
        }`;

  // Answers grouped by the question they belong to, for the squares.
  const questionIndex = new Map(scorecard.competencies.map((item, index) => [item.competencyId, index + 1]));
  const turnBySeq = new Map(turns.map((turn) => [turn.seq, turn]));
  const groups: { label: string; answers: typeof answers }[] = [];
  for (const answer of answers) {
    const q = questionIndex.get(turnBySeq.get(answer.turnSeq)?.competencyId ?? "");
    const label = q ? `Q${q}` : (groups.at(-1)?.label ?? "Intro");
    const last = groups.at(-1);
    if (last && last.label === label) last.answers.push(answer);
    else groups.push({ label, answers: [answer] });
  }

  const clips = selected?.state === "bad" && selected.seqs
    ? answers
        .filter((answer) => selected.seqs?.has(answer.turnSeq))
        .sort((a, b) => (selected.weight.get(b.turnSeq) ?? 0) - (selected.weight.get(a.turnSeq) ?? 0) || a.start - b.start)
        .slice(0, 3)
        .sort((a, b) => a.start - b.start)
    : [];

  return (
    <div id="video" className="mt-7 scroll-mt-32 border-t border-border pt-6" data-video-model={video.model ?? undefined}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <h3 className="text-[17px] font-semibold">Recording check</h3>
          <InfoTip text="Measured from the video and audio with our own tools: where the eyes go while answering, whether the lips match the voice, whether the voice stays the same, and who is in the picture. Not part of the score yet. Watch the moments before relying on it." />
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${TONE_TILE[badge.tone]}`}>{badge.label}</span>
      </div>

      {running ? (
        <div className="mt-4 rounded-xl bg-accent/[0.07] px-4 py-3.5 text-sm">
          <p className="flex items-center gap-2 font-medium text-accent">
            <span className="size-1.5 animate-pulse rounded-full bg-accent" />
            Processing the video and audio
          </p>
          <p className="mt-1.5 text-muted">
            A 30-minute interview takes about 10 to 15 minutes. You can read the rest of the report meanwhile; this part
            updates by itself.
          </p>
        </div>
      ) : video.status !== "analysed" ? (
        <p className="mt-4 rounded-xl bg-foreground/[0.035] px-4 py-3.5 text-sm text-muted">
          {video.reason ?? "The recording has not been analysed."}
        </p>
      ) : !measures ? (
        <div className="mt-4 grid gap-3 text-sm">
          <p className="text-muted">
            This recording was read with the earlier analysis. Re-check it for the full check of eyes, lips and voice.
          </p>
          {video.summary && <p className="leading-6 text-foreground/85">{plain(video.summary)}</p>}
        </div>
      ) : (
        <>
          <p className="mt-3 text-[15px] font-medium leading-7 text-foreground/90">{summary}</p>

          <div className="-mx-5 mt-4 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Recording checks">
            {aspects.map((aspect) => {
              const active = selected?.id === aspect.id;
              const count = aspect.state === "bad" && aspect.seqs ? aspect.seqs.size : null;
              return (
                <button
                  key={aspect.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setPicked(aspect.id)}
                  className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition ${
                    active
                      ? "border-foreground bg-foreground/[0.05] ring-1 ring-inset ring-foreground"
                      : "border-border bg-surface hover:border-foreground/30"
                  }`}
                >
                  {aspect.state === "ok" ? (
                    <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
                  ) : aspect.state === "bad" ? (
                    <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" aria-hidden />
                  ) : (
                    <Minus className="size-4 text-muted" aria-hidden />
                  )}
                  <span className={aspect.state === "na" ? "text-muted" : ""}>{aspect.chip}</span>
                  {count !== null && (
                    <span className="rounded-full bg-amber-500/15 px-1.5 text-xs font-semibold tabular-nums text-amber-800 dark:text-amber-300">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {selected && (
            <motion.div
              key={selected.id}
              role="tabpanel"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
              className={`mt-4 rounded-2xl p-5 ring-1 ring-inset ${
                selected.state === "bad"
                  ? "bg-amber-500/[0.07] ring-amber-500/20"
                  : selected.state === "ok"
                    ? "bg-emerald-500/[0.06] ring-emerald-500/15"
                    : "bg-foreground/[0.03] ring-border"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={`grid size-9 shrink-0 place-items-center rounded-full ${
                      selected.state === "bad"
                        ? "bg-amber-500 text-white"
                        : selected.state === "ok"
                          ? "bg-emerald-500 text-white"
                          : "bg-foreground/10 text-muted"
                    }`}
                  >
                    <selected.icon className="size-[18px]" aria-hidden />
                  </span>
                  <h4 className="text-base font-semibold">{selected.title}</h4>
                </div>
                {selected.state === "bad" && selected.seqs && total > 0 && (
                  <p className="shrink-0 text-right leading-none">
                    <span className="text-2xl font-semibold tabular-nums">{selected.seqs.size}</span>
                    <span className="text-sm text-muted"> / {total}</span>
                    <span className="mt-1 block text-xs text-muted">answers</span>
                  </p>
                )}
              </div>
              <p className="mt-2 text-sm leading-6 text-foreground/80 sm:pl-12">{selected.detail}</p>

              {selected.seqs && selected.state !== "na" && groups.length > 0 && (
                <div className="mt-4 sm:pl-12">
                  <div className="flex flex-wrap gap-x-5 gap-y-3">
                    {groups.map((group, groupIndex) => (
                      <div key={`${group.label}-${groupIndex}`}>
                        <p className="mb-1.5 text-[11px] font-medium text-muted">{group.label}</p>
                        <div className="flex flex-wrap gap-1">
                          {group.answers.map((answer) => {
                            const hit = selected.seqs?.has(answer.turnSeq) ?? false;
                            return (
                              <button
                                key={answer.turnSeq}
                                type="button"
                                onClick={() => onPlay(Math.max(0, answer.start - 2))}
                                title={`Answer at ${formatClock(answer.start)}${hit ? ", flagged" : ""}`}
                                aria-label={`Play the answer at ${formatClock(answer.start)}${hit ? ", flagged" : ""}`}
                                className={`size-4 rounded-[4px] transition hover:scale-125 focus-visible:scale-125 ${
                                  selected.state === "ok"
                                    ? "bg-emerald-500/55 hover:bg-emerald-500"
                                    : hit
                                      ? "bg-amber-500 hover:bg-amber-600"
                                      : "bg-foreground/[0.12] hover:bg-foreground/25"
                                }`}
                              />
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2.5 text-[11px] text-muted">One square per answer. Click any to play it.</p>
                </div>
              )}

              {clips.length > 0 && (
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-amber-500/20 pt-4 sm:ml-12">
                  <span className="mr-1 text-xs font-medium text-muted">Clearest moments</span>
                  {clips.map((clip) => (
                    <button
                      key={clip.turnSeq}
                      type="button"
                      onClick={() => onPlay(Math.max(0, clip.start - 2))}
                      className="inline-flex h-8 items-center gap-1.5 rounded-full bg-accent px-3 text-xs font-semibold tabular-nums text-white shadow-sm shadow-accent/20 transition hover:bg-accent/90"
                    >
                      <Play className="size-3 fill-current" aria-hidden />
                      {formatClock(clip.start)}
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </>
      )}

      <details className="group mt-5">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-muted transition hover:text-foreground">
          More detail
          <ChevronDown className="size-4 transition group-open:rotate-180" aria-hidden />
        </summary>
        <div className="mt-3 grid gap-5 text-sm">
          {check?.summary && (
            <div>
              <h5 className="font-medium">Reviewer&apos;s note</h5>
              <p className="mt-1 leading-6 text-foreground/80">{plain(check.summary)}</p>
              {check.limits.length > 0 && (
                <ul className="mt-2 grid gap-1 text-xs text-muted">
                  {check.limits.map((limit) => (
                    <li key={limit} className="flex items-start gap-1.5">
                      <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      {limit}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {answers.length > 0 && (
            <div>
              <h5 className="font-medium">Every answer</h5>
              <div className="mt-2 max-h-80 overflow-auto rounded-xl border border-border">
                <table className="w-full text-left text-[13px]">
                  <thead className="sticky top-0 bg-surface">
                    <tr className="border-b border-border text-xs font-medium text-muted">
                      <th className="px-4 py-2.5">Answer at</th>
                      <th className="px-3 py-2.5">What stood out</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {answers.map((answer) => {
                      const notes = [
                        spotTurns.has(answer.turnSeq) ? "Kept going to one spot" : null,
                        readingTurns.has(answer.turnSeq) ? "Reading-like eyes" : null,
                        lipTurns.has(answer.turnSeq) ? "Lips off the voice" : null,
                        voiceTurns.has(answer.turnSeq) ? "Different voice" : null,
                        otherTurns.has(answer.turnSeq) ? "Someone else or a phone" : null,
                      ].filter(Boolean);
                      return (
                        <tr key={answer.turnSeq} className={notes.length ? "bg-amber-500/[0.06]" : undefined}>
                          <td className="px-4 py-2">
                            <button
                              type="button"
                              onClick={() => onPlay(Math.max(0, answer.start - 2))}
                              className="font-semibold tabular-nums text-accent hover:underline"
                            >
                              {formatClock(answer.start)}
                            </button>
                            <span className="ml-1.5 text-[11px] text-muted">{Math.round(answer.end - answer.start)}s</span>
                          </td>
                          <td className="px-3 py-2 text-xs text-muted">{answer.reason ?? (notes.join(", ") || "Nothing")}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {hasRecording && (
            <div>
              <button
                type="button"
                onClick={onAnalyseVideo}
                disabled={running}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-medium transition hover:border-foreground/20 hover:bg-foreground/[0.03] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCcw className={`size-3.5 ${running ? "animate-spin" : ""}`} />
                {running ? "Analysing recording" : video.status === "analysed" ? "Re-check video" : video.status === "failed" ? "Try video analysis again" : "Analyse this video"}
              </button>
              <p className="mt-1.5 text-xs text-muted">Takes about 10 to 15 minutes for a 30-minute interview.</p>
            </div>
          )}
        </div>
      </details>
    </div>
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
  children,
}: {
  children?: ReactNode;
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
        icon={Play}
        iconColor="indigo"
        title="Recording"
        subtitle="Watch the interview with the transcript in step. Below it: what the recording shows about eyes, lips, voice and who is in the picture."
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
              <span className="text-sm font-semibold text-foreground">Transcript</span>
              {playing && active ? (
                <span className="inline-flex min-w-0 items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                  <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500" />
                  <span className="truncate">
                    Following · {formatClock(active.at)}
                  </span>
                </span>
              ) : active ? (
                <span className="text-[11px] font-medium tabular-nums text-muted">
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
                  className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold capitalize transition ${
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
                className="w-full rounded-lg border border-border bg-background/50 py-2 pl-8 pr-3 text-sm outline-none transition placeholder:text-muted focus:border-accent focus:bg-surface"
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
                              className={`grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold uppercase ${
                                candidate
                                  ? "bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300"
                                  : "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                              }`}
                            >
                              {candidate ? initials(candidateName) : "I"}
                            </span>
                            <span className="truncate text-xs font-semibold text-foreground">
                              {candidate ? candidateName : "Interviewer"}
                            </span>
                          </span>
                          <span
                            className={`shrink-0 text-[11px] tabular-nums ${
                              isActive
                                ? "font-semibold text-blue-600 dark:text-accent"
                                : "text-muted"
                            }`}
                          >
                            {at !== null ? formatClock(at) : `#${turn.seq}`}
                          </span>
                        </span>
                        <span
                          className={`mt-1 text-[13px] leading-relaxed ${
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

          <p className="border-t border-border px-3.5 py-2 text-[11px] text-muted dark:border-border">
            {!hasRecording
              ? "Transcript only. No recording is available for this interview."
              : videoFailed
                ? "Transcript only. The recording could not be loaded."
                : "Click any line to jump the recording to that moment."}
          </p>
        </div>
      </div>
      {children}
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
  onSaved: (decision: HumanDecision | null) => void;
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

  /** Removes the saved decision, so the interview shows as undecided again. */
  async function handleClear() {
    setIsSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/dashboard/interviews/${roomId}/decision`, { method: "DELETE" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "Could not clear the decision.");
      onSaved(null);
      setOutcome(null);
      setNote("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not clear the decision.");
    } finally {
      setIsSaving(false);
    }
  }

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
              onClick={() => setOutcome(selected ? null : option.value)}
              className={`flex h-11 items-center justify-center gap-2 rounded-xl border text-sm font-medium transition ${
                selected ? selectedClasses : "border-border text-foreground/80 hover:border-foreground/20 hover:bg-foreground/[0.03]"
              }`}
            >
              {selected && <Check className="size-4 stroke-[2.5]" aria-hidden />}
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

      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-xs text-muted">{note.length > 0 ? `${note.length} / 2000` : ""}</span>
        <div className="flex items-center gap-2">
        {decision && (
          <button
            type="button"
            onClick={handleClear}
            disabled={isSaving}
            className="h-9 rounded-lg px-3 text-sm font-medium text-muted transition hover:bg-foreground/[0.04] hover:text-foreground disabled:opacity-40"
          >
            Clear decision
          </button>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={!outcome || isSaving || unchanged}
          className="h-9 rounded-lg bg-accent px-4 text-sm font-medium text-white shadow-sm shadow-accent/20 transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
        >
          {isSaving ? "Saving…" : "Save decision"}
        </button>
        </div>
      </div>
    </section>
  );
}

/** Other candidates for the same role, ranked by score. */
function PeersSection({ peers, currentId }: { peers: PeerSummary[]; currentId: string }) {
  const ranked = [...peers].sort((a, b) => (b.overall?.score ?? -1) - (a.overall?.score ?? -1));
  return (
    <section id="peers" className={`${cardClasses} scroll-mt-32`}>
      <CardHeading icon={Trophy} iconColor="purple" title="Compared with this role" subtitle="Everyone interviewed for the same role, on the same plan and scale." />
      <ol className="mt-5 grid gap-1">
        {ranked.map((peer, index) => {
          const isCurrent = peer.roomId === currentId;
          const score = peer.overall?.score ?? null;
          const tone = scoreBand(score).tone;
          const row = (
            <div
              className={`grid grid-cols-[1.25rem_minmax(0,1fr)_2.5rem] items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors sm:grid-cols-[1.5rem_minmax(0,1fr)_minmax(0,12rem)_2.5rem_6rem] sm:gap-4 ${
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
              <span className="hidden h-1.5 overflow-hidden rounded-full bg-foreground/[0.07] sm:block">
                {score !== null && <span className={`block h-full rounded-full ${isCurrent ? "bg-accent" : "bg-foreground/60"}`} style={{ width: `${score}%` }} />}
              </span>
              <span className={`text-right font-semibold tabular-nums ${score !== null ? TONE_TEXT[tone] : ""}`}>{score ?? "—"}</span>
              <span className="hidden text-right text-xs text-muted sm:block">
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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const action =
    "inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-muted transition hover:bg-foreground/[0.05] hover:text-foreground";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3 backdrop-blur-xs sm:p-6"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Resume of ${candidateName}`}
        className="flex h-full max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3 sm:px-5">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-300">
            <FileText className="size-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{candidateName}&apos;s resume</p>
            <p className="truncate text-xs text-muted">{fileName}</p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {resume?.text && (
              <button type="button" onClick={copyText} className={action}>
                {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
                <span className="hidden sm:inline">{copied ? "Copied" : "Copy text"}</span>
              </button>
            )}
            {hasOriginal && (
              <>
                <a href={fileUrl} target="_blank" rel="noreferrer" className={action}>
                  <ExternalLink className="size-4" />
                  <span className="hidden sm:inline">Open</span>
                </a>
                <a href={fileUrl} download={fileName} className={action}>
                  <Download className="size-4" />
                  <span className="hidden sm:inline">Download</span>
                </a>
              </>
            )}
            <span className="mx-1.5 h-5 w-px bg-border" aria-hidden="true" />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close resume"
              className="grid size-9 place-items-center rounded-lg text-muted transition hover:bg-foreground/[0.05] hover:text-foreground"
            >
              <X className="size-4.5" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 bg-slate-100 dark:bg-background">
          {hasOriginal && isPdf ? (
            <iframe
              src={`${fileUrl}#toolbar=0&navpanes=0&view=FitH`}
              title={`Resume of ${candidateName}`}
              className="size-full border-0"
            />
          ) : (
            <div className="h-full overflow-y-auto p-4 sm:p-8">
              <div className="mx-auto max-w-2xl">
                {hasOriginal ? (
                  <p className="rounded-xl bg-surface px-4 py-3 text-sm text-muted">
                    This is a Word document. Use Download to open the original.
                  </p>
                ) : resume?.text ? (
                  <>
                    <p className="mb-3 flex items-start gap-2 rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
                      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                      The original file was not kept for this interview. This is the text read from it.
                    </p>
                    <ResumeText text={resume.text} />
                  </>
                ) : (
                  <p className="rounded-xl bg-surface px-4 py-3 text-sm text-muted">No resume is available for this candidate.</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Section headings commonly found in resumes, used to break flattened text back into sections. */
const RESUME_HEADINGS = [
  "PROFESSIONAL SUMMARY", "SUMMARY", "OBJECTIVE", "CAREER OBJECTIVE", "TECHNICAL SKILLS", "SKILLS",
  "PROFESSIONAL EXPERIENCE", "WORK EXPERIENCE", "EXPERIENCE", "INTERNSHIPS", "EDUCATION",
  "ACADEMIC PROJECTS", "PROJECTS", "CERTIFICATIONS", "ACHIEVEMENTS", "AWARDS",
  "POSITION OF RESPONSIBILITY", "POSITIONS OF RESPONSIBILITY", "EXTRACURRICULAR ACTIVITIES",
  "LANGUAGES", "INTERESTS", "PUBLICATIONS",
];

function splitResumeText(text: string): { title: string | null; body: string }[] {
  const pattern = new RegExp(`\\b(${RESUME_HEADINGS.join("|")})\\b`, "g");
  const sections: { title: string | null; body: string }[] = [];
  let last = 0;
  let title: string | null = null;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    sections.push({ title, body: text.slice(last, index).trim() });
    title = match[1];
    last = index + match[0].length;
  }
  sections.push({ title, body: text.slice(last).trim() });
  return sections.filter((section) => section.body.length > 0);
}

function sentenceCase(heading: string): string {
  return heading.charAt(0) + heading.slice(1).toLowerCase();
}

/** Extracted resume text, laid out as a page with its sections restored. */
function ResumeText({ text }: { text: string }) {
  const sections = splitResumeText(text);
  return (
    <article className="rounded-xl bg-white p-6 text-[13px] leading-6 text-slate-700 shadow-sm sm:p-9 dark:bg-surface dark:text-slate-300">
      {sections.map((section, index) =>
        section.title === null ? (
          <p key={index} className="whitespace-pre-line border-b border-border pb-4 text-sm font-medium text-foreground">
            {section.body}
          </p>
        ) : (
          <section key={index} className="mt-5">
            <h4 className="border-b border-accent/30 pb-1 text-sm font-semibold text-accent">{sentenceCase(section.title)}</h4>
            <p className="mt-2 whitespace-pre-line">{section.body}</p>
          </section>
        ),
      )}
    </article>
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
    // Model text should read as written by a person: no dash punctuation.
    .replace(/\s*[\u2014\u2013]\s*/g, ", ")
    .replace(/\s-{1,2}\s/g, ", ")
    .replace(/,\s*([.,;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function firstSentence(text: string): string {
  const clean = plain(text);
  const match = clean.match(/^(.{20,320}?[.!?])(?:\s|$)/);
  if (match) return match[1];
  if (clean.length <= 320) return clean;
  // No sentence end in reach: stop at a whole word, never mid-word.
  const cut = clean.slice(0, 260);
  return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:]$/, "")}…`;
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

/** One plain word per answer score (1-5), instead of a number on another scale. */
const ANSWER_VERDICT: Record<number, { label: string; tone: Tone }> = {
  0: { label: "Not scored", tone: "muted" },
  1: { label: "Missed", tone: "bad" },
  2: { label: "Thin", tone: "bad" },
  3: { label: "Fair", tone: "warn" },
  4: { label: "Good", tone: "good" },
  5: { label: "Strong", tone: "good" },
};

const TONE_BAR: Record<Tone, string> = {
  good: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-rose-500",
  muted: "bg-foreground/30",
};

function scoreBand(score: number | null): { label: string; tone: Tone } {
  if (score === null) return { label: "Not scored", tone: "muted" };
  if (score >= 70) return { label: "Good match", tone: "good" };
  if (score >= 55) return { label: "Needs improvement", tone: "warn" };
  return { label: "Needs attention", tone: "bad" };
}

function factorChip(id: FactorId, score: number | null): { label: string; tone: Tone } {
  if (score === null) return { label: "Not scored", tone: "muted" };
  const tone: Tone = score >= 65 ? "good" : score >= 50 ? "warn" : "bad";
  const labels: Record<FactorId, [string, string, string]> = {
    answers: ["Below expected", "Mixed evidence", "Good answers"],
    resume: ["Weak match", "Partly supported", "Good match"],
    authenticity: ["Little credit", "Partial credit", "Full credit"],
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

/**
 * What HR said to the candidate, with the candidate's replies. Text only: the
 * recording above already plays all three voices, so this section is the
 * conversation read-back rather than a second player.
 */
function HrConversationSection({
  hrSpeech,
  turns,
  candidateName,
}: {
  hrSpeech: HrSpeechEntry[];
  turns: InterviewTurn[];
  candidateName: string;
}) {
  const candidateTurns = turns.filter((turn) => turn.speaker === "candidate");
  const lines = hrSpeech.map((line, index) => {
    const start = line.at ? Date.parse(line.at) : Number.NaN;
    const nextAt = hrSpeech[index + 1]?.at;
    const end = nextAt ? Date.parse(nextAt) : Number.POSITIVE_INFINITY;
    const replies = Number.isNaN(start)
      ? []
      : candidateTurns.filter((turn) => {
          if (!turn.startedAt) return false;
          const at = Date.parse(turn.startedAt);
          return at >= start && at < end;
        });
    return { line, replies };
  });

  return (
    <section id="hr" className={`${cardClasses} scroll-mt-32`}>
      <CardHeading
        icon={MessageSquare}
        title="HR and candidate"
        subtitle="What HR said during the interview, with the candidate's replies. The agent stays silent while HR speaks."
        right={<span className="text-xs font-medium text-muted">{hrSpeech.length} lines</span>}
      />
      <ol className="mt-4 grid gap-4">
        {lines.map(({ line, replies }, index) => (
          <li key={`${line.at ?? "hr"}-${index}`} className="grid gap-2 border-l-2 border-amber-400/50 pl-4">
            <div>
              <span className="mb-0.5 block text-xs font-semibold text-amber-600 dark:text-amber-400">HR</span>
              <p className="text-sm leading-relaxed text-foreground">{line.text}</p>
            </div>
            {replies.map((reply) => (
              <div key={reply.seq} className="pl-3">
                <span className="mb-0.5 block text-xs font-semibold text-muted">{candidateName}</span>
                <p className="text-sm leading-relaxed text-muted">{reply.text}</p>
              </div>
            ))}
          </li>
        ))}
      </ol>
    </section>
  );
}
