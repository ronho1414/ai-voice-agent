import { NextRequest } from "next/server";
import { requireSuperAdmin } from "@/lib/platform/auth";
import {
  listOrganizations,
  createOrganization,
  updateOrganization,
  getAgentByOrgId,
  upsertAgent
} from "@/lib/platform/store";

export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if (auth instanceof Response) return auth;

  try {
    const orgs = await listOrganizations();
    const withAgents = await Promise.all(
      orgs.map(async (org) => {
        const agent = await getAgentByOrgId(org.id);
        return {
          ...org,
          agent: agent
            ? {
                id: agent.id,
                elevenlabs_agent_id: agent.elevenlabs_agent_id,
                name: agent.name,
                status: agent.status,
                language_mode: agent.language_mode,
              }
            : null,
        };
      })
    );
    return Response.json({ organizations: withAgents }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to load organizations" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if (auth instanceof Response) return auth;

  try {
    const body = await request.json();
    if (!body.name || !body.slug) {
      return Response.json({ error: "請填寫商戶名稱及網址代稱 (Slug)" }, { status: 400 });
    }

    const org = await createOrganization({
      name: body.name,
      slug: body.slug,
      industry: body.industry,
      phone: body.phone,
      email: body.email,
      address: body.address,
      elevenlabsAgentId: body.elevenlabsAgentId,
    });

    return Response.json({ success: true, organization: org });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to create organization" },
      { status: 400 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if (auth instanceof Response) return auth;

  try {
    const body = await request.json();
    const id = body.id;
    if (!id) return Response.json({ error: "Organization ID is required" }, { status: 400 });

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.status !== undefined) updates.status = body.status;
    if (body.industry !== undefined) updates.industry = body.industry;
    if (body.phone !== undefined) updates.phone = body.phone;
    if (body.email !== undefined) updates.email = body.email;
    if (body.address !== undefined) updates.address = body.address;
    if (body.opening_hours !== undefined) updates.opening_hours = body.opening_hours;

    const org = await updateOrganization(id, updates);

    // If agent ID update requested:
    if (body.elevenlabsAgentId !== undefined) {
      await upsertAgent(id, {
        elevenlabsAgentId: body.elevenlabsAgentId,
        status: body.agentStatus,
      });
    }

    return Response.json({ success: true, organization: org });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to update organization" },
      { status: 400 }
    );
  }
}
