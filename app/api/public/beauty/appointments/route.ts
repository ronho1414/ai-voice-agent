import { createBeautyAppointment } from "@/lib/beauty/store";
import { BookingError } from "@/lib/beauty/booking";
import { isSameOriginMutation } from "@/lib/platform/supabase-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!isSameOriginMutation(request)) return Response.json({ error: "頁面網址與提交來源不一致。請從目前網站重新開啟預約頁後再試。", code: "ORIGIN_MISMATCH" }, { status: 403, headers });
  if (!request.headers.get("content-type")?.includes("application/json")) return Response.json({ error: "請使用預約表格提交。" }, { status: 415, headers });
  const text = await request.text();
  if (Buffer.byteLength(text) > 12_000) return Response.json({ error: "提交內容過長。" }, { status: 413, headers });
  let body;
  try { body = JSON.parse(text); } catch { return Response.json({ error: "資料格式不正確。" }, { status: 400, headers }); }
  try {
    const result = await createBeautyAppointment(body);
    return Response.json({ ...result, message: "已收到預約要求，店員會再與你確認。" }, { status: result.duplicate ? 200 : 201, headers });
  } catch (error) {
    return Response.json({ error: error instanceof BookingError ? error.message : "服務暫時無法使用，請稍後再試。",
      code: error instanceof BookingError ? error.code : "BOOKING_UNAVAILABLE" },
      { status: error instanceof BookingError ? error.status : 503, headers });
  }
}
