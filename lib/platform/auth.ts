import { createHmac, timingSafeEqual } from "node:crypto";
import type { PlatformSession } from "./types";
import { getOrganizationById, getOrganizationBySlug } from "./store";

export const SESSION_COOKIE_NAME = "orai_auth_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function getSecretKey(): string {
  return process.env.ADMIN_PASSWORD?.trim() || "orai-default-platform-secret-key-salt";
}

export function signToken(payload: object): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", getSecretKey()).update(data).digest("base64url");
  return `${data}.${signature}`;
}

export function verifyToken<T>(token: string): T | null {
  try {
    const [data, signature] = token.split(".");
    if (!data || !signature) return null;
    const expectedSig = createHmac("sha256", getSecretKey()).update(data).digest("base64url");
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
    const json = Buffer.from(data, "base64url").toString("utf8");
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

export function readCookie(request: Request, name: string): string {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return "";
}

export async function getPlatformSession(request: Request): Promise<PlatformSession | null> {
  const cookieValue = readCookie(request, SESSION_COOKIE_NAME);
  if (!cookieValue) return null;
  const decoded = verifyToken<PlatformSession>(cookieValue);
  if (!decoded) return null;

  // Verify organization still exists if customer_admin
  if (decoded.role === "customer_admin" && decoded.organizationId) {
    const org = await getOrganizationById(decoded.organizationId);
    if (!org || org.status === "suspended") return null;
  }

  return decoded;
}

export function createSessionCookie(session: PlatformSession): string {
  const token = signToken(session);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}${secure}`;
}

export function clearSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function unauthorizedResponse(message = "Unauthorized access"): Response {
  return Response.json({ error: message }, { status: 401, headers: { "Cache-Control": "no-store" } });
}

export function forbiddenResponse(message = "Forbidden: Insufficient privileges"): Response {
  return Response.json({ error: message }, { status: 403, headers: { "Cache-Control": "no-store" } });
}

export async function requireSuperAdmin(request: Request): Promise<PlatformSession | Response> {
  const session = await getPlatformSession(request);
  if (!session) return unauthorizedResponse();
  if (session.role !== "super_admin") return forbiddenResponse("Super Admin access required");
  return session;
}

export async function requireCustomerAuth(
  request: Request,
  requiredOrgId?: string
): Promise<PlatformSession | Response> {
  const session = await getPlatformSession(request);
  if (!session) return unauthorizedResponse();

  // Super admin can access any customer's data
  if (session.role === "super_admin") return session;

  if (session.role === "customer_admin") {
    if (requiredOrgId && session.organizationId !== requiredOrgId) {
      return forbiddenResponse("Cannot access another business tenant data");
    }
    return session;
  }

  return forbiddenResponse();
}
