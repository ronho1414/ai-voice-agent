import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { POST as createSessionPost } from "../app/api/platform/auth/session/route";
import { POST as createMessageRoute } from "../app/api/tools/elevenlabs/create-message/route";
import {
  GET as customerMessagesGet,
  PATCH as customerMessagesPatch,
} from "../app/api/platform/customer/messages/route";
import {
  GET as adminMessagesGet,
  PATCH as adminMessagesPatch,
} from "../app/api/platform/admin/messages/route";
import {
  GET as notificationsGet,
  PATCH as notificationsPatch,
} from "../app/api/platform/notifications/route";
import {
  handleCreateElevenLabsMessage,
  extractBearerOrSecret,
  isValidToolSecret,
} from "../lib/platform/message-service";
import {
  MESSAGE_CATEGORIES,
  MESSAGE_STATUSES,
  parseCreateMessageInput,
} from "../lib/platform/messages";

const db = new PGlite();

const userA = "10000000-0000-4000-8000-000000000101";
const userB = "10000000-0000-4000-8000-000000000102";
const adminUser = "10000000-0000-4000-8000-000000000103";
const viewerUser = "10000000-0000-4000-8000-000000000104";
const oraiOfficialUser = "10000000-0000-4000-8000-000000000105";

const orgA = "20000000-0000-4000-8000-000000000101";
const orgB = "20000000-0000-4000-8000-000000000102";
const agentAId = "30000000-0000-4000-8000-000000000101";
const agentBId = "30000000-0000-4000-8000-000000000102";
const sessionId = "40000000-0000-4000-8000-000000000101";

const elAgentA = "agent_fictional_tenant_a_01";
const elAgentB = "agent_fictional_tenant_b_02";
const elOraiOfficialAgent = "agent_8201m7sbetj3e36s1a2nv3fgcqna";
const oraiOfficialToken = "fictional-stage-orai-official-secret-987654";
const agentAToken = "orai_msg_fictional_tenant_a_token_111111";
const agentBToken = "orai_msg_fictional_tenant_b_token_222222";
let orgOraiId = "";

function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const base = "https://orai-stage.example.test";
const originalFetch = globalThis.fetch;
const savedEnv = { ...process.env };

