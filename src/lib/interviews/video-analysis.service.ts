import "server-only";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { spawn } from "node:child_process";
import { isOminibotConfigured, ominibotChat } from "@/lib/ai/ominibot";
import { getGeminiTextConfig } from "@/lib/config/env";
import {
  ffmpegPath,
  formatFromMime,
  mediaDurationSeconds,
  mimeFor,
  playableRecordingFile,
  recordingSize,
  runFfmpeg,
  waitForRecordingFinished,
  type LocalRecording,
} from "@/lib/recordings/store";
import { fetchStoredObject } from "@/lib/storage/gcs";
import { buildMergedRecording } from "@/lib/recordings/merge";
import { hasRecording, listRecordings, type LocalRecordingRef, type RecordingRef } from "./recording-refs";
import type { InterviewEvent, InterviewTurn } from "./interview.types";
import { gazePattern, MIN_ANSWERS_FOR_PATTERN, videoBehaviourScore } from "./scoring";
import type {
  AnswerGaze,
  GazeDirection,
  GazePattern,
  VideoBehaviour,
  VideoMoment,
  VideoMomentKind,
} from "./scorecard.types";

/**
 * On-camera analysis of the candidate's recording.
 *
 * The question is not "did the candidate ever look away" (everyone does when
 * thinking). It is whether they keep returning to the same spot off the
 * screen while answering, and not while listening: the look of someone
 * reading from a second screen, a phone propped beside the laptop, or a
 * helper window.
 *
 * The recording is cut into short low-resolution clips. For each clip a
 * video-capable model (Ominibot, with Gemini as the fallback) is told when
 * each question and answer happens and reports, per answer, where the eyes
 * were while listening and while answering, plus anything else worth a look
 * (another person, a phone, leaving the picture). It only describes. The
 * pattern across answers and the score are then computed in code
 * (scoring.ts). Findings are prompts to watch a clip, not conclusions.
 */

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const SEGMENT_SECONDS = 150;
const SEGMENT_TIMEOUT_MS = 180_000;
const MAX_PARALLEL_SEGMENTS = 3;
/** Without ffmpeg the whole file is sent as one clip, if it is small enough. */
const MAX_WHOLE_FILE_BYTES = 14 * 1024 * 1024;
const MAX_GCS_BYTES = 600 * 1024 * 1024;

/**
 * Where gaze description comes from. "local" runs the OpenCV + MediaPipe
 * analyser in video-analysis/analyse.py on this machine (no model call);
 * "llm" is the original vision-model path; "auto" (the default) tries the
 * local analyser first and falls back to the model when it is unavailable
 * or fails. VIDEO_ANALYSIS_PYTHON overrides the python command.
 */
const LOCAL_ANALYSER = path.resolve(process.cwd(), "video-analysis", "analyse.py");
/** The local analyser runs on one shared vCPU; it needs more wall time. */
const LOCAL_TIMEOUT_MS = 600_000;

function videoAnalysisProvider(): "local" | "llm" | "auto" {
  const value = (process.env.VIDEO_ANALYSIS_PROVIDER ?? "auto").trim().toLowerCase();
  return value === "local" || value === "llm" ? (value as "local" | "llm") : "auto";
}

let localAnalyserUsable: boolean | null = null;
/** Why the local analyser was rejected, shown in the report when it fails. */
let localAnalyserLastError: string | null = null;

/** Cheap check that python and the analyser are runnable at all. */
async function canRunLocalAnalyser(): Promise<boolean> {
  if (localAnalyserUsable !== null) return localAnalyserUsable;
  localAnalyserUsable = await new Promise<boolean>((resolve) => {
    const child = spawn(videoAnalysisPython(), ["--version"], { stdio: "ignore" });
    child.on("error", (error) => {
      localAnalyserLastError = error.message;
      resolve(false);
    });
    child.on("exit", (code) => {
      if (code !== 0) localAnalyserLastError = `python --version exited ${code}`;
      resolve(code === 0);
    });
  });
  return localAnalyserUsable;
}

function videoAnalysisPython(): string {
  return (process.env.VIDEO_ANALYSIS_PYTHON ?? "python").trim() || "python";
}

const KINDS: VideoMomentKind[] = [
  "looking_away",
  "reading",
  "other_person",
  "second_device",
  "left_frame",
  "other",
];

