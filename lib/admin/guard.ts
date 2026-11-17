import { adminConfigured, isAdminRequest } from "@/lib/admin/auth";

export function adminUnavailable(): Response {
  return Response.json(
    { error: "Admin password is not configured" },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

export function unauthorized(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
}

export function requireAdmin(request: Request): Response | null {
  if (!adminConfigured()) return adminUnavailable();
  if (!isAdminRequest(request)) return unauthorized();
  return null;
}
