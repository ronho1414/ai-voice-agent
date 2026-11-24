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
    "20261124103151_immutable_agent_ownership.sql",
    "20261124160158_managed_agent_requests.sql",
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



import { emptyPreferences, parsePreferences } from '../lib/platform/agent-preferences';
type Req={id:string;status:string;version:number;base_version:number;reference:string;requested_settings:Record<string,unknown>;changed_fields:string[]};
async function cmd(actor:string,operation:string,payload:Record<string,unknown>,tenant=orgA){
 await db.exec('set role service_role');
 try{return (await db.query<{result:Req}>(`select public.managed_agent_command($1,$2,$3,$4::jsonb) as result`,[actor,tenant,operation,JSON.stringify(payload)])).rows[0].result;}
 finally{await db.exec('reset role');}
}
async function current(){const {rows}=await db.query<{settings:typeof emptyPreferences;version:number}>('select settings,version from public.agent_preferences where organization_id=$1',[orgA]);return rows[0]??{settings:emptyPreferences,version:0};}
async function submit(extra:Record<string,unknown>={},notes=''){const p=await current();return cmd(userA,'submit',{preferences:{...p.settings,...extra},additional_notes:notes,base_version:p.version,idempotency_key:crypto.randomUUID()});}
const act=async(r:Req,action:string,extra:Record<string,unknown>={})=>cmd(admin,action,{id:r.id,expected_version:r.version,...(action==='complete'?{expected_active_version:(await current()).version}:{}),...extra});
let first:Req;
test('submission persists snapshots, leaves active unchanged, creates durable notifications and deduplicates',async()=>{
 const preferences={...emptyPreferences,voice_gender:'male'};
 const payload={preferences,additional_notes:'FICTIONAL: gentle greeting',base_version:0,idempotency_key:crypto.randomUUID()};
 first=await cmd(userA,'submit',payload);
 assert.equal(first.status,'pending');assert.match(first.reference,/REQ-/);assert.deepEqual(first.changed_fields,['voice_gender']);
 assert.deepEqual((await current()).settings,emptyPreferences);
 assert.equal((await cmd(userA,'submit',payload)).id,first.id);
 await assert.rejects(cmd(userA,'submit',{...payload,additional_notes:'changed'}),/conflict/);
 await assert.rejects(cmd(userA,'submit',{...payload,idempotency_key:crypto.randomUUID()}),/identical open/);
 assert.equal((await db.query('select id from public.agent_change_requests')).rows.length,1);
 assert.equal((await db.query('select id from public.notifications')).rows.length,3); // admin, A, own viewer
 const fresh=(await asUser(userA,'select id from public.agent_change_requests')).rows;
 assert.equal(fresh.length,1); // fresh authenticated DB transaction, persisted state
 assert.equal((await asUser(userB,'select id from public.agent_change_requests')).rows.length,0);
});
test('empty, unchanged, invalid enums and excessive text rejected at JS and SQL boundaries',async()=>{
 await assert.rejects(submit(),/No changes/);
 assert.throws(()=>parsePreferences({...emptyPreferences,speaking_speed:'warp'}));
 assert.throws(()=>parsePreferences({...emptyPreferences,greeting:'x'.repeat(301)}));
 await assert.rejects(submit({greeting:'x'.repeat(301)}),/Invalid preferences/);
 await assert.rejects(submit({voice_gender:'invalid'}),/Invalid preferences/);
 const malformed:Record<string,unknown>={...emptyPreferences,unexpected:'x'};delete malformed.greeting;
 await assert.rejects(cmd(userA,'submit',{preferences:malformed,base_version:0,idempotency_key:crypto.randomUUID()}),/Invalid preferences/);
 await assert.rejects(submit({},'x'.repeat(2001)),/Invalid preferences/);
});
test('viewer, foreign tenant and customers cannot process or mass-assign active preferences',async()=>{
 await assert.rejects(cmd(viewer,'submit',{preferences:emptyPreferences,base_version:0,idempotency_key:crypto.randomUUID()}),/Not authorized/);
 await assert.rejects(cmd(userB,'cancel',{id:first.id,expected_version:first.version},orgB),/unavailable/);
 await assert.rejects(cmd(userA,'complete',{id:first.id,expected_version:first.version,final_preferences:emptyPreferences,manual_update_confirmed:true}),/Admin required/);
 await assert.rejects(asUser(userA,"update public.agent_preferences set version=999"),/permission denied/);
 await assert.rejects(asUser(userA,"select config from public.agents"),/permission denied/);
 await assert.rejects(asUser(userA,"select elevenlabs_agent_id from public.agents"),/permission denied/);
 await assert.rejects(asUser(userA,`select public.managed_agent_command('${admin}',null,'start','{}')`),/permission denied/);
});
test('processing/additional information/customer response/rejection preserve active and internal confidentiality',async()=>{
 first=await act(first,'start');assert.equal(first.status,'in_progress');
 await act(first,'add_note',{message:'PRIVATE ADMIN ONLY'});
 assert.equal((await asUser(userA,'select * from public.agent_change_request_internal_notes')).rows.length,0);
 assert.equal((await asUser(admin,'select * from public.agent_change_request_internal_notes')).rows.length,1);
 const events=await asUser(userA,'select message from public.agent_change_request_events');assert.ok(!JSON.stringify(events.rows).includes('PRIVATE ADMIN ONLY'));
 await assert.rejects(act(first,'needs_information'),/missing customer-visible reason/);
 first=await act(first,'needs_information',{message:'請補充稱呼偏好'});assert.equal(first.status,'needs_information');
 await assert.rejects(cmd(userA,'cancel',{id:first.id,expected_version:first.version}),/Invalid cancellation/);
 first=await cmd(userA,'provide_information',{id:first.id,expected_version:first.version,message:'FICTIONAL: 沒有稱呼偏好'});assert.equal(first.status,'pending');
 await assert.rejects(act(first,'reject'),/missing customer-visible reason/);
 first=await act(first,'reject',{message:'已收到，這次未能採納'});assert.equal(first.status,'rejected');
 assert.equal((await current()).version,0);
 await assert.rejects(act(first,'start'),/Invalid status transition/);
});
test('completion requires manual test confirmation and atomically activates reviewed final settings',async()=>{
 let r=await submit({response_style:'professional'});r=await act(r,'start');
 await assert.rejects(act(r,'complete',{final_preferences:r.requested_settings}),/Manual provider/);
 assert.equal((await current()).version,0);
 const final={...r.requested_settings,greeting:'FICTIONAL: 歡迎查詢'};
 r=await act(r,'complete',{final_preferences:final,manual_update_confirmed:true,message:'已測試並生效'});
 assert.equal(r.status,'completed');assert.deepEqual((await current()).settings,final);assert.equal((await current()).version,1);
 const {rows}=await db.query<{completed_at:string;final_applied_settings:unknown}>('select completed_at,final_applied_settings from public.agent_change_requests where id=$1',[r.id]);assert.ok(rows[0].completed_at);assert.deepEqual(rows[0].final_applied_settings,final);
 await assert.rejects(act(r,'complete',{final_preferences:final,manual_update_confirmed:true}),/Invalid status transition/);
});
test('multiple open requests require stale snapshot review before replacing newer preferences',async()=>{
 let older=await submit({speaking_speed:'slow'}),newer=await submit({voice_character:'energetic'});
 older=await act(older,'start');newer=await act(newer,'start');
 await act(newer,'complete',{final_preferences:newer.requested_settings,manual_update_confirmed:true});
 const before=await current();
 await assert.rejects(act(older,'complete',{final_preferences:older.requested_settings,manual_update_confirmed:true,review_stale:true,expected_active_version:0}),/administrator review/);
 await assert.rejects(act(older,'complete',{final_preferences:older.requested_settings,manual_update_confirmed:true}),/stale snapshot/);
 assert.deepEqual(await current(),before);
 await act(older,'complete',{final_preferences:older.requested_settings,manual_update_confirmed:true,review_stale:true});
 assert.equal((await current()).version,before.version+1);
});
test('pending cancellation and optimistic request version prevent stale actions',async()=>{
 const r=await submit({speaking_speed:'fast'});
 const cancelled=await cmd(userA,'cancel',{id:r.id,expected_version:r.version});assert.equal(cancelled.status,'cancelled');
 await assert.rejects(act(r,'start'),/request changed/);
 assert.ok((await asUser(userA,`select id from public.agent_change_requests where status='cancelled'`)).rows.length);
});
test('notification reads persist per recipient and cannot mark another recipient notifications',async()=>{
 const a=(await asUser(userA,'select id from public.notifications')).rows as {id:string}[];
 assert.ok(a.length>0);
 await cmd(userB,'mark_read',{id:a[0].id},orgB);
 let unread=(await asUser(userA,`select read_at from public.notifications where id='${a[0].id}'`)).rows as {read_at:unknown}[];assert.equal(unread[0].read_at,null);
 await cmd(userA,'mark_read',{id:a[0].id});
 unread=(await asUser(userA,`select read_at from public.notifications where id='${a[0].id}'`)).rows as {read_at:unknown}[];assert.ok(unread[0].read_at);
 await cmd(userA,'mark_read',{all:true});assert.equal((await asUser(userA,'select id from public.notifications where read_at is null')).rows.length,0);
 assert.equal((await asUser(userB,'select id from public.notifications')).rows.length,0);
});

test('notification failure rolls back completion and active preference changes together',async()=>{
 let r=await submit({greeting:'FICTIONAL rollback test'});r=await act(r,'start');
 const before=await current();
 await db.exec(`create function public.reject_test_notification() returns trigger language plpgsql as $$begin raise exception 'Fictional notification failure'; end$$;
 create trigger fail_test_notification before insert on public.notifications for each row execute function public.reject_test_notification();`);
 try {await assert.rejects(act(r,'complete',{final_preferences:r.requested_settings,manual_update_confirmed:true}),/Fictional notification failure/);}
 finally {await db.exec('drop trigger fail_test_notification on public.notifications; drop function public.reject_test_notification();');}
 assert.deepEqual(await current(),before);
 const stored=(await db.query<{status:string;version:number}>('select status,version from public.agent_change_requests where id=$1',[r.id])).rows[0];
 assert.equal(stored.status,'in_progress');assert.equal(stored.version,r.version);
});
