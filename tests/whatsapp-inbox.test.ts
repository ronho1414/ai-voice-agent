import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { POST as createSessionPost } from "../app/api/platform/auth/session/route";
import {
  GET as customerWhatsAppGet,
  POST as customerWhatsAppPost,
} from "../app/api/platform/customer/whatsapp/route";
import { GET as customerWhatsAppStreamGet } from "../app/api/platform/customer/whatsapp/stream/route";
import { GET as customerWhatsAppMediaGet } from "../app/api/platform/customer/whatsapp/media/route";
import { POST as whatsappHandoffPost } from "../app/api/tools/elevenlabs/whatsapp-handoff/route";
import { GET as notificationsGet } from "../app/api/platform/notifications/route";
import { generateElevenLabsTextReply } from "../lib/platform/elevenlabs-text";
import { handleWhatsAppWebhookPost } from "../lib/platform/whatsapp";
import { processPendingWhatsAppJobs } from "../lib/platform/whatsapp-inbox";

const db = new PGlite();

const userOrai = "10000000-0000-4000-8000-000000000301";
const userSalonA = "10000000-0000-4000-8000-000000000302";
const userSalonB = "10000000-0000-4000-8000-000000000303";
const orgOrai = "20000000-0000-4000-8000-000000000301";
const orgSalonA = "20000000-0000-4000-8000-000000000302";
const orgSalonB = "20000000-0000-4000-8000-000000000303";
const agentOraiId = "30000000-0000-4000-8000-000000000301";
const agentSalonAId = "30000000-0000-4000-8000-000000000302";
const agentSalonBId = "30000000-0000-4000-8000-000000000303";
const sessionId = "40000000-0000-4000-8000-000000000301";

const usPhoneNumberId = "1465505606651153";
const hkOraiPhoneId = "8888000011110001";
const salonAPhoneId = "8888000011110002";
const salonBPhoneId = "8888000011110003";
const wabaId = "1789220752190224";

const fakePlatformAccessToken = "fictional-wa-platform-token";
const fakeAppSecret = "fictional-wa-app-secret-0123456789abcdef";
const fakeChannelAccessToken = "fictional-wa-orai-channel-token";
const fakeSalonAToken = "fictional-wa-salon-a-token";
const oraiAgentToolToken = "orai_msg_fictional_orai_tool_token_301";
const salonAAgentToolToken = "orai_msg_fictional_salona_tool_token_302";

const base = "https://orai-stage.example.test";
const originalFetch = globalThis.fetch;
const savedEnv = { ...process.env };

const fixtures: Record<string, { id: string; role: string; org: string; slug: string }> = {
  "orai@example.test": { id: userOrai, role: "user", org: orgOrai, slug: "orai-service" },
  "salona@example.test": { id: userSalonA, role: "user", org: orgSalonA, slug: "salon-a" },
  "salonb@example.test": { id: userSalonB, role: "user", org: orgSalonB, slug: "salon-b" },
};
const tokens = new Map<string, string>();
let metaGraphCalls: Array<{ url: string; body: Record<string, unknown>; auth: string }> = [];
let nextMetaIdSeq = 1;
const metaForceError = false;

function sha256Hex(v: string) {
  return createHash("sha256").update(v, "utf8").digest("hex");
}

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
    user_metadata: {},
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

async function loginAs(email: string) {
  const res = await createSessionPost(
    new Request(`${base}/api/platform/auth/session`, {
      method: "POST",
      headers: { origin: base, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "test-password", type: "customer" }),
    }),
  );
  assert.equal(res.status, 200);
  return cookieJar(res);
}

function signWebhook(body: string, secret = fakeAppSecret): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

function makeInboundWebhookPayload(params: {
  phoneNumberId: string;
  wamid: string;
  from: string;
  name?: string;
  type?: "text" | "image" | "audio" | "document" | "location";
  body?: string;
  tsSec?: string;
}) {
  const msgType = params.type ?? "text";
  const ts = params.tsSec ?? String(Math.floor(Date.now() / 1000));
  const msgObj: Record<string, unknown> = {
    from: params.from,
    id: params.wamid,
    timestamp: ts,
    type: msgType,
  };
  if (msgType === "text") {
    msgObj.text = { body: params.body ?? "你好" };
  } else if (msgType === "image") {
    msgObj.image = { id: "media-img-1", mime_type: "image/jpeg", caption: params.body ?? "價目表截圖" };
  } else if (msgType === "audio") {
    msgObj.audio = { id: "media-aud-1", mime_type: "audio/ogg; codecs=opus", voice: true };
  } else if (msgType === "location") {
    msgObj.location = { latitude: 22.28, longitude: 114.15, name: "中環門市", address: "Central HK" };
  }
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: wabaId,
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: params.phoneNumberId },
              contacts: params.name ? [{ profile: { name: params.name }, wa_id: params.from }] : [],
              messages: [msgObj],
            },
          },
        ],
      },
    ],
  };
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

