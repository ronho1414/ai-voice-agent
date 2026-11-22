import type { gsap as GsapNamespace } from "gsap";

type Gsap = typeof GsapNamespace;

type MotionContext = {
  conditions?: {
    reduceMotion?: boolean;
  };
};

type Wrapped = ((...args: never[]) => unknown) & { __oraiWrapped?: boolean };

declare global {
  interface Window {
    handleLeadSubmit?: (event: Event) => void;
    handleVoiceDemoTrigger?: () => void;
    resetLeadForm?: () => void;
    activateFeatureAccordion?: (index: number) => void;
    selectIndustryShowcase?: (index: number) => void;
    toggleFaqItem?: (index: number) => void;
    lucide?: { createIcons: () => void };
  }
}

const PAGE_IDS = ["home", "advantages", "pricing", "about"] as const;
const REQUIRED_FIELDS = ["company-name", "contact-person", "contact-phone", "website-url"] as const;
const SUBMIT_LABEL = "預約免費 15 分鐘專屬 Demo";

type Timeline = ReturnType<Gsap["timeline"]>;
type Tween = ReturnType<Gsap["to"]>;

let reduceMotion = false;
let observer: IntersectionObserver | null = null;
let leadTimeline: Timeline | null = null;
let spinTween: Tween | null = null;
let callTimer = 0;
let heroChatTimeline: Timeline | null = null;

function activePage(): HTMLElement | null {
  const page = document.querySelector(".page-view-active");
  return page instanceof HTMLElement ? page : null;
}

function indicatorX(gsap: Gsap, indicator: HTMLElement): number {
  const match = /translateX\(([-\d.]+)px\)/.exec(indicator.style.transform);
  if (match) return Number(match[1]);
  const value = gsap.getProperty(indicator, "x");
  return typeof value === "number" ? value : 0;
}

function markDemoButtons(): void {
  document.querySelectorAll("button").forEach((button) => {
    const text = (button.textContent ?? "").replace(/\s+/g, "");
    const isDemo =
      text.includes("預約免費Demo") ||
      text.includes("預約免費15分鐘專屬Demo") ||
      text.includes("預約15分鐘專屬Demo");
    if (!isDemo || button.dataset.demoRipple === "true") return;
    button.dataset.demoRipple = "true";
    button.classList.add("relative", "overflow-hidden");
  });
}

function paintPageSky(): void {
  PAGE_IDS.forEach((id) => {
    if (id === "home") return;
    const page = document.getElementById(`page-${id}`);
    const opening = page?.querySelector(":scope > section");
    if (!(opening instanceof HTMLElement) || opening.querySelector(".page-sky-wash")) return;
    opening.classList.add("page-open");
    const wash = document.createElement("div");
    wash.className = "page-sky-wash hero-sky";
    wash.setAttribute("aria-hidden", "true");
    opening.prepend(wash);
  });
}

function syncOrbs(gsap: Gsap): void {
  const orbs = document.querySelectorAll(".hero-orb");
  gsap.killTweensOf(orbs);
  if (reduceMotion) {
    gsap.set(orbs, { clearProps: "transform" });
    return;
  }
  gsap.to(orbs, {
    rotation: 360,
    duration: 10,
    repeat: -1,
    ease: "none",
    transformOrigin: "center center",
  });
}

function forceVisible(gsap: Gsap, nodes: Element[]): void {
  if (!nodes.length) return;
  gsap.set(nodes, { autoAlpha: 1, overwrite: "auto" });
}

function slideIn(gsap: Gsap, _timeline: Timeline, nodes: Element[], _position: number | string, _stagger = 0): void {
  if (!nodes.length) return;
  forceVisible(gsap, nodes);
}

function sectionCards(section: HTMLElement): HTMLElement[] {
  const accordion = [...section.querySelectorAll<HTMLElement>("#feature-accordion-group > *")];
  const steps = [...section.querySelectorAll<HTMLElement>("ol > li")];
  const cards = [...section.querySelectorAll<HTMLElement>(".grid > *")].filter((node) =>
    /rounded-|border|shadow-stripe/.test(node.className),
  );
  return [...new Set([...accordion, ...steps, ...cards])].slice(0, 12);
}

