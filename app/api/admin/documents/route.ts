import { withPlatformRequest } from "@/lib/platform/supabase-auth";
import { documentKind, extractDocument, mimeAllowed, storageExtension } from "@/lib/admin/extract";
import { requireAdmin } from "@/lib/admin/guard";
import { readSiteId } from "@/lib/admin/site";
import { createDocument, deleteDocument, listDocuments, setDocumentActive } from "@/lib/admin/store";
import { fail, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 4 * 1024 * 1024;
const UNSUPPORTED = "Only PDF, TXT, Markdown, DOCX, and CSV files are accepted";

function siteFrom(request: Request): string {
  return readSiteId(new URL(request.url).searchParams.get("siteId"));
}

function acceptedName(name: string): string {
  const base = name.split(/[/\\]/).pop()?.trim() || "document";
  const clean = base.replace(/[^\w.\- ()\u3400-\u9fff]+/g, "");
  const ext = storageExtension(clean);
  if (!ext || !documentKind(clean)) throw new Error(UNSUPPORTED);
  const stem = clean.slice(0, clean.length - ext.length).slice(0, 180 - ext.length) || "document";
  return `${stem}${ext}`;
}

async function handleGET(request: Request): Promise<Response> {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    return json(await listDocuments(siteFrom(request)));
  } catch (error) {
    return fail(error);
  }
}

async function handlePOST(request: Request): Promise<Response> {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const form = await request.formData();
    const siteId = readSiteId(form.get("siteId"));
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("File is required");
    const fileName = acceptedName(file.name);
    const kind = documentKind(fileName);
    if (!kind || !mimeAllowed(kind, file.type)) throw new Error(UNSUPPORTED);
    if (file.size <= 0) throw new Error("File is required");
    if (file.size > MAX_BYTES) throw new Error("File is too large");
    const bytes = Buffer.from(await file.arrayBuffer());
    const extracted = await extractDocument(kind, bytes);
    const saved = await createDocument({
      site_id: siteId,
      file_name: fileName,
      file_size: file.size,
      extracted_text: extracted.text,
      page_count: extracted.pageCount,
      is_active: true,
      bytes,
    });
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
    if (typeof body.id !== "string" || body.id.trim() === "") throw new Error("Document was not found");
    if (typeof body.isActive !== "boolean") throw new Error("Document was not found");
    const mode = await setDocumentActive(readSiteId(body.siteId), body.id.trim(), body.isActive);
    return json({ mode, id: body.id.trim(), isActive: body.isActive });
  } catch (error) {
    return fail(error);
  }
}

async function handleDELETE(request: Request): Promise<Response> {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id")?.trim() ?? "";
    if (!id) throw new Error("Document was not found");
    const mode = await deleteDocument(siteFrom(request), id);
    return json({ mode, id });
  } catch (error) {
    return fail(error);
  }
}

export const GET = withPlatformRequest(handleGET);
export const POST = withPlatformRequest(handlePOST);
export const PATCH = withPlatformRequest(handlePATCH);
export const DELETE = withPlatformRequest(handleDELETE);
