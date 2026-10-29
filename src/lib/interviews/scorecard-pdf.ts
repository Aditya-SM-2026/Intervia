import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { InterviewRoom } from "./interview.types";
import type { Scorecard } from "./scorecard.types";

/**
 * A print-ready PDF of the scorecard: the document a recruiter forwards to a
 * hiring manager or keeps on file. Laid out in code rather than printed from
 * the web page so the result is the same everywhere and needs no browser.
 */

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 44;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.39, 0.45, 0.55);
const LINE = rgb(0.89, 0.91, 0.94);
const ACCENT = rgb(0.15, 0.39, 0.92);
const ACCENT_SOFT = rgb(0.93, 0.95, 1);
const GREEN = rgb(0.05, 0.55, 0.35);
const AMBER = rgb(0.72, 0.45, 0.05);
const RED = rgb(0.78, 0.16, 0.16);
const WHITE = rgb(1, 1, 1);

const SUGGESTION_LABEL: Record<string, string> = {
  strong: "Strong hire",
  positive: "Positive",
  mixed: "Mixed",
  weak: "Weak",
  insufficient: "Not enough evidence",
};

const VERDICT_LABEL: Record<string, string> = {
  confirmed: "Confirmed",
  partly_supported: "Partly supported",
  not_supported: "Not supported",
  not_discussed: "Not discussed",
};

const DECISION_LABEL: Record<string, string> = {
  advance: "Advance",
  hold: "Hold",
  reject: "Reject",
};

const MOMENT_LABEL: Record<string, string> = {
  looking_away: "Looking away",
  reading: "Reading",
  other_person: "Another person",
  second_device: "Second device",
  left_frame: "Left the frame",
  other: "Other",
};

/** WinAnsi cannot encode everything a transcript may contain. */
function safe(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[^\t\n\r\x20-\x7E\xA0-\xFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreColor(score: number | null): ReturnType<typeof rgb> {
  if (score === null) return MUTED;
  if (score >= 75) return GREEN;
  if (score >= 50) return AMBER;
  return RED;
}

interface Ctx {
  doc: PDFDocument;
  regular: PDFFont;
  bold: PDFFont;
  page: PDFPage;
  y: number;
  heading: string;
  footer: string;
  pageNumber: number;
}

function newPage(ctx: Ctx, withBand = false): void {
  ctx.page = ctx.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  ctx.pageNumber += 1;
  ctx.y = PAGE_HEIGHT - MARGIN;
  if (withBand) return;

  // Slim running header on continuation pages.
  ctx.page.drawText(safe(ctx.heading), {
    x: MARGIN,
    y: PAGE_HEIGHT - 34,
    size: 8.5,
    font: ctx.regular,
    color: MUTED,
  });
  ctx.page.drawLine({
    start: { x: MARGIN, y: PAGE_HEIGHT - 42 },
    end: { x: PAGE_WIDTH - MARGIN, y: PAGE_HEIGHT - 42 },
    thickness: 0.7,
    color: LINE,
  });
  ctx.y = PAGE_HEIGHT - 62;
}

function ensure(ctx: Ctx, height: number): void {
  if (ctx.y - height >= MARGIN + 34) return;
  newPage(ctx);
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = safe(text).split(" ").filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  return lines;
}

function paragraph(
  ctx: Ctx,
  text: string,
  options: { size?: number; color?: ReturnType<typeof rgb>; gap?: number; font?: PDFFont } = {},
): void {
  const size = options.size ?? 10;
  const font = options.font ?? ctx.regular;
  const color = options.color ?? INK;
  const lines = wrap(text, font, size, CONTENT_WIDTH);
  const lineHeight = size * 1.45;
  for (const line of lines) {
    ensure(ctx, lineHeight);
    ctx.page.drawText(line, { x: MARGIN, y: ctx.y - size, size, font, color });
    ctx.y -= lineHeight;
  }
  ctx.y -= options.gap ?? 0;
}

function sectionTitle(ctx: Ctx, title: string): void {
  ensure(ctx, 34);
  ctx.y -= 12;
  ctx.page.drawText(safe(title).toUpperCase(), {
    x: MARGIN,
    y: ctx.y - 9,
    size: 8.5,
    font: ctx.bold,
    color: MUTED,
  });
  ctx.y -= 16;
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y },
    end: { x: PAGE_WIDTH - MARGIN, y: ctx.y },
    thickness: 0.7,
    color: LINE,
  });
  ctx.y -= 14;
}

