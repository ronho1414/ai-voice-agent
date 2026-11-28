const ENABLED = new Set(["1", "true", "on", "yes"]);
const DISABLED = new Set(["0", "false", "off", "no"]);

const NO_STORE = { "Cache-Control": "no-store" } as const;

export function isWhatsAppTextInboxEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.WHATSAPP_TEXT_INBOX_ENABLED ?? "").trim().toLowerCase();
  if (ENABLED.has(raw)) return true;
  if (DISABLED.has(raw)) return false;
  return env.NODE_ENV !== "production" && env.VERCEL_ENV !== "production";
}

export function whatsAppTextInboxDisabledResponse(): Response {
  return Response.json(
    { ok: false, error: "WhatsApp text inbox is disabled" },
    { status: 404, headers: NO_STORE },
  );
}
