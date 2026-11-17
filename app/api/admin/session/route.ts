import { adminConfigured, adminCookie, isAdminRequest, passwordMatches } from "@/lib/admin/auth";
import { adminUnavailable } from "@/lib/admin/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStore(body: unknown, status: number, cookie?: string): Response {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (cookie) headers.set("Set-Cookie", cookie);
  return Response.json(body, { status, headers });
}

export async function GET(request: Request): Promise<Response> {
  return noStore({ authenticated: isAdminRequest(request), configured: adminConfigured() }, 200);
}

export async function POST(request: Request): Promise<Response> {
  if (!adminConfigured()) return adminUnavailable();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noStore({ error: "Password is required" }, 400);
  }
  const password = typeof body === "object" && body !== null ? (body as { password?: unknown }).password : undefined;
  if (typeof password !== "string" || password.trim() === "") {
    return noStore({ error: "Password is required" }, 400);
  }
  if (!passwordMatches(password)) return noStore({ error: "Unauthorized" }, 401);
  return noStore({ authenticated: true }, 200, adminCookie(true));
}

export async function DELETE(): Promise<Response> {
  return noStore({ authenticated: false }, 200, adminCookie(false));
}