function bulletList(
  ctx: Ctx,
  items: string[],
  options: { color?: ReturnType<typeof rgb>; empty?: string } = {},
): void {
  if (items.length === 0) {
    paragraph(ctx, options.empty ?? "None recorded.", { color: MUTED, size: 9.5 });
    return;
  }
  for (const item of items) {
    const size = 9.5;
    const lines = wrap(item, ctx.regular, size, CONTENT_WIDTH - 14);
    ensure(ctx, lines.length * size * 1.4 + 4);
    ctx.page.drawCircle({ x: MARGIN + 3, y: ctx.y - 3.5, size: 1.6, color: options.color ?? MUTED });
    lines.forEach((line, index) => {
      ctx.page.drawText(line, {
        x: MARGIN + 14,
        y: ctx.y - size - index * size * 1.4,
        size,
        font: ctx.regular,
        color: INK,
      });
    });
    ctx.y -= lines.length * size * 1.4 + 6;
  }
}

interface Column {
  header: string;
  width: number;
}

function table(
  ctx: Ctx,
  columns: Column[],
  rows: string[][],
  options: { empty?: string; size?: number } = {},
): void {
  const size = options.size ?? 9;
  if (rows.length === 0) {
    paragraph(ctx, options.empty ?? "Nothing recorded.", { color: MUTED, size: 9.5 });
    return;
  }
  const padX = 6;
  const padY = 5;
  const lineHeight = size * 1.32;

  const drawHeader = () => {
    ensure(ctx, 26);
    ctx.page.drawRectangle({
      x: MARGIN,
      y: ctx.y - 20,
      width: CONTENT_WIDTH,
      height: 20,
      color: rgb(0.97, 0.98, 1),
    });
    let x = MARGIN + padX;
    columns.forEach((column) => {
      ctx.page.drawText(safe(column.header).toUpperCase(), {
        x,
        y: ctx.y - 13.5,
        size: 7.5,
        font: ctx.bold,
        color: MUTED,
      });
      x += column.width;
    });
    ctx.y -= 20;
  };

  drawHeader();

  rows.forEach((cells) => {
    const wrapped = cells.map((cell, index) =>
      wrap(cell ?? "", ctx.regular, size, columns[index].width - padX * 2),
    );
    const height = Math.max(...wrapped.map((lines) => lines.length)) * lineHeight + padY * 2;
    if (ctx.y - height < MARGIN + 34) {
      newPage(ctx);
      drawHeader();
    }
    let x = MARGIN + padX;
    wrapped.forEach((lines, index) => {
      lines.forEach((line, lineIndex) => {
        ctx.page.drawText(line, {
          x,
          y: ctx.y - padY - size - lineIndex * lineHeight,
          size,
          font: ctx.regular,
          color: index === 0 ? INK : MUTED,
        });
      });
      x += columns[index].width;
    });
    ctx.y -= height;
    ctx.page.drawLine({
      start: { x: MARGIN, y: ctx.y },
      end: { x: PAGE_WIDTH - MARGIN, y: ctx.y },
      thickness: 0.6,
      color: LINE,
    });
  });
  ctx.y -= 8;
}

function pill(
  ctx: Ctx,
  x: number,
  y: number,
  text: string,
  options: { color?: ReturnType<typeof rgb>; fill?: ReturnType<typeof rgb> } = {},
): number {
  const size = 8.5;
  const label = safe(text);
  const width = ctx.bold.widthOfTextAtSize(label, size) + 16;
  ctx.page.drawRectangle({
    x,
    y,
    width,
    height: 18,
    color: options.fill ?? ACCENT_SOFT,
  });
  ctx.page.drawText(label, {
    x: x + 8,
    y: y + 5.5,
    size,
    font: ctx.bold,
    color: options.color ?? ACCENT,
  });
  return width;
}