const fixtures: Record<string, { id: string; role: string; org: string }> = {
  "a@example.test": { id: userA, role: "user", org: orgA },
  "b@example.test": { id: userB, role: "user", org: orgB },
  "orai-official@example.test": { id: oraiOfficialUser, role: "user", org: "" },
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

function fakeSession(email: string) {
  return {
    access_token: makeJwt(email),
    refresh_token: `refresh-${email}`,
    expires_in: 3600,
    token_type: "bearer",
    user: fakeAuthUser(email),
  };
}

function cookieJar(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

async function loginAs(email: string, type: "customer" | "super_admin" = "customer") {
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

async function runServiceRpc<T>(fnName: string, params: Record<string, unknown>): Promise<T> {
  await db.exec("set role service_role");
  try {
    if (fnName === "create_elevenlabs_message") {
      const { rows } = await db.query<{ result: T }>(
        "select public.create_elevenlabs_message($1::jsonb) as result",
        [JSON.stringify(params.payload)],
      );
      return rows[0].result;
    }
    if (fnName === "message_inbox_command") {
      const { rows } = await db.query<{ result: T }>(
        "select public.message_inbox_command($1::uuid, $2::uuid, $3::text, $4::jsonb) as result",
        [
          params.actor_id,
          params.tenant_id,
          params.operation,
          JSON.stringify(params.payload ?? {}),
        ],
      );
      return rows[0].result;
    }
    if (fnName === "managed_agent_command") {
      const { rows } = await db.query<{ result: T }>(
        "select public.managed_agent_command($1::uuid, $2::uuid, $3::text, $4::jsonb) as result",
        [
          params.actor_id,
          params.tenant_id,
          params.operation,
          JSON.stringify(params.payload ?? {}),
        ],
      );
      return rows[0].result;
    }
    throw new Error(`Unsupported RPC: ${fnName}`);
  } finally {
    await db.exec("reset role");
  }
}

function parsePostgrestFilters(url: URL) {
  const clauses: string[] = [];
  const values: unknown[] = [];

  for (const [key, raw] of url.searchParams.entries()) {
    if (["select", "order", "limit", "offset"].includes(key)) continue;
    if (key === "or") {
      const inner = raw.replace(/^\(/, "").replace(/\)$/, "");
      const parts = inner.split(",");
      const orExprs: string[] = [];
      for (const part of parts) {
        const m = /^([a-z_]+)\.ilike\.(.+)$/i.exec(part.trim());
        if (m) {
          values.push(m[2]);
          orExprs.push(`${m[1]} ilike $${values.length}`);
        }
      }
      if (orExprs.length > 0) clauses.push(`(${orExprs.join(" or ")})`);
      continue;
    }
    if (raw === "is.null") {
      clauses.push(`${key} is null`);
      continue;
    }
    if (raw.startsWith("eq.")) {
      values.push(raw.slice(3));
      clauses.push(`${key} = $${values.length}`);
      continue;
    }
  }
  return { clauses, values };
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

let legacyAdminMsgId = "";

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
    insert into auth.users(id) values ('${userA}'),('${userB}'),('${adminUser}'),('${viewerUser}'),('${oraiOfficialUser}');
    insert into auth.sessions(id,user_id) select '${sessionId}',id from auth.users;
    insert into public.profiles(id,email,full_name,system_role) values
      ('${userA}','a@example.test','Alice Tenant A','user'),
      ('${userB}','b@example.test','Bob Tenant B','user'),
      ('${adminUser}','admin@example.test','Orai Super Admin','super_admin'),
      ('${viewerUser}','viewer@example.test','Viewer A','user'),
      ('${oraiOfficialUser}','orai-official@example.test','Orai Service Official','user');
    insert into public.organizations(id,name,slug) values
      ('${orgA}','Luxe Glow Spa (Fictional)','luxe-glow-fictional'),
      ('${orgB}','Harbour Dental (Fictional)','harbour-dental-fictional');
    insert into public.organization_members(organization_id,profile_id,role) values
      ('${orgA}','${userA}','customer_admin'),
      ('${orgB}','${userB}','customer_admin'),
      ('${orgA}','${viewerUser}','viewer');
    insert into public.agents(id,organization_id,name,elevenlabs_agent_id,status) values
      ('${agentAId}','${orgA}','Luxe Receptionist','${elAgentA}','active'),
      ('${agentBId}','${orgB}','Harbour Receptionist','${elAgentB}','active');
    select public.set_agent_tool_credential('${agentAId}', '${sha256Hex(agentAToken)}', 'orai_msg_a');
    select public.set_agent_tool_credential('${agentBId}', '${sha256Hex(agentBToken)}', 'orai_msg_b');
  `);

  // Seed one legacy pre-migration admin-scoped Orai message + event + note + notification
  await db.exec("set role service_role");
  try {
    const legacyMsg = (
      await db.query<{ id: string }>(
        `insert into public.messages(
          inbox_scope, organization_id, agent_id, provider, provider_agent_id,
          provider_conversation_id, channel, sender_name, recipient_name,
          message_content, message_summary, category, status, idempotency_key, payload_hash
        ) values (
          'admin', null, null, 'elevenlabs', '${elOraiOfficialAgent}',
          'conv_el_orai_legacy_001', 'phone', '何兆琪（歷史遷移測試）', '何生負責人',
          '聽日唔嚟啦，下次再約。', '何兆琪通知改約', 'specific_recipient', 'pending',
          'legacy-orai-001', repeat('b', 64)
        ) returning id`,
      )
    ).rows[0];
    legacyAdminMsgId = legacyMsg.id;

    const legacyEvent = (
      await db.query<{ id: string }>(
        `insert into public.message_events(message_id, inbox_scope, organization_id, actor_label, kind, to_status, detail)
         values ($1, 'admin', null, 'AI 專員', 'created', 'pending', '歷史事件') returning id`,
        [legacyAdminMsgId],
      )
    ).rows[0];

    await db.query(
      `insert into public.message_internal_notes(message_id, inbox_scope, organization_id, actor_id, actor_label, note)
       values ($1, 'admin', null, $2, 'Orai Super Admin', '歷史內部備註保留測試')`,
      [legacyAdminMsgId, adminUser],
    );

    await db.query(
      `insert into public.notifications(recipient_id, kind, message_id, organization_id, title, event_key)
       values ($1, 'message', $2, null, '新留言 MSG-LEGACY：來自 何兆琪', $3)`,
      [adminUser, legacyAdminMsgId, `msg:${legacyEvent.id}`],
    );
  } finally {
    await db.exec("reset role");
  }

  // Apply First-party Tenant & Staged Credential Rotation migrations and run idempotent provisioning + historical backfill RPC
  for (const migFile of [
    "20261127020000_orai_first_party_tenant.sql",
    "20261127060000_staged_credential_rotation.sql",
    "20261127080000_whatsapp_live_inbox.sql",
  ]) {
    const migSql = await readFile(
      new URL(`../supabase/migrations/${migFile}`, import.meta.url),
      "utf8",
    );
    await db.exec(migSql);
  }

  await db.exec("set role service_role");
  try {
    const provRes = (
      await db.query<{
        result: {
          ok: boolean;
          organization_id: string;
          migrated_messages: number;
          migrated_events: number;
          migrated_internal_notes: number;
          migrated_notifications: number;
        };
      }>("select public.provision_orai_first_party_tenant($1::jsonb) as result", [
        JSON.stringify({
          org_name: "Orai Service",
          org_slug: "orai-service",
          elevenlabs_agent_id: elOraiOfficialAgent,
          agent_name: "Orai Service 官方 AI 接待專員",
          member_profile_id: oraiOfficialUser,
          secret_hash: sha256Hex(oraiOfficialToken),
          secret_prefix: "orai_mkt",
        }),
      ])
    ).rows[0].result;

    assert.equal(provRes.ok, true);
    assert.equal(provRes.migrated_messages, 1);
    assert.equal(provRes.migrated_events, 1);
    assert.equal(provRes.migrated_internal_notes, 1);
    assert.equal(provRes.migrated_notifications, 1);
    orgOraiId = provRes.organization_id;
    fixtures["orai-official@example.test"].org = orgOraiId;
  } finally {
    await db.exec("reset role");
  }

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-test-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test-key";
  delete process.env.ELEVENLABS_MARKETING_TOOL_SECRET;
  delete process.env.ELEVENLABS_SERVER_TOOL_SECRET;

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
        ? Response.json(fakeSession(body.email))
        : Response.json({ message: "Invalid login credentials" }, { status: 400 });
    }
    if (url.pathname === "/auth/v1/user") {
      return email
        ? Response.json(fakeAuthUser(email))
        : Response.json({ message: "Invalid JWT" }, { status: 401 });
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
      const fnName = rpcMatch[1];
      const body = options?.body ? JSON.parse(String(options.body)) : {};
      try {
        const result = await runServiceRpc(fnName, body);
        return Response.json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "RPC failed";
        const code =
          (err as { code?: string })?.code ||
          (message.includes("Not authorized") ? "42501" : "P0001");
        return Response.json({ message, code }, { status: 400 });
      }
    }

    const tableMatch = /^\/rest\/v1\/([a-z_]+)$/.exec(url.pathname);
    if (tableMatch) {
      const table = tableMatch[1];
      if (
        ![
          "messages",
          "message_events",
          "message_internal_notes",
          "conversations",
          "notifications",
        ].includes(table)
      ) {
        return Response.json([]);
      }
      if (!email) {
        return Response.json({ message: "Unauthorized" }, { status: 401 });
      }

      const actorId = fixtures[email].id;
      const selectCols = url.searchParams.get("select") || "*";
      const { clauses, values } = parsePostgrestFilters(url);
      const whereSql = clauses.length ? `where ${clauses.join(" and ")}` : "";
      const orderParams = url.searchParams.getAll("order");
      const orderSql = orderParams.length
        ? `order by ${orderParams
            .flatMap((o) => o.split(","))
            .map((part) => {
              const clean = part.trim();
              if (clean.endsWith(".desc")) return `${clean.slice(0, -5)} desc`;
              if (clean.endsWith(".asc")) return `${clean.slice(0, -4)} asc`;
              return clean;
            })
            .join(", ")}`
        : "";

      const querySql = `select ${selectCols} from public.${table} ${whereSql} ${orderSql}`;
      await db.exec("begin");
      try {
        await db.exec(
          `set local role authenticated; set local request.jwt.claims = '${JSON.stringify({
            sub: actorId,
            session_id: sessionId,
            role: "authenticated",
          })}';`,
        );
        const res = await db.query(querySql, values);
        const rows = res.rows;
        const headersOut = new Headers();
        const prefer = headers.get("prefer") || "";
        if (prefer.includes("count=exact")) {
          headersOut.set(
            "content-range",
            rows.length === 0 ? "*/0" : `0-${rows.length - 1}/${rows.length}`,
          );
        }
        if ((options?.method || "GET").toUpperCase() === "HEAD") {
          return new Response(null, { status: 200, headers: headersOut });
        }
        if ((headers.get("accept") || "").includes("application/vnd.pgrst.object+json")) {
          if (rows.length === 0) {
            return new Response(null, { status: 200, headers: headersOut });
          }
          return Response.json(rows[0], { headers: headersOut });
        }
        return Response.json(rows, { headers: headersOut });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Query failed";
        return Response.json({ message }, { status: 400 });
      } finally {
        await db.exec("rollback");
      }
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

