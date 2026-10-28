import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import { THEME_COOKIE, parseThemeCookie } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Headings: a grotesque with some character, so the product does not read as
// a generic dashboard. Body text stays in Geist for long transcripts.
const display = Bricolage_Grotesque({
  variable: "--font-display-face",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Sreemedhas Agent — AI-powered interviews for better hiring",
    template: "%s | Sreemedhas Agent",
  },
  description: "AI-powered conversations for better hiring.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The theme the client last resolved, so the first paint is already correct.
  // A cookie rather than an inline script: React 19 never runs inline scripts
  // it meets while rendering on the client, and a blocking script would be a
  // round trip on every page.
  const cookieStore = await cookies();
  const theme = parseThemeCookie(cookieStore.get(THEME_COOKIE)?.value);

  return (
    <html
      lang="en"
      className={[geistSans.variable, geistMono.variable, display.variable, theme === "dark" && "dark"]
        .filter(Boolean)
        .join(" ")}
      style={{ colorScheme: theme }}
      suppressHydrationWarning
    >
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
