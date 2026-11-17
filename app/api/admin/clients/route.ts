import { readAgentId, readClientName, readClientSlug, readRouteMap } from "@/lib/admin/clients";
import { requireAdmin } from "@/lib/admin/guard";
import { listClients, saveClient, setClientActive } from "@/lib/admin/store";
import { fail, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    return json(await listClients());
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    const body = (await request.json()) as {
      clientName?: unknown;
      clientSlug?: unknown;
      elevenlabsAgentId?: unknown;
      routeMap?: unknown;
    };
    const saved = await saveClient({
      client_slug: readClientSlug(body.clientSlug),
      client_name: readClientName(body.clientName),
      elevenlabs_agent_id: readAgentId(body.elevenlabsAgentId),
      route_map: readRouteMap(body.routeMap),
    });
    return json(saved);
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    const body = (await request.json()) as { clientSlug?: unknown; isActive?: unknown };
    if (typeof body.isActive !== "boolean") throw new Error("Client was not found");
    const slug = readClientSlug(body.clientSlug);
    const mode = await setClientActive(slug, body.isActive);
    return json({ mode, clientSlug: slug, isActive: body.isActive });
  } catch (error) {
    return fail(error);
  }
}
