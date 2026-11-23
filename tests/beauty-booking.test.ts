import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { POST as book } from "../app/api/public/beauty/appointments/route";
import { GET as readSession, POST as login } from "../app/api/platform/auth/session/route";
import { GET as list, PATCH as update } from "../app/api/platform/customer/appointments/route";
import { hongKongDate } from "../lib/beauty/catalog";
import { validateBeautyRequest } from "../lib/beauty/booking";
import { bookingFailureMessage } from "../lib/beauty/client-errors";

let db: PGlite;
let directory: string;
const originalFetch = globalThis.fetch;
const savedEnv = { ...process.env };
const base = "http://localhost:3010";
const userA = "10000000-0000-4000-8000-000000000001";
const userB = "10000000-0000-4000-8000-000000000002";
const orgA = "20000000-0000-4000-8000-000000000001";
const orgB = "20000000-0000-4000-8000-000000000002";
const sessionId = "30000000-0000-4000-8000-000000000001";
let tokenA = ""; let tokenB = "";
let receipt = "";
let schemaUnavailable = false;
const payload = { requestId: "40000000-0000-4000-8000-000000000001", name: "測試客人", phone: "00000000",
  serviceId: "hydrate", date: hongKongDate(new Date(Date.now() + 86400000)), window: "afternoon", notes: "虛構測試資料" };
// This fictional number is for isolated tests only; it must pass the HK format validator.
payload.phone = "91234567";

