import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse"],
  outputFileTracingIncludes: {
    "/api/fast-decision": ["./config/**/*"],
    "/api/chat-relay": ["./config/**/*", "./knowledge-base/**/*"],
    "/api/tts": ["./config/**/*"],
  },
};

export default nextConfig;
