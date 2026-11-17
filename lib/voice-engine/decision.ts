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
  greeting: "Hello, thanks, or an opener with no question and no request to open a page.",
  checking_info: "Asks for a fact such as hours, address, phone, services, or another general question.",
  navigating: "Mainly wants to open or go to a page.",
  pricing: "Asks what something costs, about fees, or about the price list.",
  empathy: "Upset, worried, apologizing, or needs reassurance.",
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
      setting: "Clinic website voice receptionist. Choose the opener and the guest's language.",
    },
    {
      intent: {
        type: "choice",
        instructions:
          "Which short opener should play first? Use pricing when they ask what something costs. Use navigating when they mainly want to change pages. Use empathy when they are upset. Use greeting for hello. Use checking_info for other factual questions.",
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
          "Which page should open now? Choose a page URL only when the guest wants that page. Choose NONE when they are greeting, asking a question, or not asking to change pages.",
        criteria,
      },
    },
  );
  const answer = readChoice(answers.page, Object.keys(criteria));
  return selectRoute(answer.choice, answer.confidence, siteMap);
}

export async function decideFast(text: string, siteMap: SiteMap = loadSiteMap()): Promise<FastDecision> {
  const [opener, route] = await Promise.all([decideOpener(text), decideRoute(text, siteMap)]);
  return {
    intent: opener.intent,
    lang: opener.lang,
    clipText: opener.clipText,
    clipFile: opener.clipFile,
    navigateUrl: route.navigateUrl,
    pageName: route.pageName,
    confidence: route.confidence,
  };
}
