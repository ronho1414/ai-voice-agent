import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const userA = "10000000-0000-4000-8000-000000000001";
const userB = "10000000-0000-4000-8000-000000000002";
const admin = "10000000-0000-4000-8000-000000000003";
const viewer = "10000000-0000-4000-8000-000000000004";
const unprovisioned = "10000000-0000-4000-8000-000000000005";
const orgA = "20000000-0000-4000-8000-000000000001";
const orgB = "20000000-0000-4000-8000-000000000002";
const sessionId = "30000000-0000-4000-8000-000000000001";

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
  ]) {
    const sql = await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");
    // PGlite has gen_random_uuid built in; the pgcrypto extension is not needed.
    await db.exec(sql.replace(/create extension if not exists pgcrypto;/i, ""));
  }
  await db.exec(`
    insert into auth.users(id) values ('${userA}'),('${userB}'),('${admin}'),('${viewer}'),('${unprovisioned}');
    insert into auth.sessions(id,user_id) select '${sessionId}',id from auth.users;
    insert into public.profiles(id,email,system_role) values
      ('${userA}','a@example.test','user'),('${userB}','b@example.test','user'),
      ('${admin}','admin@example.test','super_admin'),('${viewer}','viewer@example.test','user');
    insert into public.organizations(id,name,slug) values ('${orgA}','A','tenant-a'),('${orgB}','B','tenant-b');
    insert into public.organization_members(organization_id,profile_id,role) values
      ('${orgA}','${userA}','customer_admin'),('${orgB}','${userB}','customer_admin'),('${orgA}','${viewer}','viewer');
    insert into public.agents(organization_id) values ('${orgA}'),('${orgB}');
    insert into public.knowledge_sources(organization_id,title,content) values ('${orgA}','A','A'),('${orgB}','B','B');
    insert into public.conversations(organization_id,session_id) values ('${orgA}','a'),('${orgB}','b');
    insert into public.appointments(organization_id,customer_name,customer_phone,appointment_time)
      values ('${orgA}','A','123',now()),('${orgB}','B','456',now());
    insert into public.usage_records(organization_id,billing_period) values ('${orgA}','2026-11'),('${orgB}','2026-11');
  `);
});
after(async () => { await db.close(); });

async function asUser(user: string, sql: string, role = "authenticated") {
  await db.exec("begin");
  try {
    await db.exec(`set local role ${role}; set local request.jwt.claims = '${JSON.stringify({ sub: user, session_id: sessionId, role })}';`);
    return await db.query(sql);
  } finally { await db.exec("rollback"); }
}

test("tenant A and B can only read their own organization and tenant rows", async () => {
  for (const [user, org] of [[userA, orgA], [userB, orgB]]) {
    assert.deepEqual((await asUser(user, "select id from public.organizations")).rows, [{ id: org }]);
    for (const table of ["agents", "knowledge_sources", "conversations", "appointments", "usage_records"]) {
      assert.deepEqual((await asUser(user, `select organization_id from public.${table}`)).rows, [{ organization_id: org }]);
    }
  }
});

test("customer cannot promote self, insert privileged profile, delete profile, or edit memberships", async () => {
  for (const sql of [
    `update public.profiles set system_role='super_admin' where id='${userA}'`,
    `insert into public.profiles(id,email,system_role) values ('${unprovisioned}','new@example.test','super_admin')`,
    `delete from public.profiles where id='${userA}'`,
    `update public.organization_members set role='customer_admin' where profile_id='${userA}'`,
    `update public.organizations set status='active' where id='${orgA}'`,
    `update public.knowledge_sources set organization_id='${orgB}' where organization_id='${orgA}'`,
  ]) await assert.rejects(asUser(userA, sql), /permission denied/);
  await assert.rejects(asUser(unprovisioned,
    `insert into public.profiles(id,email,system_role) values ('${unprovisioned}','new@example.test','super_admin')`), /permission denied/);
});

test("safe own-profile and merchant fields remain editable", async () => {
  assert.equal((await asUser(userA, `update public.profiles set full_name='Updated' where id='${userA}' returning full_name`)).rows.length, 1);
  assert.equal((await asUser(userA, `update public.organizations set phone='123' where id='${orgA}' returning id`)).rows.length, 1);
});

