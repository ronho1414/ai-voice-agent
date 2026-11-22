import { NextRequest } from "next/server";
import { requireSuperAdmin } from "@/lib/platform/auth";
import { getSuperAdminOverview } from "@/lib/platform/store";

export async function GET(request: NextRequest) {
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
