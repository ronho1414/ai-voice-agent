import { NextRequest } from "next/server";
import { requireCustomerAuth } from "@/lib/platform/auth";
import { listConversations } from "@/lib/platform/store";

export async function GET(request: NextRequest) {
  const auth = await requireCustomerAuth(request);
  if (auth instanceof Response) return auth;

  const orgId = auth.organizationId;
  if (!orgId) {
    return Response.json({ error: "No organization associated" }, { status: 400 });
  }

  try {
    const conversations = await listConversations(orgId);
    return Response.json({ conversations }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to load conversations" },
      { status: 500 }
    );
  }
}
