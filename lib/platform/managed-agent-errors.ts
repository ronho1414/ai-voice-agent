export type ExistingChangeRequest = { id: string; reference: string };
export type ManagedConflictCode = "DUPLICATE_OPEN_REQUEST" | "STALE_ACTIVE_PREFERENCES" | "STALE_REQUEST_VERSION" | "IDEMPOTENCY_KEY_REUSED" | "REQUEST_CONFLICT";

// Compatibility boundary for the existing service-only RPC. Clients consume codes,
// never PostgreSQL exception messages; no hosted schema change is necessary.
export function managedConflictCode(message: string): ManagedConflictCode | null {
  if (message === "conflict: identical open request exists") return "DUPLICATE_OPEN_REQUEST";
  if (message === "conflict: idempotency key reused") return "IDEMPOTENCY_KEY_REUSED";
  if (message === "conflict: request changed; refresh first") return "STALE_REQUEST_VERSION";
  if (["conflict: active preferences changed; refresh first", "conflict: active settings changed since administrator review", "conflict: stale snapshot requires explicit administrator review"].includes(message)) return "STALE_ACTIVE_PREFERENCES";
  return message.startsWith("conflict:") ? "REQUEST_CONFLICT" : null;
}
