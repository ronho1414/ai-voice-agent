import { clipFor } from "@/lib/voice-engine/clips-config";
import { requireEnv } from "@/lib/voice-engine/env";
import { loadClipsConfig, loadSiteMap } from "@/lib/voice-engine/read-config";
import { selectRoute, type SiteMap } from "@/lib/voice-engine/site-map";
import {
  isIntent,
  isLang,
  type FastDecision,
  type Intent,
  type Lang,
  type SitePageId,
  type TurnContext,
} from "@/lib/voice-engine/types";

type ChoiceAnswer = {
  choice: string;
  confidence: number;
};

type OpenerDecision = {
  intent: Intent;
  lang: Lang;
  clipText: string;
  clipFile: string;
};

type OpenerCache = {
  key: string;
  expires: number;
  promise: Promise<OpenerDecision> | null;
};

const FIRST_TURN: readonly Intent[] = [
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
];

const FOLLOW_UP: readonly Intent[] = ["follow_up_ack", "follow_up_detail", "follow_up_nav"];

const INTENT_CRITERIA: Record<Intent, string> = {
  greeting: "Hello, hi, or 你好 with no real question about the company, price, product, or booking.",
  company_intro: "Asks what the company does or for a basic introduction, and the guest is not already on the pricing or advantages page.",
  navigate_pricing: "Asks the price, the plans, or to compare Starter, Growth, and Enterprise. Prefer this on the pricing page.",
  navigate_advantages: "Asks about the PDF knowledge base, uploading files, or how the knowledge base is managed. Prefer this on the advantages page.",
  compare_bots: "Compares VoicePilot with a traditional text chatbot or a scripted bot.",
  ask_timeline: "Asks how long onboarding or going live takes.",
  ask_voice_clone: "Asks about cloning a real person's voice or a branded voice.",
  price_objection: "Says the price is high, asks for a discount, or asks about paying yearly.",
  booking_demo: "Wants to book a demo, leave contact details, or have the team follow up.",
  deep_lookup: "Asks a specific clause or unusual detail that is not a greeting, intro, price, PDF overview, comparison, timeline, voice clone, discount, or booking.",
  follow_up_ack: "A short acknowledgement is enough. The guest is confirming or the next line does not need a new explanation or a page change.",
  follow_up_detail: "The guest wants a fuller explanation and should stay on the current page. On pricing, this is a plan comparison. On advantages, this is the knowledge-base files.",
  follow_up_nav: "The guest wants to open another page, the plans, the knowledge base, or the demo form.",
};

const FORCED_PAGE: Partial<Record<Intent, { url: string; sectionId?: string }>> = {
  navigate_pricing: { url: "pricing" },
  price_objection: { url: "pricing" },
  ask_voice_clone: { url: "pricing" },
  navigate_advantages: { url: "advantages" },
  booking_demo: { url: "about", sectionId: "demo-booking-form" },
};

const DEFAULT_CONTEXT: TurnContext = { currentPage: "home", turnCount: 1 };

function criteriaFor(intents: readonly Intent[]): Record<string, string> {
  const criteria: Record<string, string> = {};
  for (const intent of intents) criteria[intent] = INTENT_CRITERIA[intent];
  return criteria;
}

function applyPageBias(intent: Intent, page: SitePageId, turnCount: number): Intent {
  if (turnCount > 1) return intent;
  if (page === "pricing" && intent === "company_intro") return "navigate_pricing";
  if (page === "advantages" && intent === "company_intro") return "navigate_advantages";
  return intent;
}

const LANG_CRITERIA: Record<Lang, string> = {
  yue: "Hong Kong Cantonese, including spoken particles such as 嘅, 咗, 喺, 唔.",
  zh: "Mandarin Chinese.",
  en: "English.",
};