const DIRECTIONS: GazeDirection[] = [
  "centre",
  "left",
  "right",
  "up",
  "down",
  "up_left",
  "up_right",
  "down_left",
  "down_right",
  "unclear",
];

const direction = z
  .string()
  .transform((value) => value.trim().toLowerCase().replace(/[\s-]+/g, "_").replace("center", "centre"))
  .pipe(z.enum(DIRECTIONS as [GazeDirection, ...GazeDirection[]]))
  .catch("unclear");

const segmentSchema = z.object({
  faceVisible: z.boolean().catch(true),
  answers: z
    .array(
      z.object({
        id: z.coerce.number().int(),
        whileListening: direction,
        whileAnswering: direction,
        steady: z.boolean().catch(false),
        reading: z.boolean().catch(false),
        note: z.string().trim().max(300).catch(""),
      }),
    )
    .max(80)
    .catch([]),
  moments: z
    .array(
      z.object({
        at: z.string(),
        durationSeconds: z.coerce.number().min(0).max(3600).catch(5),
        kind: z.enum(KINDS as [VideoMomentKind, ...VideoMomentKind[]]).catch("other"),
        description: z.string().trim().max(400),
      }),
    )
    .max(30)
    .catch([]),
});

type SegmentReport = z.infer<typeof segmentSchema>;

const PROMPT_HEAD = [
  "This clip is part of a recording of a job candidate's own camera during a remote spoken interview. The interviewer is an AI voice shown on the candidate's screen; the candidate is the only person who should be in the picture.",
  "You are helping a human reviewer decide which parts are worth watching. Describe only what is visible. Do not judge the candidate.",
  "",
  "Directions are as seen in the picture (the viewer's left and right): centre, left, right, up, down, up_left, up_right, down_left, down_right. \"centre\" means looking straight towards the camera or the screen just around it. Use \"unclear\" when the eyes cannot be made out (face not visible, too dark, glasses glare, eyes closed).",
].join("\n");

const PROMPT_TAIL = [
  "For each answer listed above, report:",
  "- `id`: the answer's number;",
  "- `whileListening`: where the eyes mostly point while the question before it is being asked;",
  "- `whileAnswering`: where the eyes mostly point while the candidate is speaking the answer;",
  "- `steady`: true only if the eyes stay on that one spot for most of the answer, returning to it after any glance; false if the gaze wanders naturally or keeps coming back to the camera;",
  "- `reading`: true only if the eyes move steadily in small left-to-right sweeps, line by line, as when reading text;",
  "- `note`: one short factual sentence, or an empty string.",
  "",
  "Also list `moments` a reviewer should watch, if any, each with `at` (mm:ss from the start of this clip), `durationSeconds`, `kind` and a one-sentence factual `description`:",
  "- other_person: another person visible, or the candidate clearly turning to listen to someone;",
  "- second_device: a phone or second screen the candidate picks up or looks at;",
  "- left_frame: the candidate leaves the picture;",
  "- other: anything else clearly relevant (for example an earpiece being adjusted).",
  "Do not list ordinary looking away as a moment; that is covered by the answers.",
  "",
  "Set `faceVisible` to false if no face can be seen in the clip.",
  "Do not comment on appearance, emotion, nervousness, accent, ethnicity, gender, age, disability or surroundings, and do not say whether the candidate cheated.",
  "Reply with a single JSON object: { faceVisible, answers: [{ id, whileListening, whileAnswering, steady, reading, note }], moments: [{ at, durationSeconds, kind, description }] }.",
].join("\n");

function result(
  status: VideoBehaviour["status"],
  reason: string | null,
  extra?: Partial<VideoBehaviour>,
): VideoBehaviour {
  return {
    status,
    score: null,
    attentionPercent: null,
    moments: [],
    summary: "",
    model: null,
    reason,
    answers: [],
    pattern: null,
    durationSeconds: null,
    ...extra,
  };
}

// --- which recording ---------------------------------------------------------

export type { RecordingRef } from "./recording-refs";
export { hasRecording, listRecordings } from "./recording-refs";

/**
 * The recording to play and analyse. A candidate who drops and rejoins leaves
 * more than one file; the longest is used.
 */
