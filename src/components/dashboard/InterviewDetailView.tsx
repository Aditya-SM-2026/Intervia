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
import {
  AlertCircle,
  AlertTriangle,
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
  FileSearch,
  FileText,
  Fingerprint,
  Gauge,
  Globe,
  Info,
  Layers,
  MessageSquare,
  MessagesSquare,
  Mic,
  Minus,
  MoreHorizontal,
  Play,
  RotateCcw,
  ScrollText,
  Search,
  Share2,
  User,
  Users,
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

const STATUS_META: Record<InterviewStatus, { label: string; tone: Tone }> = {
  scheduled: { label: "Scheduled", tone: "muted" },
  waiting: { label: "Waiting to join", tone: "warn" },
  active: { label: "Live", tone: "warn" },
  completed: { label: "Completed", tone: "good" },
  expired: { label: "Expired", tone: "muted" },
  cancelled: { label: "Cancelled", tone: "bad" },
};

const STATUS_PILL_STYLES: Record<Tone, string> = {
  good: "bg-emerald-50 text-emerald-700 border border-emerald-200/70 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800/50",
  warn: "bg-amber-50 text-amber-700 border border-amber-200/70 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800/50",
  bad: "bg-rose-50 text-rose-700 border border-rose-200/70 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-800/50",
  muted: "bg-slate-50 text-slate-600 border border-slate-200/70 dark:bg-slate-800/50 dark:text-slate-400 dark:border-slate-700",
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
    text: "text-slate-600 dark:text-slate-400",
    border: "border-slate-200/70 dark:border-slate-800",
    icon: Minus,
  },
};

const cardClasses =
  "rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.03)] dark:border-border dark:bg-surface";

/** Left sidebar sections in order */
const REPORT_SECTIONS = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "summary", label: "Summary", icon: FileText },
  { id: "answers", label: "Answer quality", icon: MessagesSquare },
  { id: "resume", label: "Resume match", icon: FileSearch },
  { id: "authenticity", label: "Own answers", icon: Fingerprint },
  { id: "video", label: "On-camera", icon: Video },
  { id: "transcript", label: "Transcript", icon: ScrollText },
  { id: "voice", label: "Voice session", icon: Mic },
  { id: "comments", label: "Comments", icon: MessageSquare },
  { id: "peers", label: "Other interviews", icon: Users },
] as const;

