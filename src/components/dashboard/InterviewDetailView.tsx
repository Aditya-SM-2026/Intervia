"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { estimateVoiceCost } from "@/lib/interviews/cost";
import type {
  HumanDecision,
  InterviewEvent,
  InterviewRoom,
  InterviewTurn,
  VoiceMode,
} from "@/lib/interviews/interview.types";
import type { PlanCompetency } from "@/lib/interviews/plan.types";
import type {
  AnswerGaze,
  CompetencyScore,
  GazeDirection,
  InterviewDetailResponse,
  PeerSummary,
  ResumeVerdict,
  Scorecard,
  ScoreSuggestion,
  VideoMoment,
} from "@/lib/interviews/scorecard.types";
import { FACTOR_META } from "./factors";
import { GAZE_GRID, GAZE_LABEL } from "./gaze";

/**
 * One interview for the recruiter. The overall score sits at the top with the
 * four factors it is made of; each factor then has its own section showing
 * what it is based on, down to the transcript lines and recording moments.
 */

const SUGGESTION_LABELS: Record<ScoreSuggestion, string> = {
  strong: "Strong evidence across the plan",
  positive: "Meets the bar on most competencies",
  mixed: "Mixed: some competencies below the bar",
  weak: "Below the bar on most competencies",
  insufficient: "Not enough evidence to assess",
};

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
  confirmed: "Confirmed",
  partly_supported: "Partly supported",
  not_supported: "Not supported",
  not_discussed: "Not discussed",
};

const VERDICT_STYLES: Record<ResumeVerdict, string> = {
  confirmed: "text-candidate",
  partly_supported: "text-amber-600 dark:text-amber-400",
  not_supported: "text-red-600 dark:text-red-400",
  not_discussed: "text-muted",
};

const SEVERITY_LABELS = { 1: "Worth a glance", 2: "Notable", 3: "Strong" } as const;

const cardClasses = "rounded-2xl border border-border bg-surface p-5 sm:p-6";
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
  const recordingStart = detail.recordingStartedAt;
  /** Seconds into the recording at which a transcript turn starts. */
  const recordingOffset = (turn: InterviewTurn): number | null =>
    hasRecording && recordingStart && turn.startedAt
      ? (Date.parse(turn.startedAt) - Date.parse(recordingStart)) / 1000
      : null;

  return (
    <div className="grid gap-8">
      <div className="grid gap-5">
        <BackLink />
        <Header session={session} />
        {error && (
          <p role="alert" className={alertClasses}>
            {error}
          </p>
        )}
      </div>

      {scorecard ? (
        <>
          <ScoreSummary scorecard={scorecard} />
          <Overview scorecard={scorecard} />
          <DecisionForm
            roomId={roomId}
            decision={session.decision}
            onSaved={(decision) => setDetail({ ...detail, session: { ...session, decision } })}
          />

          <section id="answers" className="scroll-mt-6">
            <SectionHeading
              title="Answer quality"
              note="One card per planned question, scored from 1 to 5 against the rating scale for this role. Every score quotes the candidate."
            />
            <div className="mt-4 grid gap-3">
              {scorecard.competencies.map((score) => (
                <CompetencyCard
                  key={score.competencyId}
                  score={score}
                  competency={competencies.find((item) => item.id === score.competencyId)}
                  session={session}
                />
              ))}
            </div>
          </section>

          <ResumeSection scorecard={scorecard} />
          <AuthenticitySection scorecard={scorecard} />
          <VideoSection
            scorecard={scorecard}
            hasRecording={hasRecording}
            roomId={roomId}
            videoRef={videoRef}
            durationSeconds={session.outcome?.elapsedSeconds ?? null}
            onPlay={playFrom}
          />
          <PeersSection peers={peers} currentId={roomId} />
        </>
      ) : (
        <>
          <section className={cardClasses}>
            <h2 className="text-lg font-semibold">Scorecard</h2>
            <p className="mt-1 text-sm">{reason ?? "No scorecard is available for this interview yet."}</p>
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

      <VoiceRun session={session} />

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
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isRegenerating ? "Scoring…" : scorecard ? "Regenerate scorecard" : "Generate scorecard"}
          </button>
        )}
      </footer>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/dashboard" className="text-sm text-muted transition hover:text-foreground">
      ← All interviews
    </Link>
  );
}