export async function pickRecording(events: readonly InterviewEvent[]): Promise<RecordingRef | null> {
  const all = listRecordings(events);
  if (all.length <= 1) return all[0] ?? null;
  // A candidate who dropped and rejoined left several segments. When the
  // local pieces are all present, serve one merged video (black-padded over
  // the gap) instead of just the longest segment.
  const localRefs = all.filter(
    (ref): ref is Extract<RecordingRef, { kind: "local" }> => ref.kind === "local",
  );
  const unique = new Map<string, { recording: LocalRecordingRef; startedAt: string }>();
  for (const ref of localRefs) {
    const existing = unique.get(ref.recording.recordingId);
    if (!existing || ref.startedAt < existing.startedAt) {
      unique.set(ref.recording.recordingId, { recording: ref.recording, startedAt: ref.startedAt });
    }
  }
  if (unique.size >= 2) {
    const merged = await buildMergedRecording(
      localRefs[0].recording.roomId,
      [...unique.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
      events,
    );
    if (merged) return merged;
  }
  let best: { ref: RecordingRef; size: number } | null = null;
  for (const ref of all) {
    const size = ref.kind === "local" ? await recordingSize(ref.recording) : 1;
    if (!best || size > best.size) best = { ref, size };
  }
  return best?.ref ?? null;
}

// --- analysis ----------------------------------------------------------------

interface TimedAnswer {
  turnSeq: number;
  /** Seconds into the recording. */
  start: number;
  end: number;
  questionStart: number;
}

/** Candidate answers placed on the recording's clock. */
function timedAnswers(turns: readonly InterviewTurn[], recordingStartMs: number): TimedAnswer[] {
  const answers: TimedAnswer[] = [];
  let questionStartMs: number | null = null;
  for (const turn of turns) {
    const started = turn.startedAt ? Date.parse(turn.startedAt) : Number.NaN;
    const ended = turn.endedAt ? Date.parse(turn.endedAt) : Number.NaN;
    if (!Number.isFinite(started)) continue;
    if (turn.speaker === "interviewer") {
      questionStartMs = started;
      continue;
    }
    const start = (started - recordingStartMs) / 1000;
    const end = ((Number.isFinite(ended) ? ended : started) - recordingStartMs) / 1000;
    if (end <= 0) continue;
    answers.push({
      turnSeq: turn.seq,
      start: Math.max(0, start),
      end: Math.max(start, end),
      questionStart:
        questionStartMs === null
          ? Math.max(0, start - 8)
          : Math.max(0, (questionStartMs - recordingStartMs) / 1000),
    });
    questionStartMs = null;
  }
  return answers;
}

interface Segment {
  index: number;
  /** Seconds into the recording at which this clip starts. */
  offset: number;
  file: string;
  mimeType: string;
}

export async function analyseCandidateVideo(
  events: readonly InterviewEvent[],
  turns: readonly InterviewTurn[],
  tab: { hiddenCount: number; hiddenSeconds: number },
): Promise<VideoBehaviour> {
  const recording = await pickRecording(events);
  if (!recording) {
    return result("no_recording", "This interview was not recorded, so there is no video to analyse.");
  }
  const provider = videoAnalysisProvider();
  localAnalyserLastError = null;
  const localFirst = provider !== "llm" && (await canRunLocalAnalyser());
  if (provider === "local" && !localFirst) {
    return result(
      "not_configured",
      `The local analyser is unavailable on this server${localAnalyserLastError ? `: ${localAnalyserLastError}` : " (python check failed)."}`,
    );
  }
  if (!isOminibotConfigured() && !getGeminiTextConfig() && !(provider === "local" || (provider === "auto" && localFirst))) {
    return result("not_configured", "No video analysis model is configured.");
  }

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "intervia-video-"));
  try {
    const source = await sourceFile(recording, workDir);
    if ("reason" in source) return result(source.status, source.reason);

    const durationSeconds = ffmpegPath() ? await mediaDurationSeconds(source.file) : null;
    const segments = await cutSegments(source.file, source.mimeType, workDir);
    if (segments.length === 0) return result("failed", "The recording could not be prepared for analysis.");

    const answers = timedAnswers(turns, Date.parse(recording.startedAt));
    const reports = await mapLimited(segments, MAX_PARALLEL_SEGMENTS, (segment) =>
      describeSegment(segment, answers),
    );
    const done = reports.filter((report): report is SegmentResult => report !== null);
    if (done.length === 0) {
      return result(
        "failed",
        localAnalyserLastError
          ? `The video analysis did not complete: ${localAnalyserLastError}`
          : "The video analysis did not complete. Regenerate to try again.",
      );
    }

    const observed: AnswerGaze[] = [];
    const moments: VideoMoment[] = [];
    for (const { segment, report, assigned } of done) {
      for (const item of report.answers) {
        const answer = assigned.get(item.id);
        if (!answer) continue; // The model named an answer that is not in this clip.
        observed.push({
          turnSeq: answer.turnSeq,
          atSeconds: Math.round(answer.start),
          durationSeconds: Math.round(answer.end - answer.start),
          whileListening: item.whileListening,
          whileAnswering: item.whileAnswering,
          steady: item.steady,
          reading: item.reading,
          note: item.note,
        });
      }
      for (const moment of report.moments) {
        const at = parseClock(moment.at);
        if (!Number.isFinite(at)) continue;
        moments.push({
          atSeconds: Math.round(segment.offset + at),
          durationSeconds: Math.round(moment.durationSeconds),
          kind: moment.kind,
          description: moment.description,
        });
      }
    }
    observed.sort((a, b) => a.atSeconds - b.atSeconds);
    moments.sort((a, b) => a.atSeconds - b.atSeconds);

    const faceSeen = done.some(({ report }) => report.faceVisible);
    const pattern = gazePattern(observed);
    const enough = faceSeen && pattern.answersObserved >= MIN_ANSWERS_FOR_PATTERN;
    const partial = done.length < segments.length;
    const model = [...new Set(done.map((item) => item.model))].join(", ");

    return {
      status: "analysed",
      // With no face, or too few answers to judge, there is nothing to score:
      // the factor is left out rather than shown as a clean 100.
      score: enough ? videoBehaviourScore(moments, tab, pattern) : null,
      attentionPercent:
        pattern.answersObserved === 0
          ? null
          : Math.round(
              (100 * (pattern.answersObserved - pattern.sameSpotAnswers)) / pattern.answersObserved,
            ),
      moments,
      summary: summarise(pattern, moments, faceSeen),
      model,
      reason: !faceSeen
        ? "No face could be seen in the recording, so on-camera behaviour was not scored."
        : !enough
          ? "Too few answers could be judged on camera to score a pattern."
          : partial
            ? "Part of the recording could not be analysed; the result covers the rest."
            : null,
      answers: observed,
      pattern,
      durationSeconds: durationSeconds === null ? null : Math.round(durationSeconds),
    };
  } catch (error) {
    console.error(
      `[video] analysis failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return result("failed", "The video analysis did not complete. Regenerate to try again.");
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

const DIRECTION_WORDS: Record<GazeDirection, string> = {
  centre: "straight ahead",
  left: "to the left of the picture",
  right: "to the right of the picture",
  up: "above the camera",
  down: "below the camera",
  up_left: "up and to the left of the picture",
  up_right: "up and to the right of the picture",
  down_left: "down and to the left of the picture",
  down_right: "down and to the right of the picture",
  unclear: "somewhere that could not be made out",
};

export function describeDirection(direction: GazeDirection): string {
  return DIRECTION_WORDS[direction];
}

/** Two factual sentences, written from the computed pattern, not by a model. */
function summarise(pattern: GazePattern, moments: readonly VideoMoment[], faceSeen: boolean): string {
  if (!faceSeen) return "No face could be seen in the recording.";
  const parts: string[] = [];
  if (pattern.answersObserved === 0) {
    parts.push("No answer was long and clear enough on camera to judge where the candidate was looking.");
  } else if (pattern.direction && pattern.sameSpotAnswers >= 2) {
    parts.push(
      `During ${pattern.sameSpotAnswers} of ${pattern.answersObserved} answers the candidate's eyes were held on the same spot, ${DIRECTION_WORDS[pattern.direction]}` +
        (pattern.listeningDirection && pattern.listeningDirection !== pattern.direction
          ? `, while they mostly looked ${DIRECTION_WORDS[pattern.listeningDirection]} when listening.`
          : "."),
    );
  } else {
    parts.push(
      `Across ${pattern.answersObserved} answers the candidate did not keep returning to one spot away from the screen.`,
    );
  }
  if (pattern.readingAnswers > 0) {
    parts.push(
      `Reading-like eye movement was seen in ${pattern.readingAnswers} answer${pattern.readingAnswers === 1 ? "" : "s"}.`,
    );
  }
  if (moments.length > 0) {
    parts.push(`${moments.length} other moment${moments.length === 1 ? " is" : "s are"} marked to watch.`);
  }
  return parts.join(" ");
}

