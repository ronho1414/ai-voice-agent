# 專案規格書 (SPEC.md)：超低延遲三語企業語音客服與網頁導航系統

## 1. 專案目標
將現有的網頁語音對話 Demo，升級為支援**廣東話（yue）、普通話（zh）、英文（en）**的「超低延遲企業 AI 語音客服及自動導航員」。核心體驗必須達到 **首音延遲（TTFA）低於 0.5 秒**，並能根據對話內容自動控制網頁跳轉。

---

## 2. 技術棧與外部 API 規格
* **前端框架**：沿用現有專案架構（Next.js / React + Tailwind CSS），音頻播放必須使用瀏覽器原生 **Web Audio API** 確保零延遲拼接。
* **語音轉文字 (STT)**：Deepgram（模型 `nova-3`，失敗時自動回退 `nova-2`）— 多語偵測 `zh-HK`、`zh-CN`、`en`。環境變數 `DEEPGRAM_API_KEY`。
* **決定模型 (Fast Path)**：TypeSafe Jev（模型 `jev-latest`）— 負責毫秒級多選題判斷（不生成文字）。環境變數 `JEV_API_KEY`。
* **生成大腦 (Slow Path)**：OpenRouter（模型 `google/gemini-2.5-flash`）— 負責結合知識庫生成口語化回覆。環境變數 `OPENROUTER_API_KEY`。
* **語音合成 (TTS)**：只使用 ElevenLabs。可用的 `model_id` 為 `eleven_v4_turbo`（`eleven_turbo_v4` 不是有效的 model id），失敗時自動回退 `eleven_flash_v2_5`。廣東話（yue）、普通話（zh）與英文（en）的 voice id 均為 `pyCpQJNpFBywhVAwOzn6`。環境變數 `ELEVENLABS_API_KEY`（只從 `process.env` 讀取）。負責預錄短片及即時語音串流。

---

## 3. 核心架構：雙軌並行接力（Dual-Path Relay Architecture）

當用戶完成說話並取得 STT 文字後，前端先問 Fast Path。Fast Path 一返回開場白，就立即把同一句 `openerTranscript` 交給 Slow Path，並且立刻播放預錄 MP3。Slow Path 唔好再自己揀另一句開場白。預錄播放同文字生成仍然重疊，唔好等音檔播完先至開始生成。

### 軌道 A：Fast Path（0.3 秒內搶閘反應 + 網頁導航）
1. **預載音效庫 (`/public/clips/`)**：
   * 網頁載入（Page Load）時，透過 Web Audio API 預先將所有預錄 MP3 解碼並存入記憶體（`AudioBuffer`），播放時不可產生網絡請求。
   * 音檔命名規範：`{intent}_{lang}.mp3`（例如 `company_intro_yue.mp3`, `navigate_pricing_en.mp3`）。
2. **Jev 決策引擎 (`/api/fast-decision`)**：
   * 同時向 Jev 發送兩個分類請求：
     * **任務 1（開場白選擇）**：同時睇訪客問題、`currentPage`（`home`、`advantages`、`pricing`、`about`）同 `turnCount`。第一輪（`turnCount === 1`）由 `[greeting, company_intro, navigate_pricing, navigate_advantages, compare_bots, ask_timeline, ask_voice_clone, price_objection, booking_demo, deep_lookup]` 揀一句未完嘅半句開場白。喺 `pricing` 頁優先方案比較語氣；喺 `advantages` 頁優先知識庫檔案語氣。第二輪起只可以揀 `[follow_up_ack, follow_up_detail, follow_up_nav]`。語言仍然係 `[yue, zh, en]`。
     * **任務 2（網頁導航路由）**：對照 `config/site-map.json` 的頁面 id（`home`、`advantages`、`pricing`、`about`）。問價錢、知識庫或預約 Demo 時，由對應 intent 強制跳頁。其餘情況若最高信心分數 `>= 0.75`，返回頁面 id；否則返回 `NONE`。
3. **即時執行**：
   * 前端收到回應後，**立即**從記憶體播放對應的預錄 MP3（約 1.5 - 2 秒）。
   * 若 `navigateUrl !== "NONE"`，呼叫 `window.navigateToPage(navigateUrl)`。預約 Demo 再傳 `{ sectionId: "demo-booking-form" }`。唔好用 Next.js 路由打開 `/pricing` 這類空頁。畫面顯示「正在為您前往：{頁面名稱}」。

### 軌道 B：Slow Path（知識庫檢索 + 無縫語音接力）
1. **企業知識庫注入**：
   * 讀取 `knowledge-base/company-info.md` 作為唯一事實來源（Single Source of Truth）。
   * 若知識庫無相關資料，必須禮貌回覆會記錄並安排專人跟進，嚴禁編造資料（No Hallucination）。
