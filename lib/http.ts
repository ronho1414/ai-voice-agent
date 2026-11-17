const BAD_REQUEST = new Set([
  "Text is required",
  "Text is too long",
  "Audio is required",
  "Audio is too large",
  "Language is required",
  "Voice is invalid",
  "Knowledge base path is invalid",
  "Site is invalid",
  "Password is required",
  "File is required",
  "Only PDF, TXT, Markdown, DOCX, and CSV files are accepted",
  "Document text could not be read",
  "Note was not found",
  "File is too large",
  "Document was not found",
  "Client name is required",
  "Client slug is invalid",
  "Agent id is invalid",
  "Route map is invalid",
  "Client was not found",
]);

export function fail(error: unknown): Response {
  const message = error instanceof Error ? error.message : "Request failed";
  const status = BAD_REQUEST.has(message) ? 400 : message.startsWith("Missing ") ? 500 : 502;
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export function json(body: unknown): Response {
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
