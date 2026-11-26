import { ClientConfigServiceError, publicClientConfig } from "@/lib/admin/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "no-store",
};

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(request: Request): Promise<Response> {
  const requested = new URL(request.url).searchParams.get("client")?.trim() || "voicepilot-hq";
  try {
    const config = await publicClientConfig(requested);
    if (!config) return Response.json({ error: "Not found" }, { status: 404, headers: CORS });
    return Response.json(config, { headers: CORS });
  } catch (err) {
    const status = err instanceof ClientConfigServiceError ? err.status : 503;
    return Response.json({ error: "Service unavailable" }, { status, headers: CORS });
  }
}