test("schema validation & helper checks accept valid categories and reject malformed inputs", () => {
  assert.deepEqual(MESSAGE_CATEGORIES, [
    "general_message",
    "callback_request",
    "complaint",
    "specific_recipient",
    "unanswered_question",
    "business_enquiry",
  ]);
  assert.deepEqual(MESSAGE_STATUSES, ["pending", "in_progress", "completed"]);

  const parsed = parseCreateMessageInput({
    senderName: " 陳先生 ",
    messageContent: " 請跟進上星期預約改期事宜 ",
    category: "callback_request",
    preferredCallbackTime: " 明日下午 3 點至 5 點 ",
  });
  assert.equal(parsed.senderName, "陳先生");
  assert.equal(parsed.contactPhone, "");
  assert.equal(parsed.recipientName, "");
  assert.equal(parsed.preferredCallbackTime, "明日下午 3 點至 5 點");
  assert.ok(parsed.messageSummary.length > 0);

  assert.throws(() =>
    parseCreateMessageInput({
      senderName: "陳先生",
      messageContent: "Hi",
      category: "invalid_category",
    }),
  );
  assert.equal(
    isValidToolSecret("secret-a", "secret-a"),
    true,
  );
  assert.equal(
    isValidToolSecret("secret-a", "secret-b"),
    false,
  );
  assert.equal(
    extractBearerOrSecret(
      new Request("https://example.test", {
        headers: { authorization: "Bearer my-secret" },
      }),
    ),
    "my-secret",
  );
});