// --- preparing the video -------------------------------------------------------

type Source =
  | { file: string; mimeType: string }
  | { status: VideoBehaviour["status"]; reason: string };

async function sourceFile(recording: RecordingRef, workDir: string): Promise<Source> {
  if (recording.kind === "local") {
    await waitForRecordingFinished(recording.recording);
    const file = await playableRecordingFile(recording.recording);
    if (!file) return { status: "failed", reason: "The recording is empty." };
    return { file, mimeType: mimeFor(recording.recording.format) };
  }

  const stored = await fetchStoredObject(recording.object, {
    signal: AbortSignal.timeout(SEGMENT_TIMEOUT_MS),
  });
  if (!stored) {
    return { status: "not_configured", reason: "The recording storage cannot be read from this server." };
  }
  if (!stored.ok) {
    return {
      status: "failed",
      reason: `The recording could not be read (storage returned ${stored.status}).`,
    };
  }
  const bytes = new Uint8Array(await stored.arrayBuffer());
  if (bytes.byteLength === 0) return { status: "failed", reason: "The recording is empty." };
  if (bytes.byteLength > MAX_GCS_BYTES) {
    return { status: "failed", reason: "The recording is too large to analyse." };
  }
  const file = path.join(workDir, "source.mp4");
  await fs.writeFile(file, bytes);
  return { file, mimeType: "video/mp4" };
}