test("foreign tenant writes return no rows or reject ownership", async () => {
  assert.equal((await asUser(userA, `update public.knowledge_sources set content='attack' where organization_id='${orgB}' returning id`)).rows.length, 0);
  assert.equal((await asUser(userA, `delete from public.knowledge_sources where organization_id='${orgB}' returning id`)).rows.length, 0);
  assert.equal((await asUser(userA, `update public.appointments set status='confirmed' where organization_id='${orgB}' returning id`)).rows.length, 0);
  assert.equal((await asUser(userA, `delete from public.appointments where organization_id='${orgB}' returning id`)).rows.length, 0);
  await assert.rejects(asUser(userA, `update public.conversations set session_id='attack' where organization_id='${orgB}'`), /permission denied/);
  await assert.rejects(asUser(userA, `delete from public.conversations where organization_id='${orgB}'`), /permission denied/);
  await assert.rejects(asUser(userA, `update public.usage_records set call_minutes=9999 where organization_id='${orgB}'`), /permission denied/);
  await assert.rejects(asUser(userA, `delete from public.usage_records where organization_id='${orgB}'`), /permission denied/);
  await assert.rejects(asUser(userA, `insert into public.knowledge_sources(organization_id,title) values ('${orgB}','attack')`), /row-level security/);
  assert.equal((await asUser(userA, `insert into public.knowledge_sources(organization_id,title) values ('${orgA}','Allowed') returning id`)).rows.length, 1);
});

test("viewers read own tenant but cannot write", async () => {
  assert.equal((await asUser(viewer, "select id from public.knowledge_sources")).rows.length, 1);
  assert.equal((await asUser(viewer, `update public.knowledge_sources set content='attack' returning id`)).rows.length, 0);
  assert.equal((await asUser(viewer, `update public.appointments set status='confirmed' returning id`)).rows.length, 0);
});

test("anonymous users cannot read tenant data or call identity helpers", async () => {
  await assert.rejects(asUser(userA, "select * from public.organizations", "anon"), /permission denied/);
  await assert.rejects(asUser(userA, "select public.current_session_is_active()", "anon"), /permission denied/);
});

test("internal admin reads all tenants but cannot self-assign roles through Data API", async () => {
  assert.equal((await asUser(admin, "select id from public.organizations")).rows.length, 2);
  await assert.rejects(asUser(admin, `update public.profiles set system_role='super_admin' where id='${userA}'`), /permission denied/);
});

test("inactive membership and inactive/suspended organization revoke tenant access immediately", async () => {
  await db.exec(`update public.organization_members set is_active=false where profile_id='${userA}'`);
  assert.equal((await asUser(userA, "select id from public.knowledge_sources")).rows.length, 0);
  await db.exec(`update public.organization_members set is_active=true where profile_id='${userA}'`);
  for (const status of ["inactive", "suspended"]) {
    await db.exec(`update public.organizations set status='${status}' where id='${orgA}'`);
    assert.equal((await asUser(userA, "select id from public.knowledge_sources")).rows.length, 0);
  }
  await db.exec(`update public.organizations set status='active' where id='${orgA}'`);
});

test("revoked, expired, banned or anonymous Auth sessions cannot access data", async () => {
  await db.exec(`update auth.sessions set not_after=now()-interval '1 minute' where user_id='${userA}'`);
  assert.deepEqual((await asUser(userA, "select public.current_session_is_active() as active")).rows, [{ active: false }]);
  await db.exec(`update auth.sessions set not_after=null where user_id='${userA}'; update auth.users set banned_until=now()+interval '1 day' where id='${userA}'`);
  assert.equal((await asUser(userA, "select id from public.organizations")).rows.length, 0);
  await db.exec(`update auth.users set banned_until=null,is_anonymous=true where id='${userA}'`);
  assert.equal((await asUser(userA, "select id from public.organizations")).rows.length, 0);
  await db.exec(`update auth.users set is_anonymous=false where id='${userA}'; delete from auth.sessions where user_id='${userA}'`);
  assert.equal((await asUser(userA, "select id from public.organizations")).rows.length, 0);
});

test("same-tenant foreign keys prevent cross-tenant appointment links even for service role", async () => {
  const { rows } = await db.query<{ id: string }>(`select id from public.conversations where organization_id='${orgB}'`);
  await assert.rejects(db.query(`update public.appointments set conversation_id=$1 where organization_id=$2`, [rows[0].id, orgA]), /appointments_conversation_tenant_fk/);
});

