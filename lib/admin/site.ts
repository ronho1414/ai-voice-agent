export const DEFAULT_SITE_ID = "voicepilot-hq";

const SITE_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function readSiteId(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") return DEFAULT_SITE_ID;
  const siteId = value.trim().toLowerCase();
  if (!SITE_ID.test(siteId)) throw new Error("Site is invalid");
  return siteId;
}

export function readOptionalText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}
