"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ChangeRequest, RequestEvent, RequestStatus } from "@/lib/platform/agent-preferences";
import { PreferenceFields, PreferenceReadonly } from "./PreferenceFields";
import {
  MANAGED_REFRESH_EVENT,
  NOTES_MAX,
  apiJson,
  changedFields,
  charCount,
  clonePreferences,
  dispatchManagedRefresh,
  emptyPreferences,
  eventLabel,
  formatDateTime,
  statusLabel,
  statusTone,
  statusLabels,
  preferenceLabels,
  type Preferences,
} from "./shared";

type Counts = {
  pending: number;
  in_progress: number;
  needs_information: number;
  completed: number;
  rejected: number;
  cancelled: number;
};

type ListResponse = {
  requests: ChangeRequest[];
  total: number;
  page: number;
  pageSize: number;
  counts: Counts;
};

type DetailResponse = {
  request: ChangeRequest;
  events: RequestEvent[];
  internal_notes: RequestEvent[];
  active_preferences: {
    settings: Preferences;
    version: number;
    curated_voice_id: string | null;
  };
  merchant: { name: string; slug: string };
  legacy_instructions: string;
};

type AdminChangeRequestsPanelProps = {
  initialRequestId?: string | null;
  onRequestHandled?: () => void;
  onCountsChange?: (counts: Counts) => void;
};

const EMPTY_COUNTS: Counts = {
  pending: 0,
  in_progress: 0,
  needs_information: 0,
  completed: 0,
  rejected: 0,
  cancelled: 0,
};

