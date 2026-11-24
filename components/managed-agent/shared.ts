import {
  changedFields,
  emptyPreferences,
  preferenceLabels,
  preferenceOptions,
  statusLabels,
  type Preferences,
  type RequestStatus,
} from "@/lib/platform/agent-preferences";

export const MANAGED_REFRESH_EVENT = "orai-managed-refresh";
export const NOTES_MAX = 2000;
export const GREETING_MAX = 300;
export const NOTES_PLACEHOLDER =
  "例如：希望 AI 稱呼客人為小姐或先生，避免過度推銷療程，或改善某些服務回答……";
export const NOTES_NOTICE =
  "提交後，Orai 團隊將審核及調整你的 AI 專員。現有服務不會受到影響，調整完成後我們將通知你。";
export function eventLabel(kind: string): string {
  const labels: Record<string,string> = { submitted: "已提交要求", start: "開始處理", needs_information: "等待補充資料", provide_information: "商戶已補充資料", complete: "調整已生效", reject: "未能採納", cancel: "已取消", internal_note: "內部備註" };
  return Object.hasOwn(labels,kind) ? labels[kind] : "進度更新";
}

export function dispatchManagedRefresh() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(MANAGED_REFRESH_EVENT));
}

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  }).catch(() => { throw new Error("暫時無法連線，請檢查網絡後重試；尚未確認儲存成功。"); });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err =
      body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : res.status === 409
          ? "資料已更新或要求重複，請重新整理後再試。"
          : "操作失敗，請稍後重試。";
    throw new ApiError(err, res.status);
  }
  return body as T;
}

export function charCount(value: string): number {
  return [...value].length;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-HK", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function statusTone(status: RequestStatus): string {
  switch (status) {
    case "pending":
      return "bg-[#F4F4F5] text-[#3F3F46]";
    case "in_progress":
      return "bg-[#E4E4E7] text-[#18181B]";
    case "needs_information":
      return "bg-[#FAFAFA] text-[#52525B] ring-1 ring-[#D4D4D8]";
    case "completed":
      return "bg-[#09090B] text-white";
    case "rejected":
      return "bg-[#F4F4F5] text-[#71717A]";
    case "cancelled":
      return "bg-[#FAFAFA] text-[#A1A1AA]";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function statusLabel(status: RequestStatus): string {
  return statusLabels[status];
}

export function preferenceValueLabel(key: keyof Preferences, value: Preferences[keyof Preferences]): string {
  if (key === "greeting") {
    const text = typeof value === "string" ? value.trim() : "";
    return text || "待確認";
  }
  if (value === null || value === undefined || value === "") return "待確認";
  const options = preferenceOptions[key as keyof typeof preferenceOptions];
  if (options && typeof value === "string" && value in options) {
    return options[value as keyof typeof options];
  }
  return String(value);
}

export function clonePreferences(value: Preferences): Preferences {
  return { ...value, greeting: value.greeting ?? "" };
}

export function preferencesEqual(a: Preferences, b: Preferences): boolean {
  return changedFields(a, b).length === 0;
}

export function payloadFingerprint(preferences: Preferences, notes: string): string {
  return JSON.stringify({ preferences, notes: notes.trim() });
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `idem-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function displayAvailability(value: boolean | null | undefined): string {
  if (value === true) return "全日服務";
  if (value === false) return "非全日";
  return "待確認";
}

export function displayText(value: string | null | undefined): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text || "待確認";
}

export { changedFields, emptyPreferences, preferenceLabels, preferenceOptions, statusLabels };
export type { Preferences, RequestStatus };
