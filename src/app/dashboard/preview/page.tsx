import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";

export const metadata: Metadata = {
  title: "Example analysis",
};

/**
 * An example of the candidate analytics with made-up data. Nothing on this
 * page is computed: it shows what a fully analysed interview looks like, since
 * a real one needs a recording and a scoring run. The real page is
 * components/dashboard/InterviewDetailView.tsx.
 */

interface Factor {
  id: string;
  name: string;
  score: number;
  weight: number;
  explains: string;
  basis: string;
  tone: "accent" | "candidate" | "warn";
}

const FACTORS: Factor[] = [
  {
    id: "answers",
    name: "Answer quality",
    score: 78,
    weight: 45,
    explains: "How well each planned question was answered, against the rating scale for the role.",
    basis: "4 of 5 topics scored",
    tone: "accent",
  },
  {
    id: "resume",
    name: "Resume match",
    score: 84,
    weight: 20,
    explains: "Whether what the candidate said agrees with the projects and claims on their resume.",
    basis: "6 claims checked, 1 not supported",
    tone: "accent",
  },
  {
    id: "authenticity",
    name: "Own answers",
    score: 71,
    weight: 20,
    explains: "Signs in the wording and timing that answers were the candidate's own and not read or generated.",
    basis: "2 signals to review",
    tone: "candidate",
  },
  {
    id: "video",
    name: "On-camera behaviour",
    score: 62,
    weight: 15,
    explains: "Whether the candidate kept returning to the same spot off the screen while answering, and anything else worth watching.",
    basis: "4 of 9 answers on the same spot",
    tone: "warn",
  },
];

const OVERALL = Math.round(
  FACTORS.reduce((sum, factor) => sum + factor.score * factor.weight, 0) /
    FACTORS.reduce((sum, factor) => sum + factor.weight, 0),
);

const ANSWERS = [
  {
    topic: "Zero-downtime migrations",
    question: "Walk me through a migration you led where downtime was not an option.",
    score: 4,
    summary: "Described a dual-write cutover with nightly reconciliation and a clear switch criterion.",
    quote: "only switched once the mismatch rate had been zero for five days",
    missing: "Did not say what would have triggered a rollback.",
  },
  {
    topic: "Data integrity under retries",
    question: "Tell me about a time duplicate processing carried real financial risk.",
    score: 5,
    summary: "Explained idempotency keys enforced in the same transaction as the ledger entry.",
    quote: "a retry hits the constraint and returns the original result instead of writing twice",
    missing: null,
  },
  {
    topic: "Incident ownership",
    question: "Tell me about a production incident you owned from page to post-mortem.",
    score: 3,
    summary: "Gave a clear runbook, but the example was a team effort and their own part was thin.",
    quote: "we froze payouts for the affected accounts and replayed the event log",
    missing: "What they personally decided during the incident.",
  },
  {
    topic: "Working with stakeholders",
    question: "Tell me about a disagreement with a product partner and how it ended.",
    score: 4,
    summary: "Used evidence from past incidents to change a launch decision.",
    quote: "I showed him two real duplicate-charge incidents from the logs",
    missing: null,
  },
  {
    topic: "Mentoring",
    question: "How have you helped a less experienced engineer grow?",
    score: null,
    summary: "The interview ran out of time before this topic.",
    quote: null,
    missing: null,
  },
];

const RESUME_CLAIMS = [
  {
    claim: "Led the rebuild of the ledger service as an append-only event log",
    verdict: "Confirmed",
    note: "Explained the design, the migration and the reconciliation job in detail.",
  },
  {
    claim: "Cut p99 latency from 400 ms to 90 ms",
    verdict: "Confirmed",
    note: "Gave the same figures unprompted when describing the cutover.",
  },
  {
    claim: "Introduced idempotency keys for charge APIs",
    verdict: "Confirmed",
    note: "Described the unique-constraint approach and why it was chosen.",
  },
  {
    claim: "5 years of Go in production",
    verdict: "Partly supported",
    note: "Examples were mostly Python; Go came up once, without detail.",
  },
  {
    claim: "Operates Kafka at scale",
    verdict: "Not supported",
    note: "When asked about consumer lag, described it only in general terms.",
  },
  {
    claim: "Mentored four engineers",
    verdict: "Not discussed",
    note: "The interview did not reach this.",
  },
];

