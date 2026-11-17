const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const PAGE_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const AGENT_ID = /^[A-Za-z0-9_-]{6,128}$/;
const NAME_LIMIT = 80;
const ROUTE_LIMIT = 40;
const URL_LIMIT = 500;

export type RouteMap = Record<string, string>;

export function readClientSlug(value: unknown): string {
  if (typeof value !== "string") throw new Error("Client slug is invalid");
  const slug = value.trim().toLowerCase();
  if (!SLUG.test(slug)) throw new Error("Client slug is invalid");
  return slug;
}

export function readClientName(value: unknown): string {
  if (typeof value !== "string") throw new Error("Client name is required");
  const name = value.replace(/\s+/g, " ").trim();
  if (!name) throw new Error("Client name is required");
  if (name.length > NAME_LIMIT) throw new Error("Client name is required");
  return name;
}

export function readAgentId(value: unknown): string {
  if (typeof value !== "string") throw new Error("Agent id is invalid");
  const agentId = value.trim();
  if (!AGENT_ID.test(agentId)) throw new Error("Agent id is invalid");
  return agentId;
}

export function readRouteMap(value: unknown): RouteMap {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Route map is invalid");
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > ROUTE_LIMIT) throw new Error("Route map is invalid");
  const map: RouteMap = {};
  for (const [key, url] of entries) {
    const page = key.trim();
    if (!PAGE_KEY.test(page) || typeof url !== "string") throw new Error("Route map is invalid");
    const target = url.trim();
    if (!isSafeTarget(target)) throw new Error("Route map is invalid");
    map[page] = target;
  }
  return map;
}

export function safeRouteMap(value: unknown): RouteMap {
  try {
    return readRouteMap(value);
  } catch {
    return {};
  }
}

function isSafeTarget(value: string): boolean {
  if (!value || value.length > URL_LIMIT || /[\s\\]/.test(value)) return false;
  if (value.startsWith("#")) return value.length > 1;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