async function runRpc(fnName: string, body: Record<string, unknown>) {
  await db.exec("set role service_role");
  try {
    if (fnName === "claim_whatsapp_ai_job") {
      const { rows } = await db.query<{ result: unknown }>(
        "select public.claim_whatsapp_ai_job($1::uuid) as result",
        [body.p_conversation_id ?? null],
      );
      return rows[0].result;
    }
    if (fnName === "complete_whatsapp_ai_job_failure") {
      await db.query(
        "select public.complete_whatsapp_ai_job_failure($1::uuid, $2::text, $3::text)",
        [body.p_job_id, body.p_status, body.p_error ?? ""],
      );
      return null;
    }
    if (fnName === "read_whatsapp_channel_secrets") {
      const { rows } = await db.query<{ result: unknown }>(
        "select public.read_whatsapp_channel_secrets($1::uuid) as result",
        [body.p_channel_id],
      );
      return rows[0].result;
    }
    if (fnName === "list_whatsapp_channel_app_secrets") {
      const { rows } = await db.query(
        "select * from public.list_whatsapp_channel_app_secrets($1::text[])",
        [body.p_phone_number_ids ?? []],
      );
      return rows;
    }
    if (fnName === "whatsapp_conversation_command") {
      const { rows } = await db.query<{ result: unknown }>(
        "select public.whatsapp_conversation_command($1::uuid, $2::uuid, $3::text, $4::jsonb) as result",
        [body.actor_id, body.tenant_id, body.operation, JSON.stringify(body.payload ?? {})],
      );
      return rows[0].result;
    }
    if (fnName === "reserve_whatsapp_human_outbound") {
      const { rows } = await db.query<{ result: unknown }>(
        "select public.reserve_whatsapp_human_outbound($1::uuid, $2::uuid, $3::jsonb) as result",
        [body.actor_id, body.tenant_id, JSON.stringify(body.payload ?? {})],
      );
      return rows[0].result;
    }
    const { rows } = await db.query<{ result: unknown }>(
      `select public.${fnName}($1::jsonb) as result`,
      [JSON.stringify(body.payload ?? {})],
    );
    return rows[0].result;
  } finally {
    await db.exec("reset role");
  }
}

