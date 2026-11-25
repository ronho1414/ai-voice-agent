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

export const CANONICAL_BOOKING_TOOL_FIELDS = {
  companyName: "string (optional) -> #company-name",
  contactPerson: "string (optional) -> #contact-person",
  contactPhone: "string (optional) -> #contact-phone",
  websiteUrl: "string (optional) -> #website-url",
  addons: "string[] | string (optional; nav|form|voice|whatsapp|outbound|crm) -> input[name='interest-feature']",
  requestVoiceSample: "boolean (optional) -> #request-voice-sample",
} as const;

const ADDON_LABELS: Record<string, string> = {
  nav: "網頁自動跳轉導航",
  form: "語音代填表單 / 互動計算機與篩選器操控",
  voice: "專屬品牌真人聲線克隆",
  whatsapp: "WhatsApp 客資即時推送 / API 接管",
  outbound: "AI 主動外呼跟進（Outbound Call）",
  crm: "CRM / 預約系統雙向 API 串接",
};

let fillQueue: Promise<unknown> = Promise.resolve();

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
  // Case-insensitive and whitespace-trimmed fallback for mismatched tool schemas (e.g. "Phone", "CompanyName ").
  const normalizedEntries = new Map<string, unknown>();
  for (const [rawKey, value] of Object.entries(source)) {
    const clean = rawKey.trim().toLowerCase();
    if (!normalizedEntries.has(clean) && value != null && value !== "") {
      normalizedEntries.set(clean, value);
    }
  }
  for (const key of keys) {
    const match = normalizedEntries.get(key.trim().toLowerCase());
    if (match != null && match !== "") return match;
  }
  return "";
}

function toText(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.round(value));
  if (typeof value !== "string") return value == null ? "" : String(value).trim();
  return value.trim();
}

function toNumberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toOptionalFlag(value: unknown): boolean | null {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value === "string") {
    const clean = value.trim().toLowerCase();
    if (clean === "true" || clean === "1" || clean === "yes") return true;
    if (clean === "false" || clean === "0" || clean === "no") return false;
  }
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
  return Boolean(
    (label && value === label) ||
      id === `addon-${key}` ||
      value.toLowerCase() === key ||
      value.toLowerCase().includes(key),
  );
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

function typeIntoInput(field: HTMLElement | null, text: unknown, win: Window): Promise<boolean> {
  return new Promise((resolve) => {
    if (!field || !("value" in field)) {
      resolve(false);
      return;
    }
    const input = field as HTMLInputElement;
    const value = text == null ? "" : String(text);
    if (!value) {
      resolve(false);
      return;
    }
    if (input.value === value) {
      flashField(input, win);
      resolve(false);
      return;
    }

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
    if (reduced) {
      input.value = value;
      pokeField(input);
      resolve(true);
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
        resolve(true);
      }
    }, 18);
  });
}

function getAddonCheckboxes(doc: Document): HTMLInputElement[] {
  const scoped = doc.querySelectorAll<HTMLInputElement>(
    '#demo-booking-form input[name="interest-feature"], #lead-form input[name="interest-feature"]',
  );
  if (scoped.length > 0) return Array.from(scoped);
  return Array.from(doc.querySelectorAll<HTMLInputElement>('input[name="interest-feature"]'));
}

function syncAddonBanner(doc: Document, boxes: HTMLInputElement[], fallbackLabels: string[]): string[] {
  const checkedLabels = boxes
    .filter((box) => box.checked && box.value)
    .map((box) => box.value);
  const labels = checkedLabels.length > 0 ? checkedLabels : fallbackLabels;
  const bannerEl = doc.getElementById("selected-addon-banner");
  const bannerTextEl = doc.getElementById("selected-addon-banner-text");
  if (bannerEl && bannerTextEl && labels.length > 0) {
    bannerTextEl.textContent = `✓ 已為你勾選：${labels.join("、")}`;
    bannerEl.classList.remove("hidden");
    bannerEl.classList.add("flex");
  }
  return checkedLabels;
}

