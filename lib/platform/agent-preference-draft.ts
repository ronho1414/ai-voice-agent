import { changedFields, emptyPreferences, isTerminalRequestStatus, type Preferences, type RequestStatus } from "./agent-preferences";
import type { ExistingChangeRequest } from "./managed-agent-errors";

export type ActivePreferenceSnapshot = { settings: Preferences; version: number };
export type SubmissionAttempt = { preferences: Preferences; additional_notes: string; base_version: number; idempotency_key: string };
export type PreferenceDraft = {
  baseline: ActivePreferenceSnapshot | null;
  latest: ActivePreferenceSnapshot | null;
  preferences: Preferences;
  notes: string;
  dirty: boolean;
  reviewRequired: boolean;
  needsRefresh: boolean;
  attempt: SubmissionAttempt | null;
  refreshEpoch: number;
  duplicateEpoch: number;
  duplicateAttempt: SubmissionAttempt | null;
  duplicateRequest: ExistingChangeRequest | null;
};
export const initialPreferenceDraft: PreferenceDraft = {
  baseline: null,
  latest: null,
  preferences: emptyPreferences,
  notes: "",
  dirty: false,
  reviewRequired: false,
  needsRefresh: false,
  attempt: null,
  refreshEpoch: 0,
  duplicateEpoch: 0,
  duplicateAttempt: null,
  duplicateRequest: null,
};
export function isDuplicateDraft(state: PreferenceDraft): boolean {
  return Boolean(state.duplicateAttempt && state.duplicateAttempt.additional_notes === state.notes.trim() && !changedFields(state.duplicateAttempt.preferences, state.preferences).length);
}
export function matchesDuplicateRequest(state: PreferenceDraft, request: { id: string; requested_settings: Preferences; additional_notes: string }): boolean {
  if (!state.duplicateAttempt) return false;
  if (state.duplicateRequest) return state.duplicateRequest.id === request.id;
  const submitted = { ...state.duplicateAttempt.preferences, greeting: state.duplicateAttempt.preferences.greeting.trim() };
  return state.duplicateAttempt.additional_notes === request.additional_notes && !changedFields(submitted, request.requested_settings).length;
}

// Only fields the customer actually edited are carried onto a newer baseline.
// Simultaneous edits to the same field remain visible for explicit review.
export function reviewedPreferences(state: PreferenceDraft): Preferences {
  if (!state.latest || !state.baseline) return { ...state.preferences };
  const next = { ...state.latest.settings };
  for (const key of changedFields(state.baseline.settings, state.preferences)) {
    Object.assign(next, { [key]: state.preferences[key] });
  }
  return next;
}

type DraftEvent =
  | { type: "receive"; snapshot: ActivePreferenceSnapshot; epoch: number }
  | { type: "preferences"; preferences: Preferences }
  | { type: "notes"; notes: string }
  | { type: "conflict" | "terminal" | "refresh_failed" | "accepted" }
  | { type: "review"; version: number }
  | { type: "prepare"; key: string };
export type DuplicateEvent =
  | { type: "duplicate"; existingRequest?: ExistingChangeRequest }
  | { type: "duplicate_matched"; epoch: number; existingRequest: ExistingChangeRequest }
  | { type: "duplicate_resolved"; epoch?: number; requestId?: string };

export function preferenceDraftTransition(state: PreferenceDraft, event: DraftEvent | DuplicateEvent): PreferenceDraft {
  switch (event.type) {
    case "receive": {
      const { snapshot } = event;
      if (event.epoch !== state.refreshEpoch) return state;
      if (state.latest && snapshot.version < state.latest.version) return state;
      const latest = { ...snapshot, settings: { ...snapshot.settings } };
      if (!state.dirty && !state.attempt && !state.reviewRequired && !state.duplicateAttempt) {
        return {
          ...initialPreferenceDraft,
          refreshEpoch: state.refreshEpoch,
          duplicateEpoch: state.duplicateEpoch,
          latest,
          baseline: latest,
          preferences: { ...latest.settings },
        };
      }
      return { ...state, latest, needsRefresh: false, reviewRequired: state.reviewRequired || snapshot.version !== state.baseline?.version };
    }
    case "preferences": return { ...state, preferences: { ...event.preferences }, dirty: true };
    case "notes": return { ...state, notes: event.notes, dirty: true };
    case "conflict":
    case "terminal": return { ...state, dirty: true, reviewRequired: true, needsRefresh: true, refreshEpoch: state.refreshEpoch + 1 };
    case "refresh_failed": return { ...state, needsRefresh: state.needsRefresh || state.reviewRequired };
    case "duplicate":
      return { ...state, duplicateAttempt: state.attempt, duplicateRequest: event.existingRequest ?? null, duplicateEpoch: state.duplicateEpoch + 1 };
    case "duplicate_matched":
      if (!state.duplicateAttempt || event.epoch !== state.duplicateEpoch) return state;
      return { ...state, duplicateRequest: event.existingRequest };
    case "duplicate_resolved":
      if (!state.duplicateAttempt) return state;
      if (event.epoch !== undefined && event.epoch !== state.duplicateEpoch) return state;
      if (event.requestId && state.duplicateRequest && event.requestId !== state.duplicateRequest.id) return state;
      return {
        ...state,
        duplicateAttempt: null,
        duplicateRequest: null,
        duplicateEpoch: state.duplicateEpoch + 1,
        attempt: state.attempt?.idempotency_key === state.duplicateAttempt?.idempotency_key ? null : state.attempt,
      };
    case "review": {
      if (!state.latest || state.needsRefresh) throw new Error("請先取得最新生效設定，再覆核草稿。");
      if (state.latest.version !== event.version) throw new Error("最新設定再次更新，請重新覆核畫面中的差異。");
      return { ...state, baseline: state.latest, preferences: reviewedPreferences(state), reviewRequired: false, attempt: null };
    }
    case "prepare": {
      if (isDuplicateDraft(state)) throw new Error("已有相同要求正在處理中，請先查看現有要求。");
      if (!state.baseline || state.reviewRequired || state.needsRefresh || state.latest?.version !== state.baseline.version) throw new Error("請先覆核最新設定，再確認提交。");
      if (!changedFields(state.baseline.settings, state.preferences).length && !state.notes.trim()) throw new Error("請先修改偏好或填寫調整要求。");
      const payload = { preferences: { ...state.preferences }, additional_notes: state.notes.trim(), base_version: state.baseline.version };
      const previous = state.attempt;
      const same = previous && previous.base_version === payload.base_version && previous.additional_notes === payload.additional_notes && !changedFields(previous.preferences, payload.preferences).length;
      return { ...state, attempt: same ? previous : { ...payload, idempotency_key: event.key } };
    }
    case "accepted":
      return {
        ...initialPreferenceDraft,
        refreshEpoch: state.refreshEpoch + 1,
        duplicateEpoch: state.duplicateEpoch + 1,
        baseline: state.latest,
        latest: state.latest,
        preferences: { ...(state.latest?.settings ?? emptyPreferences) },
      };
  }
}