function applyPostgrestQuery(table: string, url: URL) {
  const clauses: string[] = [];
  const values: unknown[] = [];
  for (const [k, raw] of url.searchParams.entries()) {
    if (["select", "order", "limit", "offset"].includes(k)) continue;
    if (raw.startsWith("eq.")) {
      values.push(raw.slice(3));
      clauses.push(`${k} = $${values.length}`);
    } else if (raw === "is.null") {
      clauses.push(`${k} is null`);
    }
  }
  const where = clauses.length > 0 ? `where ${clauses.join(" and ")}` : "";
  const orderRaw = url.searchParams.get("order") || "";
  const orderSql = orderRaw
    ? `order by ${orderRaw
        .split(",")
        .map((p) => {
          const [col, dir] = p.split(".");
          return `${col} ${dir === "desc" ? "desc" : "asc"}`;
        })
        .join(", ")}`
    : "";
  const limitRaw = Number(url.searchParams.get("limit") || "100");
  const limitSql = Number.isFinite(limitRaw) && limitRaw > 0 ? `limit ${Math.min(limitRaw, 200)}` : "";
  return { sql: `select * from public.${table} ${where} ${orderSql} ${limitSql}`, values };
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
    "20261127020000_orai_first_party_tenant.sql",
    "20261127060000_staged_credential_rotation.sql",
    "20261127080000_whatsapp_live_inbox.sql",
    "20261128100000_whatsapp_voice_notes.sql",
  ]) {
    const sql = await readFile(
      new URL(`../supabase/migrations/${file}`, import.meta.url),
      "utf8",
    );
    await db.exec(sql.replace(/create extension if not exists pgcrypto;/i, ""));
  }

  await db.exec(`
    insert into auth.users(id) values ('${userOrai}'),('${userSalonA}'),('${userSalonB}');
    insert into auth.sessions(id,user_id) select '${sessionId}',id from auth.users;
    insert into public.profiles(id,email,full_name,system_role) values
      ('${userOrai}','orai@example.test','Orai Staff','user'),
      ('${userSalonA}','salona@example.test','Salon A Staff','user'),
      ('${userSalonB}','salonb@example.test','Salon B Staff','user');
    insert into public.organizations(id,name,slug) values
      ('${orgOrai}','Orai Service','orai-service'),
      ('${orgSalonA}','Salon A','salon-a'),
      ('${orgSalonB}','Salon B','salon-b');
    insert into public.organization_members(organization_id,profile_id,role) values
      ('${orgOrai}','${userOrai}','customer_admin'),
      ('${orgSalonA}','${userSalonA}','customer_admin'),
      ('${orgSalonB}','${userSalonB}','customer_admin');
    insert into public.agents(id,organization_id,elevenlabs_agent_id,name,status) values
      ('${agentOraiId}','${orgOrai}','agent_orai_001','Orai AI','active'),
      ('${agentSalonAId}','${orgSalonA}','agent_salona_001','Salon A AI','active'),
      ('${agentSalonBId}','${orgSalonB}','agent_salonb_001','Salon B AI','active');
    insert into public.agent_tool_credentials(organization_id,agent_id,tool_name,secret_hash,secret_prefix) values
      ('${orgOrai}','${agentOraiId}','create_message','${sha256Hex(oraiAgentToolToken)}','orai_msg'),
      ('${orgSalonA}','${agentSalonAId}','create_message','${sha256Hex(salonAAgentToolToken)}','orai_msg');
    insert into public.whatsapp_channels(id, scope, organization_id, agent_id, phone_number_id, waba_id, display_phone, country_code, ai_auto_reply_enabled, allow_platform_env_fallback) values
      ('50000000-0000-4000-8000-000000000001','merchant','${orgOrai}','${agentOraiId}','${usPhoneNumberId}','${wabaId}','+1 555-175-8159','1',false,false),
      ('50000000-0000-4000-8000-000000000002','merchant','${orgOrai}','${agentOraiId}','${hkOraiPhoneId}','${wabaId}','+852 5555-0001','852',true,false),
      ('50000000-0000-4000-8000-000000000003','merchant','${orgSalonA}','${agentSalonAId}','${salonAPhoneId}','${wabaId}','+852 5555-0002','852',true,false),
      ('50000000-0000-4000-8000-000000000004','merchant','${orgSalonB}','${agentSalonBId}','${salonBPhoneId}','${wabaId}','+852 5555-0003','852',true,false);
    insert into private.whatsapp_channel_secrets(channel_id, access_token, app_secret) values
      ('50000000-0000-4000-8000-000000000002','${fakeChannelAccessToken}','${fakeAppSecret}'),
      ('50000000-0000-4000-8000-000000000003','${fakeSalonAToken}','${fakeAppSecret}');
  `);

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-test-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test-key";
  process.env.WHATSAPP_ACCESS_TOKEN = fakePlatformAccessToken;
  process.env.WHATSAPP_APP_SECRET = fakeAppSecret;
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = "fictional-verify";
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
        : Response.json({ message: "Invalid" }, { status: 400 });
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
        full_name: fixtures[email].slug,
        system_role: fixtures[email].role,
      });
    }
    if (url.pathname.endsWith("/organization_members") && email) {
      const f = fixtures[email];
      return Response.json([
        {
          organization_id: f.org,
          organizations: { id: f.org, name: f.slug, slug: f.slug, status: "active" },
        },
      ]);
    }
    const rpcMatch = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(url.pathname);
    if (rpcMatch) {
      const body = options?.body ? JSON.parse(String(options.body)) : {};
      return Response.json(await runRpc(rpcMatch[1], body));
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      const table = url.pathname.replace("/rest/v1/", "");
      if (["whatsapp_conversations", "whatsapp_messages", "whatsapp_takeover_events", "whatsapp_channels", "notifications"].includes(table)) {
        const { sql, values } = applyPostgrestQuery(table, url);
        await db.exec("set role service_role");
        try {
          const { rows } = await db.query(sql, values);
          return Response.json(rows);
        } finally {
          await db.exec("reset role");
        }
      }
    }
    if (url.origin === "https://graph.facebook.com") {
      if (typeof FormData !== "undefined" && options?.body instanceof FormData) {
        metaGraphCalls.push({
          url: url.href,
          body: { upload: "audio/ogg" },
          auth: headers.get("authorization") || "",
        });
        return Response.json({ id: `media.upload_${nextMetaIdSeq++}` });
      }
      const reqBody = options?.body ? JSON.parse(String(options.body)) : {};
      metaGraphCalls.push({ url: url.href, body: reqBody, auth: headers.get("authorization") || "" });
      if (metaForceError) {
        return Response.json({ error: { code: 131047, type: "OAuthException", message: "Window expired" } }, { status: 400 });
      }
      const wamid = `wamid.test_${nextMetaIdSeq++}`;
      return Response.json({
        messaging_product: "whatsapp",
        messages: [{ id: wamid }],
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

test("ElevenLabs text WebSocket client verifies signed URL, text_only override, ping/pong, human history, and fail-closed checks", async () => {
  await assert.rejects(
    () =>
      generateElevenLabsTextReply({
        agentId: "agent_orai_001",
        unhandledCustomerMessages: ["Hello"],
        apiKey: "",
      }),
    /ELEVENLABS_API_KEY/,
  );

  const sentFrames: Record<string, unknown>[] = [];
  class FakeWebSocket {
    private listeners = new Map<string, Array<(event: unknown) => void>>();
    constructor(public url: string) {
      assert.equal(url, "wss://api.elevenlabs.io/v1/convai/signed-demo");
      setTimeout(() => this.emit("open", {}), 5);
    }
    addEventListener(type: string, fn: (event: unknown) => void) {
      const arr = this.listeners.get(type) ?? [];
      arr.push(fn);
      this.listeners.set(type, arr);
    }
    send(raw: string) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      sentFrames.push(parsed);
      if (parsed.type === "conversation_initiation_client_data") {
        setTimeout(() => {
          this.emit("message", {
            data: JSON.stringify({
              type: "conversation_initiation_metadata",
              conversation_initiation_metadata_event: { conversation_id: "el_conv_123" },
            }),
          });
          this.emit("message", {
            data: JSON.stringify({ type: "ping", ping_event: { event_id: 42 } }),
          });
        }, 5);
      }
      if (parsed.type === "user_message") {
        setTimeout(() => {
          this.emit("message", {
            data: JSON.stringify({
              type: "agent_response",
              agent_response_event: { agent_response: "收到，請問想預約邊日？" },
            }),
          });
        }, 10);
      }
    }
    close() {}
    private emit(type: string, event: unknown) {
      for (const fn of this.listeners.get(type) ?? []) fn(event);
    }
  }

  const res = await generateElevenLabsTextReply({
    agentId: "agent_orai_001",
    apiKey: "xi-fictional-test-key",
    conversationHistory: [
      { senderType: "customer", bodyText: "請問邊度有分店？" },
      { senderType: "human", bodyText: "我哋位於中環威靈頓街，我已經幫你記低資料。" },
    ],
    unhandledCustomerMessages: ["咁我想約聽日下晝三點"],
    dynamicVariables: { channel: "whatsapp", whatsapp_customer_wa_id: "85291234567" },
    fetchImpl: async (input, init) => {
      const u = String(input);
      assert.match(u, /get-signed-url\?agent_id=agent_orai_001/);
      assert.equal(new Headers(init?.headers).get("xi-api-key"), "xi-fictional-test-key");
      return Response.json({ signed_url: "wss://api.elevenlabs.io/v1/convai/signed-demo" });
    },
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
  });

  assert.equal(res.replyText, "收到，請問想預約邊日？");
  assert.equal(res.elevenlabsConversationId, "el_conv_123");
  const initFrame = sentFrames.find((f) => f.type === "conversation_initiation_client_data");
  assert.equal(
    ((initFrame?.conversation_config_override as Record<string, unknown>)?.conversation as Record<string, unknown>)
      ?.text_only,
    true,
  );
  const ctxFrame = sentFrames.find((f) => f.type === "contextual_update");
  assert.match(String(ctxFrame?.text), /\[真人客服\]/);
  const pongFrame = sentFrames.find((f) => f.type === "pong");
  assert.equal(pongFrame?.event_id, 42);
});

test("Webhook routing preserves Option A US number, deduplicates webhooks, coalesces bursts, and isolates concurrent conversations & tenants", async () => {
  // 1. Existing US channel (ai_auto_reply_enabled = false) persists message with 0 AI jobs enqueued
  const usPayload = JSON.stringify(
    makeInboundWebhookPayload({
      phoneNumberId: usPhoneNumberId,
      wamid: "wamid.us.001",
      from: "14155550199",
      name: "US Caller",
      body: "Test US",
    }),
  );
  const usRes = await handleWhatsAppWebhookPost(
    new Request(`${base}/api/webhooks/whatsapp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-hub-signature-256": signWebhook(usPayload) },
      body: usPayload,
    }),
  );
  assert.equal(usRes.status, 200);
  const usJson = await usRes.json();
  assert.equal(usJson.messages_processed, 1);
  assert.equal(usJson.ai_jobs_enqueued, 0);

  // 2. Rapid burst (2 customer messages + image + location + duplicate webhook) on HK Orai channel
  const w1 = JSON.stringify(
    makeInboundWebhookPayload({
      phoneNumberId: hkOraiPhoneId,
      wamid: "wamid.hk.burst1",
      from: "85298880001",
      name: "陳先生",
      body: "Hi 想問下月費計劃",
    }),
  );
  const w2 = JSON.stringify(
    makeInboundWebhookPayload({
      phoneNumberId: hkOraiPhoneId,
      wamid: "wamid.hk.burst2",
      from: "85298880001",
      name: "陳先生",
      body: "我間美容院每日約 30 個電話",
    }),
  );
  const wImg = JSON.stringify(
    makeInboundWebhookPayload({
      phoneNumberId: hkOraiPhoneId,
      wamid: "wamid.hk.img1",
      from: "85298880002",
      name: "李小姐",
      type: "image",
      body: "價錢表截圖",
    }),
  );

  for (const raw of [w1, w1, w2, wImg]) {
    const r = await handleWhatsAppWebhookPost(
      new Request(`${base}/api/webhooks/whatsapp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-hub-signature-256": signWebhook(raw) },
        body: raw,
      }),
    );
    assert.equal(r.status, 200);
  }

  // Verify dedupe: 2 messages + 1 image = 3 messages (NOT 4), 2 active AI jobs (one per conversation)
  const { rows: msgRows } = await db.query(
    `select wa_message_id, message_type, body_text, media_metadata from public.whatsapp_messages where peer_wa_id in ('85298880001', '85298880002') order by created_at asc`,
  );
  assert.equal(msgRows.length, 3);
  type MsgRow = { wa_message_id: string; message_type: string; body_text: string; media_metadata: Record<string, unknown> | null };
  const imgRow = (msgRows as MsgRow[]).find((r) => r.wa_message_id === "wamid.hk.img1");
  assert.equal(imgRow?.message_type, "image");
  assert.equal((imgRow?.media_metadata as Record<string, unknown>)?.media_id, "media-img-1");

  // Process pending AI jobs for 陳先生 + 李小姐
  metaGraphCalls = [];
  const capturedPrompts: Array<{ unhandled: string[]; historyCount: number }> = [];
  const workerRes = await processPendingWhatsAppJobs({
    maxJobs: 5,
    generateReply: async (input) => {
      capturedPrompts.push({
        unhandled: input.unhandledCustomerMessages,
        historyCount: input.conversationHistory?.length ?? 0,
      });
      return { replyText: `AI回覆: ${input.unhandledCustomerMessages.join(" | ")}`, elevenlabsConversationId: "el_conv_hk" };
    },
  });
  assert.equal(workerRes.sent, 2);
  assert.equal(metaGraphCalls.length, 2);
  // Burst coalesced into a single AI call with both unhandled texts
  assert.deepEqual(capturedPrompts[0].unhandled, ["Hi 想問下月費計劃", "我間美容院每日約 30 個電話"]);
  // Per-channel access token used instead of platform env token!
  assert.equal(metaGraphCalls[0].auth, `Bearer ${fakeChannelAccessToken}`);

  // Salon A customer message uses Salon A channel & remains isolated
  const wSalonA = JSON.stringify(
    makeInboundWebhookPayload({
      phoneNumberId: salonAPhoneId,
      wamid: "wamid.salona.1",
      from: "85297770001",
      name: "Salon A Guest",
      body: "預約 Facial",
    }),
  );
  await handleWhatsAppWebhookPost(
    new Request(`${base}/api/webhooks/whatsapp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-hub-signature-256": signWebhook(wSalonA) },
      body: wSalonA,
    }),
  );

  // Strict RLS verification at PostgreSQL level
  type WaConvRow = { customer_wa_id: string };
  const oraiRls = await asUser(userOrai, `select customer_wa_id from public.whatsapp_conversations`);
  assert.ok((oraiRls.rows as WaConvRow[]).some((r) => r.customer_wa_id === "85298880001"));
  assert.ok(!(oraiRls.rows as WaConvRow[]).some((r) => r.customer_wa_id === "85297770001"));

  const salonBRls = await asUser(userSalonB, `select customer_wa_id from public.whatsapp_conversations`);
  assert.equal(salonBRls.rows.length, 0);

  await assert.rejects(
    () => asUser(userOrai, `select * from private.whatsapp_channel_secrets`),
    /permission denied/i,
  );
});

test("Human Takeover stops AI immediately, handles mid-generation anti-race abort, enforces 24h window, and preserves human history on Resume AI", async () => {
  const oraiCookie = await loginAs("orai@example.test");
  const salonACookie = await loginAs("salona@example.test");

  // Fetch Orai conversations & pick 陳先生
  const listRes = await customerWhatsAppGet(
    new Request(`${base}/api/platform/customer/whatsapp`, { headers: { cookie: oraiCookie } }),
  );
  assert.equal(listRes.status, 200);
  const listJson = await listRes.json();
  const chanConv = listJson.conversations.find((c: { customer_wa_id: string }) => c.customer_wa_id === "85298880001");
  const leeConv = listJson.conversations.find((c: { customer_wa_id: string }) => c.customer_wa_id === "85298880002");
  assert.ok(chanConv && leeConv);

  // AC 14: New inbound arrives for 陳先生 -> AI worker starts generating -> human clicks Take Over BEFORE AI replies -> AI outbound ABORTED!
  const w3 = JSON.stringify(
    makeInboundWebhookPayload({
      phoneNumberId: hkOraiPhoneId,
      wamid: "wamid.hk.race1",
      from: "85298880001",
      name: "陳先生",
      body: "仲有冇真人客服可以跟進？",
    }),
  );
  await handleWhatsAppWebhookPost(
    new Request(`${base}/api/webhooks/whatsapp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-hub-signature-256": signWebhook(w3) },
      body: w3,
    }),
  );

  metaGraphCalls = [];
  const raceResult = await processPendingWhatsAppJobs({
    conversationId: chanConv.id,
    generateReply: async () => {
      // Simulate operator clicking Take Over mid-generation!
      const takeOverRes = await customerWhatsAppPost(
        new Request(`${base}/api/platform/customer/whatsapp`, {
          method: "POST",
          headers: { origin: base, cookie: oraiCookie, "Content-Type": "application/json" },
          body: JSON.stringify({ action: "take_over", conversationId: chanConv.id }),
        }),
      );
      assert.equal(takeOverRes.status, 200);
      return { replyText: "這條不應該送出的 AI 回覆", elevenlabsConversationId: "el_race" };
    },
  });
  assert.equal(raceResult.abortedByTakeover, 1);
  assert.equal(metaGraphCalls.length, 0);

  // Concurrent conversation (李小姐) MUST stay in AI mode while 陳先生 is Human mode
  const detailAfterTakeover = await customerWhatsAppGet(
    new Request(`${base}/api/platform/customer/whatsapp?conversationId=${leeConv.id}`, {
      headers: { cookie: oraiCookie },
    }),
  );
  assert.equal((await detailAfterTakeover.json()).selected.conversation.mode, "ai");

  // Customer replies in Human Mode -> NO AI job enqueued, status flips to needs_human, notification created
  const w4 = JSON.stringify(
    makeInboundWebhookPayload({
      phoneNumberId: hkOraiPhoneId,
      wamid: "wamid.hk.humanwait",
      from: "85298880001",
      name: "陳先生",
      body: "請問有人喺度嗎？",
    }),
  );
  const w4Res = await (
    await handleWhatsAppWebhookPost(
      new Request(`${base}/api/webhooks/whatsapp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-hub-signature-256": signWebhook(w4) },
        body: w4,
      }),
    )
  ).json();
  assert.equal(w4Res.ai_jobs_enqueued, 0);

  // Notification visible to Orai, NOT Salon A
  const oraiNotif = await (
    await notificationsGet(new Request(`${base}/api/platform/notifications`, { headers: { cookie: oraiCookie } }))
  ).json();
  assert.ok(oraiNotif.notifications.some((n: { kind: string; whatsapp_conversation_id: string }) => n.kind === "whatsapp_handoff" && n.whatsapp_conversation_id === chanConv.id));
  const salonANotif = await (
    await notificationsGet(new Request(`${base}/api/platform/notifications`, { headers: { cookie: salonACookie } }))
  ).json();
  assert.equal(salonANotif.notifications.length, 0);

  // Cross-tenant control blocked (Salon A cannot take_over or view Orai conversation)
  const crossTakeover = await customerWhatsAppPost(
    new Request(`${base}/api/platform/customer/whatsapp`, {
      method: "POST",
      headers: { origin: base, cookie: salonACookie, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "take_over", conversationId: chanConv.id }),
    }),
  );
  assert.equal(crossTakeover.status, 403);

  // Human sends reply via Dashboard + idempotency replay check
  metaGraphCalls = [];
  const idemKey = "hum-test-001";
  const send1 = await customerWhatsAppPost(
    new Request(`${base}/api/platform/customer/whatsapp`, {
      method: "POST",
      headers: {
        origin: base,
        cookie: oraiCookie,
        "Content-Type": "application/json",
        "x-idempotency-key": idemKey,
      },
      body: JSON.stringify({
        action: "send_text",
        conversationId: chanConv.id,
        body: "你好陳先生，我係真人同事 Alex，已經幫你免除首月設定費。",
      }),
    }),
  );
  assert.equal(send1.status, 200);
  const sendReplay = await customerWhatsAppPost(
    new Request(`${base}/api/platform/customer/whatsapp`, {
      method: "POST",
      headers: {
        origin: base,
        cookie: oraiCookie,
        "Content-Type": "application/json",
        "x-idempotency-key": idemKey,
      },
      body: JSON.stringify({
        action: "send_text",
        conversationId: chanConv.id,
        body: "你好陳先生，我係真人同事 Alex，已經幫你免除首月設定費。",
      }),
    }),
  );
  assert.equal((await sendReplay.json()).replayed, true);
  assert.equal(metaGraphCalls.length, 1);

  // AC 6: Resume AI -> old customer messages aren't repeated, next customer message carries human-agent turn in history!
  const resumeRes = await customerWhatsAppPost(
    new Request(`${base}/api/platform/customer/whatsapp`, {
      method: "POST",
      headers: { origin: base, cookie: oraiCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "resume_ai", conversationId: chanConv.id }),
    }),
  );
  assert.equal(resumeRes.status, 200);

  const w5 = JSON.stringify(
    makeInboundWebhookPayload({
      phoneNumberId: hkOraiPhoneId,
      wamid: "wamid.hk.afterresume",
      from: "85298880001",
      name: "陳先生",
      body: "多謝 Alex，咁我點樣開通帳號？",
    }),
  );
  await handleWhatsAppWebhookPost(
    new Request(`${base}/api/webhooks/whatsapp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-hub-signature-256": signWebhook(w5) },
      body: w5,
    }),
  );

  let seenHistory: Array<{ senderType: string; bodyText: string }> = [];
  let seenUnhandled: string[] = [];
  const afterResumeWorker = await processPendingWhatsAppJobs({
    conversationId: chanConv.id,
    generateReply: async (input) => {
      seenHistory = input.conversationHistory ?? [];
      seenUnhandled = input.unhandledCustomerMessages;
      return { replyText: "我可以即時為你安排開通！", elevenlabsConversationId: "el_resumed" };
    },
  });
  assert.equal(afterResumeWorker.sent, 1);
  assert.deepEqual(seenUnhandled, ["多謝 Alex，咁我點樣開通帳號？"]);
  assert.ok(seenHistory.some((h) => h.senderType === "human" && h.bodyText.includes("免除首月設定費")));

  // AC 11: Outside 24h Customer Service Window blocks free-form send_text, allows send_template
  await db.query(
    `update public.whatsapp_conversations set last_inbound_at = now() - interval '25 hours' where id = $1`,
    [chanConv.id],
  );
  const expiredTextRes = await customerWhatsAppPost(
    new Request(`${base}/api/platform/customer/whatsapp`, {
      method: "POST",
      headers: { origin: base, cookie: oraiCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "send_text",
        conversationId: chanConv.id,
        body: "Should be blocked",
      }),
    }),
  );
  assert.equal(expiredTextRes.status, 422);
  assert.equal((await expiredTextRes.json()).errorCode, "WINDOW_24H_EXPIRED");

  const tplRes = await customerWhatsAppPost(
    new Request(`${base}/api/platform/customer/whatsapp`, {
      method: "POST",
      headers: { origin: base, cookie: oraiCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "send_template",
        conversationId: chanConv.id,
        templateName: "hello_world",
        languageCode: "en_US",
      }),
    }),
  );
  assert.equal(tplRes.status, 200);

  // Handoff escalation tool endpoint on 李小姐 + CSRF + unauth stream checks
  const handoffRes = await whatsappHandoffPost(
    new Request(`${base}/api/tools/elevenlabs/whatsapp-handoff`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-orai-tool-secret": oraiAgentToolToken,
      },
      body: JSON.stringify({
        whatsapp_conversation_id: leeConv.id,
        reason: "顧客要求特殊報價",
        switch_to_human: true,
      }),
    }),
  );
  assert.equal(handoffRes.status, 200);
  const leeCheck = await customerWhatsAppGet(
    new Request(`${base}/api/platform/customer/whatsapp?conversationId=${leeConv.id}`, {
      headers: { cookie: oraiCookie },
    }),
  );
  const leeData = (await leeCheck.json()).selected.conversation;
  assert.equal(leeData.mode, "human");
  assert.equal(leeData.status, "needs_human");

  const csrfRejected = await customerWhatsAppPost(
    new Request(`${base}/api/platform/customer/whatsapp`, {
      method: "POST",
      headers: { origin: "https://evil.example.test", cookie: oraiCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "take_over", conversationId: leeConv.id }),
    }),
  );
  assert.equal(csrfRejected.status, 403);

  const unauthStream = await customerWhatsAppStreamGet(
    new Request(`${base}/api/platform/customer/whatsapp/stream`),
  );
  assert.equal(unauthStream.status, 401);
});

