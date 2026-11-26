import { requireSuperAdmin } from "@/lib/platform/auth";
import { withPlatformRequest } from "@/lib/platform/supabase-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const RETIRED_BODY = {
  ok: false,
  error: "Orai 官方留言管理已遷移至專屬商戶儀表板（/dashboard），總控台不再提供日常留言入口。",
} as const;

export const GET = withPlatformRequest(async (request) => {
  const auth = await requireSuperAdmin(request);
  if (auth instanceof Response) return auth;
  return Response.json(RETIRED_BODY, { status: 410, headers: NO_STORE });
});

export const PATCH = withPlatformRequest(async (request) => {
  const auth = await requireSuperAdmin(request);
  if (auth instanceof Response) return auth;
  return Response.json(RETIRED_BODY, { status: 410, headers: NO_STORE });
});
