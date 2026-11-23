import { requireSuperAdmin } from "@/lib/platform/auth";

export async function requireAdmin(request: Request): Promise<Response | null> {
  const auth = await requireSuperAdmin(request);
  return auth instanceof Response ? auth : null;
}