function req(method: string, body?: unknown, cookie = "", requestPath = "/api/public/beauty/appointments") {
  return new Request(base + requestPath, { method, headers: { origin: base, "Content-Type": "application/json", cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function makeToken(id: string) {
  return Buffer.from('{"alg":"HS256"}').toString("base64url") + "." +
    Buffer.from(JSON.stringify({ sub: id, exp: Math.floor(Date.now()/1000)+3600, session_id: sessionId })).toString("base64url") + ".test";
}
async function cookieFor(email = "a@example.test") {
  const res = await login(req("POST", { type: "customer", email, password: "fixture-password" }, "", "/api/platform/auth/session"));
  assert.equal(res.status, 200);
  return res.headers.getSetCookie().map((entry) => entry.split(";")[0]).join("; ");
}

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "orai-booking-test-"));
  db = new PGlite(directory);
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to authenticated,service_role;
    create schema auth;
    create table auth.users(id uuid primary key,banned_until timestamptz,is_anonymous boolean default false);
    create table auth.sessions(id uuid,user_id uuid,not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid(),auth.jwt() to authenticated;`);
  for (const migration of ["001_multi_tenant_foundation.sql", "002_rls_write_hardening.sql", "20261123105304_auth_tenant_isolation.sql", "20261123110214_beauty_appointment_requests.sql"]) {
    await db.exec((await readFile(new URL(`../supabase/migrations/${migration}`, import.meta.url), "utf8")).replace(/create extension if not exists pgcrypto;/i,""));
  }
  await db.exec(`insert into auth.users(id) values ('${userA}'),('${userB}');
    insert into auth.sessions(id,user_id) values ('${sessionId}','${userA}'),('${sessionId}','${userB}');
    insert into public.profiles(id,email) values ('${userA}','a@example.test'),('${userB}','b@example.test');
    insert into public.organizations(id,name,slug) values ('${orgA}','Orai Beauty','orai-beauty'),('${orgB}','Other Test Merchant','other-test');
    insert into public.organization_members(organization_id,profile_id) values ('${orgA}','${userA}'),('${orgB}','${userB}');`);
  process.env.NEXT_PUBLIC_SUPABASE_URL="https://supabase.example.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY="public-test";
  process.env.SUPABASE_SERVICE_ROLE_KEY="service-test";
  delete process.env.ORAI_BEAUTY_ORGANIZATION_SLUG;
  tokenA=makeToken(userA); tokenB=makeToken(userB);
  globalThis.fetch=async (input, options) => {
    const url=new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url);
    const headers=new Headers(options?.headers);
    const token=(headers.get("authorization")||"").replace(/^Bearer /,"");
    const id=token===tokenA?userA:token===tokenB?userB:null;
    const single=(rows: unknown[])=>Response.json(rows[0]||null);
    if(url.pathname==="/auth/v1/token"){
      const body=JSON.parse(String(options?.body)); const uid=body.email==="a@example.test"?userA:userB;
      if(body.password!=="fixture-password")return Response.json({message:"Invalid credentials"},{status:400});
      return Response.json({access_token:uid===userA?tokenA:tokenB,refresh_token:"fixture-refresh",expires_in:3600,token_type:"bearer",user:{id:uid,email:body.email,role:"authenticated",aud:"authenticated",created_at:new Date().toISOString()}});
    }
    if(url.pathname==="/auth/v1/user")return id?Response.json({id,email:id===userA?"a@example.test":"b@example.test",role:"authenticated"}):Response.json({message:"Invalid token"},{status:401});
    const org=url.searchParams.get("organization_id")?.replace(/^eq\./,"");
    const recordId=url.searchParams.get("id")?.replace(/^eq\./,"");
    if(id){
      await db.exec("begin");
      try{
        await db.exec(`set local role authenticated; set local request.jwt.claims='${JSON.stringify({sub:id,session_id:sessionId})}';`);
        if(url.pathname.endsWith("/rpc/current_session_is_active"))return Response.json((await db.query<{active:boolean}>("select public.current_session_is_active() active")).rows[0].active);
        if(url.pathname.endsWith("/profiles"))return single((await db.query("select id,email,full_name,system_role from public.profiles where id=$1",[id])).rows);
        if(url.pathname.endsWith("/organization_members"))return Response.json((await db.query(`select m.organization_id,json_build_object('id',o.id,'name',o.name,'slug',o.slug,'status',o.status) organizations from public.organization_members m join public.organizations o on o.id=m.organization_id where m.profile_id=$1 and m.is_active and m.role='customer_admin'`,[id])).rows);
      }finally{await db.exec("rollback");}
    }
    if(token!=="service-test")throw new Error("Unexpected anonymous database request");
    if(url.pathname.endsWith("/organizations"))return single((await db.query("select id,status from public.organizations where slug=$1 and status='active'",[url.searchParams.get("slug")?.replace(/^eq\./,"")])).rows);
    if(url.pathname.endsWith("/appointments")){
      if(options?.method==="POST"){
        if(schemaUnavailable)return Response.json({code:"PGRST204",message:"Missing schema column"},{status:400});
        const values=JSON.parse(String(options.body)); const columns=Object.keys(values);
        try { return single((await db.query(`insert into public.appointments(${columns.join(",")}) values(${columns.map((_,i)=>`$${i+1}`).join(",")}) returning id,status`,Object.values(values))).rows); }
        catch(error){return Response.json({code:(error as {code:string}).code,message:"Database insert rejected"},{status:409});}
      }
      if(options?.method==="PATCH"){
        const values=JSON.parse(String(options.body));
        return single((await db.query("update public.appointments set status=$1,updated_at=$2 where id=$3 and organization_id=$4 and status=$5 returning *",[values.status,values.updated_at,recordId,org,url.searchParams.get("status")?.replace(/^eq\./,"")])).rows);
      }
      if(recordId)return single((await db.query("select * from public.appointments where id=$1 and organization_id=$2",[recordId,org])).rows);
      const key=url.searchParams.get("request_key")?.replace(/^eq\./,"");
      if(key)return single((await db.query("select id,status,request_hash from public.appointments where organization_id=$1 and request_key=$2",[org,key])).rows);
      return Response.json((await db.query("select * from public.appointments where organization_id=$1 order by appointment_time",[org])).rows);
    }
    throw new Error("Unexpected test endpoint");
  };
});
after(async()=>{
  globalThis.fetch=originalFetch;
  for(const key of Object.keys(process.env))if(!(key in savedEnv))delete process.env[key];
  Object.assign(process.env,savedEnv);
  await db.close();
  const target=path.resolve(directory);
  assert.equal(path.dirname(target),path.resolve(tmpdir()));
  assert.ok(path.basename(target).startsWith("orai-booking-test-"));
  await rm(target,{recursive:true,force:true});
});

test("validation rejects missing fields, invalid dates, long notes and tenant spoofing",async()=>{
  for(const value of [{},{...payload,name:""},{...payload,phone:"123"},{...payload,date:"2026-02-30"},{...payload,window:"__proto__"},{...payload,notes:"x".repeat(1001)},{...payload,organization_id:orgB}])assert.equal((await book(req("POST",value))).status,400);
  assert.equal((await db.query<{count:number}>("select count(*)::int count from public.appointments")).rows[0].count,0);
  assert.equal(validateBeautyRequest({...payload,phone:"85212345"}).normalized.phone,"+85285212345");
});

test("network failure has actionable Chinese text without pretending the booking succeeded",()=>{
  const message=bookingFailureMessage(new TypeError("Failed to fetch"));
  assert.match(message,/網絡連線中斷/);
  assert.match(message,/無法確認預約是否送達/);
  assert.doesNotMatch(message,/Failed to fetch/);
  assert.equal(bookingFailureMessage(new Error("預約服務尚在設定中")),"預約服務尚在設定中");
});

test("public submission persists to Postgres and returns a pending receipt without personal details",async()=>{
  const response=await book(req("POST",payload)); assert.equal(response.status,201);
  const body=await response.json(); receipt=body.id;assert.equal(body.status,"pending");assert.equal(body.customer_phone,undefined);
  const {rows}=await db.query("select organization_id,customer_name,preferred_time_window,source from public.appointments where id=$1",[receipt]);
  assert.deepEqual(rows,[{organization_id:orgA,customer_name:"測試客人",preferred_time_window:"afternoon",source:"beauty_website"}]);
});

test("missing configuration, merchant or migration returns a setup error rather than success",async()=>{
  const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  let response=await book(req("POST",payload));
  assert.equal(response.status,503);assert.equal((await response.json()).code,"BOOKING_SETUP_REQUIRED");
  process.env.SUPABASE_SERVICE_ROLE_KEY=serviceKey;
  process.env.ORAI_BEAUTY_ORGANIZATION_SLUG="missing-merchant";
  response=await book(req("POST",payload));
  assert.equal(response.status,503);assert.equal((await response.json()).code,"BOOKING_MERCHANT_UNAVAILABLE");
  delete process.env.ORAI_BEAUTY_ORGANIZATION_SLUG;
  schemaUnavailable=true;
  response=await book(req("POST",payload));
  schemaUnavailable=false;
  assert.equal(response.status,503);assert.equal((await response.json()).code,"BOOKING_SETUP_REQUIRED");
});

test("same idempotency key does not create a duplicate and changed payload is rejected",async()=>{
  const duplicate=await book(req("POST",payload));assert.equal(duplicate.status,200);assert.equal((await duplicate.json()).id,receipt);
  assert.equal((await book(req("POST",{...payload,name:"Different Test"}))).status,409);
  assert.equal((await db.query<{count:number}>("select count(*)::int count from public.appointments")).rows[0].count,1);
});

test("merchant A sees request after login; merchant B cannot read or change it",async()=>{
  const a=await cookieFor();const b=await cookieFor("b@example.test");
  assert.equal((await (await list(req("GET",undefined,a))).json()).appointments[0].id,receipt);
  assert.deepEqual((await (await list(req("GET",undefined,b))).json()).appointments,[]);
  assert.equal((await update(req("PATCH",{appointmentId:receipt,status:"confirmed"},b))).status,400);
  const row=(await db.query<{status:string}>("select status from public.appointments where id=$1",[receipt])).rows[0];assert.equal(row.status,"pending");
});

test("confirm then complete persists across database restart and fresh login",async()=>{
  const a=await cookieFor();assert.equal((await update(req("PATCH",{appointmentId:receipt,status:"confirmed"},a))).status,200);
  await db.close();db=new PGlite(directory);
  const newCookie=await cookieFor();assert.equal((await (await readSession(req("GET",undefined,newCookie))).json()).authenticated,true);
  assert.equal((await (await list(req("GET",undefined,newCookie))).json()).appointments[0].status,"confirmed");
  assert.equal((await update(req("PATCH",{appointmentId:receipt,status:"completed"},newCookie))).status,200);
  assert.equal((await update(req("PATCH",{appointmentId:receipt,status:"pending"},newCookie))).status,400);
  await assert.rejects(db.query("update public.appointments set status='pending' where id=$1",[receipt]),/Invalid appointment status transition/);
});

test("pending request can be rejected; invalid status cannot be persisted",async()=>{
  const second=await book(req("POST",{...payload,requestId:crypto.randomUUID()}));const id=(await second.json()).id;
  const a=await cookieFor();assert.equal((await update(req("PATCH",{appointmentId:id,status:"rejected"},a))).status,200);
  assert.equal((await update(req("PATCH",{appointmentId:id,status:"super_admin"},a))).status,400);
  assert.equal((await db.query<{status:string}>("select status from public.appointments where id=$1",[id])).rows[0].status,"rejected");
});
