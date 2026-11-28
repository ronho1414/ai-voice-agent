"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

export type WhatsAppCounts = {
  total: number;
  unread: number;
  needsHuman: number;
  ai: number;
  human: number;
  resolved: number;
};

type ConversationItem = {
  id: string;
  phone_number_id: string;
  customer_wa_id: string;
  customer_name: string;
  mode: "ai" | "human";
  mode_version: number;
  status: "open" | "needs_human" | "resolved";
  unread_count: number;
  needs_human_reason: string;
  last_message_preview: string;
  last_message_sender: "customer" | "ai" | "human" | "system";
  last_message_at: string;
  last_inbound_at: string | null;
  window24hOpen: boolean;
  windowExpiresAt: string | null;
};

type MessageItem = {
  id: string;
  direction: "inbound" | "outbound";
  sender_type: "customer" | "ai" | "human" | "system";
  message_type: string;
  template_name?: string;
  body_text: string;
  media_metadata?: Record<string, unknown>;
  status: "received" | "queued" | "sent" | "delivered" | "read" | "failed";
  dispatched_before_takeover?: boolean;
  error_code?: string;
  error_message?: string;
  created_at: string;
};

type TakeoverEventItem = {
  id: string;
  action: string;
  actor_label: string;
  previous_mode: string | null;
  next_mode: string | null;
  note: string;
  created_at: string;
};

type ListResponse = {
  ok: boolean;
  conversations: ConversationItem[];
  counts: WhatsAppCounts;
  channels: Array<{
    id: string;
    phone_number_id: string;
    display_phone: string;
    ai_auto_reply_enabled: boolean;
    reply_preference?: "auto" | "text" | "voice" | string;
  }>;
  selected: {
    conversation: ConversationItem;
    messages: MessageItem[];
    events: TakeoverEventItem[];
  } | null;
};

type FilterKey = "all" | "unread" | "needs_human" | "ai" | "human" | "resolved";

const FILTER_OPTIONS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "全部" },
  { key: "unread", label: "未讀" },
  { key: "needs_human", label: "待真人跟進" },
  { key: "ai", label: "AI 自動中" },
  { key: "resolved", label: "已解決" },
];

