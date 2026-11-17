import { fail, json } from "@/lib/http";
import { relayChat } from "@/lib/relay";
import { readUtterance } from "@/lib/utterance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const text = readUtterance((await request.json()) as unknown);
    return json(await relayChat(text));
  } catch (error) {
    return fail(error);
  }
}