function SectionHeading({ title, note }: { title: string; note: string }) {
  return (
    <>
      <h2 className="text-2xl font-semibold">{title}</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">{note}</p>
    </>
  );
}

function Header({ session }: { session: InterviewRoom }) {
  const outcome = session.outcome;
  const facts: [string, string][] = [
    ["Role", session.roleTitle || session.title],
    [
      "Length",
      outcome
        ? `${Math.round(outcome.elapsedSeconds / 60)} of ${session.durationMinutes} min`
        : `${session.durationMinutes} min planned`,
    ],
    ["Ended", outcome ? (END_REASONS[outcome.reason] ?? outcome.reason) : "Not finished"],
  ];
  if (session.completedAt) facts.push(["Date", formatDateTime(session.completedAt)]);
  if (session.recruiterName) facts.push(["Recruiter", session.recruiterName]);

  return (
    <header>
      <h1 className="text-3xl font-semibold">{session.candidateName || "Candidate"}</h1>
      {session.candidateEmail && <p className="mt-0.5 text-muted">{session.candidateEmail}</p>}
      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </header>
  );
}

/** The overall score and the four factors that make it up. */
function ScoreSummary({ scorecard }: { scorecard: Scorecard }) {
  const overall = scorecard.overall;

  if (!overall) {
    // A scorecard from before the four-factor analysis existed.
    return (
      <section className={cardClasses}>
        <p className="text-sm font-semibold">Answer quality</p>
        <p className="mt-1 font-display text-6xl font-semibold leading-none tabular-nums">
          {scorecard.overallScore === null ? "–" : scorecard.overallScore.toFixed(1)}
          <span className="text-xl font-normal text-muted"> of 5</span>
        </p>
        <p className="mt-3 max-w-xl text-sm text-muted">
          This scorecard was made before resume match, own-answer signals and on-camera
          analysis were added. Regenerate it, at the bottom of the page, to get the full
          analysis and an overall score.
        </p>
      </section>
    );
  }

  const counted = overall.factors.filter((factor) => factor.score !== null && factor.weight > 0);
  const countedWeight = counted.reduce((sum, factor) => sum + factor.weight, 0);

  return (
    <section className={cardClasses}>
      <div className="grid gap-8 lg:grid-cols-[14rem_1fr]">
        <div>
          <p className="text-sm font-semibold">Overall</p>
          <p className="mt-1 font-display text-7xl font-semibold leading-none tabular-nums">
            {overall.score ?? "–"}
            <span className="text-xl font-normal text-muted"> of 100</span>
          </p>
          <p className="mt-3 text-sm text-muted">
            {overall.score === null
              ? "There were not enough scored answers to give an overall score."
              : "A weighted average of the scores on the right. It advises; the decision is yours."}
          </p>
          {counted.length > 0 && (
            <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-border" aria-hidden="true">
              {counted.map((factor) => (
                <span
                  key={factor.id}
                  className={FACTOR_META[factor.id].bar}
                  style={{
                    width: `${((factor.score as number) * factor.weight) / countedWeight}%`,
                    opacity: 0.55 + (factor.weight / countedWeight) * 0.45,
                  }}
                />
              ))}
            </div>
          )}
          {scorecard.needsHumanReview && (
            <p className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              Check the evidence before deciding: graders disagreed, or some evidence could not
              be verified.
            </p>
          )}
        </div>

        <ul className="grid gap-5">
          {overall.factors.map((factor) => {
            const meta = FACTOR_META[factor.id];
            const share =
              factor.score === null || countedWeight === 0
                ? null
                : Math.round((factor.weight / countedWeight) * 100);
            return (
              <li key={factor.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <a href={`#${factor.id}`} className="font-semibold hover:text-accent">
                    {meta.name}
                  </a>
                  <span className="text-sm tabular-nums">
                    {factor.score === null ? (
                      <span className="text-muted">Not scored, left out of the total</span>
                    ) : (
                      <>
                        <span className="text-lg font-semibold">{factor.score}</span>
                        <span className="text-muted"> of 100, counts {share}%</span>
                      </>
                    )}
                  </span>
                </div>
                <div className="mt-1.5 h-2 rounded-full bg-border" aria-hidden="true">
                  {factor.score !== null && (
                    <div className={`h-full rounded-full ${meta.bar}`} style={{ width: `${factor.score}%` }} />
                  )}
                </div>
                <p className="mt-1.5 text-sm text-muted">{meta.explains}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function Overview({ scorecard }: { scorecard: Scorecard }) {
  return (
    <section className={cardClasses}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Summary</h2>
        <span className="text-sm text-muted">{SUGGESTION_LABELS[scorecard.suggestion]}</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed">{scorecard.summary}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <BulletList title="Strengths" items={scorecard.strengths} />
        <BulletList title="Concerns" items={scorecard.concerns} />
      </div>
      {scorecard.notes.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <BulletList title="About this scorecard" items={scorecard.notes} muted />
        </div>
      )}
    </section>
  );
}

function BulletList({ title, items, muted }: { title: string; items: string[]; muted?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="mb-2 text-sm font-semibold">{title}</p>
      <ul className={`grid list-disc gap-1 pl-5 text-sm ${muted ? "text-muted" : ""}`}>
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/** A 1-5 score as five segments, so scores can be compared down the page. */
function ScoreSegments({ score }: { score: number }) {
  return (
    <span className="flex gap-1" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((step) => (
        <span key={step} className={`h-2 w-5 rounded-sm ${step <= score ? "bg-accent" : "bg-border"}`} />
      ))}
    </span>
  );
}

function CompetencyCard({
  score,
  competency,
  session,
}: {
  score: CompetencyScore;
  competency: PlanCompetency | undefined;
  session: InterviewRoom;
}) {
  const coverage = session.outcome?.coverage.find((item) => item.competencyId === score.competencyId);
  const seconds =
    coverage?.startedAtSeconds != null && coverage.endedAtSeconds != null
      ? Math.round(coverage.endedAtSeconds - coverage.startedAtSeconds)
      : null;

  return (
    <article className={cardClasses}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold">{score.name}</h3>
          {competency && <p className="mt-0.5 text-sm text-muted">{competency.question}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {score.judgesAgree === false && (
            <span
              title="An independent second grading differed by more than one point"
              className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400"
            >
              Second grader: {score.secondScore}
            </span>
          )}
          {score.score !== null ? (
            <span className="flex items-center gap-2 text-sm font-semibold tabular-nums">
              <ScoreSegments score={score.score} />
              {score.score} of 5
            </span>
          ) : (
            <span className="text-sm text-muted">
              {score.status === "not_assessed" ? "Not reached" : "Not enough evidence"}
            </span>
          )}
        </div>
      </div>

      <p className="mt-3 text-sm leading-relaxed">{score.rationale}</p>

      {score.evidence.length > 0 && (
        <ul className="mt-3 grid gap-2">
          {score.evidence.map((item, index) => (
            <li key={index} className="border-l-2 border-candidate pl-3 text-sm">
              <span className="italic">“{item.quote}”</span>{" "}
              <a href={`#turn-${item.turnSeq}`} className="text-xs text-accent hover:underline">
                turn {item.turnSeq}
              </a>
            </li>
          ))}
        </ul>
      )}

      {score.gaps.length > 0 && (
        <div className="mt-3">
          <BulletList title="What was missing" items={score.gaps} muted />
        </div>
      )}

      {competency && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-xs font-medium text-muted hover:text-foreground">
            Rating scale
            {seconds !== null ? `, ${Math.floor(seconds / 60)}m ${seconds % 60}s spent` : ""}
            {coverage?.advancedBy === "controller" ? ", moved on at the time limit" : ""}
          </summary>
          <dl className="mt-2 grid gap-1 text-muted">
            <div>
              <dt className="inline font-medium text-foreground">1 to 2: </dt>
              <dd className="inline">{competency.anchors.poor}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-foreground">3: </dt>
              <dd className="inline">{competency.anchors.good}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-foreground">5: </dt>
              <dd className="inline">{competency.anchors.excellent}</dd>
            </div>
          </dl>
        </details>
      )}
    </article>
  );
}

function TurnLinks({ seqs }: { seqs: number[] }) {
  if (seqs.length === 0) return null;
  return (
    <span className="whitespace-nowrap">
      {seqs.map((seq) => (
        <a key={seq} href={`#turn-${seq}`} className="mr-1.5 text-xs text-accent hover:underline">
          turn {seq}
        </a>
      ))}
    </span>
  );
}

function ResumeSection({ scorecard }: { scorecard: Scorecard }) {
  const match = scorecard.resumeMatch;
  if (!match) return null;
  return (
    <section id="resume" className="scroll-mt-6">
      <SectionHeading
        title="Resume match"
        note="Each claim taken from the resume, and whether the candidate's own account in the interview backs it up. Claims that never came up do not count for or against."
      />
      {match.reason && <p className="mt-3 text-sm text-muted">{match.reason}</p>}
      {match.claims.length > 0 && (
        <div className={`${cardClasses} mt-4 !p-0`}>
          <div className="hidden grid-cols-[minmax(0,1.3fr)_9rem_minmax(0,1.5fr)] gap-4 border-b border-border px-5 py-2.5 text-xs font-medium text-muted md:grid">
            <span>On the resume</span>
            <span>In the interview</span>
            <span>Why</span>
          </div>
          <ul className="divide-y divide-border">
            {match.claims.map((claim, index) => (
              <li
                key={index}
                className="grid gap-x-4 gap-y-1 px-5 py-3.5 text-sm md:grid-cols-[minmax(0,1.3fr)_9rem_minmax(0,1.5fr)]"
              >
                <span>{claim.claim}</span>
                <span className={`font-semibold ${VERDICT_STYLES[claim.verdict]}`}>
                  {VERDICT_LABELS[claim.verdict]}
                </span>
                <span className="text-muted">
                  {claim.note} <TurnLinks seqs={claim.turnSeqs} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function AuthenticitySection({ scorecard }: { scorecard: Scorecard }) {
  const authenticity = scorecard.authenticity;
  if (!authenticity) return null;
  return (
    <section id="authenticity" className="scroll-mt-6">
      <SectionHeading
        title="Own answers"
        note="Patterns in the wording and timing of answers that can indicate reading from, or being prompted by, an AI tool. Each links to the answers it is based on. They are reasons to look, not proof."
      />
      {authenticity.signals.length === 0 ? (
        <p className={`${cardClasses} mt-4 text-sm`}>
          Nothing stood out. That means no signs were found in the transcript or the timings; it
          does not prove the answers were unaided.
        </p>
      ) : (
        <ul className="mt-4 grid gap-3 md:grid-cols-2">
          {authenticity.signals.map((signal, index) => (
            <li key={index} className={cardClasses}>
              <p className="font-semibold">{signal.title}</p>
              <p className="mt-0.5 text-xs text-muted">
                {SEVERITY_LABELS[signal.severity]},{" "}
                {signal.source === "measured" ? "measured from recorded timings" : "from reading the transcript"}
              </p>
              <p className="mt-2 text-sm">{signal.detail}</p>
              <p className="mt-2">
                <TurnLinks seqs={signal.turnSeqs} />
              </p>
            </li>
          ))}
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
    <section id="video" className="scroll-mt-6">
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

function PeersSection({ peers, currentId }: { peers: PeerSummary[]; currentId: string }) {
  if (peers.length < 2) return null;
  const factorIds = peers[0].overall?.factors.map((factor) => factor.id) ?? [];
  return (
    <section>
      <SectionHeading
        title="Candidates for this role"
        note="Everyone scored for the same role title, highest overall first. Compare like with like: the same plan and the same scale."
      />
      <div className={`${cardClasses} mt-4 overflow-x-auto !p-0`}>
        <table className="w-full min-w-[42rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="px-5 py-2.5 font-medium">Candidate</th>
              <th className="px-3 py-2.5 font-medium">Overall</th>
              {factorIds.map((id) => (
                <th key={id} className="px-3 py-2.5 font-medium">
                  {FACTOR_META[id].short}
                </th>
              ))}
              <th className="px-5 py-2.5 font-medium">Decision</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {peers.map((peer) => (
              <tr key={peer.roomId} className={peer.roomId === currentId ? "bg-accent/5" : undefined}>
                <td className="px-5 py-3 font-medium">
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
                </td>
                <td className="px-3 py-3 font-display text-lg font-semibold tabular-nums">
                  {peer.overall?.score ?? "–"}
                </td>
                {factorIds.map((id) => {
                  const score = peer.overall?.factors.find((factor) => factor.id === id)?.score ?? null;
                  return (
                    <td key={id} className="px-3 py-3">
                      {score === null ? (
                        <span className="text-muted">–</span>
                      ) : (
                        <span className="flex items-center gap-2 tabular-nums">
                          <span className="h-1.5 w-12 rounded-full bg-border" aria-hidden="true">
                            <span
                              className={`block h-full rounded-full ${FACTOR_META[id].bar}`}
                              style={{ width: `${score}%` }}
                            />
                          </span>
                          {score}
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="px-5 py-3 text-muted">
                  {peer.decision ? DECISION_LABELS[peer.decision.outcome] : "Undecided"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DecisionForm({
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
      <h2 className="text-lg font-semibold">Your decision</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {DECISION_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={outcome === option.value}
            onClick={() => setOutcome(option.value)}
            className={`rounded-md border px-4 py-2 text-sm font-medium transition ${
              outcome === option.value
                ? "border-accent bg-accent text-white"
                : "border-border hover:border-accent"
            }`}
          >
            {option.label}
          </button>
        ))}
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
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving ? "Saving…" : "Save decision"}
        </button>
        <span className="text-xs text-muted">
          {decision
            ? `Saved ${formatDateTime(decision.decidedAt)}.`
            : "The scores advise. The decision is yours."}
        </span>
      </div>
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
  const names = new Map(competencies.map((item) => [item.id, item.name]));
  // A heading is shown where the conversation moves to a new plan topic.
  const topicStarts = new Set<number>();
  turns.reduce<string | null>((previous, turn) => {
    if (turn.competencyId === null) return previous;
    if (turn.competencyId !== previous) topicStarts.add(turn.seq);
    return turn.competencyId;
  }, null);

  return (
    <section>
      <h2 className="text-2xl font-semibold">Transcript</h2>
      {turns.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Nothing has been said in this interview yet.</p>
      ) : (
        <ol className={`${cardClasses} mt-4 grid gap-3`}>
          {turns.map((turn) => {
            const topic = turn.competencyId;
            const showTopic = topic !== null && topicStarts.has(turn.seq);
            const offset = offsetFor(turn);
            return (
              <li key={turn.seq} id={`turn-${turn.seq}`} className="scroll-mt-6 target:bg-accent/10">
                {showTopic && (
                  <p className="mb-2 mt-1 border-t border-border pt-3 text-sm font-semibold">
                    {(topic && names.get(topic)) ?? topic}
                  </p>
                )}
                <p className="mb-0.5 flex flex-wrap items-baseline gap-x-2 text-xs">
                  <span
                    className={`font-semibold ${
                      turn.speaker === "candidate" ? "text-candidate" : "text-accent"
                    }`}
                  >
                    {turn.speaker === "candidate" ? "Candidate" : "Interviewer"}
                  </span>
                  <span className="text-muted">
                    turn {turn.seq}
                    {turn.speaker === "candidate" && turn.responseLatencyMs !== null
                      ? `, answered after ${(turn.responseLatencyMs / 1000).toFixed(1)}s`
                      : ""}
                    {turn.interrupted ? ", interrupted" : ""}
                  </span>
                  {offset !== null && offset >= 0 && (
                    <button
                      type="button"
                      onClick={() => onPlay(offset)}
                      className="text-accent hover:underline"
                    >
                      Play from here
                    </button>
                  )}
                </p>
                <p className="text-sm leading-relaxed">{turn.text}</p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

const VOICE_MODE_NAME: Record<VoiceMode, string> = {
  standard: "Standard: one session for the whole interview",
  rolling: "Lower cost: fresh session every minute or two",
};

/** How the voice model was run for this interview and what it cost. */
function VoiceRun({ session }: { session: InterviewRoom }) {
  const cost = estimateVoiceCost(session.outcome);
  if (!session.outcome) return null;
  const items: [string, string][] = [
    ["Voice mode", VOICE_MODE_NAME[session.voiceMode ?? "standard"]],
    ["Model sessions", String(session.outcome.modelSessions ?? 1)],
    ["Length", formatClock(session.outcome.elapsedSeconds)],
    ["Estimated cost", cost ? `$${cost.usd.toFixed(3)}` : "Not reported"],
    [
      "Per hour at this rate",
      cost && cost.usdPerHour !== null ? `$${cost.usdPerHour.toFixed(2)}` : "Too short to say",
    ],
    [
      "Tokens in / out",
      cost ? `${cost.inputTokens.toLocaleString()} / ${cost.outputTokens.toLocaleString()}` : "Not reported",
    ],
  ];
  return (
    <section>
      <SectionHeading
        title="Voice session"
        note="What the live voice model used for this interview, priced at list prices. An estimate, not an invoice; it leaves out the plan and the analysis."
      />
      <dl className={`${cardClasses} mt-4 grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3 lg:grid-cols-6`}>
        {items.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="mt-0.5 font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
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

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
