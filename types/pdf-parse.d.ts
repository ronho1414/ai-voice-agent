declare module "pdf-parse" {
  type PdfParseResult = {
    numpages: number;
    text: string;
  };

  function pdfParse(data: Uint8Array): Promise<PdfParseResult>;
  export default pdfParse;
}