/**
 * Cuts the recording into short, small, silent clips: two frames a second is
 * plenty to see where someone is looking, and keeps each request small.
 */
async function cutSegments(file: string, mimeType: string, workDir: string): Promise<Segment[]> {
  if (!ffmpegPath()) {
    const size = (await fs.stat(file)).size;
    if (size > MAX_WHOLE_FILE_BYTES) return [];
    return [{ index: 0, offset: 0, file, mimeType }];
  }
  await runFfmpeg([
    "-y",
    "-i",
    file,
    "-an",
    "-vf",
    "fps=2,scale=640:-2",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "30",
    "-pix_fmt",
    "yuv420p",
    "-force_key_frames",
    `expr:gte(t,n_forced*${SEGMENT_SECONDS})`,
    "-f",
    "segment",
    "-segment_time",
    String(SEGMENT_SECONDS),
    "-reset_timestamps",
    "1",
    path.join(workDir, "clip-%03d.mp4"),
  ]);
  const names = (await fs.readdir(workDir)).filter((name) => /^clip-\d+\.mp4$/.test(name)).sort();
  return names.map((name, index) => ({
    index,
    offset: index * SEGMENT_SECONDS,
    file: path.join(workDir, name),
    mimeType: "video/mp4",
  }));
}

// --- asking the model ----------------------------------------------------------

