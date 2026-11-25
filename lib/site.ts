/** Public website configuration only. Never put provider credentials here. */
export const OFFICIAL_SITE_URL = "https://oraiservice.com";
export const LEGACY_SITE_URL = "https://ai-voice-agent-five-tau.vercel.app";

export function resolveSiteUrl(value = process.env.NEXT_PUBLIC_SITE_URL): string {
  const url = new URL(value?.trim() || OFFICIAL_SITE_URL);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash ||
      (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('NEXT_PUBLIC_SITE_URL must be an HTTPS origin (HTTP is allowed only for local development).');
  }
  return url.origin;
}

// Explicit opt-in: an isolated staging project may also use Vercel's production
// deployment target. NODE_ENV/VERCEL_ENV alone therefore cannot enable indexing.
export function isSiteIndexable(): boolean {
  return process.env.NEXT_PUBLIC_SITE_INDEXING === 'true' &&
    resolveSiteUrl() === OFFICIAL_SITE_URL &&
    process.env.VERCEL_ENV !== 'preview' && process.env.VERCEL_ENV !== 'development';
}

export function createEmbedSnippet(slug: string): string {
  return `<script src="${resolveSiteUrl()}/embed.js?client=${encodeURIComponent(slug)}" defer></script>`;
}
