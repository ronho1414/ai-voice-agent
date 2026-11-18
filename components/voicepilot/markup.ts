export const VOICEPILOT_MARKUP = `
<div class="stars-bg" aria-hidden="true"></div>
<canvas id="earth-canvas" aria-hidden="true"></canvas>
<div id="earth-fallback" class="earth-fallback" hidden>
  <div class="earth-fallback-orb" role="img" aria-label="地球靜態替代圖"></div>
  <p role="status">3D 地球未能啟動。頁面文字同按鈕仍然可以閱讀同操作。</p>
</div>

<div id="voice-guide-banner" class="voice-banner hidden">
  <p><strong>VoicePilot 語音掛載點已就緒。</strong> 請點擊右下角語音專員，或去<button type="button" onclick="navigateToPage('advantages')">核心優勢</button>了解知識庫。</p>
  <button type="button" onclick="hideVoiceBanner()">關閉提示</button>
</div>

<header>
  <nav class="navbar" id="site-nav" aria-label="主導航">
    <button type="button" class="brand" onclick="navigateToPage('home')">
      <span class="brand-mark" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.8 3.8 5.8 3.8 9S14.5 18.2 12 21c-2.5-2.8-3.8-5.8-3.8-9S9.5 5.8 12 3z"/></svg>
      </span>
      <span class="brand-name">VoicePilot</span>
      <span class="brand-zh">領聲智導</span>
    </button>
    <button type="button" class="nav-toggle" id="nav-toggle" aria-label="開啟選單" aria-expanded="false" aria-controls="nav-links" onclick="toggleSiteNav()">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
    </button>
    <div class="nav-links" id="nav-links">
      <button type="button" class="nav-btn-outline is-active" id="nav-tab-home" data-page="home" onclick="navigateToPage('home')">首頁</button>
      <button type="button" class="nav-btn-outline" onclick="scrollToSection('features')">功能</button>
      <button type="button" class="nav-btn-outline" id="nav-tab-advantages" data-page="advantages" onclick="navigateToPage('advantages')">核心優勢</button>
      <button type="button" class="nav-btn-outline" id="nav-tab-pricing" data-page="pricing" onclick="navigateToPage('pricing')">收費方案</button>
      <button type="button" class="nav-btn-outline" onclick="scrollToSection('use-cases')">適用行業</button>
      <button type="button" class="nav-btn-outline" id="nav-tab-about" data-page="about" onclick="navigateToPage('about')">關於我們</button>
      <button type="button" class="nav-btn-outline nav-cta" onclick="navigateToPage('about', { sectionId: 'demo-booking-form' })">預約 Demo</button>
    </div>
  </nav>
</header>

<main>
  <section id="hero" class="section section-hero" data-ball="hero">
    <div class="hero-layout">
      <div class="hero-copy">
        <p class="eyebrow">香港首創 · 0.35 秒三語語音專員</p>
        <h1>為你嘅網站配備識聽、識答、識帶路嘅 AI 語音專員</h1>
        <p class="lede">廣東話、普通話同英文。答案跟你上傳嘅企業 PDF 同網站資料，並可以聽聲跳頁、帶人去預約。</p>
        <div class="hero-actions">
          <button type="button" id="open-voice-demo-btn" data-voice-trigger="true" class="btn" onclick="handleVoiceDemoTrigger()">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4"/></svg>
            立即語音體驗
          </button>
          <button type="button" class="btn btn-ghost" onclick="navigateToPage('pricing')">查看收費方案</button>
        </div>
        <div class="stat-row">
          <div><strong>0.35s</strong><span>首音反應延遲</span></div>
          <div><strong>粵 · 普 · 英</strong><span>中英夾雜識別</span></div>
          <div><strong>1 行代碼</strong><span>嵌入現有網站</span></div>
        </div>
      </div>
      <article class="demo-card" aria-label="語音對話示意">
        <header><span>語音對話 · 示意</span><span>350ms</span></header>
        <div class="wave" id="hero-waveform" aria-hidden="true">
          <span class="voice-wave-bar" style="height:16px;animation-delay:.05s"></span>
          <span class="voice-wave-bar" style="height:28px;animation-delay:.15s"></span>
          <span class="voice-wave-bar" style="height:36px;animation-delay:.25s"></span>
          <span class="voice-wave-bar" style="height:22px;animation-delay:.35s"></span>
          <span class="voice-wave-bar" style="height:32px;animation-delay:.45s"></span>
          <span class="voice-wave-bar" style="height:18px;animation-delay:.55s"></span>
          <span class="voice-wave-bar" style="height:30px;animation-delay:.65s"></span>
          <span class="voice-wave-bar" style="height:24px;animation-delay:.75s"></span>
        </div>
        <p class="bubble" id="hero-demo-question">「呢款療程第一次試做幾錢？有冇額外收費？」</p>
        <p class="bubble bubble-ai" id="hero-demo-reply">新客試做價 HK$980 全包，我依家帶你去預約區。</p>
        <div class="sample-row">
          <button type="button" id="hero-sample-btn-0" class="is-active" onclick="switchHeroSample(0)">問價錢</button>
          <button type="button" id="hero-sample-btn-1" onclick="switchHeroSample(1)">問按揭</button>
          <button type="button" id="hero-sample-btn-2" onclick="switchHeroSample(2)">約時間</button>
        </div>
      </article>
    </div>
  </section>

  <section id="features" class="section section-product" data-ball="product">
    <div class="section-copy">
      <p class="eyebrow">Product</p>
      <h2>為香港訪客而設嘅 Voice Agent</h2>
      <p class="lede">由聽、講到帶路，整個流程都針對本地語言同網站體驗設計。</p>
      <div class="feature-list">
        <article class="feature-row">
          <div class="feature-icon-wrapper" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M13 3 5 14h7l-1 7 8-11h-7l1-7z"/></svg></div>
          <div><strong>0.35 秒 TTFA 超低延遲</strong><p id="feat-desc-0">雙軌並行接力，訪客講完即刻開口，唔使等 3 至 5 秒。</p></div>
        </article>
        <article class="feature-row">
          <div class="feature-icon-wrapper" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.4 2.6 3.6 5.6 3.6 9s-1.2 6.4-3.6 9c-2.4-2.6-3.6-5.6-3.6-9s1.2-6.4 3.6-9z"/></svg></div>
          <div><strong>三語即時切換</strong><p id="feat-desc-1">聽得明香港口音同中英夾雜，亦可以切換普通話或英文。</p></div>
        </article>
        <article class="feature-row">
          <div class="feature-icon-wrapper" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 12h10M12 6l6 6-6 6"/></svg></div>
          <div><strong>網頁導航</strong><p id="feat-desc-2">唔止用把口答，仲可以按對話跳去產品頁、介紹或預約表單。</p></div>
        </article>
        <article class="feature-row">
          <div class="feature-icon-wrapper" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 10v4h3l5 4V6L7 10H4zM16 9a4 4 0 0 1 0 6"/></svg></div>
          <div><strong>品牌專屬聲線</strong><p>可以由商業聲線庫挑選，或用短錄音克隆品牌代表聲線。</p></div>
        </article>
        <article class="feature-row">
          <div class="feature-icon-wrapper" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 6h14v10H8l-3 3V6z"/></svg></div>
          <div><strong>WhatsApp 轉接與跟進</strong><p>複雜個案可以把通話重點同聯絡資料交給真人同事。</p></div>
        </article>
        <article class="feature-row">
          <div class="feature-icon-wrapper" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 8h8v8H8zM4 12h4M16 12h4M12 4v4M12 16v4"/></svg></div>
          <div><strong>對話分析與一行安裝</strong><p>掌握高頻問題。WordPress、Shopify 或自建官網貼一行代碼就上線。</p></div>
        </article>
      </div>
    </div>
  </section>

  <section id="advantages" class="section section-solutions" data-ball="solutions">
    <div class="section-copy">
      <p class="eyebrow">Solutions</p>
      <h2>上傳公司 PDF，AI 只根據檔案作答</h2>
      <p class="lede">VoicePilot 企業知識庫只採用你上傳嘅價目表、手冊同條款。文件冇寫嘅嘢，唔會憑空作答。</p>
    </div>
    <div class="solutions-grid">
      <article class="solution-card">
        <div class="card-icon" aria-hidden="true"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 16V4M7 9l5-5 5 5M5 20h14"/></svg></div>
        <h3>上傳內部 PDF / 價目表</h3>
        <p>管理員後台直接上傳現有宣傳冊、價目表、FAQ 或規格書，並同步公開網站內容。</p>
      </article>
      <article class="solution-card">
        <div class="card-icon" aria-hidden="true"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg></div>
        <h3>語意切片同隔離索引</h3>
        <p>表格、條款同專有名詞會放入企業自己嘅索引。資料唔會用嚟訓練公開模型。</p>
      </article>
      <article class="solution-card">
        <div class="card-icon" aria-hidden="true"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 12a7 7 0 0 1 14 0M8 12a4 4 0 0 1 8 0M12 12v.01"/></svg></div>
        <h3>訪客發問即時作答</h3>
        <p>0.35 秒檢索對應段落，用廣東話、普通話或英文回答，並帶去相關頁面。</p>
      </article>
      <article class="solution-card">
        <div class="card-icon" aria-hidden="true"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3 5 6v6c0 4.2 2.8 7.2 7 9 4.2-1.8 7-4.8 7-9V6l-7-3z"/></svg></div>
        <h3>零幻覺邊界</h3>
        <p>報價同優惠只可以來自上傳文件。超出範圍就說明，並收集資料轉交真人。</p>
      </article>
      <article class="solution-card">
        <div class="card-icon" aria-hidden="true"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/></svg></div>
        <h3>30 秒更新</h3>
        <p>後台替換新版 PDF 之後，唔使改程式，全站採用最新資料。</p>
      </article>
      <article class="solution-card">
        <div class="card-icon" aria-hidden="true"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 12h8"/></svg></div>
        <h3>對比一般文字機械人</h3>
        <p>一般 chatbot 靠打字同公開資料。VoicePilot 用語音、私有檔案，並可以跳頁。</p>
      </article>
    </div>
  </section>

  <section id="pricing" class="section section-pricing" data-ball="pricing">
    <div class="section-copy">
      <p class="eyebrow">Pricing</p>
      <h2>三個香港企業語音方案</h2>
      <p class="lede">對比通話額度、PDF 知識庫、聲線克隆同全渠道。按年預繳享 8 折，兼豁免首年系統設定費。</p>
      <div class="billing-switch">
        <button type="button" id="billing-monthly-btn" class="is-active" onclick="setBillingCycle('monthly')">按月收費</button>
        <button type="button" id="billing-annual-btn" onclick="setBillingCycle('annual')">按年預繳 · 慳 20%</button>
      </div>
    </div>
    <div class="pricing-grid">
      <article class="pricing-card">
        <div class="pricing-header">
          <span class="pricing-icon" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16v12H4zM8 7V5h8v2"/></svg></span>
          <h3>商業啟動版</h3>
        </div>
        <p>單店診所、精品工作室同專業服務中小企。</p>
        <p class="price"><span id="price-starter-amount">HK$3,800</span> <span>/ 月</span></p>
        <p class="fine" id="price-starter-note">按月結算（按年預繳 HK$3,040 / 月）</p>
        <p class="fine">設定費 <span id="setup-starter-note">HK$6,800</span></p>
        <ul class="plan-list">
          <li>每月 1,000 分鐘三語通話</li>
          <li>最多 15 份企業 PDF</li>
          <li>最多 8 個網頁區塊導航</li>
          <li>內置商業聲線庫</li>
          <li>標準電郵及工作日支援</li>
        </ul>
        <button type="button" class="btn btn-ghost btn-block" onclick="navigateToPage('about', { sectionId: 'demo-booking-form', selectedPlan: 'starter' })">選擇啟動版</button>
      </article>
      <article class="pricing-card">
        <div class="pricing-header">
          <span class="pricing-icon" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l2.2 6.4H21l-5.4 4 2 6.6L12 16.8 6.4 20l2-6.6L3 9.4h6.8z"/></svg></span>
          <h3>專業成長版</h3>
          <span class="badge">最受香港企業歡迎</span>
        </div>
        <p>連鎖醫美、顧問同行業嘅高客單價品牌。</p>
        <p class="price"><span id="price-growth-amount">HK$8,800</span> <span>/ 月</span></p>
        <p class="fine" id="price-growth-note">按月結算（按年預繳 HK$7,040 / 月）</p>
        <p class="fine">設定費 <span id="setup-growth-note">HK$12,800</span></p>
        <ul class="plan-list">
          <li>每月 3,500 分鐘</li>
          <li>無限份 PDF 知識庫</li>
          <li>無限頁面同表單導航</li>
          <li>1 組品牌真人聲線克隆</li>
          <li>意圖分析、WhatsApp 轉接、專屬客戶成功經理</li>
        </ul>
        <button type="button" class="btn btn-block" onclick="navigateToPage('about', { sectionId: 'demo-booking-form', selectedPlan: 'growth' })">立即預約部署</button>
      </article>
      <article class="pricing-card pricing-card-featured">
        <div class="pricing-header">
          <span class="pricing-icon" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.4 2.6 3.6 5.6 3.6 9s-1.2 6.4-3.6 9c-2.4-2.6-3.6-5.6-3.6-9s1.2-6.4 3.6-9z"/></svg></span>
          <h3>全渠道企業版</h3>
        </div>
        <p>多分店集團、金融機構同需要官網、電話熱線、WhatsApp 打通嘅團隊。</p>
        <p class="price"><span id="price-enterprise-amount">HK$18,800</span> <span>/ 月</span></p>
        <p class="fine" id="price-enterprise-note">按月結算（按年預繳 HK$15,040 / 月）</p>
        <p class="fine">專屬架構 <span id="setup-enterprise-note">豁免首年顧問費</span></p>
        <ul class="plan-list">
          <li>每月 10,000+ 分鐘彈性池</li>
          <li>無限檔案加 API 同步、多分店隔離</li>
          <li>3 組聲線克隆</li>
          <li>官網、固網電話熱線、WhatsApp</li>
          <li>CRM Webhook、99.9% SLA、7×24 架構師</li>
        </ul>
        <button type="button" class="btn btn-block" onclick="navigateToPage('about', { sectionId: 'demo-booking-form', selectedPlan: 'enterprise' })">聯絡企業顧問</button>
      </article>
    </div>
  </section>

  <div class="section-follow" id="pricing-details">
    <h2 class="follow-title">完整功能與配額對比</h2>
    <div class="table-scroll">
      <table class="compare-table">
        <thead>
          <tr>
            <th>
              <label class="check-label" for="diff-only-checkbox">
                <input type="checkbox" id="diff-only-checkbox" onchange="toggleDiffOnlyRows(this.checked)">
                僅顯示差異項目
              </label>
              <span id="diff-row-counter">全部 19 項</span>
            </th>
            <th>Starter<br><span id="table-price-starter">HK$3,800</span></th>
            <th>Growth<br><span id="table-price-growth">HK$8,800</span></th>
            <th>Enterprise<br><span id="table-price-enterprise">HK$18,800</span></th>
          </tr>
        </thead>
        <tbody>
          <tr class="comparison-feature-row" data-same="true"><td>0.35 秒 TTFA 雙軌並行</td><td>有</td><td>有</td><td>有</td></tr>
          <tr class="comparison-feature-row" data-same="true"><td>廣東話／普通話／英文即時切換</td><td>有</td><td>有</td><td>有</td></tr>
          <tr class="comparison-feature-row" data-same="false"><td>每月三語通話額度</td><td>1,000 分鐘</td><td>3,500 分鐘</td><td>10,000+ 分鐘</td></tr>
          <tr class="comparison-feature-row" data-same="false"><td>超額通話費率</td><td>HK$3.8 / 分鐘</td><td>HK$2.8 / 分鐘</td><td>HK$1.9 / 分鐘</td></tr>
          <tr class="comparison-feature-row" data-same="false"><td>同時在線通話線數</td><td>最多 5 線</td><td>最多 20 線</td><td>無上限</td></tr>
          <tr class="comparison-feature-row" data-same="false"><td>企業 PDF / 價目表數量</td><td>最多 15 份</td><td>無限份</td><td>無限份＋ API 同步</td></tr>
          <tr class="comparison-feature-row" data-same="false"><td>公開網站內容更新</td><td>最多 50 頁</td><td>無限頁，每日同步</td><td>無限頁，即時 Webhook</td></tr>
          <tr class="comparison-feature-row" data-same="true"><td>嚴格依據上傳檔案作答</td><td>有</td><td>有</td><td>有</td></tr>
          <tr class="comparison-feature-row" data-same="false"><td>多品牌／多分店知識庫隔離</td><td>無</td><td>無</td><td>有</td></tr>
          <tr class="comparison-feature-row" data-same="false"><td>網頁自動跳轉</td><td>最多 8 個區塊</td><td>無限頁面及表單</td><td>無限跨網域</td></tr>
          <tr class="comparison-feature-row" data-same="false"><td>對話意圖分析</td><td>基礎統計</td><td>有</td><td>有</td></tr>
          <tr class="comparison-feature-row" data-same="false"><td>WhatsApp 轉接</td><td>無</td><td>有</td><td>有</td></tr>
          <tr class="comparison-feature-row" data-same="false"><td>CRM / 預約 Webhook</td><td>無</td><td>標準輸出</td><td>雙向即時同步</td></tr>
          <tr class="comparison-feature-row" data-same="true"><td>內置商業聲線庫</td><td>有</td><td>有</td><td>有</td></tr>
          <tr class="comparison-feature-row" data-same="false"><td>品牌真人聲線克隆</td><td>無</td><td>1 組</td><td>3 組</td></tr>
          <tr class="comparison-feature-row" data-same="true"><td>一行 script 掛載</td><td>有</td><td>有</td><td>有</td></tr>
          <tr class="comparison-feature-row" data-same="false"><td>全渠道</td><td>只限網站</td><td>網站＋ WhatsApp</td><td>官網＋固網電話＋ WhatsApp</td></tr>
          <tr class="comparison-feature-row" data-same="false"><td>服務時間保障</td><td>99.5% SLA</td><td>99.8% SLA</td><td>99.9% SLA</td></tr>
          <tr class="comparison-feature-row" data-same="false"><td>技術支援</td><td>電郵及工作日</td><td>客戶成功經理</td><td>7×24 架構師</td></tr>
        </tbody>
      </table>
    </div>
    <div class="faq-list">
      <h2 class="follow-title">收費與部署常見問題</h2>
      <article class="faq-item">
        <button type="button" onclick="toggleFaqItem(0)">由簽約到上線需要幾耐？ <svg id="faq-icon-0" class="is-open" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>
        <p id="faq-body-0">一般 3 至 5 個工作天。團隊匯入網站同 PDF、設定導航同聲線之後，貼一行 script 就啟用。</p>
      </article>
      <article class="faq-item">
        <button type="button" onclick="toggleFaqItem(1)">分鐘超出上限會唔會停機？ <svg id="faq-icon-1" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>
        <p id="faq-body-1" hidden>唔會突然斷線。80% 同 100% 會通知。超額費率係 Starter HK$3.8、Growth HK$2.8、Enterprise HK$1.9 每分鐘。</p>
      </article>
      <article class="faq-item">
        <button type="button" onclick="toggleFaqItem(2)">按年預繳有咩優惠？ <svg id="faq-icon-2" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>
        <p id="faq-body-2" hidden>按年預繳係 8 折，兼豁免首年系統設定費。</p>
      </article>
      <article class="faq-item">
        <button type="button" onclick="toggleFaqItem(3)">更新價目表 PDF 要另收費嗎？ <svg id="faq-icon-3" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>
        <p id="faq-body-3" hidden>唔使。所有方案都可以喺管理員後台自行替換 PDF，大約 30 秒後採用新資料。</p>
      </article>
    </div>
  </div>

  <section id="use-cases" class="section section-usecases" data-ball="usecases">
    <div class="section-copy">
      <p class="eyebrow">Use cases</p>
      <h2>每個需要即時回應嘅行業都用得著</h2>
      <p class="lede">點選行業，睇訪客點樣問，以及語音專員點樣答同跳頁。</p>
    </div>
    <article class="glass-card industry-banner">
      <img id="industry-banner-img" src="https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&w=1600&q=80" alt="零售電商 · 實時語音導購">
      <div>
        <p class="eyebrow" id="industry-banner-tag">零售電商 · 實時語音導購</p>
        <h3 id="industry-banner-title">由第一句查詢開始，已經似真人對答</h3>
        <p id="industry-banner-sub">電話、WhatsApp 同網站查詢，用同一把品牌聲音與企業知識庫服務客戶。</p>
        <p class="bubble" id="industry-banner-query">「邊款禮盒套裝最適合送禮？有冇現貨可以今日寄出？」</p>
        <p class="fine" id="industry-banner-action">AI 已依據庫存表回答，並自動跳轉至皇牌禮盒專頁</p>
      </div>
    </article>
    <div class="usecase-list">
      <button type="button" class="usecase-item is-active" id="ind-card-0" onclick="selectIndustryShowcase(0)">
        <span class="usecase-icon-wrapper" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 8h12l-1 12H7L6 8zM9 8V6a3 3 0 0 1 6 0v2"/></svg></span>
        <span><strong>零售電商</strong><p>問邊款適合送禮，AI 按產品目錄回答並帶到產品頁。</p></span>
      </button>
      <button type="button" class="usecase-item" id="ind-card-1" onclick="selectIndustryShowcase(1)">
        <span class="usecase-icon-wrapper" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 10h16M6 10v8M10 10v8M14 10v8M18 10v8M3 18h18M8 10V6h8v4"/></svg></span>
        <span><strong>金融保險</strong><p>按保障條款 PDF 用廣東話答基本問題，再轉介持牌顧問。</p></span>
      </button>
      <button type="button" class="usecase-item" id="ind-card-2" onclick="selectIndustryShowcase(2)">
        <span class="usecase-icon-wrapper" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20h16M6 20V8l6-4 6 4v12"/></svg></span>
        <span><strong>地產代理</strong><p>按預算同地區推介盤源，並去到平面圖同睇樓查詢。</p></span>
      </button>
      <button type="button" class="usecase-item" id="ind-card-3" onclick="selectIndustryShowcase(3)">
        <span class="usecase-icon-wrapper" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21s7-5.4 7-11a7 7 0 0 0-14 0c0 5.6 7 11 7 11z"/></svg></span>
        <span><strong>醫療美容</strong><p>按診所價目表答療程流程同試做收費，再引導預約。</p></span>
      </button>
      <button type="button" class="usecase-item" id="ind-card-4" onclick="selectIndustryShowcase(4)">
        <span class="usecase-icon-wrapper" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 9 12 4l9 5-9 5-9-5zM7 12v5c2 1.4 8 1.4 10 0v-5"/></svg></span>
        <span><strong>教育培訓</strong><p>按課程手冊介紹內容同開班日期，引導登記試堂。</p></span>
      </button>
      <button type="button" class="usecase-item" id="ind-card-5" onclick="selectIndustryShowcase(5)">
        <span class="usecase-icon-wrapper" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 16l9-5 9 5M7 14.2V18l5 2 5-2v-3.8"/></svg></span>
        <span><strong>旅遊酒店</strong><p>三語答房型、接送同行程，帶訪客去訂房頁。</p></span>
      </button>
    </div>
  </section>

  <section id="about" class="section section-contact" data-ball="contact">
    <div class="section-copy">
      <p class="eyebrow">About · Contact</p>
      <h2>讓香港企業網站有一把識聽、識帶路、有據可依嘅聲音</h2>
      <p class="lede">VoicePilot AI（領聲智導）做低延遲語音同企業知識庫。訪客唔使自己慢慢搵資料，亦唔使同反應慢嘅文字機械人打字。研發中心喺尖沙咀廣東道力寶太陽廣場 12 樓。</p>
    </div>
    <div class="pillar-grid">
      <article class="pillar">
        <div class="card-icon" aria-hidden="true"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/></svg></div>
        <h3>紮根香港三語</h3>
        <p>針對醫美、金融、地產、零售嘅本地用語，聽落似資深前台。</p>
      </article>
      <article class="pillar">
        <div class="card-icon" aria-hidden="true"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M13 3 5 14h7l-1 7 8-11h-7l1-7z"/></svg></div>
        <h3>0.35 秒低延遲</h3>
        <p>對話停頓大約 0.3 至 0.5 秒。雙軌接力把首音壓到 350 毫秒一級。</p>
      </article>
      <article class="pillar">
        <div class="card-icon" aria-hidden="true"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3 5 6v6c0 4.2 2.8 7.2 7 9 4.2-1.8 7-4.8 7-9V6l-7-3z"/></svg></div>
        <h3>知識庫零幻覺</h3>
        <p>報價同條款只可以來自客戶上傳嘅 PDF 同官方網頁。</p>
      </article>
    </div>
    <div class="stat-row" style="max-width:760px;margin-left:auto;margin-right:auto">
      <div><strong>0.35s</strong><span>平均首音反應</span></div>
      <div><strong>99.4%</strong><span>企業知識庫準確率</span></div>
      <div><strong>3–5 日</strong><span>專屬系統上線</span></div>
    </div>

    <div id="demo-booking-form">
      <div id="contact-form" class="section-copy" style="margin-top:2.5rem">
        <h2>預約 15 分鐘語音 Demo</h2>
        <p class="lede">留下公司網址之後，團隊可以預先睇你嘅網站同 PDF，再示範廣東話專員點樣接待同跳頁。下面表格只會喺瀏覽器檢查格式。</p>
      </div>
      <form id="lead-form" class="contact-form" novalidate onsubmit="handleLeadSubmit(event)">
        <div class="form-grid">
          <div class="field">
            <label for="company-name">公司名稱</label>
            <input id="company-name" name="company" type="text" autocomplete="organization" required>
          </div>
          <div class="field">
            <label for="contact-person">聯絡人姓名</label>
            <input id="contact-person" name="name" type="text" autocomplete="name" required>
          </div>
        </div>
        <div class="form-grid">
          <div class="field">
            <label for="contact-phone">WhatsApp / 電話</label>
            <input id="contact-phone" name="tel" type="tel" autocomplete="tel" required>
          </div>
          <div class="field">
            <label for="website-url">現有網站網址</label>
            <input id="website-url" name="url" type="text" inputmode="url" autocomplete="url" required>
          </div>
        </div>
        <div class="field">
          <label for="inquiry-note">感興趣方案</label>
          <select id="inquiry-note" name="plan">
            <option value="growth">專業成長版 Growth（HK$8,800/月）</option>
            <option value="starter">商業啟動版 Starter（HK$3,800/月）</option>
            <option value="enterprise">全渠道企業版 Enterprise（HK$18,800/月）</option>
          </select>
        </div>
        <div id="selected-plan-banner" class="plan-banner hidden">
          <span id="selected-plan-banner-text">已為你預選方案</span>
          <button type="button" class="text-btn" onclick="navigateToPage('pricing')">返回對比方案</button>
        </div>
        <p id="lead-form-error" class="form-error" hidden role="alert"></p>
        <button type="submit" class="btn">檢查並顯示結果</button>
      </form>
      <div id="lead-form-success" class="form-success hidden" role="status">
        <h3>格式檢查完成</h3>
        <p id="lead-success-detail"></p>
        <button type="button" class="text-btn" onclick="resetLeadForm()">再檢查另一份資料</button>
      </div>
    </div>

    <footer class="site-footer">
      <div>
        <button type="button" onclick="navigateToPage('home')">首頁</button>
        <button type="button" onclick="navigateToPage('advantages')">核心優勢</button>
        <button type="button" onclick="navigateToPage('pricing')">收費方案</button>
        <button type="button" onclick="navigateToPage('about')">關於我們</button>
      </div>
      <p>© 2026 VoicePilot AI（領聲智導）。符合香港《個人資料（私隱）條例》標準。</p>
    </footer>
  </section>
</main>

<div id="CURSOR_VOICE_WIDGET_MOUNT_POINT" data-voice-widget-mount="true"></div>
`;
