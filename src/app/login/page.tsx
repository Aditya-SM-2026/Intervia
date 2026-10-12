import type { Metadata } from "next";
import { BrandMark } from "@/components/brand/BrandMark";
import { LoginForm } from "@/components/auth/LoginForm";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  // Only same-site paths are accepted as a return target.
  const target = typeof next === "string" && /^\/(?!\/)[\w\-/]*$/.test(next) ? next : "/dashboard";

  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8 leading-relaxed">
        <div className="mb-6">
          <BrandMark />
        </div>
        <h1 className="mb-1 text-2xl font-semibold">Recruiter sign-in</h1>
        <p className="mb-5 text-sm text-muted">
          Creating interviews and viewing candidate results requires the team password.
        </p>
        <LoginForm next={target} />
      </div>
    </main>
  );
}
