import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getInterviewReport } from "@/lib/interviews/report.service";
import { interviewErrorResponse } from "@/lib/interviews/interview-errors";
import type { InterviewReport } from "@/lib/interviews/report.types";
import type { InterviewRoom } from "@/lib/interviews/interview.types";

/**
 * Download the generated report as a self-contained HTML document. Served as
 * an attachment so recruiters can archive or print it (e.g. to PDF) without
 * re-implementing report rendering. Sessions without a report get the same
 * structured error the report endpoint returns.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await context.params;
  try {
    const outcome = await getInterviewReport(roomId);
    if (!outcome.ok) {
      return interviewErrorResponse("ROOM_NOT_FOUND", "Interview not found.");
    }
    const { report, session, reason } = outcome.result;
    if (report === null) {
      return interviewErrorResponse("ROOM_UNAVAILABLE", reason ?? "No report is available yet.");
    }

    const html = renderReportHtml(report, session);
    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="intervia-report-${roomId}.html"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error(`[dashboard] report download failed: ${describeError(error)}`);
    return interviewErrorResponse("SERVER_ERROR", "Could not download the report. Please try again.");
  }
}

/** Minimal, dependency-free report document (prints cleanly to PDF). */
function renderReportHtml(report: InterviewReport, session: InterviewRoom): string {
  const esc = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const list = (items: string[]) =>
    items.length === 0 ? "<p class=muted>None recorded.</p>" : `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`;
  const heading = session.candidateName ?? session.roleTitle ?? session.title;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Intervia report — ${esc(heading)}</title>
<style>
  body{font:15px/1.6 -apple-system,'Segoe UI',sans-serif;color:#1a1a1a;max-width:820px;margin:32px auto;padding:0 24px}
  h1{font-size:26px;margin:0 0 4px} h2{font-size:18px;margin:28px 0 8px;border-bottom:1px solid #e5e5e5;padding-bottom:4px}
  .muted{color:#6b7280} .pill{display:inline-block;border:1px solid #e5e5e5;border-radius:999px;padding:2px 10px;font-size:12px;margin-right:6px}
  table{width:100%;border-collapse:collapse;margin:8px 0} td,th{border:1px solid #e5e5e5;padding:6px 10px;text-align:left;font-size:14px}
  ul{padding-left:20px} footer{margin-top:32px;color:#6b7280;font-size:12px}
  @media print{body{margin:12mm}}
</style></head><body>
<h1>${esc(heading)}</h1>
<p class="muted">Room ${esc(report.roomId)} · generated ${esc(report.generatedAt)} · model ${esc(report.engineMeta.model)}</p>
<h2>AI-usage assessment</h2>
<p><span class="pill">${report.integrity.probability}% estimated AI-assisted</span><span class="pill">${esc(report.integrity.level)} risk</span></p>
${report.integrity.signals.length > 0 ? `<table><tr><th>Signal</th><th>Evidence (turn seqs)</th><th>Weight</th></tr>${report.integrity.signals.map((signal) => `<tr><td>${esc(signal.description)}</td><td>${signal.evidenceTurnSeq.map((seq) => `#${seq}`).join(", ") || "—"}</td><td>${signal.weight}</td></tr>`).join("")}</table>` : "<p class=muted>No transcript evidence of AI assistance was found.</p>"}
${report.scores ? `<h2>Evaluation scores</h2><table><tr><th>Score</th><th>Value</th><th>Rationale</th></tr>${[
    { label: "Overall", entry: report.scores.overall },
    { label: "JD / skill match", entry: report.scores.jdMatch },
    { label: "AI-assistance risk", entry: report.scores.aiRisk },
    { label: "Communication", entry: report.scores.communication },
  ]
    .map(
      ({ label, entry }) =>
        `<tr><td>${esc(label)}</td><td>${entry.score}</td><td>${esc(entry.rationale)}${entry.evidenceTurnSeq.length > 0 ? ` <span class=muted>(turns ${entry.evidenceTurnSeq.map((seq) => `#${seq}`).join(", ")})</span>` : ""}</td></tr>`,
    )
    .join("")}</table>` : ""}
<h2>Analysis</h2>
${report.analysis.topics.length > 0 ? `<table><tr><th>Topic</th><th>Summary</th></tr>${report.analysis.topics.map((topic) => `<tr><td>${esc(topic.topic)}</td><td>${esc(topic.summary)}</td></tr>`).join("")}</table>` : "<p class=muted>No topics were summarized.</p>"}
<h2>Strengths</h2>${list(report.analysis.strengths)}
<h2>Weaknesses</h2>${list(report.analysis.weaknesses)}
${report.analysis.jdCoverage.length > 0 ? `<h2>JD coverage</h2><table><tr><th>Skill</th><th>Probed</th><th>Turns</th></tr>${report.analysis.jdCoverage.map((coverage) => `<tr><td>${esc(coverage.skill)}</td><td>${coverage.probed ? "yes" : "no"}</td><td>${coverage.evidenceTurnSeq.map((seq) => `#${seq}`).join(", ") || "—"}</td></tr>`).join("")}</table>` : ""}
${report.notes.length > 0 ? `<h2>Data notes</h2>${list(report.notes)}` : ""}
<footer>Generated by Intervia · recruiter-only document</footer>
</body></html>`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}