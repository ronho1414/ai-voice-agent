import { requireEnv } from "@/lib/voice-engine/env";
import { loadKnowledgeFile } from "@/lib/voice-engine/read-config";
import { decideOpener } from "@/lib/voice-engine/decision";
import { buildSystemPrompt, guardReply } from "@/lib/voice-engine/prompt";
import type { ChatRelayResult } from "@/lib/voice-engine/types";

function readMessage(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("OpenRouter request failed (bad response)");
  }
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error("OpenRouter request failed (bad response)");
  }
  const message = (choices[0] as { message?: { content?: unknown } }).message;
  const content = message?.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) {
    throw new Error("OpenRouter request failed (bad response)");
  }
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (typeof part === "object" && part !== null && "text" in part) {
        const text = (part as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .join("")
    .trim();
}

async function completeReply(system: string, text: string): Promise<string> {
  const apiKey = requireEnv("OPENROUTER_API_KEY");
  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "AI Voice Agent",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        temperature: 0.2,
        max_tokens: 180,
        messages: [
          { role: "system", content: system },
          { role: "user", content: text },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("OpenRouter request failed (network)");
  }

  if (!response.ok) {
    throw new Error(`OpenRouter request failed (${response.status})`);
  }
  return readMessage((await response.json()) as unknown);
}

export async function relayChat(
  text: string,
  knowledgeBasePath = "knowledge-base/company-info.md",
): Promise<ChatRelayResult> {
  const opener = await decideOpener(text);
  const knowledge = loadKnowledgeFile(knowledgeBasePath);
  const system = buildSystemPrompt(knowledge, opener.clipText, opener.lang);
  const raw = await completeReply(system, text);
  return {
    reply: guardReply(raw, opener.clipText, opener.lang, knowledge),
    clipText: opener.clipText,
    lang: opener.lang,
  };
}
