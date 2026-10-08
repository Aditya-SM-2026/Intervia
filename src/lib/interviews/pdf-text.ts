import "server-only";
import { extractText, getDocumentProxy } from "unpdf";

const MAX_PDF_BYTES = 8 * 1024 * 1024;
const MAX_PDF_TEXT_CHARS = 40_000;

/** Guards file size before parsing so huge uploads fail fast. */
export function assertPdfUpload(file: File, label: string): void {
  if (file.size === 0) {
    throw new PdfExtractionError(`${label} file is empty.`);
  }
  if (file.size > MAX_PDF_BYTES) {
    throw new PdfExtractionError(`${label} file must be at most 8 MB.`);
  }
  const type = file.type || file.name.toLowerCase().endsWith(".pdf") && "application/pdf" || "";
  if (type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    throw new PdfExtractionError(`${label} must be a PDF file.`);
  }
}

export class PdfExtractionError extends Error {}

/**
 * Extracts plain text from a PDF, collapsing whitespace. Throws
 * PdfExtractionError when nothing readable is found (scanned documents).
 */
export async function extractPdfText(file: File, label: string): Promise<string> {
  assertPdfUpload(file, label);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new PdfExtractionError(`Could not read the ${label} file.`);
  }

  let text: string;
  try {
    const pdf = await getDocumentProxy(bytes);
    const extracted = await extractText(pdf, { mergePages: true });
    text = extracted.text;
  } catch {
    throw new PdfExtractionError(
      `${label} could not be read. Make sure it is a valid PDF, not a scan or photo.`,
    );
  }

  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    throw new PdfExtractionError(
      `${label} contains no readable text. Make sure it is not a scan or photo.`,
    );
  }
  return cleaned.slice(0, MAX_PDF_TEXT_CHARS);
}