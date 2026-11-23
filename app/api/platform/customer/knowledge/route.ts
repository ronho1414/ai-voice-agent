import { withPlatformRequest } from "@/lib/platform/supabase-auth";
import { requireCustomerAuth } from "@/lib/platform/auth";
import {
  createKnowledgeSource,
  deleteKnowledgeSource,
  listKnowledgeSources,
  updateKnowledgeSource,
} from "@/lib/platform/store";
import type { SourceType } from "@/lib/platform/types";
import pdfParse from "pdf-parse";

export const runtime = "nodejs";

const SOURCE_TYPES: SourceType[] = ["pdf", "note", "faq"];
const MAX_CONTENT_LENGTH = 200_000;
const MAX_PDF_BYTES = 10 * 1024 * 1024;

async function customerOrganization(request: Request) {
  const auth = await requireCustomerAuth(request);
  if (auth instanceof Response) return auth;
  if (!auth.organizationId) {
    return Response.json({ error: "No organization associated" }, { status: 400 });
  }
  return auth.organizationId;
}

async function handleGET(request: Request) {
  const organizationId = await customerOrganization(request);
  if (organizationId instanceof Response) return organizationId;
  try {
    const sources = await listKnowledgeSources(organizationId);
    return Response.json({ sources }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Failed to load knowledge base" }, { status: 500 });
  }
}

async function handlePOST(request: Request) {
  const organizationId = await customerOrganization(request);
  if (organizationId instanceof Response) return organizationId;
  try {
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return Response.json({ error: "請選擇 PDF 檔案" }, { status: 400 });
      if (file.size <= 0 || file.size > MAX_PDF_BYTES) {
        return Response.json({ error: "PDF 檔案大小必須介乎 1 byte 至 10 MB" }, { status: 400 });
      }
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        return Response.json({ error: "只接受 PDF 檔案" }, { status: 400 });
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
        return Response.json({ error: "檔案內容並非有效 PDF" }, { status: 400 });
      }
      const parsed = await pdfParse(buffer);
      const content = parsed.text.trim();
      if (!content) return Response.json({ error: "無法從 PDF 抽取文字，請確認檔案不是掃描圖片或空白文件" }, { status: 400 });
      if (content.length > MAX_CONTENT_LENGTH) {
        return Response.json({ error: "PDF 抽取文字超過 200,000 字元，請分拆成較小文件再上載" }, { status: 400 });
      }
      const title = file.name.replace(/\.pdf$/i, "").trim().slice(0, 160) || "PDF 知識文件";
      const source = await createKnowledgeSource({
        organizationId,
        title,
        content,
        sourceType: "pdf",
        fileSize: file.size,
      });
      return Response.json({ source, extractedCharacters: content.length }, { status: 201 });
    }

    const body = await request.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const content = typeof body.content === "string" ? body.content : "";
    const sourceType = SOURCE_TYPES.includes(body.source_type) ? body.source_type : "note";
    if (!title || title.length > 160 || !content.trim()) {
      return Response.json({ error: "請提供標題及內容（標題最多 160 字）" }, { status: 400 });
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      return Response.json({ error: "每則知識內容最多 200,000 字元" }, { status: 400 });
    }
    const source = await createKnowledgeSource({ organizationId, title, content, sourceType });
    return Response.json({ source }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Failed to create knowledge source" }, { status: 400 });
  }
}

async function handlePATCH(request: Request) {
  const organizationId = await customerOrganization(request);
  if (organizationId instanceof Response) return organizationId;
  try {
    const body = await request.json();
    if (typeof body.id !== "string") return Response.json({ error: "Missing knowledge source id" }, { status: 400 });
    const updates: { title?: string; content?: string; source_type?: SourceType; is_active?: boolean } = {};
    if (body.title !== undefined) {
      if (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 160) {
        return Response.json({ error: "標題必須為 1 至 160 字" }, { status: 400 });
      }
      updates.title = body.title.trim();
    }
    if (body.content !== undefined) {
      if (typeof body.content !== "string" || !body.content.trim() || body.content.length > MAX_CONTENT_LENGTH) {
        return Response.json({ error: "內容必須為 1 至 200,000 字元" }, { status: 400 });
      }
      updates.content = body.content;
    }
    if (body.source_type !== undefined) {
      if (!SOURCE_TYPES.includes(body.source_type)) return Response.json({ error: "Invalid source type" }, { status: 400 });
      updates.source_type = body.source_type;
    }
    if (body.is_active !== undefined) {
      if (typeof body.is_active !== "boolean") return Response.json({ error: "Invalid active status" }, { status: 400 });
      updates.is_active = body.is_active;
    }
    const source = await updateKnowledgeSource(organizationId, body.id, updates);
    return Response.json({ source });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Failed to update knowledge source" }, { status: 400 });
  }
}

async function handleDELETE(request: Request) {
  const organizationId = await customerOrganization(request);
  if (organizationId instanceof Response) return organizationId;
  try {
    const { id } = await request.json();
    if (typeof id !== "string") return Response.json({ error: "Missing knowledge source id" }, { status: 400 });
    await deleteKnowledgeSource(organizationId, id);
    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Failed to delete knowledge source" }, { status: 400 });
  }
}

export const GET = withPlatformRequest(handleGET);
export const POST = withPlatformRequest(handlePOST);
export const PATCH = withPlatformRequest(handlePATCH);
export const DELETE = withPlatformRequest(handleDELETE);
