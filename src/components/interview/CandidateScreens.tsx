"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { AlertTriangle, Check, Clock, Headphones, LogOut, Mic, ShieldCheck } from "lucide-react";
import type { LiveKitJoinCredentials } from "@/lib/livekit/client";
import { CandidateMessage, CandidateShell, candidateGhostButton, candidatePrimaryButton } from "./CandidateShell";
import { JoinInterviewForm } from "./JoinInterviewForm";

/**
 * The screen a candidate lands on from their invitation: what the interview
 * is on the left, the two steps to join on the right.
 */
export function JoinScreen({
  roomId,
  roomTitle,
  candidateName,
  recruiterName,
  durationMinutes,
  onVerified,
  onProceed,
  startVerified,
}: {
  roomId: string;
  roomTitle: string;
  candidateName: string | null;
  recruiterName: string | null;
  durationMinutes: number;
  onVerified: (credentials: LiveKitJoinCredentials) => void;
  onProceed: (stream: MediaStream) => void;
  startVerified?: boolean;
}) {
  const firstName = candidateName?.split(" ")[0];
  const points = [
    { icon: Clock, text: `About ${durationMinutes} minutes, one spoken conversation` },
    { icon: Headphones, text: "Headphones and a quiet room work best" },
    { icon: ShieldCheck, text: "Recorded, and a person makes the decision" },
  ];
  return (
    <CandidateShell>
      <div className="grid flex-1 items-center gap-10 py-6 lg:grid-cols-[1fr_440px] lg:gap-16">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/80">
            <span className="size-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
            Interview invitation{recruiterName ? ` from ${recruiterName}` : ""}
          </p>
          <h1 className="mt-5 text-balance text-4xl font-semibold leading-[1.05] tracking-[-0.03em] sm:text-5xl">
            {firstName ? `Hi ${firstName}, ready for your ${roomTitle} interview?` : `Your ${roomTitle} interview`}
          </h1>
          <ul className="mt-8 grid gap-3">
            {points.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-white/80">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/10">
                  <Icon className="size-4" aria-hidden />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-3xl bg-surface p-6 text-foreground shadow-[0_40px_100px_-40px_rgba(0,0,0,0.6)] sm:p-8">
          <JoinInterviewForm
            roomId={roomId}
            recruiterName={recruiterName}
            onVerified={onVerified}
            onProceed={onProceed}
            startVerified={startVerified}
          />
        </div>
      </div>
    </CandidateShell>
  );
}

/** A soft pulsing orb, used while the call is being set up. */
export function ConnectingOrb() {
  return (
    <span className="relative grid place-items-center">
      <motion.span
        className="absolute size-28 rounded-full bg-[#4a72f5]/30"
        animate={{ scale: [1, 1.3, 1], opacity: [0.7, 0.1, 0.7] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      />
      <span className="relative grid size-20 place-items-center rounded-full bg-gradient-to-br from-[#6d8dff] to-[#2446d8] shadow-[0_0_50px_rgba(74,114,245,0.6)]">
        <Mic className="size-7 text-white" aria-hidden />
      </span>
    </span>
  );
}

/** After the call: finished, left on purpose, or dropped. */
export function CandidateEndScreen({
  kind,
  candidateName,
  recruiterName,
  failure,
  onRetry,
}: {
  kind: "ended" | "left" | "error";
  candidateName: string | null;
  recruiterName: string | null;
  failure: string | null;
  onRetry: () => void;
}) {
  if (kind === "ended") {
    const firstName = candidateName?.split(" ")[0];
    return (
      <CandidateMessage
        icon={
          <motion.span
            className="grid size-20 place-items-center rounded-full bg-emerald-500 text-white shadow-[0_0_60px_rgba(16,185,129,0.5)]"
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 18 }}
          >
            <Check className="size-9" strokeWidth={2.5} aria-hidden />
          </motion.span>
        }
        title={firstName ? `Thank you, ${firstName}. You're all done.` : "Thank you. You're all done."}
      >
        <p>
          Your interview has been sent{recruiterName ? ` to ${recruiterName}` : ""}, who will be in touch about next steps.
          You can close this page.
        </p>
      </CandidateMessage>
    );
  }

  if (kind === "left") {
    return (
      <CandidateMessage
        icon={
          <span className="grid size-20 place-items-center rounded-full bg-white/10">
            <LogOut className="size-8" aria-hidden />
          </span>
        }
        title="You left the interview"
        actions={
          <button type="button" onClick={onRetry} className={candidatePrimaryButton}>
            Rejoin now
          </button>
        }
      >
        <p>If that was a mistake, rejoin within 2 minutes and it continues exactly where it stopped.</p>
      </CandidateMessage>
    );
  }

  return (
    <CandidateMessage
      icon={
        <span className="grid size-20 place-items-center rounded-full bg-amber-400/15 text-amber-300">
          <AlertTriangle className="size-8" aria-hidden />
        </span>
      }
      title="Let's get you back in"
      actions={
        <>
          <button type="button" onClick={onRetry} className={candidatePrimaryButton}>
            Rejoin
          </button>
          <Link href="/" className={candidateGhostButton}>
            Leave
          </Link>
        </>
      }
    >
      <p role="alert">{failure ?? "Something went wrong. Rejoin to continue."}</p>
    </CandidateMessage>
  );
}
