import type { PlatformSession } from "./types";
import { authConfigured, requestSupabase } from "./supabase-auth";

export async function getPlatformSession(request: Request): Promise<PlatformSession | null> {
  if (!authConfigured()) return null;
  const supabase = requestSupabase(request);
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user || user.is_anonymous) return null;
  const { data: active, error: sessionError } = await supabase.rpc("current_session_is_active");
  if (sessionError) throw new Error("Session validation unavailable");
  if (!active) return null;
  const { data: profile, error: profileError } = await supabase.from("profiles")
    .select("id,email,full_name,system_role").eq("id", user.id).maybeSingle();
  if (profileError) throw new Error("Profile validation unavailable");
  if (!profile) return null;
  const base = { userId: user.id, email: user.email || profile.email, fullName: profile.full_name };
  if (profile.system_role === "super_admin") return { ...base, role: "super_admin" };
  const { data: members, error: memberError } = await supabase.from("organization_members")
    .select("organization_id,organizations(id,name,slug,status)")
    .eq("profile_id", user.id).eq("role", "customer_admin").eq("is_active", true)
    .order("created_at", { ascending: true });
  if (memberError) throw new Error("Membership validation unavailable");
  // Until a tenant switcher is added, choose a stable active membership.
  // Request-supplied IDs never select the authenticated tenant.
  for (const member of members || []) {
    const org = Array.isArray(member.organizations) ? member.organizations[0] : member.organizations;
    if (org?.status === "active") {
      return { ...base, role: "customer_admin", organizationId: org.id, organizationName: org.name, organizationSlug: org.slug };
    }
  }
  return null;
}

export function unauthorizedResponse(message = "請先登入"): Response {
  return Response.json({ error: message }, { status: 401 });
}
export function forbiddenResponse(message = "此帳戶沒有操作權限"): Response {
  return Response.json({ error: message }, { status: 403 });
}
export async function requireSuperAdmin(request: Request): Promise<PlatformSession | Response> {
  const session = await getPlatformSession(request);
  if (!session) return unauthorizedResponse();
  return session.role === "super_admin" ? session : forbiddenResponse();
}
export async function requireCustomerAuth(request: Request, requiredOrgId?: string): Promise<PlatformSession | Response> {
  const session = await getPlatformSession(request);
  if (!session) return unauthorizedResponse();
  if (session.role !== "customer_admin" || !session.organizationId) return forbiddenResponse();
  if (requiredOrgId && session.organizationId !== requiredOrgId) return forbiddenResponse();
  return session;
}
