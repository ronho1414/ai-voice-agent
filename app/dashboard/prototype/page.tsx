import type { Metadata } from "next";
import { DashboardPrototype } from "@/components/dashboard/prototype/DashboardPrototype";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "儀表板視覺原型｜Orai Service",
  description: "商戶儀表板外殼同 WhatsApp 收件匣視覺原型，只用虛構資料。",
};

type DashboardPrototypePageProps = {
  searchParams: Promise<{ view?: string | string[] }>;
};

export default async function DashboardPrototypePage({ searchParams }: DashboardPrototypePageProps) {
  const params = await searchParams;
  const view = Array.isArray(params.view) ? params.view[0] : params.view;
  return <DashboardPrototype initialView={view === "whatsapp" ? "whatsapp" : "overview"} />;
}
