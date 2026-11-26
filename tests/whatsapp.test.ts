import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { POST as createSessionPost } from "../app/api/platform/auth/session/route";
import {
  GET as adminWhatsAppGet,
  POST as adminWhatsAppPost,
} from "../app/api/platform/admin/whatsapp/send/route";
import {
  GET as whatsappWebhookGet,
  POST as whatsappWebhookPost,
} from "../app/api/webhooks/whatsapp/route";
import {
  handleAdminWhatsAppSend,
  handleWhatsAppWebhookGet,
  handleWhatsAppWebhookPost,
  normalizeWhatsAppRecipient,
  parseWhatsAppWebhookPayload,
  verifyWhatsAppSignature,
} from "../lib/platform/whatsapp";

const db = new PGlite();

const userA = "10000000-0000-4000-8000-000000000201";
const userB = "10000000-0000-4000-8000-000000000202";
const adminUser = "10000000-0000-4000-8000-000000000203";
const orgA = "20000000-0000-4000-8000-000000000201";
const orgB = "20000000-0000-4000-8000-000000000202";
const sessionId = "40000000-0000-4000-8000-000000000201";

const phoneNumberId = "1465505606651153";
const merchantPhoneNumberId = "9999000011112222";
const wabaId = "1789220752190224";
const fakeAccessToken = "fictional-wa-access-token-do-not-leak";
const fakeAppSecret = "fictional-wa-app-secret-0123456789abcdef";
const fakeVerifyToken = "fictional-wa-verify-token-987654";

const base = "https://orai-stage.example.test";
const originalFetch = globalThis.fetch;
const savedEnv = { ...process.env };

const fixtures: Record<string, { id: string; role: string; org: string }> = {
  "a@example.test": { id: userA, role: "user", org: orgA },
  "b@example.test": { id: userB, role: "user", org: orgB },
  "admin@example.test": { id: adminUser, role: "super_admin", org: "" },
};
const tokens = new Map<string, string>();

function makeJwt(email: string) {
  const token = [
    Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url"),
    Buffer.from(
      JSON.stringify({
        sub: fixtures[email].id,
        exp: Math.floor(Date.now() / 1000) + 3600,
        session_id: sessionId,
      }),
    ).toString("base64url"),
    Buffer.from(email).toString("base64url"),
  ].join(".");
  tokens.set(token, email);
  return token;
}

function fakeAuthUser(email: string) {
  return {
    id: fixtures[email].id,
    email,
    aud: "authenticated",
    role: "authenticated",
    created_at: new Date().toISOString(),
    user_metadata: { system_role: "super_admin", organization_id: orgB },
    app_metadata: {},
    is_anonymous: false,
  };
}

function cookieJar(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

async function loginAs(email: string, type: "customer" | "super_admin") {
  const res = await createSessionPost(
    new Request(`${base}/api/platform/auth/session`, {
      method: "POST",
      headers: { origin: base, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "test-password", type }),
    }),
  );
  assert.equal(res.status, 200);
  return cookieJar(res);
}

async function asUser(user: string, sql: string, role = "authenticated") {
  await db.exec("begin");
  try {
    await db.exec(
      `set local role ${role}; set local request.jwt.claims = '${JSON.stringify({
        sub: user,
        session_id: sessionId,
        role,
      })}';`,
    );
    return await db.query(sql);
  } finally {
    await db.exec("rollback");
  }
}

function signBody(body: string, secret = fakeAppSecret): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

async function runRpc<T>(fnName: string, payload: unknown): Promise<T> {
  await db.exec("set role service_role");
  try {
    const { rows } = await db.query<{ result: T }>(
      `select public.${fnName}($1::jsonb) as result`,
      [JSON.stringify(payload)],
    );
    return rows[0].result;
  } finally {
    await db.exec("reset role");
  }
}

