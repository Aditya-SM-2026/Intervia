import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BrandEmblem, BrandMark } from "@/components/brand/BrandMark";
import { LoginForm } from "@/components/auth/LoginForm";
import { ReportSpecimen } from "@/components/marketing/Specimens";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  // Only same-site paths are accepted as a return target.
  const target = typeof next === "string" && /^\/(?!\/)[\w\-/]*$/.test(next) ? next : "/dashboard";

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col px-6 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <BrandMark />
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-foreground">
            <ArrowLeft className="size-4" />
            Home
          </Link>
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-2 text-muted">Use your team login to create interviews and read reports.</p>
          <div className="mt-8">
            <LoginForm next={target} />
          </div>
        </div>
      </div>

      <aside className="relative hidden overflow-hidden bg-accent lg:flex lg:flex-col lg:justify-center lg:px-14">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-32 -top-32 size-[520px] rounded-full bg-white/[0.06]"
        />
        <div className="relative mx-auto w-full max-w-md">
          <div className="mb-10 flex items-center gap-3 text-white">
            <BrandEmblem className="size-10" onDark />
            <p className="text-lg font-semibold leading-snug">Every candidate interviewed. One page to decide.</p>
          </div>
          <ReportSpecimen />
        </div>
      </aside>
    </main>
  );
}
