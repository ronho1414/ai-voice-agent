// Legacy shared-password cookies are no longer accepted.
export { authConfigured as adminConfigured } from "@/lib/platform/supabase-auth";
import { getPlatformSession } from "@/lib/platform/auth";

export async function isAdminRequest(request: Request): Promise<boolean> {
  return (await getPlatformSession(request))?.role === "super_admin";
}
