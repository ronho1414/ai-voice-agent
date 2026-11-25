"use client";

import { useEffect, useState, useCallback, type ChangeEvent, type FormEvent } from "react";
import { BEAUTY_WINDOWS } from "@/lib/beauty/catalog";
import type {
  Conversation,
  Appointment,
  CustomerOverview,
  AppointmentStatus,
  KnowledgeSource,
  SourceType,
} from "@/lib/platform/types";
import { CustomerAgentPanel, NotificationBell } from "@/components/managed-agent";

type DashboardIconName = "overview" | "calls" | "appointments" | "knowledge" | "profile" | "agent";

type ConversationTranscriptTurn = {
  role: string;
  message: string;
  time_in_call_secs?: number;
};

function readOptionalTranscript(conversation: Conversation): ConversationTranscriptTurn[] | undefined {
  if (!("transcript" in conversation)) return undefined;
  const raw = (conversation as Conversation & { transcript?: unknown }).transcript;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;

  const turns: ConversationTranscriptTurn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.role !== "string" || typeof record.message !== "string") continue;
    const turn: ConversationTranscriptTurn = { role: record.role, message: record.message };
    if (typeof record.time_in_call_secs === "number") {
      turn.time_in_call_secs = record.time_in_call_secs;
    }
    turns.push(turn);
  }
  return turns.length > 0 ? turns : undefined;
}

