import Image from "next/image";
import Link from "next/link";

/**
 * The product mark: the Sreemedhas company logo. The artwork is dark ink on
 * transparent, so it always sits on a light plate — that keeps it legible in
 * both the light and the dark theme.
 */
export function BrandMark({ href = "/" }: { href?: string | null }) {
  const mark = (
    <span className="inline-flex items-center rounded-lg bg-white px-2.5 py-1.5">
      <Image
        src="/company_logo_sreemedhas.png"
        alt="Sreemedhas Software Technologies"
        width={150}
        height={40}
        priority
        className="h-7 w-auto object-contain"
      />
    </span>
  );
  return href === null ? mark : <Link href={href}>{mark}</Link>;
}
