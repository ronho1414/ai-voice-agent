import { fail, json } from "@/lib/http";
import { decideFast } from "@/lib/decision";
import { readUtterance } from "@/lib/utterance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const text = readUtterance((await request.json()) as unknown);
    return json(await decideFast(text));
  } catch (error) {
    return fail(error);
  }
}