function DashboardIcon({ name, className = "h-5 w-5" }: { name: DashboardIconName; className?: string }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} {...common}>
      {name === "overview" && <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>}
      {name === "calls" && <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 8.9a16 16 0 0 0 6 6l1.2-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.8 2.1Z"/>}
      {name === "appointments" && <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M9 15l2 2 4-4"/></>}
      {name === "knowledge" && <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21z"/><path d="M4 5.5v13A2.5 2.5 0 0 1 6.5 16H20M8 7h8M8 10h7"/></>}
      {name === "profile" && <><rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M10 12v2h4v-2"/></>}
      {name === "agent" && <><rect x="4" y="7" width="16" height="13" rx="3"/><path d="M12 3v4M9 13h.01M15 13h.01M9 17h6"/><circle cx="12" cy="3" r="1"/></>}
    </svg>
  );
}

export function CustomerDashboard() {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [tab, setTab] = useState<"overview" | "calls" | "appointments" | "knowledge" | "profile" | "agent">("overview");

  // Overview data
  const [overview, setOverview] = useState<CustomerOverview | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [knowledgeSources, setKnowledgeSources] = useState<KnowledgeSource[]>([]);
  const [knowledgeTitle, setKnowledgeTitle] = useState("");
  const [knowledgeContent, setKnowledgeContent] = useState("");
  const [knowledgeType, setKnowledgeType] = useState<SourceType>("faq");
  const [editingKnowledge, setEditingKnowledge] = useState<{ id: string; title: string; content: string } | null>(null);

  // Profile Form State
  const [profName, setProfName] = useState("");
  const [profPhone, setProfPhone] = useState("");
  const [profEmail, setProfEmail] = useState("");
  const [profAddress, setProfAddress] = useState("");
  const [profMonFri, setProfMonFri] = useState("");
  const [profSatSun, setProfSatSun] = useState("");

  const [focusRequestId, setFocusRequestId] = useState<string | null>(null);

  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const openManagedRequest = useCallback((requestId: string) => {
    setFocusRequestId(requestId);
    setTab("agent");
  }, []);

  const clearFocusRequest = useCallback(() => {
    setFocusRequestId(null);
  }, []);

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
        if (!res.ok) throw new Error("無法載入資料，請稍後重試；目前顯示並非最新數據。");
        if (res.ok) setOverview(await res.json());
      }
      if (tab === "calls") {
        const res = await fetch("/api/platform/customer/conversations", { cache: "no-store" });
        if (!res.ok) throw new Error("無法載入資料，請稍後重試；目前顯示並非最新數據。");
        if (res.ok) {
          const body = await res.json();
          setConversations(body.conversations || []);
        }
      }
      if (tab === "appointments") {
        const res = await fetch("/api/platform/customer/appointments", { cache: "no-store" });
        if (!res.ok) throw new Error("無法載入資料，請稍後重試；目前顯示並非最新數據。");
        if (res.ok) {
          const body = await res.json();
          setAppointments(body.appointments || []);
        }
      }
      if (tab === "knowledge") {
        const res = await fetch("/api/platform/customer/knowledge", { cache: "no-store" });
        if (!res.ok) throw new Error("無法載入資料，請稍後重試；目前顯示並非最新數據。");
        if (res.ok) {
          const body = await res.json();
          setKnowledgeSources(body.sources || []);
        }
      }
      if (tab === "profile") {
        const res = await fetch("/api/platform/customer/profile", { cache: "no-store" });
        if (!res.ok) throw new Error("無法載入資料，請稍後重試；目前顯示並非最新數據。");
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
          email: loginEmail,
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
    const res = await fetch("/api/platform/auth/session", { method: "DELETE" }); if (res.ok) setAuthenticated(false); else setError("登出失敗，請重試");
  }

  async function handleUpdateAppointmentStatus(appointmentId: string, status: AppointmentStatus) {
    setBusy(`appointment_${appointmentId}`);
    setError("");
    try {
      const res = await fetch("/api/platform/customer/appointments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointmentId, status }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "更新預約狀態失敗");
      setAppointments((prev) =>
        prev.map((a) => (a.id === appointmentId ? { ...a, status } : a))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新預約狀態失敗");
    } finally {
      setBusy("");
    }
  }

  async function handleDeleteAppointment(appointmentId: string) {
    if (!window.confirm("確定要永久刪除這筆預約記錄嗎？此操作無法還原。")) return;
    setBusy(`appointment_delete_${appointmentId}`);
    setError("");
    try {
      const res = await fetch(`/api/platform/customer/appointments?appointmentId=${encodeURIComponent(appointmentId)}`, {
        method: "DELETE",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "刪除預約失敗");
      setAppointments((prev) => prev.filter((a) => a.id !== appointmentId));
      setSuccessMsg("預約記錄已成功刪除");
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "刪除預約失敗");
    } finally {
      setBusy("");
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
      setSuccessMsg("商戶營業資料已成功更新。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "儲存失敗");
    } finally {
      setBusy("");
    }
  }

  async function handleAddKnowledge(e: FormEvent) {
    e.preventDefault();
    setBusy("knowledge_add");
    setError("");
    setSuccessMsg("");
    try {
      const res = await fetch("/api/platform/customer/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: knowledgeTitle, content: knowledgeContent, source_type: knowledgeType }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "新增知識失敗");
      setKnowledgeSources((items) => [body.source, ...items]);
      setKnowledgeTitle("");
      setKnowledgeContent("");
      setSuccessMsg("知識已儲存。ElevenLabs API 接駁後可同步至 AI 專員。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "新增知識失敗");
    } finally {
      setBusy("");
    }
  }

  async function handleUploadPdf(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("只可以上載 PDF 檔案");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("PDF 檔案不可大於 10 MB");
      return;
    }
    setBusy("knowledge_upload");
    setError("");
    setSuccessMsg("");
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch("/api/platform/customer/knowledge", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "PDF 上載失敗");
      setKnowledgeSources((items) => [body.source, ...items]);
      setSuccessMsg(`PDF 已上載並抽取 ${body.extractedCharacters.toLocaleString()} 個字元，已加入知識庫供日後同步至 ElevenLabs。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "PDF 上載失敗");
    } finally {
      setBusy("");
    }
  }

  async function handleSaveKnowledge() {
    if (!editingKnowledge) return;
    setBusy("knowledge_save");
    setError("");
    try {
      const res = await fetch("/api/platform/customer/knowledge", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingKnowledge.id, title: editingKnowledge.title, content: editingKnowledge.content }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "更新知識失敗");
      setKnowledgeSources((items) => items.map((item) => item.id === body.source.id ? body.source : item));
      setEditingKnowledge(null);
      setSuccessMsg("知識已更新，儲存內容已準備供 ElevenLabs 同步使用。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新知識失敗");
    } finally {
      setBusy("");
    }
  }

  async function handleToggleKnowledge(source: KnowledgeSource) {
    try {
      const res = await fetch("/api/platform/customer/knowledge", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: source.id, is_active: !source.is_active }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "更新知識狀態失敗");
      setKnowledgeSources((items) => items.map((item) => item.id === source.id ? body.source : item));
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新知識狀態失敗");
    }
  }

  async function handleDeleteKnowledge(id: string) {
    if (!window.confirm("確定刪除呢則知識？")) return;
    try {
      const res = await fetch("/api/platform/customer/knowledge", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "刪除知識失敗");
      setKnowledgeSources((items) => items.filter((item) => item.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "刪除知識失敗");
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

          <div className="mt-4 p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 text-xs leading-relaxed">
            使用 Orai 管理員為你建立嘅 Supabase Auth 電郵及密碼登入。帳戶必須已綁定有效商戶權限。
          </div>

          {error && (
            <div className="mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="mt-6 space-y-4">
            <div>
              <label className="block text-xs font-bold text-[#52525B] uppercase mb-1.5" htmlFor="cust-email">
                登入電郵
              </label>
              <input
                id="cust-email"
                type="email"
                required
                placeholder="name@business.hk"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-[#E4E4E7] bg-[#FAFAFA] text-sm focus:outline-none focus:border-[#09090B]"
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
            <DashboardIcon name="overview" />
            <span>營業總覽 (Overview)</span>
          </button>

          <button
            type="button"
            onClick={() => setTab("calls")}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-bold transition-colors text-left ${
              tab === "calls" ? "bg-[#09090B] text-white" : "text-[#52525B] hover:bg-[#F4F4F5]"
            }`}
          >
            <DashboardIcon name="calls" />
            <span>通話紀錄 (Call History)</span>
          </button>

          <button
            type="button"
            onClick={() => setTab("appointments")}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-bold transition-colors text-left ${
              tab === "appointments" ? "bg-[#09090B] text-white" : "text-[#52525B] hover:bg-[#F4F4F5]"
            }`}
          >
            <DashboardIcon name="appointments" />
            <span>預約管理 (Appointments)</span>
          </button>

          <button
            type="button"
            onClick={() => setTab("knowledge")}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-bold transition-colors text-left ${
              tab === "knowledge" ? "bg-[#09090B] text-white" : "text-[#52525B] hover:bg-[#F4F4F5]"
            }`}
          >
            <DashboardIcon name="knowledge" />
            <span>知識庫及 FAQ</span>
          </button>

          <button
            type="button"
            onClick={() => setTab("profile")}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-bold transition-colors text-left ${
              tab === "profile" ? "bg-[#09090B] text-white" : "text-[#52525B] hover:bg-[#F4F4F5]"
            }`}
          >
            <DashboardIcon name="profile" />
            <span>商戶資料 (Business Profile)</span>
          </button>

          <button
            type="button"
            onClick={() => setTab("agent")}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-bold transition-colors text-left ${
              tab === "agent" ? "bg-[#09090B] text-white" : "text-[#52525B] hover:bg-[#F4F4F5]"
            }`}
          >
            <DashboardIcon name="agent" />
            <span>我的 AI 專員</span>
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
      <main className="flex-1 p-6 sm:p-10 max-w-6xl w-full">
        <div className="mb-7 flex items-center justify-between gap-4">
          <div className="font-bold text-base">Orai 客戶管理後台</div>
          <div className="flex items-center gap-3">
            <NotificationBell onOpenRequest={openManagedRequest} />
            <span className="rounded-full bg-sky-100 px-3 py-1 text-[11px] font-bold text-sky-700">商戶專屬</span>
          </div>
        </div>
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-3xl">
              <div className="p-5 rounded-2xl bg-white border border-[#E4E4E7] shadow-stripe-sm">
                <DashboardIcon name="calls" className="h-5 w-5 text-[#09090B]" />
                <div className="mt-2 text-3xl font-extrabold text-[#09090B]">
                  {overview?.monthlyConversations ?? "—"}
                </div>
                <div className="mt-1 text-xs text-[#71717A]">本月接待通話</div>
              </div>

              <div className="p-5 rounded-2xl bg-white border border-[#E4E4E7] shadow-stripe-sm">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 text-[#09090B]" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
                <div className="mt-2 text-3xl font-extrabold text-[#09090B]">
                  {overview?.totalCallMinutes ?? "—"}
                </div>
                <div className="mt-1 text-xs text-[#71717A]">本月通話分鐘</div>
              </div>

              <div className="p-5 rounded-2xl bg-white border border-[#E4E4E7] shadow-stripe-sm">
                <DashboardIcon name="appointments" className="h-5 w-5 text-[#09090B]" />
                <div className="mt-2 text-3xl font-extrabold text-[#09090B]">
                  {overview?.totalAppointments ?? "—"}
                </div>
                <div className="mt-1 text-xs text-[#71717A]">預約請求（{overview?.pendingAppointments ?? "—"} 項待確認）</div>
              </div>

              <div className="p-5 rounded-2xl bg-white border border-[#E4E4E7] shadow-stripe-sm">
                <DashboardIcon name="agent" className="h-5 w-5 text-[#09090B]" />
                <div className="mt-2 text-2xl font-extrabold text-[#09090B]">
                  {overview?.agentStatus === "active"
                    ? "已啟用"
                    : overview?.agentStatus === "inactive" ? "已暫停" : "尚待設定"}
                </div>
                <div className="mt-1 text-xs text-[#71717A] truncate">
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
                        <td className="p-4 max-w-xs text-[#52525B]">
                          {(() => {
                            const transcript = readOptionalTranscript(c);
                            const summaryExcerpt = c.summary.trim();
                            const legacyExcerpt = c.user_transcript.trim();
                            const firstTurnExcerpt =
                              transcript?.find((turn) => turn.message.trim())?.message.trim() ?? "";
                            const excerpt =
                              summaryExcerpt || legacyExcerpt || firstTurnExcerpt || "—";
                            return (
                              <details>
                                <summary className="cursor-pointer truncate">{excerpt}</summary>
                                <div className="mt-2 space-y-2 whitespace-normal break-words">
                                  {c.summary ? <p>{c.summary}</p> : null}
                                  {transcript ? (
                                    <ul className="space-y-1">
                                      {transcript.map((turn, index) => (
                                        <li key={`${c.id}-turn-${index}`}>
                                          {typeof turn.time_in_call_secs === "number"
                                            ? `[${turn.time_in_call_secs}s] ${turn.role}: ${turn.message}`
                                            : `${turn.role}: ${turn.message}`}
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <>
                                      {c.user_transcript ? <p>{c.user_transcript}</p> : null}
                                      {c.ai_reply ? <p>{c.ai_reply}</p> : null}
                                      {!c.summary && !c.user_transcript && !c.ai_reply ? <p>—</p> : null}
                                    </>
                                  )}
                                </div>
                              </details>
                            );
                          })()}
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
        {tab === "appointments" && (() => {
          const activeAppointments = appointments.filter((a) => a.status !== "completed");
          const completedAppointments = appointments.filter((a) => a.status === "completed");

          return (
            <div className="space-y-8">
              {/* SECTION A: 待處理 / 進行中預約 */}
              <div className="space-y-4">
                <header>
                  <h1 className="text-2xl font-extrabold tracking-tight">預約管理</h1>
                  <p className="text-xs text-[#52525B] mt-1">
                    查看網站提交的預約要求，確認或完成服務。完成後會自動移至下方「已完成記錄」。
                  </p>
                </header>

                {activeAppointments.length === 0 ? (
                  <div className="p-10 text-center rounded-2xl bg-white border border-[#E4E4E7]">
                    <p className="text-sm font-semibold text-[#52525B]">暫無待處理預約</p>
                    <p className="text-xs text-[#71717A] mt-1">新提交的預約要求會顯示喺呢度，由店員確認或安排。</p>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-[#E4E4E7] bg-white overflow-hidden shadow-stripe-sm">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-[#E4E4E7] bg-[#FAFAFA] font-bold text-[#52525B]">
                          <th className="p-4">顧客姓名</th>
                          <th className="p-4">聯絡電話</th>
                          <th className="p-4">預約項目</th>
                          <th className="p-4">希望到訪時間（香港）</th>
                          <th className="p-4">狀態</th>
                          <th className="p-4 text-right">更改狀態</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E4E4E7]">
                        {activeAppointments.map((a) => (
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
                                timeZone: "Asia/Hong_Kong",
                                month: "short",
                                day: "numeric",
                                weekday: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                              {a.preferred_time_window && <div className="mt-1 text-[11px]">偏好：{BEAUTY_WINDOWS[a.preferred_time_window].label}</div>}
                              {a.notes && <div className="mt-2 max-w-52 whitespace-pre-wrap text-[11px]">備註：{a.notes}</div>}
                            </td>
                            <td className="p-4">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                                  a.status === "confirmed"
                                    ? "bg-emerald-100 text-emerald-800"
                                    : a.status === "cancelled" || a.status === "rejected"
                                    ? "bg-rose-100 text-rose-700"
                                    : "bg-amber-100 text-amber-800"
                                }`}
                              >
                                {a.status === "pending"
                                  ? "待確認"
                                  : a.status === "confirmed"
                                  ? "已確認"
                                  : a.status === "rejected"
                                  ? "已拒絕"
                                  : "已取消"}
                              </span>
                            </td>
                            <td className="p-4 text-right space-x-1.5 whitespace-nowrap">
                              {a.status === "pending" && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleUpdateAppointmentStatus(a.id, "confirmed")}
                                    disabled={busy === `appointment_${a.id}`}
                                    className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold disabled:opacity-50 transition-colors"
                                  >
                                    確認
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleUpdateAppointmentStatus(a.id, "rejected")}
                                    disabled={busy === `appointment_${a.id}`}
                                    className="px-2.5 py-1.5 rounded-lg border border-rose-200 text-rose-700 text-[11px] font-bold hover:bg-rose-50 disabled:opacity-50 transition-colors"
                                  >
                                    拒絕
                                  </button>
                                </>
                              )}
                              {a.status === "confirmed" && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleUpdateAppointmentStatus(a.id, "completed")}
                                    disabled={busy === `appointment_${a.id}`}
                                    className="px-2.5 py-1.5 rounded-lg bg-[#09090B] hover:bg-[#27272A] text-white text-[11px] font-bold disabled:opacity-50 transition-colors"
                                  >
                                    完成
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleUpdateAppointmentStatus(a.id, "cancelled")}
                                    disabled={busy === `appointment_${a.id}`}
                                    className="px-2.5 py-1.5 rounded-lg border border-[#E4E4E7] text-rose-600 text-[11px] font-bold hover:bg-rose-50 disabled:opacity-50 transition-colors"
                                  >
                                    取消
                                  </button>
                                </>
                              )}
                              {(a.status === "rejected" || a.status === "cancelled") && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleUpdateAppointmentStatus(a.id, "confirmed")}
                                    disabled={busy === `appointment_${a.id}`}
                                    className="px-2.5 py-1.5 rounded-lg border border-emerald-600 text-emerald-700 text-[11px] font-bold hover:bg-emerald-50 disabled:opacity-50 transition-colors"
                                  >
                                    返回確認
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteAppointment(a.id)}
                                    disabled={busy === `appointment_delete_${a.id}`}
                                    className="px-2.5 py-1.5 rounded-lg border border-rose-200 text-rose-700 text-[11px] font-bold hover:bg-rose-50 disabled:opacity-50 transition-colors"
                                  >
                                    刪除
                                  </button>
                                </>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* SECTION B: 已完成記錄 */}
              <div className="space-y-4 pt-4 border-t border-[#E4E4E7]">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-extrabold tracking-tight">已完成記錄</h2>
                    <p className="text-xs text-[#52525B] mt-0.5">
                      已完成服務的預約存檔。如需修改時段或按錯完成，可點擊「返回確認」退回上方；亦可點擊「刪除」。
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-[#52525B] bg-slate-100 px-2.5 py-1 rounded-full">
                    共 {completedAppointments.length} 項
                  </span>
                </div>

                {completedAppointments.length === 0 ? (
                  <div className="p-8 text-center rounded-2xl bg-white border border-[#E4E4E7]">
                    <p className="text-xs text-[#71717A]">暫無已完成服務的記錄</p>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-[#E4E4E7] bg-white overflow-hidden shadow-stripe-sm">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-[#E4E4E7] bg-[#FAFAFA] font-bold text-[#52525B]">
                          <th className="p-4">顧客姓名</th>
                          <th className="p-4">聯絡電話</th>
                          <th className="p-4">服務項目</th>
                          <th className="p-4">到訪時間（香港）</th>
                          <th className="p-4">狀態</th>
                          <th className="p-4 text-right">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E4E4E7]">
                        {completedAppointments.map((a) => (
                          <tr key={a.id} className="hover:bg-[#FAFAFA]">
                            <td className="p-4 font-extrabold text-[#09090B]">{a.customer_name}</td>
                            <td className="p-4 font-mono font-medium text-[#52525B]">
                              <a href={`tel:${a.customer_phone}`} className="hover:underline">
                                {a.customer_phone}
                              </a>
                            </td>
                            <td className="p-4 font-semibold">{a.service_name || "護理項目"}</td>
                            <td className="p-4 whitespace-nowrap text-[#52525B]">
                              {new Date(a.appointment_time).toLocaleString("zh-HK", {
                                timeZone: "Asia/Hong_Kong",
                                month: "short",
                                day: "numeric",
                                weekday: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                              {a.preferred_time_window && <div className="mt-1 text-[11px]">偏好：{BEAUTY_WINDOWS[a.preferred_time_window].label}</div>}
                              {a.notes && <div className="mt-2 max-w-52 whitespace-pre-wrap text-[11px]">備註：{a.notes}</div>}
                            </td>
                            <td className="p-4">
                              <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700">
                                已服務
                              </span>
                            </td>
                            <td className="p-4 text-right space-x-1.5 whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => handleUpdateAppointmentStatus(a.id, "confirmed")}
                                disabled={busy === `appointment_${a.id}`}
                                className="px-2.5 py-1.5 rounded-lg border border-emerald-600 text-emerald-700 text-[11px] font-bold hover:bg-emerald-50 disabled:opacity-50 transition-colors"
                              >
                                返回確認
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteAppointment(a.id)}
                                disabled={busy === `appointment_delete_${a.id}`}
                                className="px-2.5 py-1.5 rounded-lg border border-rose-200 text-rose-700 text-[11px] font-bold hover:bg-rose-50 disabled:opacity-50 transition-colors"
                              >
                                刪除
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* KNOWLEDGE BASE TAB */}
        {tab === "knowledge" && (
          <div className="space-y-6">
            <header>
              <h1 className="text-2xl font-extrabold tracking-tight">知識庫及 FAQ</h1>
              <p className="mt-1 text-xs text-[#52525B]">管理商戶資料、服務資訊及常見問題，作為 AI 專員日後同步至 ElevenLabs 的知識來源。</p>
            </header>

            <form onSubmit={handleAddKnowledge} className="space-y-4 rounded-2xl border border-[#E4E4E7] bg-white p-5 shadow-stripe-sm">
              <div>
                <h2 className="font-extrabold text-sm">新增知識</h2>
                <p className="mt-1 text-[11px] text-[#71717A]">支援文字、FAQ 及 PDF 文件。</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
                <input
                  required maxLength={160} value={knowledgeTitle}
                  onChange={(event) => setKnowledgeTitle(event.target.value)}
                  placeholder="標題，例如：面部護理服務及價目"
                  className="w-full rounded-xl border border-[#E4E4E7] px-4 py-2.5 text-sm focus:border-[#09090B] focus:outline-none"
                />
                <select value={knowledgeType} onChange={(event) => setKnowledgeType(event.target.value as SourceType)} className="rounded-xl border border-[#E4E4E7] bg-white px-3 py-2.5 text-sm">
                  <option value="faq">常見問題 FAQ</option>
                  <option value="note">一般文字資料</option>
                </select>
              </div>
                <textarea
                required maxLength={200000} rows={5} value={knowledgeContent}
                onChange={(event) => setKnowledgeContent(event.target.value)}
                placeholder="輸入服務詳情、價錢、預約規則或問答內容…"
                className="w-full resize-y rounded-xl border border-[#E4E4E7] px-4 py-3 text-sm leading-relaxed focus:border-[#09090B] focus:outline-none"
              />
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] text-[#71717A]">最多 200,000 字元</span>
                <button type="submit" disabled={busy === "knowledge_add"} className="rounded-xl bg-[#09090B] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#27272A] disabled:opacity-50">
                  {busy === "knowledge_add" ? "儲存中…" : "新增至知識庫"}
                </button>
              </div>
            </form>

            <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-[#D4D4D8] bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <DashboardIcon name="knowledge" className="mt-0.5 h-5 w-5 shrink-0 text-[#52525B]" />
                <div>
                  <h2 className="text-sm font-extrabold">上載 PDF 文件</h2>
                  <p className="mt-1 text-[11px] text-[#71717A]">系統會抽取 PDF 文字並加入知識庫；每個檔案最多 10 MB。</p>
                </div>
              </div>
              <label className={`inline-flex cursor-pointer items-center justify-center rounded-xl border border-[#E4E4E7] px-4 py-2.5 text-xs font-bold hover:bg-[#FAFAFA] ${busy === "knowledge_upload" ? "pointer-events-none opacity-50" : ""}`}>
                {busy === "knowledge_upload" ? "正在抽取 PDF…" : "選擇 PDF 上載"}
                <input type="file" accept="application/pdf,.pdf" className="sr-only" disabled={busy === "knowledge_upload"} onChange={handleUploadPdf} />
              </label>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-extrabold text-sm">已儲存內容</h2>
                <span className="text-[11px] text-[#71717A]">{knowledgeSources.length} 項</span>
              </div>
              {knowledgeSources.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[#D4D4D8] bg-white p-10 text-center">
                  <DashboardIcon name="knowledge" className="mx-auto h-8 w-8 text-[#A1A1AA]" />
                  <p className="mt-3 text-sm font-semibold text-[#52525B]">知識庫暫時未有內容</p>
                  <p className="mt-1 text-xs text-[#71717A]">新增 FAQ 或商戶資料，方便日後接駁 AI 專員。</p>
                </div>
              ) : knowledgeSources.map((source) => (
                <article key={source.id} className={`rounded-2xl border bg-white p-5 shadow-stripe-sm ${source.is_active ? "border-[#E4E4E7]" : "border-dashed border-[#D4D4D8] opacity-70"}`}>
                  {editingKnowledge?.id === source.id ? (
                    <div className="space-y-3">
                      <input value={editingKnowledge.title} onChange={(event) => setEditingKnowledge({ ...editingKnowledge, title: event.target.value })} className="w-full rounded-lg border border-[#E4E4E7] px-3 py-2 text-sm" />
                      <textarea rows={6} maxLength={200000} value={editingKnowledge.content} onChange={(event) => setEditingKnowledge({ ...editingKnowledge, content: event.target.value })} className="w-full rounded-lg border border-[#E4E4E7] px-3 py-2 text-sm leading-relaxed" />
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => setEditingKnowledge(null)} className="rounded-lg border border-[#E4E4E7] px-3 py-2 text-xs font-semibold">取消</button>
                        <button type="button" onClick={handleSaveKnowledge} disabled={busy === "knowledge_save"} className="rounded-lg bg-[#09090B] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{busy === "knowledge_save" ? "儲存中…" : "儲存修改"}</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-bold text-sm">{source.title}</h3>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-[#52525B]">{source.source_type === "faq" ? "FAQ" : "文字資料"}</span>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${source.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{source.is_active ? "啟用" : "已停用"}</span>
                          </div>
                          <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-[#52525B]">{source.content.length > 700 ? `${source.content.slice(0, 700)}…` : source.content}</p>
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-[#F4F4F5] pt-3">
                        <button type="button" onClick={() => handleToggleKnowledge(source)} className="rounded-lg border border-[#E4E4E7] px-3 py-2 text-[11px] font-semibold">{source.is_active ? "停用" : "重新啟用"}</button>
                        <button type="button" onClick={() => setEditingKnowledge({ id: source.id, title: source.title, content: source.content })} className="rounded-lg border border-[#E4E4E7] px-3 py-2 text-[11px] font-semibold">編輯</button>
                        <button type="button" onClick={() => handleDeleteKnowledge(source.id)} className="rounded-lg border border-rose-200 px-3 py-2 text-[11px] font-semibold text-rose-700">刪除</button>
                      </div>
                    </>
                  )}
                </article>
              ))}
            </div>
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

        {tab === "agent" && (
          <CustomerAgentPanel
            initialRequestId={focusRequestId}
            onRequestHandled={clearFocusRequest}
          />
        )}
      </main>
    </div>
  );
}