function heroSteps(card: Element): HTMLElement[] {
  return [...card.querySelectorAll<HTMLElement>("[data-hero-step]")];
}

function finishHeroChat(gsap: Gsap): void {
  heroChatTimeline?.kill();
  heroChatTimeline = null;
  document.querySelectorAll(".hero-chat-card").forEach((card) => {
    card.classList.add("hero-chat-ready");
    const steps = heroSteps(card);
    if (steps.length) gsap.set(steps, { autoAlpha: 1, y: 0, scale: 1, overwrite: "auto" });
  });
}

function playHeroChat(gsap: Gsap, card: Element): void {
  const steps = heroSteps(card);
  heroChatTimeline?.kill();
  heroChatTimeline = null;
  if (!steps.length || reduceMotion) {
    finishHeroChat(gsap);
    return;
  }
  gsap.set(steps, { autoAlpha: 0, y: 14, scale: 0.98 });
  card.classList.add("hero-chat-ready");
  const timeline = gsap.timeline();
  heroChatTimeline = timeline;
  steps.forEach((step, index) => {
    timeline.to(
      step,
      { autoAlpha: 1, y: 0, scale: 1, duration: 0.35, ease: "power2.out" },
      index === 0 ? 0.2 : "+=0.35",
    );
  });
}

function revealHero(gsap: Gsap, section: HTMLElement): void {
  const card = section.querySelector(".hero-chat-card");
  const title = section.querySelector("h1");
  const eyebrow = title?.previousElementSibling ?? null;
  const lede = title?.nextElementSibling ?? null;
  const ctas = [...section.querySelectorAll(".mt-8 > button")];
  const stats = [...section.querySelectorAll(".grid-cols-3 > div")];
  const nodes = [card, eyebrow, title, lede, ...ctas, ...stats].filter(
    (node): node is Element => node instanceof Element,
  );
  forceVisible(gsap, nodes);
  if (card) playHeroChat(gsap, card);
}

function revealSection(gsap: Gsap, section: HTMLElement): void {
  if (section.dataset.motionPlayed === "1") return;
  section.dataset.motionPlayed = "1";
  if (section.id === "hero") {
    revealHero(gsap, section);
    return;
  }

  const title = section.querySelector("h1, h2");
  const items = sectionCards(section);
  forceVisible(gsap, [...(title ? [title] : []), ...items]);
}

function sectionInView(section: HTMLElement): boolean {
  const rect = section.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight * 0.92 && rect.bottom > 0;
}

function revealInView(gsap: Gsap, page: HTMLElement | null): void {
  if (!page) return;
  page.querySelectorAll("section").forEach((section) => {
    if (section instanceof HTMLElement && sectionInView(section)) revealSection(gsap, section);
  });
}

function replayPage(gsap: Gsap, page: HTMLElement | null): void {
  if (!page) return;
  finishHeroChat(gsap);
  page.querySelectorAll("section").forEach((section) => {
    if (section instanceof HTMLElement) section.dataset.motionPlayed = "1";
  });
}

function ensureObserver(gsap: Gsap): void {
  if (observer) return;
  observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const section = entry.target;
        if (!(section instanceof HTMLElement)) return;
        if (section.closest(".page-view-hidden")) return;
        revealSection(gsap, section);
      });
    },
    { threshold: 0.16, rootMargin: "0px 0px -6% 0px" },
  );
}

function watchSections(): void {
  if (!observer) return;
  document.querySelectorAll("#page-home section, #page-advantages section, #page-pricing section, #page-about section").forEach((section) => {
    observer?.observe(section);
  });
}

function spawnRipple(gsap: Gsap, button: HTMLElement, event: MouseEvent): void {
  if (reduceMotion) return;
  const rect = button.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const ripple = document.createElement("span");
  ripple.className = "gsap-ripple";
  ripple.setAttribute("aria-hidden", "true");
  const x = (event.clientX || rect.left + rect.width / 2) - rect.left - size / 2;
  const y = (event.clientY || rect.top + rect.height / 2) - rect.top - size / 2;
  ripple.style.width = `${size}px`;
  ripple.style.height = `${size}px`;
  ripple.style.left = `${x}px`;
  ripple.style.top = `${y}px`;
  button.insertBefore(ripple, button.firstChild);
  gsap.fromTo(
    ripple,
    { scale: 0, autoAlpha: 0.5 },
    {
      scale: 2.8,
      autoAlpha: 0,
      duration: 0.6,
      ease: "power2.out",
      transformOrigin: "center center",
      onComplete: () => ripple.remove(),
    },
  );
}

