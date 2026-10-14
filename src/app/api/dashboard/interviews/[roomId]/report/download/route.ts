import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getInterviewDetail } from "@/lib/interviews/scorecard.service";
import { interviewErrorResponse } from "@/lib/interviews/interview-errors";
import { describeRoleError } from "@/lib/roles/role-errors";
import type { Scorecard } from "@/lib/interviews/scorecard.types";
import { requireRecruiter } from "@/lib/auth/guards";

/**
 * Download the scorecard as a self-contained HTML document — an attachment
 * recruiters can archive or print to PDF. Sessions without a scorecard get
 * a structured error; nothing is invented.
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

    const html = renderScorecardHtml(detail.scorecard, detail.session.candidateName ?? detail.session.roleTitle ?? detail.session.title);
    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="intervia-scorecard-${roomId}.html"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error(`[dashboard] scorecard download failed: ${describeRoleError(error)}`);
    return interviewErrorResponse("SERVER_ERROR", "Could not download the report. Please try again.");
  }
}

/** Minimal, dependency-free scorecard document (prints cleanly to PDF). */
function renderScorecardHtml(scorecard: Scorecard, heading: string): string {
  const esc = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const list = (items: string[]) =>
    items.length === 0
      ? "<p class=muted>None recorded.</p>"
      : `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`;

  const competencyRows = scorecard.competencies
    .map((competency) => {
      const score =
        competency.status === "scored" && competency.score !== null
          ? `${competency.score}/5${competency.judgesAgree === false ? " · second grading disagreed" : ""}`
          : competency.status === "not_assessed"
            ? "Not assessed"
            : "Insufficient evidence";
      return `<tr><td>${esc(competency.name)}</td><td>${esc(score)}</td><td>${esc(competency.rationale)}</td></tr>`;
    })
    .join("");

  const factors = scorecard.overall?.factors ?? [];
  const factorCells =
    factors.length > 0
      ? `<p>${factors
          .map((factor) => `<span class=pill>${esc(factor.id)}: ${factor.score === null ? "—" : factor.score}</span>`)
          .join("")}</p>`
      : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Intervia scorecard — ${esc(heading)}</title>
<style>
  body{font:15px/1.6 -apple-system,'Segoe UI',sans-serif;color:#1a1a1a;max-width:820px;margin:32px auto;padding:0 24px}
  h1{font-size:26px;margin:0 0 4px} h2{font-size:18px;margin:28px 0 8px;border-bottom:1px solid #e5e5e5;padding-bottom:4px}
  .muted{color:#6b7280} .pill{display:inline-block;border:1px solid #e5e5e5;border-radius:999px;padding:2px 10px;font-size:12px;margin-right:6px}
  table{width:100%;border-collapse:collapse;margin:8px 0} td,th{border:1px solid #e5e5e5;padding:6px 10px;text-align:left;font-size:14px;vertical-align:top}
  ul{padding-left:20px} footer{margin-top:32px;color:#6b7280;font-size:12px}
</style></head><body>
<h1>Interview scorecard</h1>
<p class=muted>${esc(heading)} · generated ${esc(scorecard.generatedAt.slice(0, 10))} · grader ${esc(scorecard.model)}</p>
<p><span class=pill>Overall: ${scorecard.overall?.score ?? scorecard.overallScore ?? "—"}</span><span class=pill>Suggestion: ${esc(scorecard.suggestion)}</span>${scorecard.needsHumanReview ? '<span class=pill style="color:#b45309">Needs human review</span>' : ""}</p>
${factorCells}
<h2>Summary</h2><p>${esc(scorecard.summary)}</p>
<h2>Competencies</h2>
<table><tr><th>Competency</th><th>Score</th><th>Assessment</th></tr>${competencyRows}</table>
<h2>Strengths</h2>${list(scorecard.strengths)}
<h2>Concerns</h2>${list(scorecard.concerns)}
<h2>Integrity signals (measured)</h2>
<ul>
<li>Tab hidden: ${scorecard.integrity.tabHiddenCount} time(s), ${scorecard.integrity.tabHiddenSeconds}s total</li>
<li>Window blur: ${scorecard.integrity.windowBlurCount} time(s)</li>
<li>Candidate disconnects: ${scorecard.integrity.candidateDisconnects}</li>
<li>Median response latency: ${scorecard.integrity.medianResponseLatencyMs === null ? "—" : `${scorecard.integrity.medianResponseLatencyMs}ms`}</li>
</ul>
${scorecard.integrity.notes.length > 0 ? `<h3>Grader observations</h3>${list(scorecard.integrity.notes.map((note) => note.description))}` : ""}
${scorecard.notes.length > 0 ? `<h2>Data-quality notes</h2>${list(scorecard.notes)}` : ""}
<footer>Generated by Intervia · scorecards are recommendations; the hiring decision is recorded separately.</footer>
</body></html>`;
}