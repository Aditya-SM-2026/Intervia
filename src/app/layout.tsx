import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import { THEME_COOKIE, parseThemeCookie } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Display face for page titles and headline figures: a text serif with an
// academic voice that suits the Medhas Academy brand. UI text stays in Geist.
const display = Newsreader({
  variable: "--font-display-face",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Medhas Academy Interviews",
    template: "%s · Medhas Academy",
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
