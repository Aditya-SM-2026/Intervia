import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Submission slots for the public application form.
 *
 * Under a burst (a whole college opening one link) the form stays readable for
 * everyone, but a submission is only accepted at the time the server handed
 * out. The time travels with the candidate as a signed ticket, so it cannot be
 * edited, and the page can count down locally without polling.
 */

/** How long after its slot a ticket still works, e.g. a backgrounded tab. */
export const APPLY_SLOT_GRACE_MS = 10 * 60_000;

/** Allow a little early arrival for network and clock rounding. */
const EARLY_TOLERANCE_MS = 1_500;

/** How many submissions per second the drive may accept, from the environment. */
export function applicationSubmitRate(): number {
  const raw = Number(process.env.APPLY_SUBMIT_RATE_PER_SEC);
  if (!Number.isFinite(raw) || raw <= 0) return 1.5;
  return Math.min(10, Math.max(0.5, raw));
}

function slotSecret(): string {
  return (
    process.env.APPLICATION_SLOT_SECRET?.trim() ||
    process.env.INTERNAL_SECRET?.trim() ||
    process.env.AGENT_API_SECRET?.trim() ||
    "intervia-apply-slot-dev"
  );
}

function signature(token: string, slotMs: number): string {
  return createHmac("sha256", slotSecret())
    .update(`${token}.${slotMs}`)
    .digest("base64url");
}

/** The opaque ticket a candidate sends back with their application. */
export function signApplySlot(token: string, slotMs: number): string {
  return `${slotMs}.${signature(token, slotMs)}`;
}

export type ApplySlotCheck =
  | { ok: true; slotMs: number }
  | {
      ok: false;
      reason: "missing" | "invalid" | "early" | "expired";
      retryAfterSeconds?: number;
    };

/** Verifies a ticket for this form token and checks it against the clock. */
export function checkApplySlot(
  token: string,
  ticket: string | null | undefined,
  nowMs = Date.now(),
): ApplySlotCheck {
  if (!ticket) return { ok: false, reason: "missing" };

  const dot = ticket.indexOf(".");
  if (dot <= 0) return { ok: false, reason: "invalid" };

  const slotMs = Number(ticket.slice(0, dot));
  if (!Number.isSafeInteger(slotMs) || slotMs <= 0) {
    return { ok: false, reason: "invalid" };
  }

  const presented = Buffer.from(ticket.slice(dot + 1));
  const expected = Buffer.from(signature(token, slotMs));
  if (
    presented.length !== expected.length ||
    !timingSafeEqual(presented, expected)
  ) {
    return { ok: false, reason: "invalid" };
  }

  if (nowMs + EARLY_TOLERANCE_MS < slotMs) {
    return {
      ok: false,
      reason: "early",
      retryAfterSeconds: Math.max(1, Math.ceil((slotMs - nowMs) / 1000)),
    };
  }
  if (nowMs > slotMs + APPLY_SLOT_GRACE_MS) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, slotMs };
}
