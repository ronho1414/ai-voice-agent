import { createClient } from "@supabase/supabase-js";
import { BookingError, validateBeautyRequest } from "./booking";

export async function createBeautyAppointment(value: unknown) {
  const { normalized, service, appointmentTime, requestHash } = validateBeautyRequest(value);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new BookingError("預約服務尚在設定中，請稍後再試。", 503, "BOOKING_SETUP_REQUIRED");
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const slug = process.env.ORAI_BEAUTY_ORGANIZATION_SLUG?.trim() || "orai-beauty";
  const { data: org, error: orgError } = await sb.from("organizations").select("id,status")
    .eq("slug", slug).eq("status", "active").maybeSingle();
  if (orgError) throw new BookingError("預約資料服務暫時無法連線，請稍後再試。", 503, "BOOKING_DATABASE_UNAVAILABLE");
  if (!org) throw new BookingError("此示範商戶尚未啟用網上預約，請稍後再試。", 503, "BOOKING_MERCHANT_UNAVAILABLE");
  const { data, error } = await sb.from("appointments").insert({
    organization_id: org.id, customer_name: normalized.name, customer_phone: normalized.phone,
    service_name: service.name, appointment_time: appointmentTime, notes: normalized.notes,
    status: "pending", request_key: normalized.requestId, request_hash: requestHash,
    preferred_time_window: normalized.window, source: "beauty_website",
  }).select("id,status").single();
  if (!error) return { id: data.id, status: data.status, duplicate: false };
  if (error.code === "23505") {
    const { data: existing, error: lookupError } = await sb.from("appointments")
      .select("id,status,request_hash").eq("organization_id", org.id).eq("request_key", normalized.requestId).maybeSingle();
    if (!lookupError && existing?.request_hash === requestHash) return { id: existing.id, status: existing.status, duplicate: true };
    if (!lookupError && existing) throw new BookingError("此提交編號已使用，請重新開始預約。", 409);
  }
  if (["PGRST204", "42703", "42P01"].includes(error.code)) {
    throw new BookingError("預約服務尚在設定中，暫時無法接收要求。請稍後再試。", 503, "BOOKING_SETUP_REQUIRED");
  }
  throw new BookingError("預約暫時未能儲存，請保留資料並稍後再試。", 503, "BOOKING_STORAGE_UNAVAILABLE");
}
