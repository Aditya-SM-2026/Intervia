import "server-only";

/**
 * Minimal read access to Google Cloud Storage, where candidate recordings are
 * written by LiveKit Egress. No client library: on Google Cloud the service's
 * own identity is used through the metadata server; elsewhere a short-lived
 * token can be supplied in GCS_ACCESS_TOKEN (for example from
 * `gcloud auth print-access-token`).
 */

const METADATA_TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

let cached: { token: string; expiresAt: number } | null = null;

export async function getStorageAccessToken(): Promise<string | null> {
  const fromEnv = process.env.GCS_ACCESS_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  try {
    const response = await fetch(METADATA_TOKEN_URL, {
      headers: { "Metadata-Flavor": "Google" },
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) return null;
    cached = {
      token: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 300) * 1000,
    };
    return cached.token;
  } catch {
    // Not running on Google Cloud and no token supplied.
    return null;
  }
}

export interface StoredObject {
  bucket: string;
  path: string;
}

/** Uploads an object's bytes. Returns true when the upload succeeded. */
export async function uploadStoredObject(
  object: StoredObject,
  body: Uint8Array,
  mimeType: string,
): Promise<boolean> {
  const token = await getStorageAccessToken();
  if (!token) return false;
  const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(
    object.bucket,
  )}/o?uploadType=media&name=${encodeURIComponent(object.path)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": mimeType },
    body: new Blob([body as BlobPart], { type: mimeType }),
  });
  return response.ok;
}

/** Fetches an object's bytes, optionally a byte range (for video seeking). */
export async function fetchStoredObject(
  object: StoredObject,
  options?: { range?: string | null; signal?: AbortSignal },
): Promise<Response | null> {
  const token = await getStorageAccessToken();
  if (!token) return null;
  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(
    object.bucket,
  )}/o/${encodeURIComponent(object.path)}?alt=media`;
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options?.range ? { Range: options.range } : {}),
    },
    signal: options?.signal,
  });
}
