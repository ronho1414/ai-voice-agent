import { changedFields, emptyPreferences, type Preferences } from "./agent-preferences";

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
};
export const initialPreferenceDraft: PreferenceDraft = { baseline: null, latest: null, preferences: emptyPreferences, notes: "", dirty: false, reviewRequired: false, needsRefresh: false, attempt: null, refreshEpoch: 0 };

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

export function preferenceDraftTransition(state: PreferenceDraft, event: DraftEvent): PreferenceDraft {
  switch (event.type) {
    case "receive": {
      const { snapshot } = event;
      if (event.epoch !== state.refreshEpoch) return state;
      if (state.latest && snapshot.version < state.latest.version) return state;
      const latest = { ...snapshot, settings: { ...snapshot.settings } };
      if (!state.dirty && !state.attempt && !state.reviewRequired) {
        return { ...initialPreferenceDraft, refreshEpoch: state.refreshEpoch, latest, baseline: latest, preferences: { ...latest.settings } };
      }
      return { ...state, latest, needsRefresh: false, reviewRequired: state.reviewRequired || snapshot.version !== state.baseline?.version };
    }
    case "preferences": return { ...state, preferences: { ...event.preferences }, dirty: true };
    case "notes": return { ...state, notes: event.notes, dirty: true };
    case "conflict":
    case "terminal": return { ...state, dirty: true, reviewRequired: true, needsRefresh: true, refreshEpoch: state.refreshEpoch + 1 };
    case "refresh_failed": return { ...state, needsRefresh: state.needsRefresh || state.reviewRequired };
    case "review": {
      if (!state.latest || state.needsRefresh) throw new Error("請先取得最新生效設定，再覆核草稿。");
      if (state.latest.version !== event.version) throw new Error("最新設定再次更新，請重新覆核畫面中的差異。");
      return { ...state, baseline: state.latest, preferences: reviewedPreferences(state), reviewRequired: false, attempt: null };
    }
    case "prepare": {
      if (!state.baseline || state.reviewRequired || state.needsRefresh || state.latest?.version !== state.baseline.version) throw new Error("請先覆核最新設定，再確認提交。");
      if (!changedFields(state.baseline.settings, state.preferences).length && !state.notes.trim()) throw new Error("請先修改偏好或填寫調整要求。");
      const payload = { preferences: { ...state.preferences }, additional_notes: state.notes.trim(), base_version: state.baseline.version };
      const previous = state.attempt;
      const same = previous && previous.base_version === payload.base_version && previous.additional_notes === payload.additional_notes && !changedFields(previous.preferences, payload.preferences).length;
      return { ...state, attempt: same ? previous : { ...payload, idempotency_key: event.key } };
    }
    case "accepted": return { ...initialPreferenceDraft, refreshEpoch: state.refreshEpoch + 1, baseline: state.latest, latest: state.latest, preferences: { ...(state.latest?.settings ?? emptyPreferences) } };
  }
}
