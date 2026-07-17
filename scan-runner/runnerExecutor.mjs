// src/runnerExecutor.ts
import { chromium } from "playwright";

// src/v2/utils/api-tracker.ts
async function waitForPendingAPI(page, timeout = 8e3) {
  try {
    await page.waitForFunction(
      () => {
        const pending = window.__aegisPendingAPI;
        return pending === void 0 || pending === 0;
      },
      { timeout }
    );
  } catch {
  }
}

// src/logger.ts
var LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};
var isProduction = process.env.NODE_ENV === "production";
var envLevel = process.env.LOG_LEVEL?.toLowerCase() || (isProduction ? "warn" : "debug");
var currentLevel = LOG_LEVELS[envLevel] ?? LOG_LEVELS.info;
function prefix(level) {
  return `[${(/* @__PURE__ */ new Date()).toISOString()}] [${level.toUpperCase()}]`;
}
var logger = {
  error: (...args) => {
    if (currentLevel >= LOG_LEVELS.error) {
      console.error(prefix("error"), ...args);
    }
  },
  warn: (...args) => {
    if (currentLevel >= LOG_LEVELS.warn) {
      console.warn(prefix("warn"), ...args);
    }
  },
  info: (...args) => {
    if (currentLevel >= LOG_LEVELS.info) {
      console.log(prefix("info"), ...args);
    }
  },
  debug: (...args) => {
    if (currentLevel >= LOG_LEVELS.debug) {
      console.log(prefix("debug"), ...args);
    }
  },
  // Alias for info
  log: (...args) => {
    if (currentLevel >= LOG_LEVELS.info) {
      console.log(prefix("info"), ...args);
    }
  }
};

// src/shared/wait-policy.ts
function isClosedRuntime(page) {
  try {
    return page.isClosed();
  } catch {
    return true;
  }
}
async function waitForDomStability(page, options) {
  let maxWaitMs = options?.maxWaitMs ?? 3e3;
  const idleMs = options?.idleMs ?? 600;
  const sampleIntervalMs = options?.sampleIntervalMs ?? 100;
  const ceilingMs = Math.max(15e3, (options?.maxWaitMs ?? 3e3) * 5);
  const start = Date.now();
  let previousSignature = "";
  let stableForMs = 0;
  let lastChangeAt = Date.now();
  let adaptedLogged = false;
  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 3;
  while (Date.now() - start < maxWaitMs) {
    try {
      const signature = await page.evaluate(() => {
        const body = document.body;
        if (!body) {
          return `ready:${document.readyState}:0:0`;
        }
        const interactiveCount = document.querySelectorAll(
          'a,button,input,select,textarea,[role="button"],[onclick],[tabindex]'
        ).length;
        const htmlLenBucket = Math.round(body.innerHTML.length / 256) * 256;
        return `${document.readyState}:${htmlLenBucket}:${interactiveCount}`;
      });
      consecutiveErrors = 0;
      if (signature === previousSignature) {
        stableForMs += sampleIntervalMs;
        if (stableForMs >= idleMs) {
          await page.waitForTimeout(sampleIntervalMs).catch(() => {
          });
          const confirmSignature = await page.evaluate(() => {
            const body = document.body;
            if (!body) return `ready:${document.readyState}:0:0`;
            const interactiveCount = document.querySelectorAll(
              'a,button,input,select,textarea,[role="button"],[onclick],[tabindex]'
            ).length;
            const htmlLenBucket = Math.round(body.innerHTML.length / 256) * 256;
            return `${document.readyState}:${htmlLenBucket}:${interactiveCount}`;
          }).catch(() => signature);
          if (confirmSignature === signature) {
            return;
          }
          stableForMs = 0;
          previousSignature = confirmSignature;
          lastChangeAt = Date.now();
          continue;
        }
      } else {
        stableForMs = 0;
        previousSignature = signature;
        lastChangeAt = Date.now();
      }
    } catch {
      consecutiveErrors++;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        return;
      }
    }
    if (isClosedRuntime(page)) {
      return;
    }
    if (Date.now() - start >= maxWaitMs - sampleIntervalMs && maxWaitMs < ceilingMs && Date.now() - lastChangeAt < idleMs) {
      maxWaitMs = Math.min(ceilingMs, maxWaitMs + 2e3);
      if (!adaptedLogged) {
        adaptedLogged = true;
        logger.warn(`[wait-policy] target rendering slowly \u2014 extending DOM-stability budget to ${maxWaitMs}ms (ceiling ${ceilingMs}ms)`);
      }
    }
    await page.waitForTimeout(sampleIntervalMs).catch(() => {
    });
  }
}
async function waitForPendingAPIQuiet(page, timeoutMs = 1500) {
  try {
    await waitForPendingAPI(page, timeoutMs);
  } catch {
  }
}
async function waitForImagesLoaded(page, options) {
  const maxWaitMs = options?.maxWaitMs ?? 5e3;
  const checkIntervalMs = options?.checkIntervalMs ?? 200;
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (isClosedRuntime(page)) {
      return;
    }
    const allDone = await page.evaluate(() => {
      const imgs = Array.from(document.images);
      const videos = Array.from(document.getElementsByTagName("video"));
      const imgsOk = imgs.length === 0 || imgs.every((img) => img.complete);
      const videosOk = videos.length === 0 || videos.every((video) => typeof video.readyState === "number" && video.readyState >= 2);
      return imgsOk && videosOk;
    }).catch(() => true);
    if (allDone) {
      return;
    }
    if (isClosedRuntime(page)) {
      return;
    }
    await page.waitForTimeout(checkIntervalMs).catch(() => {
    });
  }
}
async function waitForInteractionSettle(page, options) {
  const minDelayMs = options?.minDelayMs ?? 0;
  if (minDelayMs > 0) {
    if (isClosedRuntime(page)) {
      return;
    }
    await page.waitForTimeout(minDelayMs).catch(() => {
    });
  }
  const maxWaitMs = options?.maxWaitMs ?? 2200;
  const idleMs = options?.idleMs ?? 600;
  const apiTimeoutMs = options?.apiTimeoutMs ?? Math.min(2500, maxWaitMs);
  await Promise.allSettled([
    waitForPendingAPIQuiet(page, apiTimeoutMs),
    waitForDomStability(page, { maxWaitMs, idleMs })
  ]);
}
async function waitForPageReady(page, options) {
  await page.waitForLoadState("domcontentloaded").catch(() => {
  });
  if (options?.waitForLoadState !== false) {
    await page.waitForLoadState("load").catch(() => {
    });
  }
  await waitForInteractionSettle(page, options);
  await waitForImagesLoaded(page, { maxWaitMs: options?.imageTimeoutMs ?? 4e3 });
}

// src/rateLimitDetector.ts
var RateLimitedError = class extends Error {
  constructor(signal) {
    super(`RateLimited (${signal.severity}): ${signal.reason}`);
    this.name = "RateLimitedError";
    this.signal = signal;
  }
};