test("In-flight Meta dispatch before Take Over audits dispatched_before_takeover honestly without losing human mode", async () => {
  await db.query(
    `update public.whatsapp_conversations set mode = 'ai', mode_version = 10, last_inbound_at = now() where customer_wa_id = '85298880002'`,
  );
  const { rows: [conv] } = await db.query<{ id: string; mode_version: number }>(
    `select id, mode_version from public.whatsapp_conversations where customer_wa_id = '85298880002'`,
  );
  const { rows: [job] } = await db.query<{ id: string }>(
    `insert into public.whatsapp_ai_jobs(organization_id, whatsapp_conversation_id, agent_id, mode_version, status)
     values ($1, $2, $3, $4, 'processing') returning id`,
    [orgOrai, conv.id, agentOraiId, conv.mode_version],
  );

  // 1. Reserve succeeds while still in AI mode
  const reserved = (await runRpc("reserve_whatsapp_ai_outbound", {
    payload: {
      job_id: job.id,
      whatsapp_conversation_id: conv.id,
      expected_mode_version: conv.mode_version,
      processed_until_at: new Date().toISOString(),
      processed_last_msg_id: conv.id,
      body_text: "AI 正在送出的回覆",
      idempotency_key: `ai:${job.id}`,
      payload_hash: sha256Hex("inflight"),
    },
  })) as { action: string; record: { id: string } };
  assert.equal(reserved.action, "reserved");

  // 2. Human presses take_over while Meta HTTP request is in flight!
  const takeOverRes = (await runRpc("whatsapp_conversation_command", {
    actor_id: userOrai,
    tenant_id: orgOrai,
    operation: "take_over",
    payload: { conversation_id: conv.id },
  })) as { in_flight_ai_dispatch: boolean };
  assert.equal(takeOverRes.in_flight_ai_dispatch, true);

  // 3. Meta returns accepted wamid -> finalize flags dispatched_before_takeover = true while mode stays human!
  const finalized = (await runRpc("finalize_whatsapp_outbound", {
    payload: {
      id: reserved.record.id,
      status: "sent",
      wa_message_id: "wamid.inflight.001",
    },
  })) as { dispatched_before_takeover: boolean };
  assert.equal(finalized.dispatched_before_takeover, true);

  const { rows: auditRows } = await db.query(
    `select action from public.whatsapp_takeover_events where whatsapp_conversation_id = $1 and action = 'dispatched_before_takeover'`,
    [conv.id],
  );
  assert.equal(auditRows.length, 1);
});

