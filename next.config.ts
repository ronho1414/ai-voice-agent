import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A verified build is copied here for the persistent local preview. Normal
  // verification builds keep using .next and cannot disrupt that running site.
  distDir: process.env.ORAI_PREVIEW_DIST === "1" ? ".next-preview" : ".next",
  serverExternalPackages: ["pdf-parse", "mammoth"],
  outputFileTracingIncludes: {
    "/api/fast-decision": ["./config/**/*"],
    "/api/chat-relay": ["./config/**/*", "./knowledge-base/**/*"],
    "/api/admin/ask": ["./config/**/*", "./knowledge-base/**/*"],
    "/api/tts": ["./config/**/*"],
  },
};

export default nextConfig;
