import type { MetadataRoute } from "next";
import { isSiteIndexable, resolveSiteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return isSiteIndexable()
    ? { rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/dashboard", "/api/", "/beauty"] }, sitemap: `${resolveSiteUrl()}/sitemap.xml` }
    : { rules: { userAgent: "*", disallow: "/" } };
}
