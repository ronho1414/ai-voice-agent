import { withPlatformRequest } from "@/lib/platform/supabase-auth";
import { requireSuperAdmin } from "@/lib/platform/auth";
import { getSuperAdminOverview } from "@/lib/platform/store";

async function handleGET(request: Request) {
  const auth = await requireSuperAdmin(request);
  if (auth instanceof Response) return auth;

  try {
    const overview = await getSuperAdminOverview();
    return Response.json(overview, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to load overview" },
      { status: 500 }
    );
  }
}

export const GET = withPlatformRequest(handleGET);
