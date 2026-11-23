"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { BEAUTY_SERVICES, BEAUTY_WINDOWS, hongKongDate } from "@/lib/beauty/catalog";
import { bookingFailureMessage } from "@/lib/beauty/client-errors";

export function BeautyBookingForm() {
  const [serviceId, setServiceId] = useState<string>(BEAUTY_SERVICES[0].id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<{ id: string; date: string; window: string; service: string } | null>(null);
  const [minDate, setMinDate] = useState("");
  const [maxDate, setMaxDate] = useState("");
  const pending = useRef<{ fingerprint: string; id: string } | null>(null);

  useEffect(() => {
    setMinDate(hongKongDate());
    setMaxDate(hongKongDate(new Date(Date.now() + 90 * 86400000)));
    try { pending.current = JSON.parse(sessionStorage.getItem("orai-beauty-pending") || "null"); } catch { /* Storage can be unavailable. */ }
    const selectService = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (BEAUTY_SERVICES.some((service) => service.id === id)) setServiceId(id);
    };
    window.addEventListener("beauty:select-service", selectService);
    return () => window.removeEventListener("beauty:select-service", selectService);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    const values = { name: String(fields.get("name") || ""), phone: String(fields.get("phone") || ""),
      serviceId, date: String(fields.get("date") || ""), window: String(fields.get("window") || ""),
      notes: String(fields.get("notes") || ""), website: String(fields.get("website") || "") };
    // Persist only an opaque hash and random ID, never customer contact details.
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(values)));
    const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, id: crypto.randomUUID() };
    try { sessionStorage.setItem("orai-beauty-pending", JSON.stringify(pending.current)); } catch { /* In-memory retries still work. */ }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/public/beauty/appointments", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...values, requestId: pending.current!.id }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "暫時未能提交，請稍後再試。");
      setReceipt({ id: result.id, date: values.date, window: BEAUTY_WINDOWS[values.window as keyof typeof BEAUTY_WINDOWS].label,
        service: BEAUTY_SERVICES.find((service) => service.id === serviceId)!.name });
    } catch (failure) {
      setError(bookingFailureMessage(failure));
    } finally { setBusy(false); }
  }

  if (receipt) return <div className="beauty-receipt" role="status" tabIndex={-1}>
    <span className="beauty-receipt-icon" aria-hidden="true">✓</span>
    <p className="beauty-eyebrow">YOUR MOMENT, RESERVED FOR REVIEW</p>
    <h3>已收到你的預約要求。</h3>
    <p>店員會再與你聯絡，確認療程及可安排時段。<br />提交表格不代表已確認預約，請以店員聯絡為準；此表格不會收取費用。</p>
    <dl><div><dt>療程</dt><dd>{receipt.service}</dd></div><div><dt>希望日期</dt><dd>{receipt.date}</dd></div>
      <div><dt>希望時段</dt><dd>{receipt.window}</dd></div><div><dt>參考編號</dt><dd className="beauty-reference">{receipt.id}</dd></div></dl>
    <button type="button" className="beauty-button beauty-button-outline" onClick={() => { pending.current = null; setReceipt(null); }}>提出另一個預約要求</button>
  </div>;

  return <form onSubmit={submit} className="beauty-form">
    <div className="beauty-form-heading"><h3>你的專屬護理時間</h3><span>預約要求</span></div>
    <div className="beauty-form-grid">
      <label>你的稱呼 <span>*</span><input name="name" autoComplete="name" required maxLength={80} placeholder="例如：陳小姐" /></label>
      <label>聯絡電話 <span>*</span><input name="phone" type="tel" autoComplete="tel" required maxLength={20} placeholder="8 位香港電話號碼" /></label>
    </div>
    <label>想體驗的療程 <span>*</span><select name="serviceId" value={serviceId} onChange={(event) => setServiceId(event.target.value)}>
      {BEAUTY_SERVICES.map((service) => <option key={service.id} value={service.id}>{service.name} · {service.minutes} 分鐘 · HK${service.price.toLocaleString()}</option>)}
    </select></label>
    <div className="beauty-form-grid"><label>希望日期 <span>*</span><input name="date" type="date" required min={minDate} max={maxDate} /></label>
      <label>希望時段 <span>*</span><select name="window" required defaultValue=""><option value="" disabled>請選擇時段</option>{Object.entries(BEAUTY_WINDOWS).map(([id, entry]) => <option key={id} value={id}>{entry.label}</option>)}</select></label></div>
    <label>有甚麼想告訴我們？<textarea name="notes" maxLength={1000} rows={3} placeholder="例如：首次到訪、肌膚需要，或方便聯絡的時間（選填）" /></label>
    <div className="beauty-honeypot" aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
    <label className="beauty-consent"><input type="checkbox" required /> <span>我明白這是示範網站，會使用虛構測試資料；提交後需由店員再確認，並同意用所填聯絡資料處理此預約要求。</span></label>
    {error && <p className="beauty-error" role="alert">{error}</p>}
    <button type="submit" disabled={busy} className="beauty-button beauty-submit">{busy ? "正在提交你的預約要求…" : "提交預約要求"}</button>
    <p className="beauty-form-note">毋須付款 · 非即時確認 · 所有時間均為香港時間</p>
  </form>;
}
