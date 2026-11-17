import { clipFor } from "@/lib/voice-engine/clips-config";
import { requireEnv } from "@/lib/voice-engine/env";
import { loadClipsConfig, loadSiteMap } from "@/lib/voice-engine/read-config";
import { selectRoute, type SiteMap } from "@/lib/voice-engine/site-map";
import { isIntent, isLang, type FastDecision, type Intent, type Lang } from "@/lib/voice-engine/types";

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

const INTENT_CRITERIA: Record<Intent, string> = {
  greeting: "Hello, hi, or 你好 with no real question about the company, price, product, or booking.",
  company_intro: "Asks what the company does, what is special, or for a basic introduction. Not a price, PDF, or booking request.",
  navigate_pricing: "Asks the price, the plans, or to compare Starter, Growth, and Enterprise.",
  navigate_advantages: "Asks about the PDF knowledge base, hallucination control, or how the technology works.",
  deep_lookup: "Asks a specific clause, an industry case detail, or an unusual detailed question that is not a greeting, intro, price, product overview, or booking.",
  booking_demo: "Wants to book a demo, leave contact details, or have the team follow up.",
};

const FORCED_PAGE: Partial<Record<Intent, { url: string; sectionId?: string }>> = {
  navigate_pricing: { url: "pricing" },
  navigate_advantages: { url: "advantages" },
  booking_demo: { url: "about", sectionId: "demo-booking-form" },
};

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

async function runOpener(text: string): Promise<OpenerDecision> {
  const answers = await jevChoices(
    {
      utterance: text,
      setting: "VoicePilot AI website. The speaker is a senior voice-solution specialist, not a clinic receptionist.",
    },
    {
      intent: {
        type: "choice",
        instructions:
          "Which opener should play first? Use greeting only for hello. Use company_intro for what the company does. Use navigate_pricing for price or plans. Use navigate_advantages for PDF, hallucination control, or how it works. Use booking_demo when they want a demo or to leave contact details. Use deep_lookup only for a specific clause, case detail, or unusual question. Do not use deep_lookup for a greeting, a company introduction, a price, or a booking.",
        criteria: INTENT_CRITERIA,
      },
      lang: {
        type: "choice",
        instructions:
          "Which language is the guest speaking? If they mix languages, pick the language the spoken reply should use.",
        criteria: LANG_CRITERIA,
      },
    },
  );

  const intentAnswer = readChoice(answers.intent, Object.keys(INTENT_CRITERIA));
  const langAnswer = readChoice(answers.lang, Object.keys(LANG_CRITERIA));
  if (!isIntent(intentAnswer.choice) || !isLang(langAnswer.choice)) {
    throw new Error("Jev request failed (bad response)");
  }

  const clip = clipFor(loadClipsConfig(), intentAnswer.choice, langAnswer.choice);
  return {
    intent: clip.intent,
    lang: clip.lang,
    clipText: clip.clipText,
    clipFile: clip.file,
  };
}

export function decideOpener(text: string): Promise<OpenerDecision> {
  const now = Date.now();
  const cache = openerCache();
  if (cache.key === text && cache.expires > now && cache.promise) {
    return cache.promise;
  }

  const promise = runOpener(text).catch((error: unknown) => {
    const current = openerCache();
    if (current.promise === promise) {
      current.key = "";
      current.expires = 0;
      current.promise = null;
    }
    throw error;
  });

  cache.key = text;
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

export async function decideFast(text: string, siteMap: SiteMap = loadSiteMap()): Promise<FastDecision> {
  const [opener, route] = await Promise.all([decideOpener(text), decideRoute(text, siteMap)]);
  const navigation = navigationFor(opener.intent, siteMap) ?? route;
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