const TEXT_SIGNALS = [
  {
    signal: "Polished overview, then no specifics when probed",
    where: "Turns 14 to 17",
    detail: "A fluent three-part answer on Kafka was followed by a vague reply to the first follow-up.",
  },
  {
    signal: "Long answer started almost instantly",
    where: "Turn 22",
    detail: "A 70-second structured answer began 0.4 s after the question; the candidate's usual pause was 2.1 s.",
  },
];

const VIDEO_MOMENTS = [
  { at: "06:12", position: 21, label: "Answer given looking down and to the left; looked straight ahead while listening" },
  { at: "11:40", position: 39, label: "Same lower-left spot held for the whole answer, 41 s" },
  { at: "19:05", position: 64, label: "Same lower-left spot, with eyes moving line by line as when reading" },
];

const COMPARE = [
  { name: "Asha Rao", overall: 76, scores: [78, 84, 71, 62], decision: "Undecided", current: true },
  { name: "Daniel Okafor", overall: 81, scores: [80, 88, 86, 74], decision: "Advanced", current: false },
  { name: "Meera Iyer", overall: 64, scores: [61, 70, 58, 72], decision: "On hold", current: false },
  { name: "Tomás Rivera", overall: 49, scores: [52, 60, 31, 40], decision: "Rejected", current: false },
];

const TONE_BAR: Record<Factor["tone"], string> = {
  accent: "bg-accent",
  candidate: "bg-candidate",
  warn: "bg-amber-500",
};

const VERDICT_STYLE: Record<string, string> = {
  Confirmed: "text-candidate",
  "Partly supported": "text-amber-600 dark:text-amber-400",
  "Not supported": "text-red-600 dark:text-red-400",
  "Not discussed": "text-muted",
};

const card = "rounded-2xl border border-border bg-surface p-5 sm:p-6";

