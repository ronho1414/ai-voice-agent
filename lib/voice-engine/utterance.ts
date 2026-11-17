import { parseSiteMap, type SiteMap } from "@/lib/voice-engine/site-map";
import { isLang, type Lang } from "@/lib/voice-engine/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readUtterance(body: unknown): string {
  if (!isRecord(body) || typeof body.text !== "string") {
    throw new Error("Text is required");
  }
  const text = body.text.replace(/\s+/g, " ").trim();
  if (!text) throw new Error("Text is required");
  if (text.length > 2000) throw new Error("Text is too long");
  return text;
}

export function readSpeechRequest(body: unknown): { text: string; lang: Lang } {
  const text = readUtterance(body);
  if (!isRecord(body) || typeof body.lang !== "string" || !isLang(body.lang)) {
    throw new Error("Language is required");
  }
  return { text, lang: body.lang };
}

const VOICE_ID = /^[A-Za-z0-9]{8,64}$/;

export function readVoiceId(body: unknown): string | undefined {
  if (!isRecord(body) || body.voiceId === undefined) return undefined;
  if (typeof body.voiceId !== "string" || !VOICE_ID.test(body.voiceId.trim())) {
    throw new Error("Voice is invalid");
  }
  return body.voiceId.trim();
}

export function readKnowledgeBasePath(body: unknown): string | undefined {
  if (!isRecord(body) || body.knowledgeBasePath === undefined) return undefined;
  if (typeof body.knowledgeBasePath !== "string" || body.knowledgeBasePath.trim() === "") {
    throw new Error("Knowledge base path is invalid");
  }
  return body.knowledgeBasePath.trim();
}

export function readSiteMapOverride(body: unknown): SiteMap | undefined {
  if (!isRecord(body) || body.siteMap === undefined) return undefined;
  return parseSiteMap(body.siteMap);
}