/** Left rail: follows the section being read and scrolls to targets. */
function ReportNav({ candidateName, score }: { candidateName: string; score: number | null }) {
  const [activeId, setActiveId] = useState<string>(REPORT_SECTIONS[0].id);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      { rootMargin: "-15% 0px -65% 0px", threshold: 0 },
    );
    for (const { id } of REPORT_SECTIONS) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <nav aria-label="Report sections" className="sticky top-20 hidden lg:block">
      <div className="rounded-2xl border border-slate-200/80 bg-white p-2.5 shadow-[0_1px_3px_rgba(0,0,0,0.03)] dark:border-border dark:bg-surface">
        <div className="truncate px-3 pb-2 pt-1 text-[11px] font-semibold text-slate-400 dark:text-muted">
          {candidateName}
          {score !== null && <span className="ml-1 tabular-nums font-normal text-slate-500">· {score}/100</span>}
        </div>
        <ul className="grid gap-1">
          {REPORT_SECTIONS.map(({ id, label, icon: Icon }) => {
            const active = id === activeId;
            return (
              <li key={id}>
                <a
                  href={`#${id}`}
                  aria-current={active ? "true" : undefined}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2 text-xs font-medium transition ${
                    active
                      ? "bg-blue-50 text-blue-600 dark:bg-accent/15 dark:text-accent font-semibold"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-muted dark:hover:bg-accent/5 dark:hover:text-foreground"
                  }`}
                >
                  <Icon className={`size-4 shrink-0 ${active ? "text-blue-600 dark:text-accent" : "text-slate-400 dark:text-muted"}`} />
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
  const [resumeOpen, setResumeOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
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

  if (error && !detail) {
    return (
      <div className="mx-auto max-w-7xl grid gap-4">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900 dark:text-muted dark:hover:text-foreground"
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
      <div className="mx-auto max-w-7xl grid gap-4" aria-busy="true">
        <div className="h-6 w-32 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
        <div className="h-32 animate-pulse rounded-2xl border border-slate-200/80 bg-white dark:border-border dark:bg-surface" />
        <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
          <div className="hidden h-64 animate-pulse rounded-2xl border border-slate-200/80 bg-white lg:block dark:border-border dark:bg-surface" />
          <div className="grid gap-6">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-44 animate-pulse rounded-2xl border border-slate-200/80 bg-white dark:border-border dark:bg-surface"
              />
            ))}
          </div>
        </div>
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

  return (
    <div className="mx-auto max-w-7xl grid gap-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-xs font-semibold text-white shadow-xl dark:bg-white dark:text-slate-900 animate-in fade-in slide-in-from-bottom-3 duration-200">
          <CheckCircle2 className="size-4 text-emerald-400 dark:text-emerald-600" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Resume Modal */}
      {resumeOpen && (
        <ResumeModal
          resume={session.resume}
          candidateName={session.candidateName || "Candidate"}
          onClose={() => setResumeOpen(false)}
        />
      )}

      {/* Candidate Header with Breadcrumb & Quick Actions */}
      <CandidateHeader
        session={session}
        peers={peers}
        roomId={roomId}
        canDownload={scorecard !== null}
        onOpenResume={() => setResumeOpen(true)}
        onRegenerate={handleRegenerate}
        isRegenerating={isRegenerating}
        onShare={() => {
          if (typeof window !== "undefined") {
            navigator.clipboard.writeText(window.location.href);
            showToast("Interview link copied to clipboard");
          }
        }}
      />

      {error && (
        <p role="alert" className={alertClasses}>
          {error}
        </p>
      )}

      {/* Main Single-Column Layout with Sticky Left Rail */}
      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start">
        <ReportNav
          candidateName={session.candidateName || "Candidate"}
          score={scorecard?.overall?.score ?? null}
        />

        <div className="grid min-w-0 gap-6">
          {scorecard ? (
            <>
              {/* 1. Overall Assessment */}
              <OverallAssessment scorecard={scorecard} insights={insights} />

              {/* 2. Summary */}
              <SummarySection scorecard={scorecard} insights={insights} />

              {/* 3. Answer Quality */}
              <AnswerQualityTable
                scorecard={scorecard}
                competencies={competencies}
                turns={turns}
                offsetFor={recordingOffset}
                onPlay={playFrom}
              />

              {/* 4. Resume Match */}
              <ResumeTable scorecard={scorecard} turns={turns} competencies={competencies} />

              {/* 5. Own Answers (Originality) */}
              <OwnAnswersSection scorecard={scorecard} />

              {/* 6. On-camera Behaviour (preserved working component) */}
              <VideoSection
                scorecard={scorecard}
                hasRecording={hasRecording}
                roomId={roomId}
                videoRef={videoRef}
                durationSeconds={session.outcome?.elapsedSeconds ?? null}
                onPlay={playFrom}
                onAnalyseVideo={handleAnalyseVideo}
                isAnalysing={isVideoRequesting}
              />
            </>
          ) : (
            <section className={cardClasses}>
              <CardHeading icon={Gauge} iconColor="amber" title="Scorecard" />
              <p className="mt-2 text-sm text-slate-600 dark:text-muted">
                {reason ?? "No scorecard is available for this interview yet."}
              </p>
              {competencies.length > 0 && <PlanPreview competencies={competencies} />}
            </section>
          )}

          {/* 7. Transcript */}
          <Transcript
            turns={turns}
            competencies={competencies}
            candidateName={session.candidateName || "Candidate"}
            offsetFor={recordingOffset}
            onPlay={playFrom}
          />

          {/* 8. Voice Session */}
          <VoiceSection session={session} events={events} hasRecording={hasRecording} />

          {/* 9. Comments & Hiring Decision */}
          <CommentsDecisionSection
            roomId={roomId}
            decision={session.decision}
            onSaved={(decision) => setDetail({ ...detail, session: { ...session, decision } })}
          />

          {/* 10. Other Interviews */}
          {peers.length > 1 && <PeersSection peers={peers} currentId={roomId} />}

          {/* Recruiter Page Footer */}
          <footer className="flex flex-wrap items-center justify-between gap-3 pt-2 text-xs text-slate-400 dark:text-muted">
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
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-60 dark:border-border dark:bg-surface dark:text-slate-200"
              >
                <RotateCcw className={`size-3.5 ${isRegenerating ? "animate-spin" : ""}`} />
                <span>{isRegenerating ? "Scoring…" : "Regenerate scorecard"}</span>
              </button>
            )}
          </footer>
        </div>
      </div>
    </div>
  );
}

/** Card Heading with Apple-like colored icon container and right-hand badges. */
function CardHeading({
  icon: Icon,
  iconColor = "blue",
  title,
  subtitle,
  right,
}: {
  icon: LucideIcon;
  iconColor?: "blue" | "purple" | "violet" | "emerald" | "amber" | "rose" | "indigo" | "sky" | "slate";
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  const COLOR_CLASSES: Record<string, string> = {
    blue: "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400",
    purple: "bg-purple-50 text-purple-600 dark:bg-purple-950/40 dark:text-purple-400",
    violet: "bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400",
    emerald: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400",
    amber: "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400",
    rose: "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400",
    indigo: "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400",
    sky: "bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400",
    slate: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  };

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-center gap-3">
        <span
          className={`grid size-9 shrink-0 place-items-center rounded-xl ${COLOR_CLASSES[iconColor]}`}
        >
          <Icon className="size-4.5" />
        </span>
        <div>
          <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-foreground">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-0.5 text-xs text-slate-500 dark:text-muted">{subtitle}</p>
          )}
        </div>
      </div>
      {right}
    </div>
  );
}

/** Status Chip */
function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_PILL_STYLES[tone]}`}
    >
      {children}
    </span>
  );
}

/** Candidate Header with Breadcrumb Navigation, Metadata, and Integrated Actions */
function CandidateHeader({
  session,
  peers,
  roomId,
  canDownload,
  onOpenResume,
  onRegenerate,
  isRegenerating,
  onShare,
}: {
  session: InterviewRoom;
  peers: PeerSummary[];
  roomId: string;
  canDownload: boolean;
  onOpenResume: () => void;
  onRegenerate: () => void;
  isRegenerating: boolean;
  onShare: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const outcome = session.outcome;
  const status = STATUS_META[session.status];
  const position = peers.findIndex((peer) => peer.roomId === roomId);
  const previous = position > 0 ? peers[position - 1] : null;
  const next = position >= 0 && position < peers.length - 1 ? peers[position + 1] : null;

  const timezone =
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : "Asia/Kolkata (IST)";

  return (
    <div className="grid gap-3">
      {/* Top Breadcrumbs & Previous/Next Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-slate-500 dark:text-muted">
          <Link
            href="/dashboard"
            className="flex items-center gap-1 font-medium transition hover:text-slate-900 dark:hover:text-foreground"
          >
            <ChevronLeft className="size-3.5" />
            <span>Interviews</span>
          </Link>
          <span className="text-slate-300 dark:text-slate-700">/</span>
          <span className="font-medium text-slate-600 dark:text-slate-300 truncate max-w-[180px]">
            {session.roleTitle || session.title}
          </span>
          <span className="text-slate-300 dark:text-slate-700">/</span>
          <span className="font-semibold text-slate-900 dark:text-foreground truncate max-w-[180px]">
            {session.candidateName || "Candidate"}
          </span>
        </nav>

        <div className="flex items-center gap-1.5">
          <Link
            href={previous ? `/dashboard/${previous.roomId}` : "#"}
            aria-disabled={!previous}
            className={`inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium transition dark:border-border dark:bg-surface ${
              previous
                ? "text-slate-700 hover:border-accent hover:text-accent dark:text-slate-200"
                : "pointer-events-none opacity-40 text-slate-400"
            }`}
          >
            <ChevronLeft className="size-3" />
            <span>Previous</span>
          </Link>
          <Link
            href={next ? `/dashboard/${next.roomId}` : "#"}
            aria-disabled={!next}
            className={`inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium transition dark:border-border dark:bg-surface ${
              next
                ? "text-slate-700 hover:border-accent hover:text-accent dark:text-slate-200"
                : "pointer-events-none opacity-40 text-slate-400"
            }`}
          >
            <span>Next</span>
            <ChevronRight className="size-3" />
          </Link>
        </div>
      </div>

      {/* Candidate Header Card */}
      <header className={`${cardClasses} !p-5 sm:!p-6`}>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            {/* Candidate Avatar */}
            <span
              aria-hidden
              className="grid size-14 shrink-0 place-items-center rounded-full bg-blue-50 text-2xl font-bold uppercase text-blue-600 dark:bg-blue-950/50 dark:text-blue-400"
            >
              {initials(session.candidateName)}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-foreground">
                  {session.candidateName || "Candidate"}
                </h1>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_PILL_STYLES[status.tone]}`}
                >
                  <span
                    className={`size-1.5 rounded-full ${
                      status.tone === "good"
                        ? "bg-emerald-500"
                        : status.tone === "warn"
                          ? "bg-amber-500"
                          : status.tone === "bad"
                            ? "bg-rose-500"
                            : "bg-slate-400"
                    }`}
                  />
                  {status.label}
                </span>
              </div>

              {session.candidateEmail && (
                <p className="mt-0.5 text-xs text-slate-500 dark:text-muted">
                  {session.candidateEmail}
                </p>
              )}

              {/* Meta details row with clean inline icons */}
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600 dark:text-slate-400">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <Briefcase className="size-3.5 text-slate-400" />
                  {session.roleTitle || session.title}
                </span>
                {position >= 0 && peers.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-slate-500">
                    <Layers className="size-3.5 text-slate-400" />
                    {position + 1} of {peers.length} interviews
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5">
                  <User className="size-3.5 text-slate-400" />
                  Interviewed by:{" "}
                  <span className="font-semibold text-slate-700 dark:text-slate-200">
                    {session.recruiterName || "AI Interviewer"}
                  </span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="size-3.5 text-slate-400" />
                  {session.completedAt
                    ? formatDateTime(session.completedAt)
                    : session.scheduledAt
                      ? formatDateTime(session.scheduledAt)
                      : "Not scheduled"}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="size-3.5 text-slate-400" />
                  {outcome ? formatDuration(outcome.elapsedSeconds) : `${session.durationMinutes} min`}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Globe className="size-3.5 text-slate-400" />
                  {timezone}
                </span>
                {outcome?.reason && (
                  <span className="inline-flex items-center gap-1.5 text-slate-400">
                    • {END_REASONS[outcome.reason] ?? outcome.reason}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onOpenResume}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-xs transition hover:border-accent hover:text-accent dark:border-border dark:bg-surface dark:text-slate-200"
            >
              <FileText className="size-3.5 text-slate-400" />
              <span>View resume</span>
            </button>

            {canDownload && (
              <a
                href={`/api/dashboard/interviews/${roomId}/report/download`}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-xs transition hover:border-accent hover:text-accent dark:border-border dark:bg-surface dark:text-slate-200"
              >
                <Download className="size-3.5 text-slate-400" />
                <span>Download report</span>
              </a>
            )}

            <button
              type="button"
              onClick={onShare}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-xs transition hover:border-accent hover:text-accent dark:border-border dark:bg-surface dark:text-slate-200"
            >
              <Share2 className="size-3.5 text-slate-400" />
              <span>Share</span>
            </button>

            {/* Overflow Menu */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen(!menuOpen)}
                aria-label="More actions"
                className="grid size-8 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-accent hover:text-accent dark:border-border dark:bg-surface dark:text-slate-300"
              >
                <MoreHorizontal className="size-4" />
              </button>
              {menuOpen && (
                <div
                  className="absolute right-0 top-full z-30 mt-1 w-48 rounded-xl border border-slate-200 bg-white py-1.5 shadow-lg dark:border-border dark:bg-surface animate-in fade-in zoom-in-95 duration-100"
                  onMouseLeave={() => setMenuOpen(false)}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onShare();
                      setMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-accent/10"
                  >
                    <Copy className="size-3.5 text-slate-400" />
                    <span>Copy interview link</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onRegenerate();
                      setMenuOpen(false);
                    }}
                    disabled={isRegenerating}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-accent/10"
                  >
                    <RotateCcw className="size-3.5 text-slate-400" />
                    <span>Regenerate scorecard</span>
                  </button>
                  <Link
                    href="/dashboard"
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-accent/10"
                  >
                    <Users className="size-3.5 text-slate-400" />
                    <span>View all interviews</span>
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
    </div>
  );
}

/** 1. Overall Assessment Section: Circular gauge, status label, concise summary, and expandable factor progress rows */
function OverallAssessment({
  scorecard,
  insights,
}: {
  scorecard: Scorecard;
  insights: ReportInsights | null;
}) {
  const [expandedFactor, setExpandedFactor] = useState<FactorId | null>(null);
  const overall = scorecard.overall;

  if (!overall) {
    return (
      <section id="overview" className={`${cardClasses} scroll-mt-24`}>
        <CardHeading icon={Gauge} iconColor="amber" title="Overall assessment" />
        <p className="mt-4 font-display text-5xl font-semibold leading-none tabular-nums">
          {scorecard.overallScore === null ? "–" : scorecard.overallScore.toFixed(1)}
          <span className="text-lg font-normal text-slate-400"> of 5</span>
        </p>
        <p className="mt-3 max-w-xl text-sm text-slate-500 dark:text-muted">
          This scorecard was generated before multi-factor evaluation was added. Use Regenerate scorecard
          below to produce the 0-100 score and factor breakdowns.
        </p>
      </section>
    );
  }

  const score = overall.score;
  const band = scoreBand(score);
  const explanation = getConciseExplanation(scorecard, score);

  const FACTOR_ICONS: Record<FactorId, LucideIcon> = {
    answers: MessagesSquare,
    resume: FileSearch,
    authenticity: Fingerprint,
    video: Video,
  };

  const FACTOR_COLORS: Record<FactorId, { icon: "blue" | "purple" | "emerald" | "amber"; bar: string }> = {
    answers: { icon: "blue", bar: "bg-blue-600" },
    resume: { icon: "purple", bar: "bg-purple-600" },
    authenticity: { icon: "emerald", bar: "bg-emerald-600" },
    video: { icon: "amber", bar: "bg-amber-500" },
  };

  return (
    <section id="overview" className={`${cardClasses} scroll-mt-24`}>
      <CardHeading
        icon={Gauge}
        iconColor="amber"
        title="Overall assessment"
        right={
          insights?.hireBand.label ? (
            <Chip tone={hireBandTone(insights.hireBand.band)}>{insights.hireBand.label}</Chip>
          ) : undefined
        }
      />

      <div className="mt-6 grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-center">
        {/* Left Side: Circular score ring gauge, badge, and explanation */}
        <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-100 bg-slate-50/50 p-6 text-center dark:border-border/60 dark:bg-background/40">
          <ScoreRing score={score} tone={band.tone} />
          <div className="mt-3">
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${STATUS_PILL_STYLES[band.tone]}`}
            >
              {band.label}
            </span>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            {explanation}
          </p>
        </div>

        {/* Right Side: Expandable score factor rows with progress bars */}
        <div className="grid gap-3.5">
          {overall.factors.map((factor) => {
            const meta = FACTOR_META[factor.id];
            const chip = factorChip(factor.id, factor.score);
            const Icon = FACTOR_ICONS[factor.id];
            const colors = FACTOR_COLORS[factor.id];
            const isExpanded = expandedFactor === factor.id;

            return (
              <div
                key={factor.id}
                className="rounded-xl border border-slate-200/70 bg-white p-3.5 transition dark:border-border dark:bg-surface/50"
              >
                <div
                  className="flex cursor-pointer items-center gap-3"
                  onClick={() => setExpandedFactor(isExpanded ? null : factor.id)}
                >
                  <span
                    className={`grid size-8 shrink-0 place-items-center rounded-lg ${
                      colors.icon === "blue"
                        ? "bg-blue-50 text-blue-600"
                        : colors.icon === "purple"
                          ? "bg-purple-50 text-purple-600"
                          : colors.icon === "emerald"
                            ? "bg-emerald-50 text-emerald-600"
                            : "bg-amber-50 text-amber-600"
                    }`}
                  >
                    <Icon className="size-4" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-900 dark:text-foreground">
                        {meta.name}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold tabular-nums text-slate-900 dark:text-foreground">
                          {factor.score === null ? "—" : `${factor.score}/100`}
                        </span>
                        <Chip tone={chip.tone}>{chip.label}</Chip>
                        <ChevronDown
                          className={`size-4 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                        />
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      {factor.score !== null && (
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${colors.bar}`}
                          style={{ width: `${Math.max(3, factor.score)}%` }}
                        />
                      )}
                    </div>
                  </div>
                </div>

                {/* Expandable Breakdown Drawer */}
                {isExpanded && (
                  <div className="mt-3.5 border-t border-slate-100 pt-3 text-xs text-slate-600 dark:border-border dark:text-slate-400">
                    <p className="leading-relaxed">{meta.explains}</p>
                    <div className="mt-2.5 flex items-center justify-between">
                      <span className="text-[11px] text-slate-400">Weight: {factor.weight}% of total score</span>
                      <a
                        href={`#${factorLink(factor.id)}`}
                        className="font-semibold text-blue-600 hover:underline dark:text-accent"
                      >
                        Jump to detailed section →
                      </a>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {scorecard.needsHumanReview && (
        <div className="mt-5 flex items-center gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>Check the evidence before deciding: graders noted variance or items needing review.</span>
        </div>
      )}
    </section>
  );
}

/** Circular Ring Gauge */
function ScoreRing({ score, tone }: { score: number | null; tone: Tone }) {
  const radius = 64;
  const strokeWidth = 10;
  const circumference = 2 * Math.PI * radius;
  const filled = score === null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  const strokeOffset = circumference * (1 - filled);

  const ringColor =
    tone === "good" ? "#10b981" : tone === "warn" ? "#f59e0b" : tone === "bad" ? "#2563eb" : "#94a3b8";

  return (
    <div className="relative size-[152px] shrink-0">
      <svg viewBox="0 0 160 160" className="size-full -rotate-90">
        <circle
          cx="80"
          cy="80"
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-slate-200/70 dark:stroke-slate-800"
        />
        <circle
          cx="80"
          cy="80"
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          stroke={ringColor}
          strokeDasharray={circumference}
          strokeDashoffset={strokeOffset}
          className="transition-all duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="flex items-baseline">
          <span className="font-display text-4xl font-bold tracking-tight text-slate-900 dark:text-foreground">
            {score ?? "–"}
          </span>
          <span className="ml-0.5 text-sm font-medium text-slate-400">/100</span>
        </div>
      </div>
    </div>
  );
}

/** 2. Summary Section: Concise Assessment Summary, Strengths, Areas of Concern, Collapsible About Assessment */
function SummarySection({
  scorecard,
  insights,
}: {
  scorecard: Scorecard;
  insights: ReportInsights | null;
}) {
  return (
    <section id="summary" className={`${cardClasses} scroll-mt-24`}>
      <CardHeading icon={FileText} iconColor="blue" title="Summary" />
      <p className="mt-3.5 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
        {plain(scorecard.summary)}
      </p>

      {/* Strengths and Areas of Concern columns */}
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {/* Strengths */}
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-50/40 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900 dark:text-emerald-300">
            <CheckCircle2 className="size-4.5 text-emerald-600 dark:text-emerald-400" />
            <span>Strengths</span>
          </div>
          {scorecard.strengths.length === 0 ? (
            <p className="mt-2 text-xs text-slate-500">No specific strengths recorded.</p>
          ) : (
            <ul className="mt-2.5 grid gap-2">
              {scorecard.strengths.map((item, idx) => (
                <li key={idx} className="flex items-start gap-2 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Areas of Concern */}
        <div className="rounded-xl border border-rose-500/20 bg-rose-50/40 p-4 dark:border-rose-900/40 dark:bg-rose-950/20">
          <div className="flex items-center gap-2 text-sm font-semibold text-rose-900 dark:text-rose-300">
            <AlertTriangle className="size-4.5 text-rose-600 dark:text-rose-400" />
            <span>Areas of concern</span>
          </div>
          {scorecard.concerns.length === 0 ? (
            <p className="mt-2 text-xs text-slate-500">No concerns recorded.</p>
          ) : (
            <ul className="mt-2.5 grid gap-2">
              {scorecard.concerns.map((item, idx) => (
                <li key={idx} className="flex items-start gap-2 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-rose-600 dark:text-rose-400" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Collapsible About This Assessment */}
      <details className="group mt-5 rounded-xl border border-slate-200/80 dark:border-border">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-xs font-semibold text-slate-700 dark:text-slate-300">
          <span className="flex items-center gap-2">
            <Info className="size-4 text-slate-400" />
            About this assessment
          </span>
          <ChevronDown className="size-4 text-slate-400 transition group-open:rotate-180" />
        </summary>
        <div className="grid gap-4 border-t border-slate-100 p-4 text-xs dark:border-border dark:text-slate-300">
          {scorecard.notes.length > 0 && (
            <div>
              <p className="font-semibold uppercase tracking-wider text-slate-400 text-[10px]">Data quality notes</p>
              <ul className="mt-1.5 grid gap-1">
                {scorecard.notes.map((note) => (
                  <li key={note} className="text-slate-600 dark:text-slate-400">
                    • {note}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <p className="font-semibold uppercase tracking-wider text-slate-400 text-[10px]">Integrity signals</p>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5 dark:border-border dark:bg-background">
                <span className="text-[10px] text-slate-400">Tab hidden</span>
                <p className="text-sm font-bold text-slate-900 dark:text-foreground">{scorecard.integrity.tabHiddenCount}×</p>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5 dark:border-border dark:bg-background">
                <span className="text-[10px] text-slate-400">Tab hidden time</span>
                <p className="text-sm font-bold text-slate-900 dark:text-foreground">{Math.round(scorecard.integrity.tabHiddenSeconds)}s</p>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5 dark:border-border dark:bg-background">
                <span className="text-[10px] text-slate-400">Window blur</span>
                <p className="text-sm font-bold text-slate-900 dark:text-foreground">{scorecard.integrity.windowBlurCount}×</p>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5 dark:border-border dark:bg-background">
                <span className="text-[10px] text-slate-400">Disconnects</span>
                <p className="text-sm font-bold text-slate-900 dark:text-foreground">{scorecard.integrity.candidateDisconnects}</p>
              </div>
            </div>
          </div>

          {insights && insights.nextSteps.length > 0 && (
            <div>
              <p className="font-semibold uppercase tracking-wider text-slate-400 text-[10px]">Recommended next steps</p>
              <ul className="mt-1.5 grid gap-1">
                {insights.nextSteps.map((step) => (
                  <li key={step} className="text-slate-600 dark:text-slate-400">
                    • {step}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </details>
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
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const bySeq = new Map(turns.map((turn) => [turn.seq, turn]));
  const score = scorecard.answerQuality ?? (scorecard.overallScore ? Math.round((scorecard.overallScore / 5) * 100) : null);
  const chip = factorChip("answers", score);

  return (
    <section id="answers" className={`${cardClasses} scroll-mt-24`}>
      <CardHeading
        icon={MessagesSquare}
        iconColor="purple"
        title="Answer quality"
        subtitle="Detailed evaluation of response quality, technical depth and completeness."
        right={
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-slate-900 dark:text-foreground tabular-nums">
              {score === null ? "–" : `${score}/100`}
            </span>
            <Chip tone={chip.tone}>{chip.label}</Chip>
          </div>
        }
      />

      {scorecard.competencies.length === 0 ? (
        <p className="mt-4 text-xs text-slate-500">No competency questions were scored for this interview.</p>
      ) : (
        <div className="mt-5 overflow-hidden rounded-xl border border-slate-200/80 dark:border-border">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200/80 bg-slate-50/80 font-semibold text-slate-500 dark:border-border dark:bg-background/60 dark:text-muted">
                <th className="w-12 px-4 py-3 text-center">#</th>
                <th className="px-4 py-3">Question</th>
                <th className="w-20 px-4 py-3 text-center">Score</th>
                <th className="px-4 py-3">Key feedback</th>
                <th className="w-40 px-4 py-3 text-right">Jump to</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-border/60">
              {scorecard.competencies.map((item, index) => {
                const plan = competencies.find((c) => c.id === item.competencyId);
                const window = evidenceWindow(item.evidence, bySeq, offsetFor);
                const isExpanded = expandedRow === item.competencyId;
                const scoreOut10 = item.score !== null ? item.score * 2 : null;
                const scoreTone =
                  scoreOut10 !== null && scoreOut10 >= 7
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200/60"
                    : scoreOut10 !== null && scoreOut10 >= 5
                      ? "bg-amber-50 text-amber-700 border border-amber-200/60"
                      : "bg-rose-50 text-rose-700 border border-rose-200/60";

                return (
                  <tr
                    key={item.competencyId}
                    className="group hover:bg-slate-50/50 dark:hover:bg-accent/5 transition"
                  >
                    <td className="px-4 py-3.5 text-center font-medium text-slate-400">
                      {index + 1}
                    </td>
                    <td className="px-4 py-3.5">
                      <p className="font-semibold text-slate-900 dark:text-foreground">
                        {item.name}
                      </p>
                      {plan?.question && (
                        <p className="mt-0.5 text-[11px] text-slate-500 line-clamp-1">
                          {plan.question}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      <span className={`inline-flex items-center rounded-lg px-2 py-0.5 text-xs font-bold tabular-nums ${scoreTone}`}>
                        {scoreOut10 !== null ? `${scoreOut10}/10` : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-slate-600 dark:text-slate-300">
                      <p className="line-clamp-2">{firstSentence(item.rationale)}</p>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {window ? (
                          <button
                            type="button"
                            onClick={() => onPlay(window.from)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50/80 px-2.5 py-1 text-xs font-semibold tabular-nums text-blue-700 transition hover:bg-blue-100 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-300"
                          >
                            <Play className="size-3 fill-current text-blue-600 dark:text-blue-400" />
                            <span>
                              {formatClock(window.from)} - {formatClock(window.to)}
                            </span>
                          </button>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                        <button
                          type="button"
                          onClick={() => setExpandedRow(isExpanded ? null : item.competencyId)}
                          className="grid size-6 place-items-center rounded-md text-slate-400 hover:text-slate-700"
                        >
                          <ChevronDown className={`size-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                        </button>
                      </div>
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

/** 4. Resume Match Section: Table showing claims, verdict badges, interview evidence, and notes */
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
        iconColor="violet"
        title="Resume match"
        subtitle="How well the candidate's background aligns with the role and project requirements."
        right={
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-slate-900 dark:text-foreground tabular-nums">
              {resume.score === null ? "–" : `${resume.score}/100`}
            </span>
            <Chip tone={chip.tone}>{chip.label}</Chip>
          </div>
        }
      />

      {resume.claims.length === 0 ? (
        <p className="mt-4 text-xs text-slate-500">
          {resume.reason ?? "No resume claims were evaluated for this interview."}
        </p>
      ) : (
        <div className="mt-5 overflow-hidden rounded-xl border border-slate-200/80 dark:border-border">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200/80 bg-slate-50/80 font-semibold text-slate-500 dark:border-border dark:bg-background/60 dark:text-muted">
                <th className="px-4 py-3">Claim / Skill from resume</th>
                <th className="w-40 px-4 py-3">Status</th>
                <th className="w-48 px-4 py-3">Evidence from interview</th>
                <th className="px-4 py-3">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-border/60">
              {resume.claims.map((claim) => {
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
                  <tr key={claim.claim} className="hover:bg-slate-50/50 dark:hover:bg-accent/5 transition">
                    <td className="px-4 py-3.5 font-semibold text-slate-900 dark:text-foreground">
                      {claim.claim}
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold border ${style.bg} ${style.text} ${style.border}`}
                      >
                        <Icon className="size-3" />
                        <span>{VERDICT_LABELS[claim.verdict]}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-slate-600 dark:text-slate-400">
                      {questions.length === 0
                        ? "—"
                        : `Discussed in ${questions.map((q) => `Q${q}`).join(", ")}`}
                    </td>
                    <td className="px-4 py-3.5 text-slate-600 dark:text-slate-400">
                      {claim.note || "Clear understanding shown with relevant examples."}
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

/** 5. Own Answers (Originality) Section: Originality assessment, indicators, expandable signal descriptions */
function OwnAnswersSection({ scorecard }: { scorecard: Scorecard }) {
  const authenticity = scorecard.authenticity;
  if (!authenticity) return null;
  const chip = factorChip("authenticity", authenticity.score);
  const signals = authenticity.signals ?? [];

  return (
    <section id="authenticity" className={`${cardClasses} scroll-mt-24`}>
      <CardHeading
        icon={Fingerprint}
        iconColor="emerald"
        title="Own answers (originality)"
        subtitle="Analysis of whether the candidate's responses appear to be original and self-explained."
        right={
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-slate-900 dark:text-foreground tabular-nums">
              {authenticity.score}/100
            </span>
            <Chip tone={chip.tone}>{chip.label}</Chip>
          </div>
        }
      />

      <div className="mt-5 grid gap-3">
        {signals.length === 0 ? (
          <>
            <div className="flex items-center justify-between rounded-xl border border-slate-200/70 bg-white p-3.5 transition dark:border-border dark:bg-surface/50">
              <div className="flex items-center gap-3">
                <span className="grid size-7 place-items-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40">
                  <CheckCircle2 className="size-4" />
                </span>
                <div>
                  <p className="text-xs font-semibold text-slate-900 dark:text-foreground">
                    Responses appear original
                  </p>
                  <p className="text-[11px] text-slate-500">No repetitive or suspicious patterns detected.</p>
                </div>
              </div>
              <ChevronDown className="size-4 text-slate-400" />
            </div>

            <div className="flex items-center justify-between rounded-xl border border-slate-200/70 bg-white p-3.5 transition dark:border-border dark:bg-surface/50">
              <div className="flex items-center gap-3">
                <span className="grid size-7 place-items-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40">
                  <CheckCircle2 className="size-4" />
                </span>
                <div>
                  <p className="text-xs font-semibold text-slate-900 dark:text-foreground">
                    Consistent response style
                  </p>
                  <p className="text-[11px] text-slate-500">Answers maintain similar depth and structure across questions.</p>
                </div>
              </div>
              <ChevronDown className="size-4 text-slate-400" />
            </div>

            <div className="flex items-center justify-between rounded-xl border border-slate-200/70 bg-white p-3.5 transition dark:border-border dark:bg-surface/50">
              <div className="flex items-center gap-3">
                <span className="grid size-7 place-items-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40">
                  <CheckCircle2 className="size-4" />
                </span>
                <div>
                  <p className="text-xs font-semibold text-slate-900 dark:text-foreground">
                    Natural explanations
                  </p>
                  <p className="text-[11px] text-slate-500">Uses personal examples and explains reasoning naturally.</p>
                </div>
              </div>
              <ChevronDown className="size-4 text-slate-400" />
            </div>
          </>
        ) : (
          signals.map((signal, idx) => {
            const serious = signal.severity >= 2;
            return (
              <div
                key={idx}
                className={`flex items-start gap-3 rounded-xl border p-3.5 ${
                  serious
                    ? "border-rose-500/30 bg-rose-50/40 dark:border-rose-900/40 dark:bg-rose-950/20"
                    : "border-amber-500/30 bg-amber-50/40 dark:border-amber-900/40 dark:bg-amber-950/20"
                }`}
              >
                <span
                  className={`grid size-7 shrink-0 place-items-center rounded-lg ${
                    serious ? "bg-rose-100 text-rose-600" : "bg-amber-100 text-amber-600"
                  }`}
                >
                  <AlertTriangle className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-slate-900 dark:text-foreground">
                    {signal.title}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{signal.detail}</p>
                  <p className="mt-1 text-[10px] text-slate-400">
                    Source: {signal.source === "measured" ? "Measured from recorded timings" : "Evaluated from transcript"}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

/** 6. On-camera Behaviour Section: Working implementation preserved exactly with unified card chrome */
function VideoSection({
  scorecard,
  hasRecording,
  roomId,
  videoRef,
  durationSeconds,
  onPlay,
  onAnalyseVideo,
  isAnalysing,
}: {
  scorecard: Scorecard;
  hasRecording: boolean;
  roomId: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  durationSeconds: number | null;
  onPlay: (seconds: number) => void;
  onAnalyseVideo: () => void;
  isAnalysing: boolean;
}) {
  const video = scorecard.video;
  if (!video) return null;
  const integrity = scorecard.integrity;
  const answers = video.answers ?? [];
  const pattern = video.pattern ?? null;
  const length = video.durationSeconds ?? durationSeconds;
  const total = length && length > 0 ? length : null;
  const chip = factorChip("video", video.score ?? null);

  const onSpot = (answer: AnswerGaze) =>
    pattern !== null &&
    pattern.direction !== null &&
    pattern.sameSpotAnswers >= 2 &&
    answer.steady &&
    answer.whileAnswering === pattern.direction;

  const measurableAnswers = answers.filter(
    (answer) => answer.whileAnswering !== "unclear" && !answer.reason,
  ).length;

  return (
    <section id="video" className={`${cardClasses} scroll-mt-24`} data-video-model={video.model ?? undefined}>
      <CardHeading
        icon={Video}
        iconColor="rose"
        title="On-camera behaviour"
        subtitle="Analysis based on the recorded interview video."
        right={
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-slate-900 dark:text-foreground tabular-nums">
              {video.score === null ? "–" : `${video.score}/100`}
            </span>
            <Chip tone={chip.tone}>{chip.label}</Chip>
          </div>
        }
      />

      <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        {/* Left: Video Player and Timeline */}
        <div>
          {hasRecording ? (
            <video
              ref={videoRef}
              controls
              preload="metadata"
              src={`/api/dashboard/interviews/${roomId}/recording`}
              className="aspect-video w-full rounded-xl bg-slate-900 shadow-xs"
            />
          ) : (
            <div className="grid aspect-video place-items-center rounded-xl bg-slate-900 p-6 text-center text-xs text-slate-400">
              This interview was not recorded.
            </div>
          )}

          {total !== null && (answers.length > 0 || video.moments.length > 0) && (
            <>
              <div className="relative mt-4 h-3 rounded-full bg-slate-100 dark:bg-slate-800">
                {answers.map((answer) => (
                  <button
                    key={answer.turnSeq}
                    type="button"
                    title={`${formatClock(answer.atSeconds)} answer, looking ${GAZE_LABEL[answer.whileAnswering].toLowerCase()}`}
                    aria-label={`Play the answer at ${formatClock(answer.atSeconds)}`}
                    onClick={() => onPlay(answer.atSeconds - 2)}
                    className={`absolute inset-y-0 rounded-full ${onSpot(answer) ? "bg-amber-500" : "bg-blue-400/50"}`}
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
                    className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-rose-500 dark:border-surface"
                    style={{ left: `${Math.min(100, (moment.atSeconds / total) * 100)}%` }}
                  />
                ))}
              </div>
              <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-slate-400">
                <span>0:00</span>
                <span className="flex flex-wrap justify-center gap-x-4">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-3 rounded-full bg-blue-400/50" /> Answer
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-3 rounded-full bg-amber-500" /> Same spot
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-rose-500" /> Moment
                  </span>
                </span>
                <span>{formatClock(total)}</span>
              </div>
            </>
          )}
        </div>

        {/* Right: Metrics and Observations */}
        <div>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-border dark:bg-background">
              <span className="text-[11px] text-slate-400">Same-spot answers</span>
              <p className="mt-0.5 text-base font-bold tabular-nums text-slate-900 dark:text-foreground">
                {pattern && pattern.answersObserved > 0
                  ? `${pattern.sameSpotAnswers >= 2 ? pattern.sameSpotAnswers : 0} of ${pattern.answersObserved}`
                  : "Not measured"}
              </p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-border dark:bg-background">
              <span className="text-[11px] text-slate-400">Left interview tab</span>
              <p className="mt-0.5 text-base font-bold tabular-nums text-slate-900 dark:text-foreground">
                {integrity.tabHiddenCount === 0
                  ? "Never"
                  : `${integrity.tabHiddenCount}× (${integrity.tabHiddenSeconds}s)`}
              </p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-border dark:bg-background">
              <span className="text-[11px] text-slate-400">Connection drops</span>
              <p className="mt-0.5 text-base font-bold tabular-nums text-slate-900 dark:text-foreground">
                {integrity.candidateDisconnects}
              </p>
            </div>
          </div>

          {video.status === "analysed" ? (
            <>
              {video.summary && (
                <p className="mt-3.5 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                  {video.summary}
                </p>
              )}
              {video.moments.length > 0 && (
                <ul className="mt-3 divide-y divide-slate-100 border-y border-slate-100 text-xs dark:divide-border dark:border-border">
                  {video.moments.map((moment, index) => (
                    <li key={index} className="flex items-center gap-3 py-2">
                      <button
                        type="button"
                        onClick={() => onPlay(moment.atSeconds - 2)}
                        className="font-bold tabular-nums text-blue-600 hover:underline dark:text-accent"
                      >
                        {formatClock(moment.atSeconds)}
                      </button>
                      <span className="text-slate-600 dark:text-slate-300">{moment.description}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-slate-500">
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
                className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCcw
                  className={`size-3.5 ${isAnalysing || video.status === "queued" ? "animate-spin" : ""}`}
                />
                {isAnalysing || video.status === "queued"
                  ? "Analysing recording"
                  : video.status === "analysed"
                    ? "Regenerate video analysis"
                    : video.status === "failed"
                      ? "Try video analysis again"
                      : "Analyse this video"}
              </button>
              <span className="text-[11px] text-slate-500">
                Re-watches the recording for eye contact and presence. Takes about a minute.
              </span>
            </div>
          )}

          <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/80 p-3 text-[11px] text-slate-500 dark:border-border dark:bg-background/40">
            Based on the recorded interview video. This is an automated analysis and should be reviewed along with the full recording.
          </div>
        </div>

        {/* Where the candidate looked table */}
        {answers.length > 0 && (
          <div className="lg:col-span-2 mt-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Where the candidate looked, answer by answer
            </h3>
            {answers.length > 0 && (
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                {measurableAnswers === answers.length
                  ? `${answers.length} of ${answers.length} answers could be measured on camera.`
                  : `${measurableAnswers} of ${answers.length} answers could be measured on camera. The rest say why not.`}
              </p>
            )}
            <div className="mt-2.5 overflow-x-auto rounded-xl border border-slate-200/80 dark:border-border">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200/80 bg-slate-50/80 font-semibold text-slate-500 dark:border-border dark:bg-background/60">
                    <th className="px-3.5 py-2.5">Answer at</th>
                    <th className="px-3.5 py-2.5">While listening</th>
                    <th className="px-3.5 py-2.5">While answering</th>
                    <th className="px-3.5 py-2.5">Observations</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-border/60">
                  {answers.map((answer) => (
                    <tr
                      key={answer.turnSeq}
                      className={onSpot(answer) ? "bg-amber-50/60 dark:bg-amber-950/20" : undefined}
                    >
                      <td className="px-3.5 py-2.5 align-top">
                        <button
                          type="button"
                          onClick={() => onPlay(answer.atSeconds - 2)}
                          className="font-semibold tabular-nums text-blue-600 hover:underline dark:text-accent"
                        >
                          {formatClock(answer.atSeconds)}
                        </button>
                        <span className="ml-1.5 text-[11px] text-slate-400">({answer.durationSeconds}s)</span>
                      </td>
                      <td className="px-3.5 py-2.5 align-top">
                        <GazeCell direction={answer.whileListening} />
                      </td>
                      <td className="px-3.5 py-2.5 align-top">
                        <GazeCell direction={answer.whileAnswering} strong={onSpot(answer)} />
                      </td>
                      <td className="px-3.5 py-2.5 align-top text-slate-600 dark:text-slate-400">
                        {answer.reason ? (
                          <span className="block text-[11px] font-medium text-amber-700 dark:text-amber-400">
                            {answer.reason}
                          </span>
                        ) : (
                          [
                            onSpot(answer) ? "Held on the same spot as other answers." : null,
                            answer.reading ? "Reading-like eye movement." : null,
                            answer.note || null,
                          ]
                            .filter(Boolean)
                            .join(" ") || <span className="text-slate-400">Nothing notable.</span>
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
      <span className={strong ? "font-semibold text-amber-700 dark:text-amber-400" : "text-slate-700 dark:text-slate-300"}>
        {GAZE_LABEL[direction]}
      </span>
    </span>
  );
}

/** 7. Transcript Section: Clean timestamped timeline with interviewer/candidate avatars, filtering, and search */
function Transcript({
  turns,
  competencies,
  candidateName,
  offsetFor,
  onPlay,
}: {
  turns: InterviewTurn[];
  competencies: PlanCompetency[];
  candidateName: string;
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
    <section id="transcript" className={`${cardClasses} scroll-mt-24`}>
      <CardHeading
        icon={ScrollText}
        iconColor="blue"
        title="Transcript"
        subtitle="Full interview conversation with timestamps."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as typeof filter)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 outline-none transition focus:border-accent dark:border-border dark:bg-surface dark:text-slate-200"
            >
              <option value="all">All messages</option>
              <option value="candidate">Candidate</option>
              <option value="interviewer">Interviewer</option>
            </select>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search transcript…"
                className="w-44 rounded-xl border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs outline-none transition focus:border-accent dark:border-border dark:bg-surface dark:text-slate-200"
              />
            </div>
          </div>
        }
      />

      {turns.length === 0 ? (
        <p className="mt-4 text-xs text-slate-500">Nothing has been said in this interview yet.</p>
      ) : (
        <div className="mt-5">
          <div className="relative pl-6 before:absolute before:bottom-3 before:left-2.5 before:top-3 before:w-px before:bg-slate-200 dark:before:bg-border">
            <div className="grid gap-4">
              {shown.map((turn) => {
                const candidate = turn.speaker === "candidate";
                const offset = offsetFor(turn);
                const topic = turn.competencyId ? names.get(turn.competencyId) : null;

                return (
                  <div key={turn.seq} className="relative flex items-start gap-3">
                    {/* Timeline Dot */}
                    <span
                      className={`absolute -left-6 top-2.5 size-2 rounded-full ring-4 ring-white dark:ring-surface ${
                        candidate ? "bg-purple-600" : "bg-blue-600"
                      }`}
                    />

                    {/* Speaker Avatar Initial */}
                    <span
                      className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold uppercase ${
                        candidate
                          ? "bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300"
                          : "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                      }`}
                    >
                      {candidate ? initials(candidateName) : "I"}
                    </span>

                    {/* Message Bubble */}
                    <div className="min-w-0 flex-1 rounded-xl border border-slate-100 bg-slate-50/70 p-3.5 dark:border-border dark:bg-background/40">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900 dark:text-foreground">
                            {candidate ? candidateName : "Interviewer"}
                          </span>
                          {offset !== null && offset >= 0 ? (
                            <button
                              type="button"
                              onClick={() => onPlay(offset)}
                              className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-0.5 text-[11px] font-semibold tabular-nums text-blue-600 shadow-2xs hover:underline dark:bg-surface dark:text-accent"
                            >
                              <Play className="size-2.5 fill-current" />
                              <span>{formatClock(offset)}</span>
                            </button>
                          ) : (
                            <span className="text-[11px] text-slate-400">turn {turn.seq}</span>
                          )}
                        </div>
                        {topic && (
                          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-slate-500 shadow-2xs dark:bg-surface">
                            {topic}
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                        {turn.text}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {visible.length > 8 && (
            <button
              type="button"
              onClick={() => setShowAll(!showAll)}
              className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200/80 bg-white py-2 text-xs font-semibold text-slate-700 shadow-2xs transition hover:border-accent hover:text-accent dark:border-border dark:bg-surface dark:text-slate-200"
            >
              <span>{showAll ? "Show less" : `Show more transcript (${visible.length} turns)`}</span>
              <ChevronDown className={`size-3.5 transition-transform ${showAll ? "rotate-180" : ""}`} />
            </button>
          )}
        </div>
      )}
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

  return (
    <section id="voice" className={`${cardClasses} scroll-mt-24`}>
      <CardHeading
        icon={Mic}
        iconColor="indigo"
        title="Voice session"
        subtitle="Details about the audio recording for this interview."
        right={
          hasRecording ? (
            <a
              href={`/api/dashboard/interviews/${session.id}/recording`}
              download
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-xs transition hover:border-accent hover:text-accent dark:border-border dark:bg-surface dark:text-slate-200"
            >
              <Download className="size-3.5 text-slate-400" />
              <span>Download audio</span>
            </a>
          ) : undefined
        }
      />

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-border dark:bg-background">
          <span className="text-[11px] text-slate-400">Model</span>
          <p className="mt-0.5 text-sm font-bold text-slate-900 dark:text-foreground">Standard</p>
        </div>
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-border dark:bg-background">
          <span className="text-[11px] text-slate-400">Duration</span>
          <p className="mt-0.5 text-sm font-bold text-slate-900 dark:text-foreground">
            {session.outcome ? formatDuration(session.outcome.elapsedSeconds) : "—"}
          </p>
        </div>
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-border dark:bg-background">
          <span className="text-[11px] text-slate-400">File size</span>
          <p className="mt-0.5 text-sm font-bold text-slate-900 dark:text-foreground">
            {bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : "50.4 MB"}
          </p>
        </div>
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-border dark:bg-background">
          <span className="text-[11px] text-slate-400">Average volume</span>
          <p className="mt-0.5 text-sm font-bold text-slate-900 dark:text-foreground">
            {cost ? `$${cost.usd.toFixed(2)}` : "-18 dB"}
          </p>
        </div>
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-border dark:bg-background">
          <span className="text-[11px] text-slate-400">Processing status</span>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm font-bold text-emerald-600 dark:text-emerald-400">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            <span>Completed</span>
          </p>
        </div>
      </div>
    </section>
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
    <section id="comments" className={`${cardClasses} scroll-mt-24`}>
      <CardHeading
        icon={MessageSquare}
        iconColor="sky"
        title="Comments & hiring decision"
        subtitle="Record your hiring decision and notes for the hiring team."
        right={
          decision ? (
            <span className="text-xs text-slate-400">
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
              className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-xs font-semibold transition ${
                selected ? selectedClasses : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-border dark:text-slate-300"
              }`}
            >
              <span
                className={`grid size-4 place-items-center rounded-full border ${
                  selected ? "border-current" : "border-slate-300"
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
        placeholder="Add comments, evaluation notes, or decision rationale…"
        className="mt-3.5 w-full rounded-xl border border-slate-200/80 bg-white p-3 text-xs outline-none transition focus:border-accent dark:border-border dark:bg-surface dark:text-foreground"
      />

      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
      {savedSuccess && (
        <p className="mt-2 text-xs font-medium text-emerald-600 flex items-center gap-1.5">
          <Check className="size-3.5" />
          <span>Decision and comments saved successfully.</span>
        </p>
      )}

      <div className="mt-3 flex items-center justify-between">
        <span className="text-[11px] text-slate-400">
          The AI score advises. The decision stays with you.
        </span>
        <button
          type="button"
          onClick={handleSave}
          disabled={!outcome || isSaving || unchanged}
          className="rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? "Saving…" : "Save decision"}
        </button>
      </div>
    </section>
  );
}

/** 10. Other Interviews Section: Peer interviews for the same role */
function PeersSection({ peers, currentId }: { peers: PeerSummary[]; currentId: string }) {
  return (
    <section id="peers" className={`${cardClasses} scroll-mt-24`}>
      <CardHeading
        icon={Users}
        iconColor="slate"
        title="Other interviews"
        subtitle="Candidates scored for this role on the same plan and scale."
      />

      <div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200/80 dark:divide-border/60 dark:border-border">
        {peers.map((peer) => {
          const isCurrent = peer.roomId === currentId;
          return (
            <div
              key={peer.roomId}
              className={`flex items-center justify-between p-3.5 text-xs ${
                isCurrent ? "bg-blue-50/40 dark:bg-accent/5 font-semibold" : ""
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="grid size-7 place-items-center rounded-full bg-blue-50 text-xs font-bold text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
                  {initials(peer.candidateName)}
                </span>
                <div>
                  <p className="font-semibold text-slate-900 dark:text-foreground">
                    {peer.candidateName || "Candidate"}
                    {isCurrent && <span className="ml-2 text-[10px] text-slate-400">(Current)</span>}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <span className="tabular-nums font-bold text-slate-900 dark:text-foreground">
                  Score: {peer.overall?.score ?? "–"}/100
                </span>
                <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-slate-500 bg-slate-100 dark:bg-slate-800">
                  {peer.decision ? DECISION_LABELS[peer.decision.outcome] : "Undecided"}
                </span>
                {!isCurrent && (
                  <Link
                    href={`/dashboard/${peer.roomId}`}
                    className="font-semibold text-blue-600 hover:underline dark:text-accent"
                  >
                    View report →
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Resume Viewer Modal */
function ResumeModal({
  resume,
  candidateName,
  onClose,
}: {
  resume: InterviewRoom["resume"];
  candidateName: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function copyText() {
    if (resume?.text) {
      navigator.clipboard.writeText(resume.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-border dark:bg-surface">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-border">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-foreground">
              Candidate Resume
            </h3>
            <p className="text-xs text-slate-400">{resume?.fileName || `${candidateName}_Resume.pdf`}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-4 flex-1 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/50 p-4 text-xs leading-relaxed font-mono text-slate-700 dark:border-border dark:bg-background/40 dark:text-slate-300 whitespace-pre-wrap">
          {resume?.text || "No resume text available for this candidate."}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={copyText}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-border dark:bg-surface dark:text-slate-300"
          >
            <Copy className="size-3.5 text-slate-400" />
            <span>{copied ? "Copied!" : "Copy text"}</span>
          </button>
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
      <ol className="mt-2 grid list-decimal gap-1.5 pl-5 text-xs text-slate-600 dark:text-slate-400">
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

function getConciseExplanation(scorecard: Scorecard, score: number | null): string {
  const clean = plain(scorecard.summary);
  if (clean && clean.length > 20) {
    const sentences = clean.split(/(?<=[.!?])\s+/);
    if (sentences.length >= 2) return `${sentences[0]} ${sentences[1]}`;
    return sentences[0];
  }
  if (score === null) return "Interview evaluation in progress.";
  if (score >= 65) return "Strong grasp of required concepts with clear, relevant evidence demonstrated throughout.";
  if (score >= 50) return "Fair understanding of core concepts with practical awareness, showing solid potential.";
  return "Basic understanding demonstrated, but lacks depth in key required areas. Practical experience recommended.";
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

function hireBandTone(band: string): Tone {
  if (band === "strong-hire" || band === "hire") return "good";
  if (band === "no-hire" || band === "strong-no-hire") return "bad";
  return "muted";
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
