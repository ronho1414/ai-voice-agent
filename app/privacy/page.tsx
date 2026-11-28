import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "私隱政策｜Orai Service",
  description:
    "Orai Service（下稱「我們」）重視閣下的個人資料私隱。本政策說明我們在提供網站服務、AI 語音與文字客服方案、預約管理及 WhatsApp 商業訊息整合服務時，如何收集、使用及處理相關資料。",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#FAFAFA] text-[#09090B]">
      <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
        <p className="text-sm font-medium text-[#09090B]">
          <Link href="/" className="underline decoration-[#E4E4E7] underline-offset-4 hover:decoration-[#09090B]">
            Orai Service
          </Link>
        </p>
        <h1 className="mt-6 text-3xl font-bold tracking-tight sm:text-4xl">私隱政策（Privacy Policy）</h1>
        <p className="mt-3 text-sm text-[#09090B]">最後更新日期：2026 年 11 月 28 日</p>
        <p className="mt-8 text-base leading-relaxed">
          Orai Service（下稱「我們」）重視閣下的個人資料私隱。本政策說明我們在提供網站服務、AI 語音與文字客服方案、預約管理及 WhatsApp 商業訊息整合服務時，如何收集、使用及處理相關資料。
        </p>

        <h2 className="mt-10 border-t border-[#E4E4E7] pt-8 text-xl font-bold">1. 我們收集的資料</h2>
        <ul className="mt-4 list-disc space-y-3 pl-5 text-base leading-relaxed">
          <li>預約及查詢資料：當閣下透過網站表單提交預約或查詢時，我們可能收集姓名、聯絡電話、電郵（如有提供）、預約日期與時段偏好、服務項目及備註。</li>
          <li>AI 對話及留言資料：當閣下透過網站對話視窗、電話或相關客服渠道與 AI 專員互動或留口訊時，我們會處理發件人名稱、聯絡電話、留言內容、分類、對話逐字稿、通話時間紀錄及來源渠道（如網頁、WhatsApp 或電話）。</li>
          <li>WhatsApp 訊息資料：當閣下透過 WhatsApp 與使用 Orai Service 的商戶聯絡時，我們會透過 Meta WhatsApp Cloud API 接收及處理閣下的 WhatsApp 電話號碼（WhatsApp ID）、顯示名稱、文字訊息、媒體檔案中繼資料（如圖片、語音或文件之識別碼、檔案名稱、類型及附註說明）、訊息傳送狀態（已送出、已送達、已讀或失敗），以及 AI 自動回覆與真人客服接管紀錄。</li>
          <li>商戶及管理員帳戶資料：商戶或系統管理員登入管理後台時，系統會處理登入電郵、驗證憑證、HttpOnly 工作階段 Cookie 及所屬組織與角色權限資料。</li>
        </ul>

        <h2 className="mt-10 border-t border-[#E4E4E7] pt-8 text-xl font-bold">2. 資料使用目的</h2>
        <p className="mt-4 text-base leading-relaxed">我們收集及處理上述資料，僅用於：</p>
        <ul className="mt-4 list-disc space-y-3 pl-5 text-base leading-relaxed">
          <li>提供 AI 語音及文字客服應答、網站導航協助與預約處理；</li>
          <li>將 WhatsApp 訊息路由至對應商戶後台，支援 AI 自動回覆、真人客服接管（Take Over）及恢復 AI 對話脈絡；</li>
          <li>記錄留言通知、商戶跟進狀態及防止重複處理；</li>
          <li>維持系統帳戶驗證、權限隔離及基本服務運作與除錯。</li>
        </ul>

        <h2 className="mt-10 border-t border-[#E4E4E7] pt-8 text-xl font-bold">3. 第三方服務供應商</h2>
        <p className="mt-4 text-base leading-relaxed">為提供上述功能，相關資料會經由以下第三方服務平台處理：</p>
        <ul className="mt-4 list-disc space-y-3 pl-5 text-base leading-relaxed">
          <li>Meta Platforms（WhatsApp Cloud API）：用於收發 WhatsApp 訊息及傳送狀態通知。</li>
          <li>ElevenLabs：用於 AI 語音及文字對話生成與會話處理。</li>
          <li>Supabase：用於資料庫儲存、多租戶存取隔離及帳戶身分驗證。</li>
          <li>Vercel：用於應用程式託管與後端伺服器運算。</li>
        </ul>

        <h2 className="mt-10 border-t border-[#E4E4E7] pt-8 text-xl font-bold">4. 資料存取控制與多租戶隔離</h2>
        <p className="mt-4 text-base leading-relaxed">
          平台後端透過資料庫 Row-Level Security（RLS）及組織成員權限控制，將不同商業租戶的對話、留言及預約資料分隔存取；外部 Webhook 與工具介面均採用伺服器端密鑰或簽名驗證，管理後台採用 HttpOnly Cookie 驗證工作階段。
        </p>

        <h2 className="mt-10 border-t border-[#E4E4E7] pt-8 text-xl font-bold">5. 資料保留與刪除要求</h2>
        <p className="mt-4 text-base leading-relaxed">
          對話、留言及預約紀錄會保留於系統資料庫內，直至由所屬商戶刪除、相關組織帳戶移除（連帶清除關聯紀錄），或閣下向我們提出資料刪除請求並經核實處理為止（目前系統尚未啟用自動定期清除排程）。
        </p>

        <h2 className="mt-10 border-t border-[#E4E4E7] pt-8 text-xl font-bold">6. 查閱、更正及刪除聯絡方式</h2>
        <p className="mt-4 text-base leading-relaxed">
          如閣下對本私隱政策有任何疑問，或希望查閱、更正或要求刪除個人資料，請電郵至：<a href="mailto:Info@oraiservice.com" className="underline decoration-[#E4E4E7] underline-offset-4 hover:decoration-[#09090B]">Info@oraiservice.com</a>。
        </p>
      </article>
    </main>
  );
}