function formatTimeShort(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleTimeString("zh-HK", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleString("zh-HK", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRemainingWindow(expiresAt: string | null): string {
  if (!expiresAt) return "尚未收到客戶訊息";
  const diffMs = Date.parse(expiresAt) - Date.now();
  if (!Number.isFinite(diffMs) || diffMs <= 0) return "已超過 24 小時免費回覆視窗（須使用核准範本）";
  const hours = Math.floor(diffMs / 3_600_000);
  const mins = Math.floor((diffMs % 3_600_000) / 60_000);
  return `24h 對話視窗開啟中（剩餘 ${hours} 小時 ${mins} 分）`;
}

function statusBadgeText(status: MessageItem["status"]): { label: string; tone: string } {
  switch (status) {
    case "queued":
      return { label: "已排隊", tone: "text-[#71717A]" };
    case "sent":
      return { label: "已送出", tone: "text-[#52525B]" };
    case "delivered":
      return { label: "已送達", tone: "text-emerald-700" };
    case "read":
      return { label: "已讀 ✓✓", tone: "text-sky-700" };
    case "failed":
      return { label: "發送失敗", tone: "text-rose-700" };
    default:
      return { label: "已接收", tone: "text-[#71717A]" };
  }
}

function renderMessageBody(msg: MessageItem): { label?: string; text: string } {
  const clean = (msg.body_text || "").trim();
  const meta = msg.media_metadata ?? {};
  switch (msg.message_type) {
    case "image":
      return { label: "圖片訊息", text: clean || "（客戶傳送了一張圖片，第一階段僅支援檢視文字摘要）" };
    case "audio":
      return { label: "語音訊息", text: clean || "（語音轉寫尚未完成）" };
    case "document": {
      const filename = typeof meta.filename === "string" ? meta.filename : "";
      return { label: "文件檔案", text: clean || (filename ? `檔案：${filename}` : "（客戶傳送了一份文件檔案）") };
    }
    case "interactive":
      return { label: "互動回覆", text: clean || "（客戶點選了按鈕／列表選項）" };
    case "template":
      return { label: msg.template_name ? `範本：${msg.template_name}` : "範本訊息", text: clean || "[範本訊息]" };
    case "other": {
      const rawType = typeof meta.raw_type === "string" ? meta.raw_type : "other";
      return { label: `非文字訊息 (${rawType})`, text: clean || `[保留 ${rawType} 訊息紀錄]` };
    }
    default:
      return { text: clean || "（空白訊息）" };
  }
}

type WhatsAppInboxPanelProps = {
  initialConversationId?: string | null;
  onConversationHandled?: () => void;
  onCountsChange?: (counts: WhatsAppCounts) => void;
};

export function WhatsAppInboxPanel({
  initialConversationId,
  onConversationHandled,
  onCountsChange,
}: WhatsAppInboxPanelProps) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [search, setSearch] = useState("");
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [counts, setCounts] = useState<WhatsAppCounts>({
    total: 0,
    unread: 0,
    needsHuman: 0,
    ai: 0,
    human: 0,
    resolved: 0,
  });
  const [channelsCount, setChannelsCount] = useState(0);
  const [channels, setChannels] = useState<ListResponse["channels"]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialConversationId ?? null);
  const [selectedConv, setSelectedConv] = useState<ConversationItem | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [events, setEvents] = useState<TakeoverEventItem[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [streamConnected, setStreamConnected] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [tplName, setTplName] = useState("hello_world");
  const [tplLang, setTplLang] = useState("en_US");
  const [tplBody, setTplBody] = useState("");
  const [mobileShowChat, setMobileShowChat] = useState(Boolean(initialConversationId));

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const prevMsgCountRef = useRef(0);

  useEffect(() => {
    if (initialConversationId) {
      setSelectedId(initialConversationId);
      setMobileShowChat(true);
      onConversationHandled?.();
    }
  }, [initialConversationId, onConversationHandled]);

  const loadInbox = useCallback(
    async (convIdToLoad: string | null, silent = false) => {
      if (!silent) {
        if (convIdToLoad) setLoadingThread(true);
        else setLoadingList(true);
      }
      try {
        const qs = new URLSearchParams();
        if (filter !== "all") qs.set("filter", filter);
        if (search.trim()) qs.set("q", search.trim());
        if (convIdToLoad) qs.set("conversationId", convIdToLoad);

        const res = await fetch(`/api/platform/customer/whatsapp?${qs.toString()}`, {
          cache: "no-store",
        });
        const data = (await res.json()) as ListResponse & { error?: string };
        if (!res.ok || !data.ok) {
          throw new Error(data.error || "無法載入 WhatsApp 對話資料");
        }

        setConversations(data.conversations ?? []);
        setCounts(data.counts);
        setChannels(Array.isArray(data.channels) ? data.channels : []);
        setChannelsCount(Array.isArray(data.channels) ? data.channels.length : 0);
        onCountsChange?.(data.counts);

        if (data.selected) {
          setSelectedConv(data.selected.conversation);
          setMessages(data.selected.messages ?? []);
          setEvents(data.selected.events ?? []);
        } else if (!convIdToLoad && (data.conversations ?? []).length > 0 && !selectedId) {
          const first = data.conversations[0];
          setSelectedId(first.id);
        }
        setError("");
      } catch (err) {
        if (!silent) {
          setError(err instanceof Error ? err.message : "載入 WhatsApp Inbox 失敗");
        }
      } finally {
        setLoadingList(false);
        setLoadingThread(false);
      }
    },
    [filter, onCountsChange, search, selectedId],
  );

  useEffect(() => {
    void loadInbox(selectedId);
  }, [loadInbox, selectedId]);

  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/platform/customer/whatsapp/stream");
      es.addEventListener("ready", () => setStreamConnected(true));
      es.addEventListener("update", () => {
        void loadInbox(selectedId, true);
      });
      es.onerror = () => {
        setStreamConnected(false);
      };
    } catch {
      setStreamConnected(false);
    }

    const fallbackInterval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadInbox(selectedId, true);
      }
    }, 15_000);

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void loadInbox(selectedId, true);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      es?.close();
      window.clearInterval(fallbackInterval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadInbox, selectedId]);

  useEffect(() => {
    if (messages.length !== prevMsgCountRef.current) {
      prevMsgCountRef.current = messages.length;
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length, selectedConv?.id]);

  async function selectConversation(conv: ConversationItem) {
    setSelectedId(conv.id);
    setMobileShowChat(true);
    setNotice("");
    if (conv.unread_count > 0) {
      await fetch("/api/platform/customer/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_read", conversationId: conv.id }),
      }).catch(() => {});
    }
  }

  async function runCommand(
    action: "take_over" | "resume_ai" | "mark_resolved" | "reopen" | "mark_read" | "mark_unread",
  ) {
    if (!selectedConv) return;
    setBusyAction(action);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/platform/customer/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, conversationId: selectedConv.id }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        inFlightAiDispatch?: boolean;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "更新對話控制狀態失敗");
      }
      if (action === "take_over") {
        setNotice(
          data.inFlightAiDispatch
            ? "已切換為真人接管模式。注意：有一則接管前已提交給 Meta 的 AI 回覆正在傳送中，後續新訊息將不再觸發 AI。"
            : "已切換為真人接管模式，AI 自動回覆已即時暫停。",
        );
      } else if (action === "resume_ai") {
        setNotice("已恢復 AI 自動回覆，AI 將延續包含真人客服回覆在內的對話紀錄繼續服務。");
      }
      await loadInbox(selectedConv.id, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失敗");
    } finally {
      setBusyAction("");
    }
  }

  async function handleSendText(e?: FormEvent, forceTakeOver = false) {
    e?.preventDefault();
    if (!selectedConv) return;
    const clean = draftText.trim();
    if (!clean) return;

    setBusyAction("send_text");
    setError("");
    setNotice("");
    try {
      if (forceTakeOver && selectedConv.mode === "ai") {
        const cmdRes = await fetch("/api/platform/customer/whatsapp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "take_over", conversationId: selectedConv.id }),
        });
        if (!cmdRes.ok) {
          throw new Error("切換真人接管失敗，已取消傳送以免 AI 重複回覆。");
        }
      }

      const idempotencyKey =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? `hum:${crypto.randomUUID()}`
          : `hum:${Date.now()}`;

      const res = await fetch("/api/platform/customer/whatsapp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({
          action: "send_text",
          conversationId: selectedConv.id,
          body: clean,
          idempotencyKey,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "發送 WhatsApp 訊息失敗");
      }
      setDraftText("");
      await loadInbox(selectedConv.id, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "發送 WhatsApp 訊息失敗");
    } finally {
      setBusyAction("");
    }
  }

  async function handleSendTemplate(e: FormEvent) {
    e.preventDefault();
    if (!selectedConv) return;
    setBusyAction("send_template");
    setError("");
    setNotice("");
    try {
      const idempotencyKey =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? `tpl:${crypto.randomUUID()}`
          : `tpl:${Date.now()}`;

      const res = await fetch("/api/platform/customer/whatsapp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({
          action: "send_template",
          conversationId: selectedConv.id,
          templateName: tplName.trim() || "hello_world",
          languageCode: tplLang.trim() || "en_US",
          bodyText: tplBody.trim(),
          idempotencyKey,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "發送 WhatsApp 範本訊息失敗");
      }
      setTplBody("");
      setNotice("已透過 Meta Cloud API 送出核准範本訊息。");
      await loadInbox(selectedConv.id, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "發送範本訊息失敗");
    } finally {
      setBusyAction("");
    }
  }

  function handleDraftKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (draftText.trim() && !busyAction) {
        void handleSendText(undefined, selectedConv?.mode === "ai");
      }
    }
  }

  const filterBadgeCount = useMemo(
    () => ({
      all: counts.total,
      unread: counts.unread,
      needs_human: counts.needsHuman,
      ai: counts.ai,
      human: counts.human,
      resolved: counts.resolved,
    }),
    [counts],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-white text-[13px] text-[#20293B]">
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-b border-[#E0E4EB] px-3 py-2">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold ${
              streamConnected
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-[#E4E4E7] bg-white text-[#71717A]"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${streamConnected ? "bg-emerald-500" : "bg-zinc-400"}`}
            />
            {streamConnected ? "即時連線中" : "背景同步中"}
          </span>
          <button
            type="button"
            onClick={() => void loadInbox(selectedId)}
            className="rounded-md border border-[#E0E4EB] bg-white px-2.5 py-1 text-[12px] text-[#20293B] hover:bg-[#F7F8FA]"
          >
            重新整理
          </button>
        </div>
      </div>

      {channelsCount === 0 && !loadingList && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          此商戶目前尚未啟用已綁定的 WhatsApp 商業號碼通道（Channel）。當 Meta WhatsApp Business API 完成綁定並啟用後，客戶訊息將自動進入此收件匣。
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-700" role="alert">
          {error}
        </div>
      )}

      {notice && (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs font-semibold text-sky-800">
          {notice}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className={`w-[180px] shrink-0 flex-col overflow-y-auto border-r border-[#E0E4EB] bg-white px-2 py-3 ${mobileShowChat ? "hidden lg:flex" : "flex"}`}>
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setFilter(opt.key)}
              className={`flex items-center justify-between rounded-md px-2 py-1.5 text-left text-[12px] ${
                filter === opt.key ? "bg-[#E3EDFC] font-medium text-[#2563EB]" : "text-[#20293B] hover:bg-[#F7F8FA]"
              }`}
            >
              <span>{opt.label}</span>
              <span className={filter === opt.key ? "text-[#2563EB]" : "text-[#657084]"}>{filterBadgeCount[opt.key]}</span>
            </button>
          ))}
        </aside>
        <section
          aria-label="WhatsApp 對話列表"
          className={`flex w-full flex-col border-r border-[#E0E4EB] md:w-[300px] ${
            mobileShowChat ? "hidden lg:flex" : "flex"
          }`}
        >
          <div className="shrink-0 border-b border-[#E0E4EB] p-2.5">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜尋客戶或訊息"
              className="w-full rounded-md border border-[#E0E4EB] bg-[#F7F8FA] px-2 py-1.5 text-[12px] text-[#20293B] outline-none focus:border-[#2563EB]"
            />
          </div>

          <div className="min-h-0 flex-1 divide-y divide-[#E0E4EB] overflow-y-auto overscroll-contain">
            {loadingList && conversations.length === 0 ? (
              <div className="px-4 py-12 text-center text-xs text-[#71717A]">載入對話中…</div>
            ) : conversations.length === 0 ? (
              <div className="px-4 py-12 text-center text-xs text-[#71717A]">
                沒有符合條件的 WhatsApp 對話
              </div>
            ) : (
              conversations.map((conv) => {
                const isActive = conv.id === selectedId;
                return (
                  <button
                    key={conv.id}
                    type="button"
                    onClick={() => void selectConversation(conv)}
                    className={`w-full px-3 py-2.5 text-left ${
                      isActive ? "bg-[#E3EDFC]" : "bg-white hover:bg-[#F7F8FA]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold text-[#09090B]">
                          {conv.customer_name || `+${conv.customer_wa_id}`}
                        </div>
                        <div className="text-[11px] text-[#71717A]">+{conv.customer_wa_id}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-[10px] text-[#71717A]">
                          {formatTimeShort(conv.last_message_at)}
                        </div>
                        {conv.unread_count > 0 && (
                          <span className="mt-1 inline-flex min-w-[1.25rem] justify-center rounded-full bg-[#2563EB] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                            {conv.unread_count > 99 ? "99+" : conv.unread_count}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-1.5 truncate text-xs text-[#52525B]">
                      {conv.last_message_sender === "ai"
                        ? "AI: "
                        : conv.last_message_sender === "human"
                          ? "真人: "
                          : ""}
                      {conv.last_message_preview || "（尚無訊息內容）"}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span
                        className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                          conv.mode === "human"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-sky-100 text-sky-800"
                        }`}
                      >
                        {conv.mode === "human" ? "真人接管中" : "AI 自動回覆"}
                      </span>
                      {conv.status === "needs_human" && (
                        <span className="rounded-md bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                          待跟進
                        </span>
                      )}
                      {conv.status === "resolved" && (
                        <span className="rounded-md bg-zinc-200 px-2 py-0.5 text-[10px] font-bold text-zinc-700">
                          已解決
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* Right Pane: Chat Window */}
        <section
          aria-label="WhatsApp 對話內容"
          className={`min-w-0 flex-1 flex-col bg-[#F7F8FA] ${!mobileShowChat ? "hidden lg:flex" : "flex"}`}
        >
          {!selectedConv ? (
            <div className="flex flex-1 flex-col items-center justify-center p-10 text-center text-xs text-[#71717A]">
              {loadingThread ? "載入對話明細中…" : "請從左側選擇一位客戶開始查看或接管 WhatsApp 對話"}
            </div>
          ) : (
            <>
              {/* Conversation Header & Controls */}
              <div className="border-b border-[#E4E4E7] bg-white px-5 py-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setMobileShowChat(false)}
                      className="rounded-lg border border-[#E4E4E7] px-2.5 py-1 text-xs font-bold text-[#09090B] lg:hidden"
                    >
                      ← 列表
                    </button>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-extrabold text-[#09090B]">
                          {selectedConv.customer_name || `+${selectedConv.customer_wa_id}`}
                        </h2>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                            selectedConv.mode === "human"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-sky-100 text-sky-800"
                          }`}
                        >
                          {selectedConv.mode === "human" ? "Human Mode（真人接管）" : "AI Mode（AI 自動）"}
                        </span>
                        {selectedConv.status === "resolved" && (
                          <span className="rounded-full bg-zinc-200 px-2.5 py-0.5 text-[11px] font-bold text-zinc-700">
                            已解決
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#71717A]">
                        <span>+{selectedConv.customer_wa_id}</span>
                        <span
                          className={
                            selectedConv.window24hOpen ? "text-emerald-700 font-semibold" : "text-amber-700 font-semibold"
                          }
                        >
                          {formatRemainingWindow(selectedConv.windowExpiresAt)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Conversation Controls */}
                  <div className="flex flex-wrap items-center gap-2">
                    {selectedConv.mode === "ai" ? (
                      <button
                        type="button"
                        disabled={Boolean(busyAction)}
                        onClick={() => void runCommand("take_over")}
                        className="rounded-md bg-[#2563EB] px-2.5 py-1 text-[12px] font-medium text-white hover:bg-[#1D4FD7] disabled:opacity-50"
                      >
                        {busyAction === "take_over" ? "接管中…" : "Take Over（真人接管）"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={Boolean(busyAction)}
                        onClick={() => void runCommand("resume_ai")}
                        className="rounded-md border border-[#2563EB] bg-white px-2.5 py-1 text-[12px] font-medium text-[#2563EB] hover:bg-[#E3EDFC] disabled:opacity-50"
                      >
                        {busyAction === "resume_ai" ? "切換中…" : "Resume AI（恢復 AI）"}
                      </button>
                    )}

                    {selectedConv.status !== "resolved" ? (
                      <button
                        type="button"
                        disabled={Boolean(busyAction)}
                        onClick={() => void runCommand("mark_resolved")}
                        className="rounded-xl border border-[#E4E4E7] bg-white px-3 py-2 text-xs font-bold text-[#09090B] hover:bg-[#F4F4F5] disabled:opacity-50"
                      >
                        Mark as Resolved
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={Boolean(busyAction)}
                        onClick={() => void runCommand("reopen")}
                        className="rounded-xl border border-[#E4E4E7] bg-white px-3 py-2 text-xs font-bold text-[#09090B] hover:bg-[#F4F4F5] disabled:opacity-50"
                      >
                        重新開啟對話
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={Boolean(busyAction)}
                      onClick={() => void runCommand("mark_unread")}
                      className="rounded-xl border border-[#E4E4E7] bg-white px-3 py-2 text-xs font-bold text-[#52525B] hover:bg-[#F4F4F5] disabled:opacity-50"
                    >
                      Mark Unread
                    </button>
                    {(() => {
                      const channel = channels.find((item) => item.phone_number_id === selectedConv.phone_number_id);
                      if (!channel) return null;
                      const preference = channel.reply_preference === "text" || channel.reply_preference === "voice"
                        ? channel.reply_preference
                        : "auto";
                      return (
                        <label className="inline-flex items-center gap-2 text-[11px] font-bold text-[#52525B]">
                          回覆
                          <select
                            value={preference}
                            disabled={Boolean(busyAction)}
                            onChange={(event) => {
                              const next = event.target.value;
                              if (next !== "auto" && next !== "text" && next !== "voice") return;
                              setBusyAction("reply_preference");
                              void fetch("/api/platform/customer/whatsapp", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  action: "set_reply_preference",
                                  channelId: channel.id,
                                  preference: next,
                                }),
                              })
                                .then(async (res) => {
                                  const data = (await res.json()) as { ok?: boolean; error?: string };
                                  if (!res.ok || !data.ok) throw new Error(data.error || "未能更新回覆偏好");
                                  setNotice(
                                    next === "text"
                                      ? "此號碼改為只回文字。"
                                      : next === "voice"
                                        ? "此號碼改為只回語音。合成失敗時會改回文字。"
                                        : "此號碼改為自動：文字回文字，語音回語音。",
                                  );
                                  await loadInbox(selectedConv.id, true);
                                })
                                .catch((err: unknown) => {
                                  setError(err instanceof Error ? err.message : "未能更新回覆偏好");
                                })
                                .finally(() => setBusyAction(""));
                            }}
                            className="rounded-lg border border-[#E4E4E7] bg-white px-2 py-1.5 text-xs font-bold text-[#09090B]"
                          >
                            <option value="auto">自動</option>
                            <option value="text">只回文字</option>
                            <option value="voice">只回語音</option>
                          </select>
                        </label>
                      );
                    })()}
                  </div>
                </div>

                {selectedConv.needs_human_reason && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs text-amber-800">
                    <strong>需要真人跟進原因：</strong>
                    {selectedConv.needs_human_reason}
                  </div>
                )}

                {events.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#71717A]">
                    <span className="font-bold text-[#52525B]">最近控制紀錄：</span>
                    <span>
                      {events[0].actor_label || "系統"} 執行 {events[0].action}（{formatDateTime(events[0].created_at)}）
                      {events[0].note ? ` — ${events[0].note}` : ""}
                    </span>
                  </div>
                )}
              </div>

              {/* Message Thread */}
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3">
                {messages.length === 0 ? (
                  <div className="py-12 text-center text-xs text-[#71717A]">此對話尚無訊息紀錄。</div>
                ) : (
                  messages.map((msg) => {
                    const isCustomer = msg.sender_type === "customer" || msg.direction === "inbound";
                    const isHuman = msg.sender_type === "human";
                    const isAi = msg.sender_type === "ai";
                    const content = renderMessageBody(msg);
                    const badge = statusBadgeText(msg.status);

                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${isCustomer ? "items-start" : "items-end"}`}
                      >
                        <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold text-[#71717A]">
                          <span>
                            {isCustomer
                              ? selectedConv.customer_name || `+${selectedConv.customer_wa_id}`
                              : isHuman
                                ? "真人客服"
                                : isAi
                                  ? "AI 專員"
                                  : "系統"}
                          </span>
                          <span>·</span>
                          <span>{formatDateTime(msg.created_at)}</span>
                        </div>

                        <div
                          className={`max-w-[70%] rounded-md px-3 py-2 text-[13px] leading-5 ${
                            isCustomer
                              ? "border border-[#E0E4EB] bg-white text-[#20293B]"
                              : isHuman
                                ? "border border-[#2563EB] bg-white text-[#20293B]"
                                : "bg-[#E3EDFC] text-[#20293B]"
                          }`}
                        >
                          {msg.message_type === "audio" && msg.media_metadata?.has_playback === true && (
                            <audio
                              controls
                              preload="none"
                              className="mb-2 w-full min-w-[220px]"
                              src={`/api/platform/customer/whatsapp/media?messageId=${encodeURIComponent(msg.id)}`}
                            />
                          )}
                          {content.label && (
                            <div
                              className="mb-1 text-[10px] font-semibold text-[#657084]"
                            >
                              {content.label}
                            </div>
                          )}
                          <div className="whitespace-pre-wrap break-words">{content.text}</div>
                        </div>

                        {!isCustomer && (
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px]">
                            <span className={`font-semibold ${badge.tone}`}>{badge.label}</span>
                            {msg.dispatched_before_takeover && (
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">
                                接管前已送達 Meta（無法撤回）
                              </span>
                            )}
                            {msg.status === "failed" && msg.error_message && (
                              <span className="text-rose-700">{msg.error_message}</span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
                <div ref={bottomRef} />
              </div>

              {/* Reply Composer */}
              <div className="border-t border-[#E4E4E7] bg-white p-4">
                {selectedConv.window24hOpen ? (
                  <form onSubmit={(e) => void handleSendText(e, selectedConv.mode === "ai")} className="space-y-2.5">
                    {selectedConv.mode === "ai" && (
                      <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                        <span>目前為 AI 自動回覆模式。送出真人回覆時將自動切換為「真人接管模式」，防止 AI 重複回覆。</span>
                      </div>
                    )}
                    <div className="flex items-end gap-2.5">
                      <textarea
                        rows={2}
                        value={draftText}
                        onChange={(e) => setDraftText(e.target.value)}
                        onKeyDown={handleDraftKeyDown}
                        placeholder="輸入真人 WhatsApp 回覆內容（Enter 發送，Shift+Enter 換行）…"
                        className="flex-1 resize-none rounded-xl border border-[#E4E4E7] bg-[#FAFAFA] px-3.5 py-2.5 text-sm text-[#09090B] outline-none focus:border-[#09090B] focus:bg-white"
                      />
                      <button
                        type="submit"
                        disabled={!draftText.trim() || Boolean(busyAction)}
                        className="shrink-0 rounded-md bg-[#2563EB] px-3 py-2 text-[12px] font-medium text-white hover:bg-[#1D4FD7] disabled:opacity-40"
                      >
                        {busyAction === "send_text"
                          ? "傳送中…"
                          : selectedConv.mode === "ai"
                            ? "接管並發送"
                            : "發送回覆"}
                      </button>
                    </div>
                  </form>
                ) : (
                  <form onSubmit={(e) => void handleSendTemplate(e)} className="space-y-2.5">
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      客戶最後一則主動訊息已超過 24 小時（Meta Customer Service Window），不可發送自由文字訊息，請改用已核准的 WhatsApp 範本訊息重新開啟對話。
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <input
                        type="text"
                        value={tplName}
                        onChange={(e) => setTplName(e.target.value)}
                        placeholder="範本名稱（如 hello_world）"
                        className="rounded-xl border border-[#E4E4E7] px-3 py-2 text-xs text-[#09090B]"
                      />
                      <input
                        type="text"
                        value={tplLang}
                        onChange={(e) => setTplLang(e.target.value)}
                        placeholder="語言代碼（如 en_US / zh_HK）"
                        className="rounded-xl border border-[#E4E4E7] px-3 py-2 text-xs text-[#09090B]"
                      />
                      <button
                        type="submit"
                        disabled={Boolean(busyAction)}
                        className="rounded-md bg-[#2563EB] px-3 py-2 text-[12px] font-medium text-white hover:bg-[#1D4FD7] disabled:opacity-40"
                      >
                        {busyAction === "send_template" ? "發送範本中…" : "發送核准範本"}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
