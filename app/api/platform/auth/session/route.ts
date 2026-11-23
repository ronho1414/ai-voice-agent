import { getPlatformSession } from "@/lib/platform/auth";
import { authConfigured, requestSupabase, withPlatformRequest } from "@/lib/platform/supabase-auth";

export const GET = withPlatformRequest(async (request) => {
  const session = await getPlatformSession(request);
  return Response.json({ authenticated: Boolean(session), session });
});

export const POST = withPlatformRequest(async (request) => {
  let body;
  try { body = await request.json(); } catch {
    return Response.json({ error: "登入資料格式不正確" }, { status: 400 });
  }
  if (!body || !["super_admin", "customer"].includes(body.type) ||
      typeof body.email !== "string" || !body.email.trim() || body.email.length > 254 ||
      typeof body.password !== "string" || !body.password || body.password.length > 1024) {
    return Response.json({ error: "請輸入登入電郵及密碼" }, { status: 400 });
  }
  if (!authConfigured()) return Response.json({ error: "尚未設定 Supabase Auth" }, { status: 503 });
  const supabase = requestSupabase(request);
  const { data, error } = await supabase.auth.signInWithPassword({ email: body.email.trim(), password: body.password });
  if (error?.status === 429) return Response.json({ error: "登入嘗試太頻密，請稍後再試。" }, { status: 429 });
  if (error && (!error.status || error.status >= 500 || error.name === "AuthRetryableFetchError")) {
    return Response.json({ error: "暫時無法連線登入服務，請稍後再試。", code: "AUTH_SERVICE_UNAVAILABLE" }, { status: 503 });
  }
  if (error || !data.user) return Response.json({ error: "登入電郵或密碼不正確" }, { status: 401 });
  const session = await getPlatformSession(request);
  const expectedRole = body.type === "super_admin" ? "super_admin" : "customer_admin";
  if (!session || session.role !== expectedRole) {
    await supabase.auth.signOut({ scope: "local" });
    return Response.json({ error: "此帳戶未有啟用的後台權限" }, { status: 403 });
  }
  return Response.json({ success: true, session });
});

export const DELETE = withPlatformRequest(async (request) => {
  if (authConfigured()) {
    const { error } = await requestSupabase(request).auth.signOut({ scope: "local" });
    if (error) return Response.json({ error: "登出失敗，請重試" }, { status: 503 });
  }
  const response = Response.json({ success: true });
  for (const name of ["orai_auth_session", "vp_admin"]) {
    response.headers.append("Set-Cookie", `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
  }
  return response;
});
