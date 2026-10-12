import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Ships a native binary; it must be resolved from node_modules at run time.
  serverExternalPackages: ["ffmpeg-static"],
};

export default nextConfig;
