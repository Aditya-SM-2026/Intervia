"use client";

import { useState } from "react";
import type { RoleSummary } from "@/lib/roles/role.types";
import { Sheet } from "@/components/ui/Sheet";
import { DocumentText } from "@/components/ui/DocumentText";
import { SegmentedTabs } from "@/components/ui/animated";

export const fieldClasses =
  "w-full rounded-xl border border-border bg-background/50 px-3.5 py-2.5 text-sm outline-none transition placeholder:text-muted focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/15";

function splitSkills(value: string): string[] {
  return value
    .split(",")
    .map((skill) => skill.trim())
    .filter((skill) => skill !== "");
}

/**
 * Create or edit a role in a side sheet. The job description can be
 * previewed exactly as candidates and the hiring team will read it.
 */
export function RoleFormSheet({
  open,
  role,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** The role to edit; omit to create a new one. */
  role?: RoleSummary | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const editing = Boolean(role);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing ? "Edit role" : "New role"}
      description={
        editing
          ? "Changes apply to new interviews. Reports already written keep the version they were scored against."
          : "Candidates are interviewed and scored against this description."
      }
      width="max-w-2xl"
    >
      {/* Remount per role so the fields start from its current values. */}
      <RoleForm key={role?.id ?? "new"} role={role ?? null} onCancel={onClose} onSaved={onSaved} />
    </Sheet>
  );
}

function RoleForm({
  role,
  onCancel,
  onSaved,
}: {
  role: RoleSummary | null;
  onCancel: () => void;
  onSaved: (message: string) => void;
}) {
  const [title, setTitle] = useState(role?.title ?? "");
  const [deadline, setDeadline] = useState(role?.deadline ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [skills, setSkills] = useState(role?.skills.join(", ") ?? "");
  const [view, setView] = useState<"write" | "preview">("write");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(role ? `/api/roles/${role.id}` : "/api/roles", {
        method: role ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          skills: splitSkills(skills),
          deadline: deadline.trim() === "" ? null : deadline,
        }),
      });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Could not save the role.");
      onSaved(role ? "Role saved." : "Role created.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the role.");
    } finally {
      setSaving(false);
    }
  }

  const skillList = splitSkills(skills);

  return (
    <form onSubmit={save} className="grid gap-5" aria-label={role ? `Edit role ${role.title}` : "Create role"}>
      <div className="grid gap-4 sm:grid-cols-[1fr_11rem]">
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Role title</span>
          <input
            name="title"
            required
            minLength={2}
            maxLength={120}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Backend developer"
            className={fieldClasses}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">
            Deadline <span className="font-normal text-muted">(optional)</span>
          </span>
          <input
            name="deadline"
            type="date"
            value={deadline}
            onChange={(event) => setDeadline(event.target.value)}
            className={fieldClasses}
          />
        </label>
      </div>

      <div className="text-sm">
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <span id="jd-label" className="font-medium">
            Job description
          </span>
          <SegmentedTabs
            id="jd-view"
            label="Job description view"
            value={view}
            onChange={setView}
            options={[
              { value: "write", label: "Write" },
              { value: "preview", label: "Preview" },
            ]}
          />
        </div>
        {view === "write" ? (
          <>
            <textarea
              name="description"
              aria-labelledby="jd-label"
              required
              minLength={10}
              maxLength={20000}
              rows={16}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={"About the role\nWhat the person will do and who they work with.\n\nResponsibilities\n- Build and look after the APIs\n- Review code with the team\n\nLocation: Hyderabad\nExperience: 0–2 years"}
              className={`${fieldClasses} resize-y leading-6`}
            />
            <p className="mt-1.5 text-xs text-muted">
              Short lines become headings, lines starting with “-” become lists, and “Label: value” lines become a
              details table.
            </p>
          </>
        ) : (
          <div className="min-h-[24rem] rounded-xl border border-border px-5 py-4">
            {description.trim() ? (
              <DocumentText text={description} />
            ) : (
              <p className="text-muted">Nothing to preview yet.</p>
            )}
          </div>
        )}
      </div>

      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">
          Skills to test <span className="font-normal text-muted">(comma separated)</span>
        </span>
        <input
          name="skills"
          value={skills}
          onChange={(event) => setSkills(event.target.value)}
          placeholder="Python, SQL, REST APIs"
          className={fieldClasses}
        />
        {skillList.length > 0 && (
          <span className="mt-2 flex flex-wrap gap-1.5">
            {skillList.map((skill) => (
              <span key={skill} className="rounded-md bg-foreground/[0.05] px-2 py-0.5 text-xs font-medium text-foreground/80">
                {skill}
              </span>
            ))}
          </span>
        )}
      </label>

      {error && (
        <p role="alert" className="rounded-xl bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </p>
      )}

      <div className="sticky bottom-0 -mx-6 -mb-5 flex items-center justify-end gap-2 border-t border-border bg-surface px-6 py-4">
        <button
          type="button"
          onClick={onCancel}
          className="h-9 rounded-lg px-3.5 text-sm font-medium text-muted transition hover:bg-foreground/[0.05] hover:text-foreground"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="h-9 rounded-lg bg-accent px-4 text-sm font-medium text-white shadow-sm shadow-accent/20 transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : role ? "Save role" : "Create role"}
        </button>
      </div>
    </form>
  );
}
