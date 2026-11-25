"use client";

import { useCallback, useEffect, useState, type DragEvent, type FormEvent } from "react";
import { createEmbedSnippet as embedSnippet } from "@/lib/site";

type DocumentItem = {
  id: string;
  file_name: string;
  file_size: number;
  page_count: number;
  char_count: number;
  is_active: boolean;
  created_at: string;
};

type NoteItem = {
  id: string;
  body: string;
  is_active: boolean;
  created_at: string;
};

type LogItem = {
  id: string;
  current_page: string;
  user_transcript: string;
  detected_intent: string;
  ai_reply: string;
  is_high_intent: boolean;
  created_at: string;
};

type Summary = {
  total: number;
  highIntent: number;
  topPage: string | null;
};

type ClientItem = {
  id: string;
  client_slug: string;
  client_name: string;
  elevenlabs_agent_id: string;
  route_map: Record<string, string>;
  is_active: boolean;
  created_at: string;
};

type RouteRow = { page: string; url: string };

function rowsFromMap(map: Record<string, string>): RouteRow[] {
  const rows = Object.entries(map).map(([page, url]) => ({ page, url }));
  return rows.length > 0 ? rows : [{ page: "", url: "" }];
}

const PAGE_LABEL: Record<string, string> = {
  home: "首頁",
  advantages: "核心優勢",
  pricing: "收費方案",
  about: "關於我們",
};

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error || "Request failed";
  } catch {
    return "Request failed";
  }
}

