export const INTENTS = [
  "greeting",
  "company_intro",
  "navigate_pricing",
  "navigate_advantages",
  "deep_lookup",
  "booking_demo",
] as const;

export type Intent = (typeof INTENTS)[number];

export const LANGS = ["yue", "zh", "en"] as const;

export type Lang = (typeof LANGS)[number];

export type FastDecision = {
  intent: Intent;
  lang: Lang;
  clipText: string;
  clipFile: string;
  navigateUrl: string;
  sectionId: string | null;
  pageName: string | null;
  confidence: number;
};

export type ChatRelayResult = {
  reply: string;
  clipText: string;
  lang: Lang;
};

export function isIntent(value: string): value is Intent {
  return (INTENTS as readonly string[]).includes(value);
}

export function isLang(value: string): value is Lang {
  return (LANGS as readonly string[]).includes(value);
}
