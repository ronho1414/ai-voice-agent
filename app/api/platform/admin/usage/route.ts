import { NextRequest } from "next/server";
import { requireSuperAdmin } from "@/lib/platform/auth";
import { listAllUsageRecords, listOrganizations } from "@/lib/platform/store";

export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if (auth instanceof Response) return auth;

  try {
    const [usage, orgs] = await Promise.all([
      listAllUsageRecords(),
      listOrganizations(),
    ]);

    const orgMap = new Map(orgs.map((o) => [o.id, o]));

    const enrichedUsage = usage.map((u) => {
      const org = orgMap.get(u.organization_id);
      return {
        ...u,
        organization_name: org ? org.name : "未知商戶",
        organization_slug: org ? org.slug : "",
      };
    });

    const totalMinutes = usage.reduce((sum, r) => sum + Number(r.call_minutes || 0), 0);
    const totalConversations = usage.reduce((sum, r) => sum + Number(r.conversation_count || 0), 0);

    return Response.json({
      usage: enrichedUsage,
      summary: {
        totalMinutes: Math.round(totalMinutes * 10) / 10,
        totalConversations,
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to load usage" },
      { status: 500 }
    );
  }
}