function shakeInvalid(gsap: Gsap, fields: HTMLInputElement[]): void {
  fields.forEach((invalidEl) => {
    invalidEl.classList.add("border-rose-500");
    invalidEl.setAttribute("aria-invalid", "true");
    if (reduceMotion) return;
    gsap.fromTo(
      invalidEl,
      { x: -8 },
      { x: 8, duration: 0.07, repeat: 5, yoyo: true, ease: "power1.inOut", clearProps: "x" },
    );
  });
  const first = fields[0];
  if (!first) return;
  first.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
  first.focus({ preventScroll: true });
}

function restoreSubmitButton(): void {
  const button = document.getElementById("lead-submit-btn");
  const label = button?.querySelector(".lead-submit-label");
  if (label) label.textContent = SUBMIT_LABEL;
  if (button instanceof HTMLButtonElement) {
    button.disabled = false;
    delete button.dataset.busy;
  }
  markDemoButtons();
}

function setLoading(gsap: Gsap, label: HTMLElement): void {
  spinTween?.kill();
  label.innerHTML =
    '<span class="inline-flex items-center justify-center gap-2"><svg class="lead-spinner h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="18 34"></circle></svg>正在傳送預約資料...</span>';
  const spinner = label.querySelector(".lead-spinner");
  if (!spinner || reduceMotion) return;
  spinTween = gsap.to(spinner, {
    rotation: 360,
    repeat: -1,
    ease: "none",
    duration: 0.8,
    transformOrigin: "center center",
  });
}

function setCheck(gsap: Gsap, label: HTMLElement): void {
  spinTween?.kill();
  spinTween = null;
  label.innerHTML = '<span class="lead-check-mark">✓</span> 已成功提交預約！';
  if (reduceMotion) return;
  gsap.fromTo(
    label,
    { scale: 0.72, autoAlpha: 0 },
    { scale: 1, autoAlpha: 1, duration: 0.4, ease: "back.out(1.7)", transformOrigin: "center center" },
  );
}

function revealSuccess(gsap: Gsap, detail: string): void {
  const form = document.getElementById("lead-form");
  const success = document.getElementById("lead-form-success");
  const detailNode = document.getElementById("lead-success-detail");
  if (detailNode) detailNode.textContent = detail;
  if (success) success.classList.remove("hidden");
  window.lucide?.createIcons();
  if (reduceMotion) {
    form?.classList.add("hidden");
    return;
  }
  const timeline = gsap.timeline({ defaults: { ease: "power2.out" } });
  if (form) {
    timeline.to(form, {
      autoAlpha: 0,
      y: -8,
      duration: 0.3,
      onComplete: () => form.classList.add("hidden"),
    });
  }
  if (success) {
    timeline.fromTo(
      success,
      { autoAlpha: 0, y: 16, scale: 0.98 },
      { autoAlpha: 1, y: 0, scale: 1, duration: 0.5, clearProps: "transform" },
      form ? "-=0.05" : 0,
    );
  }
}

