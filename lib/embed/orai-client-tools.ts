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

export function validatePhoneInput(raw: string): {
  valid: boolean;
  normalized: string;
  error?: string;
} {
  const trimmed = raw.trim();
  if (!trimmed) return { valid: false, normalized: "", error: "電話號碼不能為空。" };
  if (trimmed.includes("@") || /[A-Za-z]/.test(trimmed)) {
    return { valid: false, normalized: "", error: "請提供有效的聯絡電話或 WhatsApp 號碼（純數字，不可為文字或電郵）。" };
  }
  if (!/^\+?[\d\s()-]{6,32}$/.test(trimmed)) {
    return { valid: false, normalized: "", error: "電話號碼包含無效字元。" };
  }
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) {
    return { valid: false, normalized: "", error: "電話號碼需為 8 至 15 位有效數字。" };
  }
  if (!hasPlus && digits.length === 8 && !/^[2-9]/.test(digits)) {
    return { valid: false, normalized: "", error: "香港本地 8 位電話號碼需以 2 至 9 開頭。" };
  }
  return { valid: true, normalized: hasPlus ? `+${digits}` : digits };
}

export function validateWebsiteUrlInput(raw: string): {
  valid: boolean;
  normalized: string;
  error?: string;
} {
  const trimmed = raw.trim();
  if (!trimmed) return { valid: false, normalized: "", error: "網站網址不能為空。" };
  if (/\s/.test(trimmed)) {
    return { valid: false, normalized: "", error: "網站網址不可包含空格。" };
  }
  if (/^mailto:/i.test(trimmed) || (!/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && trimmed.includes("@"))) {
    return { valid: false, normalized: "", error: "請提供公司網站網址，而非電郵地址。" };
  }
  if (/^(javascript|data|vbscript|file):/i.test(trimmed)) {
    return { valid: false, normalized: "", error: "不支援此網址協定，請使用 http:// 或 https:// 網址。" };
  }

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { valid: false, normalized: "", error: "網站網址格式不正確，例如 https://www.yourcompany.hk。" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { valid: false, normalized: "", error: "僅支援 http:// 或 https:// 網站網址。" };
  }
  const host = parsed.hostname;
  if (!host || !host.includes(".") || host.startsWith(".") || host.endsWith(".") || !/^[a-z0-9.-]+$/i.test(host)) {
    return { valid: false, normalized: "", error: "請輸入包含有效網域（Domain）的網站網址。" };
  }
  return {
    valid: true,
    normalized: /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : candidate,
  };
}

function getAddonCheckboxes(doc: Document): HTMLInputElement[] {
  const scoped = doc.querySelectorAll<HTMLInputElement>(
    '#demo-booking-form input[name="interest-feature"], #lead-form input[name="interest-feature"]',
  );
  if (scoped.length > 0) return Array.from(scoped);
  return Array.from(doc.querySelectorAll<HTMLInputElement>('input[name="interest-feature"]'));
}

function syncAddonBanner(doc: Document, boxes: HTMLInputElement[]): string[] {
  const checkedLabels = boxes
    .filter((box) => box.checked && box.value)
    .map((box) => box.value);
  const bannerEl = doc.getElementById("selected-addon-banner");
  const bannerTextEl = doc.getElementById("selected-addon-banner-text");
  if (bannerEl && bannerTextEl) {
    if (checkedLabels.length > 0) {
      bannerTextEl.textContent = `✓ 已為你勾選：${checkedLabels.join("、")}`;
      bannerEl.classList.remove("hidden");
      bannerEl.classList.add("flex");
    } else {
      bannerTextEl.textContent = "";
      bannerEl.classList.add("hidden");
      bannerEl.classList.remove("flex");
    }
  }
  return checkedLabels;
}

