import { isLang, type Lang } from "@/lib/types";

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
