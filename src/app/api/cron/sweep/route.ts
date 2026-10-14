import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAgent } from "@/lib/auth/guards";
import { runReminderScanOnce } from "@/lib/emails/reminder-scheduler";
import { runInterviewWatchdogOnce } from "@/lib/interviews/watchdog.service";

/**
 * Cron entry point for the background jobs (interview reminders and the
 * interview time-limit watchdog). The in-process timers only tick while a
 * Cloud Run instance is warm, so a scheduler (Cloud Scheduler) calls this
 * every minute: the request itself keeps an instance alive to do the work.
 * Authorised with the agent API secret.
 */
export async function POST(request: NextRequest) {
  const denied = requireAgent(request);
  if (denied) return denied;

  const reminders = await runReminderScanOnce().catch((cause) => {
    console.error("[cron] reminder scan error:", cause);
    return null;
  });
  const closed = await runInterviewWatchdogOnce().catch((cause) => {
    console.error("[cron] watchdog error:", cause);
    return -1;
  });

  return NextResponse.json({ ok: true, reminders, watchdogClosed: closed });
}