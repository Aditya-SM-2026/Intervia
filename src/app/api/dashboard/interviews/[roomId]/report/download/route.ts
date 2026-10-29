import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getInterviewDetail } from "@/lib/interviews/scorecard.service";
import { interviewErrorResponse } from "@/lib/interviews/interview-errors";
import { describeRoleError } from "@/lib/roles/role-errors";
import { renderScorecardPdf } from "@/lib/interviews/scorecard-pdf";
import { requireRecruiter } from "@/lib/auth/guards";

/**
 * Downloads the scorecard as a print-ready PDF. Sessions without a scorecard
 * get a structured error; nothing is invented.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ roomId: string }> },
) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roomId } = await context.params;
  try {
    const detail = await getInterviewDetail(roomId);
    if (!detail) return interviewErrorResponse("ROOM_NOT_FOUND", "Interview not found.");
    if (detail.scorecard === null) {
      return interviewErrorResponse(
        "ROOM_UNAVAILABLE",
        detail.reason ?? "No scorecard is available yet.",
      );
    }

    const heading =
      detail.session.candidateName ?? detail.session.roleTitle ?? detail.session.title;
    const pdf = await renderScorecardPdf(detail.scorecard, detail.session, heading);
    const slug =
      heading
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
        .slice(0, 40) || "candidate";

    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="sreemedhas-scorecard-${slug}-${roomId}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error(`[dashboard] scorecard download failed: ${describeRoleError(error)}`);
    return interviewErrorResponse("SERVER_ERROR", "Could not download the report. Please try again.");
  }
}