test("ElevenLabs server tool enforces agent-scoped credentials, blocks agent impersonation, and fails closed on errors", async () => {
  const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const prevSrv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const prevMkt = process.env.ELEVENLABS_MARKETING_TOOL_SECRET;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const noSecretRes = await handleCreateElevenLabsMessage(
      new Request(`${base}/api/tools/elevenlabs/create-message`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    assert.equal(noSecretRes.status, 503);
    assert.deepEqual(await noSecretRes.json(), {
      ok: false,
      recorded: false,
      error: "Server tool authentication is not configured",
    });
  } finally {
    process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = prevSrv;
    process.env.ELEVENLABS_MARKETING_TOOL_SECRET = prevMkt;
  }

  // Neither customer nor admin can read hashed agent credentials through user Data API
  await assert.rejects(
    asUser(userA, "select secret_hash from public.agent_tool_credentials"),
    /permission denied/i,
  );
  await assert.rejects(
    asUser(adminUser, "select secret_hash from public.agent_tool_credentials"),
    /permission denied/i,
  );

  // Unknown bearer token rejects 401 even if supplying a valid merchant agent ID header
  const unauthRes = await createMessageRoute(
    new Request(`${base}/api/tools/elevenlabs/create-message`, {
      method: "POST",
      headers: {
        authorization: "Bearer wrong-secret",
        "x-elevenlabs-agent-id": elAgentA,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        senderName: "林小姐",
        messageContent: "想查詢療程收費",
        category: "general_message",
      }),
    }),
  );
  assert.equal(unauthRes.status, 401);
  assert.equal((await unauthRes.json()).recorded, false);

  // Impersonation blocked (403): Tenant A token CANNOT pose as Tenant B agent
  const impersonateTenantBRes = await createMessageRoute(
    new Request(`${base}/api/tools/elevenlabs/create-message`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${agentAToken}`,
        "x-elevenlabs-agent-id": elAgentB,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        senderName: "林小姐",
        messageContent: "想查詢療程收費",
        category: "general_message",
      }),
    }),
  );
  assert.equal(impersonateTenantBRes.status, 403);
  assert.equal((await impersonateTenantBRes.json()).recorded, false);

  // Impersonation blocked (403): Tenant A token CANNOT pose as Orai official first-party agent
  const impersonateOraiRes = await createMessageRoute(
    new Request(`${base}/api/tools/elevenlabs/create-message`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${agentAToken}`,
        "x-elevenlabs-agent-id": elOraiOfficialAgent,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        senderName: "林小姐",
        messageContent: "想查詢療程收費",
        category: "general_message",
      }),
    }),
  );
  assert.equal(impersonateOraiRes.status, 403);
  assert.equal((await impersonateOraiRes.json()).recorded, false);

  // Impersonation blocked (403): Orai official agent secret CANNOT inject into a merchant agent
  const oraiImpersonatesTenantRes = await createMessageRoute(
    new Request(`${base}/api/tools/elevenlabs/create-message`, {
      method: "POST",
      headers: {
        "x-orai-tool-secret": oraiOfficialToken,
        "x-elevenlabs-agent-id": elAgentA,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        senderName: "林小姐",
        messageContent: "想查詢療程收費",
        category: "general_message",
      }),
    }),
  );
  assert.equal(oraiImpersonatesTenantRes.status, 403);
  assert.equal((await oraiImpersonatesTenantRes.json()).recorded, false);

  const dbFailRes = await handleCreateElevenLabsMessage(
    new Request(`${base}/api/tools/elevenlabs/create-message`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${agentAToken}`,
        "x-elevenlabs-agent-id": elAgentA,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        senderName: "林小姐",
        messageContent: "想查詢療程收費",
        category: "general_message",
      }),
    }),
    {
      persist: async () => {
        throw new Error("Simulated Supabase outage");
      },
    },
  );
  assert.equal(dbFailRes.status, 503);
  const dbFailBody = await dbFailRes.json();
  assert.equal(dbFailBody.ok, false);
  assert.equal(dbFailBody.recorded, false);
});

let merchantMsgId = "";
let oraiFirstPartyMsgId = "";

test("merchant routing ignores spoofed organizationId, allows missing contact details & multiple messages per conversation, and prevents duplicates", async () => {
  // 1) Pre-existing conversation in Org A so linking attaches immediately
  await db.exec(`
    insert into public.conversations(id, organization_id, session_id, provider, provider_conversation_id, provider_agent_id, channel, caller_phone, caller_name, summary, transcript)
    values (
      '50000000-0000-4000-8000-000000000101',
      '${orgA}',
      'conv-a-001',
      'elevenlabs',
      'conv_el_a_001',
      '${elAgentA}',
      'phone',
      '+852 9000 1111',
      'Fictional Caller Wong',
      'Fictional conversation about bridal package and billing',
      '[{"role":"user","message":"想問新娘套餐同埋想留言搵店長"},{"role":"agent","message":"好呀，我幫你記低留言"}]'::jsonb
    );
  `);

  // First message: general_message with missing optional contactPhone & recipientName + spoofed orgB in JSON body
  const res1 = await createMessageRoute(
    new Request(`${base}/api/tools/elevenlabs/create-message`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${agentAToken}`,
        "x-elevenlabs-agent-id": elAgentA,
        "x-elevenlabs-conversation-id": "conv_el_a_001",
        "x-elevenlabs-channel": "web",
        "x-elevenlabs-tool-call-id": "toolcall-a-1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organizationId: orgB,
        merchantId: orgB,
        senderName: "黃小姐（虛構）",
        messageContent: "想問下下個月婚禮套餐仲有無檔期，暫時唔方便留電話。",
        category: "general_message",
      }),
    }),
  );
  assert.equal(res1.status, 200);
  const body1 = await res1.json();
  assert.equal(body1.ok, true);
  assert.equal(body1.recorded, true);
  assert.equal(body1.replayed, false);
  assert.match(body1.reference, /^MSG-\d{6}$/);
  merchantMsgId = body1.messageId;

  // Verify stored in Org A (never Org B!) and automatically linked to conv_el_a_001
  const stored1 = (
    await db.query<{
      organization_id: string;
      inbox_scope: string;
      conversation_id: string | null;
      contact_phone: string;
      recipient_name: string;
    }>(
      "select organization_id, inbox_scope, conversation_id, contact_phone, recipient_name from public.messages where id = $1",
      [merchantMsgId],
    )
  ).rows[0];
  assert.equal(stored1.organization_id, orgA);
  assert.equal(stored1.inbox_scope, "merchant");
  assert.equal(stored1.conversation_id, "50000000-0000-4000-8000-000000000101");
  assert.equal(stored1.contact_phone, "");
  assert.equal(stored1.recipient_name, "");

  // Duplicate retry using exact same tool call id returns replayed=true without creating a second row
  const replayRes = await createMessageRoute(
    new Request(`${base}/api/tools/elevenlabs/create-message`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${agentAToken}`,
        "x-elevenlabs-agent-id": elAgentA,
        "x-elevenlabs-conversation-id": "conv_el_a_001",
        "x-elevenlabs-tool-call-id": "toolcall-a-1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        senderName: "黃小姐（虛構）",
        messageContent: "想問下下個月婚禮套餐仲有無檔期，暫時唔方便留電話。",
        category: "general_message",
      }),
    }),
  );
  assert.equal(replayRes.status, 200);
  const replayBody = await replayRes.json();
  assert.equal(replayBody.replayed, true);
  assert.equal(replayBody.messageId, merchantMsgId);

  // Reused idempotency key with DIFFERENT payload rejects with 409
  const conflictRes = await createMessageRoute(
    new Request(`${base}/api/tools/elevenlabs/create-message`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${agentAToken}`,
        "x-elevenlabs-agent-id": elAgentA,
        "x-elevenlabs-conversation-id": "conv_el_a_001",
        "x-elevenlabs-tool-call-id": "toolcall-a-1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        senderName: "黃小姐（虛構）",
        messageContent: "改咗完全唔同內容嘅留言",
        category: "complaint",
      }),
    }),
  );
  assert.equal(conflictRes.status, 409);

  // Second legitimate message in the SAME conversation (even with X-ElevenLabs-Agent-Id omitted) still routes to Org A via agent credential
  const res2 = await createMessageRoute(
    new Request(`${base}/api/tools/elevenlabs/create-message`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${agentAToken}`,
        "x-elevenlabs-conversation-id": "conv_el_a_001",
        "x-elevenlabs-caller-id": "+852 9000 1111",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        senderName: "黃小姐（虛構）",
        contactPhone: "90001111",
        recipientName: "店長 Candy",
        messageContent: "另外想請店長 Candy 聽日下午兩點回電確認付款單據。",
        category: "callback_request",
        preferredCallbackTime: "明日下午 2:00",
      }),
    }),
  );
  assert.equal(res2.status, 200);
  const body2 = await res2.json();
  assert.equal(body2.ok, true);
  assert.equal(body2.replayed, false);
  assert.notEqual(body2.messageId, merchantMsgId);
  assert.notEqual(body2.reference, body1.reference);

  // Duplicate payload without explicit tool-call-id in the same conversation also deduplicates cleanly
  const dupWithoutKeyRes = await createMessageRoute(
    new Request(`${base}/api/tools/elevenlabs/create-message`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${agentAToken}`,
        "x-elevenlabs-agent-id": elAgentA,
        "x-elevenlabs-conversation-id": "conv_el_a_001",
        "x-elevenlabs-caller-id": "+852 9000 1111",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        senderName: "黃小姐（虛構）",
        contactPhone: "90001111",
        recipientName: "店長 Candy",
        messageContent: "另外想請店長 Candy 聽日下午兩點回電確認付款單據。",
        category: "callback_request",
        preferredCallbackTime: "明日下午 2:00",
      }),
    }),
  );
  assert.equal(dupWithoutKeyRes.status, 200);
  assert.equal((await dupWithoutKeyRes.json()).replayed, true);
});

