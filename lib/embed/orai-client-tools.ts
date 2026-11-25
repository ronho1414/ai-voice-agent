export type NavigateOptions =
  | string
  | {
      sectionId?: string;
      section?: string;
      selectedAddon?: string;
      requestVoiceSample?: boolean;
    };

export type ClientToolFn = (params?: Record<string, unknown>) => unknown | Promise<unknown>;

export type ElevenLabsCallEventDetail = {
  config?: {
    clientTools?: Record<string, ClientToolFn>;
  };
};

export type OraiWindow = Window & {
  navigateToPage?: (pageId: string, options?: NavigateOptions) => unknown;
  calculatePlanCost?: (params?: Record<string, unknown>) => unknown;
  fillBookingForm?: (params?: Record<string, unknown>) => unknown;
};

const ADDON_LABELS: Record<string, string> = {
  nav: "網頁自動跳轉導航",
  form: "語音代填表單 / 互動計算機與篩選器操控",
  voice: "專屬品牌真人聲線克隆",
  whatsapp: "WhatsApp 客資即時推送 / API 接管",
  outbound: "AI 主動外呼跟進（Outbound Call）",
  crm: "CRM / 預約系統雙向 API 串接",
};

function wait(ms: number, win: Window): Promise<void> {
  return new Promise((resolve) => {
    win.setTimeout(resolve, ms);
  });
}

function firstValue(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = source[key];
    if (value != null && value !== "") return value;
  }
  return "";
}

function toText(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.round(value));
  return value == null ? "" : String(value);
}

function toNumberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toOptionalFlag(value: unknown): boolean | null {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return null;
}

function addonTokens(source: Record<string, unknown>): string[] {
  const raw = firstValue(source, ["addons", "features", "selectedAddons", "selectedAddon", "addon"]);
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : String(raw).split(/[,、|/]/);
  return list.map((item) => String(item).trim()).filter(Boolean);
}

function addonMatches(box: HTMLInputElement, token: string): boolean {
  const key = token.toLowerCase();
  const label = ADDON_LABELS[key];
  const value = box.value || "";
  const id = box.id || "";
  return Boolean((label && value === label) || id === `addon-${key}` || value === token || value.includes(token));
}

