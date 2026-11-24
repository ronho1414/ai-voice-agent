import { createClient } from "@supabase/supabase-js";
import { receiveWebhook } from "@/lib/platform/elevenlabs-webhook";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return receiveWebhook(request, process.env.ELEVENLABS_WEBHOOK_SECRET, async (call) => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Database unavailable");
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await db.rpc("ingest_elevenlabs_call", { payload: call });
    if (error) throw new Error("Persistence failed");
    return String(data);
  });
}