function applyAddons(doc: Document, tokens: string[]): { newlyChecked: number; checkedLabels: string[] } {
  const boxes = getAddonCheckboxes(doc);
  if (!tokens.length) {
    return {
      newlyChecked: 0,
      checkedLabels: boxes.filter((box) => box.checked && box.value).map((box) => box.value),
    };
  }
  let newlyChecked = 0;
  const fallbackLabels: string[] = [];
  tokens.forEach((token) => {
    boxes.forEach((box) => {
      if (!addonMatches(box, token) || box.checked) return;
      box.checked = true;
      newlyChecked += 1;
      pokeField(box);
    });
    const label = ADDON_LABELS[token.toLowerCase()] || token;
    if (!fallbackLabels.includes(label)) fallbackLabels.push(label);
  });
  return { newlyChecked, checkedLabels: syncAddonBanner(doc, boxes, fallbackLabels) };
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

function readInputValue(doc: Document, id: string): string {
  const el = doc.getElementById(id) as HTMLInputElement | null;
  return el && typeof el.value === "string" ? el.value.trim() : "";
}

/**
 * Installs approved Orai homepage browser actions (`calculatePlanCost`, `fillBookingForm`)
 * used by ElevenLabs client tools on `/`.
 */
export function installHomepageActionHandlers(doc: Document, win: OraiWindow): void {
  win.calculatePlanCost = (params = {}) => {
    const minutes = toNumberOrNull(
      firstValue(params, ["minutes", "monthlyMinutes", "monthly_minutes"]),
    );
    const avg = toNumberOrNull(
      firstValue(params, ["avgMinutesPerCall", "avg_minutes_per_call", "avgMinutes", "avg_minutes"]),
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
      return JSON.stringify({
        ok: true,
        navigatedTo: "pricing",
        calculatorPresent: Boolean(doc.getElementById("calc-minutes-input")),
      });
    });
  };

  win.fillBookingForm = (params = {}) => {
    const task = async (): Promise<string> => {
      const company = toText(firstValue(params, ["companyName", "company", "company_name"]));
      const person = toText(
        firstValue(params, ["contactPerson", "contactName", "name", "person", "contact_person", "contact_name"]),
      );
      const phone = toText(firstValue(params, ["contactPhone", "phone", "whatsapp", "contact_phone"]));
      const website = toText(firstValue(params, ["websiteUrl", "website", "url", "website_url"]));
      const sample = toOptionalFlag(
        firstValue(params, ["requestVoiceSample", "request_voice_sample", "voiceSample", "voice_sample"]),
      );
      const selectedPlan = toText(firstValue(params, ["selectedPlan", "selected_plan", "plan"]));
      const tokens = addonTokens(params);

      win.navigateToPage?.("home", { sectionId: "demo-booking-form" });
      showLeadForm(doc);
      await wait(90, win);

      const updatedFields: string[] = [];
      if (company && (await typeIntoInput(doc.getElementById("company-name"), company, win))) {
        updatedFields.push("companyName");
      }
      if (person && (await typeIntoInput(doc.getElementById("contact-person"), person, win))) {
        updatedFields.push("contactPerson");
      }
      if (phone && (await typeIntoInput(doc.getElementById("contact-phone"), phone, win))) {
        updatedFields.push("contactPhone");
      }
      if (website && (await typeIntoInput(doc.getElementById("website-url"), website, win))) {
        updatedFields.push("websiteUrl");
      }

      const { newlyChecked, checkedLabels } = applyAddons(doc, tokens);
      if (newlyChecked > 0) updatedFields.push("addons");

      const sampleBox = doc.getElementById("request-voice-sample") as HTMLInputElement | null;
      if (sampleBox && sample != null && sampleBox.checked !== sample) {
        sampleBox.checked = sample;
        pokeField(sampleBox);
        updatedFields.push("requestVoiceSample");
      }

      const currentState = {
        companyName: readInputValue(doc, "company-name"),
        contactPerson: readInputValue(doc, "contact-person"),
        contactPhone: readInputValue(doc, "contact-phone"),
        websiteUrl: readInputValue(doc, "website-url"),
        addons: checkedLabels,
        requestVoiceSample: Boolean(sampleBox?.checked),
      };

      const missingRequiredForSubmit: string[] = [];
      if (!currentState.companyName) missingRequiredForSubmit.push("companyName");
      if (!currentState.contactPerson) missingRequiredForSubmit.push("contactPerson");
      if (!currentState.contactPhone) missingRequiredForSubmit.push("contactPhone");
      if (!currentState.websiteUrl) missingRequiredForSubmit.push("websiteUrl");

      const ignoredFields: string[] = [];
      if (selectedPlan) ignoredFields.push("selectedPlan");

      return JSON.stringify({
        ok: true,
        status:
          missingRequiredForSubmit.length === 0
            ? "ready_for_user_submit"
            : updatedFields.length > 0
              ? "partial"
              : "no_fields_updated",
        updatedFields,
        currentState,
        missingFields: missingRequiredForSubmit,
        ...(ignoredFields.length > 0 ? { unsupportedFields: ignoredFields } : {}),
        submitted: false,
      });
    };

    const queued = fillQueue.then(task, task);
    fillQueue = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  };
}