test("Orai official agent routes as first-party tenant via x-orai-tool-secret and stays strictly isolated from other merchants", async () => {
  const res = await createMessageRoute(
    new Request(`${base}/api/tools/elevenlabs/create-message`, {
      method: "POST",
      headers: {
        "x-orai-tool-secret": oraiOfficialToken,
        "x-elevenlabs-agent-id": elOraiOfficialAgent,
        "x-elevenlabs-conversation-id": "conv_el_orai_999",
        "x-elevenlabs-channel": "web",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        senderName: "張先生（虛構）",
        contactPhone: "61112222",
        recipientName: "Orai 商務合作團隊",
        messageContent: "我們集團有 12 間診所想傾企業版合作。",
        category: "business_enquiry",
        preferredCallbackTime: "週五上午",
      }),
    }),
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.recorded, true);
  oraiFirstPartyMsgId = body.messageId;

  const row = (
    await db.query<{ inbox_scope: string; organization_id: string | null }>(
      "select inbox_scope, organization_id from public.messages where id = $1",
      [oraiFirstPartyMsgId],
    )
  ).rows[0];
  assert.equal(row.inbox_scope, "merchant");
  assert.equal(row.organization_id, orgOraiId);

  // Sync Orai official post-call transcript into Orai organization & auto-link message
  await db.exec("set role service_role");
  try {
    const oraiIngest = (
      await db.query<{ ingest_elevenlabs_call: string }>(
        "select public.ingest_elevenlabs_call($1::jsonb)",
        [
          JSON.stringify({
            provider_agent_id: elOraiOfficialAgent,
            provider_conversation_id: "conv_el_orai_999",
            channel: "web",
            duration_seconds: 68,
            started_at: new Date().toISOString(),
            ended_at: new Date().toISOString(),
            summary: "12 間診所合作查詢與留言跟進",
            transcript: [{ role: "user", message: "我們想了解企業方案" }],
            analysis: { ok: true },
          }),
        ],
      )
    ).rows[0].ingest_elevenlabs_call;
    assert.equal(oraiIngest, "synced");
  } finally {
    await db.exec("reset role");
  }

  // RLS verification: Salon A/B cannot see Orai messages; Orai customer_admin sees both migrated & new messages
  assert.equal(
    (await asUser(userA, `select id from public.messages where organization_id = '${orgOraiId}'`)).rows
      .length,
    0,
  );
  assert.equal(
    (await asUser(userB, "select id from public.messages")).rows.length,
    0,
  );
  assert.equal(
    (await asUser(userA, "select id from public.messages where inbox_scope = 'merchant'"))
      .rows.length,
    2,
  );
  assert.equal(
    (await asUser(oraiOfficialUser, "select id from public.messages where inbox_scope = 'merchant'"))
      .rows.length,
    2,
  );
  // Super Admin has zero direct RLS read access to tenant messages or historical admin inbox rows
  assert.equal(
    (await asUser(adminUser, "select id from public.messages")).rows.length,
    0,
  );

  // Guardrail still prevents content mutation on migrated historical messages
  await assert.rejects(
    runServiceRpc("message_inbox_command", {
      actor_id: adminUser,
      tenant_id: orgOraiId,
      operation: "add_note",
      payload: { id: oraiFirstPartyMsgId, note: "super admin blocked from tenant inbox" },
    }),
    /Not authorized/,
  );

  const oraiNotifs = (
    await asUser(
      oraiOfficialUser,
      "select kind, message_id, organization_id from public.notifications where read_at is null",
    )
  ).rows as { kind: string; message_id: string | null; organization_id: string | null }[];
  assert.equal(oraiNotifs.length, 2);
  assert.ok(oraiNotifs.every((n) => n.kind === "message" && n.organization_id === orgOraiId));
});

