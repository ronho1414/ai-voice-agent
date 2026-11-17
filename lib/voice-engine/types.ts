export const INTENTS = [
  "greeting",
  "company_intro",
  "navigate_pricing",
  "navigate_advantages",
  "compare_bots",
  "ask_timeline",
  "ask_voice_clone",
  "price_objection",
  "booking_demo",
  "deep_lookup",
  "follow_up_ack",
  "follow_up_detail",
  "follow_up_nav",
] as const;

export type Intent = (typeof INTENTS)[number];

export const SITE_PAGES = ["home", "advantages", "pricing", "about"] as const;

export type SitePageId = (typeof SITE_PAGES)[number];

export type TurnContext = {
  currentPage: SitePageId;
  turnCount: number;
};

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

export function isSitePage(value: string): value is SitePageId {
  return (SITE_PAGES as readonly string[]).includes(value);
}