// src/pageStateAgent.ts
var EXPECTED_FIELDS_BY_TYPE = {
  login: 2,
  // email + password
  signup: 3,
  // email + password + (name or confirm)
  search: 1,
  contact: 3,
  address: 4,
  payment: 4,
  crud: 3,
  date_filter: 1,
  numeric_filter: 1,
  note: 1,
  boolean_setting: 1
};
var HEAVY_HYDRATION_FRAMEWORKS = /* @__PURE__ */ new Set([
  "react",
  "vue",
  "angular",
  "next",
  "nuxt",
  "inertia",
  "blazor"
]);
function isHeavyHydrationFramework(framework) {
  return !!framework && HEAVY_HYDRATION_FRAMEWORKS.has(framework);
}
async function detectFramework(page) {
  try {
    return await page.evaluate(() => {
      const w = window;
      if (w.Livewire || document.querySelector("[wire\\:id]") || document.querySelector("[wire\\:model]") || document.querySelector("[wire\\:click]") || document.querySelector('script[src*="livewire"]') || document.querySelector('meta[name="livewire-csrf"]')) return "livewire";
      if (w.__inertia || document.querySelector("[data-page]") || document.querySelector("#app[data-page]")) return "inertia";
      if (document.body?.className?.includes("filament") || document.querySelector(".filament-main-content")) return "livewire";
      if (w.__NUXT__) return "nuxt";
      if (w.__NEXT_DATA__) return "next";
      if (w.Blazor || document.querySelector('script[src*="blazor"]') || document.querySelector("[blazor-component]")) return "blazor";
      if (document.querySelector("[data-svelte-h]") || w.__sveltekit_dev) return "svelte";
      if (document.querySelector("[data-phx-main]") || document.querySelector("[phx-track-id]") || w.liveSocket) return "phoenix_liveview";
      if (document.querySelector("[hx-get],[hx-post],[hx-swap]") || w.htmx && w.htmx.version) return "htmx";
      if (w.Alpine) return "alpine";
      if (w.Vue || document.querySelector("[data-v-app],#app[data-server-rendered]")) return "vue";
      if (document.querySelector("[data-reactroot]") || Object.keys(document.querySelector("#__next, #root, [data-reactroot]") || {}).some((k) => k.startsWith("__reactFiber"))) return "react";
      return void 0;
    });
  } catch {
    return void 0;
  }
}
async function collectSignals(page) {
  const [domSignals, framework] = await Promise.all([
    page.evaluate(() => {
      const visible = (el) => {
        const r = el.getBoundingClientRect?.();
        if (!r || r.width === 0 || r.height === 0) return false;
        const cs = getComputedStyle(el);
        return cs.display !== "none" && cs.visibility !== "hidden" && cs.opacity !== "0";
      };
      const spinners = document.querySelectorAll('[role="progressbar"],[aria-busy="true"],.spinner,.loader,.loading-indicator,[class*="spinner"],[class*="loader"]');
      const skeletons = document.querySelectorAll('.skeleton,.shimmer,[class*="skeleton"],[class*="shimmer"],[class*="placeholder-glow"]');
      const captchas = document.querySelectorAll('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="challenges.cloudflare"],.g-recaptcha,.h-captcha');
      const errorBanner = !!document.querySelector('[role="alert"][class*="error"],.error-page,.error-banner,[class*="500"],[class*="error-500"]');
      const inputs = Array.from(document.querySelectorAll("input,textarea,select")).filter(visible);
      const inputCountByType = {};
      for (const i of inputs) {
        const t = (i.type || "text").toLowerCase();
        inputCountByType[t] = (inputCountByType[t] || 0) + 1;
      }
      return {
        visibleSpinners: Array.from(spinners).filter(visible).length,
        visibleSkeletons: Array.from(skeletons).filter(visible).length,
        visibleCaptcha: Array.from(captchas).filter(visible).length > 0,
        visibleErrorBanner: errorBanner,
        bodyTextLength: (document.body?.innerText || "").trim().length,
        inputCountByType
      };
    }).catch(() => ({
      visibleSpinners: 0,
      visibleSkeletons: 0,
      visibleCaptcha: false,
      visibleErrorBanner: false,
      bodyTextLength: 0,
      inputCountByType: {}
    })),
    detectFramework(page)
  ]);
  let mutations = 0;
  try {
    await page.evaluate(() => {
      ;
      window.__psa_mut_count = 0;
      const obs = new MutationObserver((muts) => {
        ;
        window.__psa_mut_count += muts.length;
      });
      obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
      window.__psa_obs = obs;
    });
    await page.waitForTimeout(500);
    mutations = await page.evaluate(() => {
      const obs = window.__psa_obs;
      if (obs) obs.disconnect();
      const n = window.__psa_mut_count || 0;
      delete window.__psa_obs;
      delete window.__psa_mut_count;
      return n;
    });
  } catch {
  }
  const visibleFieldsCount = Object.values(domSignals.inputCountByType).reduce((a, b) => a + b, 0);
  const domHash = String(domSignals.bodyTextLength) + ":" + visibleFieldsCount + ":" + (framework || "");
  return {
    framework,
    visibleFields: visibleFieldsCount,
    pendingRequests: 0,
    // populated by caller if CDP session available
    mutationsLast500ms: mutations,
    visibleSpinners: domSignals.visibleSpinners,
    visibleSkeletons: domSignals.visibleSkeletons,
    visibleCaptcha: domSignals.visibleCaptcha,
    visibleErrorBanner: domSignals.visibleErrorBanner,
    urlChanging: false,
    // populated by caller from CDP if available
    bodyTextLength: domSignals.bodyTextLength,
    domSnapshotHash: domHash,
    inputCountByType: domSignals.inputCountByType
  };
}
function classify(signals, opts) {
  const expected = opts.expectedFormType ? EXPECTED_FIELDS_BY_TYPE[opts.expectedFormType] : void 0;
  const hints = {
    framework: signals.framework,
    expectedFields: expected,
    visibleFields: signals.visibleFields,
    pendingRequests: signals.pendingRequests,
    mutationsPerSec: Math.round(signals.mutationsLast500ms * 2),
    visibleSpinners: signals.visibleSpinners,
    visibleSkeletons: signals.visibleSkeletons,
    visibleCaptcha: signals.visibleCaptcha,
    visibleErrorBanner: signals.visibleErrorBanner,
    domSnapshotHash: signals.domSnapshotHash
  };
  if (signals.visibleCaptcha) {
    return { state: "captcha", waitMs: 0, reasoning: "captcha iframe visible", hints };
  }
  if (signals.visibleErrorBanner && signals.bodyTextLength < 200) {
    return { state: "error_state", waitMs: 0, reasoning: "error banner visible, page body sparse", hints };
  }
  if (signals.bodyTextLength < 50 && signals.visibleFields === 0 && signals.visibleSpinners > 0) {
    return { state: "splash", waitMs: 1e3, reasoning: "sparse body + spinner", hints };
  }
  if (signals.visibleSkeletons > 0) {
    return { state: "loading_skeleton", waitMs: 800, reasoning: `${signals.visibleSkeletons} skeleton elements visible`, hints };
  }
  const heavyMutation = signals.mutationsLast500ms > 20;
  const hydrating = signals.framework && (heavyMutation || signals.visibleSpinners > 0);
  if (hydrating) {
    const heavyHydrationFramework = isHeavyHydrationFramework(signals.framework);
    const waitMs = heavyHydrationFramework ? 1500 : 800;
    return { state: "hydrating", waitMs, reasoning: `${signals.framework} hydrating (mut=${signals.mutationsLast500ms}, spinners=${signals.visibleSpinners}, heavy=${heavyHydrationFramework})`, hints };
  }
  if (opts.gate === "pre-form-synth" && expected && signals.visibleFields > 0 && signals.visibleFields < expected) {
    return { state: "partial_form", waitMs: 1e3, reasoning: `expected ${expected} fields for ${opts.expectedFormType}, see ${signals.visibleFields}`, hints };
  }
  if (signals.visibleSpinners > 0 && heavyMutation) {
    return { state: "modal_pending", waitMs: 600, reasoning: "mutations + spinners \u2192 modal/drawer opening", hints };
  }
  if (opts.gate === "pre-submit" && signals.visibleSpinners > 0) {
    return { state: "hydrating", waitMs: 600, reasoning: "spinner visible at pre-submit gate", hints };
  }
  const hasInteractables = signals.visibleFields > 0 || signals.inputCountByType && Object.keys(signals.inputCountByType).length > 0;
  if (signals.mutationsLast500ms <= 5 && signals.visibleSpinners === 0 && signals.bodyTextLength > 50 && hasInteractables) {
    return { state: "ready", waitMs: 0, reasoning: `settled (mut=${signals.mutationsLast500ms}, body=${signals.bodyTextLength}ch, inputs=${signals.visibleFields})`, hints };
  }
  if (signals.mutationsLast500ms <= 5 && signals.visibleSpinners === 0 && signals.bodyTextLength > 50 && !hasInteractables) {
    const waitMs = isHeavyHydrationFramework(signals.framework) ? 2e3 : 1e3;
    return { state: "hydrating", waitMs, reasoning: `body=${signals.bodyTextLength}ch but 0 interactables \u2014 SPA shell awaiting hydration`, hints };
  }
  return { state: "unknown", waitMs: 600, reasoning: "no heuristic matched", hints };
}
async function assessPageState(page, opts) {
  const maxRetries = opts.maxRetries ?? 3;
  const retryDelayMs = opts.retryDelayMs ?? 600;
  let budgetMs = opts.budgetMs ?? 8e3;
  const startedAt = Date.now();
  const log2 = opts.log ?? (() => {
  });
  let last;
  let budgetExtended = false;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (Date.now() - startedAt > budgetMs) {
      log2(`[PSA] budget exhausted (${budgetMs}ms) \u2014 returning last assessment`);
      break;
    }
    const signals = await collectSignals(page);
    last = classify(signals, opts);
    log2(`[PSA] gate=${opts.gate} attempt=${attempt} state=${last.state} wait=${last.waitMs}ms reason="${last.reasoning}"`);
    if (!budgetExtended && isHeavyHydrationFramework(last.hints.framework) && budgetMs < 15e3) {
      budgetMs = 15e3;
      budgetExtended = true;
      log2(`[PSA] gate=${opts.gate} budget extended to ${budgetMs}ms (heavy framework=${last.hints.framework})`);
    }
    if (last.state === "ready") return last;
    if (last.state === "captcha" || last.state === "error_state") return last;
    if (last.state === "unknown" && opts.llmConsult && attempt === 0) {
      try {
        const llm = await opts.llmConsult(signals);
        log2(`[PSA] LLM said state=${llm.state} wait=${llm.waitMs}ms reason="${llm.reasoning}"`);
        if (llm.state === "ready") return llm;
        last = llm;
      } catch (e) {
        log2(`[PSA] LLM consult failed: ${String(e?.message || e).slice(0, 120)}`);
      }
    }
    if (last.waitMs > 0) {
      await page.waitForTimeout(Math.min(last.waitMs, budgetMs - (Date.now() - startedAt)));
    } else {
      await page.waitForTimeout(retryDelayMs);
    }
  }
  return last ?? { state: "unknown", waitMs: 0, reasoning: "no assessment captured", hints: {} };
}

