"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, Check, Copy, KeyRound, Power, RefreshCw, ShieldCheck, UserPlus } from "lucide-react";
import { OWNER_ID } from "@/lib/auth/accounts.logic";
import { Sheet } from "@/components/ui/Sheet";
import { Toast, type ToastMessage } from "@/components/ui/Toast";
import type { PublicMember } from "@/lib/team/public-member";

const inputClass =
  "w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/10";
const primaryButton =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60";
const quietButton =
  "inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium transition hover:bg-foreground/[0.04] disabled:opacity-60";

/** A readable starting password: four short word-like chunks and digits. */
function generatePassword(): string {
  const letters = "abcdefghjkmnpqrstuvwxyz";
  const bytes = new Uint8Array(14);
  crypto.getRandomValues(bytes);
  const chunk = (from: number) => Array.from(bytes.slice(from, from + 4), (b) => letters[b % letters.length]).join("");
  return `${chunk(0)}-${chunk(4)}-${chunk(8)}-${(bytes[12] * 256 + bytes[13]) % 9000 + 1000}`;
}

// Server and browser time zones differ; the browser's rendering wins.
function formatDate(value: string | null): string {
  if (!value) return "Never";
  return new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

type FieldErrors = Record<string, string>;

async function send(url: string, method: string, body: unknown) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as {
    member?: PublicMember;
    sessionsEnded?: number;
    error?: { message?: string; fields?: FieldErrors };
  };
  return { ok: response.ok, data };
}

