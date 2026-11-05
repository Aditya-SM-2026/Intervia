"use client";

import { useEffect, useState } from "react";
import type {
  ApplicationField,
  ApplicationFieldType,
} from "@/lib/roles/application.types";
import { suggestFieldId } from "@/lib/roles/application.types";

const inputClasses =
  "h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20";

const TYPE_LABELS: Record<ApplicationFieldType, string> = {
  text: "Short answer",
  textarea: "Long answer",
  number: "Number",
  select: "Dropdown",
  yesno: "Yes / No",
};

/**
 * The role's public application form: the shareable link, plus the extra
 * questions HR wants to ask. The five identity fields are fixed and always
 * asked, so they are not editable here.
 */
export function ApplicationFormSettings({
  roleId,
  roleTitle,
}: {
  roleId: string;
  roleTitle: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [fields, setFields] = useState<ApplicationField[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
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
          fields?: ApplicationField[];
          error?: { message?: string };
        };
        if (!response.ok || !body.url) {
          throw new Error(body.error?.message ?? "Could not prepare the form link.");
        }
        if (cancelled) return;
        setUrl(body.url);
        setFields(body.fields ?? []);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not prepare the form link.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [roleId]);

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Form link copied. Share it with the college group.");
    } catch {
      setMessage(url);
    }
  }

  async function saveFields() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/roles/${encodeURIComponent(roleId)}/form-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      });
      const body = (await response.json()) as {
        url?: string;
        fields?: ApplicationField[];
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(body.error?.message ?? "Could not save the form.");
      setFields(body.fields ?? fields);
      if (body.url) setUrl(body.url);
      setEditing(false);
      setMessage("Form saved. New applications will ask these questions.");
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
        body: JSON.stringify({}),
      });
      const body = (await response.json()) as { url?: string; error?: { message?: string } };
      if (!response.ok || !body.url) throw new Error(body.error?.message ?? "Could not re-enable the link.");
      setUrl(body.url);
      setMessage("Form link is active again.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not re-enable the link.");
    } finally {
      setSaving(false);
    }
  }

  function addField() {
    const id = suggestFieldId("New question", fields.map((field) => field.id));
    setFields((current) => [
      ...current,
      { id, label: "New question", type: "text", required: false },
    ]);
    setEditing(true);
  }

  function updateField(index: number, patch: Partial<ApplicationField>) {
    setFields((current) =>
      current.map((field, position) => (position === index ? { ...field, ...patch } : field)),
    );
  }

  function removeField(index: number) {
    setFields((current) => current.filter((_, position) => position !== index));
  }

  function moveField(index: number, direction: -1 | 1) {
    setFields((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

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
          {fields.length === 0
            ? "Name, phone, email, roll number and resume"
            : `+${fields.length} extra question${fields.length === 1 ? "" : "s"}`}
        </span>
        <span className="grow" />
        <button
          type="button"
          onClick={() => setEditing((current) => !current)}
          aria-expanded={editing}
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium transition hover:border-accent/50"
        >
          {editing ? "Close editor" : "Edit questions"}
        </button>
      </div>

      <p className="mt-1 text-sm text-muted">
        Share this link with a college group. Applicants fill it in without an account, and the
        application appears in the table below as Waiting.
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
              className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm text-muted"
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
            <button
              type="button"
              onClick={revoke}
              disabled={saving}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted transition hover:border-red-500/50 hover:text-red-600 disabled:opacity-60 dark:hover:text-red-400"
            >
              Turn off
            </button>
            <button
              type="button"
              onClick={reEnable}
              disabled={saving}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-accent transition hover:border-accent/50 disabled:opacity-60"
            >
              Re-enable
            </button>
          </div>

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

          {editing && (
            <div className="mt-4 rounded-lg border border-border bg-background p-4">
              <p className="text-xs uppercase tracking-wide text-muted">Extra questions</p>
              {fields.length === 0 ? (
                <p className="mt-2 text-sm text-muted">
                  None yet. Add CGPA, branch, graduation year or anything else you need.
                </p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {fields.map((field, index) => (
                    <li key={`${field.id}-${index}`} className="rounded-lg border border-border bg-surface p-3">
                      <div className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_auto]">
                        <input
                          value={field.label}
                          onChange={(event) => updateField(index, { label: event.target.value })}
                          aria-label={`Question ${index + 1} label`}
                          className={inputClasses}
                        />
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
                          className={inputClasses}
                        >
                          {Object.entries(TYPE_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="flex items-center gap-1.5 text-xs text-muted">
                            <input
                              type="checkbox"
                              checked={field.required}
                              onChange={(event) => updateField(index, { required: event.target.checked })}
                            />
                            Required
                          </label>
                          <button
                            type="button"
                            onClick={() => moveField(index, -1)}
                            aria-label="Move up"
                            className="rounded border border-border px-2 py-1 text-xs"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => moveField(index, 1)}
                            aria-label="Move down"
                            className="rounded border border-border px-2 py-1 text-xs"
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            onClick={() => removeField(index)}
                            className="rounded border border-border px-2 py-1 text-xs text-red-600 dark:text-red-400"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
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
                  ))}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={addField}
                  className="rounded-md border border-border px-3 py-1.5 text-sm font-medium transition hover:border-accent/50"
                >
                  Add question
                </button>
                <span className="grow" />
                <button
                  type="button"
                  onClick={saveFields}
                  disabled={saving}
                  className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent/90 disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save form"}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