function applyAddons(
  doc: Document,
  tokens: string[],
): { matchedBoxes: number; newlyChecked: number; checkedLabels: string[] } {
  const boxes = getAddonCheckboxes(doc);
  if (!tokens.length) {
    return {
      matchedBoxes: 0,
      newlyChecked: 0,
      checkedLabels: syncAddonBanner(doc, boxes),
    };
  }
  let matchedBoxes = 0;
  let newlyChecked = 0;
  tokens.forEach((token) => {
    boxes.forEach((box) => {
      if (!addonMatches(box, token)) return;
      matchedBoxes += 1;
      if (box.checked) return;
      box.checked = true;
      newlyChecked += 1;
      pokeField(box);
    });
  });
  return { matchedBoxes, newlyChecked, checkedLabels: syncAddonBanner(doc, boxes) };
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
    const rawMinutes = firstValue(params, ["minutes", "monthlyMinutes", "monthly_minutes"]);
    const rawAvg = firstValue(params, [
      "avgMinutesPerCall",
      "avg_minutes_per_call",
      "avgMinutes",
      "avg_minutes",
    ]);
    const minutes = toNumberOrNull(rawMinutes);
    const avg = toNumberOrNull(rawAvg);

    const validationErrors: Record<string, string> = {};
    if (rawMinutes !== "" && (minutes == null || minutes <= 0)) {
      validationErrors.minutes = "每月通話分鐘數必須為大於 0 的數字。";
    }
    if (rawAvg !== "" && (avg == null || avg <= 0 || avg > 60)) {
      validationErrors.avgMinutesPerCall = "平均每通電話分鐘數必須介乎 1 至 60 分鐘。";
    }
    if (Object.keys(validationErrors).length > 0) {
      return Promise.resolve(
        JSON.stringify({
          ok: false,
          reason: "validation_error",
          validationErrors,
        }),
      );
    }

    if (typeof win.navigateToPage !== "function") {
      return Promise.resolve(
        JSON.stringify({
          ok: false,
          reason: "handler_unavailable",
          calculatorPresent: Boolean(doc.getElementById("calc-minutes-input")),
        }),
      );
    }

    const sectionTarget = doc.getElementById("plan-cost-calculator") ? "plan-cost-calculator" : "pricing";
    const navResult: unknown = (win.navigateToPage as (page: string, opts?: NavigateOptions) => unknown)(
      "pricing",
      { sectionId: sectionTarget },
    );
    if (navResult === false || navResult === null) {
      return Promise.resolve(
        JSON.stringify({
          ok: false,
          reason: "navigation_failed",
          navigatedTo: null,
          calculatorPresent: Boolean(doc.getElementById("calc-minutes-input")),
        }),
      );
    }

    showCalcVoiceBar(doc, "Orai service 正在為你自動填入通話分鐘並即時試算...");
    return wait(90, win).then(async () => {
      const minsInput = doc.getElementById("calc-minutes-input");
      const avgInput = doc.getElementById("calc-avg-mins-input");
      if (!minsInput) {
        return JSON.stringify({
          ok: false,
          reason: "calculator_missing",
          navigatedTo: "pricing",
          calculatorPresent: false,
        });
      }
      if (minutes != null) {
        await typeIntoInput(minsInput, toText(minutes), win);
      }
      if (avg != null && avgInput) {
        await typeIntoInput(avgInput, toText(avg), win);
      }
      showCalcVoiceBar(doc, "已完成用量試算。具體專案報價歡迎預約免費評估。");
      return JSON.stringify({
        ok: true,
        navigatedTo: "pricing",
        calculatorPresent: true,
      });
    });
  };

  win.fillBookingForm = (params = {}) => {
    const task = async (): Promise<string> => {
      const company = toText(firstValue(params, ["companyName", "company", "company_name"]));
      const person = toText(
        firstValue(params, ["contactPerson", "contactName", "name", "person", "contact_person", "contact_name"]),
      );
      const rawPhone = toText(firstValue(params, ["contactPhone", "phone", "whatsapp", "contact_phone"]));
      const rawWebsite = toText(firstValue(params, ["websiteUrl", "website", "url", "website_url"]));
      const sample = toOptionalFlag(
        firstValue(params, ["requestVoiceSample", "request_voice_sample", "voiceSample", "voice_sample"]),
      );
      const selectedPlan = toText(firstValue(params, ["selectedPlan", "selected_plan", "plan"]));
      const tokens = addonTokens(params);

      if (typeof win.navigateToPage === "function") {
        win.navigateToPage("home", { sectionId: "demo-booking-form" });
      }
      showLeadForm(doc);
      await wait(90, win);

      const companyEl = doc.getElementById("company-name");
      const personEl = doc.getElementById("contact-person");
      const phoneEl = doc.getElementById("contact-phone");
      const websiteEl = doc.getElementById("website-url");
      if (!companyEl && !personEl && !phoneEl && !websiteEl) {
        return JSON.stringify({
          ok: false,
          reason: "form_elements_missing",
          submitted: false,
        });
      }

      const validationErrors: Record<string, string> = {};
      let validPhone = "";
      if (rawPhone) {
        const phoneCheck = validatePhoneInput(rawPhone);
        if (phoneCheck.valid) {
          validPhone = phoneCheck.normalized;
        } else if (phoneCheck.error) {
          validationErrors.contactPhone = phoneCheck.error;
        }
      }

      let validWebsite = "";
      if (rawWebsite) {
        const siteCheck = validateWebsiteUrlInput(rawWebsite);
        if (siteCheck.valid) {
          validWebsite = siteCheck.normalized;
        } else if (siteCheck.error) {
          validationErrors.websiteUrl = siteCheck.error;
        }
      }

      const updatedFields: string[] = [];
      if (company && (await typeIntoInput(companyEl, company, win))) {
        updatedFields.push("companyName");
      }
      if (person && (await typeIntoInput(personEl, person, win))) {
        updatedFields.push("contactPerson");
      }
      if (validPhone && (await typeIntoInput(phoneEl, validPhone, win))) {
        updatedFields.push("contactPhone");
      }
      if (validWebsite && (await typeIntoInput(websiteEl, validWebsite, win))) {
        updatedFields.push("websiteUrl");
      }

      const { matchedBoxes, newlyChecked, checkedLabels } = applyAddons(doc, tokens);
      if (newlyChecked > 0) updatedFields.push("addons");
      if (tokens.length > 0 && matchedBoxes === 0) {
        validationErrors.addons = "未能配對所指定的擴充模組名稱，原有勾選狀態維持不變。";
      }

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

      const hasValidationErrors = Object.keys(validationErrors).length > 0;
      const status = hasValidationErrors
        ? updatedFields.length > 0
          ? "partial_with_validation_errors"
          : "validation_error"
        : missingRequiredForSubmit.length === 0
          ? "ready_for_user_submit"
          : updatedFields.length > 0
            ? "partial"
            : "no_fields_updated";

      return JSON.stringify({
        ok: !hasValidationErrors,
        status,
        updatedFields,
        currentState,
        missingFields: missingRequiredForSubmit,
        ...(hasValidationErrors ? { validationErrors } : {}),
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
export function buildHomepageClientTools(
  win: OraiWindow,
  doc?: Pick<Document, "getElementById">,
): Record<string, ClientToolFn> {
  return {
    navigate_website: (params = {}) => {
      if (typeof win.navigateToPage !== "function") {
        return JSON.stringify({ ok: false, reason: "handler_unavailable" });
      }
      const { page, options } = resolveNavigateTarget(params);
      if (doc) {
        if (!doc.getElementById(`page-${page}`)) {
          return JSON.stringify({ ok: false, reason: "target_not_found", page });
        }
        if (options.sectionId && !doc.getElementById(options.sectionId)) {
          return JSON.stringify({
            ok: false,
            reason: "target_not_found",
            page,
            sectionId: options.sectionId,
          });
        }
      }
      const res: unknown = (win.navigateToPage as (page: string, opts?: NavigateOptions) => unknown)(
        page,
        Object.keys(options).length ? options : undefined,
      );
      if (
        res === false ||
        res === null ||
        (typeof res === "object" && res !== null && (res as { ok?: boolean }).ok === false)
      ) {
        return JSON.stringify({ ok: false, reason: "navigation_failed", page });
      }
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
