import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/fast-decision": ["./config/**/*"],
    "/api/chat-relay": ["./config/**/*", "./knowledge-base/**/*"],
    "/api/tts": ["./config/**/*"],
  },
};

export default nextConfig;