test("mid-call message links automatically when post-call conversation arrives and rejects cross-tenant linking", async () => {
  const midCallRes = await createMessageRoute(
    new Request(`${base}/api/tools/elevenlabs/create-message`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${agentBToken}`,
        "x-elevenlabs-agent-id": elAgentB,
        "x-elevenlabs-conversation-id": "conv_el_b_midcall",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        senderName: "何先生（虛構）",
        messageContent: "想投訴昨日電話等候太久。",
        category: "complaint",
      }),
    }),
  );
  assert.equal(midCallRes.status, 200);
  const midCallId = (await midCallRes.json()).messageId as string;

  const beforeLink = (
    await db.query<{ conversation_id: string | null }>(
      "select conversation_id from public.messages where id = $1",
      [midCallId],
    )
  ).rows[0];
  assert.equal(beforeLink.conversation_id, null);

  // Post-call webhook inserts conversation for Org B with same provider_conversation_id
  await db.exec("set role service_role");
  try {
    const ingestRes = (
      await db.query<{ ingest_elevenlabs_call: string }>(
        `select public.ingest_elevenlabs_call($1::jsonb)`,
        [
          JSON.stringify({
            provider_agent_id: elAgentB,
            provider_conversation_id: "conv_el_b_midcall",
            channel: "phone",
            duration_seconds: 42,
            started_at: new Date().toISOString(),
            ended_at: new Date().toISOString(),
            summary: "投訴電話等候時間過長並已留言跟進",
            transcript: [{ role: "user", message: "等咗好耐無人聽" }],
            analysis: { ok: true },
          }),
        ],
      )
    ).rows[0].ingest_elevenlabs_call;
    assert.equal(ingestRes, "synced");

    const linkedConvId = (
      await db.query<{ id: string }>(
        "select id from public.conversations where provider = 'elevenlabs' and provider_conversation_id = $1",
        ["conv_el_b_midcall"],
      )
    ).rows[0].id;

    // Already-linked message cannot have conversation_id reassigned
    await assert.rejects(
      db.query("update public.messages set conversation_id = $1 where id = $2", [
        linkedConvId,
        merchantMsgId,
      ]),
      /cannot be reassigned/i,
    );

    // Unlinked message cannot link to another organization's conversation (composite FK)
    const unlinkedId = (
      await db.query<{ id: string }>(
        `insert into public.messages(
          inbox_scope, organization_id, agent_id, provider, provider_agent_id,
          sender_name, message_content, message_summary, category, idempotency_key, payload_hash
        ) values (
          'merchant', $1, $2, 'elevenlabs', $3,
          'Test Cross Link', 'Checking tenant FK guard', 'Checking tenant FK guard',
          'general_message', 'unlinked-cross-test', repeat('a', 64)
        ) returning id`,
        [orgA, agentAId, elAgentA],
      )
    ).rows[0].id;
    await assert.rejects(
      db.query("update public.messages set conversation_id = $1 where id = $2", [
        linkedConvId,
        unlinkedId,
      ]),
      /foreign key/i,
    );
    await db.query("delete from public.messages where id = $1", [unlinkedId]);
  } finally {
    await db.exec("reset role");
  }

  const afterLink = (
    await db.query<{ conversation_id: string | null }>(
      "select conversation_id from public.messages where id = $1",
      [midCallId],
    )
  ).rows[0];
  assert.ok(afterLink.conversation_id);

  const linkEvents = (
    await db.query<{ kind: string }>(
      "select kind from public.message_events where message_id = $1 and kind = 'conversation_linked'",
      [midCallId],
    )
  ).rows;
  assert.equal(linkEvents.length, 1);
});

test("authenticated dashboard routes enforce RBAC, CSRF, status/note lifecycle, immutability, and notification reads", async () => {
  const cookieA = await loginAs("a@example.test", "customer");
  const cookieB = await loginAs("b@example.test", "customer");
  const cookieAdmin = await loginAs("admin@example.test", "super_admin");

  // Unauthenticated / cross-tenant / role escalation blocked
  const anonRes = await customerMessagesGet(new Request(`${base}/api/platform/customer/messages`));
  assert.equal(anonRes.status, 401);

  const customerCallsAdmin = await adminMessagesGet(
    new Request(`${base}/api/platform/admin/messages`, { headers: { cookie: cookieA } }),
  );
  assert.equal(customerCallsAdmin.status, 403);

  const crossTenantDetail = await customerMessagesGet(
    new Request(`${base}/api/platform/customer/messages?id=${merchantMsgId}`, {
      headers: { cookie: cookieB },
    }),
  );
  assert.equal(crossTenantDetail.status, 404);

  const csrfBlocked = await customerMessagesPatch(
    new Request(`${base}/api/platform/customer/messages`, {
      method: "PATCH",
      headers: {
        origin: "https://evil.example.test",
        cookie: cookieA,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: merchantMsgId,
        action: "update_status",
        status: "in_progress",
        expected_version: 1,
      }),
    }),
  );
  assert.equal(csrfBlocked.status, 403);

  // Tenant A lists & filters messages
  const listARes = await customerMessagesGet(
    new Request(`${base}/api/platform/customer/messages?status=pending`, {
      headers: { cookie: cookieA },
    }),
  );
  assert.equal(listARes.status, 200);
  const listABody = await listARes.json();
  assert.equal(listABody.counts.pending, 2);
  assert.equal(listABody.messages.length, 2);
  assert.ok(listABody.messages.every((m: { inbox_scope: string }) => m.inbox_scope === "merchant"));

  // Tenant A updates status pending -> in_progress -> completed & adds internal note
  const progressRes = await customerMessagesPatch(
    new Request(`${base}/api/platform/customer/messages`, {
      method: "PATCH",
      headers: { origin: base, cookie: cookieA, "Content-Type": "application/json" },
      body: JSON.stringify({
        id: merchantMsgId,
        action: "update_status",
        status: "in_progress",
        expected_version: 1,
      }),
    }),
  );
  assert.equal(progressRes.status, 200);
  assert.equal((await progressRes.json()).message.version, 2);

  // Stale expected_version rejects 409
  const staleRes = await customerMessagesPatch(
    new Request(`${base}/api/platform/customer/messages`, {
      method: "PATCH",
      headers: { origin: base, cookie: cookieA, "Content-Type": "application/json" },
      body: JSON.stringify({
        id: merchantMsgId,
        action: "update_status",
        status: "completed",
        expected_version: 1,
      }),
    }),
  );
  assert.equal(staleRes.status, 409);

  // Add private internal note
  const noteRes = await customerMessagesPatch(
    new Request(`${base}/api/platform/customer/messages`, {
      method: "PATCH",
      headers: { origin: base, cookie: cookieA, "Content-Type": "application/json" },
      body: JSON.stringify({
        id: merchantMsgId,
        action: "add_note",
        note: "已分配顧問 Mandy 明日聯絡（虛構內部備註）",
      }),
    }),
  );
  assert.equal(noteRes.status, 200);

  // Complete message
  const completeRes = await customerMessagesPatch(
    new Request(`${base}/api/platform/customer/messages`, {
      method: "PATCH",
      headers: { origin: base, cookie: cookieA, "Content-Type": "application/json" },
      body: JSON.stringify({
        id: merchantMsgId,
        action: "update_status",
        status: "completed",
        expected_version: 2,
      }),
    }),
  );
  assert.equal(completeRes.status, 200);

  // Detail includes immutable original content, linked conversation transcript, audit events, and internal note
  const detailARes = await customerMessagesGet(
    new Request(`${base}/api/platform/customer/messages?id=${merchantMsgId}`, {
      headers: { cookie: cookieA },
    }),
  );
  assert.equal(detailARes.status, 200);
  const detailABody = await detailARes.json();
  assert.equal(detailABody.message.status, "completed");
  assert.ok(detailABody.message.completed_at);
  assert.equal(detailABody.internal_notes.length, 1);
  assert.equal(detailABody.linked_conversation.id, "50000000-0000-4000-8000-000000000101");
  assert.equal(detailABody.linked_conversation.transcript.length, 2);
  assert.ok(detailABody.events.some((e: { kind: string }) => e.kind === "status_changed"));
  assert.ok(detailABody.events.some((e: { kind: string }) => e.kind === "note_added"));

  // Immutable original message_content cannot be mutated even by service_role
  await db.exec("set role service_role");
  try {
    await assert.rejects(
      db.query("update public.messages set message_content = 'tampered' where id = $1", [
        merchantMsgId,
      ]),
      /immutable/i,
    );
  } finally {
    await db.exec("reset role");
  }

  // Tenant B cannot mutate Tenant A's or Admin's message
  const tenantBMutateA = await customerMessagesPatch(
    new Request(`${base}/api/platform/customer/messages`, {
      method: "PATCH",
      headers: { origin: base, cookie: cookieB, "Content-Type": "application/json" },
      body: JSON.stringify({
        id: merchantMsgId,
        action: "add_note",
        note: "cross-tenant attack",
      }),
    }),
  );
  assert.equal(tenantBMutateA.status, 403);

  // Viewer cannot mutate messages
  await assert.rejects(
    runServiceRpc("message_inbox_command", {
      actor_id: viewerUser,
      tenant_id: orgA,
      operation: "add_note",
      payload: { id: merchantMsgId, note: "viewer note" },
    }),
    /Not authorized/,
  );

  // Retired admin message routes return 410 Gone for super_admin; Orai Service operates exclusively via /dashboard
  const cookieOrai = await loginAs("orai-official@example.test", "customer");
  const adminListRes = await adminMessagesGet(
    new Request(`${base}/api/platform/admin/messages`, { headers: { cookie: cookieAdmin } }),
  );
  assert.equal(adminListRes.status, 410);

  const adminPatchRetired = await adminMessagesPatch(
    new Request(`${base}/api/platform/admin/messages`, {
      method: "PATCH",
      headers: { origin: base, cookie: cookieAdmin, "Content-Type": "application/json" },
      body: JSON.stringify({
        id: oraiFirstPartyMsgId,
        action: "update_status",
        status: "in_progress",
        expected_version: 1,
      }),
    }),
  );
  assert.equal(adminPatchRetired.status, 410);

  // Orai first-party customer_admin sees both migrated historical message (with internal note) and new message via /dashboard API
  const oraiListRes = await customerMessagesGet(
    new Request(`${base}/api/platform/customer/messages`, { headers: { cookie: cookieOrai } }),
  );
  assert.equal(oraiListRes.status, 200);
  const oraiListBody = await oraiListRes.json();
  assert.equal(oraiListBody.messages.length, 2);

  const oraiProgress = await customerMessagesPatch(
    new Request(`${base}/api/platform/customer/messages`, {
      method: "PATCH",
      headers: { origin: base, cookie: cookieOrai, "Content-Type": "application/json" },
      body: JSON.stringify({
        id: oraiFirstPartyMsgId,
        action: "update_status",
        status: "in_progress",
        expected_version: 1,
      }),
    }),
  );
  assert.equal(oraiProgress.status, 200);

  const notifListRes = await notificationsGet(
    new Request(`${base}/api/platform/notifications`, { headers: { cookie: cookieOrai } }),
  );
  assert.equal(notifListRes.status, 200);
  const notifListBody = await notifListRes.json();
  assert.equal(notifListBody.unread, 2);

  const markReadRes = await notificationsPatch(
    new Request(`${base}/api/platform/notifications`, {
      method: "PATCH",
      headers: { origin: base, cookie: cookieOrai, "Content-Type": "application/json" },
      body: JSON.stringify({ id: notifListBody.notifications[0].id }),
    }),
  );
  assert.equal(markReadRes.status, 200);
});

test("multi-channel detection distinguishes web placeholders, WhatsApp IDs, and phone callers cleanly", async () => {
  const { detectElevenLabsChannel } = await import("../lib/platform/messages");

  // Uninterpolated ElevenLabs template placeholder on web must stay "web", never "phone"
  assert.equal(
    detectElevenLabsChannel({
      callerHeader: "{{system__caller_id}}",
      calledNumberHeader: "{{system__called_number}}",
    }).channel,
    "web",
  );

  // WhatsApp numeric Meta Phone Number ID in calledNumber classifies as "whatsapp" even without x-elevenlabs-channel
  assert.equal(
    detectElevenLabsChannel({
      callerHeader: "85291234567",
      calledNumberHeader: "1465505606651153",
      knownWhatsAppPhoneIds: ["1465505606651153"],
    }).channel,
    "whatsapp",
  );

  // whatsapp: prefix classifies as "whatsapp"
  assert.equal(
    detectElevenLabsChannel({
      callerHeader: "whatsapp:+85291234567",
    }).channel,
    "whatsapp",
  );

  // Standard telephone E.164 caller without WhatsApp indicators classifies as "phone"
  assert.equal(
    detectElevenLabsChannel({
      callerHeader: "+852 9123 4567",
      calledNumberHeader: "+852 3000 1234",
    }).channel,
    "phone",
  );
});

test("staged credential rotation keeps old token active until verified, then cleanly revokes old token", async () => {
  const rotatedToken = "orai_mkt_rot_fictional_rotation_999999";
  const thirdToken = "orai_mkt_rot_fictional_third_888888";

  const agentRows = (
    await db.query<{ id: string }>(
      "select id from public.agents where elevenlabs_agent_id = $1",
      [elOraiOfficialAgent],
    )
  ).rows;
  const oraiAgentUuid = agentRows[0].id;

  await db.exec("set role service_role");
  let stagedCredId = "";
  try {
    const stageRes = (
      await db.query<{ res: { id: string; secret_prefix: string } }>(
        "select public.stage_agent_tool_credential($1::uuid, $2::text, $3::text) as res",
        [oraiAgentUuid, sha256Hex(rotatedToken), "orai_mkt_rot"],
      )
    ).rows[0].res;
    stagedCredId = stageRes.id;
    assert.equal(stageRes.secret_prefix, "orai_mkt_rot");

    // Cap overlapping active keys strictly at 2
    await assert.rejects(
      db.query(
        "select public.stage_agent_tool_credential($1::uuid, $2::text, $3::text)",
        [oraiAgentUuid, sha256Hex(thirdToken), "orai_mkt_3rd"],
      ),
      /Maximum overlapping active credentials/,
    );
  } finally {
    await db.exec("reset role");
  }

  // Both old and newly staged tokens succeed cleanly during transition
  const oldStillWorks = await createMessageRoute(
    new Request(`${base}/api/tools/elevenlabs/create-message`, {
      method: "POST",
      headers: {
        "x-orai-tool-secret": oraiOfficialToken,
        "x-elevenlabs-agent-id": elOraiOfficialAgent,
        "x-idempotency-key": "rot-overlap-old-001",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        senderName: "輪換過渡測試（舊）",
        messageContent: "過渡期舊金鑰仍可接收。",
        category: "general_message",
      }),
    }),
  );
  assert.equal(oldStillWorks.status, 200);

  const newWorksNow = await createMessageRoute(
    new Request(`${base}/api/tools/elevenlabs/create-message`, {
      method: "POST",
      headers: {
        "x-orai-tool-secret": rotatedToken,
        "x-elevenlabs-agent-id": elOraiOfficialAgent,
        "x-idempotency-key": "rot-overlap-new-001",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        senderName: "輪換過渡測試（新）",
        messageContent: "新金鑰驗證成功。",
        category: "general_message",
      }),
    }),
  );
  assert.equal(newWorksNow.status, 200);

  // Revoke old credential only AFTER verifying the replacement succeeds
  await db.exec("set role service_role");
  try {
    const revokeRes = (
      await db.query<{ res: { ok: boolean; revoked_count: number; kept_credential_id: string } }>(
        "select public.revoke_agent_tool_credential($1::uuid, $2::uuid) as res",
        [oraiAgentUuid, stagedCredId],
      )
    ).rows[0].res;
    assert.equal(revokeRes.ok, true);
    assert.equal(revokeRes.revoked_count, 1);
    assert.equal(revokeRes.kept_credential_id, stagedCredId);
  } finally {
    await db.exec("reset role");
  }

  // Old token is now rejected 401 while rotated token keeps working 200
  const oldRejected = await createMessageRoute(
    new Request(`${base}/api/tools/elevenlabs/create-message`, {
      method: "POST",
      headers: {
        "x-orai-tool-secret": oraiOfficialToken,
        "x-elevenlabs-agent-id": elOraiOfficialAgent,
        "x-idempotency-key": "rot-after-old-001",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        senderName: "舊金鑰應失敗",
        messageContent: "不應寫入。",
        category: "general_message",
      }),
    }),
  );
  assert.equal(oldRejected.status, 401);

  const newStillWorks = await createMessageRoute(
    new Request(`${base}/api/tools/elevenlabs/create-message`, {
      method: "POST",
      headers: {
        "x-orai-tool-secret": rotatedToken,
        "x-elevenlabs-agent-id": elOraiOfficialAgent,
        "x-idempotency-key": "rot-after-new-001",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        senderName: "新金鑰持續正常",
        messageContent: "撤銷舊金鑰後仍成功。",
        category: "general_message",
      }),
    }),
  );
  assert.equal(newStillWorks.status, 200);
});
