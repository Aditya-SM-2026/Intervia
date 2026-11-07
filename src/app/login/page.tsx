import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BrandMark } from "@/components/brand/BrandMark";
import { LoginForm } from "@/components/auth/LoginForm";
import { HeroFilm } from "@/components/marketing/HeroFilm";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  // Only same-site paths are accepted as a return target.
  const target = typeof next === "string" && /^\/(?!\/)[\w\-/]*$/.test(next) ? next : "/dashboard";

  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="flex flex-col px-6 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <BrandMark />
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-foreground">
            <ArrowLeft className="size-4" />
            Home
          </Link>
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <h1 className="text-3xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-2 text-muted">Sign in with your team login.</p>
          <div className="mt-8">
            <LoginForm next={target} />
          </div>
        </div>
      </div>

      <aside className="relative isolate hidden overflow-hidden bg-[#08123a] lg:flex lg:items-center lg:justify-center lg:p-12">
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[radial-gradient(70%_60%_at_50%_0%,rgba(74,114,245,0.5),transparent_70%)]"
        />
        <div className="w-full max-w-xl">
          <HeroFilm compact />
        </div>
      </aside>
    </main>
  );
}
