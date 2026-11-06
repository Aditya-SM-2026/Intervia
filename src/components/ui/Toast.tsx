"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, TriangleAlert, X } from "lucide-react";
import { EASE_OUT } from "./animated";

export interface ToastMessage {
  tone: "success" | "error";
  message: string;
}

/** Bottom-right confirmation that clears itself after a few seconds. */
export function Toast({ toast, onDismiss }: { toast: ToastMessage | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onDismiss, toast.tone === "error" ? 8000 : 4500);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          role={toast.tone === "error" ? "alert" : "status"}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.22, ease: EASE_OUT }}
          className="fixed bottom-6 right-6 z-[60] flex max-w-sm items-start gap-3 rounded-xl border border-border bg-surface p-3.5 pr-2 shadow-xl shadow-black/10 dark:shadow-black/50"
        >
          {toast.tone === "success" ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" aria-hidden />
          ) : (
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-rose-500" aria-hidden />
          )}
          <p className="text-sm">{toast.message}</p>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="grid size-6 shrink-0 place-items-center rounded-md text-muted transition hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
