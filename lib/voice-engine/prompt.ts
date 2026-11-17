import type { Lang } from "@/lib/voice-engine/types";

const LANGUAGE_RULE: Record<Lang, string> = {
  yue: "Reply in spoken Hong Kong Cantonese. You may keep natural English business terms such as Demo, PDF, WhatsApp, Starter, Growth, and Enterprise. Use words such as 係、唔係、嘅、咗、喺. Do not use written Chinese.",
  zh: "Reply in spoken Mandarin.",
  en: "Reply in spoken English.",
};

const PRICE_REPLY: Record<Lang, string> = {
  yue: "呢個價錢我份資料冇寫，我會幫你記錄低，再由團隊跟進。收費方案頁有 Starter、Growth 同 Enterprise。",
  zh: "这个价格我的资料里没有，我会记下，再由团队跟进。收费方案页有 Starter、Growth 和 Enterprise。",
  en: "That price is not in my notes. I'll record it and have the team follow up. The pricing page lists Starter, Growth, and Enterprise.",
};

const UNKNOWN_REPLY: Record<Lang, string> = {
  yue: "呢樣我唔係好清楚，我會幫你記錄低，再安排專人跟進。",
  zh: "这个我这边还没有资料。我会记下，再安排专人跟进。",
  en: "I don't have that yet. I'll note it and have someone follow up.",
};

const MONEY =
  /(?:HK\$|US\$|USD|HKD|\$\s?\d|￥\s?\d|\d[\d,]*(?:\.\d+)?\s?(?:港紙|港元|蚊|塊錢))/;

export function continuationLine(clipText: string): string {
  return `你剛剛已經對客人說出了開場白：『${clipText}』。請直接順著這句話的語氣與上下文無縫接下去回答重點，絕對不可重複打招呼，亦不可說「等我幫你睇睇」或「我幫你睇睇先」。`;
}

export function buildSystemPrompt(knowledge: string, clipText: string, lang: Lang): string {
  return [
    "You are a senior AI voice-solution specialist for VoicePilot AI（領聲智導）.",
    "You are not a clinic receptionist. Do not mention clinics, medical treatments, or beauty services.",
    "The knowledge base below is the only source of facts.",
    knowledge.trim(),
    continuationLine(clipText),
    LANGUAGE_RULE[lang],
    "Reply in 2 or 3 spoken sentences.",
    "Do not output Markdown or symbols such as *, #, or bullet lists.",
    "If the knowledge base does not contain the fact, say you will note it and someone will follow up. Do not invent facts.",
    "Quote only prices written in the knowledge base. Do not invent another amount.",
    "Do not greet again and do not repeat the opener.",
  ].join("\n\n");
}

export function sanitizeSpokenReply(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*#_>~[\]]/g, "")
    .replace(/^\s*[-+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function limitSentences(text: string): string {
  const parts = text.match(/[^。！？.!?]+[。！？.!?]*/g);
  if (!parts) return text;
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(" ")
    .trim();
}

function withoutOpener(reply: string, clipText: string): string {
  if (!clipText || !reply.startsWith(clipText)) return reply;
  return reply.slice(clipText.length).replace(/^[，,。.\s]+/, "").trim();
}

export function guardReply(
  raw: string,
  clipText: string,
  lang: Lang,
  knowledge: string,
): string {
  const cleaned = limitSentences(withoutOpener(sanitizeSpokenReply(raw), clipText));
  if (!cleaned) return UNKNOWN_REPLY[lang];
  if (!MONEY.test(knowledge) && MONEY.test(cleaned)) return PRICE_REPLY[lang];
  return cleaned;
}
