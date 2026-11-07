"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Copy,
  Link2,
  Lock,
  MessageCircle,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";
import type {
  ApplicationField,
  ApplicationFieldType,
  FormLinkStatus,
} from "@/lib/roles/application.types";
import {
  BASE_APPLICATION_FIELDS,
  OPTIONAL_BASE_FIELD_IDS,
  isMandatoryBaseField,
  suggestFieldId,
} from "@/lib/roles/application.types";
import { ApplicationForm } from "@/components/apply/ApplicationForm";
import { ConfirmDialog } from "@/components/dashboard/ConfirmDialog";
import { Sheet } from "@/components/ui/Sheet";
import { SegmentedTabs } from "@/components/ui/animated";
import { Toast, type ToastMessage } from "@/components/ui/Toast";

const inputClasses =
  "h-9 w-full rounded-lg border border-border bg-background/50 px-3 text-sm outline-none transition placeholder:text-muted focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/15";

const ghostButton =
  "inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-medium transition hover:border-foreground/20 hover:bg-foreground/[0.03] disabled:cursor-not-allowed disabled:opacity-50";

const TYPE_LABELS: Record<ApplicationFieldType, string> = {
  text: "Short answer",
  textarea: "Long answer",
  number: "Number",
  select: "Dropdown",
  yesno: "Yes / No",
  file: "File upload",
};

/** Types a recruiter may choose for their own questions. */
const CUSTOM_TYPES: ApplicationFieldType[] = ["text", "textarea", "number", "select", "yesno"];

type Panel = "questions" | "limits" | "preview";

function cloneFields(fields: ApplicationField[]): ApplicationField[] {
  return fields.map((field) => ({ ...field, options: field.options ? [...field.options] : undefined }));
}

