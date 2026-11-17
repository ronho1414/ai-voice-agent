import type { Metadata } from "next";
import { AdminConsole } from "@/components/admin/AdminConsole";

export const metadata: Metadata = {
  title: "VoicePilot 管理後台",
  description: "管理企業知識庫 PDF 同訪客對話紀錄。",
};

export default function AdminPage() {
  return <AdminConsole />;
}