export function AdminChangeRequestsPanel({
  initialRequestId = null,
  onRequestHandled,
  onCountsChange,
}: AdminChangeRequestsPanelProps) {
  const completeTitleId = useId();
  const actionLock = useRef(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [countsKnown, setCountsKnown] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<"" | RequestStatus>("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [sort, setSort] = useState<"asc" | "desc">("desc");
  const pageSize = 20;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detail, setDetail] = useState<DetailResponse | null>(null);

  const [message, setMessage] = useState("");
  const [noteMessage, setNoteMessage] = useState("");
  const [finalPrefs, setFinalPrefs] = useState<Preferences>(emptyPreferences);
  const [manualConfirmed, setManualConfirmed] = useState(false);
  const [reviewStale, setReviewStale] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [reviewedActiveVersion, setReviewedActiveVersion] = useState(0);
  const [actionBusy, setActionBusy] = useState("");
  const [showLegacy, setShowLegacy] = useState(false);

  const loadList = useCallback(async (opts?: {
    page?: number;
    status?: "" | RequestStatus;
    search?: string;
    sort?: "asc" | "desc";
    quiet?: boolean;
  }) => {
    const nextPage = opts?.page ?? page;
    const nextStatus = opts?.status ?? status;
    const nextSearch = opts?.search ?? search;
    const nextSort = opts?.sort ?? sort;
    if (!opts?.quiet) setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        sort: nextSort,
      });
      if (nextStatus) params.set("status", nextStatus);
      if (nextSearch.trim()) params.set("search", nextSearch.trim());
      const body = await apiJson<ListResponse>(`/api/platform/admin/change-requests?${params.toString()}`);
      const nextCounts = body.counts || EMPTY_COUNTS;
      setRequests(Array.isArray(body.requests) ? body.requests : []);
      setCounts(nextCounts);
      setCountsKnown(Boolean(body.counts));
      setTotal(typeof body.total === "number" ? body.total : 0);
      setPage(typeof body.page === "number" ? body.page : nextPage);
      onCountsChange?.(nextCounts);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "無法載入調整要求");
    } finally {
      if (!opts?.quiet) setLoading(false);
    }
  }, [onCountsChange, page, search, sort, status]);

  const loadDetail = useCallback(async (id: string, opts?: { soft?: boolean }) => {
    const soft = opts?.soft === true;
    setSelectedId(id);
    if (!soft) {
      setDetailLoading(true);
      setDetailError("");
      setCompleteOpen(false);
      setMessage("");
      setNoteMessage("");
      setManualConfirmed(false);
      setReviewStale(false);
      setShowLegacy(false);
    }
    try {
      const body = await apiJson<DetailResponse>(`/api/platform/admin/change-requests?id=${encodeURIComponent(id)}`);
      setDetail(body);
      if (!soft) {
        setFinalPrefs(clonePreferences(body.request.requested_settings || body.active_preferences.settings || emptyPreferences));
        setReviewStale(false);
      }
      setDetailError("");
    } catch (err) {
      if (!soft) {
        setDetail(null);
      }
      setDetailError(err instanceof Error ? err.message : "無法載入要求詳情");
    } finally {
      if (!soft) setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList({ page: 1 });
    // Intentionally mount-only; filters trigger loadList explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadList({ quiet: true });
      if (selectedId) void loadDetail(selectedId, { soft: true });
    }, 15_000);
    const onRefresh = () => {
      void loadList({ quiet: true });
      if (selectedId) void loadDetail(selectedId, { soft: true });
    };
    window.addEventListener(MANAGED_REFRESH_EVENT, onRefresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(MANAGED_REFRESH_EVENT, onRefresh);
    };
  }, [loadList, loadDetail, selectedId]);

  useEffect(() => {
    if (!initialRequestId) return;
    void loadDetail(initialRequestId);
    onRequestHandled?.();
  }, [initialRequestId, loadDetail, onRequestHandled]);

  async function runAction(
    action: "start" | "needs_information" | "complete" | "reject" | "add_note",
    extra?: Record<string, unknown>,
  ) {
    if (!detail || actionLock.current) return;
    actionLock.current = true;
    setActionBusy(action);
    setDetailError("");
    try {
      await apiJson("/api/platform/admin/change-requests", {
        method: "PATCH",
        body: JSON.stringify({
          id: detail.request.id,
          action,
          expected_version: detail.request.version,
          ...extra,
        }),
      });
      setCompleteOpen(false);
      setMessage("");
      setNoteMessage("");
      dispatchManagedRefresh();
      await loadDetail(detail.request.id);
      await loadList();
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "操作失敗");
    } finally {
      setActionBusy("");
      actionLock.current = false;
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const request = detail?.request;
  const isStale = Boolean(detail && detail.active_preferences.version !== detail.request.base_version);
  const changed = request?.changed_fields || (request ? changedFields(request.previous_settings, request.requested_settings) : []);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight">調整要求</h1>
        <p className="mt-1 text-xs text-[#52525B]">審核商戶 AI 專員偏好調整，並記錄處理進度。</p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "待處理", value: counts.pending },
          { label: "處理中", value: counts.in_progress },
          { label: "待補充", value: counts.needs_information },
          { label: "已生效", value: counts.completed },
        ].map((card) => (
          <div key={card.label} className="rounded-2xl border border-[#E4E4E7] bg-white p-5 shadow-stripe-sm">
            <div className="text-xs font-bold uppercase text-[#52525B]">{card.label}</div>
            <div className="mt-2 text-3xl font-extrabold text-[#09090B]">{countsKnown ? card.value : "—"}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3 rounded-3xl border border-[#E4E4E7] bg-white p-4 shadow-stripe-sm lg:flex-row lg:items-end">
        <div className="flex-1">
          <label htmlFor="admin-request-search" className="block text-[11px] font-bold text-[#52525B]">
            搜尋商戶
          </label>
          <input
            id="admin-request-search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="商戶名稱"
            className="mt-1.5 w-full rounded-xl border border-[#E4E4E7] px-3 py-2.5 text-xs focus:border-[#09090B] focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="admin-request-status" className="block text-[11px] font-bold text-[#52525B]">
            狀態
          </label>
          <select
            id="admin-request-status"
            value={status}
            onChange={(event) => {
              const next = event.target.value as "" | RequestStatus;
              setStatus(next);
              void loadList({ page: 1, status: next });
            }}
            className="mt-1.5 rounded-xl border border-[#E4E4E7] bg-white px-3 py-2.5 text-xs focus:border-[#09090B] focus:outline-none"
          >
            <option value="">全部狀態</option>
            {(Object.keys(statusLabels) as RequestStatus[]).map((key) => (
              <option key={key} value={key}>
                {statusLabels[key]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="admin-request-sort" className="block text-[11px] font-bold text-[#52525B]">
            日期排序
          </label>
          <select
            id="admin-request-sort"
            value={sort}
            onChange={(event) => {
              const next = event.target.value as "asc" | "desc";
              setSort(next);
              void loadList({ page: 1, sort: next });
            }}
            className="mt-1.5 rounded-xl border border-[#E4E4E7] bg-white px-3 py-2.5 text-xs focus:border-[#09090B] focus:outline-none"
          >
            <option value="desc">最新優先</option>
            <option value="asc">最舊優先</option>
          </select>
        </div>
        <button
          type="button"
          onClick={() => {
            setSearch(searchInput);
            void loadList({ page: 1, search: searchInput });
          }}
          className="rounded-xl bg-[#09090B] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#27272A]"
        >
          套用篩選
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700" role="alert">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-3xl border border-[#E4E4E7] bg-white shadow-stripe-sm">
        {loading ? (
          <div className="p-8 text-center text-xs text-[#71717A]">載入調整要求中…</div>
        ) : requests.length === 0 ? (
          <div className="p-8 text-center text-xs text-[#71717A]">沒有符合條件的要求</div>
        ) : (
          <ul className="divide-y divide-[#F4F4F5]">
            {requests.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => void loadDetail(item.id)}
                  className={`flex w-full flex-col gap-2 px-4 py-4 text-left hover:bg-[#FAFAFA] sm:flex-row sm:items-center sm:justify-between ${
                    selectedId === item.id ? "bg-[#FAFAFA]" : ""
                  }`}
                >
                  <div>
                    <div className="text-xs font-extrabold text-[#09090B]">
                      {item.organizations?.name || "商戶"} · {item.reference}
                    </div>
                    <div className="mt-1 text-[11px] text-[#71717A]">
                      {item.organizations?.slug ? `${item.organizations.slug} · ` : ""}
                      {formatDateTime(item.created_at)} · 更新：{formatDateTime(item.updated_at)}
                      {item.overdue ? " · 逾時超過 24 小時" : ""}
                      <div className="mt-1">{item.changed_fields.map(key => preferenceLabels[key]).join("、") || "其他調整要求"} · 負責管理員：{item.assigned_admin_id || "未指派"}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {item.overdue && (
                      <span className="rounded-full bg-[#F4F4F5] px-2 py-1 text-[10px] font-bold text-[#52525B]">逾時</span>
                    )}
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${statusTone(item.status)}`}>
                      {statusLabel(item.status)}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {total > pageSize && (
        <div className="flex items-center justify-between gap-3 text-xs">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => void loadList({ page: page - 1 })}
            className="rounded-xl border border-[#E4E4E7] bg-white px-3 py-2 font-bold disabled:opacity-40"
          >
            上一頁
          </button>
          <span className="text-[#71717A]">
            第 {page} / {totalPages} 頁
          </span>
          <button
            type="button"
            disabled={page >= totalPages || loading}
            onClick={() => void loadList({ page: page + 1 })}
            className="rounded-xl border border-[#E4E4E7] bg-white px-3 py-2 font-bold disabled:opacity-40"
          >
            下一頁
          </button>
        </div>
      )}

      {selectedId && (
        <section className="space-y-4 rounded-3xl border border-[#E4E4E7] bg-white p-6 shadow-stripe-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-extrabold">要求詳情</h2>
              <p className="mt-1 text-xs text-[#71717A]">現況偏好與要求變更並排比對</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedId(null);
                setDetail(null);
                setDetailError("");
              }}
              className="text-[11px] font-bold text-[#52525B] hover:text-[#09090B]"
            >
              關閉
            </button>
          </div>

          {detailLoading && <div className="text-xs text-[#71717A]">載入詳情中…</div>}
          {detailError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700" role="alert">
              {detailError}
            </div>
          )}

          {detail && request && !detailLoading && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-extrabold">
                  {detail.merchant.name} · {request.reference}
                </span>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${statusTone(request.status)}`}>
                  {statusLabel(request.status)}
                </span>
                {isStale && (
                  <span className="rounded-full bg-[#F4F4F5] px-2.5 py-1 text-[11px] font-bold text-[#52525B]">
                    現況版本已變更
                  </span>
                )}
              </div>

              <dl className="grid gap-2 text-xs sm:grid-cols-3">
                <div className="rounded-xl bg-[#FAFAFA] px-3 py-2">
                  <dt className="text-[#71717A]">商戶</dt>
                  <dd className="mt-1 font-bold">{detail.merchant.name} ({detail.merchant.slug})</dd>
                </div>
                <div className="rounded-xl bg-[#FAFAFA] px-3 py-2">
                  <dt className="text-[#71717A]">提交時間</dt>
                  <dd className="mt-1 font-bold">{formatDateTime(request.created_at)}</dd>
                </div>
                <div className="rounded-xl bg-[#FAFAFA] px-3 py-2">
                  <dt className="text-[#71717A]">指派管理員</dt>
                  <dd className="mt-1 font-bold">{request.assigned_admin_id || "尚未指派"}</dd>
                </div>
              </dl>

              {isStale && (
                <div className="rounded-2xl border border-[#E4E4E7] bg-[#FAFAFA] px-4 py-3 text-xs font-semibold text-[#52525B]" role="status">
                  提交時的 生效 版本（{request.base_version}）與目前 生效 版本（{detail.active_preferences.version}）不一致。完成前請勾選已覆核過期快照。
                </div>
              )}

              <div className="grid gap-4 lg:grid-cols-2">
                <PreferenceReadonly title="目前 生效 設定" preferences={detail.active_preferences.settings} />
                <PreferenceReadonly
                  title="商戶要求變更"
                  preferences={request.requested_settings}
                  highlightKeys={changed}
                />
              </div>

              <PreferenceReadonly title="提交時快照" preferences={request.previous_settings} />
              {request.final_applied_settings && <PreferenceReadonly title="實際生效設定" preferences={request.final_applied_settings} />}

              {request.additional_notes?.trim() && (
                <div className="rounded-2xl border border-[#E4E4E7] bg-[#FAFAFA] p-4 text-xs">
                  <div className="font-extrabold">商戶補充說明</div>
                  <p className="mt-2 whitespace-pre-wrap text-[#52525B]">{request.additional_notes}</p>
                </div>
              )}

              {request.customer_visible_response?.trim() && (
                <div className="rounded-2xl border border-[#E4E4E7] p-4 text-xs">
                  <div className="font-extrabold">對商戶可見回覆</div>
                  <p className="mt-2 whitespace-pre-wrap text-[#52525B]">{request.customer_visible_response}</p>
                </div>
              )}

              <div>
                <button
                  type="button"
                  onClick={() => setShowLegacy((value) => !value)}
                  className="text-xs font-bold text-[#52525B] hover:text-[#09090B]"
                >
                  {showLegacy ? "收起舊版指示" : "顯示舊版指示（管理員）"}
                </button>
                {showLegacy && (
                  <pre className="mt-2 whitespace-pre-wrap rounded-2xl border border-[#E4E4E7] bg-[#FAFAFA] p-4 text-[11px] leading-relaxed text-[#52525B]">
                    {detail.legacy_instructions?.trim() || "沒有舊版指示"}
                  </pre>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {request.status === "pending" && (
                  <button
                    type="button"
                    disabled={!!actionBusy}
                    onClick={() => void runAction("start")}
                    className="rounded-xl bg-[#09090B] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50"
                  >
                    {actionBusy === "start" ? "開始中…" : "開始處理"}
                  </button>
                )}

                {(request.status === "pending" || request.status === "in_progress" || request.status === "needs_information") && (
                  <button
                    type="button"
                    disabled={!!actionBusy || !message.trim()}
                    onClick={() => void runAction("reject", { message: message.trim() })}
                    className="rounded-xl border border-[#E4E4E7] px-4 py-2.5 text-xs font-bold text-[#52525B] disabled:opacity-50"
                  >
                    {actionBusy === "reject" ? "拒絕中…" : "拒絕（需填原因）"}
                  </button>
                )}

                {request.status === "in_progress" && (
                  <>
                    <button
                      type="button"
                      disabled={!!actionBusy || !message.trim()}
                      onClick={() => void runAction("needs_information", { message: message.trim() })}
                      className="rounded-xl border border-[#E4E4E7] px-4 py-2.5 text-xs font-bold text-[#52525B] disabled:opacity-50"
                    >
                      {actionBusy === "needs_information" ? "送出中…" : "要求補充資料"}
                    </button>
                    <button
                      type="button"
                      disabled={!!actionBusy}
                    onClick={() => {
                      setReviewedActiveVersion(detail.active_preferences.version);
                      setManualConfirmed(false);
                      setReviewStale(false);
                      setCompleteOpen(true);
                    }}
                      className="rounded-xl bg-[#09090B] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50"
                    >
                      完成並套用
                    </button>
                  </>
                )}
              </div>

              {(request.status === "pending" || request.status === "in_progress" || request.status === "needs_information") && (
                <div className="space-y-2">
                  <label htmlFor="admin-visible-message" className="block text-xs font-extrabold">
                    對商戶可見訊息（拒絕 / 要求補充時必填）
                  </label>
                  <textarea
                    id="admin-visible-message"
                    rows={3}
                    value={message}
                    onChange={(event) => {
                      const next = event.target.value;
                      if (charCount(next) <= NOTES_MAX) setMessage(next);
                    }}
                    className="w-full resize-y rounded-xl border border-[#E4E4E7] px-3 py-2.5 text-sm focus:border-[#09090B] focus:outline-none"
                  />
                  <div className="text-right text-[11px] text-[#71717A]">
                    {charCount(message)} / {NOTES_MAX}
                  </div>
                </div>
              )}

              <div className="space-y-2 rounded-2xl border border-[#E4E4E7] p-4">
                <label htmlFor="admin-internal-note" className="block text-xs font-extrabold">
                  內部備註（商戶不可見）
                </label>
                <textarea
                  id="admin-internal-note"
                  rows={3}
                  value={noteMessage}
                  onChange={(event) => {
                    const next = event.target.value;
                    if (charCount(next) <= NOTES_MAX) setNoteMessage(next);
                  }}
                  className="w-full resize-y rounded-xl border border-[#E4E4E7] px-3 py-2.5 text-sm focus:border-[#09090B] focus:outline-none"
                />
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] text-[#71717A]">
                    {charCount(noteMessage)} / {NOTES_MAX}
                  </span>
                  <button
                    type="button"
                    disabled={!!actionBusy || !noteMessage.trim()}
                    onClick={() => void runAction("add_note", { message: noteMessage.trim() })}
                    className="rounded-xl border border-[#E4E4E7] px-4 py-2 text-xs font-bold disabled:opacity-50"
                  >
                    {actionBusy === "add_note" ? "儲存中…" : "新增內部備註"}
                  </button>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <h3 className="text-xs font-extrabold">審計 / 商戶可見事件</h3>
                  {detail.events.length === 0 ? (
                    <p className="mt-2 text-xs text-[#71717A]">尚無事件</p>
                  ) : (
                    <ol className="mt-3 space-y-2">
                      {detail.events.map((event) => (
                        <li key={event.id} className="rounded-xl bg-[#FAFAFA] px-3 py-2 text-xs">
                          <div className="font-bold">{eventLabel(event.kind)}</div>
                          {event.message?.trim() && <p className="mt-1 whitespace-pre-wrap text-[#52525B]">{event.message}</p>}
                          <div className="mt-1 text-[11px] text-[#71717A]">{formatDateTime(event.created_at)}</div>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
                <div>
                  <h3 className="text-xs font-extrabold">內部備註</h3>
                  {detail.internal_notes.length === 0 ? (
                    <p className="mt-2 text-xs text-[#71717A]">尚無內部備註</p>
                  ) : (
                    <ol className="mt-3 space-y-2">
                      {detail.internal_notes.map((event) => (
                        <li key={event.id} className="rounded-xl bg-[#FAFAFA] px-3 py-2 text-xs">
                          <div className="font-bold">{eventLabel(event.kind)}</div>
                          {event.message?.trim() && <p className="mt-1 whitespace-pre-wrap text-[#52525B]">{event.message}</p>}
                          <div className="mt-1 text-[11px] text-[#71717A]">{formatDateTime(event.created_at)}</div>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {completeOpen && detail && request && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={completeTitleId}
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-[#E4E4E7] bg-white p-6 shadow-stripe-md"
          >
            {detailError && <p role="alert" className="mb-3 text-xs text-rose-700">{detailError}</p>}
            <h2 id={completeTitleId} className="text-base font-extrabold">
              確認完成並套用設定
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-[#52525B]">
              請確認最終偏好，並核實已在 ElevenLabs 手動更新及測試。系統不會代為呼叫 ElevenLabs API。
            </p>

            <div className="mt-4">
              <PreferenceFields
                idPrefix="admin-final"
                value={finalPrefs}
                onChange={setFinalPrefs}
                current={detail.active_preferences.settings}
                highlightKeys={changedFields(detail.active_preferences.settings, finalPrefs)}
              />
            </div>

            <label className="mt-4 flex items-start gap-2 text-xs font-semibold text-[#09090B]">
              <input
                type="checkbox"
                checked={manualConfirmed}
                onChange={(event) => setManualConfirmed(event.target.checked)}
                className="mt-0.5"
              />
              <span>我已在 ElevenLabs 手動更新此專員，並完成實際對話測試。</span>
            </label>

            {isStale && (
              <label className="mt-3 flex items-start gap-2 text-xs font-semibold text-[#09090B]">
                <input
                  type="checkbox"
                  checked={reviewStale}
                  onChange={(event) => setReviewStale(event.target.checked)}
                  className="mt-0.5"
                />
                <span>我已覆核舊設定與目前生效設定的差異，仍要完成此要求。</span>
              </label>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={!!actionBusy}
                onClick={() => setCompleteOpen(false)}
                className="rounded-xl border border-[#E4E4E7] px-4 py-2.5 text-xs font-bold text-[#52525B]"
              >
                返回
              </button>
              <button
                type="button"
                disabled={!!actionBusy || !manualConfirmed || (isStale && !reviewStale)}
                onClick={() =>
                  void runAction("complete", {
                    final_preferences: finalPrefs,
                    expected_active_version: reviewedActiveVersion,
                    manual_update_confirmed: true,
                    review_stale: isStale ? true : undefined,
                  })
                }
                className="rounded-xl bg-[#09090B] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50"
              >
                {actionBusy === "complete" ? "完成中…" : "確認完成"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export type AdminRequestCounts = Counts;