/** Draws the cover band and the headline scores on the first page. */
function drawHeader(ctx: Ctx, scorecard: Scorecard, room: InterviewRoom, heading: string): void {
  const bandHeight = 132;
  ctx.page.drawRectangle({
    x: 0,
    y: PAGE_HEIGHT - bandHeight,
    width: PAGE_WIDTH,
    height: bandHeight,
    color: rgb(0.05, 0.09, 0.16),
  });
  ctx.page.drawText("INTERVIEW SCORECARD", {
    x: MARGIN,
    y: PAGE_HEIGHT - 44,
    size: 9,
    font: ctx.bold,
    color: rgb(0.62, 0.7, 0.86),
  });
  ctx.page.drawText(safe(heading || "Candidate"), {
    x: MARGIN,
    y: PAGE_HEIGHT - 74,
    size: 24,
    font: ctx.bold,
    color: WHITE,
  });
  const role = safe(room.roleTitle || room.title || "");
  const when = scorecard.generatedAt
    ? new Date(scorecard.generatedAt).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "";
  const meta = [role, safe(room.candidateEmail ?? ""), when ? `Generated ${when}` : ""]
    .filter(Boolean)
    .join("  ·  ");
  ctx.page.drawText(meta, {
    x: MARGIN,
    y: PAGE_HEIGHT - 94,
    size: 10,
    font: ctx.regular,
    color: rgb(0.72, 0.78, 0.89),
  });
  const recruiter = safe(room.recruiterName || "");
  if (recruiter) {
    ctx.page.drawText(`Interviewer: ${recruiter}`, {
      x: MARGIN,
      y: PAGE_HEIGHT - 112,
      size: 9,
      font: ctx.regular,
      color: rgb(0.62, 0.7, 0.86),
    });
  }
  ctx.page.drawText("CONFIDENTIAL", {
    x: PAGE_WIDTH - MARGIN - 62,
    y: PAGE_HEIGHT - 44,
    size: 8,
    font: ctx.bold,
    color: rgb(0.62, 0.7, 0.86),
  });

  ctx.y = PAGE_HEIGHT - bandHeight - 28;
}

function drawScoreRow(ctx: Ctx, scorecard: Scorecard): void {
  const overall = scorecard.overall?.score ?? scorecard.overallScore;
  const color = scoreColor(overall);
  const boxHeight = 78;

  ctx.page.drawRectangle({
    x: MARGIN,
    y: ctx.y - boxHeight,
    width: 150,
    height: boxHeight,
    color: rgb(0.97, 0.98, 1),
  });
  ctx.page.drawText("OVERALL SCORE", {
    x: MARGIN + 16,
    y: ctx.y - 20,
    size: 7.5,
    font: ctx.bold,
    color: MUTED,
  });
  ctx.page.drawText(overall === null ? "-" : String(overall), {
    x: MARGIN + 16,
    y: ctx.y - 58,
    size: 34,
    font: ctx.bold,
    color,
  });
  ctx.page.drawText("/100", {
    x: MARGIN + 16 + (overall === null ? 14 : ctx.bold.widthOfTextAtSize(String(overall), 34) + 6),
    y: ctx.y - 56,
    size: 10,
    font: ctx.regular,
    color: MUTED,
  });

  const suggested = SUGGESTION_LABEL[scorecard.suggestion] ?? scorecard.suggestion;
  let x = MARGIN + 166;
  const labelY = ctx.y - 26;
  x += pill(ctx, x, labelY, `Recommendation: ${suggested}`, {
    color: color === MUTED ? MUTED : color,
    fill: rgb(0.96, 0.97, 0.99),
  });
  if (scorecard.needsHumanReview) {
    pill(ctx, x + 8, labelY, "Needs human review", { color: AMBER, fill: rgb(0.99, 0.96, 0.9) });
  }

  const factors = scorecard.overall?.factors ?? [];
  if (factors.length > 0) {
    let fy = ctx.y - 52;
    for (const factor of factors) {
      const label = factor.id.charAt(0).toUpperCase() + factor.id.slice(1);
      ctx.page.drawText(label, {
        x: MARGIN + 166,
        y: fy,
        size: 8.5,
        font: ctx.bold,
        color: INK,
      });
      const barX = MARGIN + 246;
      const barWidth = 118;
      ctx.page.drawRectangle({ x: barX, y: fy - 2, width: barWidth, height: 6, color: rgb(0.92, 0.94, 0.97) });
      const value = factor.score ?? 0;
      ctx.page.drawRectangle({
        x: barX,
        y: fy - 2,
        width: Math.max(0, Math.min(100, value)) * (barWidth / 100),
        height: 6,
        color: scoreColor(factor.score),
      });
      ctx.page.drawText(factor.score === null ? "-" : `${factor.score}`, {
        x: barX + barWidth + 8,
        y: fy - 1,
        size: 8.5,
        font: ctx.bold,
        color: scoreColor(factor.score),
      });
      ctx.page.drawText(`${factor.weight}%`, {
        x: barX + barWidth + 34,
        y: fy - 1,
        size: 7.5,
        font: ctx.regular,
        color: MUTED,
      });
      fy -= 14;
    }
  }
  ctx.y -= boxHeight + 10;
}

