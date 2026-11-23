import { createServerClient, parseCookieHeader, serializeCookieHeader, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

type RequestAuth = {
  client: SupabaseClient;
  pending: Map<string, { value: string; options: CookieOptions }>;
  headers: Record<string, string>;
};
const contexts = new WeakMap<Request, RequestAuth>();

export function authConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()));
}

export function requestSupabase(request: Request): SupabaseClient {
  const existing = contexts.get(request);
  if (existing) return existing.client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) throw new Error("Supabase Auth is not configured");
  const jar = new Map(parseCookieHeader(request.headers.get("cookie") || "").map(({ name, value }) => [name, value]));
  const pending: RequestAuth["pending"] = new Map();
  const headers: Record<string, string> = {};
  const client = createServerClient(url, key, {
    cookieOptions: { path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" },
    cookies: {
      getAll: () => Array.from(jar, ([name, value]) => ({ name, value })),
      setAll: (updates, cacheHeaders) => {
        for (const { name, value, options } of updates) {
          jar.set(name, value);
          pending.set(name, { value, options });
        }
        Object.assign(headers, cacheHeaders);
      },
    },
  });
  contexts.set(request, { client, pending, headers });
  return client;
}

export function isSameOriginMutation(request: Request): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;
  try {
    const requestUrl = new URL(request.url);
    const host = request.headers.get("host");
    // Next.js may canonicalize request.url to localhost despite an incoming
    // 127.0.0.1 Host. Validate against the actual request authority instead.
    // Never accept an arbitrary Origin or trust X-Forwarded-Host here.
    if (host && /[\s/\\@?#,]/.test(host)) return false;
    const expected = host ? new URL(`${requestUrl.protocol}//${host}`).origin : requestUrl.origin;
    return origin === expected;
  } catch { return false; }
}

// All authenticated routes use this adapter to persist refreshed HttpOnly
// cookies. No browser Supabase client or middleware is needed for these APIs.
export function withPlatformRequest(handler: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    let response: Response;
    try {
      response = isSameOriginMutation(request)
        ? await handler(request)
        : Response.json({ error: "Invalid request origin" }, { status: 403 });
    } catch {
      response = Response.json({ error: "身份驗證或資料服務暫時無法使用" }, { status: 503 });
    }
    const context = contexts.get(request);
    if (context) {
      for (const [name, { value, options }] of context.pending) {
        response.headers.append("Set-Cookie", serializeCookieHeader(name, value, options));
      }
      for (const [name, value] of Object.entries(context.headers)) response.headers.set(name, value);
    }
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("Vary", "Cookie");
    return response;
  };
}
