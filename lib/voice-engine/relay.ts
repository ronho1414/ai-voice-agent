import { resolveSpokenKnowledge } from "@/lib/admin/knowledge";
import { requireEnv } from "@/lib/voice-engine/env";
import { decideOpener } from "@/lib/voice-engine/decision";
import { buildSystemPrompt, guardReply, recitesSource } from "@/lib/voice-engine/prompt";
import type { ChatRelayResult, Lang, TurnContext } from "@/lib/voice-engine/types";

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

const REPLY_MODELS = ["google/gemini-2.5-flash", "openai/gpt-4o-mini", "deepseek/deepseek-chat"] as const;

async function completeReply(system: string, text: string): Promise<string> {
  const apiKey = requireEnv("OPENROUTER_API_KEY");
  let lastStatus = 0;

  for (const model of REPLY_MODELS) {
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
          model,
          temperature: 0.2,
          max_tokens: 120,
          provider: { sort: "latency" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: text },
          ],
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      continue;
    }

    if (!response.ok) {
      lastStatus = response.status;
      await response.body?.cancel().catch(() => undefined);
      continue;
    }
    return readMessage((await response.json()) as unknown);
  }

  throw new Error(lastStatus ? `OpenRouter request failed (${lastStatus})` : "OpenRouter request failed (network)");
}

export async function relayChat(
  text: string,
  knowledgeBasePath = "knowledge-base/company-info.md",
  spoken?: { clipText: string; lang: Lang },
  context?: TurnContext,
  siteId = "voicepilot-hq",
): Promise<ChatRelayResult> {
  const opener = spoken ?? (await decideOpener(text, context));
  const resolved = await resolveSpokenKnowledge(text, siteId, knowledgeBasePath);
  const reply = await answerWithKnowledge(text, resolved.knowledge, opener.clipText, opener.lang, resolved);
  return {
    reply,
    clipText: opener.clipText,
    lang: opener.lang,
  };
}

async function answerWithKnowledge(
  text: string,
  knowledge: string,
  clipText: string,
  lang: Lang,
  resolved: { adminText: string; useAdminSources: boolean },
): Promise<string> {
  const system = buildSystemPrompt(knowledge, clipText, lang, resolved.useAdminSources);
  let raw = await completeReply(system, text);
  if (resolved.useAdminSources && recitesSource(raw, resolved.adminText)) {
    raw = await completeReply(
      `${system}\n\nThe previous draft read the source aloud. Answer the question again in your own words. Do not quote or repeat the note or document.`,
      text,
    );
  }
  return guardReply(raw, clipText, lang, knowledge);
}

export async function answerFromKnowledge(text: string, siteId: string): Promise<string> {
  const resolved = await resolveSpokenKnowledge(text, siteId, "knowledge-base/company-info.md");
  return answerWithKnowledge(text, resolved.knowledge, "", "yue", resolved);
}