export async function renderScorecardPdf(
  scorecard: Scorecard,
  room: InterviewRoom,
  heading: string,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Interview scorecard - ${safe(heading)}`);
  doc.setAuthor("Sreemedhas Agent");
  doc.setCreator("Sreemedhas Agent");

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  const ctx: Ctx = {
    doc,
    regular,
    bold,
    page,
    y: PAGE_HEIGHT - MARGIN,
    heading: `Interview scorecard - ${safe(heading)}`,
    footer: "Sreemedhas Agent  ·  scorecards are recommendations; the hiring decision is recorded separately.",
    pageNumber: 1,
  };

  drawHeader(ctx, scorecard, room, heading);
  drawScoreRow(ctx, scorecard);

  sectionTitle(ctx, "Summary");
  paragraph(ctx, scorecard.summary || "No summary was written for this interview.", { size: 10, gap: 6 });

  if (room.decision) {
    const decided = new Date(room.decision.decidedAt).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
    sectionTitle(ctx, "Hiring decision");
    paragraph(
      ctx,
      `${DECISION_LABEL[room.decision.outcome] ?? room.decision.outcome} - recorded ${decided}.`,
      { size: 10, font: bold, gap: 2 },
    );
    if (room.decision.note) paragraph(ctx, room.decision.note, { size: 9.5, color: MUTED, gap: 4 });
  }

  sectionTitle(ctx, "Competencies");
  table(
    ctx,
    [
      { header: "Competency", width: 130 },
      { header: "Score", width: 74 },
      { header: "Assessment", width: CONTENT_WIDTH - 204 },
    ],
    scorecard.competencies.map((competency) => {
      const score =
        competency.status === "scored" && competency.score !== null
          ? `${competency.score}/5${competency.judgesAgree === false ? " (graders disagreed)" : ""}`
          : competency.status === "not_assessed"
            ? "Not assessed"
            : "Insufficient evidence";
      return [competency.name, score, competency.rationale];
    }),
    { empty: "No competencies were assessed." },
  );

  if (scorecard.resumeMatch) {
    sectionTitle(ctx, "Resume match");
    paragraph(
      ctx,
      scorecard.resumeMatch.score === null
        ? scorecard.resumeMatch.reason ?? "Not scored."
        : `Score ${scorecard.resumeMatch.score}/100 across the claims the interview covered.`,
      { size: 9.5, color: MUTED, gap: 4 },
    );
    if (scorecard.resumeMatch.claims.length > 0) {
      table(
        ctx,
        [
          { header: "Claim", width: 190 },
          { header: "Verdict", width: 96 },
          { header: "Evidence", width: CONTENT_WIDTH - 286 },
        ],
        scorecard.resumeMatch.claims.map((claim) => [
          claim.claim,
          VERDICT_LABEL[claim.verdict] ?? claim.verdict,
          claim.note,
        ]),
      );
    }
  }

  if (scorecard.authenticity) {
    sectionTitle(ctx, "Answer authenticity");
    paragraph(ctx, `Score ${scorecard.authenticity.score}/100 for answers consistent with the candidate's own words.`, {
      size: 9.5,
      color: MUTED,
      gap: 4,
    });
    if (scorecard.authenticity.signals.length > 0) {
      table(
        ctx,
        [
          { header: "Signal", width: 150 },
          { header: "Severity", width: 70 },
          { header: "Detail", width: CONTENT_WIDTH - 220 },
        ],
        scorecard.authenticity.signals.map((signal) => [
          signal.title,
          signal.severity === 3 ? "Strong" : signal.severity === 2 ? "Notable" : "Worth a glance",
          signal.detail,
        ]),
      );
    }
  }

  if (scorecard.video) {
    const video = scorecard.video;
    sectionTitle(ctx, "On-camera behaviour");
    const lines: string[] = [];
    if (video.status === "analysed") {
      const parts = [`Score ${video.score ?? "-"}/100`];
      if (video.pattern) {
        parts.push(
          `${video.pattern.sameSpotAnswers} of ${video.pattern.answersObserved} answers held on one off-screen spot`,
        );
      }
      if (video.durationSeconds) parts.push(`${Math.round(video.durationSeconds / 60)} minutes analysed`);
      lines.push(parts.join("  ·  "));
      if (video.summary) lines.push(video.summary);
    } else {
      lines.push(video.reason || "The recording was not analysed.");
    }
    lines.forEach((line) => paragraph(ctx, line, { size: 9.5, color: INK, gap: 2 }));
    if (video.status === "analysed" && video.moments.length > 0) {
      table(
        ctx,
        [
          { header: "At", width: 54 },
          { header: "Moment", width: 100 },
          { header: "What was seen", width: CONTENT_WIDTH - 154 },
        ],
        video.moments.map((moment) => [
          formatClock(moment.atSeconds),
          MOMENT_LABEL[moment.kind] ?? moment.kind,
          moment.description,
        ]),
      );
    }
  }

  ensure(ctx, 80);
  sectionTitle(ctx, "Strengths");
  bulletList(ctx, scorecard.strengths, { color: GREEN, empty: "No standout strengths were recorded." });

  sectionTitle(ctx, "Concerns");
  bulletList(ctx, scorecard.concerns, { color: AMBER, empty: "No concerns were recorded." });

  sectionTitle(ctx, "Integrity signals (measured)");
  table(
    ctx,
    [
      { header: "Signal", width: 210 },
      { header: "Measured", width: CONTENT_WIDTH - 210 },
    ],
    [
      ["Tab hidden", `${scorecard.integrity.tabHiddenCount} time(s), ${scorecard.integrity.tabHiddenSeconds}s total`],
      ["Window blur", `${scorecard.integrity.windowBlurCount} time(s)`],
      ["Candidate disconnects", String(scorecard.integrity.candidateDisconnects)],
      [
        "Median response latency",
        scorecard.integrity.medianResponseLatencyMs === null
          ? "-"
          : `${(scorecard.integrity.medianResponseLatencyMs / 1000).toFixed(1)}s`,
      ],
    ],
  );

  if (scorecard.integrity.notes.length > 0) {
    sectionTitle(ctx, "Grader observations");
    bulletList(ctx, scorecard.integrity.notes.map((note) => note.description));
  }

  if (scorecard.notes.length > 0) {
    sectionTitle(ctx, "Data-quality notes");
    bulletList(ctx, scorecard.notes);
  }

  const pages = doc.getPages();
  pages.forEach((pageItem, index) => {
    pageItem.drawLine({
      start: { x: MARGIN, y: 46 },
      end: { x: PAGE_WIDTH - MARGIN, y: 46 },
      thickness: 0.6,
      color: LINE,
    });
    pageItem.drawText(safe(ctx.footer), {
      x: MARGIN,
      y: 34,
      size: 7.5,
      font: regular,
      color: MUTED,
    });
    const number = `Page ${index + 1} of ${pages.length}`;
    pageItem.drawText(number, {
      x: PAGE_WIDTH - MARGIN - regular.widthOfTextAtSize(number, 7.5),
      y: 34,
      size: 7.5,
      font: regular,
      color: MUTED,
    });
  });

  return doc.save();
}

function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
}
