export async function extractPdf(bytes: Buffer): Promise<{ text: string; pageCount: number }> {
  const loaded = await import("pdf-parse/lib/pdf-parse.js");
  const result = await loaded.default(bytes);
  const text = (result.text ?? "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const pageCount = typeof result.numpages === "number" && result.numpages > 0 ? result.numpages : 0;
  return { text, pageCount };
}
