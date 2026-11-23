import { withPlatformRequest } from "@/lib/platform/supabase-auth";
import { requireAdmin } from "@/lib/admin/guard";
import { readSiteId } from "@/lib/admin/site";
import { createNote, deleteNote, listNotes, setNoteActive } from "@/lib/admin/store";
import { fail, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOTE_LIMIT = 50_000;

function siteFrom(request: Request): string {
  return readSiteId(new URL(request.url).searchParams.get("siteId"));
}

async function handleGET(request: Request): Promise<Response> {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    return json(await listNotes(siteFrom(request)));
  } catch (error) {
    return fail(error);
  }
}

async function handlePOST(request: Request): Promise<Response> {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const body = (await request.json()) as { text?: unknown; siteId?: unknown };
    if (typeof body.text !== "string") throw new Error("Text is required");
    const text = body.text.trim();
    if (!text) throw new Error("Text is required");
    if (text.length > NOTE_LIMIT) throw new Error("Text is too long");
    const saved = await createNote({ site_id: readSiteId(body.siteId), body: text });
    return json(saved);
  } catch (error) {
    return fail(error);
  }
}

async function handlePATCH(request: Request): Promise<Response> {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const body = (await request.json()) as { id?: unknown; isActive?: unknown; siteId?: unknown };
    if (typeof body.id !== "string" || body.id.trim() === "") throw new Error("Note was not found");
    if (typeof body.isActive !== "boolean") throw new Error("Note was not found");
    const mode = await setNoteActive(readSiteId(body.siteId), body.id.trim(), body.isActive);
    return json({ mode, id: body.id.trim(), isActive: body.isActive });
  } catch (error) {
    return fail(error);
  }
}

async function handleDELETE(request: Request): Promise<Response> {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
    if (!id) throw new Error("Note was not found");
    const mode = await deleteNote(siteFrom(request), id);
    return json({ mode, id });
  } catch (error) {
    return fail(error);
  }
}

export const GET = withPlatformRequest(handleGET);
export const POST = withPlatformRequest(handlePOST);
export const PATCH = withPlatformRequest(handlePATCH);
export const DELETE = withPlatformRequest(handleDELETE);
