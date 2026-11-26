"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  MESSAGE_CATEGORIES,
  MESSAGE_STATUSES,
  messageCategoryLabels,
  messageChannelLabels,
  messageStatusLabels,
  type InboxMessage,
  type MessageCategory,
  type MessageCounts,
  type MessageEvent,
  type MessageInternalNote,
  type MessageLinkedConversation,
  type MessageStatus,
} from "@/lib/platform/messages";
import { apiJson, dispatchManagedRefresh, formatDateTime, MANAGED_REFRESH_EVENT } from "@/components/managed-agent/shared";

type MessageListResponse = {
  messages: InboxMessage[];
  counts: MessageCounts;
  total: number;
  page: number;
  pageSize: number;
};

type MessageDetailResponse = {
  message: InboxMessage;
  events: MessageEvent[];
  internal_notes: MessageInternalNote[];
  linked_conversation: MessageLinkedConversation | null;
};

type MessageInboxPanelProps = {
  apiPath: "/api/platform/customer/messages";
  title?: string;
  subtitle?: string;
  initialMessageId?: string | null;
  onMessageHandled?: () => void;
  onCountsChange?: (counts: MessageCounts) => void;
};

function statusBadgeTone(status: MessageStatus): string {
  switch (status) {
    case "pending":
      return "bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A]";
    case "in_progress":
      return "bg-[#E0F2FE] text-[#075985] border border-[#BAE6FD]";
    case "completed":
      return "bg-[#09090B] text-white border border-[#09090B]";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

function eventDescription(event: MessageEvent): string {
  switch (event.kind) {
    case "created":
      return "AI 專員已建立留言紀錄";
    case "status_changed": {
      const fromLabel = event.from_status ? messageStatusLabels[event.from_status] : "—";
      const toLabel = event.to_status ? messageStatusLabels[event.to_status] : "—";
      return `狀態由「${fromLabel}」更新為「${toLabel}」`;
    }
    case "note_added":
      return "已新增內部跟進備註";
    case "conversation_linked":
      return "已自動關聯完整對話紀錄";
    default: {
      const _exhaustive: never = event.kind;
      return _exhaustive;
    }
  }
}

export function MessageInboxPanel({
  apiPath,
  title = "留言及跟進",
  subtitle = "檢視 AI 專員為訪客收集的留言、回電要求、投訴及商業查詢，並進行跟進記錄。",
  initialMessageId = null,
  onMessageHandled,
  onCountsChange,
}: MessageInboxPanelProps) {
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [counts, setCounts] = useState<MessageCounts>({ pending: 0, in_progress: 0, completed: 0, total: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(initialMessageId);
  const [detail, setDetail] = useState<MessageDetailResponse | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | MessageStatus>("");
  const [categoryFilter, setCategoryFilter] = useState<"" | MessageCategory>("");

  const [noteDraft, setNoteDraft] = useState("");
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [showTranscript, setShowTranscript] = useState(false);

  const loadList = useCallback(
    async (quiet = false) => {
      if (!quiet) setListLoading(true);
      try {
        const params = new URLSearchParams();
        if (statusFilter) params.set("status", statusFilter);
        if (categoryFilter) params.set("category", categoryFilter);
        if (search.trim()) params.set("search", search.trim());
        const qs = params.toString();
        const data = await apiJson<MessageListResponse>(`${apiPath}${qs ? `?${qs}` : ""}`);
        setMessages(Array.isArray(data.messages) ? data.messages : []);
        const nextCounts = data.counts ?? { pending: 0, in_progress: 0, completed: 0, total: 0 };
        setCounts(nextCounts);
        onCountsChange?.(nextCounts);
        setError("");
      } catch (err) {
        if (!quiet) {
          setError(err instanceof Error ? err.message : "無法載入留言列表");
        }
      } finally {
        if (!quiet) setListLoading(false);
      }
    },
    [apiPath, categoryFilter, onCountsChange, search, statusFilter],
  );

  const loadDetail = useCallback(
    async (id: string, quiet = false) => {
      if (!quiet) {
        setDetailLoading(true);
        setShowTranscript(false);
      }
      try {
        const data = await apiJson<MessageDetailResponse>(`${apiPath}?id=${encodeURIComponent(id)}`);
        setDetail(data);
        setError("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "無法載入留言詳情");
      } finally {
        if (!quiet) setDetailLoading(false);
      }
    },
    [apiPath],
  );

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (initialMessageId) {
      setSelectedId(initialMessageId);
      onMessageHandled?.();
    }
  }, [initialMessageId, onMessageHandled]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedId);
  }, [loadDetail, selectedId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadList(true);
      if (selectedId) void loadDetail(selectedId, true);
    }, 15_000);
    const onRefresh = () => {
      void loadList(true);
      if (selectedId) void loadDetail(selectedId, true);
    };
    window.addEventListener(MANAGED_REFRESH_EVENT, onRefresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(MANAGED_REFRESH_EVENT, onRefresh);
    };
  }, [loadDetail, loadList, selectedId]);

  async function handleStatusUpdate(nextStatus: MessageStatus) {
    if (!detail) return;
    setBusyAction(`status_${nextStatus}`);
    setError("");
    setFeedback("");
    try {
      await apiJson<{ message: InboxMessage }>(apiPath, {
        method: "PATCH",
        body: JSON.stringify({
          id: detail.message.id,
          action: "update_status",
          status: nextStatus,
          expected_version: detail.message.version,
        }),
      });
      setFeedback(`已更新為「${messageStatusLabels[nextStatus]}」`);
      dispatchManagedRefresh();
      await Promise.all([loadList(true), loadDetail(detail.message.id, true)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新留言狀態失敗");
    } finally {
      setBusyAction("");
    }
  }

  async function handleAddNote(event: FormEvent) {
    event.preventDefault();
    if (!detail || !noteDraft.trim()) return;
    setBusyAction("add_note");
    setError("");
    setFeedback("");
    try {
      await apiJson<{ message: InboxMessage }>(apiPath, {
        method: "PATCH",
        body: JSON.stringify({
          id: detail.message.id,
          action: "add_note",
          note: noteDraft.trim(),
        }),
      });
      setNoteDraft("");
      setFeedback("已新增內部跟進備註");
      dispatchManagedRefresh();
      await loadDetail(detail.message.id, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "新增備註失敗");
    } finally {
      setBusyAction("");
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{title}</h1>
          <p className="text-xs text-[#52525B] mt-1">{subtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            void loadList();
            if (selectedId) void loadDetail(selectedId);
          }}
          className="self-start sm:self-auto px-4 py-2 rounded-xl border border-[#E4E4E7] bg-white text-xs font-bold text-[#09090B] hover:bg-[#F4F4F5] transition-colors"
        >
          重新整理
        </button>
      </header>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {MESSAGE_STATUSES.map((st) => {
          const active = statusFilter === st;
          return (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter((prev) => (prev === st ? "" : st))}
              className={`p-5 rounded-2xl border text-left transition-all shadow-stripe-sm ${
                active
                  ? "border-[#09090B] bg-[#FAFAFA] ring-1 ring-[#09090B]"
                  : "border-[#E4E4E7] bg-white hover:border-[#D4D4D8]"
              }`}
            >
              <div className="text-xs font-bold text-[#52525B]">{messageStatusLabels[st]}</div>
              <div className="mt-2 text-3xl font-extrabold text-[#09090B]">{counts[st]}</div>
              <div className="mt-1 text-[11px] text-[#71717A]">
                {active ? "點擊顯示全部狀態" : `點擊篩選${messageStatusLabels[st]}留言`}
              </div>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="p-4 rounded-2xl bg-white border border-[#E4E4E7] shadow-stripe-sm grid grid-cols-1 sm:grid-cols-3 gap-3">
        <input
          type="search"
          aria-label="搜尋留言"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜尋編號、聯絡人、電話、收件人或摘要…"
          className="px-3.5 py-2.5 rounded-xl border border-[#E4E4E7] bg-[#FAFAFA] text-xs font-medium text-[#09090B] focus:outline-none focus:border-[#09090B]"
        />
        <select
          aria-label="狀態篩選"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "" | MessageStatus)}
          className="px-3.5 py-2.5 rounded-xl border border-[#E4E4E7] bg-[#FAFAFA] text-xs font-semibold text-[#09090B] focus:outline-none focus:border-[#09090B]"
        >
          <option value="">全部狀態</option>
          {MESSAGE_STATUSES.map((st) => (
            <option key={st} value={st}>
              {messageStatusLabels[st]}
            </option>
          ))}
        </select>
        <select
          aria-label="分類篩選"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as "" | MessageCategory)}
          className="px-3.5 py-2.5 rounded-xl border border-[#E4E4E7] bg-[#FAFAFA] text-xs font-semibold text-[#09090B] focus:outline-none focus:border-[#09090B]"
        >
          <option value="">全部分類</option>
          {MESSAGE_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {messageCategoryLabels[cat]}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold" role="alert">
          {error}
        </div>
      )}
      {feedback && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold">
          {feedback}
        </div>
      )}

      {/* List + Detail Split Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div className="lg:col-span-6 space-y-3">
          {listLoading && (
            <div className="p-8 rounded-2xl bg-white border border-[#E4E4E7] text-center text-xs text-[#71717A]">
              載入留言中…
            </div>
          )}
          {!listLoading && messages.length === 0 && (
            <div className="p-10 rounded-2xl bg-white border border-[#E4E4E7] text-center text-xs text-[#71717A]">
              暫時沒有符合條件的留言紀錄。
            </div>
          )}
          {!listLoading &&
            messages.map((msg) => {
              const isSelected = selectedId === msg.id;
              return (
                <button
                  key={msg.id}
                  type="button"
                  onClick={() => setSelectedId(msg.id)}
                  className={`w-full text-left p-5 rounded-2xl border transition-all shadow-stripe-sm ${
                    isSelected
                      ? "border-[#09090B] bg-[#FAFAFA] ring-1 ring-[#09090B]"
                      : "border-[#E4E4E7] bg-white hover:border-[#D4D4D8]"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-mono font-bold text-[#71717A]">{msg.reference}</span>
                      <span className="font-extrabold text-sm text-[#09090B]">{msg.sender_name}</span>
                      {msg.contact_phone && (
                        <span className="text-xs font-semibold text-[#52525B]">{msg.contact_phone}</span>
                      )}
                    </div>
                    <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${statusBadgeTone(msg.status)}`}>
                      {messageStatusLabels[msg.status]}
                    </span>
                  </div>

                  <p className="mt-2.5 text-xs text-[#3F3F46] leading-relaxed line-clamp-2">
                    {msg.message_summary || msg.message_content}
                  </p>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-[#71717A]">
                    <span className="px-2 py-0.5 rounded-full bg-[#F4F4F5] font-semibold text-[#3F3F46]">
                      {messageCategoryLabels[msg.category]}
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-[#F4F4F5] font-semibold text-[#52525B]">
                      {messageChannelLabels[msg.channel]}
                    </span>
                    {msg.recipient_name && (
                      <span>指定對象：{msg.recipient_name}</span>
                    )}
                    <span className="ml-auto">{formatDateTime(msg.created_at)}</span>
                  </div>
                </button>
              );
            })}
        </div>

        {/* Detail Panel */}
        <div className="lg:col-span-6">
          {!selectedId && (
            <div className="p-10 rounded-2xl bg-white border border-[#E4E4E7] text-center text-xs text-[#71717A]">
              請從左側選擇一則留言檢視詳情、對話關聯與跟進紀錄。
            </div>
          )}

          {selectedId && detailLoading && !detail && (
            <div className="p-10 rounded-2xl bg-white border border-[#E4E4E7] text-center text-xs text-[#71717A]">
              正在載入留言詳情…
            </div>
          )}

          {selectedId && detail && (
            <div className="p-6 rounded-2xl bg-white border border-[#E4E4E7] shadow-stripe-sm space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#F4F4F5] pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-[#71717A]">{detail.message.reference}</span>
                    <span className="px-2 py-0.5 rounded-full bg-[#F4F4F5] text-[11px] font-semibold text-[#3F3F46]">
                      {messageCategoryLabels[detail.message.category]}
                    </span>
                  </div>
                  <h2 className="mt-1 text-lg font-extrabold text-[#09090B]">{detail.message.sender_name}</h2>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-bold ${statusBadgeTone(detail.message.status)}`}>
                  {messageStatusLabels[detail.message.status]}
                </span>
              </div>

              {/* Metadata Grid */}
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-[#FAFAFA] border border-[#F4F4F5]">
                  <dt className="text-[11px] font-bold text-[#71717A]">聯絡電話 / WhatsApp</dt>
                  <dd className="mt-1 font-semibold text-[#09090B]">
                    {detail.message.contact_phone || "訪客未提供"}
                  </dd>
                </div>
                <div className="p-3 rounded-xl bg-[#FAFAFA] border border-[#F4F4F5]">
                  <dt className="text-[11px] font-bold text-[#71717A]">指定收件人 / 部門</dt>
                  <dd className="mt-1 font-semibold text-[#09090B]">
                    {detail.message.recipient_name || "一般前台跟進"}
                  </dd>
                </div>
                <div className="p-3 rounded-xl bg-[#FAFAFA] border border-[#F4F4F5]">
                  <dt className="text-[11px] font-bold text-[#71717A]">方便回電時間</dt>
                  <dd className="mt-1 font-semibold text-[#09090B]">
                    {detail.message.preferred_callback_time || "未指定"}
                  </dd>
                </div>
                <div className="p-3 rounded-xl bg-[#FAFAFA] border border-[#F4F4F5]">
                  <dt className="text-[11px] font-bold text-[#71717A]">來源渠道與專員</dt>
                  <dd className="mt-1 font-semibold text-[#09090B]">
                    {messageChannelLabels[detail.message.channel]} ·{" "}
                    <span className="font-mono text-[11px] text-[#52525B]">{detail.message.provider_agent_id}</span>
                  </dd>
                </div>
              </dl>

              {/* AI Summary & Preserved Original Content */}
              <div className="space-y-3">
                <div className="p-4 rounded-xl bg-[#FAFAFA] border border-[#E4E4E7]">
                  <div className="text-[11px] font-bold text-[#71717A]">AI 重點摘要</div>
                  <p className="mt-1 text-xs text-[#09090B] leading-relaxed">
                    {detail.message.message_summary || "—"}
                  </p>
                </div>
                <div className="p-4 rounded-xl bg-white border border-[#E4E4E7]">
                  <div className="text-[11px] font-bold text-[#71717A]">原始留言內容（已封存不可篡改）</div>
                  <p className="mt-1.5 text-xs text-[#09090B] whitespace-pre-wrap leading-relaxed">
                    {detail.message.message_content}
                  </p>
                </div>
              </div>

              {/* Status Controls */}
              <div className="border-t border-[#F4F4F5] pt-4">
                <div className="text-[11px] font-bold text-[#71717A] mb-2">更新跟進狀態</div>
                <div className="flex flex-wrap gap-2">
                  {MESSAGE_STATUSES.map((st) => {
                    const isCurrent = detail.message.status === st;
                    return (
                      <button
                        key={st}
                        type="button"
                        disabled={isCurrent || Boolean(busyAction)}
                        onClick={() => void handleStatusUpdate(st)}
                        className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-colors ${
                          isCurrent
                            ? "bg-[#09090B] text-white opacity-90 cursor-default"
                            : "bg-[#F4F4F5] text-[#09090B] hover:bg-[#E4E4E7] disabled:opacity-50"
                        }`}
                      >
                        {busyAction === `status_${st}` ? "更新中…" : messageStatusLabels[st]}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Linked Conversation */}
              <div className="border-t border-[#F4F4F5] pt-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] font-bold text-[#71717A]">關聯通話 / 對話紀錄</div>
                  {detail.linked_conversation?.transcript && detail.linked_conversation.transcript.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowTranscript((v) => !v)}
                      className="text-[11px] font-bold text-[#09090B] underline"
                    >
                      {showTranscript ? "收起逐字稿" : "查看對話逐字稿"}
                    </button>
                  )}
                </div>

                {detail.linked_conversation ? (
                  <div className="mt-2 p-3.5 rounded-xl bg-[#FAFAFA] border border-[#E4E4E7] space-y-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#52525B]">
                      <span>
                        {messageChannelLabels[detail.linked_conversation.channel]} ·{" "}
                        {detail.linked_conversation.duration_seconds} 秒
                      </span>
                      <span>{formatDateTime(detail.linked_conversation.created_at)}</span>
                    </div>
                    {detail.linked_conversation.summary && (
                      <p className="text-[#3F3F46] leading-relaxed">{detail.linked_conversation.summary}</p>
                    )}
                    {showTranscript && detail.linked_conversation.transcript && (
                      <div className="mt-2 pt-2 border-t border-[#E4E4E7] space-y-1.5 max-h-56 overflow-y-auto">
                        {detail.linked_conversation.transcript.map((turn, idx) => (
                          <div key={idx} className="text-[11px] leading-relaxed">
                            <span className="font-bold text-[#09090B]">
                              {turn.role === "user" ? "訪客：" : "AI："}
                            </span>
                            <span className="text-[#52525B]">{turn.message}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="mt-1.5 text-xs text-[#71717A]">
                    {detail.message.provider_conversation_id
                      ? `對話編號 ${detail.message.provider_conversation_id}（通話結束並同步後將自動關聯對話摘要）`
                      : "暫無關聯對話紀錄"}
                  </p>
                )}
              </div>

              {/* Internal Follow-up Notes */}
              <div className="border-t border-[#F4F4F5] pt-4 space-y-3">
                <div className="text-[11px] font-bold text-[#71717A]">內部跟進備註</div>
                {detail.internal_notes.length === 0 ? (
                  <p className="text-xs text-[#71717A]">尚無內部跟進備註。</p>
                ) : (
                  <ul className="space-y-2">
                    {detail.internal_notes.map((item) => (
                      <li key={item.id} className="p-3 rounded-xl bg-[#FAFAFA] border border-[#E4E4E7] text-xs">
                        <div className="flex items-center justify-between gap-2 text-[11px] text-[#71717A]">
                          <span className="font-bold text-[#09090B]">{item.actor_label || "團隊成員"}</span>
                          <span>{formatDateTime(item.created_at)}</span>
                        </div>
                        <p className="mt-1 text-[#09090B] whitespace-pre-wrap">{item.note}</p>
                      </li>
                    ))}
                  </ul>
                )}
                <form onSubmit={handleAddNote} className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    aria-label="新增內部跟進備註"
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    placeholder="輸入跟進備註（僅供內部團隊檢視）…"
                    maxLength={2000}
                    className="flex-1 px-3.5 py-2.5 rounded-xl border border-[#E4E4E7] bg-[#FAFAFA] text-xs focus:outline-none focus:border-[#09090B]"
                  />
                  <button
                    type="submit"
                    disabled={!noteDraft.trim() || busyAction === "add_note"}
                    className="px-4 py-2.5 rounded-xl bg-[#09090B] text-white text-xs font-bold hover:bg-[#27272A] disabled:opacity-50"
                  >
                    {busyAction === "add_note" ? "儲存中…" : "新增備註"}
                  </button>
                </form>
              </div>

              {/* Activity Audit History */}
              <div className="border-t border-[#F4F4F5] pt-4 space-y-2">
                <div className="text-[11px] font-bold text-[#71717A]">狀態及活動紀錄</div>
                <ul className="space-y-2">
                  {detail.events.map((ev) => (
                    <li key={ev.id} className="flex items-start justify-between gap-3 text-xs border-l-2 border-[#E4E4E7] pl-3 py-0.5">
                      <div>
                        <span className="font-semibold text-[#09090B]">{eventDescription(ev)}</span>
                        {ev.actor_label && (
                          <span className="ml-1.5 text-[11px] text-[#71717A]">· {ev.actor_label}</span>
                        )}
                      </div>
                      <span className="text-[11px] text-[#71717A] shrink-0">{formatDateTime(ev.created_at)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