before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create schema auth;
    create table auth.users(id uuid primary key, banned_until timestamptz, is_anonymous boolean default false);
    create table auth.sessions(id uuid, user_id uuid, not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as
      $$select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as
      $$select (auth.jwt()->>'sub')::uuid$$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.jwt(), auth.uid() to authenticated;
  `);

  for (const file of [
    "001_multi_tenant_foundation.sql",
    "002_rls_write_hardening.sql",
    "20261123105304_auth_tenant_isolation.sql",
    "20261123110214_beauty_appointment_requests.sql",
    "20261123233500_update_appointment_transition.sql",
    "20261124055712_elevenlabs_post_call.sql",
    "20261124103151_immutable_agent_ownership.sql",
    "20261124160158_managed_agent_requests.sql",
    "20261126023000_message_inbox.sql",
    "20261126140000_whatsapp_cloud_api.sql",
    "20261126160000_stabilization_audit_fixes.sql",
  ]) {
    const sql = await readFile(
      new URL(`../supabase/migrations/${file}`, import.meta.url),
      "utf8",
    );
    await db.exec(sql.replace(/create extension if not exists pgcrypto;/i, ""));
  }

  await db.exec(`
    insert into auth.users(id) values ('${userA}'),('${userB}'),('${adminUser}');
    insert into auth.sessions(id,user_id) select '${sessionId}',id from auth.users;
    insert into public.profiles(id,email,full_name,system_role) values
      ('${userA}','a@example.test','Alice A','user'),
      ('${userB}','b@example.test','Bob B','user'),
      ('${adminUser}','admin@example.test','Admin','super_admin');
    insert into public.organizations(id,name,slug) values
      ('${orgA}','Merchant A','merchant-a'),
      ('${orgB}','Merchant B','merchant-b');
    insert into public.organization_members(organization_id,profile_id,role) values
      ('${orgA}','${userA}','customer_admin'),
      ('${orgB}','${userB}','customer_admin');
    insert into public.whatsapp_channels(scope, organization_id, phone_number_id, waba_id, display_phone) values
      ('admin', null, '${phoneNumberId}', '${wabaId}', '+15550001111'),
      ('merchant', '${orgA}', '${merchantPhoneNumberId}', '${wabaId}', '+85290001111');
  `);

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-test-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test-key";
  process.env.WHATSAPP_ACCESS_TOKEN = fakeAccessToken;
  process.env.WHATSAPP_APP_SECRET = fakeAppSecret;
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = fakeVerifyToken;
  process.env.WHATSAPP_PHONE_NUMBER_ID = phoneNumberId;
  process.env.WHATSAPP_WABA_ID = wabaId;
  process.env.WHATSAPP_GRAPH_API_VERSION = "v25.0";

  globalThis.fetch = async (input, options) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const headers = new Headers(options?.headers);
    const token = (headers.get("authorization") || "").replace(/^Bearer /, "");
    const email = tokens.get(token);

    if (url.pathname === "/auth/v1/token") {
      const body = JSON.parse(String(options?.body));
      return fixtures[body.email] && body.password === "test-password"
        ? Response.json({
            access_token: makeJwt(body.email),
            refresh_token: `refresh-${body.email}`,
            expires_in: 3600,
            token_type: "bearer",
            user: fakeAuthUser(body.email),
          })
        : Response.json({ message: "Invalid login credentials" }, { status: 400 });
    }
    if (url.pathname === "/auth/v1/user") {
      return email ? Response.json(fakeAuthUser(email)) : Response.json({ message: "Unauthorized" }, { status: 401 });
    }
    if (url.pathname.endsWith("/rpc/current_session_is_active")) {
      return Response.json(Boolean(email));
    }
    if (url.pathname.endsWith("/profiles") && email) {
      return Response.json({
        id: fixtures[email].id,
        email,
        full_name: email,
        system_role: fixtures[email].role,
      });
    }
    if (url.pathname.endsWith("/organization_members") && email) {
      const org = fixtures[email].org;
      if (!org) return Response.json([]);
      return Response.json([
        {
          organization_id: org,
          organizations: { id: org, name: org, slug: org, status: "active" },
        },
      ]);
    }
    const rpcMatch = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(url.pathname);
    if (rpcMatch) {
      const body = options?.body ? JSON.parse(String(options.body)) : {};
      return Response.json(await runRpc(rpcMatch[1], body.payload));
    }
    if (url.pathname === "/rest/v1/whatsapp_messages") {
      const scopeFilter = url.searchParams.get("scope") === "eq.admin" ? "where scope = 'admin'" : "";
      const { rows } = await db.query(
        `select id,scope,organization_id,phone_number_id,direction,wa_message_id,peer_wa_id,peer_name,message_type,template_name,body_text,status,error_code,error_title,error_message,sent_at,delivered_at,read_at,failed_at,received_at,created_at from public.whatsapp_messages ${scopeFilter} order by created_at desc limit 30`,
      );
      return Response.json(rows);
    }
    if (url.pathname === "/rest/v1/whatsapp_status_events") {
      const scopeFilter = url.searchParams.get("scope") === "eq.admin" ? "where scope = 'admin'" : "";
      const { rows } = await db.query(
        `select id,whatsapp_message_id,wa_message_id,status,recipient_id,error_code,error_title,error_message,provider_timestamp,created_at from public.whatsapp_status_events ${scopeFilter} order by created_at desc limit 50`,
      );
      return Response.json(rows);
    }
    if (url.origin === "https://graph.facebook.com") {
      assert.equal(url.pathname, `/v25.0/${phoneNumberId}/messages`);
      assert.equal(headers.get("authorization"), `Bearer ${fakeAccessToken}`);
      const reqBody = JSON.parse(String(options?.body));
      const suffix = reqBody.type === "text" ? "text_002" : "send_002";
      return Response.json({
        messaging_product: "whatsapp",
        contacts: [{ input: reqBody.to, wa_id: reqBody.to }],
        messages: [{ id: `wamid.fictional_stage_${suffix}` }],
      });
    }

    return originalFetch(input, options);
  };
});

after(async () => {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
  await db.close();
});

test("phone normalization and GET webhook verification enforce fail-closed checks", async () => {
  assert.equal(normalizeWhatsAppRecipient("+852 9123-4567"), "85291234567");
  assert.throws(() => normalizeWhatsAppRecipient("1234"), /格式不正確/);

  const unconfigured = await handleWhatsAppWebhookGet(
    new Request(`${base}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=x&hub.challenge=123`),
    {
      accessToken: "",
      appSecret: "",
      verifyToken: "",
      phoneNumberId,
      wabaId,
      graphVersion: "v25.0",
      appId: "",
      businessId: "",
    },
  );
  assert.equal(unconfigured.status, 503);

  const wrongToken = await whatsappWebhookGet(
    new Request(`${base}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=999`),
  );
  assert.equal(wrongToken.status, 403);

  const valid = await whatsappWebhookGet(
    new Request(
      `${base}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${fakeVerifyToken}&hub.challenge=challenge_ok_123`,
    ),
  );
  assert.equal(valid.status, 200);
  assert.equal(await valid.text(), "challenge_ok_123");
});

test("POST webhook enforces raw-body X-Hub-Signature-256 and ingests statuses & inbound messages", async () => {
  const samplePayload = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: wabaId,
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: phoneNumberId },
              statuses: [
                {
                  id: "wamid.fictional_stage_send_001",
                  status: "delivered",
                  timestamp: "1764160005",
                  recipient_id: "85291234567",
                },
                {
                  id: "wamid.fictional_stage_send_001",
                  status: "sent",
                  timestamp: "1764160001",
                  recipient_id: "85291234567",
                },
              ],
              messages: [
                {
                  from: "85291234567",
                  id: "wamid.fictional_inbound_001",
                  timestamp: "1764160010",
                  type: "text",
                  text: { body: "收到，唔該！" },
                },
              ],
              contacts: [{ wa_id: "85291234567", profile: { name: "Fictional Tester" } }],
            },
          },
        ],
      },
    ],
  });

  // Missing secret returns 503
  const unconfigured = await handleWhatsAppWebhookPost(
    new Request(`${base}/api/webhooks/whatsapp`, { method: "POST", body: samplePayload }),
    {
      config: {
        accessToken: "",
        appSecret: "",
        verifyToken: "",
        phoneNumberId,
        wabaId,
        graphVersion: "v25.0",
        appId: "",
        businessId: "",
      },
    },
  );
  assert.equal(unconfigured.status, 503);

  // Invalid / tampered signature returns 401
  const badSig = await whatsappWebhookPost(
    new Request(`${base}/api/webhooks/whatsapp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-hub-signature-256": signBody(samplePayload, "wrong-app-secret"),
      },
      body: samplePayload,
    }),
  );
  assert.equal(badSig.status, 401);

  assert.equal(
    verifyWhatsAppSignature(Buffer.from(samplePayload), signBody(samplePayload), fakeAppSecret),
    true,
  );

  // Valid signed webhook persists cleanly; delivered stays 'delivered' even when out-of-order 'sent' arrives
  const okRes = await whatsappWebhookPost(
    new Request(`${base}/api/webhooks/whatsapp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-hub-signature-256": signBody(samplePayload),
      },
      body: samplePayload,
    }),
  );
  assert.equal(okRes.status, 200);
  const okBody = await okRes.json();
  assert.equal(okBody.ok, true);
  assert.equal(okBody.statuses_processed, 2);
  assert.equal(okBody.messages_processed, 1);

  const outboundRow = (
    await db.query<{ status: string }>(
      "select status from public.whatsapp_messages where wa_message_id = $1",
      ["wamid.fictional_stage_send_001"],
    )
  ).rows[0];
  assert.equal(outboundRow.status, "delivered");

  const inboundRow = (
    await db.query<{ peer_name: string; body_text: string; status: string }>(
      "select peer_name, body_text, status from public.whatsapp_messages where wa_message_id = $1",
      ["wamid.fictional_inbound_001"],
    )
  ).rows[0];
  assert.equal(inboundRow.peer_name, "Fictional Tester");
  assert.equal(inboundRow.body_text, "收到，唔該！");
  assert.equal(inboundRow.status, "received");

  // Merchant webhook isolates strictly to Merchant A
  const parsedMerchant = parseWhatsAppWebhookPayload({
    object: "whatsapp_business_account",
    entry: [
      {
        id: wabaId,
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: merchantPhoneNumberId },
              statuses: [
                {
                  id: "wamid.fictional_merchant_fail_001",
                  status: "failed",
                  timestamp: "1764160020",
                  recipient_id: "85298887777",
                  errors: [{ code: 131030, title: "Recipient phone number not in allowed list" }],
                },
              ],
            },
          },
        ],
      },
    ],
  });
  await runRpc("ingest_whatsapp_webhook", parsedMerchant);

  assert.equal((await asUser(userB, "select id from public.whatsapp_messages")).rows.length, 0);
  assert.equal((await asUser(userA, "select id from public.whatsapp_messages")).rows.length, 1);
  assert.equal((await asUser(adminUser, "select id from public.whatsapp_messages")).rows.length, 2);
});

test("admin WhatsApp send endpoint enforces RBAC, CSRF, sends template v25.0, and sanitizes Graph API errors", async () => {
  const customerCookie = await loginAs("a@example.test", "customer");
  const adminCookie = await loginAs("admin@example.test", "super_admin");

  assert.equal(
    (await adminWhatsAppGet(new Request(`${base}/api/platform/admin/whatsapp/send`))).status,
    401,
  );
  assert.equal(
    (
      await adminWhatsAppPost(
        new Request(`${base}/api/platform/admin/whatsapp/send`, {
          method: "POST",
          headers: { origin: base, cookie: customerCookie, "Content-Type": "application/json" },
          body: JSON.stringify({ to: "85291234567", type: "template", templateName: "hello_world" }),
        }),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await adminWhatsAppPost(
        new Request(`${base}/api/platform/admin/whatsapp/send`, {
          method: "POST",
          headers: {
            origin: "https://evil.example",
            cookie: adminCookie,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ to: "85291234567", type: "template", templateName: "hello_world" }),
        }),
      )
    ).status,
    403,
  );

  // Authorized super_admin template send hits Graph v25.0 and persists with idempotency
  const idemKey = "wa-idem-test-001";
  const sendRes = await adminWhatsAppPost(
    new Request(`${base}/api/platform/admin/whatsapp/send`, {
      method: "POST",
      headers: {
        origin: base,
        cookie: adminCookie,
        "x-idempotency-key": idemKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: "+852 9123 4567",
        type: "template",
        templateName: "hello_world",
        languageCode: "en_US",
      }),
    }),
  );
  assert.equal(sendRes.status, 200);
  const sendBody = await sendRes.json();
  assert.equal(sendBody.ok, true);
  assert.equal(sendBody.replayed, false);
  assert.equal(sendBody.waMessageId, "wamid.fictional_stage_send_002");

  // Replaying same idempotencyKey returns cached result WITHOUT calling Meta again
  const replayRes = await adminWhatsAppPost(
    new Request(`${base}/api/platform/admin/whatsapp/send`, {
      method: "POST",
      headers: {
        origin: base,
        cookie: adminCookie,
        "x-idempotency-key": idemKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: "+852 9123 4567",
        type: "template",
        templateName: "hello_world",
        languageCode: "en_US",
      }),
    }),
  );
  assert.equal(replayRes.status, 200);
  assert.equal((await replayRes.json()).replayed, true);

  // Reusing same idempotencyKey with different recipient/body rejects 409
  const conflictRes = await adminWhatsAppPost(
    new Request(`${base}/api/platform/admin/whatsapp/send`, {
      method: "POST",
      headers: {
        origin: base,
        cookie: adminCookie,
        "x-idempotency-key": idemKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: "+852 9888 7777",
        type: "template",
        templateName: "hello_world",
        languageCode: "en_US",
      }),
    }),
  );
  assert.equal(conflictRes.status, 409);

  // If Meta ACCEPTS (wamid returned) but DB finalize fails, surface reconciliation metadata cleanly (never silent retry)
  const partialFailRes = await handleAdminWhatsAppSend(
    new Request(`${base}/api/platform/admin/whatsapp/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-idempotency-key": "wa-reconcile-001" },
      body: JSON.stringify({ to: "85291234567", type: "template", templateName: "hello_world" }),
    }),
    {
      finalize: async () => {
        throw new Error("Simulated post-send DB failure");
      },
    },
  );
  assert.equal(partialFailRes.status, 503);
  const partialFailBody = await partialFailRes.json();
  assert.equal(partialFailBody.acceptedByMeta, true);
  assert.equal(partialFailBody.persisted, false);
  assert.equal(partialFailBody.reconciliationRequired, true);
  assert.equal(partialFailBody.retrySafe, false);
  assert.equal(partialFailBody.waMessageId, "wamid.fictional_stage_send_002");

  // Re-submitting same idempotencyKey while unconfirmed in 'queued' blocks duplicate send (409)
  const dupWhileQueued = await adminWhatsAppPost(
    new Request(`${base}/api/platform/admin/whatsapp/send`, {
      method: "POST",
      headers: {
        origin: base,
        cookie: adminCookie,
        "x-idempotency-key": "wa-reconcile-001",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to: "85291234567", type: "template", templateName: "hello_world" }),
    }),
  );
  assert.equal(dupWhileQueued.status, 409);
  assert.equal((await dupWhileQueued.json()).reconciliationRequired, true);

  // Status endpoint never returns secrets
  const statusRes = await adminWhatsAppGet(
    new Request(`${base}/api/platform/admin/whatsapp/send`, { headers: { cookie: adminCookie } }),
  );
  assert.equal(statusRes.status, 200);
  const statusBody = await statusRes.json();
  assert.equal(statusBody.configured.integrationMode, "orai_admin_staging_test");
  const statusText = JSON.stringify(statusBody);
  assert.equal(statusText.includes(fakeAccessToken), false);
  assert.equal(statusText.includes(fakeAppSecret), false);
  assert.equal(statusText.includes(fakeVerifyToken), false);

  // Status endpoint fails closed 503 when DB is missing (never empty 200)
  const { handleAdminWhatsAppStatus } = await import("../lib/platform/whatsapp");
  const savedSupaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  try {
    const missingDbStatus = await handleAdminWhatsAppStatus();
    assert.equal(missingDbStatus.status, 503);
    assert.equal((await missingDbStatus.json()).ok, false);
  } finally {
    process.env.NEXT_PUBLIC_SUPABASE_URL = savedSupaUrl;
  }

  // Unmapped phone_number_id in webhook is ignored (not dumped into admin)
  const unmappedParsed = parseWhatsAppWebhookPayload({
    object: "whatsapp_business_account",
    entry: [
      {
        id: wabaId,
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "5555555555555555" },
              messages: [{ from: "85299998888", id: "wamid.rogue", timestamp: "1764160099", type: "text", text: { body: "rogue" } }],
            },
          },
        ],
      },
    ],
  });
  const unmappedRes = await runRpc<{ unmapped_ignored: number; messages_processed: number }>(
    "ingest_whatsapp_webhook",
    unmappedParsed,
  );
  assert.equal(unmappedRes.unmapped_ignored, 1);
  assert.equal(unmappedRes.messages_processed, 0);

  // Meta error never leaks access token
  const errSendRes = await handleAdminWhatsAppSend(
    new Request(`${base}/api/platform/admin/whatsapp/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: "85291234567", type: "text", body: "Test failure" }),
    }),
    {
      fetchImpl: async () =>
        Response.json(
          { error: { code: 131030, type: "OAuthException", message: "Recipient phone number not in allowed list" } },
          { status: 400 },
        ),
      record: async (p) => p,
    },
  );
  assert.equal(errSendRes.status, 422);
  const errText = await errSendRes.text();
  assert.equal(errText.includes(fakeAccessToken), false);
});
