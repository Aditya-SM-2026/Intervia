"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";

type Status = "loading" | "ready" | "error";
type PdfDoc = Awaited<ReturnType<typeof import("unpdf")["getDocumentProxy"]>>;

/**
 * Draws every page of a PDF onto canvases, sized to the column width.
 *
 * The browser's own PDF viewer is not used because phones (Android Chrome in
 * particular) show nothing inside an iframe, and desktop viewers each bring
 * their own toolbar and theme. pdf.js comes from unpdf, which the server
 * already uses to read resume text, and is only loaded when a PDF is opened.
 */
export function PdfPages({ url, title }: { url: string; title: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [width, setWidth] = useState(0);

  // Track the column width so pages are drawn sharp at the size they are shown.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let frame = 0;
    const observer = new ResizeObserver(([entry]) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setWidth(Math.floor(entry.contentRect.width)));
    });
    observer.observe(host);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  // Fetch and open the document once.
  useEffect(() => {
    let cancelled = false;
    let opened: PdfDoc | null = null;
    (async () => {
      try {
        const [{ getDocumentProxy }, response] = await Promise.all([import("unpdf"), fetch(url)]);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const pdf = await getDocumentProxy(new Uint8Array(await response.arrayBuffer()));
        if (cancelled) {
          void pdf.loadingTask.destroy();
          return;
        }
        opened = pdf;
        setDoc(pdf);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      void opened?.loadingTask.destroy();
    };
  }, [url]);

  return (
    <div ref={hostRef} className="mx-auto w-full max-w-[820px]" aria-label={title} role="document">
      {status === "error" ? (
        <p className="flex items-start gap-2 rounded-xl bg-surface px-4 py-3 text-sm text-muted">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          This PDF could not be shown here. Use Open or Download to view the original.
        </p>
      ) : status === "loading" || width === 0 ? (
        <div className="skeleton aspect-[1/1.414] w-full rounded-lg" aria-hidden />
      ) : (
        <div className="grid gap-4">
          {Array.from({ length: doc?.numPages ?? 0 }, (_, index) => (
            <PdfCanvas key={index} doc={doc} pageNumber={index + 1} width={width} />
          ))}
        </div>
      )}
    </div>
  );
}

function PdfCanvas({
  doc,
  pageNumber,
  width,
}: {
  doc: PdfDoc | null;
  pageNumber: number;
  width: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ratio, setRatio] = useState(1.414);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    if (!doc || !canvasRef.current || width === 0) return;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    let cancelled = false;
    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      setRatio(base.height / base.width);
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const viewport = page.getViewport({ scale: (width / base.width) * dpr });
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const context = canvas.getContext("2d");
      if (!context) return;
      task = page.render({ canvas, canvasContext: context, viewport });
      try {
        await task.promise;
        if (!cancelled) setDrawn(true);
      } catch {
        // A cancelled render (from a resize) rejects; the next render replaces it.
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, pageNumber, width]);

  return (
    <div className="relative overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-black/5" style={{ aspectRatio: `1 / ${ratio}` }}>
      {!drawn && <div className="skeleton absolute inset-0" aria-hidden />}
      <canvas ref={canvasRef} className="block size-full" aria-label={`Page ${pageNumber}`} />
    </div>
  );
}
