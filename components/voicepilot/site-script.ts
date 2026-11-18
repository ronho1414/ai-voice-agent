export const VOICEPILOT_SCRIPT = `
const VALID_PAGES = ['home', 'advantages', 'pricing', 'about'];
let currentActivePage = 'home';
let currentBillingCycle = 'monthly';

const PLAN_DISPLAY_LABELS = {
  starter: '商業啟動版 Starter',
  growth: '專業成長版 Growth',
  enterprise: '全渠道企業版 Enterprise'
};

const PAGE_TARGETS = {
  home: 'hero',
  advantages: 'advantages',
  pricing: 'pricing',
  about: 'about'
};

const BALL_BY_SECTION = {
  hero: 'hero',
  features: 'product',
  advantages: 'solutions',
  pricing: 'pricing',
  'use-cases': 'usecases',
  about: 'contact',
  'demo-booking-form': 'contact'
};

const HERO_SAMPLES = [
  {
    question: '「呢款療程第一次試做幾錢？有冇額外收費？」',
    reply: '新客試做價 HK$980 全包，我依家帶你去預約區。'
  },
  {
    question: '「1,200 萬樓齡 35 年嘅物業最高可以做到幾成按揭？」',
    reply: '按最新內部指引最高可做 7 成按揭，我帶你睇按揭計算區。'
  },
  {
    question: '「我想預約今個星期五下午 3 點過嚟尖沙咀分店諮詢」',
    reply: '無問題，星期五下午 3 點有位，我幫你跳轉到預約表單。'
  }
];

const INDUSTRY_SHOWCASES = [
  {
    tag: '零售電商 · 實時語音導購',
    title: '由第一句查詢開始，已經似真人對答',
    sub: '電話、WhatsApp 同網站查詢，用同一把品牌聲音與企業知識庫服務客戶。',
    query: '「邊款禮盒套裝最適合送禮？有冇現貨可以今日寄出？」',
    action: 'AI 已依據庫存表回答，並自動跳轉至皇牌禮盒專頁',
    img: 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&w=1600&q=80'
  },
  {
    tag: '金融保險 · 合規條款精準解答',
    title: '嚴格依據保障手冊 PDF，零偏差回應保單查詢',
    sub: '將數百頁產品條款與理賠細則匯入知識庫，24 小時解答客戶保障範圍。',
    query: '「呢份高端醫療計劃包唔包日間門診手術同 MRI 檢查？」',
    action: 'AI 已根據 2026 保障細則準確作答，並引導預約持牌顧問',
    img: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1600&q=80'
  },
  {
    tag: '地產代理 · 智能搵樓與預約睇樓',
    title: '聽明預算、校網與按揭需求，秒速篩選心水盤源',
    sub: '訪客唔使自己逐個篩選器慢慢撳，開口講需求即刻跳轉對應樓盤介紹。',
    query: '「我想搵九龍站一帶兩房單位，預算 1,400 萬左右，有冇推介？」',
    action: 'AI 已篩選 3 個符合預算放盤，並自動打開平面圖與睇樓預約',
    img: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1600&q=80'
  },
  {
    tag: '醫療美容 · 24 小時療程諮詢與分流',
    title: '深夜瀏覽網站一樣有專業治療師級別語音解答',
    sub: '根據診所最新試做價目表回答儀器分別與恢復期，直接引導填寫預約。',
    query: '「Pico 激光同普通彩光有咩分別？做完要唔要戒口？」',
    action: 'AI 已依據療程手冊清晰解答，並跳轉至新客試做登記表單',
    img: 'https://images.unsplash.com/photo-1629909613654-28e377c37b09?auto=format&fit=crop&w=1600&q=80'
  },
  {
    tag: '教育培訓 · 課程配對與試堂登記',
    title: '根據學生年級與目標，自動推介最合適課程時間表',
    sub: '匯入最新學期章程與學費表，即時回應家長查詢並收集試堂資料。',
    query: '「小朋友下年升小一，想報 phonics 同面試班，星期六有冇堂？」',
    action: 'AI 已核對星期六時間表作答，並帶家長前往免費評估登記頁',
    img: 'https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=1600&q=80'
  },
  {
    tag: '旅遊酒店 · 三語禮賓與房型預訂',
    title: '中英日韓訪客無障礙查詢，縮短預訂決策時間',
    sub: '即時回應機場接送、延遲退房及套票優惠，直接帶客進入預訂結帳。',
    query: '「Do you have sea-view family suites available this weekend with breakfast?」',
    action: 'AI 已用流利英語確認海景套房供應，並自動跳轉至預訂頁面',
    img: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1600&q=80'
  }
];

function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function scrollToId(id) {
  const target = document.getElementById(id);
  if (!target) return;
  target.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  const ball = BALL_BY_SECTION[id];
  if (ball) {
    window.dispatchEvent(new CustomEvent('voicepilot:section', { detail: { ball: ball } }));
  }
}

function closeSiteNav() {
  const nav = document.getElementById('site-nav');
  const toggle = document.getElementById('nav-toggle');
  if (nav) nav.classList.remove('nav-active');
  if (toggle) {
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', '開啟選單');
  }
}

function toggleSiteNav() {
  const nav = document.getElementById('site-nav');
  const toggle = document.getElementById('nav-toggle');
  if (!nav || !toggle) return;
  const open = nav.classList.toggle('nav-active');
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  toggle.setAttribute('aria-label', open ? '關閉選單' : '開啟選單');
}

function scrollToSection(sectionId) {
  const page = sectionId === 'advantages'
    ? 'advantages'
    : sectionId === 'pricing'
      ? 'pricing'
      : sectionId === 'about' || sectionId === 'demo-booking-form'
        ? 'about'
        : 'home';
  currentActivePage = page;
  updateNavbarActiveState(page);
  if (window.location.hash !== '#' + page) {
    history.replaceState(null, '', '#' + page);
  }
  closeSiteNav();
  scrollToId(sectionId);
}

window.navigateToPage = function(pageId, options) {
  const targetPage = VALID_PAGES.includes(pageId) ? pageId : 'home';
  currentActivePage = targetPage;

  let targetSectionId = null;
  let selectedPlan = null;
  if (typeof options === 'string') {
    targetSectionId = options;
  } else if (options && typeof options === 'object') {
    targetSectionId = options.sectionId || null;
    selectedPlan = options.selectedPlan || null;
  }

  updateNavbarActiveState(targetPage);

  if (selectedPlan && PLAN_DISPLAY_LABELS[selectedPlan]) {
    const selectEl = document.getElementById('inquiry-note');
    const bannerEl = document.getElementById('selected-plan-banner');
    const bannerTextEl = document.getElementById('selected-plan-banner-text');
    if (selectEl) selectEl.value = selectedPlan;
    if (bannerEl && bannerTextEl) {
      const cycleLabel = currentBillingCycle === 'annual' ? '按年預繳 · 8 折優惠' : '按月收費';
      bannerTextEl.textContent = '已為你預選：' + PLAN_DISPLAY_LABELS[selectedPlan] + '（' + cycleLabel + '）';
      bannerEl.classList.remove('hidden');
    }
  }

  if (window.location.hash !== '#' + targetPage) {
    history.replaceState(null, '', '#' + targetPage);
  }

  closeSiteNav();
  scrollToId(targetSectionId || PAGE_TARGETS[targetPage]);
};

function updateNavbarActiveState(activePage) {
  document.querySelectorAll('[data-page]').forEach((button) => {
    const match = button.getAttribute('data-page') === activePage;
    button.classList.toggle('is-active', match);
    if (match) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}

function handleVoiceDemoTrigger() {
  const banner = document.getElementById('voice-guide-banner');
  if (banner) banner.classList.remove('hidden');
  window.dispatchEvent(new CustomEvent('voicepilot:open-widget', {
    detail: { source: 'website-cta', currentPage: currentActivePage }
  }));
}

function hideVoiceBanner() {
  const banner = document.getElementById('voice-guide-banner');
  if (banner) banner.classList.add('hidden');
}

function switchHeroSample(idx) {
  const sample = HERO_SAMPLES[idx];
  if (!sample) return;
  const question = document.getElementById('hero-demo-question');
  const reply = document.getElementById('hero-demo-reply');
  if (question) question.textContent = sample.question;
  if (reply) reply.textContent = sample.reply;
  HERO_SAMPLES.forEach((_, i) => {
    const button = document.getElementById('hero-sample-btn-' + i);
    if (button) button.classList.toggle('is-active', i === idx);
  });
}

function selectIndustryShowcase(idx) {
  const item = INDUSTRY_SHOWCASES[idx];
  if (!item) return;
  const img = document.getElementById('industry-banner-img');
  const tag = document.getElementById('industry-banner-tag');
  const title = document.getElementById('industry-banner-title');
  const sub = document.getElementById('industry-banner-sub');
  const query = document.getElementById('industry-banner-query');
  const action = document.getElementById('industry-banner-action');
  if (img) {
    img.hidden = false;
    img.src = item.img;
    img.alt = item.tag;
  }
  if (tag) tag.textContent = item.tag;
  if (title) title.textContent = item.title;
  if (sub) sub.textContent = item.sub;
  if (query) query.textContent = item.query;
  if (action) action.textContent = item.action;
  INDUSTRY_SHOWCASES.forEach((_, i) => {
    const card = document.getElementById('ind-card-' + i);
    if (card) card.classList.toggle('is-active', i === idx);
  });
}

function setBillingCycle(cycle) {
  currentBillingCycle = cycle;
  const monthlyBtn = document.getElementById('billing-monthly-btn');
  const annualBtn = document.getElementById('billing-annual-btn');
  if (monthlyBtn) monthlyBtn.classList.toggle('is-active', cycle !== 'annual');
  if (annualBtn) annualBtn.classList.toggle('is-active', cycle === 'annual');

  const starterAmount = document.getElementById('price-starter-amount');
  const starterNote = document.getElementById('price-starter-note');
  const setupStarterNote = document.getElementById('setup-starter-note');
  const growthAmount = document.getElementById('price-growth-amount');
  const growthNote = document.getElementById('price-growth-note');
  const setupGrowthNote = document.getElementById('setup-growth-note');
  const enterpriseAmount = document.getElementById('price-enterprise-amount');
  const enterpriseNote = document.getElementById('price-enterprise-note');
  const tableStarter = document.getElementById('table-price-starter');
  const tableGrowth = document.getElementById('table-price-growth');
  const tableEnterprise = document.getElementById('table-price-enterprise');

  if (cycle === 'annual') {
    if (starterAmount) starterAmount.textContent = 'HK$3,040';
    if (starterNote) starterNote.textContent = '按年預繳 HK$36,480（已慳 HK$9,120 / 年）';
    if (setupStarterNote) setupStarterNote.textContent = 'HK$0（已豁免 HK$6,800）';
    if (growthAmount) growthAmount.textContent = 'HK$7,040';
    if (growthNote) growthNote.textContent = '按年預繳 HK$84,480（已慳 HK$21,120 / 年）';
    if (setupGrowthNote) setupGrowthNote.textContent = 'HK$0（已豁免 HK$12,800）';
    if (enterpriseAmount) enterpriseAmount.textContent = 'HK$15,040';
    if (enterpriseNote) enterpriseNote.textContent = '按年預繳 HK$180,480（已慳 HK$45,120 / 年）';
    if (tableStarter) tableStarter.textContent = 'HK$3,040';
    if (tableGrowth) tableGrowth.textContent = 'HK$7,040';
    if (tableEnterprise) tableEnterprise.textContent = 'HK$15,040';
  } else {
    if (starterAmount) starterAmount.textContent = 'HK$3,800';
    if (starterNote) starterNote.textContent = '按月結算（按年預繳 HK$3,040 / 月）';
    if (setupStarterNote) setupStarterNote.textContent = 'HK$6,800';
    if (growthAmount) growthAmount.textContent = 'HK$8,800';
    if (growthNote) growthNote.textContent = '按月結算（按年預繳 HK$7,040 / 月）';
    if (setupGrowthNote) setupGrowthNote.textContent = 'HK$12,800';
    if (enterpriseAmount) enterpriseAmount.textContent = 'HK$18,800';
    if (enterpriseNote) enterpriseNote.textContent = '按月結算（按年預繳 HK$15,040 / 月）';
    if (tableStarter) tableStarter.textContent = 'HK$3,800';
    if (tableGrowth) tableGrowth.textContent = 'HK$8,800';
    if (tableEnterprise) tableEnterprise.textContent = 'HK$18,800';
  }
}

function toggleDiffOnlyRows(onlyDiff) {
  const rows = document.querySelectorAll('.comparison-feature-row');
  let visibleCount = 0;
  rows.forEach((row) => {
    const isSame = row.getAttribute('data-same') === 'true';
    if (onlyDiff && isSame) row.classList.add('hidden');
    else {
      row.classList.remove('hidden');
      visibleCount += 1;
    }
  });
  const counter = document.getElementById('diff-row-counter');
  if (counter) counter.textContent = onlyDiff ? '差異 ' + visibleCount + ' 項' : '全部 ' + rows.length + ' 項';
}

function toggleFaqItem(idx) {
  const body = document.getElementById('faq-body-' + idx);
  const icon = document.getElementById('faq-icon-' + idx);
  if (!body) return;
  const willOpen = body.hasAttribute('hidden');
  if (willOpen) body.removeAttribute('hidden');
  else body.setAttribute('hidden', '');
  if (icon) icon.classList.toggle('is-open', willOpen);
}

function fieldValue(id) {
  const el = document.getElementById(id);
  return el && 'value' in el ? String(el.value).trim() : '';
}

function markInvalid(id, invalid) {
  const el = document.getElementById(id);
  if (el) el.setAttribute('aria-invalid', invalid ? 'true' : 'false');
}

function handleLeadSubmit(event) {
  event.preventDefault();
  const company = fieldValue('company-name');
  const person = fieldValue('contact-person');
  const phone = fieldValue('contact-phone');
  const url = fieldValue('website-url');
  const phoneDigits = phone.replace(/\\D/g, '');
  const websiteOk = /^https?:\\/\\/\\S+$/i.test(url) || /^[^\\s]+\\.[^\\s]+$/.test(url);
  const checks = [
    ['company-name', company.length > 0],
    ['contact-person', person.length > 0],
    ['contact-phone', phoneDigits.length >= 8],
    ['website-url', websiteOk]
  ];
  let valid = true;
  checks.forEach(([id, ok]) => {
    markInvalid(id, !ok);
    if (!ok) valid = false;
  });
  const error = document.getElementById('lead-form-error');
  const success = document.getElementById('lead-form-success');
  if (!valid) {
    if (error) {
      error.hidden = false;
      error.textContent = '請填寫公司名稱、聯絡人、至少 8 位數字嘅電話，以及有效網站網址。表格尚未送出。';
    }
    if (success) success.classList.add('hidden');
    return;
  }
  if (error) error.hidden = true;
  const form = document.getElementById('lead-form');
  if (form) form.classList.add('hidden');
  if (success) success.classList.remove('hidden');
  const detail = document.getElementById('lead-success-detail');
  if (detail) {
    detail.textContent = '已檢查 ' + person + '（' + company + '）同網站 ' + url + ' 嘅格式。這份表格尚未送出，沒有傳送到伺服器，亦未有人收到。';
  }
}

function resetLeadForm() {
  const form = document.getElementById('lead-form');
  const success = document.getElementById('lead-form-success');
  if (form) {
    form.reset();
    form.classList.remove('hidden');
  }
  if (success) success.classList.add('hidden');
  ['company-name', 'contact-person', 'contact-phone', 'website-url'].forEach((id) => markInvalid(id, false));
}

window.addEventListener('hashchange', onVoicePilotHashChange);

function initVoicePilotSite() {
  const initialHash = window.location.hash.replace('#', '');
  if (VALID_PAGES.includes(initialHash)) navigateToPage(initialHash);
  else updateNavbarActiveState('home');
  const diff = document.getElementById('diff-only-checkbox');
  toggleDiffOnlyRows(Boolean(diff && diff.checked));
}

window.initVoicePilotSite = initVoicePilotSite;
window.__voicePilotTeardown = function () {
  window.removeEventListener('hashchange', onVoicePilotHashChange);
};

function onVoicePilotHashChange() {
  const hashPage = window.location.hash.replace('#', '');
  if (VALID_PAGES.includes(hashPage) && hashPage !== currentActivePage) navigateToPage(hashPage);
}

initVoicePilotSite();
`;
