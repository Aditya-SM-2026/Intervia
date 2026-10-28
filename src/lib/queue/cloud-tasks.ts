import "server-only";

/**
 * Enqueues one job for the video analysis worker.
 *
 * Preferred path is Cloud Tasks, which retries with backoff and gives us a
 * dead-letter queue. When TASKS_* env vars are not set (local development),
 * the worker is called directly and the task is treated as best-effort.
 */

interface EnqueueOptions {
  /** Worker endpoint, e.g. https://video-worker-....run.app/analyse */
  url: string;
  payload: unknown;
  /** Shared secret forwarded to the worker. */
  secret: string;
  /** Label shown in Cloud Tasks, e.g. "video-analysis". */
  tag?: string;
}

export async function enqueueHttpTask(options: EnqueueOptions): Promise<boolean> {
  const project = process.env.TASKS_PROJECT?.trim();
  const location = process.env.TASKS_LOCATION?.trim();
  const queue = process.env.TASKS_QUEUE?.trim();
  const body = JSON.stringify(options.payload);

  if (project && location && queue) {
    try {
      const token = await metadataToken();
      if (!token) throw new Error("no metadata token");
      const target = new URL(options.url);
      const response = await fetch(
        `https://cloudtasks.googleapis.com/v2/projects/${project}/locations/${location}/queues/${queue}/tasks`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            task: {
              name: undefined,
              httpRequest: {
                httpMethod: "POST",
                url: options.url,
                headers: {
                  "Content-Type": "application/json",
                  "x-internal-secret": options.secret,
                  "x-worker-tag": options.tag ?? "job",
                },
                body: Buffer.from(body).toString("base64"),
                // Cloud Run requires an identity token for the worker service.
                oidcToken: {
                  serviceAccountEmail:
                    process.env.TASKS_INVOKER_SA?.trim() ||
                    `tasks-invoker@${project}.iam.gserviceaccount.com`,
                  audience: `${target.protocol}//${target.host}`,
                },
              },
            },
          }),
        },
      );
      if (!response.ok) {
        const text = (await response.text()).slice(0, 300);
        console.warn(`[tasks] create failed (${response.status}): ${text}`);
        return false;
      }
      return true;
    } catch (error) {
      console.warn(
        `[tasks] create failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Local development: call the worker directly.
  try {
    const response = await fetch(options.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": options.secret },
      body,
    });
    return response.ok;
  } catch (error) {
    console.warn(
      `[tasks] direct call failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

/** Access token from the Cloud Run metadata server, or null off GCP. */
async function metadataToken(): Promise<string | null> {
  if (process.env.CLOUD_RUN_JOB || process.env.K_SERVICE) {
    try {
      const response = await fetch(
        "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
        { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(3000) },
      );
      if (response.ok) {
        const payload = (await response.json()) as { access_token?: string };
        return payload.access_token ?? null;
      }
    } catch {
      // Fall through to GOOGLE_OAUTH_ACCESS_TOKEN.
    }
  }
  return process.env.GOOGLE_OAUTH_ACCESS_TOKEN?.trim() || null;
}
