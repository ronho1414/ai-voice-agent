const BAD_REQUEST = new Set([
  "Text is required",
  "Text is too long",
  "Audio is required",
  "Audio is too large",
  "Language is required",
]);

export function fail(error: unknown): Response {
  const message = error instanceof Error ? error.message : "Request failed";
  const status = BAD_REQUEST.has(message) ? 400 : message.startsWith("Missing ") ? 500 : 502;
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export function json(body: unknown): Response {
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
