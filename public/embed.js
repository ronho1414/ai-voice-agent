(function () {
  var WIDGET_SRC = "https://unpkg.com/@elevenlabs/convai-widget-embed@0.28.1/dist/index.js";
  var current = document.currentScript;
  var client = "voicepilot-hq";
  var origin = "";
  try {
    var own = new URL(current && current.src ? current.src : "", window.location.href);
    origin = own.origin;
    var named = own.searchParams.get("client");
    if (named && named.trim()) client = named.trim();
  } catch {
    return;
  }
  if (!origin) return;

  document.addEventListener("elevenlabs-convai:call", function (event) {
    var config = event && event.detail && event.detail.config;
    if (!config) return;
    var tools = config.clientTools && typeof config.clientTools === "object" ? config.clientTools : {};
    tools.navigate_website = function (params) {
      var page = params && params.page;
      var sectionId = params && params.sectionId;
      if (typeof window.navigateToPage !== "function") {
        return JSON.stringify({ ok: false, reason: "handler_unavailable" });
      }
      var res = window.navigateToPage(page, sectionId ? { sectionId: sectionId } : undefined);
      if (res === false || res === null) {
        return JSON.stringify({ ok: false, reason: "navigation_failed" });
      }
      return "Navigated to " + (typeof res === "string" && res ? res : page || "home");
    };
    tools.calculate_plan_cost = function (params) {
      if (typeof window.calculatePlanCost !== "function") {
        return JSON.stringify({ ok: false, reason: "handler_unavailable" });
      }
      var res = window.calculatePlanCost(params || {});
      return res !== undefined ? res : JSON.stringify({ ok: true });
    };
    config.clientTools = tools;
  });

  fetch(origin + "/api/client-config?client=" + encodeURIComponent(client), { credentials: "omit" })
    .then(function (response) {
      return response.ok ? response.json() : null;
    })
    .then(function (body) {
      if (!body || typeof body.elevenlabsAgentId !== "string" || !body.elevenlabsAgentId) return;
      mount(body.elevenlabsAgentId);
    })
    .catch(function () {});

  function mount(agentId) {
    if (document.querySelector("elevenlabs-convai")) return;
    function place() {
      if (document.querySelector("elevenlabs-convai")) return;
      var el = document.createElement("elevenlabs-convai");
      el.setAttribute("agent-id", agentId);
      document.body.appendChild(el);
    }
    var existing = document.querySelector('script[src="' + WIDGET_SRC + '"]');
    if (existing && window.customElements && customElements.get("elevenlabs-convai")) {
      place();
      return;
    }
    if (existing) {
      existing.addEventListener("load", place);
      return;
    }
    var script = document.createElement("script");
    script.src = WIDGET_SRC;
    script.async = true;
    script.type = "text/javascript";
    script.addEventListener("load", place);
    document.body.appendChild(script);
  }
})();