function monoVoiceNote(channels = 1): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x4f, 0x67, 0x67, 0x53], 0);
  bytes.set(Buffer.from("OpusHead"), 28);
  bytes[36] = 1;
  bytes[37] = channels;
  return bytes;
}

async function inboundVoice(waId: string, wamid: string) {
  const raw = JSON.stringify(
    makeInboundWebhookPayload({
      phoneNumberId: hkOraiPhoneId,
      wamid,
      from: waId,
      name: "語音客戶",
      type: "audio",
    }),
  );
  const response = await handleWhatsAppWebhookPost(
    new Request(`${base}/api/webhooks/whatsapp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-hub-signature-256": signWebhook(raw) },
      body: raw,
    }),
  );
  assert.equal(response.status, 200);
  const { rows } = await db.query<{ id: string }>(
    `select id from public.whatsapp_conversations where customer_wa_id = $1`,
    [waId],
  );
  return rows[0].id;
}

test("voice notes transcribe once, reply with a WhatsApp voice message, and keep the transcript", async () => {
  await db.query(`update public.whatsapp_channels set reply_preference = 'auto' where phone_number_id = $1`, [
    hkOraiPhoneId,
  ]);
  const convId = await inboundVoice("85290000011", "wamid.voice.11");
  let scribeCalls = 0;
  let ttsCalls = 0;
  metaGraphCalls = [];
  const first = await processPendingWhatsAppJobs({
    conversationId: convId,
    maxJobs: 2,
    generateReply: async (input) => {
      assert.equal(input.unhandledCustomerMessages[0], "我想聽語音");
      return { replyText: "好呀，我而家用語音回覆。", elevenlabsConversationId: "el_voice" };
    },
    transcribeVoice: async (input) => {
      scribeCalls += 1;
      assert.equal(input.agentLanguageMode, "trilingual");
      return { ok: true, transcript: "我想聽語音", skipped: false, language: "yue", audioSeconds: 2.25 };
    },
    synthesizeVoice: async () => {
      ttsCalls += 1;
      return { ok: true, audio: monoVoiceNote(), characters: 12, modelId: "eleven_flash_v2_5" };
    },
    uploadVoice: async () => ({ ok: true, mediaId: "uploaded-voice-11" }),
  });
  assert.equal(first.sent, 1);
  assert.equal(scribeCalls, 1);
  assert.equal(ttsCalls, 1);
  const audioCall = metaGraphCalls.find((call) => call.body.type === "audio");
  assert.equal(audioCall?.body.type, "audio");
  assert.deepEqual(audioCall?.body.audio, { id: "uploaded-voice-11", voice: true });
  assert.equal(audioCall?.auth, `Bearer ${fakeChannelAccessToken}`);

  const { rows } = await db.query<{
    body_text: string;
    message_type: string;
    metadata: { delivery?: string; usage?: { stt_audio_seconds?: number }; latency_ms?: { e2e?: number } };
    media_metadata: { has_playback?: boolean; stt?: { status?: string } };
  }>(
    `select direction, message_type, body_text, metadata, media_metadata
     from public.whatsapp_messages where whatsapp_conversation_id = $1 order by created_at asc`,
    [convId],
  );
  assert.equal(rows[0].body_text, "我想聽語音");
  assert.equal(rows[0].media_metadata.stt?.status, "done");
  assert.equal(rows[1].message_type, "audio");
  assert.equal(rows[1].body_text, "好呀，我而家用語音回覆。");
  assert.equal(rows[1].metadata.delivery, "voice");
  assert.equal(rows[1].metadata.usage?.stt_audio_seconds, 2.25);
  assert.equal(typeof rows[1].metadata.latency_ms?.e2e, "number");
  assert.equal(rows[1].media_metadata.has_playback, true);

  const second = await processPendingWhatsAppJobs({
    conversationId: convId,
    transcribeVoice: async () => {
      scribeCalls += 1;
      return { ok: false, reason: "stt_failed" };
    },
    synthesizeVoice: async () => {
      ttsCalls += 1;
      return { ok: false };
    },
  });
  assert.equal(second.sent, 0);
  assert.equal(scribeCalls, 1);
  assert.equal(ttsCalls, 1);

  const oraiCookie = await loginAs("orai@example.test");
  const salonCookie = await loginAs("salona@example.test");
  const { rows: outbound } = await db.query<{ id: string }>(
    `select id from public.whatsapp_messages where whatsapp_conversation_id = $1 and direction = 'outbound'`,
    [convId],
  );
  const ownerAudio = await customerWhatsAppMediaGet(
    new Request(`${base}/api/platform/customer/whatsapp/media?messageId=${outbound[0].id}`, {
      headers: { cookie: oraiCookie },
    }),
  );
  assert.equal(ownerAudio.status, 200);
  assert.equal(ownerAudio.headers.get("content-type"), "audio/ogg");
  const otherTenant = await customerWhatsAppMediaGet(
    new Request(`${base}/api/platform/customer/whatsapp/media?messageId=${outbound[0].id}`, {
      headers: { cookie: salonCookie },
    }),
  );
  assert.equal(otherTenant.status, 404);
});

test("reply preference, TTS failure, takeover recheck, and transcript reuse stay fail-closed", async () => {
  await db.query(`update public.whatsapp_channels set reply_preference = 'text' where phone_number_id = $1`, [
    hkOraiPhoneId,
  ]);
  const textOnlyConv = await inboundVoice("85290000012", "wamid.voice.12");
  let ttsCalls = 0;
  metaGraphCalls = [];
  const textOnly = await processPendingWhatsAppJobs({
    conversationId: textOnlyConv,
    generateReply: async (input) => {
      assert.equal(input.unhandledCustomerMessages[0], "只回文字");
      return { replyText: "文字回覆", elevenlabsConversationId: null };
    },
    transcribeVoice: async () => ({ ok: true, transcript: "只回文字", skipped: false, language: "zh", audioSeconds: 1 }),
    synthesizeVoice: async () => {
      ttsCalls += 1;
      return { ok: true, audio: monoVoiceNote(), characters: 4, modelId: "eleven_flash_v2_5" };
    },
  });
  assert.equal(textOnly.sent, 1);
  assert.equal(ttsCalls, 0);
  assert.equal(metaGraphCalls.at(-1)?.body.type, "text");

  await db.query(`update public.whatsapp_channels set reply_preference = 'voice' where phone_number_id = $1`, [
    hkOraiPhoneId,
  ]);
  const raw = JSON.stringify(
    makeInboundWebhookPayload({
      phoneNumberId: hkOraiPhoneId,
      wamid: "wamid.voice.13",
      from: "85290000013",
      name: "文字客戶",
      type: "text",
      body: "請用語音答我",
    }),
  );
  assert.equal(
    (
      await handleWhatsAppWebhookPost(
        new Request(`${base}/api/webhooks/whatsapp`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-hub-signature-256": signWebhook(raw) },
          body: raw,
        }),
      )
    ).status,
    200,
  );
  const { rows: voicePrefRows } = await db.query<{ id: string }>(
    `select id from public.whatsapp_conversations where customer_wa_id = '85290000013'`,
  );
  metaGraphCalls = [];
  const voicePref = await processPendingWhatsAppJobs({
    conversationId: voicePrefRows[0].id,
    generateReply: async () => ({ replyText: "語音回覆", elevenlabsConversationId: null }),
    synthesizeVoice: async () => ({ ok: false }),
  });
  assert.equal(voicePref.sent, 1);
  assert.equal(metaGraphCalls.at(-1)?.body.type, "text");

  const cachedConv = await inboundVoice("85290000014", "wamid.voice.14");
  await db.query(
    `update public.whatsapp_messages
        set body_text = '已轉寫',
            media_metadata = media_metadata || '{"stt":{"status":"done","language":"en"}}'::jsonb
      where whatsapp_conversation_id = $1 and direction = 'inbound'`,
    [cachedConv],
  );
  let scribeCalls = 0;
  const reused = await processPendingWhatsAppJobs({
    conversationId: cachedConv,
    generateReply: async (input) => {
      assert.equal(input.unhandledCustomerMessages[0], "已轉寫");
      return { replyText: "收到", elevenlabsConversationId: null };
    },
    transcribeVoice: async () => {
      scribeCalls += 1;
      return { ok: false, reason: "stt_failed" };
    },
    synthesizeVoice: async () => ({ ok: true, audio: monoVoiceNote(), characters: 2, modelId: "eleven_flash_v2_5" }),
    uploadVoice: async () => ({ ok: true, mediaId: "should-not-upload" }),
    recheckAiSend: async () => ({ ok: false, action: "aborted_by_takeover" }),
  });
  assert.equal(scribeCalls, 0);
  assert.equal(reused.sent, 0);
  assert.equal(reused.abortedByTakeover, 1);
  assert.equal(metaGraphCalls.some((call) => call.body.audio), false);
  const { rows: blocked } = await db.query<{ error_code: string }>(
    `select error_code from public.whatsapp_messages
      where whatsapp_conversation_id = $1 and direction = 'outbound'`,
    [cachedConv],
  );
  assert.equal(blocked[0].error_code, "TAKEOVER_BEFORE_AUDIO");

  await db.query(
    `update private.whatsapp_voice_media set retain_until = now() - interval '1 minute' where organization_id = $1`,
    [orgOrai],
  );
  const purged = (await runRpc("purge_expired_whatsapp_voice_media", { payload: {} })) as { deleted: number };
  assert.ok(purged.deleted >= 1);

  const oraiCookie = await loginAs("orai@example.test");
  const salonCookie = await loginAs("salona@example.test");
  const { rows: channels } = await db.query<{ id: string }>(
    `select id from public.whatsapp_channels where phone_number_id = $1`,
    [hkOraiPhoneId],
  );
  const denied = await customerWhatsAppPost(
    new Request(`${base}/api/platform/customer/whatsapp`, {
      method: "POST",
      headers: { origin: base, cookie: salonCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_reply_preference", channelId: channels[0].id, preference: "voice" }),
    }),
  );
  assert.equal(denied.status, 403);
  const allowed = await customerWhatsAppPost(
    new Request(`${base}/api/platform/customer/whatsapp`, {
      method: "POST",
      headers: { origin: base, cookie: oraiCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_reply_preference", channelId: channels[0].id, preference: "auto" }),
    }),
  );
  assert.equal(allowed.status, 200);
  const { rows: pref } = await db.query<{ reply_preference: string }>(
    `select reply_preference from public.whatsapp_channels where id = $1`,
    [channels[0].id],
  );
  assert.equal(pref[0].reply_preference, "auto");
});