function pokeField(field: HTMLInputElement): void {
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

function flashField(field: HTMLElement | null, win: Window): void {
  if (!field) return;
  field.classList.add("ring-2", "ring-[#09090B]", "bg-white");
  win.setTimeout(() => {
    field.classList.remove("ring-2", "ring-[#09090B]", "bg-white");
  }, 1400);
}

function typeIntoInput(field: HTMLElement | null, text: unknown, win: Window): Promise<void> {
  return new Promise((resolve) => {
    if (!field || !("value" in field)) {
      resolve();
      return;
    }
    const input = field as HTMLInputElement;
    const value = text == null ? "" : String(text);
    let reduced = false;
    try {
      reduced = typeof win.matchMedia === "function" && win.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      reduced = false;
    }
    try {
      input.focus({ preventScroll: true });
    } catch {
      try {
        input.focus();
      } catch {
        // Keep filling even if focus is blocked in headless browsers.
      }
    }
    flashField(input, win);
    if (reduced || value.length === 0) {
      input.value = value;
      pokeField(input);
      resolve();
      return;
    }
    let index = 0;
    input.value = "";
    const timer = win.setInterval(() => {
      index += 1;
      input.value = value.slice(0, index);
      if (index >= value.length) {
        win.clearInterval(timer);
        pokeField(input);
        resolve();
      }
    }, 18);
  });
}

function applyAddons(doc: Document, tokens: string[]): void {
  if (!tokens.length) return;
  let boxes = doc.querySelectorAll<HTMLInputElement>(
    '#demo-booking-form input[name="interest-feature"], #lead-form input[name="interest-feature"]',
  );
  if (!boxes.length) {
    boxes = doc.querySelectorAll<HTMLInputElement>('input[name="interest-feature"]');
  }
  const labels: string[] = [];
  tokens.forEach((token) => {
    boxes.forEach((box) => {
      if (!addonMatches(box, token) || box.checked) return;
      box.checked = true;
      pokeField(box);
    });
    const label = ADDON_LABELS[token.toLowerCase()] || token;
    if (!labels.includes(label)) labels.push(label);
  });
  const bannerEl = doc.getElementById("selected-addon-banner");
  const bannerTextEl = doc.getElementById("selected-addon-banner-text");
  if (bannerEl && bannerTextEl && labels.length) {
    bannerTextEl.textContent = `✓ 已為你勾選：${labels.join("、")}`;
    bannerEl.classList.remove("hidden");
    bannerEl.classList.add("flex");
  }
}

function showCalcVoiceBar(doc: Document, message: string): void {
  const bar = doc.getElementById("calc-voice-status-bar");
  const barText = doc.getElementById("calc-voice-status-text");
  if (!bar || !barText) return;
  barText.textContent = message;
  bar.classList.remove("hidden");
  bar.classList.add("flex");
}

function showLeadForm(doc: Document): void {
  const form = doc.getElementById("lead-form");
  const success = doc.getElementById("lead-form-success");
  if (form) form.classList.remove("hidden");
  if (success) success.classList.add("hidden");
}

/**
 * Installs approved Orai homepage browser actions (`calculatePlanCost`, `fillBookingForm`)
 * used by ElevenLabs client tools on `/`.
 */
export function installHomepageActionHandlers(doc: Document, win: OraiWindow): void {
  win.calculatePlanCost = (params = {}) => {
    const minutes = toNumberOrNull(params.minutes != null ? params.minutes : params.monthlyMinutes);
    const avg = toNumberOrNull(
      params.avgMinutesPerCall != null ? params.avgMinutesPerCall : params.avgMinutes,
    );
    const sectionTarget = doc.getElementById("plan-cost-calculator") ? "plan-cost-calculator" : "pricing";
    win.navigateToPage?.("pricing", { sectionId: sectionTarget });
    showCalcVoiceBar(doc, "Orai service 正在為你自動填入通話分鐘並即時試算...");
    return wait(90, win).then(async () => {
      if (minutes != null) {
        await typeIntoInput(doc.getElementById("calc-minutes-input"), toText(minutes), win);
      }
      if (avg != null) {
        await typeIntoInput(doc.getElementById("calc-avg-mins-input"), toText(avg), win);
      }
      showCalcVoiceBar(doc, "已完成用量試算。具體專案報價歡迎預約免費評估。");
      return "Calculator updated";
    });
  };

  win.fillBookingForm = (params = {}) => {
    const company = toText(firstValue(params, ["companyName", "company", "company_name"]));
    const person = toText(
      firstValue(params, ["contactPerson", "contactName", "name", "person", "contact_person"]),
    );
    const phone = toText(firstValue(params, ["phone", "contactPhone", "whatsapp", "contact_phone"]));
    const website = toText(firstValue(params, ["website", "websiteUrl", "url", "website_url"]));
    const sample = toOptionalFlag(
      params.requestVoiceSample != null ? params.requestVoiceSample : params.voiceSample,
    );
    const tokens = addonTokens(params);

    win.navigateToPage?.("home", { sectionId: "demo-booking-form" });
    showLeadForm(doc);

    return wait(90, win).then(async () => {
      if (company) await typeIntoInput(doc.getElementById("company-name"), company, win);
      if (person) await typeIntoInput(doc.getElementById("contact-person"), person, win);
      if (phone) await typeIntoInput(doc.getElementById("contact-phone"), phone, win);
      if (website) await typeIntoInput(doc.getElementById("website-url"), website, win);
      applyAddons(doc, tokens);
      const sampleBox = doc.getElementById("request-voice-sample") as HTMLInputElement | null;
      if (sampleBox && sample != null) {
        sampleBox.checked = sample;
        pokeField(sampleBox);
      }
      return "Booking form filled";
    });
  };
}

/**
 * Creates the ElevenLabs Client Tools map mirroring the official `elevenlabs-convai:call`
 * integration pattern while delegating execution to Orai's homepage handlers.
 */
export function buildHomepageClientTools(win: OraiWindow): Record<string, ClientToolFn> {
  return {
    navigate_website: (params = {}) => {
      const page = typeof (params.page ?? params.pageId) === "string"
        ? String(params.page ?? params.pageId)
        : "home";
      const sectionId = params.sectionId ?? params.section;
      const options: Exclude<NavigateOptions, string> = {};
      if (typeof sectionId === "string" && sectionId) options.sectionId = sectionId;
      if (typeof params.selectedAddon === "string" && params.selectedAddon) {
        options.selectedAddon = params.selectedAddon;
      }
      if (params.requestVoiceSample === true) options.requestVoiceSample = true;
      win.navigateToPage?.(page, Object.keys(options).length ? options : undefined);
      return `Navigated to ${page}`;
    },
    calculate_plan_cost: (params = {}) => {
      if (typeof win.calculatePlanCost === "function") {
        return win.calculatePlanCost(params);
      }
      return "Calculator updated";
    },
    fill_booking_form: (params = {}) => {
      if (typeof win.fillBookingForm === "function") {
        return win.fillBookingForm(params);
      }
      return "Booking form filled";
    },
  };
}

/**
 * Registers `clientTools` on `elevenlabs-convai:call` and returns a cleanup callback.
 */
export function attachClientToolsListener(
  target: Pick<Document, "addEventListener" | "removeEventListener">,
  getTools: () => Record<string, ClientToolFn>,
): () => void {
  const onCall = (event: Event) => {
    const customEvent = event as CustomEvent<ElevenLabsCallEventDetail>;
    const config = customEvent.detail?.config;
    if (!config) return;
    const existing = config.clientTools && typeof config.clientTools === "object"
      ? config.clientTools
      : {};
    config.clientTools = { ...existing, ...getTools() };
  };
  target.addEventListener("elevenlabs-convai:call", onCall);
  return () => {
    target.removeEventListener("elevenlabs-convai:call", onCall);
  };
}