const NAV_ALIASES: Record<string, { page: string; sectionId?: string }> = {
  home: { page: "home" },
  advantages: { page: "advantages" },
  features: { page: "advantages" },
  services: { page: "advantages" },
  pricing: { page: "pricing" },
  about: { page: "about" },
  booking: { page: "home", sectionId: "demo-booking-form" },
  demo: { page: "home", sectionId: "demo-booking-form" },
  contact: { page: "home", sectionId: "demo-booking-form" },
};

function resolveNavigateTarget(params: Record<string, unknown>): {
  page: string;
  options: Exclude<NavigateOptions, string>;
} {
  const rawPage = firstValue(params, ["page", "pageId", "page_id", "target", "route", "url"]);
  const cleaned = typeof rawPage === "string"
    ? rawPage.trim().replace(/^https?:\/\/[^/]+/i, "").replace(/^\/+|\/+$/g, "").replace(/^#/, "").toLowerCase()
    : "";
  const mapped = NAV_ALIASES[cleaned];
  const page = mapped?.page ?? (typeof rawPage === "string" && rawPage.trim() ? rawPage.trim() : "home");

  const options: Exclude<NavigateOptions, string> = {};
  const rawSection = firstValue(params, ["sectionId", "section_id", "section"]);
  if (typeof rawSection === "string" && rawSection.trim()) {
    options.sectionId = rawSection.trim().replace(/^#/, "");
  } else if (mapped?.sectionId) {
    options.sectionId = mapped.sectionId;
  }

  const rawAddon = firstValue(params, ["selectedAddon", "selected_addon", "addon"]);
  if (typeof rawAddon === "string" && rawAddon.trim()) {
    options.selectedAddon = rawAddon.trim();
  }
  const sampleFlag = toOptionalFlag(
    firstValue(params, ["requestVoiceSample", "request_voice_sample"]),
  );
  if (sampleFlag === true) options.requestVoiceSample = true;

  return { page, options };
}

/**
 * Creates the ElevenLabs Client Tools map mirroring the official `elevenlabs-convai:call`
 * integration pattern while delegating execution to Orai's homepage handlers.
 */
export function buildHomepageClientTools(win: OraiWindow): Record<string, ClientToolFn> {
  return {
    navigate_website: (params = {}) => {
      const { page, options } = resolveNavigateTarget(params);
      win.navigateToPage?.(page, Object.keys(options).length ? options : undefined);
      return `Navigated to ${page}`;
    },
    calculate_plan_cost: (params = {}) => {
      if (typeof win.calculatePlanCost === "function") {
        return win.calculatePlanCost(params);
      }
      return JSON.stringify({ ok: false, reason: "handler_unavailable" });
    },
    fill_booking_form: (params = {}) => {
      if (typeof win.fillBookingForm === "function") {
        return win.fillBookingForm(params);
      }
      return JSON.stringify({ ok: false, reason: "handler_unavailable", submitted: false });
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
