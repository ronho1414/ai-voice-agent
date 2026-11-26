import { handleCreateElevenLabsMessage } from "@/lib/platform/message-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleCreateElevenLabsMessage(request);
}
