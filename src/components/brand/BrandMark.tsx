import Image from "next/image";
import Link from "next/link";

/**
 * The Medhas Academy mark: the emblem plus a typeset wordmark. The emblem has
 * a light-ink version for the dark theme (navy swapped for near-white) so it
 * never needs a white plate behind it.
 */
export function BrandEmblem({
  className = "size-8",
  onDark = false,
}: {
  className?: string;
  /** Force the light-ink emblem, for surfaces that are always dark. */
  onDark?: boolean;
}) {
  return (
    <span className={`relative inline-block shrink-0 ${className}`}>
      {onDark ? (
        <Image src="/medhas-emblem-dark.png" alt="" fill sizes="64px" priority className="object-contain" />
      ) : (
        <>
          <Image src="/medhas-emblem.png" alt="" fill sizes="64px" priority className="object-contain dark:hidden" />
          <Image src="/medhas-emblem-dark.png" alt="" fill sizes="64px" priority className="hidden object-contain dark:block" />
        </>
      )}
    </span>
  );
}

export function BrandMark({
  href = "/",
  size = "md",
  onDark = false,
}: {
  href?: string | null;
  size?: "sm" | "md";
  onDark?: boolean;
}) {
  const mark = (
    <span className="inline-flex items-center gap-2.5" aria-label="Medhas Academy">
      <BrandEmblem className={size === "sm" ? "size-7" : "size-9"} onDark={onDark} />
      <span className="flex flex-col leading-none">
        <span className={`font-semibold tracking-tight ${onDark ? "text-white" : "text-foreground"} ${size === "sm" ? "text-[13px]" : "text-[15px]"}`}>
          Medhas Academy
        </span>
        <span className={`mt-0.5 text-[11px] ${onDark ? "text-white/60" : "text-muted"}`}>Interviews</span>
      </span>
    </span>
  );
  return href === null ? mark : (
    <Link href={href} className="rounded-lg outline-offset-4">
      {mark}
    </Link>
  );
}
