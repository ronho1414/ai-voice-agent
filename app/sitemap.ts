import type { MetadataRoute } from "next";
import { isSiteIndexable, resolveSiteUrl } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  // Marketing sections are client-side tabs, not separate indexable pages.
  return isSiteIndexable()
    ? [
        { url: `${resolveSiteUrl()}/`, changeFrequency: "monthly", priority: 1 },
        { url: `${resolveSiteUrl()}/privacy`, changeFrequency: "yearly", priority: 0.3 },
      ]
    : [];
}
