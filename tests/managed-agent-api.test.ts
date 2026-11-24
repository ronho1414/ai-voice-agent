import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../app/api/platform/auth/session/route";

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
let rpcPayload: Record<string,unknown> | null = null;
let rpcError: Record<string,string> | null = null;
let rpcResult = {id:"persisted-request",reference:"REQ-000001",status:"pending",submission_replayed:false};
let roleOverride: string | undefined;
const authRateLimited = false;
const authUnavailable = false;
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
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(options?.headers);
    const token = (headers.get("authorization") || "").replace(/^Bearer /, "");
    const email = tokens.get(token);
    if (url.pathname === "/auth/v1/token") {
      if (authRateLimited) return Response.json({ message: "Too many attempts" }, { status: 429 });
      if (authUnavailable) return Response.json({ message: "Unavailable" }, { status: 503 });
      const body = JSON.parse(String(options?.body));
      if (url.searchParams.get("grant_type") === "refresh_token") {
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
    if(url.pathname.endsWith('/rpc/managed_agent_command')) {
      assert.equal(token,'service-test-key'); rpcPayload=JSON.parse(String(options?.body));
      return rpcError ? Response.json(rpcError,{status:400}) : Response.json(rpcResult);
    }
    if(url.pathname.endsWith('/agents')) return Response.json([{name:'Fictional Agent',status:'draft',language_mode:'trilingual',config:{customer_instructions:'PRIVATE PROMPT',secret:'PRIVATE CREDENTIAL'}}]);
    if(url.pathname.endsWith('/agent_preferences')) return Response.json(null);
    if(url.pathname.endsWith('/agent_change_requests')) return Response.json(null);
    throw new Error('Unexpected test endpoint: '+url.pathname);
  };
});
after(() => {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});


import { GET as agentInfo } from '../app/api/platform/customer/agent/route';
import { POST as submitRequest, PATCH as changeRequest, GET as getRequests } from '../app/api/platform/customer/change-requests/route';
import { PATCH as adminRequest } from '../app/api/platform/admin/change-requests/route';
import { emptyPreferences } from '../lib/platform/agent-preferences';
import { submissionFeedback, type RequestStatus } from '../lib/platform/agent-preferences';
const reqId='40000000-0000-4000-8000-000000000001';
const payload=()=>({preferences:{...emptyPreferences,voice_gender:'male'},base_version:0,idempotency_key:crypto.randomUUID()});
const customerPath='/api/platform/customer/change-requests';
test('requests require real session and same-origin mutations',async()=>{
 assert.equal((await submitRequest(request(customerPath,'POST',payload()))).status,401);
 const cookie=cookieJar(await login('a@example.test'));
 assert.equal((await submitRequest(request(customerPath,'POST',payload(),cookie,'https://evil.example'))).status,403);
});
test('authenticated identity owns tenant and privileged payload fields are rejected',async()=>{
 const cookie=cookieJar(await login('a@example.test'));
 const result=await submitRequest(request(customerPath,'POST',payload(),cookie));assert.equal(result.status,201);
 assert.equal(rpcPayload?.actor_id,'user-a');assert.equal(rpcPayload?.tenant_id,'tenant-a');
 for(const extra of [{organization_id:'tenant-b'},{status:'completed'},{submitted_by:'user-admin'},{internal_notes:'hidden'}])
  assert.equal((await submitRequest(request(customerPath,'POST',{...payload(),...extra},cookie))).status,400);
 assert.equal((await changeRequest(request(customerPath,'PATCH',{id:reqId,expected_version:1,action:'complete'},cookie))).status,403);
 assert.equal((await adminRequest(request('/api/platform/admin/change-requests','PATCH',{id:reqId,expected_version:1,action:'start'},cookie))).status,403);
 assert.equal((await getRequests(request(customerPath+'?id='+reqId,'GET',undefined,cookie))).status,404);
});
test('invalid enum/text/JSON are validation failures and DB errors never show false success',async()=>{
 const cookie=cookieJar(await login('a@example.test'));
 for(const preferences of [{...emptyPreferences,voice_gender:'toString'},{...emptyPreferences,greeting:'x'.repeat(301)}])
  assert.equal((await submitRequest(request(customerPath,'POST',{...payload(),preferences},cookie))).status,400);
 assert.equal((await submitRequest(new Request(base+customerPath,{method:'POST',headers:{origin:base,cookie},body:'{'}))).status,400);
 for(const [error,status] of [[{code:'08006',message:'private database connection error'},503],[{code:'P0001',message:'conflict: duplicate'},409],[{code:'42501',message:'private authorization data'},403]] as const){
  rpcError=error;const response=await submitRequest(request(customerPath,'POST',payload(),cookie));assert.equal(response.status,status);assert.ok(!(await response.text()).includes('private'));
 }rpcError=null;
});
test('customer agent DTO never reveals prompt/provider config or unverified healthy status',async()=>{
 const cookie=cookieJar(await login('a@example.test'));
 const response=await agentInfo(request('/api/platform/customer/agent','GET',undefined,cookie));assert.equal(response.status,200);
 const body=await response.json();assert.equal(body.agent.status_label,'服務狀態待 Orai 確認');assert.equal(body.agent.availability_24_7,null);
 assert.equal(body.preferences.version,0);assert.ok(!JSON.stringify(body).includes('PRIVATE'));assert.equal(body.agent.elevenlabs_agent_id,undefined);
 assert.match(response.headers.get('cache-control')!,/no-store/);
});
test('admin completion requires explicit manual test confirmation and reviewed active version',async()=>{
 const cookie=cookieJar(await login('admin@example.test','super_admin'));
 const path='/api/platform/admin/change-requests';
 const body={id:reqId,action:'complete',expected_version:2,final_preferences:emptyPreferences};
 assert.equal((await adminRequest(request(path,'PATCH',body,cookie))).status,400);
 assert.equal((await adminRequest(request(path,'PATCH',{...body,manual_update_confirmed:true},cookie))).status,400);
 assert.equal((await adminRequest(request(path,'PATCH',{...body,manual_update_confirmed:true,expected_active_version:0},cookie))).status,200);
 assert.equal(rpcPayload?.actor_id,'user-admin');assert.equal(rpcPayload?.tenant_id,null);
});

test('replayed submissions use HTTP200 and actual persisted status; terminal feedback never claims a new pending request',async()=>{
 const cookie=cookieJar(await login('a@example.test'));
 try{
  for(const status of ['pending','in_progress','needs_information','cancelled','rejected','completed'] as RequestStatus[]){
   rpcResult={...rpcResult,status,submission_replayed:true};
   const response=await submitRequest(request(customerPath,'POST',payload(),cookie));assert.equal(response.status,200);
   const body=await response.json();assert.equal(body.replayed,true);assert.equal(body.request.status,status);assert.equal(body.request.submission_replayed,undefined);
   const feedback=submissionFeedback(body.request,body.replayed);
   const terminal=['cancelled','rejected','completed'].includes(status);
   assert.equal(feedback.terminal,terminal);assert.ok(!feedback.message.includes('已提交，Orai 專人將會審核'));
   if(terminal)assert.match(feedback.message,/沒有建立新要求/);
  }
 }finally{rpcResult={...rpcResult,status:'pending',submission_replayed:false};}
 const response=await submitRequest(request(customerPath,'POST',payload(),cookie));assert.equal(response.status,201);
 const body=await response.json();assert.equal(body.replayed,false);assert.equal(submissionFeedback(body.request,false).terminal,false);
 assert.throws(()=>submissionFeedback({status:'invalid' as RequestStatus,reference:'REQ-1'},true));
});
