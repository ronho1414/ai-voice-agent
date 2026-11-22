import type { Metadata } from "next";
import { OraiAdminDashboard } from "@/components/admin/OraiAdminDashboard";

export const metadata: Metadata = {
  title: "Orai Service 企業管理總後台",
  description: "管理香港本地企業商戶、語音專員配置及全平台用量。",
};

export default function AdminPage() {
  return <OraiAdminDashboard />;
}
