import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { interviewErrorResponse } from "@/lib/interviews/interview-errors";
import {
  activateRoom,
  verifyCandidateEmail,
} from "@/lib/interviews/interview.service";
import {
  roomIdSchema,
  verifyEmailSchema,
} from "@/lib/interviews/interview.validation";
import {
  checkEmailAttempt,
  recordEmailFailure,
  resetEmailAttempts,
} from "@/lib/interviews/email-attempts";
import { getLiveKitRoomName } from "@/lib/livekit/room";
import { generateLiveKitToken } from "@/lib/livekit/token";
import { createRecordingToken } from "@/lib/auth/session";
import { getInterviewRepository } from "@/server/repositories";
import { extractPdfText, PdfExtractionError } from "@/lib/interviews/pdf-text";
import { storeResumeFile } from "@/lib/uploads/resume-storage";
import { validateResumeUpload } from "@/lib/uploads/resume-upload";
import {
  RECONNECT_GRACE_SECONDS,
  reconnectStateFor,
} from "@/lib/interviews/reconnect.service";

type RouteParams = { params: Promise<{ roomId: string }> };

/**
 * Candidate email gate: verifies the email matches the session and that
 * consent was given, then issues join credentials in the same response. The
 * token also dispatches the interviewer agent to the room, so it is already
 * there when the candidate connects. Failed attempts are rate-limited per link.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { roomId } = await params;

  if (!roomIdSchema.safeParse(roomId).success) {
    return interviewErrorResponse("INVALID_INPUT", "This interview link is invalid.");
  }

  let body: unknown;
  let resumeFile: File | null = null;
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    // The candidate join form posts multipart so it can carry an optional
    // updated resume alongside the email verification.
    const form = await request.formData().catch(() => null);
    if (!form) {
      return interviewErrorResponse("INVALID_INPUT", "Invalid form submission.");
    }
    body = {
      email: form.get("email"),
      consent: form.get("consent") === "true" || form.get("consent") === "on",
    };
    const file = form.get("resume");
    if (file instanceof File && file.size > 0) resumeFile = file;
  } else {
    try {
      body = await request.json();
    } catch {
      return interviewErrorResponse("INVALID_INPUT", "Request body must be valid JSON.");
    }
  }

  const parsed = verifyEmailSchema.safeParse(body);
  if (!parsed.success) {
    return interviewErrorResponse("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid input.");
  }

  const attempt = checkEmailAttempt(roomId);
  if (!attempt.allowed) {
    return interviewErrorResponse(
      "EMAIL_MISMATCH",
      `Too many incorrect attempts. This link is locked for ${Math.ceil((attempt.retryAfterSeconds ?? 0) / 60)} more minutes.`,
    );
  }

  const result = await verifyCandidateEmail(roomId, parsed.data.email, new Date().toISOString());
  if (!result.ok) {
    if (result.code === "EMAIL_MISMATCH") recordEmailFailure(roomId);
    return interviewErrorResponse(result.code, result.message);
  }

  resetEmailAttempts(roomId);
  const identity = `candidate-${randomUUID()}`;
  const displayName = result.room.candidateName ?? "Candidate";

  // Reconnection gate, enforced entirely on the server: an interview already
  // in progress may only be resumed within the grace window, and never past
  // its duration. The client receives the server-computed remaining time so
  // the visible timer continues from the original clock instead of restarting.
  const repository = getInterviewRepository();
  const events = await repository.getEvents(roomId);
  const reconnect = reconnectStateFor(result.room, events);
  if (reconnect.kind === "expired") {
    const current = await repository.get(roomId);
    if (current && (current.status === "active" || current.status === "waiting" || current.status === "scheduled")) {
      await repository.save({ ...current, status: "expired" });
    }
    return interviewErrorResponse("ROOM_EXPIRED", reconnect.reason);
  }

  try {
    // Optional updated resume: replaces the recruiter-provided resume in the
    // session data so the evaluation uses the candidate's latest version.
    if (resumeFile) {
      const validation = validateResumeUpload({ name: resumeFile.name, size: resumeFile.size });
      if (!validation.ok) {
        const messages = {
          empty: "The resume file is empty.",
          too_large: "The resume file is larger than 10 MB.",
          unsupported_type: "Only PDF, DOC and DOCX resumes are accepted.",
        } as const;
        return interviewErrorResponse("INVALID_INPUT", messages[validation.reason]);
      }
      const data = Buffer.from(await resumeFile.arrayBuffer());
      await storeResumeFile(roomId, validation.kind, data);
      let text = "";
      let unreadable = false;
      if (validation.kind === "pdf") {
        try {
          text = await extractPdfText(resumeFile, "Resume");
        } catch (error) {
          if (error instanceof PdfExtractionError) unreadable = true;
          else throw error;
        }
      } else {
        // Word documents are stored for the recruiter but not parsed.
        unreadable = true;
      }
      await repository.save({
        ...result.room,
        resume: { fileName: resumeFile.name, text, ...(unreadable ? { unreadable: true } : {}) },
      });
      await repository.appendEvents(roomId, [
        {
          type: "resume_uploaded",
          at: new Date().toISOString(),
          data: { fileName: resumeFile.name, bytes: resumeFile.size, source: "candidate_join" },
        },
      ]);
    }

    const credentials = await generateLiveKitToken({
      roomName: getLiveKitRoomName(roomId),
      identity,
      displayName,
      dispatchInterviewId: roomId,
    });
    await activateRoom(roomId);
    return NextResponse.json({
      ...credentials,
      identity,
      // Lets this participant upload their own recording, nothing else.
      recordingToken: await createRecordingToken(roomId, identity),
      // Present only on a resume: how much of the duration is left on the
      // server's clock. The client continues its timer from there.
      remainingSeconds:
        reconnect.kind === "active" ? reconnect.remainingSeconds : undefined,
      reconnectGraceSeconds: RECONNECT_GRACE_SECONDS,
    });
  } catch (error) {
    console.error("LiveKit token generation failed:", error);
    return interviewErrorResponse(
      "SERVER_ERROR",
      "The interview room is not available right now. Please try again shortly.",
    );
  }
}