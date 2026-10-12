import Link from "next/link";
import { BrandMark } from "@/components/brand/BrandMark";
import { SignOutButton } from "./SignOutButton";

interface AppShellProps {
  /** Which section is open, for the navigation highlight. */
  current: "interviews" | "new";
  children: React.ReactNode;
  /** Wider pages (the create form) can ask for more room. */
  wide?: boolean;
}

const NAV = [
  { id: "interviews", href: "/dashboard", label: "Interviews" },
  { id: "new", href: "/recruiter", label: "New interview" },
] as const;

/** Chrome shared by the signed-in recruiter pages. */
export function AppShell({ current, children, wide = false }: AppShellProps) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
          <div className="flex items-center gap-8">
            <BrandMark href="/dashboard" />
            <nav aria-label="Main" className="flex items-center gap-1 text-sm">
              {NAV.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  aria-current={current === item.id ? "page" : undefined}
                  className={`rounded-md px-3 py-1.5 font-medium transition ${
                    current === item.id
                      ? "bg-accent/10 text-accent"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <SignOutButton />
        </div>
      </header>
      <main className={`mx-auto w-full px-5 py-8 sm:px-8 ${wide ? "max-w-6xl" : "max-w-4xl"}`}>
        {children}
      </main>
    </div>
  );
}
