import { extractPdf } from "@/lib/admin/pdf";

export type DocumentKind = "pdf" | "txt" | "md" | "docx" | "csv";

const EXTENSIONS = [".markdown", ".docx", ".pdf", ".txt", ".csv", ".md"] as const;

export function documentKind(fileName: string): DocumentKind | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".txt")) return "txt";
  if (lower.endsWith(".markdown") || lower.endsWith(".md")) return "md";
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".csv")) return "csv";
  return null;
}

export function storageExtension(fileName: string): string {
  const lower = fileName.toLowerCase();
  return EXTENSIONS.find((ext) => lower.endsWith(ext)) ?? "";
}

export function contentTypeFor(kind: DocumentKind): string {
  switch (kind) {
    case "pdf":
      return "application/pdf";
    case "txt":
      return "text/plain; charset=utf-8";
    case "md":
      return "text/markdown; charset=utf-8";
    case "csv":
      return "text/csv; charset=utf-8";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
}

const MIME_OK: Record<DocumentKind, string[]> = {
  pdf: ["application/pdf"],
  txt: ["text/plain"],
  md: ["text/markdown", "text/plain", "text/x-markdown"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip"],
  csv: ["text/csv", "application/csv", "text/plain", "application/vnd.ms-excel"],
};

export function mimeAllowed(kind: DocumentKind, type: string): boolean {
  const normalized = type.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!normalized || normalized === "application/octet-stream") return true;
  return MIME_OK[kind].includes(normalized);
}

function normalizeText(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeText(bytes: Buffer): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return bytes.subarray(2).toString("utf16le");
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return bytes.subarray(3).toString("utf8");
  }
  return bytes.toString("utf8");
}

export async function extractDocument(
  kind: DocumentKind,
  bytes: Buffer,
): Promise<{ text: string; pageCount: number }> {
  if (kind === "pdf") return extractPdf(bytes);
  if (kind === "docx") {
    try {
      const loaded = (await import("mammoth")) as {
        extractRawText?: (input: { buffer: Buffer }) => Promise<{ value?: string }>;
        default?: { extractRawText: (input: { buffer: Buffer }) => Promise<{ value?: string }> };
      };
      const extractRawText = loaded.extractRawText ?? loaded.default?.extractRawText;
      if (!extractRawText) throw new Error("Document text could not be read");
      const result = await extractRawText({ buffer: bytes });
      return { text: normalizeText(result.value ?? ""), pageCount: 0 };
    } catch (error) {
      if (error instanceof Error && error.message === "Document text could not be read") throw error;
      throw new Error("Document text could not be read");
    }
  }
  return { text: normalizeText(decodeText(bytes)), pageCount: 0 };
}