// src/executor-core.ts
var AX_ID_ATTR = "data-ax-id";
var gShadowPierce = false;
async function buildIndexedSnapshot(page) {
  const SNAPSHOT_FN = ({ axIdAttr, shadowPierce, idOffset }) => {
    document.querySelectorAll(`[${axIdAttr}]`).forEach((el) => el.removeAttribute(axIdAttr));
    const SELECTORS = [
      "a[href]",
      // Classed anchors WITHOUT href — the React/Vue/SPA nav pattern where a
      // <a class="shopping_cart_link"> / <a class="nav-link"> has its click wired
      // via addEventListener (so el.onclick is null), no href, and no
      // cursor:pointer. Every other signal misses it, yet its class is a perfect
      // name. SauceDemo's cart icon is exactly this — invisible to a[href] harvest
      // AND to the agent, so the cart (and everything past it: checkout) was
      // unreachable. Require [class] to skip bare <a name="x"> fragment targets.
      "a[class]:not([href])",
      "button",
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"])',
      'input[type="submit"]',
      'input[type="button"]',
      'input[type="reset"]',
      "select",
      "textarea",
      '[contenteditable="true"]',
      '[role="button"]',
      '[role="link"]',
      '[role="menuitem"]',
      '[role="tab"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[role="switch"]',
      '[role="combobox"]',
      // Clickable-shaped headings + cards. SPAs (Blazor, Vue, React)
      // routinely wire nav onto <h1>-<h6>, <div role="heading">, or
      // styled cards/tiles with onclick but no role attribute. They
      // appear as "headers" or "tiles" in the UI but were invisible to
      // M6. Filtered below by cursor:pointer / tabindex / click-data
      // attrs so we only pick the ones that are actually interactive.
      'h1, h2, h3, h4, h5, h6, [role="heading"]',
      '[tabindex]:not([tabindex="-1"])',
      "[data-onclick], [data-action], [data-href], [data-bs-target], [data-target], [hx-get], [hx-post]",
      // Icon-only ACTION controls that carry no role/href/tabindex/data-attr —
      // the exact shape of DataTable row Edit/Delete/View buttons that were
      // invisible to M6: a titled/tooltipped icon (DemoQA <span title="Edit">),
      // an icon-font span (Bagisto <span class="icon-view">), or a clickable
      // explicitly marked role=presentation/none. The secondary cursor:pointer /
      // clickable-ancestor filter below keeps decorative ones out.
      '[title]:not([title=""])',
      "[data-bs-original-title], [data-original-title], [data-tooltip], [data-tippy-content]",
      '[class*="icon" i]',
      '[role="presentation"], [role="none"]',
      // Native disclosure: <summary> toggles a <details>; aria-expanded controls
      // collapse accordions / off-canvas / tree nodes. Collected so they're
      // exercised (the reveal-sweep toggles them; hasPopupOf flags them ▼).
      "summary",
      "[aria-expanded]",
      "[aria-controls]"
    ];
    const sel = SELECTORS.join(", ");
    let elements;
    if (shadowPierce) {
      const out = [];
      const seen = /* @__PURE__ */ new Set();
      const walk = (root, depth) => {
        if (depth > 10) return;
        for (const el of Array.from(root.querySelectorAll("*"))) {
          if (!seen.has(el) && el.matches?.(sel)) {
            seen.add(el);
            out.push(el);
          }
          const sr = el.shadowRoot;
          if (sr && sr.mode === "open") walk(sr, depth + 1);
        }
      };
      walk(document, 0);
      elements = out;
    } else {
      elements = Array.from(document.querySelectorAll(sel));
    }
    const visible = elements.filter((el) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
      if (r.width === 0 && r.height === 0) return false;
      if (!el.offsetParent && style.position !== "fixed") return false;
      return true;
    });
    const filtered = visible.filter((el) => {
      const tag = el.tagName.toLowerCase();
      if (["a", "button", "input", "select", "textarea"].includes(tag)) return true;
      if (el.getAttribute("contenteditable") === "true") return true;
      const role = el.getAttribute("role") || "";
      if (["button", "link", "menuitem", "tab", "checkbox", "radio", "switch", "combobox", "option"].includes(role)) return true;
      const cursorPointer = getComputedStyle(el).cursor === "pointer";
      if (cursorPointer) return true;
      if (el.hasAttribute("onclick")) return true;
      const hasClickData = ["data-onclick", "data-action", "data-href", "data-bs-target", "data-target", "hx-get", "hx-post", "data-route"].some((a) => el.hasAttribute(a));
      if (hasClickData) return true;
      let cur = el.parentElement;
      let depth = 0;
      while (cur && depth < 4) {
        const cRole = cur.getAttribute("role") || "";
        if (["button", "link", "menuitem", "tab"].includes(cRole)) return true;
        if (cur.tagName === "A" || cur.tagName === "BUTTON") return true;
        if (getComputedStyle(cur).cursor === "pointer") return true;
        const cClass = cur.getAttribute("class") || "";
        const interactivePattern = /(?:\bhover:(?:shadow|bg|border|opacity|scale|ring|brightness|translate|rotate|text|fill|outline)|cursor-pointer|cursor:pointer|\bclickable\b|\binteractive\b|\btappable\b|\bselectable\b|\bhoverable\b|transition-(?:all|colors|shadow|transform|opacity)|-card(?:-hoverable)?\b|list-group-item-action|btn\b|MuiCardActionArea|MuiButtonBase|MuiListItemButton|MuiMenuItem|ant-card-hoverable|ant-list-item-action|ant-btn|ant-menu-item|\bis-(?:clickable|hoverable|active)\b|q-(?:card--clickable|item--clickable|hoverable|btn)|p-(?:card|menuitem|button|listbox-item)|mantine-UnstyledButton|chakra-(?:button|link|menu__menuitem|tab))/i;
        if (interactivePattern.test(cClass)) return true;
        const cs = getComputedStyle(cur);
        if (cs.transitionDuration && cs.transitionDuration !== "0s" && cs.transitionDuration !== "") {
          const tag2 = cur.tagName.toLowerCase();
          if (!["body", "html", "header", "footer", "main", "aside"].includes(tag2)) return true;
        }
        cur = cur.parentElement;
        depth++;
      }
      return false;
    });
    visible.length = 0;
    for (const e of filtered) visible.push(e);
    const roleOf = (el) => {
      const explicit = el.getAttribute("role");
      if (explicit && explicit !== "presentation" && explicit !== "none") return explicit;
      const tag = el.tagName.toLowerCase();
      if (tag === "a") return "link";
      if (tag === "button") return "button";
      if (tag === "select") return "combobox";
      if (tag === "textarea") return "textbox";
      if (tag === "input") {
        const t = (el.getAttribute("type") || "text").toLowerCase();
        if (t === "submit" || t === "button" || t === "reset") return "button";
        if (t === "checkbox") return "checkbox";
        if (t === "radio") return "radio";
        if (t === "search") return "searchbox";
        return "textbox";
      }
      if (["h1", "h2", "h3", "h4", "h5", "h6"].includes(tag)) return "heading";
      if (el.getAttribute("tabindex") && el.getAttribute("tabindex") !== "-1") return "clickable";
      if (["span", "div", "i", "em", "b", "a", "td", "li", "article", "section", "figure"].includes(tag) && (el.getAttribute("title") || el.onclick || getComputedStyle(el).cursor === "pointer")) return "clickable";
      return tag;
    };
    const collapse = (s) => s.replace(/\s+/g, " ").trim();
    const fnv1a = (s) => {
      let h = 2166136261;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
      }
      return h.toString(36);
    };
    const nameOf = (el) => {
      const aria = el.getAttribute("aria-label");
      if (aria && aria.trim()) return collapse(aria);
      const labelledBy = el.getAttribute("aria-labelledby");
      if (labelledBy) {
        const ref = document.getElementById(labelledBy);
        if (ref?.textContent?.trim()) return collapse(ref.textContent);
      }
      const id = el.getAttribute("id");
      if (id) {
        const lbl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (lbl?.textContent?.trim()) return collapse(lbl.textContent);
      }
      const parentLabel = el.closest("label");
      if (parentLabel?.textContent?.trim()) {
        return collapse(parentLabel.textContent.replace(el.value || "", ""));
      }
      const placeholder = el.getAttribute("placeholder");
      if (placeholder && placeholder.trim()) return placeholder.trim();
      const value = el.value;
      if (value && el.type === "submit") return value.trim();
      const svgTitle = el.querySelector("svg > title, :scope svg title");
      if (svgTitle?.textContent?.trim()) return collapse(svgTitle.textContent);
      const imgAlt = el.querySelector("img[alt]")?.getAttribute("alt");
      if (imgAlt && imgAlt.trim()) return collapse(imgAlt);
      const tag = el.tagName.toLowerCase();
      if (!["select", "textarea", "input"].includes(tag)) {
        const text = el.innerText?.trim();
        if (text) return collapse(text).slice(0, 120);
      }
      for (const a of ["title", "data-bs-original-title", "data-original-title", "data-bs-title", "data-tooltip"]) {
        const v = el.getAttribute(a);
        if (v && v.trim()) return collapse(v);
      }
      const name = el.getAttribute("name");
      if (name) return collapse(name);
      return "";
    };
    const UTILITY_CLS = /^(?:flex|grid|block|inline|hidden|relative|absolute|fixed|sticky|static|w-|h-|p-|m-|px-|py-|pt-|pb-|pl-|pr-|mx-|my-|mt-|mb-|ml-|mr-|gap-|text-|bg-|border|rounded|cursor-|items-|justify-|content-|self-|place-|space-|order-|hover:|focus:|active:|group-|peer-|sm:|md:|lg:|xl:|transition|duration|delay-|ease-|opacity|shadow|font-|leading-|tracking-|whitespace|overflow|truncate|z-|inset-|top-|left-|right-|bottom-|col-|row-|is-|has-|u-|util-)|^-?[a-z]{1,7}-\d|:\w/i;
    const iconTokenFrom = (el) => {
      const tokens = [];
      const add = (s) => {
        if (s) {
          for (const t of s.split(/\s+/)) if (t) tokens.push(t);
        }
      };
      add(el.getAttribute("class"));
      el.querySelectorAll("i,span,svg,use").forEach((n) => {
        add(n.getAttribute("class"));
        add(n.getAttribute("data-testid"));
        const href = n.getAttribute("href") || n.getAttribute("xlink:href");
        if (href && href.startsWith("#")) tokens.push(href.slice(1));
      });
      const iconTok = tokens.find((t) => /^(?:icon-|fa-|mdi-|pi-|bi-|glyphicon-|anticon-|lucide-|feather-|material-icons|ti-)/i.test(t) && t.length > 3 && !/^(?:fa|fas|far|fal|fab)$/i.test(t));
      if (iconTok) return collapse(iconTok);
      const testid = tokens.find((t) => /Icon$/i.test(t));
      if (testid) return collapse(testid);
      const svg = el.tagName.toLowerCase() === "svg" ? el : el.querySelector("svg");
      if (svg) {
        const paths = Array.from(svg.querySelectorAll("path,polygon,circle,rect,line")).map((n) => n.getAttribute("d") || n.getAttribute("points") || n.tagName).join("");
        const useRef = svg.querySelector("use")?.getAttribute("href") || svg.querySelector("use")?.getAttribute("xlink:href") || "";
        const sig = (paths + "|" + useRef + "|" + (svg.getAttribute("viewBox") || "")).trim();
        if (sig.replace(/\|/g, "").length > 1) return "icon~" + fnv1a(sig);
      }
      const distinctive = tokens.find((t) => t.length > 2 && !UTILITY_CLS.test(t) && /[a-z]/i.test(t));
      if (distinctive) return collapse(distinctive);
      const parent = el.parentElement;
      if (parent) {
        const sibs = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
        if (sibs.length > 1) return "ctrl~" + el.tagName.toLowerCase() + (sibs.indexOf(el) + 1);
      }
      return "";
    };
    const skeletonOf = (el) => {
      const cls = (el.getAttribute("class") || "").split(/\s+/).filter((c) => c && !/[0-9]/.test(c) && !/^(?:css|sc|jsx|emotion)-/i.test(c)).sort().join(".");
      return el.tagName + "|" + cls;
    };
    const rowGroupMemo = /* @__PURE__ */ new Map();
    const isRepeatingRow = (el) => {
      const parent = el.parentElement;
      if (!parent) return false;
      if (el.closest('nav, aside, header, footer, [role="navigation"], [role="menu"], [role="menubar"], [role="tablist"], [role="listbox"], [class*="sidebar" i], [class*="navbar" i], [class*="menu" i], [class*="accordion" i], [class*="card" i], [class*="tab-" i], [class*="-tab" i]')) return false;
      const contSig = (parent.getAttribute("role") || "") + " " + (parent.getAttribute("class") || "") + " " + parent.tagName;
      if (!/\b(grid|table|tbody|rowgroup|data|records?|results?|listing|roster|ledger)\b|datagrid|datatable|gridview/i.test(contSig)) return false;
      const textCells = Array.from(el.children).filter((c) => (c.textContent || "").trim().length > 0).length;
      if (textCells < 2) return false;
      let freq = rowGroupMemo.get(parent);
      if (!freq) {
        freq = /* @__PURE__ */ new Map();
        for (const sib of Array.from(parent.children)) {
          const k = skeletonOf(sib);
          freq.set(k, (freq.get(k) || 0) + 1);
        }
        rowGroupMemo.set(parent, freq);
      }
      return (freq.get(skeletonOf(el)) || 0) >= 3;
    };
    const rowScopedOf = (el) => {
      const row = el.closest('tr, [role="row"], [role="gridcell"], [role="cell"], td, .v-data-table__tr, .ag-row, .oxd-table-row, .rt-tr, [class*="table-row" i], [class*="grid-row" i], [class*="data-row" i], [class*="list-row" i], [class*="datatable" i] [class*="row" i]');
      if (row) {
        if (row.closest("thead") || row.getAttribute("role") === "columnheader" || /(-header|head-row|thead)/i.test(row.getAttribute("class") || "")) return false;
        return true;
      }
      let cur = el;
      for (let i = 0; i < 6 && cur && cur !== document.body; i++) {
        if (isRepeatingRow(cur)) {
          if (cur.closest("thead") || cur.getAttribute("role") === "columnheader") return false;
          return true;
        }
        cur = cur.parentElement;
      }
      return false;
    };
    const sectionOf = (el) => {
      let cur = el.parentElement;
      while (cur && cur !== document.body) {
        const tag = cur.tagName.toLowerCase();
        if (tag === "form") {
          const fname = cur.getAttribute("name") || cur.getAttribute("id");
          if (fname) return { role: "form", name: fname };
        }
        if (tag === "section" || tag === "dialog" || tag === "article" || tag === "nav") {
          const aria = cur.getAttribute("aria-label");
          if (aria) return { role: tag, name: aria };
        }
        const heading = cur.querySelector(":scope > h1, :scope > h2, :scope > h3");
        if (heading?.textContent?.trim()) {
          return { role: "section", name: heading.textContent.trim().slice(0, 60) };
        }
        cur = cur.parentElement;
      }
      return void 0;
    };
    const records = [];
    const seenEls = /* @__PURE__ */ new Set();
    for (const el of visible) {
      let name = nameOf(el);
      let nameInferred = false;
      if (!name) {
        const tok = iconTokenFrom(el);
        if (tok) {
          name = tok;
          nameInferred = true;
        }
      }
      if (!name) continue;
      seenEls.add(el);
      records.push({ el, role: roleOf(el), name: name.slice(0, 120), section: sectionOf(el), nameInferred, rowScoped: rowScopedOf(el) });
    }
    for (const row of Array.from(document.querySelectorAll('tr, [role="row"]'))) {
      const rowStyle = getComputedStyle(row);
      if (rowStyle.display === "none" || rowStyle.visibility === "hidden") continue;
      for (const el of Array.from(row.querySelectorAll('button, a[href], [role="button"], [role="menuitem"], [title]:not([title=""]), [class*="icon" i]'))) {
        if (seenEls.has(el)) continue;
        let hiddenUntilHover;
        try {
          hiddenUntilHover = typeof el.checkVisibility === "function" ? !el.checkVisibility({ opacityProperty: true, visibilityProperty: true, checkOpacity: true, checkVisibilityCSS: true }) : (() => {
            const s = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity || "1") === 0 || r.width === 0 && r.height === 0;
          })();
        } catch {
          const s = getComputedStyle(el);
          hiddenUntilHover = s.display === "none" || s.visibility === "hidden";
        }
        if (!hiddenUntilHover) continue;
        let nm = nameOf(el);
        let inf = false;
        if (!nm) {
          const t = iconTokenFrom(el);
          if (t) {
            nm = t;
            inf = true;
          }
        }
        if (!nm) continue;
        seenEls.add(el);
        const rl = roleOf(el);
        records.push({ el, role: rl === "presentation" || rl === "none" ? "clickable" : rl, name: nm.slice(0, 120), section: sectionOf(el), nameInferred: inf, rowScoped: true, hoverReveal: true });
      }
    }
    const hasPopupOf = (el) => {
      const ap = (el.getAttribute("aria-haspopup") || "").toLowerCase();
      if (ap && ap !== "false") return true;
      if (el.getAttribute("aria-expanded") === "false") return true;
      const ac = el.getAttribute("aria-controls");
      if (ac && document.getElementById(ac)) return true;
      if (el.tagName === "DETAILS" && !el.hasAttribute("open")) return true;
      if (el.tagName === "SUMMARY" && !el.closest("details")?.open) return true;
      const cls = (el.getAttribute("class") || "").toLowerCase();
      if (/(dropdown|menu-toggle|has-submenu|has-children|has-popup|caret|chevron|flyout|popover|offcanvas|mega-?menu|submenu|expander|collaps)/.test(cls)) return true;
      const isHidden = (n) => {
        const s = getComputedStyle(n);
        return s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity || "1") === 0 || /^0(px)?$/.test(s.maxHeight || "");
      };
      const next = el.nextElementSibling;
      if (next && /(submenu|dropdown|menu|panel|flyout|popover|list|nav|content)/i.test(next.getAttribute("class") || next.getAttribute("role") || "") && isHidden(next)) return true;
      for (const child of Array.from(el.children)) {
        if (/(submenu|dropdown|menu|panel|flyout|popover)/i.test(child.getAttribute("class") || child.getAttribute("role") || "") && isHidden(child)) return true;
      }
      return false;
    };
    const indexed = records.map((r, i) => {
      const axId = i + 1 + idOffset;
      try {
        r.el.setAttribute(axIdAttr, String(axId));
      } catch {
      }
      let href = "";
      try {
        if (r.el.tagName.toLowerCase() === "a") {
          const raw2 = r.el.getAttribute("href") || "";
          if (raw2) href = r.el.href || raw2;
        }
      } catch {
      }
      return { axId, role: r.role, name: r.name, section: r.section, hasPopup: hasPopupOf(r.el), href, nameInferred: r.nameInferred, rowScoped: r.rowScoped, hoverReveal: r.hoverReveal };
    });
    const isVis = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return s.display !== "none" && s.visibility !== "hidden" && (r.width > 0 || r.height > 0);
    };
    const btnLabel = (b) => ((b.textContent || b.value || b.getAttribute?.("aria-label") || "") + "").trim();
    const dismissRE = /^(cancel|close|dismiss|back|go\s*back|abort|reset|clear|skip|×|✕|✖|x)$/i;
    const isDismiss = (b) => {
      const t = btnLabel(b);
      return t !== "" && dismissRE.test(t);
    };
    const socialRE = /\b(google|github|gitlab|facebook|meta|microsoft|azure|apple|twitter|\bx\b|linkedin|okta|auth0|slack|discord|saml|sso|oauth|continue with|sign\s*in\s*with|log\s*in\s*with|sign\s*up\s*with)\b/i;
    const isToggleOrMenu = (b) => {
      const role = (b.getAttribute("role") || "").toLowerCase();
      if (["switch", "checkbox", "tab", "menuitem", "menuitemcheckbox", "menuitemradio"].includes(role)) return true;
      if (b.hasAttribute("aria-pressed") || b.hasAttribute("aria-checked") || b.hasAttribute("aria-expanded") || b.getAttribute("aria-haspopup")) return true;
      return /^(on|off|yes|no)$/i.test(btnLabel(b));
    };
    const isActionBtn = (b) => isVis(b) && !isDismiss(b) && !socialRE.test(btnLabel(b)) && !isToggleOrMenu(b);
    const inputEls = Array.from(document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), textarea, select, [contenteditable="true"]'
    )).filter((el) => isVis(el));
    const hasActionBtn = (root) => Array.from(root.querySelectorAll('button, input[type="submit"], [role="button"]')).some((b) => isActionBtn(b));
    const findClusterRoot = (el) => {
      const formAncestor = el.closest('form, [role="form"]');
      if (formAncestor) return formAncestor;
      let cur = el.parentElement;
      let depth = 0;
      let multiInputAncestor = null;
      while (cur && depth < 8 && cur !== document.body) {
        const here = cur;
        const inN = inputEls.filter((i) => here.contains(i)).length;
        if (inN >= 2 && inN <= 12 && hasActionBtn(here)) return here;
        if (!multiInputAncestor && inN >= 2 && inN <= 12) multiInputAncestor = here;
        cur = cur.parentElement;
        depth++;
      }
      return multiInputAncestor || el.parentElement || el;
    };
    const formClusters = /* @__PURE__ */ new Map();
    for (const inp of inputEls) {
      const root = findClusterRoot(inp);
      if (!formClusters.has(root)) formClusters.set(root, { inputs: [], submit: null });
      formClusters.get(root).inputs.push(inp);
    }
    const forms = [];
    for (const [root, cluster] of formClusters) {
      if (cluster.inputs.length === 0) continue;
      const btns = Array.from(root.querySelectorAll('button, input[type="submit"], [role="button"]'));
      const btnText = btnLabel;
      const eligible = btns.filter((b) => isActionBtn(b));
      let submit = null;
      for (const b of eligible) {
        const isSubmitType = b.type === "submit";
        if (b.tagName.toLowerCase() === "button" && b.type === "submit" || isSubmitType) {
          submit = b;
          break;
        }
      }
      if (!submit && eligible.length) submit = eligible[eligible.length - 1];
      if (!submit) submit = btns.find((b) => !socialRE.test(btnText(b))) || btns[0] || null;
      let formName = root.getAttribute("name") || root.getAttribute("id") || root.getAttribute("aria-label") || "";
      if (!formName && cluster.inputs.length > 0) {
        const first = cluster.inputs[0];
        formName = first.getAttribute("aria-label") || first.getAttribute("placeholder") || first.name || "unnamed-form";
      }
      const fieldNames = cluster.inputs.map((i) => {
        const el = i;
        return ((el.name || el.id || el.getAttribute("aria-label") || el.placeholder || "") + "").toLowerCase();
      });
      const inputTypes = cluster.inputs.map((i) => (i.type || "text").toLowerCase());
      const anyName = (re) => fieldNames.some((n) => re.test(n));
      const allDateInputs = inputTypes.every((t) => t === "date" || t === "datetime-local" || t === "time" || t === "month" || t === "week");
      const allNumericInputs = inputTypes.every((t) => t === "number" || t === "range");
      const allTextareasOrCEs = cluster.inputs.every((i) => {
        const tag = i.tagName.toLowerCase();
        return tag === "textarea" || i.getAttribute("contenteditable") === "true";
      });
      const allBoolInputs = inputTypes.every((t) => t === "checkbox" || t === "radio");
      const hasPassword = inputTypes.includes("password");
      const hasEmail = inputTypes.includes("email") || anyName(/email\b|e-?mail/);
      const hasCard = anyName(/\bcard(num|number|holder)?\b|cvv|cvc|cardnumber|cc[_-]?(num|number)|expir/);
      const hasAddress = anyName(/\b(street|address|address1|address2|city|state|zip|zipcode|postal|country|province)\b/);
      const hasContact = anyName(/\b(name|first[_-]?name|last[_-]?name|fullname|email|phone|tel|mobile|message|comment|subject|enquiry|inquiry|feedback)\b/);
      const hasFreeText = cluster.inputs.some((i) => {
        const el = i;
        const tag = i.tagName.toLowerCase();
        const ty = (el.type || "text").toLowerCase();
        const textual = tag === "textarea" || i.getAttribute("contenteditable") === "true" || ["text", "email", "tel", "url", ""].includes(ty);
        if (!textual) return false;
        const sig = ((el.name || "") + " " + (el.placeholder || "") + " " + (el.getAttribute("aria-label") || "")).toLowerCase();
        return !/search|find|query|filter/.test(sig);
      });
      const submitText = submit ? (submit.textContent || submit.value || "").trim().toLowerCase() : "";
      let formType = "unknown";
      const pwCount = inputTypes.filter((t) => t === "password").length;
      const changePwNamed = anyName(/new.?pass|current.?pass|old.?pass|confirm.?pass|re-?enter.?pass|change.?pass|newpw|oldpw|confirmpw|resetpass/);
      const hasIdentifier = hasEmail || anyName(/\buser(name|id)?\b|\blogin\b|\baccount\b|\bphone\b|\bmobile\b|loginname|login[_-]?id/);
      const isChangePw = hasPassword && !hasIdentifier && (pwCount >= 2 || changePwNamed);
      if (isChangePw) formType = "password-reset";
      else if (hasPassword && pwCount <= 1 && cluster.inputs.length <= 3) formType = "login";
      else if (hasPassword) formType = "signup";
      else if (hasCard) formType = "payment";
      else if (cluster.inputs.length >= 2 && hasAddress) formType = "address";
      else if (allDateInputs && cluster.inputs.length <= 2) formType = "date_filter";
      else if (allNumericInputs && cluster.inputs.length <= 2) formType = "numeric_filter";
      else if (allTextareasOrCEs && cluster.inputs.length === 1) formType = "note";
      else if (allBoolInputs) formType = "boolean_setting";
      else if (cluster.inputs.length === 1 && (hasEmail || /(search|find|query)/i.test(cluster.inputs[0].placeholder || ""))) formType = "search";
      else if (hasContact && cluster.inputs.length >= 2 && cluster.inputs.length <= 6) formType = "contact";
      else if (cluster.inputs.length >= 3) formType = "crud";
      if (formType === "unknown" && submitText) {
        if (/save\s+config|update\s+settings?|settings/i.test(submitText)) formType = "settings_save";
        else if (/add\s+to\s+cart|add\s+to\s+bag|buy\s+now/i.test(submitText)) formType = "cart_add";
        else if (/subscribe|join|sign\s*up.*newsletter/i.test(submitText)) formType = "subscribe";
        else if (/apply|filter|refresh|update\s+chart/i.test(submitText)) formType = "filter";
      }
      if (formType === "unknown" && hasFreeText) formType = "crud";
      const actionLabels = eligible.map((b) => btnLabel(b)).filter((t) => t && t.length <= 60).slice(0, 12);
      forms.push({
        formName,
        formType,
        actionLabels,
        fieldCount: cluster.inputs.length,
        fields: cluster.inputs.map((i) => {
          const el = i;
          let label = el.getAttribute("aria-label") || "";
          if (!label) {
            const lbId = el.getAttribute("aria-labelledby");
            if (lbId) {
              const ref = document.getElementById(lbId);
              if (ref?.textContent?.trim()) label = ref.textContent.trim();
            }
          }
          if (!label && el.id) {
            const lblEl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
            if (lblEl?.textContent?.trim()) label = lblEl.textContent.trim();
          }
          if (!label) {
            const parentLabel = el.closest("label");
            if (parentLabel?.textContent?.trim()) {
              label = parentLabel.textContent.replace(el.value || "", "").trim();
            }
          }
          if (!label && el.placeholder) label = el.placeholder.trim();
          if (!label && el.id) {
            label = el.id.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
          }
          if (!label && el.name) label = el.name;
          let placeholderOut = el.placeholder || "";
          let optionsOut = [];
          if (el.tagName.toLowerCase() === "select") {
            const selectEl = el;
            const opts = Array.from(selectEl.options || []);
            const meaningful = opts.find((o) => o.text && !/^(select|choose|pick|none|--)/i.test(o.text.trim()));
            if (!label && meaningful) label = `Select (${meaningful.text.trim().slice(0, 40)})`;
            if (!placeholderOut) {
              const optionTexts = opts.slice(0, 5).map((o) => o.text.trim()).filter(Boolean);
              if (optionTexts.length > 0) placeholderOut = optionTexts.join(" | ").slice(0, 100);
            }
            optionsOut = opts.map((o) => o.text.trim()).filter((t) => t && !/^(select|choose|pick|none|--)/i.test(t)).slice(0, 50);
          }
          const testid = el.getAttribute("data-testid") || el.getAttribute("data-test") || el.getAttribute("data-cy") || el.getAttribute("data-qa") || "";
          const ariaLabel = el.getAttribute("aria-label") || "";
          if (!label && testid) {
            label = testid.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
          }
          if (!label && ariaLabel) label = ariaLabel;
          let typeOut = el.type || "text";
          if (!el.type && el.isContentEditable) typeOut = "contenteditable";
          return {
            tag: el.tagName.toLowerCase(),
            type: typeOut,
            name: el.name || "",
            id: el.id || "",
            label,
            placeholder: placeholderOut,
            required: el.required || false,
            ...testid ? { testid } : {},
            ...ariaLabel ? { ariaLabel } : {},
            ...optionsOut.length > 0 ? { options: optionsOut } : {}
          };
        }),
        submitButton: submit ? (submit.textContent || submit.value || "").trim() : ""
      });
      if (forms.length >= 20) break;
    }
    const navContainers = Array.from(document.querySelectorAll(
      'nav, [role="navigation"], [role="menubar"], [role="menu"], [role="tree"], [class*="sidebar" i], [class*="nav" i], [class*="menu" i], [class*="drawer" i]'
    ));
    const navHrefs = [];
    const seenHrefs = /* @__PURE__ */ new Set();
    const collectFromAnchors = (anchors) => {
      for (const a of anchors) {
        const raw2 = a.getAttribute("href") || "";
        if (!raw2 || raw2.startsWith("#") || raw2.startsWith("javascript:") || raw2.startsWith("mailto:") || raw2.startsWith("tel:")) continue;
        const resolved = a.href;
        if (!resolved.startsWith("http")) continue;
        if (seenHrefs.has(resolved)) continue;
        seenHrefs.add(resolved);
        navHrefs.push(resolved);
        if (navHrefs.length >= 80) break;
      }
    };
    for (const container of navContainers) {
      collectFromAnchors(container.querySelectorAll("a[href]"));
      if (navHrefs.length >= 80) break;
    }
    if (navHrefs.length < 3) {
      collectFromAnchors(document.querySelectorAll("a[href]"));
    }
    return { indexed, navHrefs, forms };
  };
  const raw = await page.evaluate(SNAPSHOT_FN, { axIdAttr: AX_ID_ATTR, shadowPierce: gShadowPierce, idOffset: 0 });
  const frameRecords = [];
  if (gShadowPierce) {
    try {
      let idOffset = raw.indexed.length;
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        let frameSel = "";
        try {
          const fe = await frame.frameElement();
          frameSel = await fe.evaluate((el) => {
            if (el.id) return `#${CSS.escape(el.id)}`;
            const same = Array.from(document.querySelectorAll("iframe"));
            return `iframe:nth-of-type(${same.indexOf(el) + 1})`;
          }).catch(() => "");
        } catch {
          continue;
        }
        if (!frameSel) continue;
        let fr;
        try {
          fr = await frame.evaluate(SNAPSHOT_FN, { axIdAttr: AX_ID_ATTR, shadowPierce: true, idOffset });
        } catch {
          continue;
        }
        for (const r of fr?.indexed || []) {
          r.__frameSel = frameSel;
          frameRecords.push(r);
          idOffset = Math.max(idOffset, r.axId);
        }
      }
    } catch {
    }
  }
  const interactables = [];
  for (const r of [...raw.indexed, ...frameRecords]) {
    interactables.push({
      id: r.axId,
      role: r.role,
      name: r.name,
      section: r.section?.name,
      sectionRole: r.section?.role,
      path: [],
      hasPopup: r.hasPopup,
      href: r.href || void 0,
      nameInferred: r.nameInferred || void 0,
      rowScoped: r.rowScoped || void 0,
      hoverReveal: r.hoverReveal || void 0,
      frameSelector: r.__frameSel ? [r.__frameSel] : void 0
    });
  }
  const lines = [];
  for (const it of interactables.slice(0, 80)) {
    const scope = it.section ? `  (in ${it.sectionRole} "${it.section}")` : "";
    const popup = it.hasPopup ? " \u25BC" : "";
    lines.push(`  [${it.id}] ${it.role} "${it.name}"${popup}${scope}`);
  }
  if (interactables.length > 80) lines.push(`  \u2026(+${interactables.length - 80} more interactables not shown)`);
  return { interactables, forPrompt: lines.join("\n"), navHrefs: raw.navHrefs, forms: raw.forms };
}
async function extractResolvedSelectors(loc) {
  try {
    const out = await loc.evaluate((node) => {
      const res = {};
      const attr = (n) => node.getAttribute(n) || "";
      const esc = (s) => window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
      const isStableId = (id2) => !!id2 && !/^(:r|ember|react|radix-|headlessui-|mui-|rc_|sl-|el-id-|cdk-|ext-gen|yui_|aria-)/i.test(id2) && !/\d{6,}/.test(id2) && !id2.includes(":");
      const testid = attr("data-testid") || attr("data-test") || attr("data-test-id") || attr("data-cy") || attr("data-qa");
      if (testid) res.testId = testid;
      const aria = attr("aria-label");
      if (aria) res.ariaLabel = aria;
      const id = attr("id");
      if (isStableId(id)) res.idSelector = "#" + esc(id);
      const name = attr("name");
      if (name) res.nameSelector = '[name="' + name.replace(/"/g, '\\"') + '"]';
      try {
        let labelText = "";
        if (id) {
          const l = document.querySelector('label[for="' + esc(id) + '"]');
          if (l) labelText = (l.textContent || "").trim();
        }
        if (!labelText) {
          const w = node.closest("label");
          if (w) labelText = (w.textContent || "").trim();
        }
        if (!labelText) {
          const lb = attr("aria-labelledby");
          if (lb) {
            const r = document.getElementById(lb.split(/\s+/)[0]);
            if (r) labelText = (r.textContent || "").trim();
          }
        }
        labelText = labelText.replace(/\s+/g, " ").slice(0, 80);
        if (labelText) res.labelText = labelText;
      } catch {
      }
      const ph = attr("placeholder");
      if (ph) res.placeholderSelector = '[placeholder="' + ph.replace(/"/g, '\\"').slice(0, 80) + '"]';
      try {
        const landmark = /^(FORM|NAV|MAIN|HEADER|FOOTER|SECTION|DIALOG|ASIDE|TABLE)$/;
        let anchor = null, anchorSel = "";
        let cur = node.parentElement, depth = 0;
        while (cur && depth < 6) {
          const cid = cur.getAttribute("id") || "";
          const ct = cur.getAttribute("data-testid") || cur.getAttribute("data-test") || "";
          const role = cur.getAttribute("role") || "";
          if (isStableId(cid)) {
            anchor = cur;
            anchorSel = "#" + esc(cid);
            break;
          }
          if (ct) {
            anchor = cur;
            anchorSel = '[data-testid="' + ct.replace(/"/g, '\\"') + '"]';
            break;
          }
          if (role && /^(form|navigation|main|dialog|search|banner|region)$/.test(role)) {
            anchor = cur;
            anchorSel = '[role="' + role + '"]';
            break;
          }
          if (landmark.test(cur.tagName)) {
            anchor = cur;
            anchorSel = cur.tagName.toLowerCase();
            break;
          }
          cur = cur.parentElement;
          depth++;
        }
        if (anchor) {
          const hops = [];
          let n = node;
          while (n && n !== anchor) {
            const p = n.parentElement;
            if (!p) break;
            let idx = 1, sib = n.previousElementSibling;
            while (sib) {
              if (sib.tagName === n.tagName) idx++;
              sib = sib.previousElementSibling;
            }
            hops.unshift(n.tagName.toLowerCase() + "[" + idx + "]");
            n = p;
          }
          if (hops.length) res.relativeXpath = anchorSel + " >> xpath=./" + hops.join("/");
        }
      } catch {
      }
      return res;
    });
    return out && Object.keys(out).length ? out : void 0;
  } catch {
    return void 0;
  }
}
async function resolveActionLocator(page, args) {
  const { id, interactables } = args;
  let role = args.role;
  let name = args.name;
  let near = args.near;
  if (typeof id === "number") {
    const itf = interactables.find((x) => x.id === id);
    if (itf?.frameSelector && itf.frameSelector.length) {
      let fl = page.frameLocator(itf.frameSelector[0]);
      for (let i = 1; i < itf.frameSelector.length; i++) fl = fl.frameLocator(itf.frameSelector[i]);
      const inFrame = fl.locator(`[${AX_ID_ATTR}="${id}"]`);
      const fc = await inFrame.count().catch(() => 0);
      if (fc >= 1) return { locator: inFrame.first(), stale: false };
    }
    const markerLocator = page.locator(`[${AX_ID_ATTR}="${id}"]`);
    const count = await markerLocator.count().catch(() => 0);
    if (count === 1) {
      return { locator: markerLocator, stale: false };
    }
    if (count > 1) {
      return { locator: markerLocator.first(), stale: false };
    }
    const it = interactables.find((x) => x.id === id);
    if (it) {
      role = role || it.role;
      name = name || it.name;
      if (!near && it.section) near = it.section;
    } else {
      return { locator: page.locator("body").first(), stale: true };
    }
  }
  if (!role || !name) {
    return { locator: page.locator("body").first(), stale: true };
  }
  const pageWide = page.getByRole(role, { name }).first();
  if (!near) return { locator: pageWide, stale: false };
  try {
    const scope = page.locator(`*:visible:has-text(${JSON.stringify(near)})`).first().locator("xpath=ancestor-or-self::form[1] | ancestor-or-self::section[1] | ancestor-or-self::dialog[1] | ancestor-or-self::article[1] | ancestor-or-self::div[@id or @class][1]").first();
    const scoped = scope.getByRole(role, { name }).first();
    if (await scoped.count().catch(() => 0) > 0) {
      return { locator: scoped, stale: false };
    }
  } catch {
  }
  return { locator: pageWide, stale: false };
}
var tunnelRelayErrorCounts = /* @__PURE__ */ new WeakMap();
var TUNNEL_INFRA_ERROR_STRINGS = [
  "tunnel not connected",
  "tunnel timed out waiting for the local app",
  "tunnel not accepting requests",
  "bad tunnel response"
];
async function executeAction(page, context, action, credentials, log2, interactables = [], navigationDelayMs = 0, rateLimitDetector) {
  try {
    switch (action.action) {
      case "navigate":
        if (navigationDelayMs > 0) {
          await new Promise((r) => setTimeout(r, navigationDelayMs));
        }
        log2(`[Agent] navigate \u2192 ${action.url}`);
        const navStart = Date.now();
        const navResponse = await page.goto(action.url, { waitUntil: "commit", timeout: 6e4 });
        if (rateLimitDetector && navResponse) {
          rateLimitDetector.recordResponse({
            url: page.url(),
            status: navResponse.status(),
            elapsedMs: Date.now() - navStart,
            retryAfterHeader: navResponse.headers()["retry-after"]
          });
        }
        await waitForPageReady(page).catch(() => {
        });
        {
          const navStatus = navResponse?.status();
          if (navStatus === 502 || navStatus === 504) {
            const bodyText = (await page.evaluate(() => (document.body?.innerText || "").trim()).catch(() => "")).toLowerCase();
            if (bodyText.length <= 200 && TUNNEL_INFRA_ERROR_STRINGS.some((s) => bodyText.includes(s))) {
              const n = (tunnelRelayErrorCounts.get(context) || 0) + 1;
              tunnelRelayErrorCounts.set(context, n);
              log2(`[Agent] tunnel relay error #${n} at ${action.url} (HTTP ${navStatus}: "${bodyText.slice(0, 70)}") \u2014 local app not reachable THROUGH the tunnel, not an app failure`);
              return { outcome: "tunnel_error", navigated: false };
            }
          }
          if (tunnelRelayErrorCounts.get(context)) tunnelRelayErrorCounts.set(context, 0);
        }
        if (rateLimitDetector) {
          const sig = await rateLimitDetector.assess(page);
          if (sig.severity === "stop") throw new RateLimitedError(sig);
          if (sig.severity === "pause" && sig.retryAfterMs > 0) {
            log2(`[Agent] rate-limit pause: ${sig.reason} \u2014 sleeping ${sig.retryAfterMs}ms`);
            await new Promise((r) => setTimeout(r, sig.retryAfterMs));
          } else if (sig.severity === "warning") {
            log2(`[Agent] rate-limit warning: ${sig.reason}`);
          }
        }
        try {
          const url2 = page.url();
          const urlExpectsLogin = /\/(login|signin|sign-in|auth)/i.test(url2);
          await assessPageState(page, {
            gate: "post-nav",
            expectedFormType: urlExpectsLogin ? "login" : void 0,
            maxRetries: 3,
            retryDelayMs: 500,
            budgetMs: 6e3,
            log: log2
          });
        } catch {
        }
        try {
          const urlNow = page.url();
          if (/\/(login|signin|sign-?in|auth\b|account\/login|users\/sign_in|session\/new)/i.test(urlNow)) {
            await page.waitForFunction(() => {
              const vis = Array.from(document.querySelectorAll('input:not([type="hidden"]),textarea,[contenteditable="true"]')).filter((el) => {
                const r = el.getBoundingClientRect();
                const s = getComputedStyle(el);
                return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0;
              });
              return vis.some((el) => el.type === "password") || vis.length >= 2;
            }, { timeout: 7e3, polling: 250 }).catch(() => {
            });
          }
        } catch {
        }
        return { outcome: "navigated", navigated: true };
      case "click": {
        const idLabel = typeof action.id === "number" ? `[${action.id}] ` : "";
        const roleName = action.role && action.name ? `${action.role}[name="${action.name}"]` : "";
        const nearLabel = action.near ? ` near "${action.near}"` : "";
        log2(`[Agent] click ${idLabel}${roleName}${nearLabel}`);
        const { locator: loc, stale } = await resolveActionLocator(page, {
          id: action.id,
          role: action.role,
          name: action.name,
          near: action.near,
          interactables
        });
        if (stale) {
          log2(`[Agent] click target stale (id=${action.id} not in current DOM)`);
          return { outcome: "stale_marker", navigated: false };
        }
        await loc.scrollIntoViewIfNeeded({ timeout: 2e3 }).catch(() => {
        });
        try {
          const hidden = await loc.evaluate((el) => {
            if (typeof el.checkVisibility === "function") return !el.checkVisibility({ opacityProperty: true, visibilityProperty: true, checkOpacity: true, checkVisibilityCSS: true });
            const s = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return s.display === "none" || s.visibility === "hidden" || r.width === 0 && r.height === 0;
          }).catch(() => false);
          if (hidden) {
            const rowLoc = loc.locator('xpath=ancestor-or-self::tr[1] | ancestor-or-self::*[@role="row"][1]').first();
            await rowLoc.hover({ timeout: 2e3, force: true }).catch(() => {
            });
            await page.waitForTimeout(150);
          }
        } catch {
        }
        action.resolved = await extractResolvedSelectors(loc);
        if (action.action === "click" && (action.role === "heading" || action.role === "clickable")) {
          try {
            await loc.evaluate((el) => {
              const selfActionable = getComputedStyle(el).cursor === "pointer" || !!el.onclick || el.hasAttribute("onclick") || (el.getAttribute("title") || "").trim() !== "" || /(?:^|[-_])(?:edit|delete|remove|view|show|action|btn)(?:$|[-_0-9])/i.test(el.id || "");
              if (!selfActionable) {
                let cur = el.parentElement;
                let depth = 0;
                let found = false;
                const interactivePattern = /(?:\bhover:(?:shadow|bg|border|opacity|scale|ring)|cursor-pointer|\bclickable\b|\bcard\b|MuiCardActionArea|MuiButtonBase|ant-card-hoverable|q-card--clickable|p-card)/i;
                while (cur && depth < 6) {
                  const r = cur.getAttribute("role") || "";
                  if (["button", "link", "menuitem", "tab"].includes(r)) {
                    found = true;
                    break;
                  }
                  if (cur.tagName === "A" || cur.tagName === "BUTTON") {
                    found = true;
                    break;
                  }
                  if (cur.onclick) {
                    found = true;
                    break;
                  }
                  if (getComputedStyle(cur).cursor === "pointer") {
                    found = true;
                    break;
                  }
                  if (interactivePattern.test(cur.getAttribute("class") || "")) {
                    found = true;
                    break;
                  }
                  cur = cur.parentElement;
                  depth++;
                }
                if (found && cur && cur !== el) {
                  ;
                  cur.scrollIntoView({ block: "center" });
                  cur.click();
                  return;
                }
              }
              ;
              el.scrollIntoView({ block: "center" });
              el.click();
            });
            await page.waitForLoadState("domcontentloaded", { timeout: 15e3 }).catch(() => {
            });
            await waitForInteractionSettle(page).catch(() => {
            });
            return { outcome: "clicked", navigated: true };
          } catch (e) {
            log2(`[Agent] heading-ancestor click failed (${String(e?.message || e).slice(0, 80)}) \u2014 falling through to regular click`);
          }
        }
        const hrefInfo = await loc.evaluate((el) => {
          if (el.tagName !== "A") return null;
          const a = el;
          const href = a.getAttribute("href") || "";
          if (!href || href.startsWith("javascript:") || href.startsWith("#")) return null;
          return { href: a.href, hasOnClick: !!a.onclick };
        }).catch(() => null);
        if (hrefInfo && !hrefInfo.hasOnClick) {
          if (navigationDelayMs > 0) {
            await new Promise((r) => setTimeout(r, navigationDelayMs));
          }
          log2(`[Agent] click \u2192 anchor-fast-path navigate ${hrefInfo.href}`);
          await page.goto(hrefInfo.href, { waitUntil: "commit", timeout: 6e4 });
          await waitForPageReady(page).catch(() => {
          });
          return { outcome: "clicked", navigated: true };
        }
        const disabledReason = await loc.evaluate((el) => {
          if (el.disabled === true) return "disabled";
          const ad = el.getAttribute && el.getAttribute("aria-disabled");
          if (ad === "true" || ad === "") return "aria-disabled";
          const cls = String(el.className && el.className.baseVal != null ? el.className.baseVal : el.className || "");
          if (/(^|[\s-])disabled([\s-]|$)/.test(cls)) return "class-disabled";
          return "";
        }).catch(() => "");
        if (disabledReason) {
          log2(`[Agent] click skipped \u2014 ${disabledReason} ${action.role || ""}[name="${(action.name || "").slice(0, 30)}"]`);
          return { outcome: "stale_marker", navigated: false };
        }
        try {
          await loc.click({ timeout: 4e3 });
        } catch (e) {
          const msg = String(e?.message || e);
          if (msg.includes("Timeout") || msg.includes("not visible") || msg.includes("intercepts")) {
            log2(`[Agent] click standard failed (${msg.slice(0, 80)}) \u2014 DOM-dispatch, then force`);
            try {
              await loc.evaluate((el) => {
                el.scrollIntoView({ block: "center" });
                el.click();
              });
            } catch {
              await loc.click({ timeout: 2e3, force: true }).catch(() => {
              });
            }
          } else {
            throw e;
          }
        }
        await page.waitForLoadState("domcontentloaded", { timeout: 15e3 }).catch(() => {
        });
        await waitForInteractionSettle(page).catch(() => {
        });
        return { outcome: "clicked", navigated: true };
      }
      case "fill": {
        let value = action.value;
        if (credentials) {
          value = value.replace(/\{\{?\s*username\s*\}?\}/gi, credentials.username);
          value = value.replace(/\{\{?\s*password\s*\}?\}/gi, credentials.password);
        }
        const idLabel = typeof action.id === "number" ? `[${action.id}] ` : "";
        const roleName = action.role && action.name ? `${action.role}[name="${action.name}"]` : "";
        log2(`[Agent] fill ${idLabel}${roleName}`);
        const { locator: loc, stale } = await resolveActionLocator(page, {
          id: action.id,
          role: action.role,
          name: action.name,
          near: action.near,
          interactables
        });
        if (stale) {
          log2(`[Agent] fill target stale (id=${action.id} not in current DOM)`);
          return { outcome: "stale_marker", navigated: false };
        }
        await loc.scrollIntoViewIfNeeded({ timeout: 2e3 }).catch(() => {
        });
        if (credentials?.username) {
          try {
            const blocked = await loc.evaluate((el, ctx) => {
              const norm = (s) => String(s == null ? "" : s).trim().toLowerCase();
              const want = norm(ctx.authEmail);
              if (!want) return false;
              const cur = norm(el.value);
              return cur === want && norm(ctx.newValue) !== want;
            }, { authEmail: credentials.username, newValue: value });
            if (blocked) {
              log2(`[Agent] fill BLOCKED by self-credential guard \u2014 refusing to change the logged-in account's own email ${roleName || (idLabel || "")}`);
              return { outcome: "self_cred_protected", navigated: false };
            }
          } catch {
          }
        }
        action.resolved = await extractResolvedSelectors(loc);
        await loc.fill(value, { timeout: 1e4 });
        return { outcome: "filled", navigated: false };
      }
      case "submit": {
        log2(`[Agent] submit form#${action.formId}`);
        const navPromise = page.waitForLoadState("domcontentloaded", { timeout: 15e3 }).catch(() => {
        });
        await page.evaluate((id) => {
          const f = document.getElementById(id);
          if (f && typeof f.submit === "function") f.submit();
        }, action.formId);
        await navPromise;
        return { outcome: "submitted", navigated: true };
      }
      case "hover": {
        const idLabel = typeof action.id === "number" ? `[${action.id}] ` : "";
        const roleName = action.role && action.name ? `${action.role}[name="${action.name}"]` : "";
        log2(`[Agent] hover ${idLabel}${roleName}`);
        const { locator: loc, stale } = await resolveActionLocator(page, {
          id: action.id,
          role: action.role,
          name: action.name,
          near: action.near,
          interactables
        });
        if (stale) {
          log2(`[Agent] hover target stale (id=${action.id} not in current DOM)`);
          return { outcome: "stale_marker", navigated: false };
        }
        await loc.scrollIntoViewIfNeeded({ timeout: 2e3 }).catch(() => {
        });
        await loc.hover({ timeout: 5e3 }).catch(async (e) => {
          log2(`[Agent] hover standard failed (${String(e?.message || e).slice(0, 80)}) \u2014 retrying with force`);
          await loc.hover({ timeout: 3e3, force: true });
        });
        await page.waitForTimeout(400);
        await loc.evaluate((el) => {
          const reveal = (n) => {
            if (!n) return;
            const h = n;
            h.style.setProperty("display", "block", "important");
            h.style.setProperty("visibility", "visible", "important");
            h.style.setProperty("opacity", "1", "important");
            h.style.setProperty("max-height", "none", "important");
            h.style.setProperty("pointer-events", "auto", "important");
          };
          const isPanel = (n) => !!n && /(submenu|dropdown|menu|panel|flyout|popover|content|nav|list)/i.test((n.getAttribute("class") || "") + " " + (n.getAttribute("role") || ""));
          if (isPanel(el.nextElementSibling)) reveal(el.nextElementSibling);
          for (const c of Array.from(el.children)) if (isPanel(c)) reveal(c);
          const ac = el.getAttribute("aria-controls");
          if (ac) reveal(document.getElementById(ac));
          el.setAttribute("aria-expanded", "true");
        }).catch(() => {
        });
        for (let depth = 2; depth <= 4; depth++) {
          let revealedCount = 0;
          try {
            revealedCount = await page.evaluate(() => {
              const MAX = 20;
              const isHidden = (n2) => {
                const s = getComputedStyle(n2);
                return s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity || "1") === 0 || /^0(px)?$/.test(s.maxHeight || "");
              };
              const reveal = (n2) => {
                if (!n2) return;
                const h = n2;
                h.style.setProperty("display", "block", "important");
                h.style.setProperty("visibility", "visible", "important");
                h.style.setProperty("opacity", "1", "important");
                h.style.setProperty("max-height", "none", "important");
              };
              const panelRE = /(submenu|dropdown|menu|panel|flyout|popover|content|list)/i;
              const openPanels = Array.from(document.querySelectorAll('[role="menu"],[role="menubar"],[class*="submenu" i],[class*="dropdown" i],[class*="flyout" i],[class*="mega" i],[class*="popover" i]')).filter((p) => !isHidden(p));
              const triggers = [];
              for (const panel of openPanels) {
                for (const t of Array.from(panel.querySelectorAll('a,button,[role="menuitem"],li'))) {
                  if (triggers.length >= MAX) break;
                  const ac = t.getAttribute("aria-controls");
                  const ns = t.nextElementSibling;
                  const hasHiddenPanel = ns && panelRE.test((ns.getAttribute("class") || "") + (ns.getAttribute("role") || "")) && isHidden(ns) || Array.from(t.children).some((c) => panelRE.test((c.getAttribute("class") || "") + (c.getAttribute("role") || "")) && isHidden(c)) || !!ac && !!document.getElementById(ac) && isHidden(document.getElementById(ac)) || t.getAttribute("aria-haspopup") === "true" || t.getAttribute("aria-expanded") === "false";
                  if (hasHiddenPanel) triggers.push(t);
                }
              }
              let n = 0;
              for (const t of triggers.slice(0, MAX)) {
                if (t.nextElementSibling && panelRE.test((t.nextElementSibling.getAttribute("class") || "") + (t.nextElementSibling.getAttribute("role") || ""))) reveal(t.nextElementSibling);
                for (const c of Array.from(t.children)) if (panelRE.test((c.getAttribute("class") || "") + (c.getAttribute("role") || ""))) reveal(c);
                const ac = t.getAttribute("aria-controls");
                if (ac) reveal(document.getElementById(ac));
                t.setAttribute("aria-expanded", "true");
                n++;
              }
              return n;
            });
          } catch {
            break;
          }
          if (revealedCount === 0) break;
          await page.waitForTimeout(200);
        }
        return { outcome: "hovered", navigated: false };
      }
      case "scroll": {
        const maxIters = Math.min(action.iterations ?? 5, 8);
        const SCROLL_BUDGET_MS = 8e3;
        const scrollStart = Date.now();
        const measure = () => page.evaluate(() => {
          const doc = document.scrollingElement || document.documentElement;
          return { h: doc.scrollHeight, top: doc.scrollTop, n: document.querySelectorAll('[role="listitem"],[role="article"],[role="row"],tr,li,[data-id],[data-index]').length };
        });
        let grew = 0, lastH = 0, lastCount = 0;
        for (let i = 0; i < maxIters; i++) {
          if (Date.now() - scrollStart > SCROLL_BUDGET_MS) break;
          const before = await measure().catch(() => null);
          if (!before) break;
          await page.evaluate(() => {
            const d = document.scrollingElement || document.documentElement;
            d.scrollTo(0, d.scrollHeight);
          }).catch(() => {
          });
          await waitForInteractionSettle(page, { maxWaitMs: 2e3 }).catch(() => {
          });
          const after = await measure().catch(() => null);
          if (!after) break;
          if (after.h <= before.h && after.n <= before.n) break;
          grew++;
          lastH = after.h;
          lastCount = after.n;
        }
        log2(`[Agent] scroll: ${grew} growth iteration(s) (h=${lastH}, items=${lastCount})`);
        return { outcome: grew > 0 ? "scrolled" : "scroll_noop", navigated: false };
      }
      case "note_url":
        return { outcome: "noted", navigated: false };
      case "done":
        return { outcome: "done", navigated: false };
    }
  } catch (e) {
    const msg = String(e?.message || e).slice(0, 200);
    log2(`[Agent] action failed: ${msg}`);
    return { outcome: `error: ${msg}`, navigated: false };
  }
}

// src/actuator.ts
var HYDRATION_PREDICATE = `() => document.querySelectorAll('a[href]:not([href="#"]):not([href^="javascript:"]), button:not([disabled]), input:not([type="hidden"]), [role="button"], [role="link"], [role="menuitem"]').length >= 8`;
var LocalActuator = class {
  constructor(page, context, opts) {
    this.page = page;
    this.context = context;
    this.opts = opts;
  }
  /** Cloud crawls capture main-doc status via their own page.on('response')
   *  listener, so the in-process actuator has nothing extra to report here
   *  (returning undefined preserves that path). Only the runner needs a live
   *  status source, which RemoteActuator supplies from the executor. */
  async httpStatus() {
    return void 0;
  }
  async act(action, interactables = []) {
    return executeAction(
      this.page,
      this.context,
      action,
      this.opts.credentials,
      this.opts.log,
      interactables,
      this.opts.navigationDelayMs ?? 0,
      this.opts.rateLimitDetector
    );
  }
  /** Propagates snapshot failures — call-sites keep their own .catch semantics
   *  (some fall back to a "(snapshot failed)" placeholder, some to null). */
  async observe() {
    const snap = await buildIndexedSnapshot(this.page);
    return {
      url: this.page.url(),
      title: await this.page.title().catch(() => ""),
      ...snap
    };
  }
  async screenshot() {
    return this.page.screenshot({ timeout: 15e3 }).catch(() => null);
  }
  url() {
    return this.page.url();
  }
  async visit(url) {
    await this.page.goto(url, { waitUntil: "commit", timeout: 6e4 });
    await waitForPageReady(this.page).catch(() => {
    });
    await this.page.waitForFunction(HYDRATION_PREDICATE, { timeout: 1e4 }).catch(() => {
    });
    return this.observe();
  }
  // Capability extensions — each wraps page/context VERBATIM (no behavior change).
  async evaluate(fn, arg) {
    return this.page.evaluate(fn, arg);
  }
  async waitForFunction(fn, arg, timeoutMs = 1e4) {
    await this.page.waitForFunction(fn, arg, { timeout: timeoutMs });
  }
  async pressKey(key) {
    await this.page.keyboard.press(key);
  }
  async cookies() {
    return this.context.cookies();
  }
  async addInitScript(script) {
    await this.context.addInitScript(script);
  }
  async goto(url, opts) {
    await this.page.goto(url, opts);
  }
  async settle(kind, opts) {
    if (kind === "ready") await waitForPageReady(this.page, opts);
    else if (kind === "dom") await waitForDomStability(this.page, opts);
    else await waitForInteractionSettle(this.page, opts);
  }
  async ariaSnapshot() {
    return await this.page.locator("body").ariaSnapshot() || "";
  }
  async title() {
    return this.page.title();
  }
  async fillLogin(submitText) {
    const c = this.opts.credentials;
    if (!c?.username || !c?.password) return { outcome: "no_local_credentials" };
    try {
      const pw = this.page.locator('input[type="password"]').first();
      if (!await pw.count()) return { outcome: "no_login_form" };
      const user = this.page.locator('input[type="email"], input[type="text"], input:not([type])').first();
      if (await user.count()) await user.fill(c.username, { timeout: 5e3 });
      await pw.fill(c.password, { timeout: 5e3 });
      let submitted = false;
      if (submitText && !/google|github|facebook|microsoft|apple|continue with/i.test(submitText)) {
        try {
          await this.page.getByRole("button", { name: submitText, exact: false }).filter({ visible: true }).first().click({ timeout: 3e3 });
          submitted = true;
        } catch {
        }
      }
      if (!submitted) {
        try {
          await pw.press("Enter");
          submitted = true;
        } catch {
        }
      }
      return { outcome: submitted ? "submitted" : "filled" };
    } catch (e) {
      return { outcome: `fill_failed: ${e?.message ?? e}` };
    }
  }
  async captureScreenshotKey() {
    return null;
  }
  async isAlive() {
    return !this.page.isClosed();
  }
  isLocal() {
    return true;
  }
  localPage() {
    return this.page;
  }
  localContext() {
    return this.context;
  }
};

// src/runnerExecutor.ts
var API = (process.env.AEGIS_API || "https://app.aegisrunner.com/api/v1").replace(/\/+$/, "");
var CI_TOKEN = process.env.AEGIS_TOKEN || "";
var POLL_BATCH = 8;
var log = (m) => console.log(`  \u25C6 aegis-runner  ${m}`);
function ciHeaders() {
  return { Authorization: `Bearer ${CI_TOKEN}` };
}
function redactSelectors() {
  return (process.env.AEGIS_REDACT_SELECTORS || "").split(",").map((s) => s.trim()).filter(Boolean);
}
async function applyScreenshotRedactions(page) {
  const sels = redactSelectors();
  if (!sels.length) return { applied: [], undo: async () => {
  } };
  const css = sels.map((s) => `${s}{visibility:hidden !important}`).join("\n");
  try {
    const handle = await page.addStyleTag({ content: css });
    return {
      applied: sels,
      undo: async () => {
        await handle.evaluate((el) => el.remove()).catch(() => {
        });
      }
    };
  } catch {
    return { applied: [], undo: async () => {
    } };
  }
}
async function uploadScreenshot(page, sessionId, ars) {
  const { applied, undo } = await applyScreenshotRedactions(page);
  try {
    const png = await page.screenshot({ timeout: 15e3 }).catch(() => null);
    if (!png) return { key: null, redactions: applied };
    const pr = await fetch(`${API}/runner-scan/${sessionId}/screenshot-url`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ars}` },
      body: "{}"
    });
    if (!pr.ok) return { key: null, redactions: applied };
    const { uploadUrl, key } = await pr.json();
    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: new Uint8Array(png),
      signal: AbortSignal.timeout(3e4)
    });
    return { key: put.ok ? key : null, redactions: applied };
  } finally {
    await undo();
  }
}
async function fillLogin(page, submitText) {
  const username = process.env.AEGIS_USERNAME || "";
  const password = process.env.AEGIS_PASSWORD || "";
  if (!username || !password) return "no_local_credentials";
  try {
    const pw = page.locator('input[type="password"]').first();
    if (!await pw.count()) return "no_login_form";
    const user = page.locator('input[type="email"], input[type="text"], input:not([type])').first();
    if (await user.count()) await user.fill(username, { timeout: 5e3 });
    await pw.fill(password, { timeout: 5e3 });
    let submitted = false;
    if (submitText && !/google|github|facebook|microsoft|apple|continue with/i.test(submitText)) {
      try {
        await page.getByRole("button", { name: submitText, exact: false }).filter({ visible: true }).first().click({ timeout: 3e3 });
        submitted = true;
      } catch {
      }
    }
    if (!submitted) {
      try {
        await pw.press("Enter");
        submitted = true;
      } catch {
      }
    }
    return submitted ? "submitted" : "filled";
  } catch (e) {
    return `fill_failed: ${e?.message ?? e}`;
  }
}
async function runSession(job) {
  const ars = job.token;
  const sid = job.sessionId;
  log(`session ${sid} claimed \u2014 launching local browser for ${job.startUrl}`);
  let browser = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const navStatus = /* @__PURE__ */ new Map();
    page.on("response", (r) => {
      try {
        const req = r.request();
        if (req.isNavigationRequest() && req.frame() === page.mainFrame()) navStatus.set(r.url(), r.status());
      } catch {
      }
    });
    const actuator = new LocalActuator(page, context, {
      credentials: process.env.AEGIS_USERNAME && process.env.AEGIS_PASSWORD ? { username: process.env.AEGIS_USERNAME, password: process.env.AEGIS_PASSWORD } : void 0,
      log: (m) => log(`    ${m}`)
    });
    let lastInteractables = [];
    poll: for (; ; ) {
      let res;
      try {
        res = await fetch(`${API}/runner-scan/${sid}/actions?batch=${POLL_BATCH}`, {
          headers: { Authorization: `Bearer ${ars}` },
          signal: AbortSignal.timeout(3e4)
        });
      } catch {
        await new Promise((r) => setTimeout(r, 1e3));
        continue;
      }
      if (res.status === 204) continue;
      if (res.status === 401 || res.status === 410 || res.status === 404) {
        log(`session ${sid} ended by the cloud (${res.status})`);
        break;
      }
      if (!res.ok) {
        await new Promise((r) => setTimeout(r, 1e3));
        continue;
      }
      let frames;
      try {
        const j = await res.json();
        frames = Array.isArray(j) ? j : [j];
      } catch {
        continue;
      }
      for (const frame of frames) {
        const a = frame.action || {};
        let observation;
        try {
          switch (a.kind) {
            case "act": {
              const r = await actuator.act(a.action, lastInteractables);
              observation = { ...r, url: page.url() };
              break;
            }
            case "observe": {
              try {
                const obs = await actuator.observe();
                lastInteractables = obs.interactables;
                observation = obs;
              } catch (e) {
                observation = { error: `snapshot_failed: ${e?.message ?? e}`, url: page.url() };
                break;
              }
              if (a.screenshot) {
                const shot = await uploadScreenshot(page, sid, ars);
                observation.screenshotKey = shot.key;
                observation.redactions = shot.redactions;
              }
              break;
            }
            case "visit": {
              try {
                const obs = await actuator.visit(String(a.url));
                lastInteractables = obs.interactables;
                observation = obs;
              } catch (e) {
                observation = { error: `visit_failed: ${e?.message ?? e}`, url: page.url() };
                break;
              }
              if (a.screenshot) {
                const shot = await uploadScreenshot(page, sid, ars);
                observation.screenshotKey = shot.key;
                observation.redactions = shot.redactions;
              }
              break;
            }
            case "fill_login": {
              observation = { outcome: await fillLogin(page, a.submitText), url: page.url() };
              break;
            }
            case "evaluate": {
              const result = await page.evaluate(
                ({ fn, arg }) => {
                  const f = (0, eval)("(" + fn + ")");
                  return f(arg);
                },
                { fn: String(a.fn), arg: a.arg }
              );
              observation = { result };
              break;
            }
            case "waitForFunction": {
              await page.waitForFunction(
                ({ fn, arg }) => {
                  const f = (0, eval)("(" + fn + ")");
                  return f(arg);
                },
                { fn: String(a.fn), arg: a.arg },
                { timeout: Number(a.timeoutMs) || 1e4 }
              );
              observation = { ok: true };
              break;
            }
            case "press_key": {
              await page.keyboard.press(String(a.key));
              observation = { ok: true, url: page.url() };
              break;
            }
            case "cookies": {
              observation = { cookies: await context.cookies() };
              break;
            }
            case "add_init_script": {
              await context.addInitScript({ content: String(a.content) });
              observation = { ok: true };
              break;
            }
            case "is_alive": {
              observation = { alive: !page.isClosed() };
              break;
            }
            case "aria_snapshot": {
              observation = { snapshot: await page.locator("body").ariaSnapshot().catch(() => "") || "" };
              break;
            }
            case "title": {
              observation = { title: await page.title().catch(() => "") };
              break;
            }
            case "http_status": {
              observation = { status: navStatus.get(page.url()) };
              break;
            }
            case "screenshot": {
              const shot = await uploadScreenshot(page, sid, ars);
              observation = { screenshotKey: shot.key, redactions: shot.redactions };
              break;
            }
            case "goto": {
              await page.goto(String(a.url), a.opts);
              observation = { ok: true, url: page.url() };
              break;
            }
            case "settle": {
              const k = String(a.settleKind);
              const o = a.opts;
              if (k === "ready") await waitForPageReady(page, o);
              else if (k === "dom") await waitForDomStability(page, o);
              else await waitForInteractionSettle(page, o);
              observation = { ok: true };
              break;
            }
            case "close": {
              observation = { ok: true };
              await postObservation(sid, ars, frame.actionId, observation);
              log(`session ${sid} closed by the brain (${a.reason || "done"})`);
              break poll;
            }
            default:
              observation = { error: `unknown action kind: ${a.kind}` };
          }
        } catch (e) {
          observation = { error: `executor_error: ${e?.message ?? e}`, url: page.url() };
        }
        await postObservation(sid, ars, frame.actionId, observation);
      }
    }
    await fetch(`${API}/runner-scan/${sid}/complete`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ars}` },
      body: "{}"
    }).catch(() => {
    });
  } finally {
    await browser?.close().catch(() => {
    });
  }
}
async function postObservation(sid, ars, actionId, observation) {
  await fetch(`${API}/runner-scan/${sid}/observation`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ars}`, "Content-Type": "application/json" },
    body: JSON.stringify({ actionId, observation })
  }).catch((e) => log(`! observation post failed: ${e?.message ?? e}`));
}
async function main() {
  if (!CI_TOKEN) {
    console.error("AEGIS_TOKEN is required (a CI trigger token from Manage \u2192 CI/CD).");
    process.exit(1);
  }
  log(`scan executor online \u2014 polling ${API} for scan sessions (outbound only)`);
  for (; ; ) {
    let res;
    try {
      res = await fetch(`${API}/runner/scan-jobs/next`, { headers: ciHeaders(), signal: AbortSignal.timeout(3e4) });
    } catch {
      await new Promise((r) => setTimeout(r, 2e3));
      continue;
    }
    if (res.status === 401) {
      console.error("Enrollment token rejected \u2014 check AEGIS_TOKEN.");
      process.exit(1);
    }
    if (res.status !== 200) continue;
    let job;
    try {
      job = await res.json();
    } catch {
      continue;
    }
    if (!job?.sessionId || !job?.token) continue;
    try {
      await runSession(job);
    } catch (e) {
      log(`! session ${job.sessionId} crashed: ${e?.message ?? e}`);
    }
    log("session finished \u2014 back to waiting for the next scan");
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
