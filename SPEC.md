# 專案規格書 (SPEC.md)：超低延遲三語企業語音客服與網頁導航系統

## 1. 專案目標
將現有的網頁語音對話 Demo，升級為支援**廣東話（yue）、普通話（zh）、英文（en）**的「超低延遲企業 AI 語音客服及自動導航員」。核心體驗必須達到 **首音延遲（TTFA）低於 0.5 秒**，並能根據對話內容自動控制網頁跳轉。

---

## 2. 技術棧與外部 API 規格
* **前端框架**：沿用現有專案架構（Next.js / React + Tailwind CSS），音頻播放必須使用瀏覽器原生 **Web Audio API** 確保零延遲拼接。
* **語音轉文字 (STT)**：Groq API (`whisper-large-v3-turbo`) — 負責快速識別粵/普/英及中英夾雜。
* **決定模型 (Fast Path)**：TypeSafe AI **Jev API** (`jev-latest`) — 負責毫秒級多選題判斷（不生成文字）。
* **生成大腦 (Slow Path)**：OpenRouter / Google Gemini (`gemini-2.5-flash`) — 負責結合知識庫生成口語化回覆。
* **語音合成 (TTS)**：ElevenLabs (`eleven_flash_v2_5`) 或 Cantonese.ai API — 負責預錄短片及即時語音串流。

---

## 3. 核心架構：雙軌並行接力（Dual-Path Relay Architecture）

當用戶完成說話並取得 STT 文字後，前端必須**同時（Parallel）**觸發 Fast Path 與 Slow Path，嚴禁串行等待：

### 軌道 A：Fast Path（0.3 秒內搶閘反應 + 網頁導航）
1. **預載音效庫 (`/public/clips/`)**：
   * 網頁載入（Page Load）時，透過 Web Audio API 預先將所有預錄 MP3 解碼並存入記憶體（`AudioBuffer`），播放時不可產生網絡請求。
   * 音檔命名規範：`{intent}_{lang}.mp3`（例如 `checking_info_yue.mp3`, `navigating_en.mp3`）。
2. **Jev 決策引擎 (`/api/fast-decision`)**：
   * 同時向 Jev 發送兩個分類請求：
     * **任務 1（開場白選擇）**：從預設分類 `[greeting, checking_info, navigating, pricing, empathy]` 及語言 `[yue, zh, en]` 中選出最匹配的一項。
     * **任務 2（網頁導航路由）**：對照 `config/site-map.json`，判斷用戶是否需要跳轉頁面。若最高信心分數 `>= 0.75`，返回目標 URL（如 `/pricing`）；否則返回 `NONE`。
3. **即時執行**：
   * 前端收到回應後，**立即**從記憶體播放對應的預錄 MP3（約 1.5 - 2 秒）。
   * 若 `navigateUrl !== "NONE"`，在播放聲音的同時執行前端路由跳轉，並在畫面顯示「正在為您前往：{頁面名稱}」提示。

### 軌道 B：Slow Path（知識庫檢索 + 無縫語音接力）
1. **企業知識庫注入**：
   * 讀取 `knowledge-base/company-info.md` 作為唯一事實來源（Single Source of Truth）。
   * 若知識庫無相關資料，必須禮貌回覆會記錄並安排專人跟進，嚴禁編造資料（No Hallucination）。
2. **接力提示詞（Continuation Prompt）**：
   * 系統必須將軌道 A 選出的「預錄開場白原文」傳入大模型 Prompt，指令如下：
     > 「你剛剛已經對客人說出了開場白：『{clip_text}』。請直接順著這句話的語氣與上下文無縫接下去回答重點，絕對不可重複打招呼或重複說『等我幫你睇睇』。」
3. **語音輸出格式限制（TTS Friendly）**：
   * 廣東話回覆必須使用地道香港口語（如「係、唔係、嘅、咗、喺」），嚴禁使用書面語。
   * 回覆長度控制在 **2 至 3 句之內**（適合語音聆聽）。
   * **嚴禁輸出任何 Markdown 符號**（如 `*`、`#`、`-`、`1.`），避免 TTS 讀出符號名稱。

---

## 4. 前端音頻無縫拼接邏輯（Audio Queue Manager）
* 必須實作一個嚴格的 `AudioQueue` 狀態機：
  1. 狀態 `PLAYING_CLIP`：正在播放軌道 A 的預錄開場白。
  2. 狀態 `BUFFERING_STREAM`：軌道 B 的 TTS 音頻串流已到達，但開場白尚未播完，暫存於緩衝區。
  3. 狀態 `PLAYING_STREAM`：監聽預錄開場白的 `onended` 事件，在結束後的 **0 毫秒**內無縫啟動播放軌道 B 的回覆音頻。
* 支援「用戶打斷（Barge-in）」：當用戶在 AI 說話期間再次點擊 Mic 或開始說話，立即停止所有正在播放的音頻並清空隊列。

---

## 5. 開發與驗收階段（Phases）
* **Phase 1**：建立 `config/clips-config.json`、`config/site-map.json`、`knowledge-base/company-info.md` 及離線生成預錄 MP3 的腳本 `scripts/generate-clips.ts`。
* **Phase 2**：實作後端 `/api/fast-decision`（接入 Jev API）與 `/api/chat-relay`（接入知識庫與大模型）。
* **Phase 3**：重構前端 `AudioQueue` 播放管理器，實現雙軌並行請求、音軌無縫接力及自動網頁導航。
* **Phase 4**：建立一個包含 4 個頁面（主頁、療程服務、價目表、網上預約）的示範網站外殼，並加入「首音延遲（TTFA）毫秒計時器」供客戶 Demo 展示。