export function AdminConsole() {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [password, setPassword] = useState("");
  const [tab, setTab] = useState<"knowledge" | "logs" | "embed">("knowledge");
  const [mode, setMode] = useState<"supabase" | "local" | "">("");
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [summary, setSummary] = useState<Summary>({ total: 0, highIntent: 0, topPage: null });
  const [highIntentOnly, setHighIntentOnly] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [clientName, setClientName] = useState("");
  const [clientSlug, setClientSlug] = useState("");
  const [agentId, setAgentId] = useState("");
  const [routeRows, setRouteRows] = useState<RouteRow[]>([{ page: "", url: "" }]);
  const [savedSlug, setSavedSlug] = useState("");
  const [copiedSlug, setCopiedSlug] = useState("");

  const loadDocuments = useCallback(async () => {
    const [documentsResponse, notesResponse] = await Promise.all([
      fetch("/api/admin/documents", { cache: "no-store" }),
      fetch("/api/admin/notes", { cache: "no-store" }),
    ]);
    if (documentsResponse.status === 401 || notesResponse.status === 401) {
      setAuthenticated(false);
      return;
    }
    if (!documentsResponse.ok) throw new Error(await readError(documentsResponse));
    if (!notesResponse.ok) throw new Error(await readError(notesResponse));
    const documentsBody = (await documentsResponse.json()) as {
      mode: "supabase" | "local";
      documents: DocumentItem[];
    };
    const notesBody = (await notesResponse.json()) as { mode: "supabase" | "local"; notes: NoteItem[] };
    setMode(documentsBody.mode === "local" || notesBody.mode === "local" ? "local" : documentsBody.mode);
    setDocuments(documentsBody.documents);
    setNotes(notesBody.notes);
  }, []);

  const loadClients = useCallback(async () => {
    const response = await fetch("/api/admin/clients", { cache: "no-store" });
    if (response.status === 401) {
      setAuthenticated(false);
      return;
    }
    if (!response.ok) throw new Error(await readError(response));
    const body = (await response.json()) as { mode: "supabase" | "local"; clients: ClientItem[] };
    setMode(body.mode);
    setClients(body.clients);
  }, []);

  const loadLogs = useCallback(async (highIntent: boolean) => {
    const response = await fetch(`/api/admin/logs?highIntent=${highIntent ? "1" : "0"}`, { cache: "no-store" });
    if (response.status === 401) {
      setAuthenticated(false);
      return;
    }
    if (!response.ok) throw new Error(await readError(response));
    const body = (await response.json()) as { mode: "supabase" | "local"; summary: Summary; logs: LogItem[] };
    setMode(body.mode);
    setSummary(body.summary);
    setLogs(body.logs);
  }, []);

  useEffect(() => {
    void fetch("/api/admin/session", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as { authenticated?: boolean; configured?: boolean };
        setConfigured(body.configured !== false);
        setAuthenticated(Boolean(body.authenticated));
      })
      .catch(() => setError("暫時連唔上管理介面"))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    setError("");
    const job =
      tab === "knowledge" ? loadDocuments() : tab === "logs" ? loadLogs(highIntentOnly) : loadClients();
    void job.catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Request failed"));
  }, [authenticated, tab, highIntentOnly, loadDocuments, loadLogs, loadClients]);

  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy("login");
    setError("");
    try {
      const response = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) throw new Error(await readError(response));
      setPassword("");
      setAuthenticated(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Request failed");
    } finally {
      setBusy("");
    }
  }

  async function logout() {
    await fetch("/api/admin/session", { method: "DELETE" });
    setAuthenticated(false);
    setDocuments([]);
    setNotes([]);
    setLogs([]);
  }

  async function saveNote(event: FormEvent) {
    event.preventDefault();
    const text = noteDraft.trim();
    if (!text) return;
    setBusy("note");
    setError("");
    try {
      const response = await fetch("/api/admin/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, siteId: "voicepilot-hq" }),
      });
      if (!response.ok) throw new Error(await readError(response));
      setNoteDraft("");
      await loadDocuments();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Request failed");
    } finally {
      setBusy("");
    }
  }

  async function toggleNote(item: NoteItem) {
    setError("");
    const response = await fetch("/api/admin/notes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, isActive: !item.is_active, siteId: "voicepilot-hq" }),
    });
    if (!response.ok) {
      setError(await readError(response));
      return;
    }
    setNotes((current) => current.map((row) => (row.id === item.id ? { ...row, is_active: !row.is_active } : row)));
  }

  async function removeNote(item: NoteItem) {
    const preview = item.body.replace(/\s+/g, " ").slice(0, 40);
    if (!window.confirm(`刪除呢段備註？${preview}`)) return;
    setError("");
    const response = await fetch(`/api/admin/notes?id=${encodeURIComponent(item.id)}`, { method: "DELETE" });
    if (!response.ok) {
      setError(await readError(response));
      return;
    }
    setNotes((current) => current.filter((row) => row.id !== item.id));
  }

  async function upload(file: File) {
    setBusy("upload");
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("siteId", "voicepilot-hq");
      const response = await fetch("/api/admin/documents", { method: "POST", body: form });
      if (!response.ok) throw new Error(await readError(response));
      await loadDocuments();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Request failed");
    } finally {
      setBusy("");
    }
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void upload(file);
  }

  async function toggle(item: DocumentItem) {
    setError("");
    const response = await fetch("/api/admin/documents", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, isActive: !item.is_active, siteId: "voicepilot-hq" }),
    });
    if (!response.ok) {
      setError(await readError(response));
      return;
    }
    setDocuments((current) =>
      current.map((row) => (row.id === item.id ? { ...row, is_active: !row.is_active } : row)),
    );
  }

  async function remove(item: DocumentItem) {
    if (!window.confirm(`刪除 ${item.file_name}？`)) return;
    setError("");
    const response = await fetch(`/api/admin/documents?id=${encodeURIComponent(item.id)}`, { method: "DELETE" });
    if (!response.ok) {
      setError(await readError(response));
      return;
    }
    setDocuments((current) => current.filter((row) => row.id !== item.id));
  }

  async function saveClient(event: FormEvent) {
    event.preventDefault();
    const routeMap: Record<string, string> = {};
    for (const row of routeRows) {
      const page = row.page.trim();
      const url = row.url.trim();
      if (!page && !url) continue;
      routeMap[page] = url;
    }
    setBusy("client");
    setError("");
    try {
      const response = await fetch("/api/admin/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName,
          clientSlug,
          elevenlabsAgentId: agentId,
          routeMap,
        }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const body = (await response.json()) as { client: ClientItem };
      setSavedSlug(body.client.client_slug);
      setClientSlug(body.client.client_slug);
      await loadClients();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Request failed");
    } finally {
      setBusy("");
    }
  }

  async function toggleClient(item: ClientItem) {
    setError("");
    const response = await fetch("/api/admin/clients", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientSlug: item.client_slug, isActive: !item.is_active }),
    });
    if (!response.ok) {
      setError(await readError(response));
      return;
    }
    setClients((current) =>
      current.map((row) => (row.id === item.id ? { ...row, is_active: !row.is_active } : row)),
    );
  }

  async function copySnippet(slug: string) {
    try {
      await navigator.clipboard.writeText(embedSnippet(slug));
      setCopiedSlug(slug);
    } catch {
      setError("複製失敗，請手動選取程式碼。");
    }
  }

  function editClient(item: ClientItem) {
    setClientName(item.client_name);
    setClientSlug(item.client_slug);
    setAgentId(item.elevenlabs_agent_id);
    setRouteRows(rowsFromMap(item.route_map));
    setSavedSlug(item.client_slug);
    setError("");
  }

  async function ask(event: FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (!text) return;
    setBusy("ask");
    setError("");
    setAnswer("");
    try {
      const response = await fetch("/api/admin/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, siteId: "voicepilot-hq" }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const body = (await response.json()) as { reply?: string };
      setAnswer(body.reply ?? "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Request failed");
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="min-h-screen bg-[#F6F9FC] text-[#0A2540]">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-[#09090B]">Orai Service</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">企業管理員後台</h1>
            <p className="mt-2 max-w-2xl text-sm text-[#425466]">
              管理知識庫檔案同手打備註，同埋睇訪客對話。語音開場白唔會等資料庫寫完先至出聲。
            </p>
          </div>
          {authenticated ? (
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-full border border-[#E6EBF1] bg-white px-4 py-2 text-sm font-semibold shadow-stripe-sm"
            >
              登出
            </button>
          ) : null}
        </header>

        {!ready ? <p className="text-sm text-[#425466]">載入緊…</p> : null}

        {ready && !authenticated ? (
          <form onSubmit={login} className="max-w-md rounded-2xl border border-[#E6EBF1] bg-white p-6 shadow-stripe-sm">
            <h2 className="text-lg font-semibold">管理員密碼</h2>
            <p className="mt-2 text-sm text-[#425466]">
              {configured
                ? "密碼只會喺伺服器核對，唔會存喺瀏覽器。"
                : "請先喺環境變數設定 ADMIN_PASSWORD，然後重新啟動。"}
            </p>
            <label className="mt-5 block text-sm font-medium" htmlFor="admin-password">
              密碼
            </label>
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 w-full rounded-xl border border-[#E6EBF1] bg-[#F6F9FC] px-3 py-3 text-base outline-none focus:border-[#635BFF]"
            />
            <button
              type="submit"
              disabled={busy === "login" || !configured}
              className="mt-4 rounded-full bg-[#635BFF] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              進入後台
            </button>
          </form>
        ) : null}

        {authenticated ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <TabButton active={tab === "knowledge"} onClick={() => setTab("knowledge")}>
                知識庫檔案管理
              </TabButton>
              <TabButton active={tab === "logs"} onClick={() => setTab("logs")}>
                訪客對話紀錄與分析
              </TabButton>
              <TabButton active={tab === "embed"} onClick={() => setTab("embed")}>
                客戶語音掛件
              </TabButton>
              <span className="ml-auto text-xs font-medium text-[#425466]">
                {mode === "supabase" ? "Supabase" : mode === "local" ? "本地後備" : ""}
              </span>
            </div>

            {tab === "embed" ? (
              <section className="flex flex-col gap-4">
                <form onSubmit={saveClient} className="rounded-2xl border border-[#E6EBF1] bg-white p-5 shadow-stripe-sm">
                  <h2 className="text-lg font-semibold">客戶語音掛件</h2>
                  <p className="mt-2 text-sm text-[#425466]">
                    填客戶名稱、代稱、ElevenLabs agent id，同每個頁面嘅網址。儲存之後可以複製嵌入碼。
                  </p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <label className="block text-sm font-medium">
                      客戶名稱
                      <input
                        value={clientName}
                        onChange={(event) => setClientName(event.target.value)}
                        className="mt-2 w-full rounded-xl border border-[#E6EBF1] bg-[#F6F9FC] px-3 py-3 text-sm outline-none focus:border-[#635BFF]"
                      />
                    </label>
                    <label className="block text-sm font-medium">
                      代稱
                      <input
                        value={clientSlug}
                        onChange={(event) => setClientSlug(event.target.value)}
                        placeholder="voicepilot-hq"
                        className="mt-2 w-full rounded-xl border border-[#E6EBF1] bg-[#F6F9FC] px-3 py-3 text-sm outline-none focus:border-[#635BFF]"
                      />
                    </label>
                    <label className="block text-sm font-medium">
                      Agent ID
                      <input
                        value={agentId}
                        onChange={(event) => setAgentId(event.target.value)}
                        placeholder="agent_..."
                        className="mt-2 w-full rounded-xl border border-[#E6EBF1] bg-[#F6F9FC] px-3 py-3 text-sm outline-none focus:border-[#635BFF]"
                      />
                    </label>
                  </div>
                  <div className="mt-4 flex flex-col gap-2">
                    <p className="text-sm font-medium">頁面網址</p>
                    {routeRows.map((row, index) => (
                      <div key={index} className="grid gap-2 sm:grid-cols-[minmax(0,0.4fr)_minmax(0,1fr)_auto]">
                        <input
                          value={row.page}
                          onChange={(event) =>
                            setRouteRows((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, page: event.target.value } : item,
                              ),
                            )
                          }
                          placeholder="pricing"
                          aria-label={`頁面 ${index + 1}`}
                          className="rounded-xl border border-[#E6EBF1] bg-[#F6F9FC] px-3 py-3 text-sm outline-none focus:border-[#635BFF]"
                        />
                        <input
                          value={row.url}
                          onChange={(event) =>
                            setRouteRows((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, url: event.target.value } : item,
                              ),
                            )
                          }
                          placeholder="/pricing"
                          aria-label={`網址 ${index + 1}`}
                          className="rounded-xl border border-[#E6EBF1] bg-[#F6F9FC] px-3 py-3 text-sm outline-none focus:border-[#635BFF]"
                        />
                        <button
                          type="button"
                          onClick={() => setRouteRows((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                          className="rounded-full border border-[#E6EBF1] px-3 py-1.5 text-xs font-semibold"
                        >
                          移除
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setRouteRows((current) => [...current, { page: "", url: "" }])}
                      className="self-start rounded-full border border-[#E6EBF1] px-3 py-1.5 text-xs font-semibold"
                    >
                      加一頁
                    </button>
                  </div>
                  <button
                    type="submit"
                    disabled={busy === "client"}
                    className="mt-4 rounded-full bg-[#635BFF] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {busy === "client" ? "儲存緊…" : "儲存掛件"}
                  </button>
                  {savedSlug ? (
                    <div className="mt-4 rounded-xl bg-[#F6F9FC] p-4">
                      <p className="text-sm font-semibold">嵌入碼</p>
                      <pre className="mt-2 overflow-auto text-xs leading-6">{embedSnippet(savedSlug)}</pre>
                      <button
                        type="button"
                        onClick={() => void copySnippet(savedSlug)}
                        className="mt-2 rounded-full bg-[#0A2540] px-3 py-1.5 text-xs font-semibold text-white"
                      >
                        {copiedSlug === savedSlug ? "已複製" : "複製"}
                      </button>
                    </div>
                  ) : null}
                </form>
                <ul className="flex flex-col gap-3">
                  {clients.length === 0 ? (
                    <li className="rounded-2xl border border-[#E6EBF1] bg-white p-5 text-sm text-[#425466] shadow-stripe-sm">
                      未有客戶掛件。
                    </li>
                  ) : null}
                  {clients.map((item) => (
                    <li key={item.id} className="rounded-2xl border border-[#E6EBF1] bg-white p-5 shadow-stripe-sm">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold">{item.client_name}</p>
                          <p className="mt-1 text-xs text-[#425466]">
                            {item.client_slug} · {item.elevenlabs_agent_id}
                          </p>
                          <pre className="mt-3 overflow-auto text-xs leading-6">{embedSnippet(item.client_slug)}</pre>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => editClient(item)}
                            className="rounded-full border border-[#E6EBF1] px-3 py-1.5 text-xs font-semibold"
                          >
                            編輯
                          </button>
                          <button
                            type="button"
                            onClick={() => void copySnippet(item.client_slug)}
                            className="rounded-full border border-[#E6EBF1] px-3 py-1.5 text-xs font-semibold"
                          >
                            {copiedSlug === item.client_slug ? "已複製" : "複製"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void toggleClient(item)}
                            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                              item.is_active ? "bg-[#635BFF] text-white" : "bg-[#E6EBF1] text-[#425466]"
                            }`}
                          >
                            {item.is_active ? "啟用中" : "已暫停"}
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : tab === "knowledge" ? (
              <section className="flex flex-col gap-4">
                <form onSubmit={saveNote} className="rounded-2xl border border-[#E6EBF1] bg-white p-5 shadow-stripe-sm">
                  <h2 className="text-lg font-semibold">直接輸入知識</h2>
                  <p className="mt-2 text-sm text-[#425466]">打字或者貼上一段資料，儲存之後可以開關同刪除。</p>
                  <label className="mt-4 block text-sm font-medium" htmlFor="knowledge-note">
                    備註內容
                  </label>
                  <textarea
                    id="knowledge-note"
                    value={noteDraft}
                    onChange={(event) => setNoteDraft(event.target.value)}
                    rows={5}
                    placeholder="例如：Growth 年費預繳之後，語音專員可以講邊幾項優惠。"
                    className="mt-2 w-full resize-y rounded-xl border border-[#E6EBF1] bg-[#F6F9FC] px-3 py-3 text-sm outline-none focus:border-[#635BFF]"
                  />
                  <button
                    type="submit"
                    disabled={busy === "note" || noteDraft.trim() === ""}
                    className="mt-3 rounded-full bg-[#635BFF] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {busy === "note" ? "儲存緊…" : "儲存備註"}
                  </button>
                  <ul className="mt-4 divide-y divide-[#E6EBF1]">
                    {notes.length === 0 ? (
                      <li className="py-4 text-sm text-[#425466]">未有手打備註。</li>
                    ) : null}
                    {notes.map((item) => (
                      <li key={item.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start">
                        <div className="min-w-0 flex-1">
                          <p className="max-h-32 overflow-auto whitespace-pre-wrap text-sm leading-6">{item.body}</p>
                          <p className="mt-1 text-xs text-[#425466]">
                            {item.body.length.toLocaleString("zh-HK")} 字 · {formatWhen(item.created_at)}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => void toggleNote(item)}
                            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                              item.is_active ? "bg-[#635BFF] text-white" : "bg-[#E6EBF1] text-[#425466]"
                            }`}
                          >
                            {item.is_active ? "啟用中" : "已停用"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void removeNote(item)}
                            className="rounded-full border border-[#E6EBF1] px-3 py-1.5 text-xs font-semibold"
                          >
                            刪除
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </form>
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                <div className="rounded-2xl border border-[#E6EBF1] bg-white p-5 shadow-stripe-sm">
                  <label
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={onDrop}
                    className={`flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-4 py-8 text-center ${
                      dragging ? "border-[#635BFF] bg-[#635BFF]/5" : "border-[#E6EBF1] bg-[#F6F9FC]"
                    }`}
                  >
                    <span className="text-sm font-semibold">拖放檔案到呢度，或者撳一下揀檔</span>
                    <span className="mt-2 text-xs text-[#425466]">
                      接受 PDF、TXT、Markdown、DOCX、CSV，上限 4 MB。上傳後會抽出文字。
                    </span>
                    <input
                      type="file"
                      accept=".pdf,.txt,.md,.markdown,.docx,.csv,application/pdf,text/plain,text/markdown,text/csv,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      className="sr-only"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void upload(file);
                        event.target.value = "";
                      }}
                    />
                  </label>
                  <p className="mt-3 text-xs text-[#425466]">{busy === "upload" ? "上傳同抽文字進行緊…" : ""}</p>
                  <ul className="mt-4 divide-y divide-[#E6EBF1]">
                    {documents.length === 0 ? (
                      <li className="py-6 text-sm text-[#425466]">未有檔案。未有啟用檔案同備註時，語音會用原有公司資料。</li>
                    ) : null}
                    {documents.map((item) => (
                      <li key={item.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold">{item.file_name}</p>
                          <p className="mt-1 text-xs text-[#425466]">
                            {item.page_count > 0 ? `${item.page_count} 頁 · ` : ""}
                            {item.char_count.toLocaleString("zh-HK")} 字 · {formatSize(item.file_size)} ·{" "}
                            {formatWhen(item.created_at)}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => void toggle(item)}
                            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                              item.is_active ? "bg-[#635BFF] text-white" : "bg-[#E6EBF1] text-[#425466]"
                            }`}
                          >
                            {item.is_active ? "啟用中" : "已停用"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void remove(item)}
                            className="rounded-full border border-[#E6EBF1] px-3 py-1.5 text-xs font-semibold"
                          >
                            刪除
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
                <form onSubmit={ask} className="rounded-2xl border border-[#E6EBF1] bg-white p-5 shadow-stripe-sm">
                  <h2 className="text-lg font-semibold">測試知識庫問答</h2>
                  <p className="mt-2 text-sm text-[#425466]">
                    問題關於啟用中嘅檔案或手打備註，先會用嗰啲資料答，而且唔會把原文讀出嚟。其他問題用公司原有資料。
                  </p>
                  <textarea
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    rows={4}
                    placeholder="例如：Growth 每月幾多錢？"
                    className="mt-4 w-full resize-none rounded-xl border border-[#E6EBF1] bg-[#F6F9FC] px-3 py-3 text-sm outline-none focus:border-[#635BFF]"
                  />
                  <button
                    type="submit"
                    disabled={busy === "ask"}
                    className="mt-3 rounded-full bg-[#0A2540] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {busy === "ask" ? "回答緊…" : "試問"}
                  </button>
                  {answer ? <p className="mt-4 rounded-xl bg-[#F6F9FC] p-4 text-sm leading-6">{answer}</p> : null}
                </form>
                </div>
              </section>
            ) : (
              <section className="flex flex-col gap-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Stat label="總對話次數" value={String(summary.total)} />
                  <Stat label="高意向查詢" value={String(summary.highIntent)} />
                  <Stat label="最常被問頁面" value={summary.topPage ? PAGE_LABEL[summary.topPage] ?? summary.topPage : "未有"} />
                </div>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={highIntentOnly}
                    onChange={(event) => setHighIntentOnly(event.target.checked)}
                  />
                  僅顯示高意向查詢
                </label>
                <ul className="flex flex-col gap-3">
                  {logs.length === 0 ? (
                    <li className="rounded-2xl border border-[#E6EBF1] bg-white p-5 text-sm text-[#425466] shadow-stripe-sm">
                      未有對話紀錄。訪客一問，回覆送出之後先會寫低。
                    </li>
                  ) : null}
                  {logs.map((item) => (
                    <li key={item.id} className="rounded-2xl border border-[#E6EBF1] bg-white p-5 shadow-stripe-sm">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-[#425466]">
                        <time dateTime={item.created_at}>{formatWhen(item.created_at)}</time>
                        <span>{PAGE_LABEL[item.current_page] ?? item.current_page}</span>
                        {item.detected_intent ? (
                          <span className="rounded-full bg-[#635BFF]/10 px-2 py-0.5 font-semibold text-[#635BFF]">
                            {item.detected_intent}
                          </span>
                        ) : null}
                        {item.is_high_intent ? (
                          <span className="rounded-full bg-[#0A2540] px-2 py-0.5 font-semibold text-white">高意向</span>
                        ) : null}
                      </div>
                      <p className="mt-3 text-sm font-semibold">訪客：{item.user_transcript}</p>
                      <p className="mt-2 text-sm leading-6 text-[#425466]">專員：{item.ai_reply}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        ) : null}

        {error ? <p className="text-sm font-medium text-[#DF1B41]">{error}</p> : null}
      </div>
    </main>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-semibold ${
        active ? "bg-[#635BFF] text-white" : "bg-white text-[#0A2540] shadow-stripe-sm"
      }`}
    >
      {children}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#E6EBF1] bg-white p-5 shadow-stripe-sm">
      <p className="text-xs font-medium text-[#425466]">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}
