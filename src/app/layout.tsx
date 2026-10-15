import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
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
    default: "Intervia — AI-powered conversations for better hiring",
    template: "%s | Intervia",
  },
  description: "AI-powered conversations for better hiring.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${display.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/*
          Resolves the theme before first paint: saved preference wins,
          otherwise the system preference. Inline and blocking on purpose —
          a deferred script would let the wrong theme flash.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem("intervia-theme");var t=s==="light"||s==="dark"?s:"light";var d=t==="dark";var e=document.documentElement;e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light";}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}