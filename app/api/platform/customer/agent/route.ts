import { NextRequest } from "next/server";
import { requireCustomerAuth } from "@/lib/platform/auth";
import { getAgentByOrgId } from "@/lib/platform/store";

export async function GET(request: NextRequest) {
  const auth = await requireCustomerAuth(request);
  if (auth instanceof Response) return auth;

  const orgId = auth.organizationId;
  if (!orgId) return Response.json({ error: "No organization associated" }, { status: 400 });

  try {
    const agent = await getAgentByOrgId(orgId);
    if (!agent) {
      return Response.json({
        agent: {
          status: "draft",
          name: "未綁定語音專員",
          voice_name: "Cantonese Female",
          language_mode: "trilingual",
          is_connected: false,
        },
      });
    }

    // Never expose secret API keys or raw credentials to frontend
    return Response.json({
      agent: {
        status: agent.status,
        name: agent.name,
        voice_name: agent.voice_name,
        language_mode: agent.language_mode,
        is_connected: Boolean(agent.elevenlabs_agent_id),
        agent_id_preview: agent.elevenlabs_agent_id
          ? `${agent.elevenlabs_agent_id.slice(0, 4)}...${agent.elevenlabs_agent_id.slice(-4)}`
          : "未設定",
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to load agent info" },
      { status: 500 }
    );
  }
}