function formatMoment(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * The role's public application form as a bar across the role page: its
 * state with an open/closed switch, the shareable link, and buttons for the
 * questions, a preview and the limits. Those open a side sheet for the questions, the link limits
 * and a preview of what applicants see. The essential built-in fields are
 * locked so an application always carries a name, phone, email and resume.
 */
export function ApplicationFormSettings({
  roleId,
  roleTitle,
  roleDescription = "",
}: {
  roleId: string;
  roleTitle: string;
  roleDescription?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [token, setToken] = useState<string>("");
  const [savedFields, setSavedFields] = useState<ApplicationField[]>([]);
  const [draft, setDraft] = useState<ApplicationField[]>([]);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [status, setStatus] = useState<FormLinkStatus | null>(null);
  const [limitInput, setLimitInput] = useState("");
  const [hoursInput, setHoursInput] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);

  const fail = (cause: unknown, fallback: string) =>
    setToast({ tone: "error", message: cause instanceof Error ? cause.message : fallback });

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const request = () =>
      fetch(`/api/roles/${encodeURIComponent(roleId)}/form-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
    // One quiet retry: a network blip (or a deploy rolling over) should not
    // leave the form bar showing an error.
    request()
      .catch(() => new Promise<Response>((resolve, reject) => setTimeout(() => request().then(resolve, reject), 1200)))
      .then(async (response) => {
        const body = (await response.json()) as {
          url?: string;
          token?: string;
          fields?: ApplicationField[];
          status?: FormLinkStatus;
          error?: { message?: string };
        };
        if (!response.ok || !body.url) throw new Error(body.error?.message ?? "Could not prepare the form link.");
        if (cancelled) return;
        setUrl(body.url);
        setToken(body.token ?? "");
        setSavedFields(body.fields ?? []);
        setDraft(body.fields ?? []);
        applySettings(body.status);
        setLoadError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        const message = cause instanceof Error ? cause.message : "";
        setLoadError(
          message && !/failed to fetch|network/i.test(message) ? message : "Could not load the form link. Check your connection.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [roleId, attempt]);

  /** Mirrors the server's link state into the settings inputs. */
  function applySettings(next: FormLinkStatus | null | undefined) {
    setStatus(next ?? null);
    setLimitInput(next?.maxApplications != null ? String(next.maxApplications) : "");
    setHoursInput(next?.expiresAfterHours != null ? String(next.expiresAfterHours) : "");
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setToast({ tone: "success", message: url });
    }
  }

  /** Saves the link's own limits: close after N applications or N hours. */
  async function saveSettings() {
    setSavingSettings(true);
    try {
      const response = await fetch(`/api/roles/${encodeURIComponent(roleId)}/form-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: { maxApplications: limitInput, expiresAfterHours: hoursInput } }),
      });
      const body = (await response.json()) as { url?: string; status?: FormLinkStatus; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Could not save the link limits.");
      if (body.url) setUrl(body.url);
      applySettings(body.status);
      setToast({ tone: "success", message: "Limits saved." });
    } catch (cause) {
      fail(cause, "Could not save the link limits.");
    } finally {
      setSavingSettings(false);
    }
  }

  /** A brand-new link. The current one stops working at once. */
  async function createNewLink() {
    setSaving(true);
    try {
      const response = await fetch(`/api/roles/${encodeURIComponent(roleId)}/form-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rotate: true }),
      });
      const body = (await response.json()) as {
        url?: string;
        token?: string;
        fields?: ApplicationField[];
        status?: FormLinkStatus;
        error?: { message?: string };
      };
      if (!response.ok || !body.url) throw new Error(body.error?.message ?? "Could not create a new link.");
      setUrl(body.url);
      setToken(body.token ?? "");
      if (body.fields) {
        setSavedFields(body.fields);
        setDraft(body.fields);
      }
      applySettings(body.status);
      setConfirmRotate(false);
      setToast({ tone: "success", message: "New link created. The old link no longer works." });
    } catch (cause) {
      fail(cause, "Could not create a new link.");
    } finally {
      setSaving(false);
    }
  }

  function openPanel(next: Panel) {
    if (next === "questions" || panel === null) setDraft(cloneFields(savedFields));
    setEditorError(null);
    setPanel(next);
  }

  async function saveFields() {
    if (draft.some((field) => field.label.trim() === "")) {
      setEditorError("Every question needs a label.");
      return;
    }
    const badSelect = draft.find((field) => field.type === "select" && (field.options ?? []).length === 0);
    if (badSelect) {
      setEditorError(`The dropdown “${badSelect.label}” needs at least one choice.`);
      return;
    }
    setSaving(true);
    setEditorError(null);
    try {
      const response = await fetch(`/api/roles/${encodeURIComponent(roleId)}/form-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: draft }),
      });
      const body = (await response.json()) as {
        url?: string;
        token?: string;
        fields?: ApplicationField[];
        status?: FormLinkStatus;
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(body.error?.message ?? "Could not save the form.");
      setSavedFields(body.fields ?? draft);
      setDraft(body.fields ?? draft);
      if (body.url) setUrl(body.url);
      if (body.token) setToken(body.token);
      applySettings(body.status);
      setPanel(null);
      setToast({ tone: "success", message: "Questions saved. New applicants see them now." });
    } catch (cause) {
      setEditorError(cause instanceof Error ? cause.message : "Could not save the form.");
    } finally {
      setSaving(false);
    }
  }

  async function revoke() {
    setSaving(true);
    try {
      const response = await fetch(`/api/roles/${encodeURIComponent(roleId)}/form-link`, { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? "Could not close the form.");
      }
      setToast({ tone: "success", message: "Form closed. Applications already received are kept." });
      setStatus((current) => (current ? { ...current, open: false, closedReason: "revoked" } : current));
    } catch (cause) {
      fail(cause, "Could not close the form.");
    } finally {
      setSaving(false);
    }
  }

  /** Re-opening brings the same link back, so links already shared work again. */
  async function reEnable() {
    setSaving(true);
    try {
      const response = await fetch(`/api/roles/${encodeURIComponent(roleId)}/form-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reenable: true }),
      });
      const body = (await response.json()) as { url?: string; status?: FormLinkStatus; error?: { message?: string } };
      if (!response.ok || !body.url) throw new Error(body.error?.message ?? "Could not reopen the form.");
      setUrl(body.url);
      applySettings(body.status);
      setToast({ tone: "success", message: "Form reopened." });
    } catch (cause) {
      fail(cause, "Could not reopen the form.");
    } finally {
      setSaving(false);
    }
  }

  function addField() {
    const id = suggestFieldId("New question", draft.map((field) => field.id));
    setDraft((current) => [...current, { id, label: "New question", type: "text", required: false }]);
  }

  /** Puts back a removable built-in field the recruiter took off the form. */
  function addBaseField(baseId: string) {
    const template = BASE_APPLICATION_FIELDS.find((field) => field.id === baseId);
    if (!template || draft.some((field) => field.id === baseId)) return;
    setDraft((current) => [...current, { ...template }]);
  }

  function updateField(index: number, patch: Partial<ApplicationField>) {
    setDraft((current) => current.map((field, position) => (position === index ? { ...field, ...patch } : field)));
  }

  function removeField(index: number) {
    setDraft((current) => current.filter((_, position) => position !== index));
  }

  function moveField(index: number, direction: -1 | 1) {
    setDraft((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  const missingOptionalBase = BASE_APPLICATION_FIELDS.filter(
    (field) =>
      (OPTIONAL_BASE_FIELD_IDS as readonly string[]).includes(field.id) && !draft.some((item) => item.id === field.id),
  );
  const questionCount = savedFields.length;
  const isOpen = !status || status.open;
  const whatsappHref = url
    ? `https://wa.me/?text=${encodeURIComponent(`Applications are open for ${roleTitle}. Apply here: ${url}`)}`
    : undefined;

  const closedNote =
    status && !status.open
      ? status.closedReason === "limit"
        ? "Closed: the application limit was reached."
        : status.closedReason === "expired"
          ? "Closed: the time limit was reached."
          : "Closed by you."
      : null;


  function toggleOpen() {
    if (saving) return;
    if (isOpen) void revoke();
    else if (status?.closedReason === "revoked") void reEnable();
    else openPanel("limits");
  }

  return (
    <section
      id="application-form"
      aria-label="Application form"
      className="scroll-mt-24 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm shadow-black/[0.02]"
    >
      <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center">
        {/* what it is + state */}
        <div className="flex min-w-0 items-center gap-3.5 lg:shrink-0">
          <span
            className={`grid size-11 shrink-0 place-items-center rounded-xl ${
              isOpen ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-foreground/[0.06] text-muted"
            }`}
          >
            <ClipboardList className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold">Application form</h2>
            {loading ? (
              <div className="skeleton mt-1.5 h-3.5 w-32 rounded" />
            ) : (
              <p className="mt-0.5 text-sm text-muted">
                <span className={isOpen ? "font-medium text-emerald-600 dark:text-emerald-400" : "font-medium"}>
                  {isOpen ? "Taking applications" : "Closed"}
                </span>
                {status && (
                  <>
                    {" "}
                    <span className="tabular-nums">
                      {status.applicationsReceived}
                      {status.maxApplications !== null ? `/${status.maxApplications}` : ""}
                    </span>{" "}
                    received, {questionCount} question{questionCount === 1 ? "" : "s"}
                  </>
                )}
              </p>
            )}
            {(closedNote || status?.expiresAt) && !loading && (
              <p className="mt-0.5 text-xs text-muted">{closedNote ?? `Closes ${formatMoment(status!.expiresAt!)}`}</p>
            )}
          </div>
        </div>

        <span className="hidden grow lg:block" />

        {/* controls */}
        {loadError ? (
          <div role="alert" className="flex flex-1 items-center gap-3 rounded-xl bg-rose-500/[0.07] px-3.5 py-2 text-sm text-rose-700 dark:text-rose-300 lg:max-w-md">
            <span className="min-w-0 flex-1">{loadError}</span>
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                setLoadError(null);
                setAttempt((value) => value + 1);
              }}
              className="h-8 shrink-0 rounded-lg bg-surface px-3 text-sm font-medium text-foreground shadow-sm transition hover:bg-foreground/[0.03]"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={isOpen}
              onClick={toggleOpen}
              disabled={loading || saving}
              title={isOpen ? "Stop taking applications" : "Start taking applications again"}
              className="mr-1 inline-flex h-9 items-center gap-2.5 rounded-lg px-2 text-sm font-medium transition hover:bg-foreground/[0.04] disabled:opacity-60"
            >
              <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${isOpen ? "bg-emerald-500" : "bg-foreground/20"}`}>
                <motion.span
                  className="absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-sm"
                  animate={{ x: isOpen ? 16 : 0 }}
                  transition={{ type: "spring", bounce: 0.25, duration: 0.35 }}
                />
              </span>
              {isOpen ? "Open" : "Closed"}
            </button>
            {whatsappHref && (
              <a
                href={whatsappHref}
                target="_blank"
                rel="noreferrer"
                title="Share on WhatsApp"
                aria-label="Share on WhatsApp"
                className={`${ghostButton} w-9 px-0 text-emerald-600 dark:text-emerald-400`}
              >
                <MessageCircle className="size-4" aria-hidden />
              </a>
            )}
            <button type="button" onClick={() => openPanel("questions")} disabled={loading} className={ghostButton}>
              <Settings2 className="size-4 text-muted" aria-hidden />
              Edit form
            </button>
            <button
              type="button"
              onClick={copy}
              disabled={!url}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3.5 text-sm font-medium text-white shadow-sm shadow-accent/20 transition hover:bg-accent/90 disabled:opacity-50"
            >
              {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
        )}
      </div>

      <Sheet
        open={panel !== null}
        onClose={() => setPanel(null)}
        title="Application form"
        description={`What applicants for ${roleTitle} fill in.`}
        width="max-w-2xl"
      >
        <SegmentedTabs
          id="form-panel"
          label="Application form settings"
          value={panel ?? "questions"}
          onChange={(next) => openPanel(next)}
          options={[
            { value: "questions", label: "Questions", count: draft.length },
            { value: "limits", label: "Limits and link" },
            { value: "preview", label: "Preview" },
          ]}
        />

        {panel === "questions" && (
          <div className="mt-5">
            <p className="text-sm text-muted">
              Applicants answer these in order. Name, phone, email and resume are always asked.
            </p>
            <ol className="mt-4 space-y-2.5">
              {draft.map((field, index) => {
                const locked = field.system === true && isMandatoryBaseField(field.id);
                return (
                  <li key={`${field.id}-${index}`} className="rounded-xl border border-border bg-surface p-3.5">
                    <div className="flex items-center gap-2">
                      <span aria-hidden className="w-5 shrink-0 text-xs font-medium tabular-nums text-muted">
                        {index + 1}
                      </span>
                      <input
                        value={field.label}
                        onChange={(event) => updateField(index, { label: event.target.value })}
                        aria-label={`Question ${index + 1}`}
                        className={`${inputClasses} min-w-0 flex-1 font-medium`}
                      />
                      <span className="flex shrink-0 items-center">
                        <button
                          type="button"
                          onClick={() => moveField(index, -1)}
                          disabled={index === 0}
                          aria-label={`Move question ${index + 1} up`}
                          className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-30"
                        >
                          <ChevronUp className="size-4" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveField(index, 1)}
                          disabled={index === draft.length - 1}
                          aria-label={`Move question ${index + 1} down`}
                          className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-30"
                        >
                          <ChevronDown className="size-4" aria-hidden />
                        </button>
                        {locked ? (
                          <span title="Always asked" className="grid size-8 place-items-center text-muted/60">
                            <Lock className="size-3.5" aria-hidden />
                            <span className="sr-only">Always asked</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => removeField(index)}
                            aria-label={`Remove question ${index + 1}`}
                            className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-rose-500/10 hover:text-rose-600"
                          >
                            <Trash2 className="size-3.5" aria-hidden />
                          </button>
                        )}
                      </span>
                    </div>

                    <div className="mt-2.5 flex flex-wrap items-center gap-3 pl-7">
                      {field.system ? (
                        <span className="text-xs text-muted">{TYPE_LABELS[field.type]}</span>
                      ) : (
                        <select
                          value={field.type}
                          onChange={(event) =>
                            updateField(index, {
                              type: event.target.value as ApplicationFieldType,
                              options:
                                event.target.value === "select"
                                  ? field.options?.length
                                    ? field.options
                                    : ["Option 1"]
                                  : undefined,
                            })
                          }
                          aria-label={`Question ${index + 1} answer type`}
                          className="h-8 rounded-lg border border-border bg-surface px-2 text-xs"
                        >
                          {CUSTOM_TYPES.map((value) => (
                            <option key={value} value={value}>
                              {TYPE_LABELS[value]}
                            </option>
                          ))}
                        </select>
                      )}
                      {locked ? (
                        <span className="text-xs text-muted">Required</span>
                      ) : (
                        <label className="inline-flex items-center gap-1.5 text-xs text-muted">
                          <input
                            type="checkbox"
                            checked={field.required}
                            onChange={(event) => updateField(index, { required: event.target.checked })}
                            className="accent-[var(--accent)]"
                          />
                          Required
                        </label>
                      )}
                    </div>

                    <div className="mt-2.5 grid gap-2 pl-7">
                      <input
                        value={field.hint ?? ""}
                        onChange={(event) => updateField(index, { hint: event.target.value })}
                        placeholder="Help text under the question (optional)"
                        aria-label={`Question ${index + 1} help text`}
                        className={inputClasses}
                      />
                      {field.type === "select" && (
                        <input
                          value={(field.options ?? []).join(", ")}
                          onChange={(event) =>
                            updateField(index, {
                              options: event.target.value
                                .split(",")
                                .map((option) => option.trim())
                                .filter(Boolean),
                            })
                          }
                          placeholder="Choices, separated by commas"
                          aria-label={`Question ${index + 1} choices`}
                          className={inputClasses}
                        />
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" onClick={addField} className={ghostButton}>
                <Plus className="size-4 text-muted" aria-hidden />
                Add a question
              </button>
              {missingOptionalBase.map((field) => (
                <button
                  key={field.id}
                  type="button"
                  onClick={() => addBaseField(field.id)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-border px-3 text-sm text-muted transition hover:border-foreground/25 hover:text-foreground"
                >
                  <Plus className="size-3.5" aria-hidden />
                  {field.label}
                </button>
              ))}
            </div>

            {editorError && (
              <p role="alert" className="mt-4 rounded-xl bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-700 dark:text-rose-300">
                {editorError}
              </p>
            )}

            <div className="sticky bottom-0 -mx-6 -mb-5 mt-5 flex justify-end gap-2 border-t border-border bg-surface px-6 py-4">
              <button
                type="button"
                onClick={() => setPanel(null)}
                className="h-9 rounded-lg px-3.5 text-sm font-medium text-muted transition hover:bg-foreground/[0.05] hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveFields}
                disabled={saving}
                className="h-9 rounded-lg bg-accent px-4 text-sm font-medium text-white shadow-sm shadow-accent/20 transition hover:bg-accent/90 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save questions"}
              </button>
            </div>
          </div>
        )}

        {panel === "limits" && (
          <div className="mt-5 grid min-w-0 grid-cols-1 gap-6">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">The link</h3>
              <div className="mt-2 flex items-center gap-1 rounded-xl border border-border bg-background/60 p-1 pl-3">
                <Link2 className="size-4 shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate px-1.5 text-sm" title={url ?? undefined}>
                  {url?.replace(/^https?:\/\//, "")}
                </span>
                <button
                  type="button"
                  onClick={copy}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-white transition hover:bg-accent/90"
                >
                  {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold">Close the form automatically</h3>
              <p className="mt-0.5 text-sm text-muted">Leave a box empty for no limit.</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  <span className="mb-1.5 block text-muted">After this many applications</span>
                  <input
                    inputMode="numeric"
                    value={limitInput}
                    onChange={(event) => setLimitInput(event.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="No limit"
                    className={inputClasses}
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1.5 block text-muted">After this many hours</span>
                  <input
                    inputMode="numeric"
                    value={hoursInput}
                    onChange={(event) => setHoursInput(event.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="No time limit"
                    className={inputClasses}
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={saveSettings}
                disabled={savingSettings || saving}
                className="mt-3 h-9 rounded-lg bg-accent px-4 text-sm font-medium text-white transition hover:bg-accent/90 disabled:opacity-50"
              >
                {savingSettings ? "Saving…" : "Save limits"}
              </button>
            </div>

            <div className="border-t border-border pt-5">
              <h3 className="text-sm font-semibold">Start over with a new link</h3>
              <p className="mt-0.5 max-w-prose text-sm text-muted">
                The link you have shared stops working and the count starts again. Applications already received are kept.
              </p>
              <button type="button" onClick={() => setConfirmRotate(true)} disabled={saving} className={`${ghostButton} mt-3`}>
                Create a new link
              </button>
            </div>
          </div>
        )}

        {panel === "preview" && (
          <div className="mt-5 rounded-2xl border border-border bg-background p-4 sm:p-6">
            <ApplicationForm token={token} roleTitle={roleTitle} roleDescription={roleDescription} fields={draft} preview />
          </div>
        )}
      </Sheet>

      <ConfirmDialog
        open={confirmRotate}
        title="Create a new link?"
        body="Anyone with the current link can no longer apply. Applications already received are kept."
        confirmLabel="Create new link"
        busy={saving}
        onConfirm={createNewLink}
        onCancel={() => setConfirmRotate(false)}
      />
      <Toast toast={toast} onDismiss={dismissToast} />
    </section>
  );
}