2. **接力提示詞（Continuation Prompt）**：
   * 系統必須將軌道 A 選出的「預錄開場白原文」傳入大模型 Prompt，指令如下：
     > 「你已經向訪客講出咗以下前半句開場白：「{openerTranscript}」。請你必須直接順住呢句話嘅語氣同文法接落去講後半句，絕對唔准重複打招呼（例如唔准再講『你好』），亦唔准重複前半句已經講過嘅意思，保持地道香港廣東話口語。」
3. **語音輸出格式限制（TTS Friendly）**：
   * 廣東話回覆必須使用地道香港口語（如「係、唔係、嘅、咗、喺」），嚴禁使用書面語。
   * 回覆長度控制在 **2 至 3 句之內**（適合語音聆聽）。
   * **嚴禁輸出任何 Markdown 符號**（如 `*`、`#`、`-`、`1.`），避免 TTS 讀出符號名稱。

---

## 4. 前端音頻無縫拼接邏輯（Audio Queue Manager）
* 必須實作一個嚴格的 `AudioQueue` 狀態機：
  1. 狀態 `PLAYING_CLIP`：正在播放軌道 A 的預錄開場白。
  2. 狀態 `BUFFERING_STREAM`：軌道 B 的 TTS 音頻串流已到達，但開場白尚未播完，暫存於緩衝區。
  3. 狀態 `PLAYING_STREAM`：預錄音檔播到可聞尾音（略過尾段靜音）時，以 Web Audio 時間表喺同一個時間點啟動軌道 B。對話氣泡把 `openerTranscript` 同 Slow Path 文字合成同一段。
* 支援「用戶打斷（Barge-in）」：當用戶在 AI 說話期間再次點擊 Mic 或開始說話，立即停止所有正在播放的音頻並清空隊列。

---

## 5. 開發與驗收階段（Phases）
* **Phase 1**：建立 `config/clips-config.json`、`config/site-map.json`、`knowledge-base/company-info.md` 及離線生成預錄 MP3 的腳本 `scripts/generate-clips.ts`。
* **Phase 2**：實作後端 `/api/fast-decision`（接入 Jev API）與 `/api/chat-relay`（接入知識庫與大模型）。
* **Phase 3**：重構前端 `AudioQueue` 播放管理器，實現雙軌並行請求、音軌無縫接力及自動網頁導航。
* **Phase 4**：將匯出的 VoicePilot AI（領聲智導）網站掛載為 Next.js `app/page.tsx` 的公司外殼，並接上 Phase 3 語音元件（詳見第 6 節與第 7 節）。

---

## 6. Phase 4：掛載 VoicePilot AI（領聲智導）公司外殼

Phase 4 把已匯出的 **VoicePilot AI（領聲智導）** 網站掛成 Next.js `app/page.tsx` 的公司外殼。外殼必須原樣保留：

* 視覺設計與 CSS 動效
* `window.navigateToPage`
* 區段 id：`#hero`、`#features`、`#use-cases`、`#pricing`、`#about`
* 按鈕 id：`open-voice-demo-btn`

語音掛載：

* 將 Phase 3 語音元件掛在佔位符 `CURSOR_VOICE_WIDGET_MOUNT_POINT`（右下角）。
* 點擊 `#open-voice-demo-btn` 打開語音面板。

行銷頁只負責外殼。語音邏輯不得寫進該頁。

---

## 7. 架構規則：語音核心與客戶網站解耦

Phase 1–3 的語音核心必須與公司外殼解耦。換設定即可把同一套核心接到另一個客戶網站，包括日後以獨立 script 嵌入 Shopify 或 WordPress。

以下能力只放在 `components/voice-widget/` 與 `lib/voice-engine/`，不得寫進行銷頁：

* Deepgram STT
* Jev 路由
* OpenRouter 知識庫回答
* ElevenLabs TTS
* 無縫音頻播放器
* 浮動 UI

網站專屬資料以 config / props 注入，不寫死在核心裡：

* 知識庫檔案
* `site-map.json`（頁面與區段跳轉）
* `voiceId`
* 預錄開場白 MP3

---

## 8. 管理後台與多租戶知識庫

* `/admin` 用伺服器端 `ADMIN_PASSWORD` 保護。
* PDF 文字存在 `documents`，以 `site_id` 隔離，預設 `voicepilot-hq`。
* Slow Path 優先讀取該站 `is_active = true` 嘅 PDF 文字。沒有檔案或資料庫未設定時，回退 `knowledge-base/company-info.md`。
* 對話寫入 `conversation_logs` 發生喺回覆產生之後，唔好阻塞 Fast Path。
* 結構見 `supabase/schema.sql`。
