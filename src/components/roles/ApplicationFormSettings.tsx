"use client";

import { useEffect, useState } from "react";
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

const inputClasses =
  "h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20";

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

type Mode = "closed" | "edit" | "preview";

function cloneFields(fields: ApplicationField[]): ApplicationField[] {
  return fields.map((field) => ({ ...field, options: field.options ? [...field.options] : undefined }));
}

/**
 * The role's public application form: the shareable link, the full question
 * list the candidate sees, and an editor for it. Built-in fields are shown
 * alongside the recruiter's questions, can be relabelled, reordered or made
 * optional, and the essential ones are locked so an application always
 * carries a name, phone number, email and resume.
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
  const [mode, setMode] = useState<Mode>("closed");
  const [returnAfterPreview, setReturnAfterPreview] = useState<Mode>("edit");
  const [status, setStatus] = useState<FormLinkStatus | null>(null);
  const [limitInput, setLimitInput] = useState("");
  const [hoursInput, setHoursInput] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/roles/${encodeURIComponent(roleId)}/form-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
      .then(async (response) => {
        const body = (await response.json()) as {
          url?: string;
          token?: string;
          fields?: ApplicationField[];
          status?: FormLinkStatus;
          error?: { message?: string };
        };
        if (!response.ok || !body.url) {
          throw new Error(body.error?.message ?? "Could not prepare the form link.");
        }
        if (cancelled) return;
        setUrl(body.url);
        setToken(body.token ?? "");
        setSavedFields(body.fields ?? []);
        setDraft(body.fields ?? []);
        applySettings(body.status);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(
            cause instanceof Error ? cause.message : "Could not prepare the form link.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [roleId]);

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
      setMessage("Form link copied. Share it with the college group.");
    } catch {
      setMessage(url);
    }
  }

  /** Saves the link's own limits: close after N applications or N hours. */
  async function saveSettings() {
    setSavingSettings(true);
    setError(null);
    try {
      const response = await fetch(`/api/roles/${encodeURIComponent(roleId)}/form-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: { maxApplications: limitInput, expiresAfterHours: hoursInput },
        }),
      });
      const body = (await response.json()) as {
        url?: string;
        status?: FormLinkStatus;
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(body.error?.message ?? "Could not save the link limits.");
      if (body.url) setUrl(body.url);
      applySettings(body.status);
      setMessage("Link limits saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the link limits.");
    } finally {
      setSavingSettings(false);
    }
  }

  /**
   * Issues a brand-new link. The current token stops working at once, so an
   * old WhatsApp post cannot collect more applications.
   */
  async function createNewLink() {
    const confirmed = window.confirm(
      "Create a new link? The link you have now stops working immediately, so anyone with the old one cannot apply. Applications already received are kept.",
    );
    if (!confirmed) return;
    setSaving(true);
    setError(null);
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
      if (!response.ok || !body.url) {
        throw new Error(body.error?.message ?? "Could not create a new link.");
      }
      setUrl(body.url);
      setToken(body.token ?? "");
      if (body.fields) {
        setSavedFields(body.fields);
        setDraft(body.fields);
      }
      applySettings(body.status);
      setMode("closed");
      setMessage("New link created. The previous link no longer works.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create a new link.");
    } finally {
      setSaving(false);
    }
  }

  function startEditing() {
    setDraft(cloneFields(savedFields));
    setMode("edit");
    setError(null);
    setMessage(null);
  }

  function startPreview() {
    if (mode !== "edit") setDraft(cloneFields(savedFields));
    setMode("preview");
    setError(null);
  }

  function cancelEditing() {
    setDraft(cloneFields(savedFields));
    setMode("closed");
    setError(null);
  }

  async function saveFields() {
    if (draft.some((field) => field.label.trim() === "")) {
      setError("Every question needs a label.");
      return;
    }
    const badSelect = draft.find(
      (field) => field.type === "select" && (field.options ?? []).length === 0,
    );
    if (badSelect) {
      setError(`The dropdown "${badSelect.label}" needs at least one choice.`);
      return;
    }

    setSaving(true);
    setError(null);
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
      setMode("closed");
      setMessage("Form saved. Candidates opening the link now see these questions.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the form.");
    } finally {
      setSaving(false);
    }
  }

  async function revoke() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/roles/${encodeURIComponent(roleId)}/form-link`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? "Could not turn the link off.");
      }
      setMessage("Form link turned off. Applications already received are kept.");
      setStatus((current) =>
        current ? { ...current, open: false, closedReason: "revoked" } : current,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not turn the link off.");
    } finally {
      setSaving(false);
    }
  }

  /** Sharing again brings the same link back, so old copies keep working. */
  async function reEnable() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/roles/${encodeURIComponent(roleId)}/form-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reenable: true }),
      });
      const body = (await response.json()) as {
        url?: string;
        status?: FormLinkStatus;
        error?: { message?: string };
      };
      if (!response.ok || !body.url) throw new Error(body.error?.message ?? "Could not re-enable the link.");
      setUrl(body.url);
      applySettings(body.status);
      setMessage("Form link is active again.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not re-enable the link.");
    } finally {
      setSaving(false);
    }
  }

  function addField() {
    const id = suggestFieldId(
      "New question",
      draft.map((field) => field.id),
    );
    setDraft((current) => [
      ...current,
      { id, label: "New question", type: "text", required: false },
    ]);
  }

  /** Puts back a removable built-in field the recruiter took off the form. */
  function addBaseField(baseId: string) {
    const template = BASE_APPLICATION_FIELDS.find((field) => field.id === baseId);
    if (!template || draft.some((field) => field.id === baseId)) return;
    setDraft((current) => [...current, { ...template }]);
  }

  function updateField(index: number, patch: Partial<ApplicationField>) {
    setDraft((current) =>
      current.map((field, position) => (position === index ? { ...field, ...patch } : field)),
    );
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

  const previewFields = mode === "edit" ? draft : savedFields;
  const missingOptionalBase = BASE_APPLICATION_FIELDS.filter(
    (field) =>
      (OPTIONAL_BASE_FIELD_IDS as readonly string[]).includes(field.id) &&
      !draft.some((item) => item.id === field.id),
  );
  const questionCount = savedFields.length;

  const whatsappHref = url
    ? `https://wa.me/?text=${encodeURIComponent(
        `Applications are open for ${roleTitle}. Apply here: ${url}`,
      )}`
    : undefined;

  return (
    <section
      id="application-form"
      className="mt-6 scroll-mt-24 rounded-lg border border-border bg-surface p-5"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-lg font-semibold">Application form</h3>
        <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">
          {questionCount} question{questionCount === 1 ? "" : "s"}
        </span>
        <span className="grow" />
        <button
          type="button"
          onClick={
            mode === "preview"
              ? () => setMode(returnAfterPreview)
              : () => {
                  setReturnAfterPreview(mode === "edit" ? "edit" : "closed");
                  startPreview();
                }
          }
          aria-expanded={mode === "preview"}
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium transition hover:border-accent/50"
        >
          {mode === "preview" ? "Close preview" : "Preview"}
        </button>
        <button
          type="button"
          onClick={mode === "edit" ? cancelEditing : startEditing}
          aria-expanded={mode === "edit"}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent/90"
        >
          {mode === "edit" ? "Close editor" : "Edit form"}
        </button>
      </div>

      <p className="mt-1 text-sm text-muted">
        Share this link with a college group. Applicants fill in the questions below without an
        account, and the application appears in the table below as Waiting.
      </p>

      {loading ? (
        <div aria-hidden className="mt-4 h-10 w-full animate-pulse rounded-lg bg-border/40" />
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              readOnly
              value={url ?? ""}
              aria-label="Application form link"
              className="h-9 w-full min-w-0 basis-full rounded-lg border border-border bg-background px-3 text-sm text-muted sm:w-auto sm:flex-1 sm:basis-0"
            />
            <button
              type="button"
              onClick={copy}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent/90"
            >
              Copy link
            </button>
            {whatsappHref && (
              <a
                href={whatsappHref}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium transition hover:border-accent/50"
              >
                Share on WhatsApp
              </a>
            )}
            {(!status || status.open) && (
              <button
                type="button"
                onClick={revoke}
                disabled={saving}
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted transition hover:border-red-500/50 hover:text-red-600 disabled:opacity-60 dark:hover:text-red-400"
              >
                Turn off
              </button>
            )}
            {status?.closedReason === "revoked" && (
              <button
                type="button"
                onClick={reEnable}
                disabled={saving}
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-accent transition hover:border-accent/50 disabled:opacity-60"
              >
                Re-enable
              </button>
            )}
          </div>

          {status && (
            <div className="mt-3 rounded-lg border border-border bg-background p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    status.open
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                      : "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"
                  }`}
                >
                  {status.open ? "Open" : "Closed"}
                </span>
                <span className="text-sm">
                  {status.applicationsReceived} application
                  {status.applicationsReceived === 1 ? "" : "s"}
                  {status.maxApplications !== null ? ` of ${status.maxApplications}` : ""} received
                </span>
                {!status.open && (
                  <span className="text-sm text-muted">
                    {status.closedReason === "limit"
                      ? "The application limit was reached."
                      : status.closedReason === "expired"
                        ? "The time limit was reached."
                        : "You turned this link off."}
                  </span>
                )}
              </div>
              {status.expiresAt && (
                <p className="mt-1 text-xs text-muted">
                  {status.closedReason === "expired" ? "Closed on" : "Closes on"}{" "}
                  {new Date(status.expiresAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="text-xs text-muted">
                  <span className="mb-1 block">Maximum applications</span>
                  <input
                    inputMode="numeric"
                    min={0}
                    value={limitInput}
                    onChange={(event) => setLimitInput(event.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="No limit"
                    className={`${inputClasses} w-32`}
                  />
                </label>
                <label className="text-xs text-muted">
                  <span className="mb-1 block">Open for (hours)</span>
                  <input
                    inputMode="numeric"
                    min={0}
                    value={hoursInput}
                    onChange={(event) => setHoursInput(event.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="No deadline"
                    className={`${inputClasses} w-32`}
                  />
                </label>
                <button
                  type="button"
                  onClick={saveSettings}
                  disabled={savingSettings || saving}
                  className="h-9 rounded-md border border-border px-3 text-sm font-medium transition hover:border-accent/50 disabled:opacity-60"
                >
                  {savingSettings ? "Saving…" : "Save limits"}
                </button>
                <span className="grow" />
                <button
                  type="button"
                  onClick={createNewLink}
                  disabled={saving}
                  className="h-9 rounded-md border border-accent/50 px-3 text-sm font-medium text-accent transition hover:bg-accent/5 disabled:opacity-60"
                >
                  Create new link
                </button>
              </div>
              <p className="mt-1.5 text-xs text-muted">
                Leave a box empty for no limit. A new link gets a fresh URL and a fresh count,
                and the link you have now stops working for good.
              </p>
            </div>
          )}

          {message && (
            <p role="status" className="mt-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400">
              {message}
            </p>
          )}
          {error && (
            <p role="alert" className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          {mode === "edit" && (
            <div className="mt-4 rounded-lg border border-border bg-background p-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <p className="text-xs uppercase tracking-wide text-muted">Questions in order</p>
                <span className="text-xs text-muted">
                  Built-in fields are marked; essential ones cannot be removed.
                </span>
              </div>

              <ol className="mt-3 space-y-3">
                {draft.map((field, index) => {
                  const locked = field.system === true && isMandatoryBaseField(field.id);
                  return (
                    <li
                      key={`${field.id}-${index}`}
                      className="rounded-lg border border-border bg-surface p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          aria-hidden
                          className="grid size-6 shrink-0 place-items-center rounded-full bg-accent/10 text-xs font-semibold text-accent"
                        >
                          {index + 1}
                        </span>
                        <input
                          value={field.label}
                          onChange={(event) => updateField(index, { label: event.target.value })}
                          aria-label={`Question ${index + 1} label`}
                          className={`${inputClasses} min-w-0 flex-1 sm:min-w-[14rem]`}
                        />
                        {field.system && (
                          <span className="rounded-full bg-background px-2 py-0.5 text-[11px] font-medium text-muted">
                            Built-in
                          </span>
                        )}
                        {field.required ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                            Required
                          </span>
                        ) : (
                          <span className="rounded-full bg-background px-2 py-0.5 text-[11px] font-medium text-muted">
                            Optional
                          </span>
                        )}
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {field.system ? (
                          <span className="rounded-md border border-border px-2 py-1 text-xs text-muted">
                            {TYPE_LABELS[field.type]}
                          </span>
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
                            aria-label={`Question ${index + 1} type`}
                            className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
                          >
                            {CUSTOM_TYPES.map((value) => (
                              <option key={value} value={value}>
                                {TYPE_LABELS[value]}
                              </option>
                            ))}
                          </select>
                        )}

                        {locked ? (
                          <span className="text-xs text-muted">Required (built-in)</span>
                        ) : (
                          <label className="flex items-center gap-1.5 text-xs text-muted">
                            <input
                              type="checkbox"
                              checked={field.required}
                              onChange={(event) =>
                                updateField(index, { required: event.target.checked })
                              }
                            />
                            Required
                          </label>
                        )}

                        <span className="grow" />

                        <button
                          type="button"
                          onClick={() => moveField(index, -1)}
                          disabled={index === 0}
                          aria-label={`Move question ${index + 1} up`}
                          className="rounded border border-border px-2 py-1 text-xs transition hover:border-accent/50 disabled:opacity-40"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => moveField(index, 1)}
                          disabled={index === draft.length - 1}
                          aria-label={`Move question ${index + 1} down`}
                          className="rounded border border-border px-2 py-1 text-xs transition hover:border-accent/50 disabled:opacity-40"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => removeField(index)}
                          disabled={locked}
                          title={
                            locked
                              ? "This field is needed to create and follow up on an application."
                              : undefined
                          }
                          className="rounded border border-border px-2 py-1 text-xs text-red-600 transition hover:border-red-500/50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-400"
                        >
                          Delete
                        </button>
                      </div>

                      <input
                        value={field.hint ?? ""}
                        onChange={(event) => updateField(index, { hint: event.target.value })}
                        placeholder="Description / helper text (optional)"
                        aria-label={`Question ${index + 1} description`}
                        className={`${inputClasses} mt-2`}
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
                          placeholder="Choices separated by commas"
                          aria-label={`Question ${index + 1} choices`}
                          className={`${inputClasses} mt-2`}
                        />
                      )}
                    </li>
                  );
                })}
              </ol>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={addField}
                  className="rounded-md border border-border px-3 py-1.5 text-sm font-medium transition hover:border-accent/50"
                >
                  Add question
                </button>
                {missingOptionalBase.map((field) => (
                  <button
                    key={field.id}
                    type="button"
                    onClick={() => addBaseField(field.id)}
                    className="rounded-md border border-dashed border-border px-3 py-1.5 text-sm font-medium text-accent transition hover:border-accent/50"
                  >
                    Add {field.label}
                  </button>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
                <button
                  type="button"
                  onClick={cancelEditing}
                  disabled={saving}
                  className="rounded-md border border-border px-3 py-1.5 text-sm font-medium transition hover:border-accent/50 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveFields}
                  disabled={saving}
                  className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:bg-accent/90 disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save form"}
                </button>
              </div>
            </div>
          )}

          {mode === "preview" && (
            <div className="mt-4 rounded-lg border border-border bg-background p-3 sm:p-5">
              <ApplicationForm
                token={token}
                roleTitle={roleTitle}
                roleDescription={roleDescription}
                fields={previewFields}
                preview
              />
            </div>
          )}
        </>
      )}
    </section>
  );
}