function submitLead(gsap: Gsap, event: Event): void {
  event.preventDefault();
  const fields = REQUIRED_FIELDS.map((id) => document.getElementById(id)).filter(
    (field): field is HTMLInputElement => field instanceof HTMLInputElement,
  );
  const empty = fields.filter((field) => field.value.trim() === "");
  if (empty.length || fields.length !== REQUIRED_FIELDS.length) {
    shakeInvalid(gsap, empty);
    return;
  }

  const button = document.getElementById("lead-submit-btn");
  if (!(button instanceof HTMLButtonElement) || button.dataset.busy === "1") return;
  const label = button.querySelector(".lead-submit-label");
  if (!(label instanceof HTMLElement)) return;

  button.dataset.busy = "1";
  button.disabled = true;
  fields.forEach((field) => {
    field.classList.remove("border-rose-500");
    field.removeAttribute("aria-invalid");
  });

  const company = fields[0].value.trim();
  const person = fields[1].value.trim();
  const phone = fields[2].value.trim();
  const url = fields[3].value.trim();
  const features = [...document.querySelectorAll<HTMLInputElement>('input[name="interest-feature"]:checked')].map(
    (input) => input.value,
  );
  const sample = document.getElementById("request-voice-sample");
  const wantsSample = sample instanceof HTMLInputElement && sample.checked;
  const featureText = features.length ? features.join("、") : "未勾選擴充模組";
  const sampleText = wantsSample ? "，並索取免費語音試聽 Demo（無需開會）" : "";
  const detail =
    `感謝 ${person}（${company}）！我哋已經收到你為「${url}」提交嘅評估申請（核心基礎部署方案（HK$8,000 起 ＋ 按通話流量）；加購：${featureText}）${sampleText}。香港顧問團隊將於 2 小時內透過 WhatsApp / 電話（${phone}）與你聯絡。具體專案設定費 HK$8,000 起及所選擴充模組報價，將於免費評估會議確認。`;

  leadTimeline?.kill();
  setLoading(gsap, label);
  leadTimeline = gsap.timeline();
  leadTimeline.call(() => setCheck(gsap, label), [], 1.1);
  leadTimeline.call(() => revealSuccess(gsap, detail), [], reduceMotion ? "+=0.8" : "+=1.2");
}

function wrapNavigate(gsap: Gsap): void {
  const original = window.navigateToPage as Wrapped | undefined;
  if (!original || original.__oraiWrapped) return;
  const wrapped: Wrapped = function (this: unknown, ...args: never[]) {
    const result = original.apply(this, args);
    const nextId = typeof result === "string" ? result : "home";
    const nextPage = document.getElementById(`page-${nextId}`);

    // Instant, crisp page transition without any fade, slide-up, translate-y or opacity delays
    heroChatTimeline?.kill();
    heroChatTimeline = null;
    finishHeroChat(gsap);

    document.querySelectorAll("section").forEach((section) => {
      if (section instanceof HTMLElement) {
        section.dataset.motionPlayed = "1";
      }
    });

    if (nextPage) {
      const animatedNodes = nextPage.querySelectorAll("*");
      gsap.set(animatedNodes, { clearProps: "transform,opacity,visibility", overwrite: "auto" });

      if (nextId === "home") {
        const heroCard = nextPage.querySelector(".hero-chat-card");
        if (heroCard) playHeroChat(gsap, heroCard);
      }
    }

    return result;
  };
  wrapped.__oraiWrapped = true;
  window.navigateToPage = wrapped as Window["navigateToPage"];
}

function wrapNamed<T extends (...args: never[]) => unknown>(
  read: () => T | undefined,
  write: (fn: T) => void,
  after: (args: never[]) => void,
): void {
  const original = read() as Wrapped | undefined;
  if (!original || original.__oraiWrapped) return;
  const wrapped: Wrapped = function (this: unknown, ...args: never[]) {
    const result = original.apply(this, args);
    after(args);
    return result;
  };
  wrapped.__oraiWrapped = true;
  write(wrapped as T);
}

function wrapInteractions(gsap: Gsap): void {
  wrapVoiceTrigger();
  wrapNavigate(gsap);
  wrapNamed(
    () => window.activateFeatureAccordion,
    (fn) => {
      window.activateFeatureAccordion = fn;
    },
    (args) => {
      if (reduceMotion) return;
      const desc = document.getElementById(`feat-desc-${String(args[0])}`);
      if (!desc) return;
      gsap.fromTo(desc, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.35, ease: "power2.out", overwrite: "auto" });
    },
  );
  wrapNamed(
    () => window.selectIndustryShowcase,
    (fn) => {
      window.selectIndustryShowcase = fn;
    },
    (args) => {
      if (reduceMotion) return;
      const image = document.getElementById("industry-banner-img");
      const title = document.getElementById("industry-banner-title");
      const card = document.getElementById(`ind-card-${String(args[0])}`);
      if (image) {
        gsap.fromTo(image, { scale: 1.05, autoAlpha: 0.55 }, { scale: 1, autoAlpha: 1, duration: 0.5, ease: "power2.out", overwrite: "auto" });
      }
      if (title) {
        gsap.fromTo(title, { y: 10, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.4, ease: "power2.out", overwrite: "auto" });
      }
      if (card) {
        gsap.fromTo(card, { y: 4 }, { y: 0, duration: 0.3, ease: "power2.out", overwrite: "auto", clearProps: "transform" });
      }
    },
  );
  wrapNamed(
    () => window.toggleFaqItem,
    (fn) => {
      window.toggleFaqItem = fn;
    },
    (args) => {
      if (reduceMotion) return;
      const body = document.getElementById(`faq-body-${String(args[0])}`);
      if (!body || body.classList.contains("hidden")) return;
      gsap.fromTo(body, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.35, ease: "power2.out", overwrite: "auto" });
    },
  );
  wrapNamed(
    () => window.resetLeadForm,
    (fn) => {
      window.resetLeadForm = fn;
    },
    () => {
      leadTimeline?.kill();
      spinTween?.kill();
      spinTween = null;
      const form = document.getElementById("lead-form");
      const success = document.getElementById("lead-form-success");
      if (form) gsap.set(form, { clearProps: "all" });
      if (success) gsap.set(success, { clearProps: "all" });
      restoreSubmitButton();
      document.querySelectorAll("#lead-form input").forEach((input) => {
        input.classList.remove("border-rose-500");
        input.removeAttribute("aria-invalid");
      });
    },
  );
}

