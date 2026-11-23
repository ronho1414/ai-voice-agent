"use client";

import { useEffect, useState, useCallback, type FormEvent } from "react";
import type { Organization, SuperAdminOverview } from "@/lib/platform/types";

type OrgWithAgent = Organization & {
  agent: {
    id: string;
    elevenlabs_agent_id: string;
    name: string;
    status: string;
    language_mode: string;
  } | null;
};

type UsageSummaryRow = {
  id: string;
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  billing_period: string;
  call_minutes: number;
  conversation_count: number;
  recorded_at: string;
};

const INDUSTRY_NAMES: Record<string, string> = {
  beauty_salon: "美容院 / 美甲店",
  nail_studio: "美甲美睫工作室",
  clinic: "醫療診所",
  property: "地產代理",
  retail: "零售電商",
  other: "其他企業",
};

export function OraiAdminDashboard() {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [tab, setTab] = useState<"overview" | "customers" | "agents" | "usage" | "system">("overview");
  const [overview, setOverview] = useState<SuperAdminOverview | null>(null);
  const [organizations, setOrganizations] = useState<OrgWithAgent[]>([]);
  const [usageList, setUsageList] = useState<UsageSummaryRow[]>([]);
  const [usageSummary, setUsageSummary] = useState({ totalMinutes: 0, totalConversations: 0 });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Create Business Form State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newIndustry, setNewIndustry] = useState<Organization["industry"]>("beauty_salon");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newAgentId, setNewAgentId] = useState("");

  // Edit Agent ID Modal
  const [editingOrg, setEditingOrg] = useState<OrgWithAgent | null>(null);
  const [editAgentId, setEditAgentId] = useState("");

  // Check auth on mount
  useEffect(() => {
    fetch("/api/platform/auth/session", { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json();
        if (body.authenticated && body.session?.role === "super_admin") {
          setAuthenticated(true);
        }
      })
      .catch(() => setError("無法連線至身份驗證伺服器"))
      .finally(() => setReady(true));
  }, []);

  const loadData = useCallback(async () => {
    setError("");
    try {
      if (tab === "overview" || tab === "system") {
        const res = await fetch("/api/platform/admin/overview", { cache: "no-store" });
        if (!res.ok) throw new Error("無法載入資料，請稍後重試；目前顯示並非最新數據。");
        if (res.ok) setOverview(await res.json());
      }
      if (tab === "customers" || tab === "agents") {
        const res = await fetch("/api/platform/admin/organizations", { cache: "no-store" });
        if (!res.ok) throw new Error("無法載入資料，請稍後重試；目前顯示並非最新數據。");
        if (res.ok) {
          const body = await res.json();
          setOrganizations(body.organizations || []);
        }
      }
      if (tab === "usage") {
        const res = await fetch("/api/platform/admin/usage", { cache: "no-store" });
        if (!res.ok) throw new Error("無法載入資料，請稍後重試；目前顯示並非最新數據。");
        if (res.ok) {
          const body = await res.json();
          setUsageList(body.usage || []);
          setUsageSummary(body.summary || { totalMinutes: 0, totalConversations: 0 });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "載入數據失敗");
    }
  }, [tab]);

  useEffect(() => {
    if (authenticated) {
      void loadData();
    }
  }, [authenticated, tab, loadData]);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setBusy("login");
    setError("");
    try {
      const res = await fetch("/api/platform/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "super_admin", email, password }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "密碼錯誤");
      setPassword("");
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

  async function handleCreateOrg(e: FormEvent) {
    e.preventDefault();
    setBusy("create_org");
    setError("");
    setSuccessMsg("");
    try {
      const res = await fetch("/api/platform/admin/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName,
          slug: newSlug,
          industry: newIndustry,
          phone: newPhone,
          email: newEmail,
          address: newAddress,
          elevenlabsAgentId: newAgentId,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "建立商戶失敗");

      setShowCreateModal(false);
      setNewName("");
      setNewSlug("");
      setNewPhone("");
      setNewEmail("");
      setNewAddress("");
      setNewAgentId("");
      setSuccessMsg(`成功建立商戶「${body.organization.name}」！`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "建立商戶失敗");
    } finally {
      setBusy("");
    }
  }

  async function handleToggleStatus(org: OrgWithAgent) {
    const nextStatus = org.status === "active" ? "inactive" : "active";
    try {
      const res = await fetch("/api/platform/admin/organizations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: org.id, status: nextStatus }),
      });
      if (!res.ok) throw new Error("更新狀態失敗");
      setOrganizations((prev) =>
        prev.map((o) => (o.id === org.id ? { ...o, status: nextStatus } : o))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失敗");
    }
  }

  async function handleSaveAgent(e: FormEvent) {
    e.preventDefault();
    if (!editingOrg) return;
    setBusy("save_agent");
    setError("");
    try {
      const res = await fetch("/api/platform/admin/organizations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingOrg.id,
          elevenlabsAgentId: editAgentId,
        }),
      });
      if (!res.ok) throw new Error("更新 Agent ID 失敗");
      setEditingOrg(null);
      setSuccessMsg("已更新 ElevenLabs Agent 設定！");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新失敗");
    } finally {
      setBusy("");
    }
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F4F4F5] text-[#52525B]">
        載入中…
      </div>
    );
  }

  // Login view
  if (!authenticated) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#F4F4F5] p-4 text-[#09090B]">
        <div className="w-full max-w-md bg-white border border-[#E4E4E7] rounded-3xl p-8 shadow-stripe-md">
          <div className="flex items-center gap-2 mb-6">
            <span className="w-8 h-8 rounded-lg bg-[#09090B] text-white flex items-center justify-center font-extrabold text-sm">
              O
            </span>
            <span className="font-extrabold text-lg tracking-tight">Orai Service</span>
          </div>

          <h1 className="text-2xl font-extrabold tracking-tight">Orai 管理員總後台</h1>
          <p className="mt-1.5 text-xs text-[#52525B]">
            管理香港本地企業商戶、語音專員配置及全平台用量。
          </p>

          {error && (
            <div className="mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="mt-6 space-y-4">
            <div>
              <label htmlFor="admin-email" className="mb-1.5 block text-xs font-bold text-[#52525B]">管理員電郵</label>
              <input id="admin-email" type="email" autoComplete="username" required value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder="name@oraiservice.com"
                className="w-full px-4 py-3 rounded-xl border border-[#E4E4E7] bg-[#FAFAFA] text-sm focus:outline-none focus:border-[#09090B]" />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#52525B] uppercase mb-1.5" htmlFor="admin-pass">
                總管理員密碼
              </label>
              <input
                id="admin-pass"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="請輸入 Supabase 帳戶密碼"
                autoComplete="current-password"
                className="w-full px-4 py-3 rounded-xl border border-[#E4E4E7] bg-[#FAFAFA] text-sm focus:outline-none focus:border-[#09090B]"
              />
            </div>
            <button
              type="submit"
              disabled={busy === "login"}
              className="w-full py-3 rounded-xl bg-[#09090B] hover:bg-[#27272A] text-white font-bold text-sm transition-colors disabled:opacity-50"
            >
              {busy === "login" ? "驗證中…" : "進入 Orai 總後台"}
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-[#E4E4E7] text-center">
            <a href="/dashboard" className="text-xs font-semibold text-[#52525B] hover:underline">
              切換至客戶商戶儀表板（Customer Portal）→
            </a>
          </div>
        </div>
      </main>
    );
  }

  // Authenticated Dashboard view
  return (
    <div className="min-h-screen bg-[#FAFAFA] flex flex-col md:flex-row text-[#09090B]">
      {/* Sidebar */}
      <aside className="w-full md:w-64 bg-white border-r border-[#E4E4E7] flex flex-col shrink-0">
        <div className="p-6 border-b border-[#E4E4E7] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg bg-[#09090B] text-white flex items-center justify-center font-extrabold text-sm">
              O
            </span>
            <div>
              <div className="font-extrabold text-base tracking-tight leading-none">Orai Service</div>
              <div className="text-[11px] font-semibold text-[#71717A] mt-0.5">Admin Platform</div>
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
            <span>總覽 (Overview)</span>
          </button>

          <button
            type="button"
            onClick={() => setTab("customers")}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-bold transition-colors text-left ${
              tab === "customers" ? "bg-[#09090B] text-white" : "text-[#52525B] hover:bg-[#F4F4F5]"
            }`}
          >
            <span>企業商戶 (Customers)</span>
          </button>

          <button
            type="button"
            onClick={() => setTab("agents")}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-bold transition-colors text-left ${
              tab === "agents" ? "bg-[#09090B] text-white" : "text-[#52525B] hover:bg-[#F4F4F5]"
            }`}
          >
            <span>Agent 管理 (Agents)</span>
          </button>

          <button
            type="button"
            onClick={() => setTab("usage")}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-bold transition-colors text-left ${
              tab === "usage" ? "bg-[#09090B] text-white" : "text-[#52525B] hover:bg-[#F4F4F5]"
            }`}
          >
            <span>用量監控 (Usage)</span>
          </button>

          <button
            type="button"
            onClick={() => setTab("system")}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-bold transition-colors text-left ${
              tab === "system" ? "bg-[#09090B] text-white" : "text-[#52525B] hover:bg-[#F4F4F5]"
            }`}
          >
            <span>系統狀態 (System Status)</span>
          </button>
        </nav>

        <div className="p-4 border-t border-[#E4E4E7] space-y-2">
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            className="block text-center text-xs font-semibold text-[#52525B] hover:text-[#09090B] py-1.5"
          >
            瀏覽公開官網 ↗
          </a>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full py-2 rounded-xl border border-[#E4E4E7] bg-white text-xs font-bold text-[#52525B] hover:bg-slate-50 transition-colors"
          >
            安全登出
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-6 sm:p-10 max-w-6xl">
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
            <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">營運與平台總覽</h1>
                <p className="text-xs text-[#52525B] mt-1">
                  全平台跨商戶 AI 語音接待專員運行狀態、用量統計與商戶數目。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="px-4 py-2.5 rounded-xl bg-[#09090B] text-white text-xs font-bold hover:bg-[#27272A] transition-colors"
              >
                + 新增企業商戶
              </button>
            </header>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-5 rounded-2xl bg-white border border-[#E4E4E7] shadow-stripe-sm">
                <div className="text-xs font-bold text-[#52525B] uppercase">總商戶數</div>
                <div className="mt-2 text-3xl font-extrabold text-[#09090B]">
                  {overview?.totalCustomers ?? "—"}
                </div>
                <div className="mt-1 text-[11px] text-[#71717A]">
                  活躍商戶：{overview?.activeCustomers ?? "—"} 家
                </div>
              </div>

              <div className="p-5 rounded-2xl bg-white border border-[#E4E4E7] shadow-stripe-sm">
                <div className="text-xs font-bold text-[#52525B] uppercase">活躍專員</div>
                <div className="mt-2 text-3xl font-extrabold text-emerald-600">
                  {overview?.activeCustomers ?? "—"}
                </div>
                <div className="mt-1 text-[11px] text-[#71717A]">全天候在線運作</div>
              </div>

              <div className="p-5 rounded-2xl bg-white border border-[#E4E4E7] shadow-stripe-sm">
                <div className="text-xs font-bold text-[#52525B] uppercase">累計對話次數</div>
                <div className="mt-2 text-3xl font-extrabold text-[#09090B]">
                  {overview?.totalConversations ?? "—"}
                </div>
                <div className="mt-1 text-[11px] text-[#71717A]">網頁與電話諮詢</div>
              </div>

              <div className="p-5 rounded-2xl bg-white border border-[#E4E4E7] shadow-stripe-sm">
                <div className="text-xs font-bold text-[#52525B] uppercase">通話時長 (分鐘)</div>
                <div className="mt-2 text-3xl font-extrabold text-[#09090B]">
                  {overview?.totalUsageMinutes ?? "—"}
                </div>
                <div className="mt-1 text-[11px] text-[#71717A]">計費用量統計</div>
              </div>
            </div>

            <div className="p-6 rounded-2xl bg-white border border-[#E4E4E7] shadow-stripe-sm">
              <h2 className="text-base font-extrabold mb-3">服務快速指引</h2>
              <div className="space-y-2 text-xs text-[#52525B] leading-relaxed">
                <p>• <strong>新增商戶：</strong> 在「企業商戶」中輸入商戶全名、網址代稱 (Slug) 及行業類別（如美容院、美甲店、診所）。</p>
                <p>• <strong>配置語音：</strong> 在「Agent 管理」中綁定該商戶專屬的 ElevenLabs Agent ID，前端語音元件將自動加載。</p>
                <p>• <strong>客戶登入：</strong> 商戶管理員在 <code>/dashboard</code> 使用電郵及密碼登入，帳戶必須具有有效商戶管理權限。</p>
              </div>
            </div>
          </div>
        )}

        {/* 2. CUSTOMERS TAB */}
        {tab === "customers" && (
          <div className="space-y-6">
            <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-extrabold tracking-tight">企業商戶名單</h1>
                <p className="text-xs text-[#52525B] mt-1">管理各香港企業客戶基本資料、行業分類與帳戶狀態。</p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="px-4 py-2.5 rounded-xl bg-[#09090B] text-white text-xs font-bold hover:bg-[#27272A] transition-colors"
              >
                + 新增商戶
              </button>
            </header>

            {organizations.length === 0 ? (
              <div className="p-12 text-center rounded-2xl bg-white border border-[#E4E4E7]">
                <p className="text-sm font-semibold text-[#52525B]">暫時未有商戶資料</p>
                <p className="text-xs text-[#71717A] mt-1">點擊上方「+ 新增商戶」即可建立第一間香港本地企業客戶。</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-[#E4E4E7] bg-white overflow-hidden shadow-stripe-sm">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#E4E4E7] bg-[#FAFAFA] font-bold text-[#52525B]">
                      <th className="p-4">商戶名稱 / 代稱</th>
                      <th className="p-4">行業類別</th>
                      <th className="p-4">聯絡電話 / 電郵</th>
                      <th className="p-4">AI 語音專員</th>
                      <th className="p-4">帳戶狀態</th>
                      <th className="p-4 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E4E4E7]">
                    {organizations.map((org) => (
                      <tr key={org.id} className="hover:bg-[#FAFAFA] transition-colors">
                        <td className="p-4">
                          <div className="font-extrabold text-sm text-[#09090B]">{org.name}</div>
                          <div className="text-[11px] text-[#71717A] font-mono mt-0.5">{org.slug}</div>
                        </td>
                        <td className="p-4 text-[#52525B] font-medium">
                          {INDUSTRY_NAMES[org.industry] || org.industry}
                        </td>
                        <td className="p-4 text-[#52525B]">
                          <div>{org.phone || "—"}</div>
                          <div className="text-[11px] text-[#71717A]">{org.email || "—"}</div>
                        </td>
                        <td className="p-4">
                          {org.agent?.elevenlabs_agent_id ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[11px] font-bold">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                              已配置 Agent
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[11px] font-medium">
                              未綁定
                            </span>
                          )}
                        </td>
                        <td className="p-4">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-extrabold ${
                              org.status === "active"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-slate-200 text-slate-700"
                            }`}
                          >
                            {org.status === "active" ? "正常運作" : "已暫停"}
                          </span>
                        </td>
                        <td className="p-4 text-right space-x-2">
                          <button
                            type="button"
                            onClick={() => handleToggleStatus(org)}
                            className="px-2.5 py-1 rounded-lg border border-[#E4E4E7] text-xs font-semibold hover:bg-slate-50"
                          >
                            {org.status === "active" ? "暫停" : "啟用"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingOrg(org);
                              setEditAgentId(org.agent?.elevenlabs_agent_id || "");
                            }}
                            className="px-2.5 py-1 rounded-lg bg-[#09090B] text-white text-xs font-semibold hover:bg-[#27272A]"
                          >
                            設定 Agent
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* 3. AGENT MANAGEMENT TAB */}
        {tab === "agents" && (
          <div className="space-y-6">
            <header>
              <h1 className="text-2xl font-extrabold tracking-tight">ElevenLabs Agent 配置中心</h1>
              <p className="text-xs text-[#52525B] mt-1">
                為每間企業商戶安全指派專屬語音專員 Agent ID。系統僅在伺服器端調用憑證，絕不暴露密鑰至前端。
              </p>
            </header>

            <div className="grid gap-4">
              {organizations.map((org) => (
                <div
                  key={org.id}
                  className="p-5 rounded-2xl bg-white border border-[#E4E4E7] shadow-stripe-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-extrabold text-base text-[#09090B]">{org.name}</h3>
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-100 text-[#52525B]">
                        {org.slug}
                      </span>
                    </div>
                    <div className="mt-2 text-xs text-[#52525B] space-y-1">
                      <div>
                        Agent ID：
                        <code className="bg-slate-100 px-1.5 py-0.5 rounded font-mono text-[11px] text-[#09090B]">
                          {org.agent?.elevenlabs_agent_id || "未設定 (請點擊右側設定)"}
                        </code>
                      </div>
                      <div>語言模式：三語即時辨識（廣東話、英語、普通話）</div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setEditingOrg(org);
                      setEditAgentId(org.agent?.elevenlabs_agent_id || "");
                    }}
                    className="px-4 py-2 rounded-xl bg-[#09090B] hover:bg-[#27272A] text-white text-xs font-bold transition-colors shrink-0"
                  >
                    編輯 Agent 參數
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 4. USAGE TAB */}
        {tab === "usage" && (
          <div className="space-y-6">
            <header>
              <h1 className="text-2xl font-extrabold tracking-tight">各商戶用量監控</h1>
              <p className="text-xs text-[#52525B] mt-1">按商戶檢視語音通話分鐘數與對話次數。</p>
            </header>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-5 rounded-2xl bg-white border border-[#E4E4E7]">
                <div className="text-xs font-bold text-[#52525B] uppercase">總累計通話時長</div>
                <div className="mt-1 text-2xl font-extrabold text-[#09090B]">{usageSummary.totalMinutes} 分鐘</div>
              </div>
              <div className="p-5 rounded-2xl bg-white border border-[#E4E4E7]">
                <div className="text-xs font-bold text-[#52525B] uppercase">總處理對話數</div>
                <div className="mt-1 text-2xl font-extrabold text-[#09090B]">{usageSummary.totalConversations} 次</div>
              </div>
            </div>

            {usageList.length === 0 ? (
              <div className="p-12 text-center rounded-2xl bg-white border border-[#E4E4E7]">
                <p className="text-sm font-semibold text-[#52525B]">暫未有用量紀錄</p>
                <p className="text-xs text-[#71717A] mt-1">當商戶網站有訪客進行語音對答時，系統將自動按月份累計分鐘數。</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-[#E4E4E7] bg-white overflow-hidden shadow-stripe-sm">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#E4E4E7] bg-[#FAFAFA] font-bold text-[#52525B]">
                      <th className="p-4">商戶</th>
                      <th className="p-4">帳單月份</th>
                      <th className="p-4">通話時長 (分鐘)</th>
                      <th className="p-4">對話次數</th>
                      <th className="p-4">最後更新</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E4E4E7]">
                    {usageList.map((row) => (
                      <tr key={row.id}>
                        <td className="p-4 font-bold">{row.organization_name}</td>
                        <td className="p-4">{row.billing_period}</td>
                        <td className="p-4 font-bold">{row.call_minutes}</td>
                        <td className="p-4">{row.conversation_count}</td>
                        <td className="p-4 text-[#71717A]">{new Date(row.recorded_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* 5. SYSTEM STATUS TAB */}
        {tab === "system" && (
          <div className="space-y-6">
            <header>
              <h1 className="text-2xl font-extrabold tracking-tight">系統運行與串接狀態</h1>
              <p className="text-xs text-[#52525B] mt-1">檢查核心模組運作指標與基礎設施連線。</p>
            </header>

            <div className="grid sm:grid-cols-3 gap-4">
              <div className="p-5 rounded-2xl bg-white border border-[#E4E4E7] shadow-stripe-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#52525B] uppercase">資料庫連線</span>
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                </div>
                <div className="mt-3 font-extrabold text-base">
                  {overview?.systemStatus.database === "connected_supabase"
                    ? "Supabase 雲端資料庫"
                    : "本地持久化檔案 (Local Store)"}
                </div>
                <div className="mt-1 text-xs text-[#71717A]">
                  {overview?.systemStatus.database === "connected_supabase"
                    ? "使用 Supabase 專案資料庫"
                    : "使用本機開發資料；尚未連接 Supabase"}
                </div>
              </div>

              <div className="p-5 rounded-2xl bg-white border border-[#E4E4E7] shadow-stripe-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#52525B] uppercase">ElevenLabs API</span>
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      overview?.systemStatus.elevenlabsApi ? "bg-emerald-500" : "bg-amber-500"
                    }`}
                  ></span>
                </div>
                <div className="mt-3 font-extrabold text-base">
                  {overview?.systemStatus.elevenlabsApi ? "已設定環境金鑰" : "未設定 API Key"}
                </div>
                <div className="mt-1 text-xs text-[#71717A]">支援動態 Agent ID 注入與串流中繼</div>
              </div>

              <div className="p-5 rounded-2xl bg-white border border-[#E4E4E7] shadow-stripe-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#52525B] uppercase">檔案存儲空間</span>
                  <span className={`w-2.5 h-2.5 rounded-full ${overview?.systemStatus.storage ? "bg-emerald-500" : "bg-amber-500"}`}></span>
                </div>
                <div className="mt-3 font-extrabold text-base">
                  {overview?.systemStatus.storage ? "已連接檔案儲存" : "未設定檔案儲存"}
                </div>
                <div className="mt-1 text-xs text-[#71717A]">檔案上載目前使用應用程式本機儲存流程</div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* CREATE BUSINESS MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 border border-[#E4E4E7] shadow-stripe-xl">
            <h2 className="text-lg font-extrabold">新增企業商戶</h2>
            <p className="text-xs text-[#52525B] mt-1">為香港本地企業建立專屬多租戶帳戶。</p>

            <form onSubmit={handleCreateOrg} className="mt-5 space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-[#52525B] mb-1">商戶名稱 *</label>
                <input
                  type="text"
                  required
                  placeholder="例如：GLOW 尖沙咀旗艦美容院"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4E4E7] text-xs focus:outline-none focus:border-[#09090B]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#52525B] mb-1">代稱 Slug (英數字) *</label>
                  <input
                    type="text"
                    required
                    placeholder="glow-beauty"
                    value={newSlug}
                    onChange={(e) => setNewSlug(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4E4E7] text-xs font-mono focus:outline-none focus:border-[#09090B]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#52525B] mb-1">行業類別</label>
                  <select
                    value={newIndustry}
                    onChange={(e) => setNewIndustry(e.target.value as Organization["industry"])}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4E4E7] text-xs focus:outline-none focus:border-[#09090B]"
                  >
                    <option value="beauty_salon">美容院 / 美甲店</option>
                    <option value="nail_studio">美甲美睫工作室</option>
                    <option value="clinic">醫療診所</option>
                    <option value="property">地產代理</option>
                    <option value="retail">零售電商</option>
                    <option value="other">其他行業</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#52525B] mb-1">聯絡電話</label>
                  <input
                    type="text"
                    placeholder="+852 9876 5432"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4E4E7] text-xs focus:outline-none focus:border-[#09090B]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#52525B] mb-1">聯絡電郵</label>
                  <input
                    type="email"
                    placeholder="contact@glow.hk"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4E4E7] text-xs focus:outline-none focus:border-[#09090B]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#52525B] mb-1">營業地址</label>
                <input
                  type="text"
                  placeholder="香港尖沙咀廣東道海港城對面"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4E4E7] text-xs focus:outline-none focus:border-[#09090B]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#52525B] mb-1">ElevenLabs Agent ID (可稍後補上)</label>
                <input
                  type="text"
                  placeholder="agent_xxxxxxxxxxxxxxxx"
                  value={newAgentId}
                  onChange={(e) => setNewAgentId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4E4E7] text-xs font-mono focus:outline-none focus:border-[#09090B]"
                />
              </div>

              <div className="pt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl border border-[#E4E4E7] text-xs font-bold text-[#52525B]"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={busy === "create_org"}
                  className="px-4 py-2 rounded-xl bg-[#09090B] text-white text-xs font-bold hover:bg-[#27272A]"
                >
                  {busy === "create_org" ? "建立中…" : "確認建立"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT AGENT ID MODAL */}
      {editingOrg && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 border border-[#E4E4E7] shadow-stripe-xl">
            <h2 className="text-base font-extrabold">設定語音專員 Agent ID</h2>
            <p className="text-xs text-[#52525B] mt-1">商戶：{editingOrg.name}</p>

            <form onSubmit={handleSaveAgent} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#52525B] mb-1">
                  ElevenLabs Conversational Agent ID
                </label>
                <input
                  type="text"
                  required
                  placeholder="agent_xxxxxxxxxxxxxxxx"
                  value={editAgentId}
                  onChange={(e) => setEditAgentId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-[#E4E4E7] text-xs font-mono focus:outline-none focus:border-[#09090B]"
                />
                <p className="text-[11px] text-[#71717A] mt-1">
                  前往 ElevenLabs 控制台複製 Agent ID。
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingOrg(null)}
                  className="px-4 py-2 rounded-xl border border-[#E4E4E7] text-xs font-bold text-[#52525B]"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={busy === "save_agent"}
                  className="px-4 py-2 rounded-xl bg-[#09090B] text-white text-xs font-bold hover:bg-[#27272A]"
                >
                  {busy === "save_agent" ? "儲存中…" : "儲存設定"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
