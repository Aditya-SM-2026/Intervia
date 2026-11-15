import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAgent } from "@/lib/auth/guards";
import { runReminderScanOnce } from "@/lib/emails/reminder-scheduler";
import { runInterviewWatchdogOnce } from "@/lib/interviews/watchdog.service";
import { jobsQueueEnabled } from "@/lib/jobs/queue";
import { queueSweepJobs } from "@/lib/jobs/sweep";
import { runAutoInviteScanOnce } from "@/lib/roles/auto-invite.service";

/**
 * Cron entry point for the background jobs: interview reminders, the
 * interview time-limit watchdog, automatic invitations, and re-queuing
 * anything the normal path missed. The in-process timer only ticks while a
 * Cloud Run instance is awake, so Cloud Scheduler calls this every minute and
 * the request itself gives the instance CPU to do the work. With the job queue
 * on, the slow parts are queued as jobs so this request stays short.
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

  const jobs = jobsQueueEnabled()
    ? await queueSweepJobs().catch((cause) => {
        console.error("[cron] queueing sweep jobs failed:", cause);
        return null;
      })
    : null;
  const autoInvite = jobsQueueEnabled()
    ? null
    : await runAutoInviteScanOnce().catch((cause) => {
        console.error("[cron] auto-invite scan error:", cause);
        return null;
      });

  return NextResponse.json({ ok: true, reminders, watchdogClosed: closed, jobs, autoInvite });
}