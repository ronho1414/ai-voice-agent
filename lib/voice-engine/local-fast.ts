import clipsJson from "@/config/clips-config.json";
import { clipFor, parseClipsConfig } from "@/lib/voice-engine/clips-config";
import type { SiteMap } from "@/lib/voice-engine/site-map";
import type { FastDecision, Intent, Lang, SitePageId, TurnContext } from "@/lib/voice-engine/types";

const CLIPS = parseClipsConfig(clipsJson);
const LOCAL_BUDGET_MS = 80;

const FORCED_PAGE: Partial<Record<Intent, { url: string; sectionId?: string }>> = {
  navigate_pricing: { url: "pricing" },
  price_objection: { url: "pricing" },
  ask_voice_clone: { url: "pricing" },
  navigate_advantages: { url: "advantages" },
  booking_demo: { url: "about", sectionId: "demo-booking-form" },
};

const FIRST_RULES: { intent: Intent; pattern: RegExp }[] = [
  { intent: "greeting", pattern: /^(你好|哈囉|哈啰|hi|hello|hey)[!！?？。.\s]*$/i },
  { intent: "booking_demo", pattern: /預約|約時間|book(?:\s+a)?\s+demo|示範/i },
  { intent: "price_objection", pattern: /太貴|好貴|折扣|優惠|年費|discount|expensive/i },
  { intent: "navigate_pricing", pattern: /收費|幾錢|價錢|價格|方案|點收費|price|pricing|starter|growth|enterprise/i },
  { intent: "navigate_advantages", pattern: /知識庫|上傳|pdf|檔案/i },
  { intent: "ask_timeline", pattern: /幾耐|幾日|幾天|onboard|上線|timeline/i },
  { intent: "ask_voice_clone", pattern: /克隆|配音|voice clone|聲音/i },
  { intent: "compare_bots", pattern: /chatbot|聊天機械人|傳統機械人|scripted/i },
  { intent: "company_intro", pattern: /你哋做|你們做|公司做|介紹下|what do you do|邊間公司/i },
];

function matchLang(text: string): Lang {
  const hasHan = /[\u3400-\u9fff]/.test(text);
  const hasLatin = /[A-Za-z]/.test(text);
  if (hasLatin && !hasHan) return "en";
  if (/[嘅咗喺唔係喎囉咩喇㗎噉哋]/.test(text)) return "yue";
  if (hasHan) return "zh";
  return "yue";
}

function matchIntent(text: string, context: TurnContext): Intent | null {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  if (context.turnCount > 1) {
    if (/收費|價目|方案|優勢|知識庫|預約|demo|關於|pricing|about/i.test(compact)) return "follow_up_nav";
    if (/詳細|點解|比較|再講|點樣|how|why/i.test(compact)) return "follow_up_detail";
    if (compact.length <= 12 && /^(好|係|明白|ok|okay|thanks|thank you|唔該|嗯|得)[!！。.\s]*$/i.test(compact)) {
      return "follow_up_ack";
    }
    return null;
  }
  for (const rule of FIRST_RULES) {
    if (rule.pattern.test(compact)) return rule.intent;
  }
  return null;
}

function applyPageBias(intent: Intent, page: SitePageId, turnCount: number): Intent {
  if (turnCount > 1) return intent;
  if (page === "pricing" && intent === "company_intro") return "navigate_pricing";
  if (page === "advantages" && intent === "company_intro") return "navigate_advantages";
  return intent;
}

function navigationFor(intent: Intent, siteMap: SiteMap): FastDecision {
  const none = {
    navigateUrl: "NONE",
    sectionId: null,
    pageName: null,
    confidence: 1,
  };
  if (intent === "follow_up_ack" || intent === "follow_up_detail") {
    return { intent, lang: "yue", clipText: "", clipFile: "", ...none, confidence: 0 };
  }
  const forced = FORCED_PAGE[intent];
  if (!forced) return { intent, lang: "yue", clipText: "", clipFile: "", ...none };
  const page = siteMap.pages.find((item) => item.url === forced.url);
  return {
    intent,
    lang: "yue",
    clipText: "",
    clipFile: "",
    navigateUrl: forced.url,
    sectionId: forced.sectionId ?? page?.sectionId ?? null,
    pageName: page?.name ?? forced.url,
    confidence: 1,
  };
}

export function matchLocalFast(text: string, siteMap: SiteMap, context: TurnContext): FastDecision | null {
  const started = performance.now();
  const intent = matchIntent(text, context);
  if (!intent) return null;
  const biased = applyPageBias(intent, context.currentPage, context.turnCount);
  const lang = matchLang(text);
  const clip = clipFor(CLIPS, biased, lang);
  const navigation = navigationFor(biased, siteMap);
  if (performance.now() - started > LOCAL_BUDGET_MS) return null;
  return {
    intent: clip.intent,
    lang: clip.lang,
    clipText: clip.clipText,
    clipFile: clip.file,
    navigateUrl: navigation.navigateUrl,
    sectionId: navigation.sectionId,
    pageName: navigation.pageName,
    confidence: navigation.confidence,
  };
}
