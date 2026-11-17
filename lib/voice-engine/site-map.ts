export type SitePage = {
  url: string;
  name: string;
  sectionId?: string;
  keywords: Record<string, string[]>;
};

export type SiteMap = {
  threshold: number;
  pages: SitePage[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readKeywords(value: unknown): Record<string, string[]> {
  if (!isRecord(value)) return {};
  const keywords: Record<string, string[]> = {};
  for (const [lang, items] of Object.entries(value)) {
    if (!Array.isArray(items)) continue;
    keywords[lang] = items.filter((item): item is string => typeof item === "string");
  }
  return keywords;
}

export function parseSiteMap(value: unknown): SiteMap {
  if (!isRecord(value) || !Array.isArray(value.pages)) {
    throw new Error("config/site-map.json is invalid");
  }
  const threshold = value.threshold;
  if (typeof threshold !== "number") {
    throw new Error("config/site-map.json is invalid");
  }
  const pages = value.pages.map((item) => {
    if (!isRecord(item) || typeof item.url !== "string" || typeof item.name !== "string") {
      throw new Error("config/site-map.json is invalid");
    }
    const sectionId = typeof item.sectionId === "string" ? item.sectionId.trim() : "";
    return {
      url: item.url,
      name: item.name,
      sectionId: sectionId || undefined,
      keywords: readKeywords(item.keywords),
    };
  });
  return { threshold, pages };
}

export function selectRoute(
  choice: string,
  confidence: number,
  siteMap: SiteMap,
): { navigateUrl: string; sectionId: string | null; pageName: string | null; confidence: number } {
  const page = siteMap.pages.find((item) => item.url === choice);
  if (!page || choice === "NONE" || confidence < siteMap.threshold) {
    return { navigateUrl: "NONE", sectionId: null, pageName: null, confidence };
  }
  return {
    navigateUrl: page.url,
    sectionId: page.sectionId ?? null,
    pageName: page.name,
    confidence,
  };
}
