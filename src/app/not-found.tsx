import Link from "next/link";
import { BrandMark } from "@/components/brand/BrandMark";

export default function NotFound() {
  return (
    <main className="relative grid min-h-dvh place-items-center px-6">
      <div aria-hidden className="bg-grid-fade pointer-events-none absolute inset-x-0 top-0 -z-10 h-[360px]" />
      <div className="w-full max-w-sm text-center">
        <div className="flex justify-center">
          <BrandMark href={null} />
        </div>
        <p className="mt-10 text-sm font-medium tabular-nums text-muted">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em]">This page does not exist</h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          The link may be mistyped, or what it pointed to was removed.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-medium text-white shadow-sm shadow-accent/20 transition hover:bg-accent/90"
        >
          Go to the home page
        </Link>
      </div>
    </main>
  );
}
