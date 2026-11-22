(function () {
  var WIDGET_SRC = "https://unpkg.com/@elevenlabs/convai-widget-embed";
  var VALID_PAGES = ["home", "advantages", "pricing", "about"];
  var ADDON_LABELS = {
    nav: "網頁自動跳轉導航",
    form: "語音代填表單 / 互動計算機與篩選器操控",
    voice: "專屬品牌真人聲線克隆",
    whatsapp: "WhatsApp 客資即時推送 / API 接管",
    outbound: "AI 主動外呼跟進（Outbound Call）",
    crm: "CRM / 預約系統雙向 API 串接"
  };
  var current = document.currentScript;

  if (window.__oraiWidgetLoaded) return;
  window.__oraiWidgetLoaded = true;

  function ownScript() {
    if (current && current.getAttribute && current.getAttribute("data-agent-id")) return current;
    var nodes = document.querySelectorAll("script[data-agent-id]");
    for (var i = nodes.length - 1; i >= 0; i--) {
      var src = nodes[i].getAttribute("src") || "";
      if (src.indexOf("orai-widget.js") !== -1) return nodes[i];
    }
    return current;
  }

  function agentId() {
    var script = ownScript();
    var id = script && script.getAttribute ? script.getAttribute("data-agent-id") : "";
    return id ? String(id).trim() : "";
  }

  function activePageId() {
    var active = document.querySelector(".page-view-active");
    var id = active && active.id ? active.id.replace(/^page-/, "") : "";
    return VALID_PAGES.indexOf(id) !== -1 ? id : "home";
  }

  function updateNavbar(activePage) {
    VALID_PAGES.forEach(function (id) {
      var desktopBtn = document.getElementById("nav-tab-" + id);
      var mobileBtn = document.getElementById("mobile-tab-" + id);
      if (desktopBtn) {
        if (id === activePage) {
          desktopBtn.classList.add("text-[#635BFF]", "font-bold");
          desktopBtn.classList.remove("text-[#425466]", "font-semibold");
        } else {
          desktopBtn.classList.remove("text-[#635BFF]", "font-bold");
          desktopBtn.classList.add("text-[#425466]", "font-semibold");
        }
      }
      if (mobileBtn) {
        if (id === activePage) {
          mobileBtn.classList.add("bg-white", "text-[#635BFF]", "font-bold", "shadow-stripe-sm");
          mobileBtn.classList.remove("text-[#425466]", "font-semibold");
        } else {
          mobileBtn.classList.remove("bg-white", "text-[#635BFF]", "font-bold", "shadow-stripe-sm");
          mobileBtn.classList.add("text-[#425466]", "font-semibold");
        }
      }
    });
    var activeTabEl = document.getElementById("nav-tab-" + activePage);
    var indicatorEl = document.getElementById("nav-active-indicator");
    if (activeTabEl && indicatorEl) {
      indicatorEl.style.width = activeTabEl.offsetWidth + "px";
      indicatorEl.style.transform = "translateX(" + activeTabEl.offsetLeft + "px)";
    }
  }

  function refreshReveals() {
    if (typeof window.IntersectionObserver === "function") {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      }, { threshold: 0.1 });
      document.querySelectorAll(".reveal-on-scroll").forEach(function (el) {
        observer.observe(el);
      });
    }
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  }

  function readOptions(options) {
    var targetSectionId = null;
    var selectedAddon = null;
    var requestVoiceSample = false;
    if (typeof options === "string") {
      targetSectionId = options;
    } else if (options && typeof options === "object") {
      targetSectionId = options.sectionId || options.section || null;
      selectedAddon = options.selectedAddon || null;
      requestVoiceSample = options.requestVoiceSample === true;
    }
    return {
      targetSectionId: targetSectionId,
      selectedAddon: selectedAddon,
      requestVoiceSample: requestVoiceSample
    };
  }

  window.navigateToPage = function (pageId, options) {
    var parsed = readOptions(options);
    var targetPage = VALID_PAGES.indexOf(pageId) !== -1 ? pageId : "home";
    if (parsed.targetSectionId === "demo-booking-form" || parsed.targetSectionId === "contact-form") {
      targetPage = "home";
    }

    VALID_PAGES.forEach(function (id) {
      var el = document.getElementById("page-" + id);
      if (!el) return;
      if (id === targetPage) {
        el.classList.remove("page-view-hidden");
        el.classList.add("page-view-active");
      } else {
        el.classList.add("page-view-hidden");
        el.classList.remove("page-view-active");
      }
    });

    updateNavbar(targetPage);

    if (parsed.selectedAddon && ADDON_LABELS[parsed.selectedAddon]) {
      document.querySelectorAll('input[name="interest-feature"]').forEach(function (box) {
        if (box.value === ADDON_LABELS[parsed.selectedAddon]) box.checked = true;
      });
      var bannerEl = document.getElementById("selected-addon-banner");
      var bannerTextEl = document.getElementById("selected-addon-banner-text");
      if (bannerEl && bannerTextEl) {
        bannerTextEl.textContent = "✓ 已為你勾選：" + ADDON_LABELS[parsed.selectedAddon];
        bannerEl.classList.remove("hidden");
        bannerEl.classList.add("flex");
      }
    }

    var sampleBox = document.getElementById("request-voice-sample");
    if (sampleBox && parsed.requestVoiceSample) sampleBox.checked = true;

    if (window.location.hash !== "#" + targetPage && !parsed.targetSectionId) {
      history.replaceState(null, "", "#" + targetPage);
    }

    window.setTimeout(function () {
      if (parsed.targetSectionId) {
        var targetEl = document.getElementById(parsed.targetSectionId);
        if (targetEl && typeof targetEl.scrollIntoView === "function") {
          targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    }, 60);

    window.setTimeout(refreshReveals, 50);
    return targetPage;
  };

  window.addEventListener("resize", function () {
    updateNavbar(activePageId());
  });

  function flashField(el) {
    if (!el) return;
    el.classList.add("ring-2", "ring-[#635BFF]", "bg-white");
    window.setTimeout(function () {
      el.classList.remove("ring-2", "ring-[#635BFF]", "bg-white");
    }, 1400);
  }

  function pokeField(input) {
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function typeIntoInput(input, text) {
    return new Promise(function (resolve) {
      if (!input) {
        resolve();
        return;
      }
      var value = text == null ? "" : String(text);
      var reduced = false;
      try {
        reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      } catch (error) {
        reduced = false;
      }
      try {
        input.focus({ preventScroll: true });
      } catch (error) {
        try { input.focus(); } catch (focusError) { /* keep typing even if focus is blocked */ }
      }
      flashField(input);
      if (reduced) {
        input.value = value;
        pokeField(input);
        resolve();
        return;
      }
      var index = 0;
      input.value = "";
      var timer = window.setInterval(function () {
        index += 1;
        input.value = value.slice(0, index);
        if (index >= value.length) {
          window.clearInterval(timer);
          pokeField(input);
          resolve();
        }
      }, 18);
    });
  }

  function showCalcVoiceBar(message) {
    var bar = document.getElementById("calc-voice-status-bar");
    var barText = document.getElementById("calc-voice-status-text");
    if (!bar || !barText) return;
    barText.textContent = message;
    bar.classList.remove("hidden");
    bar.classList.add("flex");
  }

  function numberOrNull(value) {
    if (value == null || value === "") return null;
    var number = Number(value);
    return isFinite(number) ? number : null;
  }

  function textValue(value) {
    if (typeof value === "number" && isFinite(value)) return String(Math.round(value));
    return value == null ? "" : String(value);
  }

  window.calculatePlanCost = function (params) {
    var input = params || {};
    var minutes = numberOrNull(input.minutes != null ? input.minutes : input.monthlyMinutes);
    var avg = numberOrNull(
      input.avgMinutesPerCall != null ? input.avgMinutesPerCall : input.avgMinutes
    );
    window.navigateToPage("pricing", { sectionId: "plan-cost-calculator" });
    showCalcVoiceBar("Orai service 正在為你自動填入通話分鐘並即時試算...");
    return wait(90).then(function () {
      var chain = Promise.resolve();
      if (minutes != null) {
        chain = chain.then(function () {
          return typeIntoInput(document.getElementById("calc-minutes-input"), textValue(minutes));
        });
      }
      if (avg != null) {
        chain = chain.then(function () {
          return typeIntoInput(document.getElementById("calc-avg-mins-input"), textValue(avg));
        });
      }
      return chain.then(function () {
        showCalcVoiceBar("已完成用量試算。具體專案報價歡迎預約免費評估。");
        return "Calculator updated";
      });
    });
  };

  function firstValue(source, keys) {
    for (var i = 0; i < keys.length; i++) {
      var value = source[keys[i]];
      if (value != null && value !== "") return value;
    }
    return "";
  }

  function flag(value) {
    if (value === true || value === "true" || value === 1 || value === "1") return true;
    if (value === false || value === "false" || value === 0 || value === "0") return false;
    return null;
  }

  function addonTokens(source) {
    var raw = firstValue(source, ["addons", "features", "selectedAddons", "selectedAddon", "addon"]);
    if (!raw) return [];
    var list = Array.isArray(raw) ? raw : String(raw).split(/[,、|/]/);
    return list.map(function (item) { return String(item).trim(); }).filter(Boolean);
  }

  function addonMatches(box, token) {
    var key = token.toLowerCase();
    var label = ADDON_LABELS[key];
    var value = box.value || "";
    var id = box.id || "";
    return (label && value === label) || id === "addon-" + key || value === token || value.indexOf(token) !== -1;
  }

  function applyAddons(tokens) {
    if (!tokens.length) return;
    var boxes = document.querySelectorAll('#demo-booking-form input[name="interest-feature"], #lead-form input[name="interest-feature"]');
    if (!boxes.length) boxes = document.querySelectorAll('input[name="interest-feature"]');
    var labels = [];
    tokens.forEach(function (token) {
      boxes.forEach(function (box) {
        if (!addonMatches(box, token) || box.checked) return;
        box.checked = true;
        pokeField(box);
      });
      var label = ADDON_LABELS[token.toLowerCase()] || token;
      if (labels.indexOf(label) === -1) labels.push(label);
    });
    var bannerEl = document.getElementById("selected-addon-banner");
    var bannerTextEl = document.getElementById("selected-addon-banner-text");
    if (bannerEl && bannerTextEl && labels.length) {
      bannerTextEl.textContent = "✓ 已為你勾選：" + labels.join("、");
      bannerEl.classList.remove("hidden");
      bannerEl.classList.add("flex");
    }
  }

  function showLeadForm() {
    var form = document.getElementById("lead-form");
    var success = document.getElementById("lead-form-success");
    if (form) form.classList.remove("hidden");
    if (success) success.classList.add("hidden");
  }

  window.fillBookingForm = function (params) {
    var input = params || {};
    var company = textValue(firstValue(input, ["companyName", "company", "company_name"]));
    var person = textValue(firstValue(input, ["contactPerson", "contactName", "name", "person", "contact_person"]));
    var phone = textValue(firstValue(input, ["phone", "contactPhone", "whatsapp", "contact_phone"]));
    var website = textValue(firstValue(input, ["website", "websiteUrl", "url", "website_url"]));
    var sample = flag(input.requestVoiceSample != null ? input.requestVoiceSample : input.voiceSample);
    var tokens = addonTokens(input);
    window.navigateToPage("home", { sectionId: "demo-booking-form" });
    showLeadForm();
    return wait(90).then(function () {
      var chain = Promise.resolve();
      if (company) chain = chain.then(function () { return typeIntoInput(document.getElementById("company-name"), company); });
      if (person) chain = chain.then(function () { return typeIntoInput(document.getElementById("contact-person"), person); });
      if (phone) chain = chain.then(function () { return typeIntoInput(document.getElementById("contact-phone"), phone); });
      if (website) chain = chain.then(function () { return typeIntoInput(document.getElementById("website-url"), website); });
      return chain.then(function () {
        applyAddons(tokens);
        var sampleBox = document.getElementById("request-voice-sample");
        if (sampleBox && sample != null) {
          sampleBox.checked = sample;
          pokeField(sampleBox);
        }
        return "Booking form filled";
      });
    });
  };

  function wait(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms);
    });
  }

  document.addEventListener("elevenlabs-convai:call", function (event) {
    var config = event && event.detail && event.detail.config;
    if (!config) return;
    var tools = config.clientTools && typeof config.clientTools === "object" ? config.clientTools : {};
    tools.navigate_website = function (params) {
      var page = params && (params.page || params.pageId);
      var sectionId = params && (params.sectionId || params.section);
      var options = {};
      if (sectionId) options.sectionId = sectionId;
      if (params && params.selectedAddon) options.selectedAddon = params.selectedAddon;
      if (params && params.requestVoiceSample) options.requestVoiceSample = true;
      window.navigateToPage(page, Object.keys(options).length ? options : undefined);
      return "Navigated to " + page;
    };
    tools.calculate_plan_cost = function (params) {
      return window.calculatePlanCost(params || {});
    };
    tools.fill_booking_form = function (params) {
      return window.fillBookingForm(params || {});
    };
    config.clientTools = tools;
  });

  function mount(id) {
    if (!id || document.querySelector("elevenlabs-convai")) return;
    function place() {
      if (document.querySelector("elevenlabs-convai")) return;
      var el = document.createElement("elevenlabs-convai");
      el.setAttribute("agent-id", id);
      document.body.appendChild(el);
    }
    var marker = 'script[data-orai-convai="1"]';
    var existing = document.querySelector(marker);
    if (existing && window.customElements && customElements.get("elevenlabs-convai")) {
      place();
      return;
    }
    if (existing) {
      existing.addEventListener("load", place);
      return;
    }
    // The published embed has no yue entry. This agent's language is yue, and the
    // widget then reads languageCode off undefined. Add that entry before it runs.
    fetch(WIDGET_SRC)
      .then(function (response) {
        if (!response.ok) throw new Error("widget");
        return response.text();
      })
      .then(function (code) {
        var needle = "var yy={en:";
        var patched = code.indexOf(needle) === -1
          ? code
          : code.replace(needle, "var yy={yue:{name:`Cantonese`,flagCode:`hk`,languageCode:`yue`},en:");
        var blob = new Blob([patched], { type: "text/javascript" });
        var script = document.createElement("script");
        script.src = URL.createObjectURL(blob);
        script.async = true;
        script.dataset.oraiConvai = "1";
        script.addEventListener("load", place);
        document.body.appendChild(script);
      })
      .catch(function () {
        var script = document.createElement("script");
        script.src = WIDGET_SRC;
        script.async = true;
        script.dataset.oraiConvai = "1";
        script.addEventListener("load", place);
        document.body.appendChild(script);
      });
  }

  mount(agentId());
})();