interface SegmentResult {
  segment: Segment;
  report: SegmentReport;
  /** The answers this clip was asked about, by the number given in the prompt. */
  assigned: Map<number, TimedAnswer>;
  model: string;
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

async function describeSegment(
  segment: Segment,
  answers: readonly TimedAnswer[],
): Promise<SegmentResult | null> {
  const from = segment.offset;
  const to = segment.offset + SEGMENT_SECONDS;
  // An answer belongs to the clip that holds its middle.
  const assigned = new Map<number, TimedAnswer>();
  const lines: string[] = [];
  for (const answer of answers) {
    const middle = (answer.start + answer.end) / 2;
    if (middle < from || middle >= to) continue;
    const id = assigned.size + 1;
    assigned.set(id, answer);
    lines.push(
      `Answer ${id}: question asked ${clock(Math.max(from, answer.questionStart) - from)}-${clock(Math.max(from, answer.start) - from)}, candidate answers ${clock(Math.max(from, answer.start) - from)}-${clock(Math.min(to, answer.end) - from)}`,
    );
  }
  const schedule =
    lines.length > 0
      ? `Times in this clip (mm:ss from its start):\n${lines.join("\n")}`
      : "No answers fall within this clip; return an empty `answers` list and only report moments.";
  const prompt = `${PROMPT_HEAD}\n\n${schedule}\n\n${PROMPT_TAIL}`;

  const bytes = await fs.readFile(segment.file);
  const base64 = bytes.toString("base64");

  const attempts: (() => Promise<{ text: string; model: string }>)[] = [];
  const provider = videoAnalysisProvider();
  const useLocal = provider !== "llm" && (await canRunLocalAnalyser());
  if (useLocal) {
    attempts.push(() => runLocalAnalyser(segment, answers));
  }
  // "local" means local only: no model fallback for video.
  if (provider === "local" && !useLocal) return null;
  if (isOminibotConfigured()) {
    attempts.push(async () => {
      const reply = await ominibotChat({
        content: [
          { type: "text", text: prompt },
          { type: "video_url", video_url: { url: `data:${segment.mimeType};base64,${base64}` } },
        ],
        json: true,
        temperature: 0.1,
        timeoutMs: SEGMENT_TIMEOUT_MS,
      });
      return { text: reply.text, model: reply.model };
    });
  }
  const gemini = getGeminiTextConfig();
  if (gemini) {
    attempts.push(async () => {
      const model = process.env.VIDEO_ANALYSIS_MODEL?.trim() || gemini.model;
      const response = await fetch(`${GEMINI_BASE_URL}/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": gemini.apiKey },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ inlineData: { mimeType: segment.mimeType, data: base64 } }, { text: prompt }],
            },
          ],
          generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
        }),
        signal: AbortSignal.timeout(SEGMENT_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`model returned ${response.status}`);
      const payload = (await response.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = (payload.candidates?.[0]?.content?.parts ?? [])
        .map((part) => part.text ?? "")
        .join("");
      return { text, model };
    });
  }
  if ((process.env.ANALYSIS_PROVIDER ?? "").trim().toLowerCase() === "gemini") attempts.reverse();

  for (const [index, attempt] of attempts.entries()) {
    try {
      const { text, model } = await attempt();
      const parsed = segmentSchema.safeParse(parseJsonObject(text));
      if (parsed.success) return { segment, report: parsed.data, assigned, model };
      if (index === 0 && useLocal) localAnalyserLastError = "the local analyser reply did not match the expected shape";
      console.warn(`[video] clip ${segment.index}: reply did not match the expected shape`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (index === 0 && useLocal) localAnalyserLastError = message;
      console.warn(`[video] clip ${segment.index}: ${message}`);
    }
  }
  return null;
}

/**
 * Runs the local OpenCV + MediaPipe analyser on this clip. It is given the
 * same clip-local answer schedule the model prompt gets and prints the same
 * JSON shape, so the parsing below is unchanged.
 */
async function runLocalAnalyser(
  segment: Segment,
  answers: readonly TimedAnswer[],
): Promise<{ text: string; model: string }> {
  const from = segment.offset;
  const to = segment.offset + SEGMENT_SECONDS;
  const schedule: { id: number; questionStart: number; start: number; end: number }[] = [];
  for (const answer of answers) {
    const middle = (answer.start + answer.end) / 2;
    if (middle < from || middle >= to) continue;
    schedule.push({
      id: schedule.length + 1,
      questionStart: Math.max(from, answer.questionStart) - from,
      start: Math.max(from, answer.start) - from,
      end: Math.min(to, answer.end) - from,
    });
  }

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "intervia-local-"));
  const answersFile = path.join(workDir, "answers.json");
  await fs.writeFile(answersFile, JSON.stringify(schedule));

  try {
    const text = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        videoAnalysisPython(),
        [LOCAL_ANALYSER, "--video", segment.file, "--answers-file", answersFile],
        { windowsHide: true },
      );
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(
        () => {
          child.kill();
          reject(new Error("local analyser timed out"));
        },
        LOCAL_TIMEOUT_MS,
      );
      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk));
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk));
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0 && stdout.trim().startsWith("{")) resolve(stdout);
        else reject(new Error(`local analyser exited ${code}: ${stderr.slice(-400)}`));
      });
    });
    return { text, model: "local-cv (opencv + mediapipe)" };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

function parseJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** "mm:ss" or "h:mm:ss" to seconds. */
function parseClock(value: string): number {
  const parts = value.trim().split(":").map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isFinite(part))) {
    return Number.NaN;
  }
  return parts.reduce((total, part) => total * 60 + part, 0);
}

async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        results[index] = await run(items[index]);
      }
    }),
  );
  return results;
}
