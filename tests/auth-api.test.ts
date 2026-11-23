import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { GET, POST, DELETE } from "../app/api/platform/auth/session/route";
import { GET as legacySession } from "../app/api/admin/session/route";
import { GET as legacyLogs } from "../app/api/admin/logs/route";
import { GET as adminOverview } from "../app/api/platform/admin/overview/route";
import { GET as appointments } from "../app/api/platform/customer/appointments/route";
import { PATCH as appointmentUpdate } from "../app/api/platform/customer/appointments/route";
import { requireCustomerAuth } from "../lib/platform/auth";
import { isSameOriginMutation } from "../lib/platform/supabase-auth";

const originalFetch = globalThis.fetch;
const savedEnv = { ...process.env };
const base = "https://orai.example.test";
const fixtures: Record<string, { id: string; role: string; org: string }> = {
  "a@example.test": { id: "user-a", role: "user", org: "tenant-a" },
  "b@example.test": { id: "user-b", role: "user", org: "tenant-b" },
  "admin@example.test": { id: "user-admin", role: "super_admin", org: "" },
};
const tokens = new Map<string, string>();
const revoked = new Set<string>();
const disabled = new Set<string>();
let upstreamCalls = 0;
let roleOverride: string | undefined;
let refreshCalls = 0;
let authRateLimited = false;
let authUnavailable = false;
const storeCalls: URL[] = [];

