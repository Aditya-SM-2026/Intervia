"use client";

import { useState } from "react";
import { Toast, type ToastMessage } from "@/components/ui/Toast";

const inputClass =
  "w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10";

/** A team member changes their own password; their other devices are signed out. */
export function ChangePasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (next !== repeat) {
      setErrors({ repeat: "The two new passwords are different." });
      return;
    }
    setSaving(true);
    const response = await fetch("/api/account/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current, next }),
    }).catch(() => null);
    setSaving(false);
    const data = (await response?.json().catch(() => ({}))) as { error?: { message?: string; fields?: Record<string, string> } } | undefined;
    if (!response?.ok) {
      setErrors(data?.error?.fields ?? { form: data?.error?.message ?? "That did not save. Try again." });
      return;
    }
    setErrors({});
    setCurrent("");
    setNext("");
    setRepeat("");
    setToast({ tone: "success", message: "Password changed. Your other devices were signed out." });
  }

  const field = (id: string, label: string, value: string, set: (v: string) => void, autoComplete: string, error?: string, hint?: string) => (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">{label}</label>
      <input id={id} type="password" autoComplete={autoComplete} value={value} onChange={(e) => set(e.target.value)} className={inputClass} aria-invalid={Boolean(error)} />
      {(error || hint) && <p className={`mt-1.5 text-xs ${error ? "text-red-600 dark:text-red-400" : "text-muted"}`}>{error ?? hint}</p>}
    </div>
  );

  return (
    <form onSubmit={submit} noValidate className="grid max-w-md gap-4 rounded-2xl border border-border bg-surface p-5">
      {field("current-password", "Current password", current, setCurrent, "current-password", errors.current)}
      {field("new-password", "New password", next, setNext, "new-password", errors.next, "At least 10 characters.")}
      {field("repeat-password", "New password again", repeat, setRepeat, "new-password", errors.repeat)}
      {errors.form && <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">{errors.form}</p>}
      <div>
        <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60">
          {saving ? "Saving…" : "Change password"}
        </button>
      </div>
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </form>
  );
}
