import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Ships a native binary; it must be resolved from node_modules at run time.
  serverExternalPackages: ["ffmpeg-static"],
  // Do not announce the framework in every response.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // HTTPS only, for a year, on every subdomain.
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          // No other site may show these pages inside a frame (clickjacking).
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
          // Files are served as the type we say, never guessed (a renamed file cannot become a page).
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Camera and microphone only for this site (the interview), nothing else.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), display-capture=(), geolocation=(), payment=(), usb=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