export default function AnalyticsPreviewPage() {
  return (
    <AppShell current="interviews" wide>
      <p className="mb-5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
        An example with made-up data, showing what a full analysis looks like when an
        interview has been recorded and scored on all four factors.{" "}
        <Link href="/dashboard" className="font-medium text-accent hover:underline">
          Back to real interviews
        </Link>
      </p>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Asha Rao</h1>
          <p className="mt-0.5 text-muted">Senior Backend Engineer, 28 of 30 minutes, 12 Oct 2026</p>
        </div>
        <div className="flex gap-2">
          {["Advance", "Hold", "Reject"].map((label) => (
            <span key={label} className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium">
              {label}
            </span>
          ))}
        </div>
      </header>

      {/* Overall score and how the four factors add up to it. */}
      <section className={`${card} mt-6`}>
        <div className="grid gap-8 lg:grid-cols-[14rem_1fr]">
          <div>
            <p className="text-sm font-semibold">Overall</p>
            <p className="mt-1 font-display text-7xl font-semibold leading-none tabular-nums">
              {OVERALL}
              <span className="text-xl font-normal text-muted"> of 100</span>
            </p>
            <p className="mt-3 text-sm text-muted">
              A weighted average of the four scores on the right. It advises; the decision is yours.
            </p>
            <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-border" aria-hidden="true">
              {FACTORS.map((factor) => (
                <span
                  key={factor.id}
                  className={TONE_BAR[factor.tone]}
                  style={{ width: `${(factor.score * factor.weight) / 100}%`, opacity: 0.55 + factor.weight / 100 }}
                />
              ))}
            </div>
            <p className="mt-1.5 text-xs text-muted">Each colour is one factor&apos;s share of the total.</p>
          </div>

          <ul className="grid gap-5">
            {FACTORS.map((factor) => (
              <li key={factor.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <a href={`#${factor.id}`} className="font-semibold hover:text-accent">
                    {factor.name}
                  </a>
                  <span className="text-sm tabular-nums">
                    <span className="text-lg font-semibold">{factor.score}</span>
                    <span className="text-muted"> of 100, counts {factor.weight}%</span>
                  </span>
                </div>
                <div className="mt-1.5 h-2 rounded-full bg-border" aria-hidden="true">
                  <div className={`h-full rounded-full ${TONE_BAR[factor.tone]}`} style={{ width: `${factor.score}%` }} />
                </div>
                <p className="mt-1.5 text-sm text-muted">
                  {factor.explains} <span className="text-foreground">{factor.basis}.</span>
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 1. Answer quality */}
      <section id="answers" className="mt-10 scroll-mt-6">
        <h2 className="text-2xl font-semibold">Answer quality</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          One row per planned question. Each score is from 1 to 5 against the rating scale for
          this role, and quotes the candidate.
        </p>
        <ol className={`${card} mt-4 divide-y divide-border !p-0`}>
          {ANSWERS.map((answer) => (
            <li key={answer.topic} className="grid gap-x-6 gap-y-2 p-5 md:grid-cols-[1fr_9rem]">
              <div>
                <h3 className="font-semibold">{answer.topic}</h3>
                <p className="mt-0.5 text-sm text-muted">{answer.question}</p>
                <p className="mt-2 text-sm">{answer.summary}</p>
                {answer.quote && (
                  <p className="mt-2 border-l-2 border-candidate pl-3 text-sm italic">“{answer.quote}”</p>
                )}
                {answer.missing && (
                  <p className="mt-2 text-sm text-muted">Missing: {answer.missing}</p>
                )}
              </div>
              <div className="md:text-right">
                {answer.score === null ? (
                  <span className="text-sm text-muted">Not reached</span>
                ) : (
                  <span className="inline-flex items-center gap-2 text-sm font-semibold tabular-nums">
                    <span className="flex gap-1" aria-hidden="true">
                      {[1, 2, 3, 4, 5].map((step) => (
                        <span
                          key={step}
                          className={`h-2 w-4 rounded-sm ${step <= (answer.score ?? 0) ? "bg-accent" : "bg-border"}`}
                        />
                      ))}
                    </span>
                    {answer.score} of 5
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* 2. Resume match */}
      <section id="resume" className="mt-10 scroll-mt-6">
        <h2 className="text-2xl font-semibold">Resume match</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Each claim taken from the resume, and whether the candidate&apos;s own account in the
          interview backs it up.
        </p>
        <div className={`${card} mt-4 !p-0`}>
          <div className="hidden grid-cols-[minmax(0,1.3fr)_9rem_minmax(0,1.5fr)] gap-4 border-b border-border px-5 py-2.5 text-xs font-medium text-muted md:grid">
            <span>On the resume</span>
            <span>In the interview</span>
            <span>Why</span>
          </div>
          <ul className="divide-y divide-border">
            {RESUME_CLAIMS.map((row) => (
              <li
                key={row.claim}
                className="grid gap-x-4 gap-y-1 px-5 py-3.5 text-sm md:grid-cols-[minmax(0,1.3fr)_9rem_minmax(0,1.5fr)]"
              >
                <span>{row.claim}</span>
                <span className={`font-semibold ${VERDICT_STYLE[row.verdict]}`}>{row.verdict}</span>
                <span className="text-muted">{row.note}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 3. Own answers (text) */}
      <section id="authenticity" className="mt-10 scroll-mt-6">
        <h2 className="text-2xl font-semibold">Own answers</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Patterns in the wording and timing of answers that can indicate reading from, or
          being prompted by, an AI tool. Each one links to the turns it is based on.
        </p>
        <ul className="mt-4 grid gap-3 md:grid-cols-2">
          {TEXT_SIGNALS.map((item) => (
            <li key={item.signal} className={card}>
              <p className="font-semibold">{item.signal}</p>
              <p className="mt-0.5 text-sm text-accent">{item.where}</p>
              <p className="mt-2 text-sm text-muted">{item.detail}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* 4. On-camera behaviour (video) */}
      <section id="video" className="mt-10 scroll-mt-6">
        <h2 className="text-2xl font-semibold">On-camera behaviour</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          From the recording of the candidate&apos;s own camera. A single look away counts for
          nothing; what is measured is whether the candidate kept returning to the same spot off
          the screen while answering, and not while listening.
        </p>
        <div className={`${card} mt-4 grid gap-6 lg:grid-cols-[1fr_1.1fr]`}>
          <div>
            <div className="grid aspect-video place-items-center rounded-xl bg-[#0e1420] text-sm text-[#8d98b3]">
              Candidate recording plays here
            </div>
            <div className="relative mt-4 h-2 rounded-full bg-border">
              {VIDEO_MOMENTS.map((moment) => (
                <span
                  key={moment.at}
                  title={`${moment.at} ${moment.label}`}
                  className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-amber-500"
                  style={{ left: `${moment.position}%` }}
                />
              ))}
            </div>
            <div className="mt-1.5 flex justify-between text-xs tabular-nums text-muted">
              <span>0:00</span>
              <span>28:10</span>
            </div>
          </div>
          <div>
            <dl className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <dt className="text-xs text-muted">Answers on the same spot</dt>
                <dd className="text-lg font-semibold tabular-nums">4 of 9</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Left the interview tab</dt>
                <dd className="text-lg font-semibold tabular-nums">Once, 6 s</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Other people seen</dt>
                <dd className="text-lg font-semibold">None</dd>
              </div>
            </dl>
            <ul className="mt-5 divide-y divide-border border-y border-border text-sm">
              {VIDEO_MOMENTS.map((moment) => (
                <li key={moment.at} className="flex gap-4 py-2.5">
                  <span className="w-12 shrink-0 font-semibold tabular-nums text-accent">{moment.at}</span>
                  <span>{moment.label}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">
              Everyone looks away to think. These are clips to watch, not proof.
            </p>
          </div>
        </div>
      </section>

      {/* Comparing candidates for the same role */}
      <section className="mt-10">
        <h2 className="text-2xl font-semibold">Candidates for this role</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Everyone interviewed for Senior Backend Engineer, on the same plan and the same scale.
        </p>
        <div className={`${card} mt-4 overflow-x-auto !p-0`}>
          <table className="w-full min-w-[42rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium text-muted">
                <th className="px-5 py-2.5 font-medium">Candidate</th>
                <th className="px-3 py-2.5 font-medium">Overall</th>
                {FACTORS.map((factor) => (
                  <th key={factor.id} className="px-3 py-2.5 font-medium">
                    {factor.name}
                  </th>
                ))}
                <th className="px-5 py-2.5 font-medium">Decision</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {COMPARE.map((row) => (
                <tr key={row.name} className={row.current ? "bg-accent/5" : undefined}>
                  <td className="px-5 py-3 font-medium">
                    {row.name}
                    {row.current && <span className="ml-2 text-xs font-normal text-muted">this interview</span>}
                  </td>
                  <td className="px-3 py-3 font-display text-lg font-semibold tabular-nums">{row.overall}</td>
                  {row.scores.map((score, index) => (
                    <td key={index} className="px-3 py-3">
                      <span className="flex items-center gap-2 tabular-nums">
                        <span className="h-1.5 w-12 rounded-full bg-border" aria-hidden="true">
                          <span
                            className={`block h-full rounded-full ${TONE_BAR[FACTORS[index].tone]}`}
                            style={{ width: `${score}%` }}
                          />
                        </span>
                        {score}
                      </span>
                    </td>
                  ))}
                  <td className="px-5 py-3 text-muted">{row.decision}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
