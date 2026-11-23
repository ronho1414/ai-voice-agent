import { withPlatformRequest } from "@/lib/platform/supabase-auth";
import { requireCustomerAuth } from "@/lib/platform/auth";
import { getCustomerOverview } from "@/lib/platform/store";

async function handleGET(request: Request) {
  const auth = await requireCustomerAuth(request);
  if (auth instanceof Response) return auth;

  const orgId = auth.organizationId;
  if (!orgId) {
    return Response.json({ error: "No organization associated with this account" }, { status: 400 });
  }

  try {
    const overview = await getCustomerOverview(orgId);
    if (!overview) return Response.json({ error: "Organization not found" }, { status: 404 });
    return Response.json(overview, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to load customer overview" },
      { status: 500 }
    );
  }
}

export const GET = withPlatformRequest(handleGET);
