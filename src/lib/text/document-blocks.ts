/**
 * Turns plain text that people paste into the product (job descriptions,
 * mostly) into structured blocks: headings, paragraphs, bullet and numbered
 * lists, and "Label: value" facts. The text itself is never changed — only
 * how it is grouped — so the rendered page says exactly what was written.
 */

export type DocumentBlock =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "numbered"; items: { n: string; text: string }[] }
  | { kind: "facts"; items: { label: string; value: string }[] };

const BULLET = /^[-•*·▪◦–—>]\s+(.+)$/;
const NUMBERED = /^(\d{1,2})[.)]\s+(.+)$/;
const FACT = /^([A-Za-z][A-Za-z0-9 /&()'’.-]{1,32}):\s+(.{1,160})$/;

function isHeading(line: string, next: string | undefined): boolean {
  if (line.length > 64) return false;
  if (/[.!?,;]$/.test(line)) return false;
  if (line.endsWith(":")) return true;
  // A short line on its own, followed by content, reads as a heading:
  // "About the role", "Key Responsibilities", "WHAT YOU WILL DO".
  if (next === undefined || next.trim() === "") return false;
  const words = line.split(/\s+/);
  if (words.length > 8) return false;
  const capitalised = words.filter((word) => /^[A-Z0-9(&]/.test(word)).length;
  return capitalised / words.length >= 0.5 || line === line.toUpperCase();
}

/** Headings written in capitals read better in sentence case. */
function tidyHeading(text: string): string {
  const stripped = text.replace(/:$/, "").trim();
  const letters = stripped.replace(/[^A-Za-z]/g, "");
  if (letters.length > 3 && letters === letters.toUpperCase()) {
    return stripped.charAt(0) + stripped.slice(1).toLowerCase();
  }
  return stripped;
}

export function parseDocument(raw: string): DocumentBlock[] {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim());
  const blocks: DocumentBlock[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };
  const last = () => blocks[blocks.length - 1];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line === "") {
      flush();
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      flush();
      const previous = last();
      if (previous?.kind === "bullets") previous.items.push(bullet[1]);
      else blocks.push({ kind: "bullets", items: [bullet[1]] });
      continue;
    }
    const numbered = NUMBERED.exec(line);
    if (numbered) {
      flush();
      const previous = last();
      if (previous?.kind === "numbered") previous.items.push({ n: numbered[1], text: numbered[2] });
      else blocks.push({ kind: "numbered", items: [{ n: numbered[1], text: numbered[2] }] });
      continue;
    }
    const fact = FACT.exec(line);
    if (fact && paragraph.length === 0) {
      const previous = last();
      const item = { label: fact[1].trim(), value: fact[2].trim() };
      if (previous?.kind === "facts") previous.items.push(item);
      else blocks.push({ kind: "facts", items: [item] });
      continue;
    }
    if (paragraph.length === 0 && isHeading(line, lines[index + 1])) {
      blocks.push({ kind: "heading", text: tidyHeading(line) });
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

/** The first real sentence or two, for one-line previews in lists. */
export function documentExcerpt(raw: string, max = 180): string {
  const blocks = parseDocument(raw);
  const source =
    blocks.find((block) => block.kind === "paragraph" && block.text.length > 40) ??
    blocks.find((block) => block.kind === "paragraph") ??
    blocks.find((block) => block.kind === "bullets");
  let text = "";
  if (source?.kind === "paragraph") text = source.text;
  else if (source?.kind === "bullets") text = source.items.join(", ");
  else text = raw.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, "")}…` : text;
}

/** Labelled facts such as location or experience, for headers. */
export function documentFacts(raw: string): { label: string; value: string }[] {
  return parseDocument(raw)
    .filter((block): block is Extract<DocumentBlock, { kind: "facts" }> => block.kind === "facts")
    .flatMap((block) => block.items);
}
