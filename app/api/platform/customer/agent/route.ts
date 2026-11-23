import { withPlatformRequest } from "@/lib/platform/supabase-auth";
import { requireCustomerAuth } from "@/lib/platform/auth";
import { getAgentByOrgId, updateAgentInstructions } from "@/lib/platform/store";

async function handleGET(request: Request) {
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
          customer_instructions: "",
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
        customer_instructions:
          typeof agent.config?.customer_instructions === "string"
            ? agent.config.customer_instructions
            : "",
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

async function handlePATCH(request: Request) {
  const auth = await requireCustomerAuth(request);
  if (auth instanceof Response) return auth;
  const orgId = auth.organizationId;
  if (!orgId) return Response.json({ error: "No organization associated" }, { status: 400 });

  try {
    const body = await request.json();
    if (typeof body.customer_instructions !== "string") {
      return Response.json({ error: "請輸入 AI 專員指示內容" }, { status: 400 });
    }
    if (body.customer_instructions.length > 20_000) {
      return Response.json({ error: "指示內容最多 20,000 字元" }, { status: 400 });
    }
    const agent = await updateAgentInstructions(orgId, body.customer_instructions.trim());
    return Response.json({
      success: true,
      customer_instructions: agent.config.customer_instructions,
      integration: "saved_for_elevenlabs_sync",
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to save agent instructions" },
      { status: 400 }
    );
  }
}

export const GET = withPlatformRequest(handleGET);
export const PATCH = withPlatformRequest(handlePATCH);
