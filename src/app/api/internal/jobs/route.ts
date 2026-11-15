import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { jobSubject, parseJob } from "@/lib/jobs/job.logic";
import { RetryableJobError, runJob } from "@/lib/jobs/run-job";

/**
 * The job queue (Cloud Tasks) calls this for each background job. The work
 * runs inside this request, so it has full CPU until it finishes, and a 5xx
 * makes the queue try again with backoff. Authenticated with the internal
 * secret, never by session cookie.
 */

export const maxDuration = 900;

function authorised(request: NextRequest): boolean {
  const secret = process.env.INTERNAL_SECRET?.trim() || process.env.AGENT_API_SECRET?.trim();
  if (!secret) return false;
  const presented = Buffer.from(request.headers.get("x-internal-secret") ?? "");
  const expected = Buffer.from(secret);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

export async function POST(request: NextRequest) {
  if (!authorised(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Not allowed." } }, { status: 401 });
  }
  const job = parseJob(await request.json().catch(() => null));
  if (!job) {
    // Not retried: the queue drops a task on a 4xx it cannot fix.
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Unknown job." } }, { status: 400 });
  }

  const started = Date.now();
  const retry = request.headers.get("x-cloudtasks-taskretrycount") ?? "0";
  try {
    await runJob(job);
    console.info(`[jobs] ${job.kind} ${jobSubject(job)} done in ${Date.now() - started} ms (attempt ${Number(retry) + 1})`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const kind = error instanceof RetryableJobError ? "will retry" : "failed";
    console.error(`[jobs] ${job.kind} ${jobSubject(job)} ${kind} (attempt ${Number(retry) + 1}): ${message}`);
    return NextResponse.json({ ok: false, error: message.slice(0, 300) }, { status: 500 });
  }
}
