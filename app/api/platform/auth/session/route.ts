import { NextRequest } from "next/server";
import {
  clearSessionCookie,
  createSessionCookie,
  getPlatformSession,
  unauthorizedResponse
} from "@/lib/platform/auth";
import type { PlatformSession } from "@/lib/platform/types";
import { getOrganizationBySlug } from "@/lib/platform/store";

export async function GET(request: NextRequest) {
  const session = await getPlatformSession(request);
  if (!session) {
    return Response.json({ authenticated: false, session: null });
  }
  return Response.json({ authenticated: true, session });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      type: "super_admin" | "customer";
      password?: string;
      slug?: string;
    };

    const adminPassword = process.env.ADMIN_PASSWORD?.trim();

    // 1. Super Admin Login
    if (body.type === "super_admin") {
      if (!adminPassword) {
        return Response.json({ error: "系統未設定 ADMIN_PASSWORD 環境變數" }, { status: 503 });
      }
      if (body.password !== adminPassword) {
        return Response.json({ error: "管理員密碼不正確" }, { status: 401 });
      }

      const session: PlatformSession = {
        userId: "super-admin-root",
        email: "admin@oraiservice.com",
        fullName: "Orai 總管理員",
        role: "super_admin",
      };

      const cookie = createSessionCookie(session);
      return Response.json(
        { success: true, session },
        { headers: { "Set-Cookie": cookie, "Cache-Control": "no-store" } }
      );
    }

    // 2. Customer Dashboard Login (via business slug & access code / verification)
    if (body.type === "customer") {
      const slug = body.slug?.trim().toLowerCase();
      if (!slug) {
        return Response.json({ error: "請輸入商戶代稱 (Slug)" }, { status: 400 });
      }

      const org = await getOrganizationBySlug(slug);
      if (!org) {
        return Response.json({ error: "找不到該商戶，請檢查代稱是否正確" }, { status: 404 });
      }

      if (org.status === "suspended") {
        return Response.json({ error: "該商戶帳戶已被暫停，請聯絡 Orai 客服" }, { status: 403 });
      }

      // Check password if provided, or verify against admin password in early phase
      if (adminPassword && body.password && body.password !== adminPassword) {
        return Response.json({ error: "密碼不正確" }, { status: 401 });
      }

      const session: PlatformSession = {
        userId: `cust-${org.id.slice(0, 8)}`,
        email: org.email || `contact@${org.slug}.com`,
        fullName: org.name,
        role: "customer_admin",
        organizationId: org.id,
        organizationName: org.name,
        organizationSlug: org.slug,
      };

      const cookie = createSessionCookie(session);
      return Response.json(
        { success: true, session },
        { headers: { "Set-Cookie": cookie, "Cache-Control": "no-store" } }
      );
    }

    return Response.json({ error: "Invalid login type" }, { status: 400 });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "登入失敗" }, { status: 500 });
  }
}

export async function DELETE() {
  const cookie = clearSessionCookie();
  return Response.json({ success: true }, { headers: { "Set-Cookie": cookie, "Cache-Control": "no-store" } });
}
