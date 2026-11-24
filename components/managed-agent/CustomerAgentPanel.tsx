"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ChangeRequest, RequestEvent } from "@/lib/platform/agent-preferences";
import { submissionFeedback } from "@/lib/platform/agent-preferences";
import { PreferenceFields, PreferenceReadonly } from "./PreferenceFields";
import {
  MANAGED_REFRESH_EVENT,
  NOTES_MAX,
  apiJson,
  changedFields,
  charCount,
  clonePreferences,
  dispatchManagedRefresh,
  displayAvailability,
  displayText,
  emptyPreferences,
  eventLabel,
  formatDateTime,
  newIdempotencyKey,
  payloadFingerprint,
  preferencesEqual,
  statusLabel,
  statusTone,
  type Preferences,
} from "./shared";

type AgentPayload = {
  agent: {
    name: string;
    status_label: string;
    languages: string[];
    voice_name: string | null;
    service_mode: string;
    availability_24_7: boolean | null;
  };
  preferences: {
    settings: Preferences;
    version: number;
    curated_voice_id: string | null;
  };
};

type ListResponse = {
  requests: ChangeRequest[];
  total: number;
  page: number;
  pageSize: number;
};

type DetailResponse = {
  request: ChangeRequest;
  events: RequestEvent[];
};

type CustomerAgentPanelProps = {
  initialRequestId?: string | null;
  onRequestHandled?: () => void;
};

