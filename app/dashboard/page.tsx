import type { Metadata } from "next";
import { CustomerDashboard } from "@/components/dashboard/CustomerDashboard";

export const metadata: Metadata = {
  title: "商戶專屬儀表板｜Orai Service",
  description: "香港本地企業商戶 AI 語音接待與預約管理後台。",
};

export default function CustomerDashboardPage() {
  return <CustomerDashboard />;
}
