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

export function continuationLine(clipText: string, lang: Lang): string {
  if (!clipText.trim()) return "";
  if (lang === "yue") {
    return `你已經向訪客講出咗以下前半句開場白：「${clipText}」。請你必須直接順住呢句話嘅語氣同文法接落去講後半句，絕對唔准重複打招呼（例如唔准再講「你好」），亦唔准重複前半句已經講過嘅意思，保持地道香港廣東話口語。`;
  }
  if (lang === "zh") {
    return `你已经向访客说出了这半句开场白：「${clipText}」。请直接顺着这句话的语气和文法讲后半句，不要再打招呼，也不要重复前半句已经说过的意思。`;
  }
  return `You already said this opening half to the visitor: "${clipText}". Continue that sentence in the same tone. Do not greet again and do not repeat the first half.`;
}

export function buildSystemPrompt(
  knowledge: string,
  clipText: string,
  lang: Lang,
  useAdminSources = false,
): string {
  return [
    "You are a senior AI voice-solution specialist for Orai service.",
    "You are not a clinic receptionist. Do not mention clinics, medical treatments, or beauty services.",
    "The knowledge base below is the only source of facts.",
    knowledge.trim(),
    continuationLine(clipText, lang),
    LANGUAGE_RULE[lang],
    "Reply in 2 or 3 short spoken sentences, about 40 to 70 characters in total.",
    "Do not output Markdown or symbols such as *, #, or bullet lists.",
    "If the knowledge base does not contain the fact, say you will note it and someone will follow up. Do not invent facts.",
    "Quote only prices written in the knowledge base. Do not invent another amount.",
    "Do not greet again and do not repeat the opener.",
    useAdminSources
      ? "The question is about the uploaded documents or typed notes included above. Answer it from that material in your own spoken words. Do not read a note or document aloud, do not quote it, and do not repeat it as a script. Use only the part that answers the question. Company knowledge still applies."
      : "",
  ]
    .filter((line) => line.trim().length > 0)
    .join("\n\n");
}

export function recitesSource(reply: string, source: string): boolean {
  const spoken = reply.replace(/\s+/g, "").trim();
  const material = source.replace(/\s+/g, "").trim();
  if (spoken.length < 16 || material.length < 16) return false;
  if (spoken.includes(material)) return true;
  if (material.includes(spoken) && spoken.length >= Math.min(material.length, 40)) return true;
  const window = 24;
  if (spoken.length < window) return false;
  let hits = 0;
  let samples = 0;
  for (let index = 0; index + window <= spoken.length; index += 8) {
    samples += 1;
    if (material.includes(spoken.slice(index, index + window))) hits += 1;
  }
  return samples > 0 && hits / samples >= 0.6;
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

function withoutRepeatedGreeting(reply: string, clipText: string): string {
  const stripped = withoutOpener(reply, clipText);
  if (!clipText) return stripped;
  return stripped.replace(/^(你好呀[！!？?，,]?|你好[！!？?，,]?|hello[,!?]?\s*|hi[,!?]?\s*)/i, "").trim();
}

export function guardReply(
  raw: string,
  clipText: string,
  lang: Lang,
  knowledge: string,
): string {
  const cleaned = limitSentences(withoutRepeatedGreeting(sanitizeSpokenReply(raw), clipText));
  if (!cleaned) return UNKNOWN_REPLY[lang];
  if (!MONEY.test(knowledge) && MONEY.test(cleaned)) return PRICE_REPLY[lang];
  return cleaned;
}
