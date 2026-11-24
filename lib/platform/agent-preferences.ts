export const preferenceOptions = {
  voice_gender: { female: "女性", male: "男性", none: "沒有偏好" },
  voice_character: { natural: "自然親切", gentle: "溫柔細膩", calm: "清晰沉穩", energetic: "年輕活力" },
  speaking_speed: { slow: "較慢", medium: "適中", fast: "較快" },
  response_style: { friendly: "親切自然", professional: "專業有禮", proactive: "熱情主動", caring: "溫柔貼心" },
  response_detail: { brief: "簡潔直接", balanced: "適中自然", detailed: "詳細解說" },
  preferred_language: { auto: "自動識別客戶語言", cantonese: "廣東話優先", english: "英語優先", mandarin: "普通話優先" },
} as const;
export type Preferences = { [K in keyof typeof preferenceOptions]: keyof (typeof preferenceOptions)[K] | null } & { greeting: string };
export const emptyPreferences: Preferences = { voice_gender: null, voice_character: null, speaking_speed: null, response_style: null, response_detail: null, preferred_language: null, greeting: "" };
export const preferenceLabels: Record<keyof Preferences, string> = { voice_gender: "聲線性別", voice_character: "聲線特色", speaking_speed: "說話速度", response_style: "回應風格", response_detail: "回應詳細程度", preferred_language: "優先回應語言", greeting: "專屬歡迎語" };
export const styleExamples = { friendly: "你好呀！想了解邊款護理？我幫你睇吓。", professional: "你好，歡迎查詢。我可以為你介紹療程及預約安排。", proactive: "你好！想改善邊方面嘅膚質？我可以先介紹合適嘅護理。", caring: "你好呀，慢慢講，唔使急。我會細心了解你嘅需要。" };
export const statusLabels = { pending: "待處理", in_progress: "處理中", needs_information: "等待補充資料", completed: "已生效", rejected: "未能採納", cancelled: "已取消" } as const;
export type RequestStatus = keyof typeof statusLabels;
export type ChangeRequest = { id: string; reference: string; organization_id: string; agent_id: string; submitted_by: string; previous_settings: Preferences; requested_settings: Preferences; changed_fields: (keyof Preferences)[]; additional_notes: string; status: RequestStatus; assigned_admin_id: string | null; customer_visible_response: string; final_applied_settings: Preferences | null; base_version: number; version: number; created_at: string; updated_at: string; completed_at: string | null; organizations?: { name: string; slug: string }; overdue?: boolean };
export type RequestEvent = { id: string; kind: string; message: string; created_at: string; actor_id: string };
export type Notification = { id: string; request_id: string; title: string; created_at: string; read_at: string | null };
export function parsePreferences(value: unknown): Preferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("請檢查服務偏好。");
  const p = value as Record<string, unknown>;
  if (Object.keys(p).length !== 7 || Object.keys(p).some(k => !Object.hasOwn(emptyPreferences, k))) throw new Error("偏好欄位不正確。");
  for (const k of Object.keys(preferenceOptions) as (keyof typeof preferenceOptions)[]) {
    if (p[k] !== null && (typeof p[k] !== "string" || !Object.hasOwn(preferenceOptions[k], p[k] as string))) throw new Error("偏好選項不正確。");
  }
  if (typeof p.greeting !== "string" || [...p.greeting].length > 300) throw new Error("歡迎語最多 300 字。");
  return { ...p, greeting: p.greeting.trim() } as Preferences;
}
export function changedFields(a: Preferences, b: Preferences): (keyof Preferences)[] { return (Object.keys(emptyPreferences) as (keyof Preferences)[]).filter(k => a[k] !== b[k]); }