function clickStartCall(): boolean {
  const widget = document.querySelector("elevenlabs-convai");
  const button = widget?.shadowRoot?.querySelector('button[aria-label="Start a call"]');
  if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
  button.click();
  return true;
}

function startOraiCall(): void {
  window.clearTimeout(callTimer);
  const attempt = (tries: number) => {
    if (clickStartCall() || tries >= 24) return;
    callTimer = window.setTimeout(() => attempt(tries + 1), 150);
  };
  attempt(0);
}

function wrapVoiceTrigger(): void {
  const original = window.handleVoiceDemoTrigger as Wrapped | undefined;
  if (!original || original.__oraiWrapped) return;
  const wrapped: Wrapped = function (this: unknown, ...args: never[]) {
    const result = original.apply(this, args);
    startOraiCall();
    return result;
  };
  wrapped.__oraiWrapped = true;
  window.handleVoiceDemoTrigger = wrapped as Window["handleVoiceDemoTrigger"];
}

function bindDom(gsap: Gsap): void {
  reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  markDemoButtons();
  paintPageSky();
  ensureObserver(gsap);
  watchSections();
  syncOrbs(gsap);
  const header = document.querySelector("header");
  if (header instanceof HTMLElement && header.dataset.motionPlayed !== "1") {
    header.dataset.motionPlayed = "1";
    forceVisible(gsap, [header]);
  }
  const heroCard = document.querySelector(".hero-chat-card");
  if (heroCard) playHeroChat(gsap, heroCard);
  else finishHeroChat(gsap);
  revealInView(gsap, activePage());
}

function bindDocument(gsap: Gsap): void {
  if (document.documentElement.dataset.oraiMotion === "1") return;
  document.documentElement.dataset.oraiMotion = "1";

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest("button");
    if (!(button instanceof HTMLElement) || button.dataset.demoRipple !== "true") return;
    spawnRipple(gsap, button, event);
  });

  document.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.closest("#lead-form")) return;
    target.classList.remove("border-rose-500");
    target.removeAttribute("aria-invalid");
  });

  const media = gsap.matchMedia();
  media.add(
    {
      reduceMotion: "(prefers-reduced-motion: reduce)",
      allowMotion: "(prefers-reduced-motion: no-preference)",
    },
    (context) => {
      reduceMotion = Boolean((context as MotionContext).conditions?.reduceMotion);
      syncOrbs(gsap);
      if (reduceMotion) finishHeroChat(gsap);
      return () => {
        gsap.killTweensOf(".hero-orb");
      };
    },
  );
}

export function bootSiteMotion(gsap: Gsap): void {
  window.handleLeadSubmit = (event) => submitLead(gsap, event);
  wrapInteractions(gsap);
  bindDocument(gsap);
  bindDom(gsap);
  if (typeof window.navigateToPage !== "function" || typeof window.handleVoiceDemoTrigger !== "function") {
    window.setTimeout(() => {
      wrapVoiceTrigger();
      wrapNavigate(gsap);
    }, 50);
  }
}
