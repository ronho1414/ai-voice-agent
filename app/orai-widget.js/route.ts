import { readFileSync } from "fs";
import path from "path";

export const dynamic = "force-static";

export function GET() {
  const body = readFileSync(path.join(process.cwd(), "orai-widget.js"));
  return new Response(body, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