export type DuplicateStatusRecord = { id: string; reference: string; status: RequestStatus };

export type DuplicateLookupResponse = { open: boolean; request: DuplicateStatusRecord | null };

export type ReconcileDuplicateResult =
  | { outcome: "noop" }
  | { outcome: "still_open"; status: RequestStatus; request?: ExistingChangeRequest }
  | { outcome: "resolved"; status?: RequestStatus; requestId?: string; shouldRefreshAgent: boolean }
  | { outcome: "error" };

/**
 * Reconciles an active duplicate lock even when its detail panel is unselected
 * or absent from the visible paginated history page.
 */
export async function reconcileDuplicateLock(params: {
  epoch: number;
  getState: () => PreferenceDraft;
  dispatch: (event: Exclude<DuplicateEvent, { type: "duplicate" }>) => void;
  fetchById: (id: string) => Promise<{ request: DuplicateStatusRecord }>;
  lookupByAttempt: (attempt: Pick<SubmissionAttempt, "preferences" | "additional_notes">) => Promise<DuplicateLookupResponse>;
  historyRows?: readonly DuplicateStatusRecord[] | null;
  detailResult?: DuplicateStatusRecord | null;
}): Promise<ReconcileDuplicateResult> {
  const start = params.getState();
  if (!start.duplicateAttempt || start.duplicateEpoch !== params.epoch) return { outcome: "noop" };

  if (start.duplicateRequest) {
    const targetId = start.duplicateRequest.id;
    const known = params.detailResult?.id === targetId
      ? params.detailResult
      : params.historyRows?.find(row => row.id === targetId);
    if (known) {
      if (isTerminalRequestStatus(known.status)) {
        params.dispatch({ type: "duplicate_resolved", epoch: params.epoch, requestId: targetId });
        return { outcome: "resolved", status: known.status, requestId: targetId, shouldRefreshAgent: known.status === "completed" };
      }
      return { outcome: "still_open", status: known.status };
    }
    try {
      const { request } = await params.fetchById(targetId);
      const current = params.getState();
      if (!current.duplicateAttempt || current.duplicateEpoch !== params.epoch || current.duplicateRequest?.id !== targetId) {
        return { outcome: "noop" };
      }
      if (isTerminalRequestStatus(request.status)) {
        params.dispatch({ type: "duplicate_resolved", epoch: params.epoch, requestId: targetId });
        return { outcome: "resolved", status: request.status, requestId: targetId, shouldRefreshAgent: request.status === "completed" };
      }
      return { outcome: "still_open", status: request.status };
    } catch {
      return { outcome: "error" };
    }
  }

  try {
    const result = await params.lookupByAttempt({
      preferences: start.duplicateAttempt.preferences,
      additional_notes: start.duplicateAttempt.additional_notes,
    });
    const current = params.getState();
    if (!current.duplicateAttempt || current.duplicateEpoch !== params.epoch || current.duplicateRequest !== null) {
      return { outcome: "noop" };
    }
    if (result.open) {
      const matched = result.request ? { id: result.request.id, reference: result.request.reference } : undefined;
      if (matched) params.dispatch({ type: "duplicate_matched", epoch: params.epoch, existingRequest: matched });
      return { outcome: "still_open", status: result.request?.status ?? "pending", ...(matched ? { request: matched } : {}) };
    }
    params.dispatch({ type: "duplicate_resolved", epoch: params.epoch });
    return {
      outcome: "resolved",
      status: result.request?.status,
      requestId: result.request?.id,
      shouldRefreshAgent: !result.request || result.request.status === "completed",
    };
  } catch {
    return { outcome: "error" };
  }
}