test('webhook ingestion maps tenants, deduplicates and keeps RLS', async () => {
  await db.exec(`insert into auth.sessions(id,user_id) values ('${sessionId}','${userA}')`);
  await db.exec(`insert into public.agents(organization_id,elevenlabs_agent_id) values ('${orgA}','agent_test_a'),('${orgB}','agent_test_b')`);
  const call = {provider_agent_id:'agent_test_a',provider_conversation_id:'conv_test',channel:'web',duration_seconds:30,started_at:'2026-11-24T00:00:00Z',ended_at:'2026-11-24T00:00:30Z',transcript:[{role:'user',message:'fictional'}],summary:'test',analysis:{},organization_id:orgB};
  const ingest = (payload:unknown) => db.query<{result:string}>('select public.ingest_elevenlabs_call($1::jsonb) as result',[JSON.stringify(payload)]);
  await db.exec('set role service_role');
  assert.equal((await ingest({...call,provider_agent_id:'unknown'})).rows[0].result,'unknown_agent');
  await Promise.all([ingest(call),ingest(call)]);
  await db.exec('reset role');
  assert.equal((await asUser(userA,"select id from public.conversations where provider_conversation_id='conv_test'")).rows.length,1);
  await assert.rejects(asUser(userB,"update public.conversations set summary='forged' where provider_conversation_id='conv_test' returning id"), /permission denied/);
  assert.equal((await db.query("select id from public.conversations where provider_conversation_id='conv_test'")).rows.length,1);
  assert.equal((await asUser(userB,"select id from public.conversations where provider_conversation_id='conv_test'")).rows.length,0);
  assert.equal((await ingest({...call,provider_agent_id:'agent_test_b'})).rows[0].result,'ownership_conflict');
  assert.equal((await db.query<{organization_id:string}>("select organization_id from public.conversations where provider_conversation_id='conv_test'")).rows[0].organization_id,orgA);
  await assert.rejects(asUser(userB,`select public.ingest_elevenlabs_call('${JSON.stringify(call)}'::jsonb)`),/permission denied/);
  await assert.rejects(db.exec(`insert into public.agents(organization_id,elevenlabs_agent_id) values ('${orgB}','agent_test_a')`),/unique/);
});

test('organization and agent provisioning rolls back all partial writes on failures', async () => {
  const orgId='20000000-0000-4000-8000-000000000099';
  const org={id:orgId,name:'Fictional new salon',slug:'new-salon',industry:'beauty_salon',status:'active',opening_hours:{},created_at:'2026-11-24T00:00:00Z',updated_at:'2026-11-24T00:00:00Z'};
  const agent={id:'40000000-0000-4000-8000-000000000099',organization_id:orgId,elevenlabs_agent_id:'agent_test_a',name:'Test',voice_name:'Test',language_mode:'trilingual',status:'active',config:{},created_at:org.created_at,updated_at:org.updated_at};
  const provision=(o:unknown,a:unknown)=>db.query('select public.create_organization_with_agent($1::jsonb,$2::jsonb)',[JSON.stringify(o),JSON.stringify(a)]);
  await db.exec('set role service_role');
  try {
    await assert.rejects(provision(org,agent),/unique/);
    assert.equal((await db.query('select id from public.organizations where id=$1',[orgId])).rows.length,0);
    await assert.rejects(provision(org,{...agent,elevenlabs_agent_id:'unique_new',language_mode:'invalid'}),/check constraint/);
    assert.equal((await db.query('select id from public.organizations where id=$1',[orgId])).rows.length,0);
    await provision(org,{...agent,elevenlabs_agent_id:'unique_new'});
    await assert.rejects(provision({...org,id:'20000000-0000-4000-8000-000000000098'},{...agent,id:'40000000-0000-4000-8000-000000000098',organization_id:'20000000-0000-4000-8000-000000000098',elevenlabs_agent_id:'another_new'}),/unique/);
    assert.equal((await db.query("select id from public.agents where elevenlabs_agent_id='another_new'")).rows.length,0);
  } finally { await db.exec('reset role'); }
  for(const role of ['anon','authenticated']) {
    await assert.rejects(asUser(userA,`select public.create_organization_with_agent('${JSON.stringify(org)}','${JSON.stringify(agent)}')`,role),/permission denied/);
    await assert.rejects(asUser(userA,`select public.ingest_elevenlabs_call('{}')`,role),/permission denied/);
  }
});
