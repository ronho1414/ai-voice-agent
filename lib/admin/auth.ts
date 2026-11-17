import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "vp_admin";
const COOKIE_MAX_AGE = 60 * 60 * 12;

export function adminConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD?.trim());
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function passwordMatches(input: string): boolean {
  const expected = process.env.ADMIN_PASSWORD?.trim() ?? "";
  if (!expected || !input) return false;
  return timingSafeEqual(digest(input), digest(expected));
}

function sessionToken(): string | null {
  const password = process.env.ADMIN_PASSWORD?.trim();
  if (!password) return null;
  return createHmac("sha256", password).update("voicepilot-admin-v1").digest("base64url");
}

export function readAdminCookie(request: Request): string {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === ADMIN_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return "";
}

export function isAdminRequest(request: Request): boolean {
  const expected = sessionToken();
  if (!expected) return false;
  const actual = readAdminCookie(request);
  if (!actual) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function adminCookie(authenticated: boolean): string {
  if (!authenticated) return `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  const token = sessionToken() ?? "";
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}${secure}`;
}