export function CustomerAgentPanel({ initialRequestId = null, onRequestHandled }: CustomerAgentPanelProps) {
  const confirmTitleId = useId();
  const submitLock = useRef(false);
  const dirtyRef = useRef(false);
  const idempotencyRef = useRef(newIdempotencyKey());
  const lastPayloadRef = useRef("");

  const [agentLoading, setAgentLoading] = useState(true);
  const [agentError, setAgentError] = useState("");
  const [agent, setAgent] = useState<AgentPayload["agent"] | null>(null);
  const [activeSettings, setActiveSettings] = useState<Preferences>(emptyPreferences);
  const [baseVersion, setBaseVersion] = useState(0);

  const [draft, setDraft] = useState<Preferences>(emptyPreferences);
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detail, setDetail] = useState<ChangeRequest | null>(null);
  const [events, setEvents] = useState<RequestEvent[]>([]);
  const [infoMessage, setInfoMessage] = useState("");
  const [actionBusy, setActionBusy] = useState("");

  const applyAgentPayload = useCallback((body: AgentPayload, forceForm: boolean) => {
    setAgent(body.agent);
    const settings = clonePreferences(body.preferences?.settings ?? emptyPreferences);
    setActiveSettings(settings);
    if (forceForm || !dirtyRef.current) {
      setBaseVersion(body.preferences?.version ?? 0);
      setDraft(clonePreferences(settings));
      setNotes("");
      dirtyRef.current = false;
      idempotencyRef.current = newIdempotencyKey();
      lastPayloadRef.current = "";
    }
  }, []);

  const loadAgent = useCallback(async (forceForm: boolean, refreshDraftBase = false) => {
    try {
      const body = await apiJson<AgentPayload>("/api/platform/customer/agent");
      applyAgentPayload(body, forceForm);
      if (refreshDraftBase) setBaseVersion(body.preferences.version);
      setAgentError("");
    } catch (err) {
      setAgentError(err instanceof Error ? err.message : "無法載入 AI 專員資料");
    } finally {
      setAgentLoading(false);
    }
  }, [applyAgentPayload]);

  const loadHistory = useCallback(async (nextPage: number, opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setHistoryLoading(true);
    try {
      const body = await apiJson<ListResponse>(`/api/platform/customer/change-requests?page=${nextPage}`);
      setRequests(Array.isArray(body.requests) ? body.requests : []);
      setTotal(typeof body.total === "number" ? body.total : 0);
      setPage(typeof body.page === "number" ? body.page : nextPage);
      setHistoryError("");
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "無法載入調整紀錄");
    } finally {
      if (!opts?.quiet) setHistoryLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string, opts?: { soft?: boolean }) => {
    const soft = opts?.soft === true;
    setSelectedId(id);
    if (!soft) {
      setDetailLoading(true);
      setDetailError("");
      setInfoMessage("");
    }
    try {
      const body = await apiJson<DetailResponse>(`/api/platform/customer/change-requests?id=${encodeURIComponent(id)}`);
      setDetail(body.request);
      setEvents(Array.isArray(body.events) ? body.events : []);
      setDetailError("");
    } catch (err) {
      if (!soft) {
        setDetail(null);
        setEvents([]);
      }
      setDetailError(err instanceof Error ? err.message : "無法載入要求詳情");
    } finally {
      if (!soft) setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAgent(true);
    void loadHistory(1);
  }, [loadAgent, loadHistory]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadAgent(false);
      void loadHistory(page, { quiet: true });
      if (selectedId) void loadDetail(selectedId, { soft: true });
    }, 15_000);
    const onRefresh = () => {
      void loadAgent(false);
      void loadHistory(page, { quiet: true });
      if (selectedId) void loadDetail(selectedId, { soft: true });
    };
    window.addEventListener(MANAGED_REFRESH_EVENT, onRefresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(MANAGED_REFRESH_EVENT, onRefresh);
    };
  }, [loadAgent, loadHistory, loadDetail, page, selectedId]);

  useEffect(() => {
    if (!initialRequestId) return;
    void loadDetail(initialRequestId);
    onRequestHandled?.();
  }, [initialRequestId, loadDetail, onRequestHandled]);

  function markDirty() {
    dirtyRef.current = true;
    setFormSuccess("");
    setFormError("");
  }

  function updateDraft(next: Preferences) {
    markDirty();
    setDraft(next);
  }

  function updateNotes(next: string) {
    markDirty();
    setNotes(next);
  }

  function validateBeforeConfirm(): string | null {
    if (agentError || agentLoading) return "請先成功載入目前生效設定，再提交調整。";
    const changes = changedFields(activeSettings, draft);
    const trimmedNotes = notes.trim();
    if (changes.length === 0 && !trimmedNotes) {
      return "請先修改至少一項偏好，或填寫補充說明。";
    }
    if (charCount(draft.greeting) > 300) return "歡迎語最多 300 字。";
    if (charCount(trimmedNotes) > NOTES_MAX) return "補充說明最多 2000 字。";
    return null;
  }

  function openConfirm() {
    const err = validateBeforeConfirm();
    if (err) {
      setFormError(err);
      return;
    }
    const fingerprint = payloadFingerprint(draft, notes);
    if (fingerprint !== lastPayloadRef.current) {
      idempotencyRef.current = newIdempotencyKey();
      lastPayloadRef.current = fingerprint;
    }
    setFormError("");
    setConfirmOpen(true);
  }

  async function submitRequest() {
    if (submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    setFormError("");
    try {
      const body = await apiJson<{ request: ChangeRequest; replayed: boolean }>("/api/platform/customer/change-requests", {
        method: "POST",
        body: JSON.stringify({
          preferences: draft,
          additional_notes: notes.trim(),
          idempotency_key: idempotencyRef.current,
          base_version: baseVersion,
        }),
      });
      const feedback = submissionFeedback(body.request, body.replayed);
      setConfirmOpen(false);
      setFormSuccess(feedback.message);
      dirtyRef.current = feedback.terminal;
      // A known result ends this attempt. Only an explicit new confirmation may
      // submit again; transport errors below retain the original retry key.
      idempotencyRef.current = newIdempotencyKey();
      lastPayloadRef.current = "";
      await loadAgent(!feedback.terminal, feedback.terminal);
      await loadHistory(1);
      if (feedback.terminal) await loadDetail(body.request.id);
      dispatchManagedRefresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "提交失敗");
      // Keep idempotency key for network/failure retry of the same payload.
    } finally {
      setSubmitting(false);
      submitLock.current = false;
    }
  }

  async function patchRequest(action: "cancel" | "provide_information", message?: string) {
    if (!detail) return;
    setActionBusy(action);
    setDetailError("");
    try {
      await apiJson("/api/platform/customer/change-requests", {
        method: "PATCH",
        body: JSON.stringify({
          id: detail.id,
          action,
          message,
          expected_version: detail.version,
        }),
      });
      dispatchManagedRefresh();
      await loadDetail(detail.id);
      await loadHistory(page);
      await loadAgent(false);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "操作失敗");
    } finally {
      setActionBusy("");
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const draftChanges = changedFields(activeSettings, draft);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight">我的 AI 專員</h1>
        <p className="mt-1 text-xs text-[#52525B]">查看現況、提交服務偏好調整，並跟進處理進度。</p>
      </header>

      {agentError && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700" role="alert">
          {agentError}
        </div>
      )}

      <section className="max-w-3xl rounded-3xl border border-[#E4E4E7] bg-white p-6 shadow-stripe-sm">
        {agentLoading ? (
          <div className="text-xs text-[#71717A]">載入 AI 專員資料中…</div>
        ) : (
          <>
            <div className="flex flex-col gap-3 border-b border-[#E4E4E7] pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-base font-extrabold">{displayText(agent?.name)}</div>
                <div className="mt-0.5 text-xs text-[#52525B]">Orai Managed Voice Service</div>
              </div>
              <span className="inline-flex w-fit rounded-full bg-[#F4F4F5] px-3 py-1 text-xs font-bold text-[#3F3F46]">
                {displayText(agent?.status_label)}
              </span>
            </div>
            <dl className="mt-4 space-y-3 text-xs">
              <div className="flex justify-between gap-4 border-b border-slate-100 py-1">
                <dt className="text-[#52525B]">支援語言</dt>
                <dd className="text-right font-bold">
                  {agent?.languages?.length ? agent.languages.join("、") : "待確認"}
                </dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-slate-100 py-1">
                <dt className="text-[#52525B]">聲線音色</dt>
                <dd className="text-right font-bold">{displayText(agent?.voice_name)}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-slate-100 py-1">
                <dt className="text-[#52525B]">服務模式</dt>
                <dd className="text-right font-bold">{displayText(agent?.service_mode)}</dd>
              </div>
              <div className="flex justify-between gap-4 py-1">
                <dt className="text-[#52525B]">服務時段</dt>
                <dd className="text-right font-bold">{displayAvailability(agent?.availability_24_7 ?? null)}</dd>
              </div>
            </dl>
          </>
        )}
      </section>

      <section className="max-w-3xl space-y-4 rounded-3xl border border-[#E4E4E7] bg-white p-6 shadow-stripe-sm">
        <div>
          <h2 className="text-base font-extrabold">提交服務偏好調整</h2>
          <p className="mt-1 text-xs leading-relaxed text-[#71717A]">
            下方顯示現況偏好。修改後可提交給 Orai 專人處理；未選定的項目會顯示「待確認」。
          </p>
        </div>

        {formError && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700" role="alert">
            {formError}
          </div>
        )}
        {formSuccess && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
            {formSuccess}
          </div>
        )}

        <PreferenceFields
          idPrefix="customer-agent"
          value={draft}
          current={activeSettings}
          onChange={updateDraft}
          showNotes
          notes={notes}
          onNotesChange={updateNotes}
          highlightKeys={draftChanges}
          disabled={agentLoading || Boolean(agentError) || submitting}
        />

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E4E4E7] pt-4">
          <p className="text-[11px] text-[#71717A]">
            {draftChanges.length > 0
              ? `將提交 ${draftChanges.length} 項變更${notes.trim() ? "，並附補充說明" : ""}`
              : notes.trim()
                ? "將提交補充說明（偏好與現況相同）"
                : "尚未有可提交的變更"}
          </p>
          <button
            type="button"
            onClick={openConfirm}
            disabled={agentLoading || Boolean(agentError) || submitting || (preferencesEqual(activeSettings, draft) && !notes.trim())}
            className="rounded-xl bg-[#09090B] px-5 py-2.5 text-xs font-bold text-white hover:bg-[#27272A] disabled:opacity-50"
          >
            提交調整要求
          </button>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-extrabold">調整紀錄</h2>
            <p className="mt-1 text-xs text-[#71717A]">包含全部狀態的要求歷史。</p>
          </div>
          <button
            type="button"
            onClick={() => void loadHistory(page)}
            className="rounded-xl border border-[#E4E4E7] bg-white px-3 py-2 text-[11px] font-bold text-[#52525B] hover:bg-[#F4F4F5]"
          >
            重新整理
          </button>
        </div>

        {historyError && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700" role="alert">
            {historyError}
          </div>
        )}

        <div className="overflow-hidden rounded-3xl border border-[#E4E4E7] bg-white shadow-stripe-sm">
          {historyLoading ? (
            <div className="p-8 text-center text-xs text-[#71717A]">載入調整紀錄中…</div>
          ) : requests.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#71717A]">尚未有調整要求</div>
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
                      <div className="text-xs font-extrabold text-[#09090B]">{item.reference}</div>
                      <div className="mt-1 text-[11px] text-[#71717A]">
                        {formatDateTime(item.created_at)}
                        {item.changed_fields?.length ? ` · 變更 ${item.changed_fields.length} 項` : ""}
                      </div>
                    </div>
                    <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-[11px] font-bold ${statusTone(item.status)}`}>
                      {statusLabel(item.status)}
                    </span>
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
              disabled={page <= 1 || historyLoading}
              onClick={() => void loadHistory(page - 1)}
              className="rounded-xl border border-[#E4E4E7] bg-white px-3 py-2 font-bold disabled:opacity-40"
            >
              上一頁
            </button>
            <span className="text-[#71717A]">
              第 {page} / {totalPages} 頁
            </span>
            <button
              type="button"
              disabled={page >= totalPages || historyLoading}
              onClick={() => void loadHistory(page + 1)}
              className="rounded-xl border border-[#E4E4E7] bg-white px-3 py-2 font-bold disabled:opacity-40"
            >
              下一頁
            </button>
          </div>
        )}
      </section>

      {selectedId && (
        <section className="space-y-4 rounded-3xl border border-[#E4E4E7] bg-white p-6 shadow-stripe-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-extrabold">要求詳情</h2>
              <p className="mt-1 text-xs text-[#71717A]">參考編號與處理進度</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedId(null);
                setDetail(null);
                setEvents([]);
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

          {detail && !detailLoading && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-extrabold">{detail.reference}</span>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${statusTone(detail.status)}`}>
                  {statusLabel(detail.status)}
                </span>
              </div>
              <dl className="grid gap-2 text-xs sm:grid-cols-2">
                <div className="rounded-xl bg-[#FAFAFA] px-3 py-2">
                  <dt className="text-[#71717A]">提交日期</dt>
                  <dd className="mt-1 font-bold">{formatDateTime(detail.created_at)}</dd>
                </div>
                <div className="rounded-xl bg-[#FAFAFA] px-3 py-2">
                  <dt className="text-[#71717A]">完成日期</dt>
                  <dd className="mt-1 font-bold">{formatDateTime(detail.completed_at)}</dd>
                </div>
              </dl>

              <div className="grid gap-4 lg:grid-cols-2">
                <PreferenceReadonly title="提交時現況" preferences={detail.previous_settings} />
                <PreferenceReadonly
                  title="要求變更"
                  preferences={detail.requested_settings}
                  highlightKeys={detail.changed_fields || []}
                />
              </div>

              {detail.additional_notes?.trim() && (
                <div className="rounded-2xl border border-[#E4E4E7] bg-[#FAFAFA] p-4 text-xs leading-relaxed">
                  <div className="font-extrabold text-[#09090B]">補充說明</div>
                  <p className="mt-2 whitespace-pre-wrap text-[#52525B]">{detail.additional_notes}</p>
                </div>
              )}

              {detail.customer_visible_response?.trim() && (
                <div className="rounded-2xl border border-[#E4E4E7] bg-white p-4 text-xs leading-relaxed">
                  <div className="font-extrabold text-[#09090B]">Orai 回覆</div>
                  <p className="mt-2 whitespace-pre-wrap text-[#52525B]">{detail.customer_visible_response}</p>
                </div>
              )}

              {detail.final_applied_settings && (
                <PreferenceReadonly title="最終生效設定" preferences={detail.final_applied_settings} />
              )}

              {detail.status === "pending" && (
                <button
                  type="button"
                  disabled={actionBusy === "cancel"}
                  onClick={() => void patchRequest("cancel")}
                  className="rounded-xl border border-[#E4E4E7] bg-white px-4 py-2.5 text-xs font-bold text-[#52525B] hover:bg-[#F4F4F5] disabled:opacity-50"
                >
                  {actionBusy === "cancel" ? "取消中…" : "取消此要求"}
                </button>
              )}

              {detail.status === "needs_information" && (
                <div className="space-y-3 rounded-2xl border border-[#E4E4E7] p-4">
                  <label htmlFor="customer-info-message" className="block text-xs font-extrabold">
                    補充資料給 Orai
                  </label>
                  <textarea
                    id="customer-info-message"
                    rows={4}
                    value={infoMessage}
                    onChange={(event) => {
                      const next = event.target.value;
                      if (charCount(next) <= NOTES_MAX) setInfoMessage(next);
                    }}
                    placeholder="請補充 Orai 所需的資料…"
                    className="w-full resize-y rounded-xl border border-[#E4E4E7] px-3 py-2.5 text-sm focus:border-[#09090B] focus:outline-none"
                  />
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[11px] text-[#71717A]">
                      {charCount(infoMessage)} / {NOTES_MAX}
                    </span>
                    <button
                      type="button"
                      disabled={actionBusy === "provide_information" || !infoMessage.trim()}
                      onClick={() => void patchRequest("provide_information", infoMessage.trim())}
                      className="rounded-xl bg-[#09090B] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50"
                    >
                      {actionBusy === "provide_information" ? "送出中…" : "送出補充資料"}
                    </button>
                  </div>
                </div>
              )}

              <div>
                <h3 className="text-xs font-extrabold text-[#09090B]">進度紀錄</h3>
                {events.length === 0 ? (
                  <p className="mt-2 text-xs text-[#71717A]">尚無事件</p>
                ) : (
                  <ol className="mt-3 space-y-2">
                    {events.map((event) => (
                      <li key={event.id} className="rounded-xl bg-[#FAFAFA] px-3 py-2 text-xs">
                        <div className="font-bold text-[#09090B]">{eventLabel(event.kind)}</div>
                        {event.message?.trim() && (
                          <p className="mt-1 whitespace-pre-wrap text-[#52525B]">{event.message}</p>
                        )}
                        <div className="mt-1 text-[11px] text-[#71717A]">{formatDateTime(event.created_at)}</div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={confirmTitleId}
            className="w-full max-w-md rounded-3xl border border-[#E4E4E7] bg-white p-6 shadow-stripe-md"
          >
            {formError && <p role="alert" className="mb-3 text-xs text-rose-700">{formError}</p>}
            <h2 id={confirmTitleId} className="text-base font-extrabold">
              確認提交調整要求？
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-[#52525B]">
              將送出 {draftChanges.length} 項偏好變更
              {notes.trim() ? "，以及你的補充說明" : ""}。提交後由 Orai 專人審核。
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setConfirmOpen(false)}
                className="rounded-xl border border-[#E4E4E7] px-4 py-2.5 text-xs font-bold text-[#52525B]"
              >
                返回修改
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void submitRequest()}
                className="rounded-xl bg-[#09090B] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50"
              >
                {submitting ? "提交中…" : "確認提交"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
