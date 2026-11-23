import { createHash } from "node:crypto";
import { BEAUTY_SERVICES, BEAUTY_WINDOWS, hongKongDate } from "./catalog";

export type BeautyRequest = {
  requestId: string; name: string; phone: string; serviceId: string;
  date: string; window: keyof typeof BEAUTY_WINDOWS; notes: string;
};
export class BookingError extends Error {
  constructor(message: string, public status = 400, public code = "INVALID_BOOKING") { super(message); }
}

export function validateBeautyRequest(value: unknown, now = new Date()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BookingError("請填寫預約資料。");
  const body = value as Record<string, unknown>;
  const allowed = ["requestId", "name", "phone", "serviceId", "date", "window", "notes", "website"];
  if (Object.keys(body).some((key) => !allowed.includes(key))) throw new BookingError("預約資料包含不支援的欄位。");
  if (body.website) throw new BookingError("無法提交，請稍後再試。");
  if (typeof body.requestId !== "string" || !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(body.requestId)) throw new BookingError("請重新整理頁面後再提交。");
  if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 80) throw new BookingError("請填寫稱呼，最多 80 個字。");
  if (typeof body.phone !== "string") throw new BookingError("請填寫有效香港電話號碼。");
  const phone = body.phone.replace(/[\s()-]/g, "").replace(/^(?:\+852|852)(?=\d{8}$)/, "");
  if (!/^[23456789]\d{7}$/.test(phone)) throw new BookingError("請填寫有效的 8 位香港電話號碼。");
  const service = BEAUTY_SERVICES.find((item) => item.id === body.serviceId);
  if (!service) throw new BookingError("請選擇療程。");
  if (typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) throw new BookingError("請選擇希望到訪日期。");
  const day = new Date(`${body.date}T00:00:00+08:00`);
  if (!Number.isFinite(day.getTime()) || hongKongDate(day) !== body.date) throw new BookingError("日期格式不正確。");
  const maxDate = hongKongDate(new Date(now.getTime() + 90 * 86400000));
  if (body.date < hongKongDate(now) || body.date > maxDate) throw new BookingError("請選擇今日起 90 日內的日期。");
  if (typeof body.window !== "string" || !(body.window in BEAUTY_WINDOWS) || !Object.hasOwn(BEAUTY_WINDOWS, body.window)) throw new BookingError("請選擇希望到訪時段。");
  if (body.notes !== undefined && (typeof body.notes !== "string" || body.notes.length > 1000)) throw new BookingError("備註最多 1,000 個字。");
  const window = body.window as keyof typeof BEAUTY_WINDOWS;
  const normalized: BeautyRequest = { requestId: body.requestId, name: body.name.trim(), phone: `+852${phone}`,
    serviceId: service.id, date: body.date, window, notes: typeof body.notes === "string" ? body.notes.trim() : "" };
  const payload = { name: normalized.name, phone: normalized.phone, serviceId: normalized.serviceId,
    date: normalized.date, window: normalized.window, notes: normalized.notes };
  return { normalized, service, appointmentTime: `${body.date}T${BEAUTY_WINDOWS[window].hour}:00+08:00`,
    requestHash: createHash("sha256").update(JSON.stringify(payload)).digest("hex") };
}
