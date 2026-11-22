"use client";

import { useEffect, useState, useCallback, type FormEvent } from "react";
import type {
  Conversation,
  Appointment,
  CustomerOverview,
  AppointmentStatus,
} from "@/lib/platform/types";

export function CustomerDashboard() {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [loginSlug, setLoginSlug] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [tab, setTab] = useState<"overview" | "calls" | "appointments" | "profile" | "agent">("overview");

  // Overview data
  const [overview, setOverview] = useState<CustomerOverview | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);

  // Profile Form State
  const [profName, setProfName] = useState("");
  const [profPhone, setProfPhone] = useState("");
  const [profEmail, setProfEmail] = useState("");
  const [profAddress, setProfAddress] = useState("");
  const [profMonFri, setProfMonFri] = useState("");
  const [profSatSun, setProfSatSun] = useState("");

  // Agent State
  const [agentInfo, setAgentInfo] = useState<{
    status: string;
    name: string;
    voice_name: string;
    language_mode: string;
    is_connected: boolean;
    agent_id_preview?: string;
  } | null>(null);

  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Check auth session on mount
  useEffect(() => {
    fetch("/api/platform/auth/session", { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json();
        if (body.authenticated && body.session?.role === "customer_admin") {
          setAuthenticated(true);
        }
      })
      .catch(() => setError("無法連線至身份驗證伺服器"))
      .finally(() => setReady(true));
  }, []);

  const loadCustomerData = useCallback(async () => {
    setError("");
    try {
      if (tab === "overview") {
        const res = await fetch("/api/platform/customer/overview", { cache: "no-store" });
        if (res.ok) setOverview(await res.json());
      }
      if (tab === "calls") {
        const res = await fetch("/api/platform/customer/conversations", { cache: "no-store" });
        if (res.ok) {
          const body = await res.json();
          setConversations(body.conversations || []);
        }
      }
      if (tab === "appointments") {
        const res = await fetch("/api/platform/customer/appointments", { cache: "no-store" });
        if (res.ok) {
          const body = await res.json();
          setAppointments(body.appointments || []);
        }
      }
      if (tab === "profile") {
        const res = await fetch("/api/platform/customer/profile", { cache: "no-store" });
        if (res.ok) {
          const body = await res.json();
          const p = body.profile;
          if (p) {
            setProfName(p.name || "");
            setProfPhone(p.phone || "");
            setProfEmail(p.email || "");
            setProfAddress(p.address || "");
            setProfMonFri(p.opening_hours?.mon_fri || "");
            setProfSatSun(p.opening_hours?.sat_sun || "");
          }
        }
      }
      if (tab === "agent") {
        const res = await fetch("/api/platform/customer/agent", { cache: "no-store" });
        if (res.ok) {
          const body = await res.json();
          setAgentInfo(body.agent || null);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "載入商戶數據失敗");
    }
  }, [tab]);

  useEffect(() => {
    if (authenticated) {
      void loadCustomerData();
    }
  }, [authenticated, tab, loadCustomerData]);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setBusy("login");
    setError("");
    try {
      const res = await fetch("/api/platform/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "customer",
          slug: loginSlug,
          password: loginPassword,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "商戶代稱或密碼不正確");
      setAuthenticated(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "登入失敗");
    } finally {
      setBusy("");
    }
  }

  async function handleLogout() {
    await fetch("/api/platform/auth/session", { method: "DELETE" });
    setAuthenticated(false);
  }

  async function handleUpdateAppointmentStatus(appointmentId: string, status: AppointmentStatus) {
    try {
      const res = await fetch("/api/platform/customer/appointments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointmentId, status }),
      });
      if (!res.ok) throw new Error("更新預約狀態失敗");
      setAppointments((prev) =>
        prev.map((a) => (a.id === appointmentId ? { ...a, status } : a))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新預約狀態失敗");
    }
  }

  async function handleSaveProfile(e: FormEvent) {
    e.preventDefault();
    setBusy("save_prof");
    setError("");
    setSuccessMsg("");
    try {
      const res = await fetch("/api/platform/customer/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: profName,
          phone: profPhone,
          email: profEmail,
          address: profAddress,
          opening_hours: {
            mon_fri: profMonFri,
            sat_sun: profSatSun,
          },
        }),
      });
      if (!res.ok) throw new Error("儲存商戶資料失敗");
      setSuccessMsg("商戶營業資料已成功更新！語音專員將於下一次對話中即時應用。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "儲存失敗");
    } finally {
      setBusy("");
    }
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAFAFA] text-[#52525B]">
        載入中…
      </div>
    );
  }

  // Customer Login Form
  if (!authenticated) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#FAFAFA] p-4 text-[#09090B]">
        <div className="w-full max-w-md bg-white border border-[#E4E4E7] rounded-3xl p-8 shadow-stripe-md">
          <div className="flex items-center gap-2 mb-6">
            <span className="w-8 h-8 rounded-lg bg-[#09090B] text-white flex items-center justify-center font-extrabold text-sm">
              O
            </span>
            <span className="font-extrabold text-lg tracking-tight">Orai Service</span>
          </div>

          <h1 className="text-2xl font-extrabold tracking-tight">商戶管理登入</h1>
          <p className="mt-1.5 text-xs text-[#52525B]">
            專為香港美容美甲、診所及中小企商戶打造的 AI 智能前台儀表板。
          </p>

          {error && (
            <div className="mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="mt-6 space-y-4">
            <div>
              <label className="block text-xs font-bold text-[#52525B] uppercase mb-1.5" htmlFor="cust-slug">
                商戶專屬代稱 (Slug)
              </label>
              <input
                id="cust-slug"
                type="text"
                required
                placeholder="例如：glow-beauty"
                value={loginSlug}
                onChange={(e) => setLoginSlug(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-[#E4E4E7] bg-[#FAFAFA] text-sm font-mono focus:outline-none focus:border-[#09090B]"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#52525B] uppercase mb-1.5" htmlFor="cust-pwd">
                登入密碼 / 存取碼
              </label>
              <input
                id="cust-pwd"
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="請輸入密碼"
                className="w-full px-4 py-3 rounded-xl border border-[#E4E4E7] bg-[#FAFAFA] text-sm focus:outline-none focus:border-[#09090B]"
              />
            </div>

            <button
              type="submit"
              disabled={busy === "login"}
              className="w-full py-3 rounded-xl bg-[#09090B] hover:bg-[#27272A] text-white font-bold text-sm transition-colors disabled:opacity-50"
            >
              {busy === "login" ? "登入中…" : "進入商戶儀表板"}
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-[#E4E4E7] text-center">
            <a href="/admin" className="text-xs font-semibold text-[#52525B] hover:underline">
              總管理員入口（Orai Admin）→
            </a>
          </div>
        </div>
      </main>
    );
  }

  // Authenticated Customer Dashboard
  return (
    <div className="min-h-screen bg-[#FAFAFA] flex flex-col md:flex-row text-[#09090B]">
      {/* Sidebar */}
      <aside className="w-full md:w-64 bg-white border-r border-[#E4E4E7] flex flex-col shrink-0">
        <div className="p-6 border-b border-[#E4E4E7]">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg bg-[#09090B] text-white flex items-center justify-center font-extrabold text-sm">
              O
            </span>
            <div>
              <div className="font-extrabold text-base tracking-tight leading-none truncate max-w-[150px]">
                {overview?.organization.name || "商戶儀表板"}
              </div>
              <div className="text-[11px] font-semibold text-[#71717A] mt-0.5">Customer Portal</div>
            </div>
          </div>
        </div>

        <nav className="p-4 space-y-1 flex-1">
          <button
            type="button"
            onClick={() => setTab("overview")}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-bold transition-colors text-left ${
              tab === "overview" ? "bg-[#09090B] text-white" : "text-[#52525B] hover:bg-[#F4F4F5]"
            }`}
          >
            <span>營業總覽 (Overview)</span>
          </button>

          <button
            type="button"
            onClick={() => setTab("calls")}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-bold transition-colors text-left ${
              tab === "calls" ? "bg-[#09090B] text-white" : "text-[#52525B] hover:bg-[#F4F4F5]"
            }`}
          >
            <span>通話紀錄 (Call History)</span>
          </button>

          <button
            type="button"
            onClick={() => setTab("appointments")}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-bold transition-colors text-left ${
              tab === "appointments" ? "bg-[#09090B] text-white" : "text-[#52525B] hover:bg-[#F4F4F5]"
            }`}
          >
            <span>預約管理 (Appointments)</span>
          </button>

          <button
            type="button"
            onClick={() => setTab("profile")}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-bold transition-colors text-left ${
              tab === "profile" ? "bg-[#09090B] text-white" : "text-[#52525B] hover:bg-[#F4F4F5]"
            }`}
          >
            <span>商戶資料 (Business Profile)</span>
          </button>

          <button
            type="button"
            onClick={() => setTab("agent")}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-bold transition-colors text-left ${
              tab === "agent" ? "bg-[#09090B] text-white" : "text-[#52525B] hover:bg-[#F4F4F5]"
            }`}
          >
            <span>語音專員狀態 (Agent Info)</span>
          </button>
        </nav>

        <div className="p-4 border-t border-[#E4E4E7]">
          <button
            type="button"
            onClick={handleLogout}
            className="w-full py-2 rounded-xl border border-[#E4E4E7] bg-white text-xs font-bold text-[#52525B] hover:bg-slate-50 transition-colors"
          >
            登出商戶後台
          </button>
        </div>
      </aside>

      {/* Content Area */}
      <main className="flex-1 p-6 sm:p-10 max-w-5xl">
        {error && (
          <div className="mb-6 p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="mb-6 p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold">
            {successMsg}
          </div>
        )}

        {/* 1. OVERVIEW TAB */}
        {tab === "overview" && (
          <div className="space-y-6">
            <header>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
                {overview?.organization.name}
              </h1>
              <p className="text-xs text-[#52525B] mt-1">
                本月 AI 語音專員接待數據、預約概覽與通話總時長。
              </p>
            </header>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-5 rounded-2xl bg-white border border-[#E4E4E7] shadow-stripe-sm">
                <div className="text-xs font-bold text-[#52525B] uppercase">本月通話對話</div>
                <div className="mt-2 text-3xl font-extrabold text-[#09090B]">
                  {overview?.monthlyConversations ?? 0}
                </div>
                <div className="mt-1 text-[11px] text-[#71717A]">位訪客完成諮詢</div>
              </div>

              <div className="p-5 rounded-2xl bg-white border border-[#E4E4E7] shadow-stripe-sm">
                <div className="text-xs font-bold text-[#52525B] uppercase">累計通話分鐘</div>
                <div className="mt-2 text-3xl font-extrabold text-[#09090B]">
                  {overview?.totalCallMinutes ?? 0}
                </div>
                <div className="mt-1 text-[11px] text-[#71717A]">分鐘真人級對答</div>
              </div>

              <div className="p-5 rounded-2xl bg-white border border-[#E4E4E7] shadow-stripe-sm">
                <div className="text-xs font-bold text-[#52525B] uppercase">待確認預約</div>
                <div className="mt-2 text-3xl font-extrabold text-amber-600">
                  {overview?.pendingAppointments ?? 0}
                </div>
                <div className="mt-1 text-[11px] text-[#71717A]">
                  總預約數：{overview?.totalAppointments ?? 0}
                </div>
              </div>

              <div className="p-5 rounded-2xl bg-white border border-[#E4E4E7] shadow-stripe-sm">
                <div className="text-xs font-bold text-[#52525B] uppercase">語音前台專員</div>
                <div className="mt-2 text-xl font-extrabold text-emerald-600">
                  {overview?.agentStatus === "active" ? "24/7 在線" : "已暫停"}
                </div>
                <div className="mt-1 text-[11px] text-[#71717A] truncate">
                  {overview?.agentName || "AI 專員"}
                </div>
              </div>
            </div>

            <div className="p-6 rounded-2xl bg-white border border-[#E4E4E7] shadow-stripe-sm">
              <h2 className="text-base font-extrabold mb-3">日常操作快捷入口</h2>
              <div className="grid sm:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => setTab("appointments")}
                  className="p-4 rounded-xl border border-[#E4E4E7] hover:border-[#09090B] bg-[#FAFAFA] text-left transition-colors"
                >
                  <div className="font-extrabold text-xs">處理預約通知 →</div>
                  <div className="text-[11px] text-[#52525B] mt-1">查看並確認顧客留下的預約資料</div>
                </button>
                <button
                  type="button"
                  onClick={() => setTab("calls")}
                  className="p-4 rounded-xl border border-[#E4E4E7] hover:border-[#09090B] bg-[#FAFAFA] text-left transition-colors"
                >
                  <div className="font-extrabold text-xs">檢閱通話詳情 →</div>
                  <div className="text-[11px] text-[#52525B] mt-1">查閱顧客提問內容及 AI 對答紀錄</div>
                </button>
                <button
                  type="button"
                  onClick={() => setTab("profile")}
                  className="p-4 rounded-xl border border-[#E4E4E7] hover:border-[#09090B] bg-[#FAFAFA] text-left transition-colors"
                >
                  <div className="font-extrabold text-xs">更新營業時間 →</div>
                  <div className="text-[11px] text-[#52525B] mt-1">確保 AI 專員向顧客解答最新時間</div>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 2. CALL HISTORY TAB */}
        {tab === "calls" && (
          <div className="space-y-6">
            <header>
              <h1 className="text-2xl font-extrabold tracking-tight">通話與對話紀錄</h1>
              <p className="text-xs text-[#52525B] mt-1">
                記錄訪客語音諮詢詳情，包括查詢意圖與對答摘錄。
              </p>
            </header>

            {conversations.length === 0 ? (
              <div className="p-12 text-center rounded-2xl bg-white border border-[#E4E4E7]">
                <p className="text-sm font-semibold text-[#52525B]">暫無通話紀錄</p>
                <p className="text-xs text-[#71717A] mt-1">當有顧客在網站使用 AI 語音接待時，完整通話記錄將顯示在此處。</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-[#E4E4E7] bg-white overflow-hidden shadow-stripe-sm">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#E4E4E7] bg-[#FAFAFA] font-bold text-[#52525B]">
                      <th className="p-4">時間</th>
                      <th className="p-4">管道</th>
                      <th className="p-4">通話時長</th>
                      <th className="p-4">查詢意向</th>
                      <th className="p-4">對話摘錄</th>
                      <th className="p-4">狀態</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E4E4E7]">
                    {conversations.map((c) => (
                      <tr key={c.id} className="hover:bg-[#FAFAFA]">
                        <td className="p-4 whitespace-nowrap text-[#71717A]">
                          {new Date(c.created_at).toLocaleString("zh-HK", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="p-4 font-semibold uppercase">{c.channel}</td>
                        <td className="p-4">{c.duration_seconds} 秒</td>
                        <td className="p-4">
                          <span className="font-bold text-[#09090B]">
                            {c.detected_intent || "一般諮詢"}
                          </span>
                        </td>
                        <td className="p-4 max-w-xs truncate text-[#52525B]">
                          {c.user_transcript || c.summary || "—"}
                        </td>
                        <td className="p-4">
                          <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold text-[11px]">
                            {c.status === "completed" ? "已完成" : c.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* 3. APPOINTMENTS TAB */}
        {tab === "appointments" && (
          <div className="space-y-6">
            <header>
              <h1 className="text-2xl font-extrabold tracking-tight">預約管理</h1>
              <p className="text-xs text-[#52525B] mt-1">
                AI 前台自動收集的顧客預約時段、姓名與電話。
              </p>
            </header>

            {appointments.length === 0 ? (
              <div className="p-12 text-center rounded-2xl bg-white border border-[#E4E4E7]">
                <p className="text-sm font-semibold text-[#52525B]">暫無預約申請</p>
                <p className="text-xs text-[#71717A] mt-1">當訪客向 AI 語音專員提出預約需求時，顧客資料會自動整理於此表。</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-[#E4E4E7] bg-white overflow-hidden shadow-stripe-sm">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#E4E4E7] bg-[#FAFAFA] font-bold text-[#52525B]">
                      <th className="p-4">顧客姓名</th>
                      <th className="p-4">聯絡電話</th>
                      <th className="p-4">預約項目</th>
                      <th className="p-4">預約日期與時間</th>
                      <th className="p-4">狀態</th>
                      <th className="p-4 text-right">更改狀態</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E4E4E7]">
                    {appointments.map((a) => (
                      <tr key={a.id} className="hover:bg-[#FAFAFA]">
                        <td className="p-4 font-extrabold text-[#09090B]">{a.customer_name}</td>
                        <td className="p-4 font-mono font-medium text-[#52525B]">
                          <a href={`tel:${a.customer_phone}`} className="hover:underline">
                            {a.customer_phone}
                          </a>
                        </td>
                        <td className="p-4 font-semibold">{a.service_name || "待確認項目"}</td>
                        <td className="p-4 whitespace-nowrap text-[#52525B]">
                          {new Date(a.appointment_time).toLocaleString("zh-HK", {
                            month: "short",
                            day: "numeric",
                            weekday: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="p-4">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                              a.status === "confirmed"
                                ? "bg-emerald-100 text-emerald-800"
                                : a.status === "completed"
                                ? "bg-slate-100 text-slate-700"
                                : a.status === "cancelled"
                                ? "bg-rose-100 text-rose-700"
                                : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {a.status === "pending"
                              ? "待確認"
                              : a.status === "confirmed"
                              ? "已確認"
                              : a.status === "completed"
                              ? "已服務"
                              : "已取消"}
                          </span>
                        </td>
                        <td className="p-4 text-right space-x-1.5 whitespace-nowrap">
                          {a.status !== "confirmed" && (
                            <button
                              type="button"
                              onClick={() => handleUpdateAppointmentStatus(a.id, "confirmed")}
                              className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold"
                            >
                              確認
                            </button>
                          )}
                          {a.status !== "completed" && (
                            <button
                              type="button"
                              onClick={() => handleUpdateAppointmentStatus(a.id, "completed")}
                              className="px-2 py-1 rounded bg-[#09090B] hover:bg-[#27272A] text-white text-[11px] font-bold"
                            >
                              完成
                            </button>
                          )}
                          {a.status !== "cancelled" && (
                            <button
                              type="button"
                              onClick={() => handleUpdateAppointmentStatus(a.id, "cancelled")}
                              className="px-2 py-1 rounded border border-[#E4E4E7] text-rose-600 text-[11px] font-bold hover:bg-rose-50"
                            >
                              取消
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* 4. BUSINESS PROFILE TAB */}
        {tab === "profile" && (
          <div className="space-y-6">
            <header>
              <h1 className="text-2xl font-extrabold tracking-tight">商戶基本資料</h1>
              <p className="text-xs text-[#52525B] mt-1">
                更新門市地址與營業時間，AI 語音專員會在回答顧客時自動引用此處資訊。
              </p>
            </header>

            <div className="p-6 rounded-3xl bg-white border border-[#E4E4E7] shadow-stripe-sm max-w-2xl">
              <form onSubmit={handleSaveProfile} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-[#52525B] mb-1">商戶名稱</label>
                  <input
                    type="text"
                    required
                    value={profName}
                    onChange={(e) => setProfName(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-[#E4E4E7] text-xs focus:outline-none focus:border-[#09090B]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-[#52525B] mb-1">門市電話</label>
                    <input
                      type="text"
                      value={profPhone}
                      onChange={(e) => setProfPhone(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-[#E4E4E7] text-xs focus:outline-none focus:border-[#09090B]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-[#52525B] mb-1">聯絡電郵</label>
                    <input
                      type="email"
                      value={profEmail}
                      onChange={(e) => setProfEmail(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-[#E4E4E7] text-xs focus:outline-none focus:border-[#09090B]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#52525B] mb-1">店舖營業地址</label>
                  <input
                    type="text"
                    value={profAddress}
                    onChange={(e) => setProfAddress(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-[#E4E4E7] text-xs focus:outline-none focus:border-[#09090B]"
                  />
                </div>

                <div className="pt-2 border-t border-[#E4E4E7]">
                  <div className="font-extrabold text-xs text-[#09090B] mb-3">門市營業時間設定</div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-[#52525B] mb-1">星期一至五</label>
                      <input
                        type="text"
                        placeholder="10:00 - 20:00"
                        value={profMonFri}
                        onChange={(e) => setProfMonFri(e.target.value)}
                        className="w-full px-4 py-2.5 rounded-xl border border-[#E4E4E7] text-xs focus:outline-none focus:border-[#09090B]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[#52525B] mb-1">星期六、日及公眾假期</label>
                      <input
                        type="text"
                        placeholder="11:00 - 19:00"
                        value={profSatSun}
                        onChange={(e) => setProfSatSun(e.target.value)}
                        className="w-full px-4 py-2.5 rounded-xl border border-[#E4E4E7] text-xs focus:outline-none focus:border-[#09090B]"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-4 flex justify-end">
                  <button
                    type="submit"
                    disabled={busy === "save_prof"}
                    className="px-5 py-2.5 rounded-xl bg-[#09090B] hover:bg-[#27272A] text-white text-xs font-bold transition-colors disabled:opacity-50"
                  >
                    {busy === "save_prof" ? "儲存中…" : "儲存營業資料"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* 5. AGENT INFO TAB */}
        {tab === "agent" && (
          <div className="space-y-6">
            <header>
              <h1 className="text-2xl font-extrabold tracking-tight">AI 專員狀態</h1>
              <p className="text-xs text-[#52525B] mt-1">
                檢視已接駁的 Orai 智能語音專員配置資訊。
              </p>
            </header>

            <div className="p-6 rounded-3xl bg-white border border-[#E4E4E7] shadow-stripe-sm max-w-2xl space-y-4">
              <div className="flex items-center justify-between pb-4 border-b border-[#E4E4E7]">
                <div>
                  <div className="font-extrabold text-base">{agentInfo?.name || "AI 專員"}</div>
                  <div className="text-xs text-[#52525B] mt-0.5">Orai Managed Voice Service</div>
                </div>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-bold ${
                    agentInfo?.status === "active"
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {agentInfo?.status === "active" ? "正常服務中" : "未啟用"}
                </span>
              </div>

              <div className="space-y-3 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-[#52525B]">支援語言</span>
                  <span className="font-bold">三語對答（地道廣東話、英語、普通話）</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-[#52525B]">聲線音色</span>
                  <span className="font-bold">香港粵語女性（專業親切前台）</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-[#52525B]">ElevenLabs 連接識別碼</span>
                  <span className="font-mono bg-slate-100 px-2 py-0.5 rounded text-[11px]">
                    {agentInfo?.agent_id_preview || "已加密隱藏"}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-[#52525B]">安全隔離等級</span>
                  <span className="font-bold text-emerald-700">獨立加密知識庫隔離</span>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-[#FAFAFA] border border-[#E4E4E7] text-[11px] text-[#71717A] leading-relaxed">
                如需更改 AI 專員聲線或自訂回答規則，請聯絡 Orai 客服顧問協助微調模型與提示詞。
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
