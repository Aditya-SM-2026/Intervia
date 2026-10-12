import Link from "next/link";

const BAR_HEIGHTS = [6, 12, 18, 10, 15, 7];

/**
 * The Intervia mark: a short voice line. The same motif is the centre of the
 * live interview room, where it moves with whoever is speaking.
 */
export function BrandMark({ href = "/" }: { href?: string | null }) {
  const mark = (
    <span className="inline-flex items-center gap-2.5 font-display text-lg font-semibold tracking-tight">
      <svg width="26" height="20" viewBox="0 0 26 20" aria-hidden="true">
        {BAR_HEIGHTS.map((height, index) => (
          <rect
            key={index}
            x={index * 4.4}
            y={(20 - height) / 2}
            width="2.6"
            height={height}
            rx="1.3"
            fill={index < 3 ? "var(--accent)" : "var(--candidate)"}
          />
        ))}
      </svg>
      Intervia
    </span>
  );
  return href === null ? mark : <Link href={href}>{mark}</Link>;
}