/** Who can sign in, and the controls the admin uses to manage them. */
export function TeamManager({ initial, ownerName }: { initial: PublicMember[]; ownerName: string }) {
  const [members, setMembers] = useState(initial);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [adding, setAdding] = useState(false);
  const [resetFor, setResetFor] = useState<PublicMember | null>(null);
  const [confirmOff, setConfirmOff] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const replace = (member: PublicMember) => setMembers((list) => list.map((m) => (m.id === member.id ? member : m)));

  async function toggle(member: PublicMember) {
    setBusy(member.id);
    const { ok, data } = await send(`/api/team/${member.id}`, "PATCH", { active: !member.active });
    setBusy(null);
    setConfirmOff(null);
    if (!ok || !data.member) {
      setToast({ tone: "error", message: data.error?.message ?? "That did not save. Try again." });
      return;
    }
    replace(data.member);
    setToast({
      tone: "success",
      message: data.member.active ? `${member.name} can sign in again.` : `${member.name} is turned off and signed out everywhere.`,
    });
  }

  return (
    <div className="grid gap-6">
      <section className="rounded-2xl border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h2 className="font-semibold tracking-tight">
            People who can sign in <span className="ml-1 text-sm font-medium text-muted tabular-nums">{members.length + 1}</span>
          </h2>
          <button type="button" className={primaryButton} onClick={() => setAdding(true)}>
            <UserPlus className="size-4" aria-hidden />
            Add person
          </button>
        </div>

        <ul className="divide-y divide-border">
          <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent/10 text-accent">
              <ShieldCheck className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 grow">
              <p className="font-medium">{ownerName}</p>
              <p className="text-sm text-muted">Admin login. Its password is set on the server.</p>
            </div>
            <span className="rounded-full bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent">Admin</span>
            <Link href={`/dashboard/settings/team/${OWNER_ID}`} className={quietButton}>
              <ArrowUpRight className="size-3.5" aria-hidden />
              View activity
            </Link>
          </li>

          {members.length === 0 && (
            <li className="px-5 py-8 text-center">
              <p className="font-medium">No team members yet</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted">
                Add the people who hire with you. Each gets their own login, and everything they do is recorded under their name.
              </p>
            </li>
          )}

          {members.map((member) => (
            <li key={member.id} className={`flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4 ${member.active ? "" : "bg-foreground/[0.015]"}`}>
              <span
                className={`grid size-9 shrink-0 place-items-center rounded-full text-sm font-semibold ${
                  member.active ? "bg-foreground/[0.06]" : "bg-foreground/[0.03] text-muted"
                }`}
                aria-hidden
              >
                {member.name.charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 grow basis-56">
                <p className={`font-medium ${member.active ? "" : "text-muted"}`}>{member.name}</p>
                <p className="truncate text-sm text-muted">{member.email}</p>
              </div>
              <dl className="grid grid-cols-2 gap-x-6 text-sm">
                <dt className="text-xs text-muted">Last sign-in</dt>
                <dt className="text-xs text-muted">Added</dt>
                <dd suppressHydrationWarning className="tabular-nums">{formatDate(member.lastSignInAt)}</dd>
                <dd suppressHydrationWarning className="tabular-nums">{formatDate(member.createdAt).replace(/, \d+:\d+ [AP]M$/, "")}</dd>
              </dl>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                  member.active ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-foreground/[0.06] text-muted"
                }`}
              >
                {member.active ? "Active" : "Off"}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {confirmOff === member.id ? (
                  <>
                    <span className="text-xs text-muted">Sign them out everywhere?</span>
                    <button type="button" className={`${quietButton} border-red-500/40 text-red-600 dark:text-red-400`} disabled={busy === member.id} onClick={() => void toggle(member)}>
                      Turn off
                    </button>
                    <button type="button" className={quietButton} onClick={() => setConfirmOff(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <Link href={`/dashboard/settings/team/${member.id}`} className={quietButton}>
                      <ArrowUpRight className="size-3.5" aria-hidden />
                      View activity
                    </Link>
                    {member.active && (
                      <button type="button" className={quietButton} onClick={() => setResetFor(member)}>
                        <KeyRound className="size-3.5" aria-hidden />
                        Reset password
                      </button>
                    )}
                    <button
                      type="button"
                      className={quietButton}
                      disabled={busy === member.id}
                      onClick={() => (member.active ? setConfirmOff(member.id) : void toggle(member))}
                    >
                      <Power className="size-3.5" aria-hidden />
                      {member.active ? "Turn off" : "Turn on"}
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <AddPersonSheet
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={(member) => {
          setMembers((list) => [...list, member]);
          setToast({ tone: "success", message: `${member.name} can now sign in with ${member.email}.` });
        }}
      />
      <ResetPasswordSheet
        member={resetFor}
        onClose={() => setResetFor(null)}
        onDone={(member) => setToast({ tone: "success", message: `New password set for ${member.name}. They were signed out everywhere.` })}
      />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

function PasswordField({ id, value, onChange, error }: { id: string; value: string; onChange: (v: string) => void; error?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        Starting password
      </label>
      <div className="flex gap-2">
        <input id={id} type="text" autoComplete="off" spellCheck={false} value={value} onChange={(e) => onChange(e.target.value)} className={`${inputClass} font-mono`} aria-invalid={Boolean(error)} aria-describedby={`${id}-hint`} />
        <button type="button" className={quietButton} onClick={() => onChange(generatePassword())} aria-label="Make a new password">
          <RefreshCw className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          className={quietButton}
          aria-label="Copy password"
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
        </button>
      </div>
      <p id={`${id}-hint`} className={`mt-1.5 text-xs ${error ? "text-red-600 dark:text-red-400" : "text-muted"}`}>
        {error ?? "At least 10 characters. Share it with them yourself; they can change it after signing in."}
      </p>
    </div>
  );
}

function AddPersonSheet({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (m: PublicMember) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(generatePassword);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    const { ok, data } = await send("/api/team", "POST", { name, email, password });
    setSaving(false);
    if (!ok || !data.member) {
      setErrors(data.error?.fields ?? { form: data.error?.message ?? "That did not save. Try again." });
      return;
    }
    onAdded(data.member);
    setName("");
    setEmail("");
    setPassword(generatePassword());
    setErrors({});
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add a person">
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <div>
          <label htmlFor="member-name" className="mb-1.5 block text-sm font-medium">Name</label>
          <input id="member-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Priya Sharma" aria-invalid={Boolean(errors.name)} />
          {errors.name && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{errors.name}</p>}
        </div>
        <div>
          <label htmlFor="member-email" className="mb-1.5 block text-sm font-medium">Email</label>
          <input id="member-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="priya@medhasacademy.com" aria-invalid={Boolean(errors.email)} />
          <p className={`mt-1.5 text-xs ${errors.email ? "text-red-600 dark:text-red-400" : "text-muted"}`}>{errors.email ?? "They sign in with this email."}</p>
        </div>
        <PasswordField id="member-password" value={password} onChange={setPassword} error={errors.password} />
        {errors.form && <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">{errors.form}</p>}
        <p className="rounded-xl bg-foreground/[0.04] px-4 py-3 text-sm text-muted">
          They can do everything except manage the team. Everything they do is recorded under their name.
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded-xl px-4 py-2.5 text-sm font-medium text-muted hover:text-foreground" onClick={onClose}>Cancel</button>
          <button type="submit" className={primaryButton} disabled={saving}>{saving ? "Adding…" : "Add person"}</button>
        </div>
      </form>
    </Sheet>
  );
}

function ResetPasswordSheet({ member, onClose, onDone }: { member: PublicMember | null; onClose: () => void; onDone: (m: PublicMember) => void }) {
  const [password, setPassword] = useState(generatePassword);
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!member) return;
    setSaving(true);
    const { ok, data } = await send(`/api/team/${member.id}`, "PATCH", { password });
    setSaving(false);
    if (!ok || !data.member) {
      setError(data.error?.fields?.password ?? data.error?.message ?? "That did not save. Try again.");
      return;
    }
    onDone(data.member);
    setPassword(generatePassword());
    setError(undefined);
    onClose();
  }

  return (
    <Sheet open={member !== null} onClose={onClose} title={member ? `New password for ${member.name}` : "New password"}>
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <PasswordField id="reset-password" value={password} onChange={setPassword} error={error} />
        <p className="rounded-xl bg-foreground/[0.04] px-4 py-3 text-sm text-muted">
          They are signed out on every device and sign in again with this password.
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded-xl px-4 py-2.5 text-sm font-medium text-muted hover:text-foreground" onClick={onClose}>Cancel</button>
          <button type="submit" className={primaryButton} disabled={saving}>{saving ? "Saving…" : "Set password"}</button>
        </div>
      </form>
    </Sheet>
  );
}
