import { getPlatformSession } from "@/lib/platform/auth";
import { requestSupabase, withPlatformRequest } from "@/lib/platform/supabase-auth";
import { command, managedFailure, ManagedError, readBody } from "@/lib/platform/managed-agent-service";
export const GET = withPlatformRequest(async request => {
  const session = await getPlatformSession(request); if (!session) return Response.json({ error: "請先登入。" }, { status: 401 });
  try {
    const db = requestSupabase(request);
    const [{ data, error }, { count, error: countError }] = await Promise.all([
      db.from("notifications").select("id,request_id,title,read_at,created_at").eq("recipient_id", session.userId).order("created_at", { ascending: false }).limit(50),
      db.from("notifications").select("id", { count: "exact", head: true }).eq("recipient_id", session.userId).is("read_at", null),
    ]);
    if (error || countError) throw new ManagedError("未能載入通知。", 503);
    return Response.json({ notifications: data ?? [], unread: count ?? 0 });
  } catch (e) { return managedFailure(e); }
});
export const PATCH = withPlatformRequest(async request => {
  const session = await getPlatformSession(request); if (!session) return Response.json({ error: "請先登入。" }, { status: 401 });
  try { return Response.json(await command(session, "mark_read", await readBody(request))); } catch (e) { return managedFailure(e); }
});
