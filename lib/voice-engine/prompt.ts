import type { Lang } from "@/lib/voice-engine/types";

const LANGUAGE_RULE: Record<Lang, string> = {
  yue: "Reply in spoken Hong Kong Cantonese. Use words such as 係、唔係、嘅、咗、喺. Do not use written Chinese.",
  zh: "Reply in spoken Mandarin.",
  en: "Reply in spoken English.",
};

const PRICE_REPLY: Record<Lang, string> = {
  yue: "價錢我唔可以喺度報，請你去價目表頁面確認。我會幫你記錄低，再安排專人跟進。",
  zh: "价格我不能在这里报，请到价目表页面确认。我会记下，再安排专人跟进。",
  en: "I can't quote a price here. Please check the pricing page. I'll note this and have someone follow up.",
};

const UNKNOWN_REPLY: Record<Lang, string> = {
  yue: "呢樣我唔係好清楚，我會幫你記錄低，再安排專人跟進。",
  zh: "这个我这边还没有资料。我会记下，再安排专人跟进。",
  en: "I don't have that yet. I'll note it and have someone follow up.",
};

const MONEY =
  /(?:HK\$|US\$|USD|HKD|\$\s?\d|￥\s?\d|\d[\d,]*(?:\.\d+)?\s?(?:港紙|港元|蚊|塊錢))/;

export function continuationLine(clipText: string): string {
  return `你剛剛已經對客人說出了開場白：『${clipText}』。請直接順著這句話的語氣與上下文無縫接下去回答重點，絕對不可重複打招呼或重複說『等我幫你睇睇』。`;
}

export function buildSystemPrompt(knowledge: string, clipText: string, lang: Lang): string {
  return [
    "You are the clinic's spoken receptionist.",
    "The knowledge base below is the only source of facts.",
    knowledge.trim(),
    continuationLine(clipText),
    LANGUAGE_RULE[lang],
    "Reply in 2 or 3 spoken sentences.",
    "Do not output Markdown or symbols such as *, #, or bullet lists.",
    "If the knowledge base does not contain the fact, say you will note it and someone will follow up. Do not invent facts.",
    "Do not invent prices and do not say any amount of money.",
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
    .join("")
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
