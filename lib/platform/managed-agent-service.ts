import { createClient } from "@supabase/supabase-js";
import type { PlatformSession } from "./types";
import { emptyPreferences, parsePreferences, statusLabels, type ChangeRequest } from "./agent-preferences";
import { requestSupabase } from "./supabase-auth";

export class ManagedError extends Error { constructor(message: string, public status = 400) { super(message); } }
export function serviceDatabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new ManagedError("資料服務尚未設定，請聯絡 Orai。", 503);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function uuid(value: unknown): string { if (typeof value !== "string" || !uuidPattern.test(value)) throw new ManagedError("要求編號不正確。"); return value; }
function integer(value: unknown) { if (!Number.isSafeInteger(value) || (value as number) < 0) throw new ManagedError("版本不正確，請重新載入。"); return value as number; }
function text(value: unknown, required = false) { if (typeof value !== "string" || [...value].length > 2000 || (required && !value.trim())) throw new ManagedError("請填寫內容，最多 2,000 字。"); return value.trim(); }
function keys(body: Record<string, unknown>, allowed: string[]) { if (Object.keys(body).some(k => !allowed.includes(k))) throw new ManagedError("包含不允許修改的欄位。"); }
export async function readBody(request: Request) {
  if (Number(request.headers.get("content-length")) > 40000) throw new ManagedError("內容過長。", 413);
  const raw = await request.text(); if (raw.length > 40000) throw new ManagedError("內容過長。", 413);
  let body; try { body = JSON.parse(raw); } catch { throw new ManagedError("資料格式不正確。"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ManagedError("資料格式不正確。");
  return body as Record<string, unknown>;
}
function validatedPreferences(value: unknown) { try { return parsePreferences(value); } catch (error) { throw new ManagedError(error instanceof Error ? error.message : "偏好不正確。"); } }
export async function command(session: PlatformSession, operation: string, body: Record<string, unknown>) {
  const payload: Record<string, unknown> = {};
  if (operation === "submit") {
    keys(body, ["preferences", "additional_notes", "idempotency_key", "base_version"]);
    payload.preferences = validatedPreferences(body.preferences);
    payload.additional_notes = text(body.additional_notes ?? "");
    payload.idempotency_key = uuid(body.idempotency_key); payload.base_version = integer(body.base_version);
  } else if (operation === "mark_read") {
    keys(body, ["id", "all"]);
    if (body.all === true && body.id === undefined) payload.all = true;
    else if (body.all === undefined) payload.id = uuid(body.id);
    else throw new ManagedError("通知操作不正確。");
  } else {
    keys(body, ["id", "action", "message", "expected_version", "final_preferences", "manual_update_confirmed", "review_stale", "expected_active_version"]);
    payload.id = uuid(body.id); payload.expected_version = integer(body.expected_version);
    payload.message = text(body.message ?? "", ["needs_information", "reject", "provide_information", "add_note"].includes(operation));
    if (operation === "complete") {
      payload.final_preferences = validatedPreferences(body.final_preferences);
      payload.expected_active_version = integer(body.expected_active_version);
      if (body.manual_update_confirmed !== true) throw new ManagedError("請確認已人手更新及測試實際 AI 專員。");
      payload.manual_update_confirmed = true;
      payload.review_stale = body.review_stale === true;
    } else if (body.final_preferences !== undefined || body.manual_update_confirmed !== undefined || body.review_stale !== undefined || body.expected_active_version !== undefined) throw new ManagedError("此操作不能修改生效設定。");
  }
  const { data, error } = await serviceDatabase().rpc("managed_agent_command", { actor_id: session.userId, tenant_id: session.organizationId || null, operation, payload });
  if (error) {
    if (error.message?.includes("conflict:")) throw new ManagedError("資料已更新或相同要求仍在處理中，請重新載入後檢查。", 409);
    if (error.code === "42501") throw new ManagedError("你沒有權限執行此操作。", 403);
    if (["P0001", "23514", "22P02", "23502"].includes(error.code || "")) throw new ManagedError("操作未完成，請檢查內容、原因及要求狀態。");
    throw new ManagedError("未能儲存，請稍後重試。", 503);
  }
  return data;
}
export function managedFailure(error: unknown) { return Response.json({ error: error instanceof Error ? (error instanceof ManagedError ? error.message : "資料服務暫時無法使用。") : "操作失敗。" }, { status: error instanceof ManagedError ? error.status : 503 }); }
export async function activePreferences(request: Request, org: string) {
  const { data, error } = await requestSupabase(request).from("agent_preferences").select("settings,version,curated_voice_id").eq("organization_id", org).maybeSingle();
  if (error) throw new ManagedError("未能載入生效偏好，請稍後重試。", 503);
  return data ?? { settings: emptyPreferences, version: 0, curated_voice_id: null };
}
export async function listOrDetail(request: Request, session: PlatformSession, admin: boolean) {
  const db = requestSupabase(request), url = new URL(request.url), id = url.searchParams.get("id");
  if (id) {
    let query = db.from("agent_change_requests").select("*").eq("id", uuid(id));
    if (!admin) query = query.eq("organization_id", session.organizationId!);
    const { data: req, error } = await query.maybeSingle();
    if (error) throw new ManagedError("未能載入要求。", 503);
    if (!req) throw new ManagedError("要求不存在或沒有權限。", 404);
    const { data: events, error: eventError } = await db.from("agent_change_request_events").select("id,actor_id,kind,message,created_at").eq("request_id", req.id).order("created_at");
    if (eventError) throw new ManagedError("未能載入處理紀錄。", 503);
    if (!admin) return { request: req, events: events ?? [] };
    const [{ data: notes, error: notesError }, { data: merchant, error: orgError }, { data: agent, error: agentError }] = await Promise.all([
      db.from("agent_change_request_internal_notes").select("id,actor_id,kind,message,created_at").eq("request_id", req.id).order("created_at"),
      db.from("organizations").select("name,slug").eq("id", req.organization_id).single(),
      serviceDatabase().from("agents").select("config").eq("id", req.agent_id).eq("organization_id", req.organization_id).single(),
    ]);
    if (notesError || orgError || agentError) throw new ManagedError("未能載入管理資料。", 503);
    return { request: req, events: events ?? [], internal_notes: notes ?? [], merchant, active_preferences: await activePreferences(request, req.organization_id), legacy_instructions: typeof agent?.config?.customer_instructions === "string" ? agent.config.customer_instructions : "" };
  }
  const page = Math.max(1, Math.min(10000, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1)), pageSize = 20;
  let query = db.from("agent_change_requests").select(admin ? "*,organizations!inner(name,slug)" : "*", { count: "exact" });
  if (!admin) query = query.eq("organization_id", session.organizationId!);
  const status = url.searchParams.get("status");
  if (status) { if (!Object.hasOwn(statusLabels, status)) throw new ManagedError("狀態不正確。"); query = query.eq("status", status); }
  const search = url.searchParams.get("search")?.trim();
  if (search && admin) {
    if (search.length > 100) throw new ManagedError("搜尋內容過長。");
    query = query.ilike("organizations.name", `%${search.replace(/[\\%_]/g, "\\$&")}%`);
  }
  const { data, error, count } = await query.order("created_at", { ascending: url.searchParams.get("sort") === "asc" }).order("id").range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new ManagedError("未能載入調整要求。", 503);
  const rows = (data ?? []) as unknown as ChangeRequest[];
  const result: Record<string, unknown> = { requests: rows.map(r => ({ ...r, overdue: r.status === "pending" && Date.now() - new Date(r.created_at).getTime() > 86400000 })), total: count ?? 0, page, pageSize };
  if (admin) {
    const counts: Record<string, number> = {};
    for (const state of Object.keys(statusLabels)) {
      const { count, error } = await db.from("agent_change_requests").select("id", { count: "exact", head: true }).eq("status", state);
      if (error) throw new ManagedError("未能載入要求統計。", 503);
      counts[state] = count ?? 0;
    }
    result.counts = counts;
  }
  return result;
}