function openerCache(): OpenerCache {
  const host = globalThis as typeof globalThis & { __voiceOpenerCache?: OpenerCache };
  if (!host.__voiceOpenerCache) {
    host.__voiceOpenerCache = { key: "", expires: 0, promise: null };
  }
  return host.__voiceOpenerCache;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readChoice(value: unknown, allowed: readonly string[]): ChoiceAnswer {
  if (!isRecord(value) || typeof value.choice !== "string" || !allowed.includes(value.choice)) {
    throw new Error("Jev request failed (bad response)");
  }
  if (typeof value.confidence === "number") {
    return { choice: value.choice, confidence: value.confidence };
  }
  const probabilities = value.probabilities;
  if (isRecord(probabilities)) {
    const scores = Object.values(probabilities).filter((item): item is number => typeof item === "number");
    return {
      choice: value.choice,
      confidence: scores.length > 0 ? Math.max(...scores) : 0,
    };
  }
  return { choice: value.choice, confidence: 0 };
}

async function jevChoices(
  state: unknown,
  questions: Record<string, { type: "choice"; instructions: string; criteria: Record<string, string> }>,
): Promise<Record<string, unknown>> {
  const apiKey = requireEnv("JEV_API_KEY");
  let response: Response;
  try {
    response = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "jev-latest",
        state,
        questions,
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error("Jev request failed (network)");
  }

  if (!response.ok) {
    throw new Error(`Jev request failed (${response.status})`);
  }

  const payload: unknown = await response.json();
  if (!isRecord(payload) || !isRecord(payload.answers)) {
    throw new Error("Jev request failed (bad response)");
  }
  return payload.answers;
}

async function runOpener(text: string, context: TurnContext): Promise<OpenerDecision> {
  const followUp = context.turnCount > 1;
  const allowed = followUp ? FOLLOW_UP : FIRST_TURN;
  const answers = await jevChoices(
    {
      utterance: text,
      currentPage: context.currentPage,
      turnCount: context.turnCount,
      setting: "VoicePilot AI website. The speaker is a senior voice-solution specialist, not a clinic receptionist.",
    },
    {
      intent: {
        type: "choice",
        instructions: followUp
          ? `This is a follow-up, turn ${context.turnCount}, and the guest is on ${context.currentPage}. Choose only a short bridge. Use follow_up_nav only when they want another page. Use follow_up_detail when they want more explanation. On pricing, prefer a plan-comparison tone. On advantages, prefer a knowledge-base file tone. Use follow_up_ack otherwise. Do not choose a long first-turn opener.`
          : `This is the first turn and the guest is on ${context.currentPage}. Choose one unfinished half-sentence opener. Use greeting only for hello. On pricing, prefer navigate_pricing or price_objection when they ask about the company, plans, or cost. On advantages, prefer navigate_advantages when they ask about the company, PDFs, or files. Use deep_lookup only for a specific unusual detail.`,
        criteria: criteriaFor(allowed),
      },
      lang: {
        type: "choice",
        instructions:
          "Which language is the guest speaking? If they mix languages, pick the language the spoken reply should use.",
        criteria: LANG_CRITERIA,
      },
    },
  );

  const intentAnswer = readChoice(answers.intent, allowed);
  const langAnswer = readChoice(answers.lang, Object.keys(LANG_CRITERIA));
  if (!isIntent(intentAnswer.choice) || !isLang(langAnswer.choice)) {
    throw new Error("Jev request failed (bad response)");
  }

  const intent = applyPageBias(intentAnswer.choice, context.currentPage, context.turnCount);
  const clip = clipFor(loadClipsConfig(), intent, langAnswer.choice);
  return {
    intent: clip.intent,
    lang: clip.lang,
    clipText: clip.clipText,
    clipFile: clip.file,
  };
}

export function decideOpener(text: string, context: TurnContext = DEFAULT_CONTEXT): Promise<OpenerDecision> {
  const now = Date.now();
  const cache = openerCache();
  const key = `${text}|${context.currentPage}|${context.turnCount > 1 ? "follow" : "first"}`;
  if (cache.key === key && cache.expires > now && cache.promise) {
    return cache.promise;
  }

  const promise = runOpener(text, context).catch((error: unknown) => {
    const current = openerCache();
    if (current.promise === promise) {
      current.key = "";
      current.expires = 0;
      current.promise = null;
    }
    throw error;
  });

  cache.key = key;
  cache.expires = now + 20_000;
  cache.promise = promise;
  return promise;
}

function routeCriteria(siteMap: SiteMap): Record<string, string> {
  const criteria: Record<string, string> = {
    NONE: "The guest is not asking to open or change pages.",
  };
  for (const page of siteMap.pages) {
    const keywords = Object.values(page.keywords).flat().join(", ");
    criteria[page.url] = `${page.name}. Keywords: ${keywords}`;
  }
  return criteria;
}

async function decideRoute(
  text: string,
  siteMap: SiteMap,
): Promise<{
  navigateUrl: string;
  sectionId: string | null;
  pageName: string | null;
  confidence: number;
}> {
  const criteria = routeCriteria(siteMap);
  const answers = await jevChoices(
    {
      utterance: text,
      pages: siteMap.pages.map((page) => ({
        url: page.url,
        name: page.name,
        keywords: page.keywords,
      })),
    },
    {
      page: {
        type: "choice",
        instructions:
          "Which page id should open now? Choose home, advantages, pricing, or about only when the guest wants that page. Choose NONE when they are greeting or the answer can stay on the current page.",
        criteria,
      },
    },
  );
  const answer = readChoice(answers.page, Object.keys(criteria));
  return selectRoute(answer.choice, answer.confidence, siteMap);
}

function navigationFor(intent: Intent, siteMap: SiteMap) {
  const forced = FORCED_PAGE[intent];
  if (!forced) return null;
  const page = siteMap.pages.find((item) => item.url === forced.url);
  return {
    navigateUrl: forced.url,
    sectionId: forced.sectionId ?? page?.sectionId ?? null,
    pageName: page?.name ?? forced.url,
    confidence: 1,
  };
}

export async function decideFast(
  text: string,
  siteMap: SiteMap = loadSiteMap(),
  context: TurnContext = DEFAULT_CONTEXT,
): Promise<FastDecision> {
  const [opener, route] = await Promise.all([decideOpener(text, context), decideRoute(text, siteMap)]);
  const stay =
    opener.intent === "follow_up_ack" || opener.intent === "follow_up_detail"
      ? { navigateUrl: "NONE", sectionId: null, pageName: null, confidence: 0 }
      : null;
  const navigation = stay ?? navigationFor(opener.intent, siteMap) ?? route;
  return {
    intent: opener.intent,
    lang: opener.lang,
    clipText: opener.clipText,
    clipFile: opener.clipFile,
    navigateUrl: navigation.navigateUrl,
    sectionId: navigation.sectionId,
    pageName: navigation.pageName,
    confidence: navigation.confidence,
  };
}
