export const BEAUTY_SERVICES = [
  { id: "hydrate", name: "水潤修護護理", english: "The Hydration Ritual", minutes: 60, price: 680, description: "溫和清潔、保濕精華與舒緩面膜，讓緊繃的肌膚慢慢放鬆。", detail: "適合乾燥、缺水肌膚", tone: "hydrate" },
  { id: "balance", name: "淨肌平衡護理", english: "The Balance Ritual", minutes: 75, price: 880, description: "細緻潔淨配合溫和角質護理，重新找回輕盈、清爽的肌膚節奏。", detail: "適合混合及油性肌膚", tone: "balance" },
  { id: "restore", name: "柔光煥膚護理", english: "The Restorative Ritual", minutes: 90, price: 1180, description: "以滋養護理和輕柔按摩，留一段時間給自己，感受細緻的照顧。", detail: "適合希望改善膚觸的人士", tone: "restore" },
] as const;

export const BEAUTY_WINDOWS = {
  morning: { label: "上午 11:00 – 13:00", hour: "11:00" },
  afternoon: { label: "下午 14:00 – 17:00", hour: "14:00" },
  evening: { label: "傍晚 17:00 – 19:00", hour: "17:00" },
} as const;

export function hongKongDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
