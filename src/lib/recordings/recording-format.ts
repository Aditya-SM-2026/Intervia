export type RecordingFormat = "webm" | "mp4";

export function formatFromMime(mime: string | null | undefined): RecordingFormat {
  return (mime ?? "").toLowerCase().includes("mp4") ? "mp4" : "webm";
}

export function mimeFor(format: RecordingFormat): string {
  return format === "mp4" ? "video/mp4" : "video/webm";
}