function jwt(email: string, expires = Math.floor(Date.now() / 1000) + 3600) {
  const token = [Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url"),
    Buffer.from(JSON.stringify({ sub: fixtures[email].id, exp: expires, session_id: "test-session" })).toString("base64url"),
    Buffer.from(email).toString("base64url")].join(".");
  tokens.set(token, email);
  return token;
}
function user(email: string) {
  return { id: fixtures[email].id, email, aud: "authenticated", role: "authenticated", created_at: new Date().toISOString(),
    // Deliberately hostile metadata: application role must come from the DB.
    user_metadata: { system_role: "super_admin", organization_id: "tenant-b" }, app_metadata: {}, is_anonymous: false };
}
function session(email: string) {
  return { access_token: jwt(email), refresh_token: `refresh-${email}`, expires_in: 3600,
    token_type: "bearer", user: user(email) };
}
function request(path: string, method = "GET", body?: unknown, cookie = "", origin = base) {
  return new Request(base + path, { method, headers: { origin, cookie, "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
function cookieJar(response: Response) {
  return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
}
async function login(email: string, type = "customer") {
  return POST(request("/api/platform/auth/session", "POST", { email, password: "test-password", type }));
}

before(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-test-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test-key";
  globalThis.fetch = async (input, options) => {
    upstreamCalls++;
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(options?.headers);
    const token = (headers.get("authorization") || "").replace(/^Bearer /, "");
    const email = tokens.get(token);
    if (url.pathname === "/auth/v1/token") {
      if (authRateLimited) return Response.json({ message: "Too many attempts" }, { status: 429 });
      if (authUnavailable) return Response.json({ message: "Unavailable" }, { status: 503 });
      const body = JSON.parse(String(options?.body));
      if (url.searchParams.get("grant_type") === "refresh_token") {
        refreshCalls++;
        const refreshedEmail = String(body.refresh_token).replace(/^refresh-/, "");
        return Response.json(session(refreshedEmail));
      }
      return fixtures[body.email] && body.password === "test-password"
        ? Response.json(session(body.email))
        : Response.json({ message: "Invalid login credentials" }, { status: 400 });
    }
    if (url.pathname === "/auth/v1/user") {
      return email ? Response.json(user(email)) : Response.json({ message: "Invalid JWT" }, { status: 401 });
    }
    if (url.pathname === "/auth/v1/logout") {
      if (email) revoked.add(email);
      return new Response(null, { status: 204 });
    }
    if (url.pathname.endsWith("/rpc/current_session_is_active")) return Response.json(Boolean(email && !revoked.has(email)));
    if (url.pathname.endsWith("/profiles") && email) {
      return Response.json({ id: fixtures[email].id, email, full_name: "Test", system_role: roleOverride || fixtures[email].role });
    }
    if (url.pathname.endsWith("/organization_members") && email) {
      const org = fixtures[email].org;
      return Response.json(disabled.has(email) ? [] : [{ organization_id: org,
        organizations: { id: org, name: org, slug: org, status: "active" } }]);
    }
    if (url.pathname.endsWith("/appointments") && token === "service-test-key") {
      storeCalls.push(url);
      const org = url.searchParams.get("organization_id")?.replace(/^eq\./, "");
      if (url.searchParams.get("select") === "status") {
        return Response.json(url.searchParams.get("id") === `eq.${org}-appointment` ? { status: "pending" } : null);
      }
      if (options?.method === "PATCH") {
        const id = url.searchParams.get("id");
        if (id !== `eq.${org}-appointment`) return Response.json({ message: "not found" }, { status: 406 });
        return Response.json({ id: `${org}-appointment`, organization_id: org, status: "confirmed" });
      }
      return Response.json([{ id: `${org}-appointment`, organization_id: org }]);
    }
    throw new Error(`Unexpected test HTTP endpoint: ${url.pathname}`);
  };
});
after(() => {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});

test("slug-only, missing password, invalid JSON and old admin password cannot log in", async () => {
  const beforeCalls = upstreamCalls;
  for (const body of [{ type: "customer", slug: "tenant-a" }, { type: "customer", email: "a@example.test" },
    { type: "super_admin", password: "old-shared-password" }, { type: "customer", email: [], password: "x" }]) {
    assert.equal((await POST(request("/api/platform/auth/session", "POST", body))).status, 400);
  }
  const invalid = new Request(base + "/api/platform/auth/session", { method: "POST", headers: { origin: base }, body: "{" });
  assert.equal((await POST(invalid)).status, 400);
  assert.equal(upstreamCalls, beforeCalls);
});

test("wrong password fails; customer login uses DB role and returns no tokens", async () => {
  assert.equal((await POST(request("/api/platform/auth/session", "POST", { type: "customer", email: "a@example.test", password: "wrong" }))).status, 401);
  const response = await login("a@example.test");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.session.role, "customer_admin");
  assert.equal(body.session.organizationId, "tenant-a");
  assert.equal(body.access_token, undefined);
  assert.equal(body.refresh_token, undefined);
  assert.ok(response.headers.getSetCookie().every((cookie) => cookie.includes("HttpOnly") && cookie.includes("SameSite=Lax")));
  assert.match(response.headers.get("cache-control")!, /no-store/);
});

test("Auth rate limiting is not reported as an incorrect password", async () => {
  authRateLimited = true;
  try {
    const response = await login("a@example.test");
    assert.equal(response.status, 429);
    assert.match((await response.json()).error, /太頻密/);
  } finally { authRateLimited = false; }
});

test("Auth connectivity failures return service unavailable rather than incorrect password", async () => {
  authUnavailable = true;
  try {
    const response = await login("a@example.test");
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "AUTH_SERVICE_UNAVAILABLE");
  } finally { authUnavailable = false; }
});

test("old and forged custom cookies are rejected by both API families", async () => {
  const cookie = "orai_auth_session=forged; vp_admin=legacy-password-cookie";
  assert.equal((await (await GET(request("/api/platform/auth/session", "GET", undefined, cookie))).json()).authenticated, false);
  assert.equal((await legacyLogs(request("/api/admin/logs", "GET", undefined, cookie))).status, 401);
});

test("merchant cannot enter either admin API; cross-tenant selection is rejected", async () => {
  const cookie = cookieJar(await login("a@example.test"));
  assert.equal((await adminOverview(request("/api/platform/admin/overview", "GET", undefined, cookie))).status, 403);
  assert.equal((await legacyLogs(request("/api/admin/logs", "GET", undefined, cookie))).status, 403);
  const denied = await requireCustomerAuth(request("/api/platform/customer/overview", "GET", undefined, cookie), "tenant-b");
  assert.ok(denied instanceof Response);
  assert.equal(denied.status, 403);
});

test("requesting super_admin at login does not elevate a merchant", async () => {
  const response = await login("a@example.test", "super_admin");
  assert.equal(response.status, 403);
  assert.equal((await response.json()).session, undefined);
  revoked.delete("a@example.test");
});

test("customer list and update APIs bind all data queries to authenticated tenant", async () => {
  for (const email of ["a@example.test", "b@example.test"]) {
    const cookie = cookieJar(await login(email));
    const org = fixtures[email].org;
    const response = await appointments(request("/api/platform/customer/appointments?organizationId=other", "GET", undefined, cookie));
    assert.deepEqual((await response.json()).appointments, [{ id: `${org}-appointment`, organization_id: org }]);
    const denied = await appointmentUpdate(request("/api/platform/customer/appointments", "PATCH",
      { appointmentId: "foreign-appointment", status: "confirmed", organization_id: "other" }, cookie));
    assert.equal(denied.status, 400);
    assert.equal(storeCalls.at(-1)?.searchParams.get("organization_id"), `eq.${org}`);
  }
});

test("cross-origin and missing-origin mutations fail before contacting Auth", async () => {
  const beforeCalls = upstreamCalls;
  assert.equal((await POST(request("/api/platform/auth/session", "POST", {}, "", "https://evil.example.test"))).status, 403);
  const missing = new Request(base + "/api/platform/auth/session", { method: "DELETE" });
  assert.equal((await DELETE(missing)).status, 403);
  assert.equal(upstreamCalls, beforeCalls);
});

test("same-origin check handles Next canonical localhost URL with actual loopback Host", () => {
  const check = (origin: string, host = "127.0.0.1:3010", forwarded = "") => isSameOriginMutation(new Request("http://localhost:3010/api/public/beauty/appointments", {
    method: "POST", headers: { origin, host, "x-forwarded-host": forwarded },
  }));
  assert.equal(check("http://127.0.0.1:3010"), true);
  assert.equal(check("http://localhost:3010", "localhost:3010"), true);
  assert.equal(check("https://evil.example.test"), false);
  assert.equal(check("https://evil.example.test", "127.0.0.1:3010", "evil.example.test"), false);
  assert.equal(check("http://127.0.0.1:3011"), false);
  assert.equal(check("https://127.0.0.1:3010"), false);
  assert.equal(check("null"), false);
});

test("Supabase refresh persists updated cookies", async () => {
  const email = "b@example.test";
  const expiredSession = { ...session(email), access_token: jwt(email, Math.floor(Date.now() / 1000) - 10), expires_at: Math.floor(Date.now() / 1000) - 10 };
  const encoded = "base64-" + Buffer.from(JSON.stringify(expiredSession)).toString("base64url");
  const cookie = `sb-supabase-auth-token=${encoded}`;
  const response = await GET(request("/api/platform/auth/session", "GET", undefined, cookie));
  assert.equal((await response.json()).authenticated, true);
  assert.ok(refreshCalls > 0);
  assert.ok(response.headers.getSetCookie().length > 0);
});

test("membership removal and admin demotion are observed on the next request", async () => {
  const cookie = cookieJar(await login("a@example.test"));
  disabled.add("a@example.test");
  assert.equal((await (await GET(request("/api/platform/auth/session", "GET", undefined, cookie))).json()).authenticated, false);
  disabled.clear();
  const adminCookie = cookieJar(await login("admin@example.test", "super_admin"));
  assert.equal((await (await legacySession(request("/api/admin/session", "GET", undefined, adminCookie))).json()).session.role, "super_admin");
  roleOverride = "user";
  assert.equal((await legacyLogs(request("/api/admin/logs", "GET", undefined, adminCookie))).status, 403);
  roleOverride = undefined;
});

test("logout revokes session; replay of the old cookie is rejected", async () => {
  const cookie = cookieJar(await login("a@example.test"));
  const response = await DELETE(request("/api/platform/auth/session", "DELETE", undefined, cookie));
  assert.equal(response.status, 200);
  assert.ok(response.headers.getSetCookie().some((cookie) => cookie.startsWith("orai_auth_session=")));
  assert.equal((await (await GET(request("/api/platform/auth/session", "GET", undefined, cookie))).json()).authenticated, false);
});
