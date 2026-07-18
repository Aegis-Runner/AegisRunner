// src/runnerExecutor.ts
import { chromium as chromium2 } from "playwright";

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

// src/runnerRunExecutor.ts
import { chromium } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// src/runEngine.ts
import fs2 from "fs";
import path2 from "path";
import { AxeBuilder } from "@axe-core/playwright";

// src/v2/utils/url.ts
import { URL as URL2 } from "url";
import { isIP } from "net";
function isPrivateOrReservedIP(ip) {
  const lowerRaw = ip.toLowerCase();
  if (lowerRaw.includes("::ffff:") || lowerRaw.startsWith("::")) {
    return true;
  }
  const ipVersion = isIP(ip);
  if (ipVersion === 4) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (a === 127) return true;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 0 || a === 255 && b === 255) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (ipVersion === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1") return true;
    if (lower.startsWith("fe80:")) return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    if (lower.startsWith("::ffff:")) return true;
    return false;
  }
  return false;
}
function isSSRFTarget(url) {
  try {
    const urlObj = new URL2(url);
    const hostname = urlObj.hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "localhost.localdomain") {
      return true;
    }
    if (hostname.endsWith(".local") || hostname.endsWith(".internal")) {
      return true;
    }
    const internalHostnames = [
      "metadata",
      "metadata.google.internal",
      "instance-data",
      "kubernetes",
      "kubernetes.default",
      "docker",
      "host.docker.internal",
      "aegis_backend",
      "aegis_postgres",
      "aegis_redis",
      "aegis_crawler",
      "aegis_crawler-scan",
      "aegis_crawler-scan-lb",
      "aegis_classifier",
      "aegis_admin",
      "aegis_frontend",
      "aegis_frontend_dev",
      "aegis_mobile-runner",
      "pgbouncer",
      "mobile-runner",
      "redis",
      "postgres",
      "backend",
      "crawler"
    ];
    if (internalHostnames.includes(hostname)) {
      return true;
    }
    const bareHost = hostname.replace(/^\[/, "").replace(/\]$/, "");
    if (isIP(bareHost)) {
      return isPrivateOrReservedIP(bareHost);
    }
    if (/^\d+$/.test(bareHost)) {
      const decimal = parseInt(bareHost, 10);
      if (decimal > 0 && decimal <= 4294967295) {
        const ip = [
          decimal >>> 24 & 255,
          decimal >>> 16 & 255,
          decimal >>> 8 & 255,
          decimal & 255
        ].join(".");
        return isPrivateOrReservedIP(ip);
      }
    }
    return false;
  } catch {
    return true;
  }
}

// src/shared/visual-baseline.ts
import fs from "node:fs";
import path from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import sharp from "sharp";
var _readPrivateBaselineBytes = async () => null;
async function readBaselineBytes(url) {
  const priv = await _readPrivateBaselineBytes(url);
  if (priv) return priv;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download approved baseline (${response.status} ${response.statusText})`);
  }
  return Buffer.from(await response.arrayBuffer());
}
var VISUAL_STATUS_SENTINELS = {
  missing_baseline: -1,
  compare_error: -2,
  approved_change: -3
};
function normalizeVisualDiffThresholdPercent(threshold, fallback = 10) {
  if (!Number.isFinite(threshold) || threshold <= 0) {
    return fallback;
  }
  return threshold <= 1 ? threshold * 100 : threshold;
}
async function materializeApprovedBaselineFile(baselinePath, baselineUrl) {
  if (fs.existsSync(baselinePath)) {
    return true;
  }
  if (!baselineUrl) {
    return false;
  }
  const buf = await readBaselineBytes(baselineUrl);
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.writeFileSync(baselinePath, buf);
  return true;
}
async function compareVisualArtifacts(options) {
  const {
    baselinePath,
    currentPath,
    diffPath,
    thresholdPercent = 10,
    baselineUrl,
    statusIfMatch = "matched"
  } = options;
  try {
    const baselineReady = await materializeApprovedBaselineFile(baselinePath, baselineUrl);
    if (!baselineReady || !fs.existsSync(baselinePath)) {
      return {
        match: false,
        diffPercentage: VISUAL_STATUS_SENTINELS.missing_baseline,
        status: "missing_baseline",
        baselinePath,
        currentPath,
        error: "No approved visual baseline found for this target"
      };
    }
    const baselineImg = PNG.sync.read(fs.readFileSync(baselinePath));
    const currentImg = PNG.sync.read(fs.readFileSync(currentPath));
    let currentData = currentImg.data;
    const width = baselineImg.width;
    const height = baselineImg.height;
    if (baselineImg.width !== currentImg.width || baselineImg.height !== currentImg.height) {
      const resizedBuf = await sharp(fs.readFileSync(currentPath)).resize(baselineImg.width, baselineImg.height, { fit: "fill" }).png().toBuffer();
      currentData = PNG.sync.read(resizedBuf).data;
    }
    const diffImg = new PNG({ width, height });
    const diffPixels = pixelmatch(
      baselineImg.data,
      currentData,
      diffImg.data,
      width,
      height,
      { threshold: 0.1 }
    );
    const totalPixels = width * height;
    const diffPercentage = diffPixels / totalPixels * 100;
    const match = diffPercentage <= normalizeVisualDiffThresholdPercent(thresholdPercent);
    if (!match && diffPath) {
      fs.mkdirSync(path.dirname(diffPath), { recursive: true });
      fs.writeFileSync(diffPath, PNG.sync.write(diffImg));
    }
    return {
      match,
      diffPercentage: Number(diffPercentage.toFixed(2)),
      status: match ? statusIfMatch : "different",
      diffImagePath: match ? void 0 : diffPath,
      baselinePath,
      currentPath
    };
  } catch (error) {
    return {
      match: false,
      diffPercentage: VISUAL_STATUS_SENTINELS.compare_error,
      status: "compare_error",
      baselinePath,
      currentPath,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// src/config.ts
var CONFIG = {
  maxRetries: 2,
  // Retry failed steps up to 2 times
  retryDelay: 500,
  // Delay between retries in ms
  screenshotQuality: 80,
  videoEnabled: true,
  parallelLimit: 4
  // Max parallel test cases
};

// src/browserHelpers.ts
import { lookup as dnsLookup } from "node:dns/promises";
var resolveLocatorViaAI = async () => null;
var _uploadArtifact = async () => null;
function uploadArtifact(localPath, s3Key, contentType) {
  return _uploadArtifact(localPath, s3Key, contentType);
}
async function ssrfSafeFetch(rawUrl, opts, maxRedirects = 3) {
  let url = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (isSSRFTarget(url)) throw new Error(`Blocked api-request to an internal/reserved address: ${url}`);
    let host = "";
    try {
      host = new URL(url).hostname.replace(/^\[|\]$/g, "");
    } catch {
      throw new Error(`Invalid api-request URL: ${url}`);
    }
    try {
      const addrs = await dnsLookup(host, { all: true });
      for (const a of addrs) {
        if (isPrivateOrReservedIP(a.address)) throw new Error(`Blocked api-request: ${url} resolves to internal/reserved IP ${a.address}`);
      }
    } catch (e) {
      if (/Blocked api-request/.test(e?.message || "")) throw e;
    }
    const resp = await fetch(url, { ...opts, redirect: "manual" });
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get("location");
      if (!loc) return resp;
      try {
        url = new URL(loc, url).toString();
      } catch {
        throw new Error(`api-request redirect to invalid URL: ${loc}`);
      }
      continue;
    }
    return resp;
  }
  throw new Error("api-request exceeded max redirects");
}
var APP_URL = process.env.APP_PUBLIC_URL || "https://app.aegisrunner.com";
var LOGIN_PAGE_HINT_PATTERNS = ["/login", "/auth/login", "/signin", "/auth/signin", "/sign-in", "/account/login", "/auth/sign-in"];
function urlLooksLikeLoginPath(url) {
  if (typeof url !== "string") return false;
  return LOGIN_PAGE_HINT_PATTERNS.some((pattern) => url.includes(pattern));
}
function isLoginPageUrl(url) {
  return urlLooksLikeLoginPath(url);
}
function loginNameToken(selector) {
  if (!selector || typeof selector !== "string") return "";
  const m = selector.match(/name=(?:"([^"]+)"|'([^']+)'|\/(.+?)\/[a-z]*)/i);
  let raw = (m ? m[1] || m[2] || m[3] || "" : "").trim();
  raw = raw.replace(/\\s\+/g, "").replace(/\\(.)/g, "$1");
  return raw.toLowerCase().replace(/\s+/g, "");
}
function isLoginCredentialSelector(selector) {
  return /^(username|user|userid|user_name|email|e-mail|password|passwd|pass|login)$/.test(loginNameToken(selector));
}
function isLoginSubmitSelectorStep(selector) {
  if (/^(login|signin|logon|submit|continue)$/.test(loginNameToken(selector))) return true;
  return selectorSignalsLoginSubmit(selector);
}
function selectorSignalsLoginSubmit(selector) {
  if (!selector) return false;
  const s = selector.toLowerCase();
  return /sign[\s_-]*in|log[\s_-]*in|\bsignin\b|\blogon\b|\blogin\b|log[\s_-]*on/.test(s);
}
async function pageLooksLikeLoginWall(page, intendedUrl) {
  try {
    const currentUrl = page.url();
    let redirected = false;
    if (intendedUrl) {
      try {
        const a = new URL(intendedUrl);
        const b = new URL(currentUrl);
        const norm = (u) => `${u.origin}${u.pathname.replace(/\/+$/, "")}${u.search}`;
        redirected = norm(a) !== norm(b);
      } catch {
        redirected = intendedUrl !== currentUrl;
      }
    }
    const hasPasswordInput = await page.evaluate(
      () => document.querySelector('input[type="password"]') !== null
    );
    if (redirected && hasPasswordInput) return true;
    if (!intendedUrl && hasPasswordInput && urlLooksLikeLoginPath(currentUrl)) return true;
    return false;
  } catch {
    return false;
  }
}
function isLoginSubmitSelector(selector) {
  if (!selector) return false;
  const lower = selector.toLowerCase();
  if (selectorSignalsLoginSubmit(lower)) return true;
  if (!lower.includes("button")) return false;
  return /\bsubmit\b|\bcontinue\b/.test(lower);
}
async function handleAutoLogin(page, credentials, intendedUrl) {
  const currentUrl = page.url();
  if (!await pageLooksLikeLoginWall(page, intendedUrl)) {
    return false;
  }
  if (intendedUrl && urlLooksLikeLoginPath(intendedUrl)) {
    logger.info(`[Test] Intentional login page navigation to ${currentUrl}, skipping auto-login`);
    return false;
  }
  logger.info(`[Test] Detected redirect to login page: ${currentUrl} (intended: ${intendedUrl || "initial navigation"})`);
  try {
    if (credentials?.username || credentials?.password) {
      logger.info(`[Test] Filling login form with provided credentials...`);
      const usernameSelectors = [
        "#email",
        "#username",
        'input[type="email"]',
        'input[name="email"]',
        'input[name="username"]',
        'input[placeholder*="email" i]',
        'input[placeholder*="username" i]',
        'input[autocomplete="email"]',
        'input[autocomplete="username"]'
      ];
      const passwordSelectors = [
        "#password",
        'input[type="password"]',
        'input[name="password"]',
        'input[autocomplete="current-password"]'
      ];
      if (credentials.username) {
        for (const selector of usernameSelectors) {
          try {
            const field = page.locator(selector).first();
            if (await field.isVisible({ timeout: 500 })) {
              await field.clear();
              await field.fill(credentials.username);
              logger.info(`[Test] Filled username field: ${selector}`);
              break;
            }
          } catch {
          }
        }
      }
      if (credentials.password) {
        for (const selector of passwordSelectors) {
          try {
            const field = page.locator(selector).first();
            if (await field.isVisible({ timeout: 500 })) {
              await field.clear();
              await field.fill(credentials.password);
              logger.info(`[Test] Filled password field: ${selector}`);
              break;
            }
          } catch {
          }
        }
      }
    } else {
      logger.info(`[Test] No credentials provided, checking for prefilled values...`);
      const prefilledValues = await page.evaluate(() => {
        const emailField = document.querySelector('input[type="email"], input[name="email"], input[id="email"], input[name="username"], input[id="username"]');
        const passwordField = document.querySelector('input[type="password"]');
        return {
          hasEmail: emailField ? emailField.value.length > 0 : false,
          hasPassword: passwordField ? passwordField.value.length > 0 : false,
          email: emailField?.value || "",
          password: passwordField?.value ? "***" : ""
        };
      });
      if (!prefilledValues.hasEmail || !prefilledValues.hasPassword) {
        logger.info(`[Test] Form fields not prefilled (email: ${prefilledValues.hasEmail}, password: ${prefilledValues.hasPassword}), skipping auto-login`);
        return false;
      }
      logger.info(`[Test] Found prefilled values (email: ${prefilledValues.email}), proceeding with auto-login...`);
    }
    const signInButtons = [
      'button:has-text("Sign In")',
      'button:has-text("Sign in")',
      'button:has-text("Login")',
      'button:has-text("Log In")',
      'button:has-text("Log in")',
      'button:has-text("Continue")',
      'button[type="submit"]',
      'input[type="submit"]'
    ];
    for (const selector of signInButtons) {
      try {
        const button = page.locator(selector).first();
        if (await button.isVisible({ timeout: 1e3 })) {
          logger.info(`[Test] Found login button: ${selector}, submitting...`);
          await button.click();
          await waitForPendingAPITest(page, 1e4);
          await waitForInteractionSettle2(page, 3e3);
          const newUrl = page.url();
          if (!isLoginPageUrl(newUrl)) {
            logger.info(`[Test] Auto-login successful! Now at: ${newUrl}`);
            if (intendedUrl && !isLoginPageUrl(intendedUrl)) {
              try {
                const intendedPath = new URL(intendedUrl).pathname;
                const currentPath = new URL(newUrl).pathname;
                if (intendedPath !== currentPath) {
                  logger.info(`[Test] Re-navigating to intended URL after login: ${intendedUrl}`);
                  await page.goto(intendedUrl, { waitUntil: "domcontentloaded", timeout: 15e3 });
                  await waitForInteractionSettle2(page, 2e3);
                }
              } catch (navErr) {
                logger.info(`[Test] Post-login re-navigate failed: ${navErr}`);
              }
            }
            return true;
          } else {
            logger.info(`[Test] Auto-login attempted but still on login page: ${newUrl}`);
          }
          break;
        }
      } catch {
      }
    }
  } catch (err) {
    logger.info(`[Test] Auto-login error: ${err}`);
  }
  return false;
}
function isConsentDismissTarget(t) {
  const s = (t || "").toLowerCase();
  if (!s) return false;
  if (/accept\s*all|reject\s*all|allow\s*all|i\s*agree|agree\s*(&|and)\s*continue|accept\s*(all\s*)?cookies|got\s*it/.test(s)) return true;
  return /cookie|consent|gdpr/.test(s) && /accept|agree|allow|dismiss|reject|close|ok\b/.test(s);
}
async function dismissCookieConsent(page) {
  const dismissSelectors = [
    // ID-based patterns (common convention)
    '#cookie-banner button:has-text("Reject All")',
    '#cookie-banner button:has-text("Accept All")',
    '#cookie-banner button:has-text("Accept")',
    // Class-based patterns
    '[class*="cookie-banner"] button:has-text("Reject All")',
    '[class*="cookie-banner"] button:has-text("Accept All")',
    '[class*="cookie-banner"] button:has-text("Accept")',
    '[class*="cookie-consent"] button:has-text("Reject All")',
    '[class*="cookie-consent"] button:has-text("Accept All")',
    '[class*="cookie-consent"] button:has-text("Accept")',
    '[class*="gdpr"] button:has-text("Accept")',
    // Common third-party cookie consent libraries
    "#onetrust-accept-btn-handler",
    "#onetrust-reject-all-handler",
    ".cc-accept",
    ".cc-dismiss",
    "#cookiescript_accept",
    "#truste-consent-button",
    // Generic patterns — English
    'button:has-text("Accept cookies")',
    'button:has-text("Accept all")',
    'button:has-text("I agree")',
    'button:has-text("Got it")',
    'button:has-text("OK")',
    // German
    'button:has-text("Akzeptieren")',
    'button:has-text("Alle akzeptieren")',
    'button:has-text("Zustimmen")',
    'button:has-text("Einverstanden")',
    // Spanish
    'button:has-text("Aceptar")',
    'button:has-text("Aceptar todo")',
    'button:has-text("De acuerdo")',
    // French
    'button:has-text("Accepter")',
    'button:has-text("Tout accepter")',
    `button:has-text("J'accepte")`,
    `button:has-text("D'accord")`,
    // Italian / Portuguese
    'button:has-text("Accetta")',
    'button:has-text("Accetta tutti")',
    'button:has-text("Aceitar")',
    'button:has-text("Aceitar todos")',
    // Japanese / Chinese
    'button:has-text("\u540C\u610F")',
    'button:has-text("\u540C\u610F\u3059\u308B")',
    'button:has-text("\u63A5\u53D7")',
    'button:has-text("\u63A5\u53D7\u6240\u6709")',
    'button:has-text("\u78BA\u5B9A")',
    '[data-testid*="cookie"] button',
    '[aria-label*="cookie"] button'
  ];
  for (const selector of dismissSelectors) {
    try {
      const element = page.locator(selector).first();
      if (await element.isVisible({ timeout: 500 })) {
        logger.info(`[Test] Dismissing cookie consent with: ${selector}`);
        await element.click({ timeout: 2e3 });
        await element.waitFor({ state: "hidden", timeout: 2e3 }).catch(() => waitForInteractionSettle2(page, 1500));
        return true;
      }
    } catch {
    }
  }
  return false;
}
function sanitizeSelector(selector, allowNonInteractable = false) {
  if (!selector || typeof selector !== "string") {
    throw new Error("Invalid selector: selector is empty or not a string");
  }
  let sanitized = selector.trim();
  if (sanitized === "" || sanitized === '""' || sanitized === "''") {
    throw new Error("Invalid selector: selector is empty");
  }
  const ariaSnapMatch = sanitized.match(/^([a-z]+)\s+"([^"]+)"$/i);
  if (ariaSnapMatch && KNOWN_ARIA_ROLES.has(ariaSnapMatch[1].toLowerCase())) {
    sanitized = `role=${ariaSnapMatch[1].toLowerCase()}[name="${ariaSnapMatch[2]}"]`;
  }
  if (!allowNonInteractable) {
    const nonInteractable = ["title", "meta", "script", "style", "head", "link", "noscript"];
    const lowerSelector = sanitized.toLowerCase();
    for (const tag of nonInteractable) {
      const tagPattern = new RegExp(`^${tag}(\\s|>|\\[|$)`);
      if (tagPattern.test(lowerSelector)) {
        throw new Error(`Invalid selector: "${tag}" elements are not interactable - use assertions instead of actions`);
      }
    }
  }
  const tailwindPattern = /\.([a-z0-9]+):([a-z0-9-/]+)/gi;
  sanitized = sanitized.replace(tailwindPattern, (match, prefix2, suffix) => {
    if (match.includes("\\:")) return match;
    return `.${prefix2}\\:${suffix}`;
  });
  const attrPattern = /\[class[*~|^$]?=["']([^"']*?)["']\]/gi;
  sanitized = sanitized.replace(attrPattern, (match, classValue) => {
    const escapedValue = classValue.replace(/(?<!\\):/g, "\\:");
    return match.replace(classValue, escapedValue);
  });
  const elementClassPattern = /([a-z]+)\.([a-z0-9]+):([a-z0-9-]+)/gi;
  sanitized = sanitized.replace(elementClassPattern, (match, element, prefix2, suffix) => {
    if (match.includes("\\:")) return match;
    return `${element}.${prefix2}\\:${suffix}`;
  });
  sanitized = sanitized.replace(/[\uFFFD\u0000-\u001F]/g, "");
  sanitized = sanitized.replace(/#(\d[a-zA-Z0-9_-]*)/g, '[id="$1"]');
  if (sanitized !== selector) {
    logger.info(`[Selector] Sanitized: "${selector}" \u2192 "${sanitized}"`);
  }
  return sanitized;
}
function extractCoreText(text) {
  const withoutEmojis = text.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F000}-\u{1F02F}]|[\u{1F0A0}-\u{1F0FF}]|[\u{1F100}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F910}-\u{1F96B}]|[\u{1F980}-\u{1F9E0}]/gu, "");
  return withoutEmojis.replace(/\s+/g, " ").trim();
}
function makeFlexibleTextSelector(selector) {
  const hasTextPattern = /:has-text\(["']([^"']+)["']\)/g;
  return selector.replace(hasTextPattern, (match, textContent) => {
    const coreText = extractCoreText(textContent);
    if (coreText && coreText !== textContent) {
      logger.info(`[Selector] Flexible text match: "${textContent}" \u2192 core text: "${coreText}"`);
      return `:has-text("${coreText}")`;
    }
    return match;
  });
}
async function structuralHeal(page, selector, altSelectors) {
  try {
    const rm2 = (selector || "").match(/role=(\w+)\[name=(?:"([^"]+)"|\/(.+?)\/[a-z]*)\]/);
    const alt = altSelectors || {};
    const sig = {
      role: rm2?.[1] || "",
      name: (rm2?.[2] || rm2?.[3] || "").replace(/\\s\+/g, " ").replace(/\\(.)/g, "$1"),
      id: String(alt.idSelector || "").replace(/^#/, ""),
      testId: alt.testId || "",
      nameAttr: (String(alt.nameSelector || "").match(/name="([^"]+)"/) || [])[1] || "",
      aria: alt.ariaLabel || "",
      label: alt.labelText || "",
      placeholder: (String(alt.placeholderSelector || "").match(/placeholder="([^"]+)"/) || [])[1] || ""
    };
    if (!sig.role && !sig.name && !sig.id && !sig.testId && !sig.nameAttr && !sig.aria && !sig.label && !sig.placeholder) return null;
    const score = await page.evaluate((s) => {
      try {
        document.querySelectorAll("[data-aegis-heal]").forEach((e) => e.removeAttribute("data-aegis-heal"));
      } catch {
      }
      const norm = (x) => (x || "").toString().toLowerCase().replace(/\s+/g, " ").trim();
      const toks = (x) => new Set(norm(x).split(" ").filter(Boolean));
      const overlap = (a, b) => {
        const A = toks(a), B = toks(b);
        if (!A.size || !B.size) return 0;
        let n = 0;
        A.forEach((t) => {
          if (B.has(t)) n++;
        });
        return n / Math.max(A.size, B.size);
      };
      const roleOf = (el) => el.getAttribute("role") || { A: "link", BUTTON: "button", TEXTAREA: "textbox", SELECT: "combobox", H1: "heading", H2: "heading", H3: "heading", H4: "heading" }[el.tagName] || (el.tagName === "INPUT" ? el.type === "checkbox" ? "checkbox" : el.type === "radio" ? "radio" : el.type === "button" || el.type === "submit" ? "button" : "textbox" : "");
      const accName = (el) => norm(el.getAttribute("aria-label") || el.getAttribute("placeholder") || (el.tagName === "INPUT" ? el.value : "") || el.textContent || "");
      const vis = (el) => {
        try {
          const r = el.getBoundingClientRect();
          const st = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
        } catch {
          return false;
        }
      };
      const cands = Array.from(document.querySelectorAll("a,button,input,textarea,select,summary,[role],[onclick],[tabindex]")).filter(vis);
      let best = null, bestScore = 0;
      for (const el of cands) {
        let sc = 0;
        if (s.id && el.id === s.id) sc += 5;
        if (s.testId && (el.getAttribute("data-testid") === s.testId || el.getAttribute("data-test") === s.testId)) sc += 5;
        if (s.nameAttr && el.getAttribute("name") === s.nameAttr) sc += 4;
        if (s.aria && norm(el.getAttribute("aria-label")) === norm(s.aria)) sc += 3;
        if (s.placeholder && norm(el.getAttribute("placeholder")) === norm(s.placeholder)) sc += 3;
        if (s.role && roleOf(el) === s.role) sc += 1.5;
        if (s.name) sc += 3 * overlap(s.name, accName(el));
        if (s.label) sc += 2 * overlap(s.label, accName(el));
        if (sc > bestScore) {
          bestScore = sc;
          best = el;
        }
      }
      if (best && bestScore >= 3) {
        try {
          best.setAttribute("data-aegis-heal", "1");
        } catch {
        }
        return bestScore;
      }
      return 0;
    }, sig);
    if (score && score >= 3) {
      const loc = page.locator('[data-aegis-heal="1"]');
      if (await loc.count().catch(() => 0) > 0) {
        logger.info(`[Selector] Structural heal matched "${selector}" (score=${score.toFixed?.(1) ?? score})`);
        return loc.first();
      }
    }
  } catch (e) {
    logger.info(`[Selector] Structural heal error: ${e?.message || e}`);
  }
  return null;
}
function rowScopedLocators(page, rt, act, actRe, includeAnyRowFallback = false) {
  const rowAncestorXpath = `xpath=ancestor-or-self::*[self::tr or self::li or @role="row" or @role="listitem" or contains(@class,"row") or contains(@class,"-tr") or contains(@class,"item")][1]`;
  const esc = act.replace(/"/g, '\\"');
  const actBtnInRow = (row) => row.getByRole("button", { name: actRe }).or(row.locator(`button[aria-label*="${esc}" i], a[aria-label*="${esc}" i], [role="button"][aria-label*="${esc}" i], button[title*="${esc}" i], a[title*="${esc}" i]`)).first();
  const anchored = [
    ["rowScoped(table)", () => actBtnInRow(page.getByRole("row").filter({ hasText: rt }).first())],
    ["rowScoped(near)", () => {
      const nearRow = page.getByText(rt, { exact: false }).first().locator(rowAncestorXpath);
      return nearRow.locator('button, a, [role="button"]').filter({ hasText: actRe }).or(nearRow.locator(`[aria-label*="${esc}" i], [title*="${esc}" i]`)).first();
    }]
  ];
  if (!includeAnyRowFallback) return anchored;
  return [
    ...anchored,
    ["rowScoped(firstByRole)", () => actBtnInRow(page.getByRole("row").filter({ has: page.getByRole("button", { name: actRe }) }).first())],
    ["rowScoped(firstAnyContainer)", () => {
      const rows = page.locator('tr, li, [role="row"], [role="listitem"]').filter({ has: page.locator(`button[aria-label*="${esc}" i], a[aria-label*="${esc}" i], button[title*="${esc}" i], button:has-text("${esc}")`) });
      return actBtnInRow(rows.first());
    }]
  ];
}
function intendedName(selector) {
  const s = String(selector || "").trim();
  let m;
  if (m = s.match(/^role=\w+\[name="([^"]+)"\]$/)) return m[1];
  if (m = s.match(/^role=\w+\[name=\/(.+?)\/[a-z]*\]$/)) return m[1].replace(/\\s\+/g, " ").replace(/\\(.)/g, "$1");
  if (m = s.match(/getBy(?:Role|Text|Label|Placeholder)\([^,]*?,?\s*\{?\s*name:\s*['"]([^'"]+)['"]/)) return m[1];
  if (m = s.match(/getByText\(\s*['"]([^'"]+)['"]/)) return m[1];
  if (m = s.match(/^[\w-]*\[(?:name|title|aria-label|placeholder)[*~|^$]?="([^"]+)"\]$/i)) return m[1];
  if (m = s.match(/(?::has-text|:text)\(\s*["']([^"']+)["']\s*\)/)) return m[1];
  if (m = s.match(/^(?:link|text|button|label|placeholder|alt|title|role)=["']?(.+?)["']?$/i)) return m[1];
  return null;
}
async function relaxByName(page, want) {
  const esc = want.replace(/"/g, '\\"');
  const ROLES = ["button", "link", "menuitem", "tab", "option", "checkbox", "radio", "textbox", "combobox"];
  const candidates = [
    ["text(exact)", () => page.getByText(want, { exact: true })],
    ["text(loose)", () => page.getByText(want, { exact: false })],
    ["title/aria/placeholder", () => page.locator(`[title*="${esc}" i], [aria-label*="${esc}" i], [placeholder*="${esc}" i]`)],
    ...ROLES.map((r) => [`role:${r}`, () => page.getByRole(r, { name: want, exact: false })])
  ];
  for (const [strat, build] of candidates) {
    let loc;
    try {
      loc = build();
    } catch {
      continue;
    }
    let n = 0;
    try {
      n = await loc.count();
    } catch {
      continue;
    }
    for (let i = 0; i < Math.min(n, 12); i++) {
      const el = loc.nth(i);
      if (await el.isVisible().catch(() => false)) {
        logger.info(`[Selector] role-agnostic relaxation hit via ${strat}: ${JSON.stringify(want)} [#${i}]`);
        try {
          await el.scrollIntoViewIfNeeded({ timeout: 2e3 });
        } catch {
        }
        return el;
      }
    }
  }
  return null;
}
async function getStrictLocator(page, selector, allowNonInteractable = false, altSelectors) {
  if (selector.startsWith("getBy")) {
    const resolved = resolvePlaywrightLocator(page, selector);
    if (resolved) {
      const resolvedCount = await resolved.count();
      if (resolvedCount === 1) {
        try {
          await resolved.scrollIntoViewIfNeeded({ timeout: 2e3 });
        } catch {
        }
        return resolved;
      }
      if (resolvedCount > 1) {
        return resolved.first();
      }
      return resolved;
    }
  }
  {
    const a = altSelectors;
    if (a && a.rowScopedText && a.rowScopedAction) {
      const rt = String(a.rowScopedText);
      const act = String(a.rowScopedAction);
      const actRe = new RegExp(act.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const tryRow = rowScopedLocators(page, rt, act, actRe);
      for (const [strategy, resolve] of tryRow) {
        try {
          const loc = resolve();
          if (!loc) continue;
          const c = await loc.count();
          if (c >= 1) {
            logger.info(`[Selector] row-scoped PRIORITY hit: "${strategy}" for row "${rt}" / action "${act}" (ignored volatile primary "${selector}")`);
            try {
              await loc.scrollIntoViewIfNeeded({ timeout: 2e3 });
            } catch {
            }
            return loc;
          }
        } catch {
        }
      }
      logger.info(`[Selector] row-scoped PRIORITY miss for row "${rt}" \u2014 falling through to primary/alt chain`);
    }
  }
  const flexibleSelector = makeFlexibleTextSelector(selector);
  const sanitizedSelector = sanitizeSelector(flexibleSelector, allowNonInteractable);
  let locator = page.locator(sanitizedSelector);
  let count = await retryOnContextLost(page, () => locator.count());
  if (count === 0 && flexibleSelector !== selector) {
    logger.info(`[Test] No elements found with flexible selector, trying original...`);
    const originalSanitized = sanitizeSelector(selector, allowNonInteractable);
    locator = page.locator(originalSanitized);
    count = await retryOnContextLost(page, () => locator.count());
  }
  const alt = altSelectors;
  if (count === 0 && altSelectors) {
    const fallbacks = [];
    if (alt.testId) fallbacks.push(["testId", () => page.locator(`[data-testid="${alt.testId}"]`)]);
    if (alt.idSelector) fallbacks.push(["id", () => page.locator(sanitizeSelector(alt.idSelector, allowNonInteractable))]);
    if (alt.nameSelector) fallbacks.push(["name", () => page.locator(sanitizeSelector(alt.nameSelector, allowNonInteractable))]);
    if (alt.ariaLabel) fallbacks.push(["ariaLabel", () => page.locator(`[aria-label="${alt.ariaLabel}"]`)]);
    if (alt.labelText) fallbacks.push(["label", () => page.getByLabel(alt.labelText, { exact: false })]);
    if (alt.placeholderSelector) fallbacks.push(["placeholder", () => page.locator(sanitizeSelector(alt.placeholderSelector, allowNonInteractable))]);
    if (alt.textSelector) fallbacks.push(["text", () => page.locator(alt.textSelector)]);
    if (alt.relativeXpath && alt.relativeXpath.includes(" >> xpath=")) {
      fallbacks.push(["relXpath", () => {
        const [anchorCss, rel] = alt.relativeXpath.split(" >> xpath=");
        try {
          return page.locator(anchorCss).locator(`xpath=${rel}`);
        } catch {
          return null;
        }
      }]);
    }
    if (alt.playwrightLocator) fallbacks.push(["playwright", () => alt.playwrightLocator.startsWith("getBy") ? resolvePlaywrightLocator(page, alt.playwrightLocator) : page.locator(sanitizeSelector(alt.playwrightLocator, allowNonInteractable))]);
    if (alt.xpath) fallbacks.push(["xpath(legacy)", () => page.locator(alt.xpath.includes(" > ") ? alt.xpath : `xpath=${alt.xpath}`)]);
    if (alt.listAnyMatch) fallbacks.push(["listAnyMatch", () => page.locator(alt.listAnyMatch)]);
    if (alt.rowScopedText && alt.rowScopedAction) {
      const rt = String(alt.rowScopedText);
      const act = String(alt.rowScopedAction);
      const actRe = new RegExp(act.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      for (const [s, r] of rowScopedLocators(page, rt, act, actRe, true)) fallbacks.push([s, r]);
    }
    for (const [strategy, resolve] of fallbacks) {
      try {
        const altLocator = resolve();
        if (!altLocator) continue;
        const altCount = await altLocator.count();
        if (altCount >= 1) {
          logger.info(`[Selector] Fallback SUCCESS: "${strategy}" found ${altCount} element(s) (primary "${selector}" failed)`);
          if (altCount === 1) {
            try {
              await altLocator.scrollIntoViewIfNeeded({ timeout: 2e3 });
            } catch {
            }
            return altLocator;
          }
          for (let i = 0; i < altCount; i++) {
            const el = altLocator.nth(i);
            if (await el.isVisible().catch(() => false)) {
              try {
                await el.scrollIntoViewIfNeeded({ timeout: 2e3 });
              } catch {
              }
              return el;
            }
          }
          return altLocator.first();
        }
      } catch (fallbackErr) {
        logger.info(`[Selector] Fallback "${strategy}" failed: ${fallbackErr?.message || fallbackErr}`);
      }
    }
  }
  if (count === 0) {
    const roleMatch = selector.match(/^role=(\w+)\[name=(?:"([^"]+)"|\/([^/]+)\/[a-z]*)\]$/);
    if (roleMatch) {
      const [, role, exactName, regexPattern] = roleMatch;
      const nameForLoose = exactName || (regexPattern ? regexPattern.replace(/\\s\+/g, " ").replace(/\\(.)/g, "$1") : "");
      if (nameForLoose) {
        const stripped = nameForLoose.replace(/^(my|view|all|add|edit|the)\s+/i, "").trim();
        const candidateNames = [nameForLoose, ...stripped && stripped !== nameForLoose ? [stripped] : []];
        for (const candName of candidateNames) {
          try {
            const looseLocator = page.getByRole(role, { name: candName, exact: false });
            const looseCount = await looseLocator.count();
            if (looseCount >= 1) {
              logger.info(`[Selector] Loose getByRole fallback SUCCESS: "${selector}" \u2192 getByRole("${role}", {name:"${candName}", exact:false})`);
              if (looseCount === 1) {
                try {
                  await looseLocator.scrollIntoViewIfNeeded({ timeout: 2e3 });
                } catch {
                }
                return looseLocator;
              }
              for (let i = 0; i < Math.min(looseCount, 10); i++) {
                const el = looseLocator.nth(i);
                if (await el.isVisible().catch(() => false)) {
                  try {
                    await el.scrollIntoViewIfNeeded({ timeout: 2e3 });
                  } catch {
                  }
                  return el;
                }
              }
              return looseLocator.first();
            }
          } catch (looseErr) {
            logger.info(`[Selector] Loose getByRole fallback failed for "${candName}": ${looseErr?.message || looseErr}`);
          }
        }
      }
    }
    if (!allowNonInteractable) {
      const want = intendedName(selector);
      if (want && want.length >= 2) {
        const relaxed = await relaxByName(page, want);
        if (relaxed) return relaxed;
      }
    }
    const structLoc = await structuralHeal(page, selector, altSelectors);
    if (structLoc) return structLoc;
    if (!allowNonInteractable) {
      const aiLoc = await resolveLocatorViaAI(page, selector);
      if (aiLoc) return aiLoc;
    }
    return locator;
  }
  if (count === 1) {
    try {
      await locator.scrollIntoViewIfNeeded({ timeout: 2e3 });
    } catch {
    }
    return locator;
  }
  logger.info(`[Test] Selector "${selector}" matched ${count} elements, looking for visible one...`);
  for (let i = 0; i < count; i++) {
    const element = locator.nth(i);
    try {
      await element.scrollIntoViewIfNeeded({ timeout: 2e3 });
      const isVisible = await element.isVisible();
      if (isVisible) {
        logger.info(`[Test] Found visible element at index ${i}`);
        return element;
      }
    } catch {
    }
  }
  logger.info(`[Test] WARNING: No visible elements found for "${selector}", using .first()`);
  return locator.first();
}
function resolvePlaywrightLocator(page, descriptor) {
  try {
    const match = descriptor.match(/^(getBy\w+)\((.+)\)$/s);
    if (!match) return null;
    const method = match[1];
    const argsStr = match[2].trim();
    const strMatch = argsStr.match(/^['"](.+?)['"]/);
    const regexMatch = !strMatch ? argsStr.match(/^\/(.+?)\/([gimsuy]*)/) : null;
    if (!strMatch && !regexMatch) return null;
    const firstArg = strMatch ? strMatch[1] : "";
    const firstArgRegex = regexMatch ? new RegExp(regexMatch[1], regexMatch[2]) : null;
    const optionsMatch = argsStr.match(/,\s*\{(.+)\}\s*$/s);
    let options;
    if (optionsMatch) {
      options = {};
      const pairs = optionsMatch[1].matchAll(/(\w+)\s*:\s*(?:'([^']*)'|"([^"]*)"|\/([^/]*)\/([gimsuy]*)|(\w+))/g);
      for (const p of pairs) {
        const key = p[1];
        if (p[4] !== void 0) {
          options[key] = new RegExp(p[4], p[5] || "");
        } else {
          const val = p[2] ?? p[3] ?? p[6];
          if (val === "true") options[key] = true;
          else if (val === "false") options[key] = false;
          else if (!isNaN(Number(val)) && val !== "") options[key] = Number(val);
          else options[key] = val;
        }
      }
    }
    const textArg = firstArgRegex || firstArg;
    switch (method) {
      case "getByRole":
        return options ? page.getByRole(firstArg, options) : page.getByRole(firstArg);
      case "getByTestId":
        return page.getByTestId(firstArg);
      case "getByLabel":
        return options ? page.getByLabel(textArg, options) : page.getByLabel(textArg);
      case "getByText":
        return options ? page.getByText(textArg, options) : page.getByText(textArg);
      case "getByPlaceholder":
        return options ? page.getByPlaceholder(textArg, options) : page.getByPlaceholder(textArg);
      case "getByAltText":
        return options ? page.getByAltText(textArg, options) : page.getByAltText(textArg);
      case "getByTitle":
        return options ? page.getByTitle(textArg, options) : page.getByTitle(textArg);
      default:
        return null;
    }
  } catch {
    return null;
  }
}
async function waitForPageReady2(page, timeout = 5e3) {
  await waitForPageReady(page, {
    maxWaitMs: timeout,
    idleMs: Math.min(1200, Math.max(300, Math.floor(timeout / 2))),
    apiTimeoutMs: Math.min(timeout, 1500)
  });
}
async function waitForPendingAPITest(page, timeout = 8e3) {
  await waitForPendingAPIQuiet(page, timeout);
}
async function waitForDOMStable(page, timeout = 3e3) {
  await waitForDomStability(page, {
    maxWaitMs: timeout,
    idleMs: Math.min(1200, Math.max(300, Math.floor(timeout / 2)))
  });
}
async function waitForSPAReady(page) {
  const t0 = Date.now();
  await waitForPendingAPITest(page, 1e4);
  await waitForDOMStable(page, 3e3);
  await waitForPageReady2(page, 3e3);
  try {
    const settleMs = Date.now() - t0;
    const factor = Math.min(5, Math.max(1, settleMs / 1500));
    const prev = page.__aegisSlowFactor || 1;
    page.__aegisSlowFactor = Math.max(prev, factor);
  } catch {
  }
}
function adaptiveActionTimeout(page, baseMs) {
  const factor = page.__aegisSlowFactor || 1;
  return Math.round(baseMs * factor);
}
async function settleQuiet(page, cap = 2e3) {
  await page.waitForLoadState("domcontentloaded", { timeout: cap }).catch(() => {
  });
  await waitForPendingAPITest(page, cap).catch(() => {
  });
}
async function waitForInteractionSettle2(page, timeout = 2500) {
  await page.waitForLoadState("domcontentloaded", { timeout }).catch(() => {
  });
  await waitForPendingAPITest(page, timeout);
  await waitForInteractionSettle(page, {
    maxWaitMs: timeout,
    idleMs: Math.min(1e3, Math.max(300, Math.floor(timeout / 2))),
    apiTimeoutMs: timeout
  });
  await waitForPageReady2(page, timeout);
}
async function retryOnContextLost(page, fn, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      const m = String(e?.message || e).toLowerCase();
      const transient = (m.includes("execution context was destroyed") || m.includes("context was destroyed")) && !m.includes("has been closed") && !m.includes("target closed") && !m.includes("target page");
      if (!transient || i === attempts - 1) throw e;
      lastErr = e;
      await waitForSPAReady(page).catch(() => {
      });
    }
  }
  throw lastErr;
}
var KNOWN_ARIA_ROLES = /* @__PURE__ */ new Set([
  "button",
  "link",
  "textbox",
  "checkbox",
  "radio",
  "combobox",
  "listbox",
  "option",
  "menuitem",
  "menu",
  "menubar",
  "tab",
  "tabpanel",
  "tablist",
  "dialog",
  "alertdialog",
  "alert",
  "banner",
  "navigation",
  "main",
  "region",
  "article",
  "list",
  "listitem",
  "table",
  "row",
  "cell",
  "columnheader",
  "rowheader",
  "rowgroup",
  "grid",
  "gridcell",
  "treeitem",
  "tooltip",
  "status",
  "progressbar",
  "slider",
  "spinbutton",
  "switch",
  "searchbox",
  "separator",
  "heading",
  "img",
  "image",
  "figure",
  "form",
  "group",
  "paragraph",
  "code",
  "blockquote",
  "definition",
  "term",
  "generic",
  "presentation",
  "none",
  "caption",
  "document",
  "application",
  "feed",
  "complementary",
  "contentinfo",
  "search",
  "log",
  "marquee",
  "timer",
  "note",
  "directory",
  "tree",
  "treegrid",
  "meter",
  "scrollbar"
]);

// src/runEngine.ts
function softSkipStaleContentAssert(result) {
  if (result.status === "failed" && result.failure_type === "soft_content_assertion" && process.env.AEGIS_HARD_CONTENT_ASSERT !== "1") {
    result.status = "skipped";
    result.actual_result = `Soft-skipped after re-check \u2014 fragile content assertion failed on every attempt (no stable-oracle impact): ${(result.error_message || "").slice(0, 100)}`;
    result.error_message = "";
  }
}
function applyNeedsReviewRollup(resp) {
  if (resp.status === "passed" && (resp.step_results || []).some((s) => s?.failure_type === "soft_content_assertion")) {
    resp.status = "needs_review";
  }
}
function normalizeText(text) {
  if (!text) return "";
  return text.replace(/\s+/g, " ").trim();
}
function canonicalizeStepAction(raw) {
  if (!raw || typeof raw !== "string") return raw;
  let a = raw.trim().toLowerCase().replace(/^browser[_-]/, "");
  const collapsed = a.replace(/[_-]/g, "");
  const MAP = {
    // navigation
    goto: "navigate",
    gotourl: "navigate",
    visit: "navigate",
    open: "navigate",
    navigateto: "navigate",
    // waits — URL/navigation waits vs element waits
    waitforurl: "wait_for_url",
    waitfornavigation: "wait_for_url",
    waitfornav: "wait_for_url",
    waitforselector: "wait-for-selector",
    waitforelement: "wait-for-selector",
    waitfor: "wait-for-selector",
    waittime: "wait",
    sleep: "wait",
    pause: "wait",
    // interactions
    presskey: "press",
    keypress: "press",
    key: "press",
    selectoption: "select-option",
    selectdropdown: "select-option",
    choose: "select-option",
    doubleclick: "click",
    dblclick: "click",
    tap: "click",
    typetext: "fill",
    input: "fill",
    enter: "fill",
    settext: "fill",
    clearfield: "clear",
    cleartext: "clear",
    // assertions / verifications → the generic assert handler auto-detects subtype
    verify: "assertion",
    verifyvisible: "assertion",
    verifyelement: "assertion",
    verifyelementvisible: "assertion",
    verifypresent: "assertion",
    verifyexists: "assertion",
    assertvisible: "assertion",
    assertexists: "assertion",
    asserturl: "assertion",
    verifyurl: "assertion",
    checkurl: "assertion",
    expect: "assertion",
    verifytext: "verify-text",
    asserttext: "verify-text",
    verifycontent: "verify-text",
    verifyvalue: "verify-value",
    assertvalue: "verify-value",
    verifyinputvalue: "verify-value",
    // screenshots / api
    capture: "screenshot",
    snapshot: "screenshot",
    apirequest: "api-request",
    httprequest: "api-request",
    request: "api-request"
  };
  if (MAP[collapsed]) return MAP[collapsed];
  return a;
}
function isInteractableSelector(selector) {
  const nonInteractable = ["title", "meta", "script", "style", "head", "link", "noscript", "base"];
  const lowerSelector = selector.toLowerCase().trim();
  for (const tag of nonInteractable) {
    if (lowerSelector === tag || lowerSelector.startsWith(`${tag}[`) || lowerSelector.startsWith(`${tag}:`)) {
      return false;
    }
  }
  return true;
}
function playwrightToCssSelector(selector) {
  if (!selector) return null;
  if (selector.startsWith("xpath=") || selector.startsWith("//")) return null;
  if (selector.startsWith("css=")) selector = selector.slice(4);
  const hasPlaywrightSyntax = selector.includes(":has-text(") || selector.includes(":text(") || selector.startsWith("text=") || selector.startsWith("role=") || selector.startsWith("label=") || selector.startsWith("data-testid=") || selector.startsWith("getBy") || selector.includes(" >> ");
  if (!hasPlaywrightSyntax) {
    return selector;
  }
  let cssSelector = selector;
  cssSelector = cssSelector.replace(/:has-text\(['"]?[^'")\]]+['"]?\)/gi, "");
  cssSelector = cssSelector.replace(/:text\(['"]?[^'")\]]+['"]?\)/gi, "");
  if (cssSelector.startsWith("text=")) {
    return null;
  }
  if (cssSelector.startsWith("role=") || cssSelector.startsWith("label=") || cssSelector.startsWith("data-testid=")) {
    return null;
  }
  if (cssSelector.startsWith("getBy")) {
    return null;
  }
  cssSelector = cssSelector.replace(/\s*>>\s*/g, " ");
  cssSelector = cssSelector.trim();
  if (!cssSelector || cssSelector === "") {
    return null;
  }
  return cssSelector;
}
async function healFillLocator(page, originalSelector, value) {
  const m = originalSelector.match(/^role=[a-z]+\[name="(.+)"\]$/);
  if (!m) return null;
  const rawName = m[1].replace(/\\"/g, '"');
  const name = rawName.trim();
  if (!name || name.length < 2) return null;
  const tryFill = async (loc, path3) => {
    try {
      const count = await loc.count();
      if (count === 0) return null;
      const first = loc.first();
      await first.waitFor({ state: "visible", timeout: 2e3 });
      try {
        await first.scrollIntoViewIfNeeded({ timeout: 1500 });
      } catch {
      }
      await first.fill(value, { timeout: 5e3 });
      return { locator: first, path: path3 };
    } catch {
      return null;
    }
  };
  const byPlaceholder = await tryFill(page.getByPlaceholder(name, { exact: false }), "getByPlaceholder");
  if (byPlaceholder) return byPlaceholder;
  const byLabel = await tryFill(page.getByLabel(name, { exact: false }), "getByLabel");
  if (byLabel) return byLabel;
  const byAria = await tryFill(page.locator(`input[aria-label*="${name.replace(/"/g, '\\"')}" i], textarea[aria-label*="${name.replace(/"/g, '\\"')}" i]`), "aria-label substring");
  if (byAria) return byAria;
  try {
    const textSel = `:has-text("${name.replace(/"/g, '\\"')}") >> input, :has-text("${name.replace(/"/g, '\\"')}") >> textarea`;
    const byText = await tryFill(page.locator(textSel), "text-adjacent");
    if (byText) return byText;
  } catch {
  }
  return null;
}
var DEFAULT_VISUAL_DIFF_THRESHOLD_PERCENT = 10;
async function compareScreenshots(baselinePath, currentPath, diffPath, threshold = DEFAULT_VISUAL_DIFF_THRESHOLD_PERCENT, s3KeyPrefix, baselineUrl) {
  let currentUrl;
  let resolvedBaselineUrl = baselineUrl;
  try {
    const comparison = await compareVisualArtifacts({
      baselinePath,
      currentPath,
      diffPath,
      thresholdPercent: threshold,
      baselineUrl
    });
    let diffUrl;
    if (s3KeyPrefix) {
      const [bUrl, cUrl, dUrl] = await Promise.all([
        fs2.existsSync(baselinePath) ? resolvedBaselineUrl ? Promise.resolve(resolvedBaselineUrl) : uploadArtifact(baselinePath, `${s3KeyPrefix}/baseline.png`, "image/png") : Promise.resolve(null),
        uploadArtifact(currentPath, `${s3KeyPrefix}/current.png`, "image/png"),
        comparison.status === "different" && comparison.diffImagePath ? uploadArtifact(comparison.diffImagePath, `${s3KeyPrefix}/diff.png`, "image/png") : Promise.resolve(null)
      ]);
      resolvedBaselineUrl = bUrl ?? void 0;
      currentUrl = cUrl ?? void 0;
      diffUrl = dUrl ?? void 0;
    }
    if (comparison.status === "missing_baseline") {
      logger.warn(`[Visual] No approved baseline found for ${baselinePath}`);
    } else if (comparison.status === "compare_error") {
      logger.warn(`[Visual] Comparison failed for ${baselinePath}: ${comparison.error}`);
    } else {
      logger.info(
        `[Visual] Comparison: diff=${comparison.diffPercentage.toFixed(2)}%, threshold=${normalizeVisualDiffThresholdPercent(threshold, DEFAULT_VISUAL_DIFF_THRESHOLD_PERCENT).toFixed(2)}%, match=${comparison.match}`
      );
    }
    return {
      ...comparison,
      baselineUrl: resolvedBaselineUrl,
      currentUrl,
      diffUrl
    };
  } catch (err) {
    logger.error("[Visual] Screenshot comparison failed:", err);
    if (!currentUrl && s3KeyPrefix && fs2.existsSync(currentPath)) {
      try {
        currentUrl = await uploadArtifact(currentPath, `${s3KeyPrefix}/current.png`, "image/png") ?? void 0;
      } catch (uploadErr) {
        logger.warn(`[Visual] Failed to upload current screenshot after compare error: ${uploadErr}`);
      }
    }
    return {
      match: false,
      diffPercentage: VISUAL_STATUS_SENTINELS.compare_error,
      baselineUrl: resolvedBaselineUrl,
      currentUrl,
      status: "compare_error",
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
async function runAccessibilityAudit(page) {
  try {
    const results = await retryOnContextLost(page, () => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze());
    return {
      violations: results.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        help: v.help,
        helpUrl: v.helpUrl,
        nodes: v.nodes.map((n) => ({
          html: n.html,
          target: n.target
        }))
      })),
      passes: results.passes.length,
      incomplete: results.incomplete.length,
      inapplicable: results.inapplicable.length
    };
  } catch (err) {
    logger.error("[A11y] Accessibility audit failed:", err);
    return { violations: [], passes: 0, incomplete: 0, inapplicable: 0 };
  }
}
async function capturePerformanceMetrics(page) {
  try {
    const metrics = await page.evaluate(() => {
      const result = {};
      const nav = performance.getEntriesByType("navigation")[0];
      if (nav) {
        result.ttfb = nav.responseStart - nav.requestStart;
        result.domContentLoaded = nav.domContentLoadedEventEnd - nav.startTime;
        result.load = nav.loadEventEnd - nav.startTime;
      }
      const paints = performance.getEntriesByType("paint");
      const fcp = paints.find((p) => p.name === "first-contentful-paint");
      if (fcp) result.fcp = fcp.startTime;
      const lcpEntries = performance.getEntriesByType?.("largest-contentful-paint") || [];
      if (lcpEntries.length > 0) {
        result.lcp = lcpEntries[lcpEntries.length - 1].startTime;
      }
      const resources = performance.getEntriesByType("resource");
      result.resourceCount = resources.length;
      result.totalTransferSize = resources.reduce((sum, r) => sum + (r.transferSize || 0), 0);
      result.cls = window.__CLS_VALUE || 0;
      return result;
    });
    return metrics;
  } catch (err) {
    logger.error("[Perf] Failed to capture metrics:", err);
    return {};
  }
}
function classifyTestFailureType(error) {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (/timeout|timed out|exceeded/.test(message)) return "timeout";
  if (/selector|locator|element|not visible|detached|strict mode/.test(message)) return "selector";
  if (/navigation|net::|goto|load|redirect|429|too many requests/.test(message)) return "navigation";
  if (/cookie|session|login|auth|unauthorized|forbidden/.test(message)) return "auth";
  if (/api|fetch|xhr|response time|status/.test(message)) return "network";
  if (/assert|expected|visibility assertion|text assertion|url assertion/.test(message)) return "validation";
  return "unknown";
}
function buildRetryHelpfulReason(failureType, errorMessage) {
  const normalized = errorMessage.toLowerCase();
  if (failureType === "timeout") return "Recovered after the page was given time to settle";
  if (failureType === "navigation") return "Recovered after navigation and rendering completed on a later attempt";
  if (failureType === "selector") return "Recovered after the target element became interactable";
  if (failureType === "auth") return "Recovered after session or authentication state stabilized";
  if (failureType === "network" || normalized.includes("429") || normalized.includes("too many requests")) {
    return "Recovered after a transient network or rate-limit condition cleared";
  }
  return "Recovered after retrying a transient browser or application failure";
}
async function executeStepAdvanced(page, step, outputDir, options = {}) {
  const {
    enableRetry = true,
    enableVisualRegression = false,
    enableAccessibility = false,
    enablePerformance = false,
    maxRetries = CONFIG.maxRetries,
    baselineDir = path2.join(outputDir, "baselines"),
    credentials,
    allowAutoLogin = true
  } = options;
  let result = null;
  let firstFailure = null;
  const allowedRetries = enableRetry ? maxRetries : 0;
  for (let attempt = 0; attempt <= allowedRetries; attempt++) {
    const stepResult = await executeStep(page, step, outputDir, credentials, allowAutoLogin);
    const extendedResult = { ...stepResult };
    if (extendedResult.status === "passed") {
      extendedResult.retryCount = attempt;
      if (attempt > 0 && firstFailure) {
        const retryEvidence = {
          stepId: step.id,
          stepAction: step.action,
          selector: step.selector,
          retriesUsed: attempt,
          recovered: true,
          initialFailureType: firstFailure.failureType,
          initialError: firstFailure.error,
          initialUrl: firstFailure.url,
          finalUrl: page.url(),
          helpfulReason: buildRetryHelpfulReason(firstFailure.failureType, firstFailure.error)
        };
        extendedResult.failureType = firstFailure.failureType;
        extendedResult.failure_type = firstFailure.failureType;
        extendedResult.retryEvidence = retryEvidence;
        extendedResult.retry_evidence = retryEvidence;
      }
      result = extendedResult;
      break;
    }
    if (extendedResult.status === "skipped") {
      extendedResult.retryCount = attempt;
      result = extendedResult;
      break;
    }
    const failureMessage = extendedResult.error_message || `Step ${step.id} failed`;
    const failureType = classifyTestFailureType(failureMessage);
    extendedResult.failureType = failureType;
    if (extendedResult.failure_type !== "soft_content_assertion") {
      extendedResult.failure_type = failureType;
    }
    if (!firstFailure) {
      firstFailure = {
        error: failureMessage,
        failureType,
        url: page.url()
      };
    }
    if (attempt < allowedRetries) {
      logger.info(`[Test] Attempt ${attempt + 1} failed for step ${step.id}, retrying in ${CONFIG.retryDelay}ms: ${failureMessage}`);
      await new Promise((resolve) => setTimeout(resolve, CONFIG.retryDelay));
      await waitForInteractionSettle2(page, 2e3).catch(() => {
      });
      continue;
    }
    extendedResult.retryCount = attempt;
    if (firstFailure && attempt > 0) {
      const retryEvidence = {
        stepId: step.id,
        stepAction: step.action,
        selector: step.selector,
        retriesUsed: attempt,
        recovered: false,
        initialFailureType: firstFailure.failureType,
        initialError: firstFailure.error,
        initialUrl: firstFailure.url,
        finalUrl: page.url(),
        helpfulReason: "Retries did not resolve the failure; retained artifacts should help explain what changed"
      };
      extendedResult.retryEvidence = retryEvidence;
      extendedResult.retry_evidence = retryEvidence;
    }
    result = extendedResult;
    break;
  }
  if (!result) {
    throw new Error(`Failed to execute step ${step.id}`);
  }
  if (result.status === "passed") {
    if (enableVisualRegression && result.screenshot_after) {
      fs2.mkdirSync(baselineDir, { recursive: true });
      const baselinePath = path2.join(baselineDir, `step-${step.id}-baseline.png`);
      const diffPath = path2.join(outputDir, `step-${step.id}-diff.png`);
      const s3KeyPrefix = `visual-regression/${step.id}/${Date.now()}`;
      result.visualRegression = await compareScreenshots(
        baselinePath,
        result.screenshot_after,
        diffPath,
        DEFAULT_VISUAL_DIFF_THRESHOLD_PERCENT,
        s3KeyPrefix,
        step.visual_baseline_url
      );
      if (result.visualRegression.baselineUrl) result.visual_baseline_url = result.visualRegression.baselineUrl;
      if (result.visualRegression.currentUrl) result.visual_current_url = result.visualRegression.currentUrl;
      if (result.visualRegression.diffUrl) result.visual_diff_url = result.visualRegression.diffUrl;
      result.visual_diff_percentage = result.visualRegression.diffPercentage;
      result.visual_match = result.visualRegression.match;
      if (result.visualRegression.status === "missing_baseline") {
        const visualMessage = result.visualRegression.error || "No approved visual baseline found";
        result.actual_result = result.actual_result ? `${result.actual_result} | ${visualMessage}` : visualMessage;
        logger.warn(`[Visual] Step ${step.id}: ${visualMessage}`);
      } else if (result.visualRegression.status === "compare_error") {
        const visualMessage = result.visualRegression.error || "Visual comparison failed";
        result.actual_result = result.actual_result ? `${result.actual_result} | ${visualMessage}` : visualMessage;
        logger.warn(`[Visual] Step ${step.id}: ${visualMessage}`);
      } else if (!result.visualRegression.match) {
        logger.info(`[Visual] Step ${step.id} has visual differences: ${result.visualRegression.diffPercentage.toFixed(2)}%`);
      }
    }
    if (enableAccessibility && ["navigate", "goto", "click"].includes(step.action.toLowerCase())) {
      result.accessibility = await runAccessibilityAudit(page);
      if (result.accessibility.violations.length > 0) {
        logger.info(`[A11y] Step ${step.id} has ${result.accessibility.violations.length} accessibility violations`);
      }
    }
    if (enablePerformance && ["navigate", "goto"].includes(step.action.toLowerCase())) {
      result.performance = await capturePerformanceMetrics(page);
      logger.info(`[Perf] Step ${step.id} - LCP: ${result.performance.lcp?.toFixed(0)}ms, FCP: ${result.performance.fcp?.toFixed(0)}ms`);
    }
  }
  if (result.retryCount && result.status === "failed" && result.failure_type === "soft_content_assertion") {
    logger.warn(`[Test] Content assertion (step ${step.id}) failed all ${(result.retryCount || 0) + 1} attempts \u2192 needs_review`);
  }
  softSkipStaleContentAssert(result);
  return result;
}
async function findInFrames(page, selector) {
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    try {
      const loc = f.locator(selector);
      const cnt = await loc.count();
      if (cnt > 0) {
        return { frameUrl: f.url(), locator: loc.first() };
      }
    } catch {
    }
  }
  return null;
}
async function tryHoverRecovery(page, selector) {
  const roleMatch = selector.match(/^role=([\w-]+)\[name=(?:"([^"]+)"|\/([^/]+)\/[a-z]*)\]/);
  const hrefMatch = selector.match(/a\[href\$?="([^"]+)"\]/);
  const role = roleMatch ? roleMatch[1] : "";
  const name = roleMatch ? roleMatch[2] || roleMatch[3] || "" : "";
  const href = hrefMatch ? hrefMatch[1] : "";
  if (!role && !href) return false;
  const stamped = await page.evaluate(({ role: role2, name: name2, href: href2 }) => {
    const target = (() => {
      if (href2) {
        const a = document.querySelector(`a[href="${href2}"], a[href$="${href2}"]`);
        if (a) return a;
      }
      if (role2 && name2) {
        const tagSel = role2 === "button" ? 'button, [role="button"]' : role2 === "link" ? 'a, [role="link"]' : `[role="${role2}"]`;
        const candidates = Array.from(document.querySelectorAll(tagSel));
        const wanted = name2.trim().toLowerCase();
        for (const el of candidates) {
          const aria = (el.getAttribute("aria-label") || "").toLowerCase().trim();
          const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
          if (aria === wanted || text === wanted || aria.includes(wanted) || text.includes(wanted)) {
            return el;
          }
        }
      }
      return null;
    })();
    if (!target) return false;
    let cursor = target.parentElement;
    let trigger = null;
    let depth = 0;
    while (cursor && depth < 6) {
      const tag = cursor.tagName.toLowerCase();
      const cls = (cursor.className || "").toString().toLowerCase();
      const cardish = /figure|card|item|tile|user|profile/.test(cls);
      if (cardish || tag === "figure" || tag === "li" || tag === "article") {
        trigger = cursor;
        break;
      }
      cursor = cursor.parentElement;
      depth++;
    }
    if (!trigger) trigger = target.parentElement || target;
    document.querySelectorAll("[data-aegis-hover-recovery]").forEach((el) => {
      try {
        el.removeAttribute("data-aegis-hover-recovery");
      } catch {
      }
    });
    try {
      trigger.setAttribute("data-aegis-hover-recovery", "1");
    } catch {
      return false;
    }
    return true;
  }, { role, name, href }).catch(() => false);
  if (!stamped) return false;
  try {
    await page.locator('[data-aegis-hover-recovery="1"]').first().hover({ timeout: 3e3 });
  } catch {
    return false;
  }
  await page.waitForTimeout(250);
  return true;
}
function ensureApiBuffer(page) {
  const marker = "__aegisApiBuffer__";
  const existing = page[marker];
  if (existing) return existing;
  const buf = [];
  ;
  page[marker] = buf;
  page.on("response", (resp) => {
    try {
      const req = resp.request();
      const method = (req.method() || "").toUpperCase();
      if (method !== "POST" && method !== "PUT" && method !== "PATCH" && method !== "DELETE") return;
      const status = resp.status();
      if (typeof status !== "number" || status === 0) return;
      let urlPath = "";
      try {
        urlPath = new URL(resp.url()).pathname;
      } catch {
        return;
      }
      if (buf.length >= 200) buf.shift();
      buf.push({ method, urlPath, status, ts: Date.now() });
    } catch {
    }
  });
  return buf;
}
async function fillResilient(page, loc, value) {
  const v = value || "";
  let kind = "wrapper";
  try {
    kind = await loc.evaluate((el) => {
      const editable = (n) => !!n && (n.tagName === "INPUT" || n.tagName === "TEXTAREA" || n.isContentEditable === true);
      if (editable(el)) return "native";
      const nested = el.querySelector && el.querySelector('input:not([type=hidden]), textarea, [contenteditable=""], [contenteditable="true"]');
      return nested ? "nested" : "wrapper";
    });
  } catch {
  }
  if (kind === "native") {
    try {
      await loc.scrollIntoViewIfNeeded({ timeout: 2e3 });
    } catch {
    }
    try {
      await loc.focus({ timeout: 2e3 });
    } catch {
    }
    try {
      await loc.fill("", { timeout: 2e3 });
    } catch {
    }
    try {
      await loc.fill(v, { timeout: 8e3 });
      return true;
    } catch {
    }
    try {
      await loc.pressSequentially(v, { delay: 20, timeout: 6e3 });
      return true;
    } catch {
    }
    return false;
  }
  if (kind === "nested") {
    const inner = loc.locator('input:not([type=hidden]), textarea, [contenteditable=""], [contenteditable="true"]').first();
    try {
      await inner.scrollIntoViewIfNeeded({ timeout: 2e3 });
    } catch {
    }
    try {
      await inner.click({ timeout: 3e3 });
    } catch {
    }
    try {
      await inner.fill("", { timeout: 2e3 });
    } catch {
    }
    try {
      await inner.fill(v, { timeout: 6e3 });
      return true;
    } catch {
    }
    try {
      await inner.pressSequentially(v, { delay: 20, timeout: 6e3 });
      return true;
    } catch {
    }
    return false;
  }
  try {
    await loc.scrollIntoViewIfNeeded({ timeout: 2e3 });
  } catch {
  }
  try {
    await loc.click({ timeout: 3e3 });
  } catch {
  }
  const spawned = loc.locator('input:not([type=hidden]), textarea, [contenteditable=""], [contenteditable="true"]').first();
  if (await spawned.count().catch(() => 0)) {
    try {
      await spawned.fill(v, { timeout: 4e3 });
      return true;
    } catch {
    }
    try {
      await spawned.pressSequentially(v, { delay: 20, timeout: 6e3 });
      return true;
    } catch {
    }
  }
  try {
    await page.keyboard.type(v, { delay: 20 });
    return true;
  } catch {
  }
  return false;
}
async function extractResolvedSelectorsExec(loc) {
  try {
    const out = await loc.evaluate((node) => {
      {
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
            const lbl = document.querySelector('label[for="' + esc(id) + '"]');
            if (lbl) labelText = (lbl.textContent || "").trim();
          }
          if (!labelText) {
            const wrap = node.closest("label");
            if (wrap) labelText = (wrap.textContent || "").trim();
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
          let cur = node.parentElement;
          let depth = 0;
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
      }
    });
    return out && Object.keys(out).length ? out : void 0;
  } catch {
    return void 0;
  }
}
function stripVolatileUrlSegments(s) {
  if (!s || typeof s !== "string") return "";
  return s.replace(/\/\d+(?=\/|$)/g, "/#").replace(/\/[0-9a-fA-F]{8,}(?=\/|$)/g, "/#").replace(/([?&](?:id|empnumber|empid|userid|page|offset|ts|_|uid|recordid|cursor|after|before|start|token|continuation|next|prev|sort)=)[^&#]*/gi, "$1#").replace(/([?&][^=&#]+=)[A-Za-z0-9+/_-]{16,}={0,2}(?=&|#|$)/g, "$1#");
}
async function selectResilient(page, trigger, value) {
  const v = (value || "").trim();
  if (!v) return false;
  try {
    try {
      await trigger.scrollIntoViewIfNeeded({ timeout: 1500 });
    } catch {
    }
    try {
      await trigger.click({ timeout: 3e3 });
    } catch {
    }
    await page.waitForTimeout(250);
    const candidates = [
      page.getByRole("option", { name: v, exact: false }),
      page.locator(`[role="option"]`).filter({ hasText: v }).first(),
      page.locator(`li, [class*="option"], [class*="Option"], [class*="item"]`).filter({ hasText: v }).first()
    ];
    for (const c of candidates) {
      try {
        if (await c.count().catch(() => 0) > 0) {
          await c.first().click({ timeout: 3e3 });
          await page.waitForTimeout(150);
          return true;
        }
      } catch {
      }
    }
    try {
      await page.keyboard.type(v, { delay: 20 });
      await page.waitForTimeout(300);
      await page.keyboard.press("Enter");
      return true;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}
async function executeStep(page, step, outputDir, credentials, allowAutoLogin = true) {
  if (page.__signedOutByTest) allowAutoLogin = false;
  if (!page.__errTrackersAttached) {
    page.__errTrackersAttached = true;
    page.__consoleErrors = [];
    page.__networkErrors = [];
    try {
      page.on("console", (msg) => {
        try {
          if (msg.type() === "error") page.__consoleErrors.push(String(msg.text()).slice(0, 300));
        } catch {
        }
      });
      page.on("response", (resp) => {
        try {
          const s = resp.status();
          if (s >= 400) page.__networkErrors.push(`${s} ${String(resp.url()).slice(0, 200)}`);
        } catch {
        }
      });
      page.on("requestfailed", (req) => {
        try {
          page.__networkErrors.push(`failed ${String(req.url()).slice(0, 200)}`);
        } catch {
        }
      });
    } catch {
    }
  }
  ensureApiBuffer(page);
  const startedAt = /* @__PURE__ */ new Date();
  const result = {
    step_id: step.id,
    status: "pending",
    started_at: startedAt.toISOString(),
    completed_at: "",
    duration_ms: 0
  };
  const skipNoTarget = (kind) => {
    result.status = "skipped";
    result.actual_result = `${kind} assertion skipped \u2014 no target selector (empty/malformed assertion, not evaluable).`;
    const c = /* @__PURE__ */ new Date();
    result.completed_at = c.toISOString();
    result.duration_ms = c.getTime() - startedAt.getTime();
    logger.info(`[Test] Skipped target-less ${kind} assertion (step ${step.id})`);
    return result;
  };
  try {
    if (step.selector && (step.selector.trim() === "" || step.selector.includes("\uFFFD\uFFFD"))) {
      throw new Error(`Invalid selector: "${step.selector}" - selector appears to be empty or corrupted`);
    }
    if (step.selector && step.selector.startsWith("locator(")) {
      const inner = step.selector.slice("locator(".length, -1).trim();
      if (inner.startsWith("'") && inner.endsWith("'") || inner.startsWith('"') && inner.endsWith('"')) {
        step.selector = inner.slice(1, -1);
      } else {
        step.selector = inner;
      }
    }
    if (step.selector) {
      step.selector = step.selector.replace(/\[role="popup-trigger"\]/g, "").replace(/\[role="focusable"\]/g, "").replace(/\[role="keyboard-nav"\]/g, "").trim();
    }
    const repairRolePrefix = (sel) => {
      const KNOWN_ROLES = [
        "button",
        "link",
        "textbox",
        "combobox",
        "checkbox",
        "radio",
        "heading",
        "menuitem",
        "tab",
        "option",
        "listbox",
        "searchbox",
        "spinbutton",
        "slider",
        "switch",
        "dialog",
        "alert",
        "navigation",
        "main",
        "banner",
        "article"
      ];
      const noPrefixMatch = sel.match(/^(\w+)\[name=(?:"([^"]+)"|\/([^/]+)\/[a-z]*)\]$/);
      if (noPrefixMatch && KNOWN_ROLES.includes(noPrefixMatch[1])) {
        return `role=${sel}`;
      }
      return sel;
    };
    const looseRoleSelector = repairRolePrefix;
    if (step.selector) {
      step.selector = looseRoleSelector(step.selector);
    }
    if (step.assertions && step.assertions.target) {
      step.assertions.target = looseRoleSelector(step.assertions.target);
    }
    if (step.action) step.action = canonicalizeStepAction(step.action);
    if (step.selector && (step.selector.startsWith("http://") || step.selector.startsWith("https://")) && !["navigate", "goto"].includes(step.action.toLowerCase())) {
      logger.info(`[Test] Converting ${step.action} with URL selector to navigate: ${step.selector}`);
      step.action = "navigate";
      step.value = step.selector;
      step.selector = "";
    }
    const actionsRequiringSelector = ["click", "fill", "type", "hover", "dblclick", "check", "uncheck", "select", "select-option", "scroll"];
    if (!step.selector && actionsRequiringSelector.includes(step.action.toLowerCase()) && step.action.toLowerCase() !== "scroll") {
      throw new Error(`Invalid selector: selector is empty or not a string`);
    }
    const actionsThatRequireInteraction = ["click", "fill", "type", "hover", "dblclick", "check", "uncheck", "select", "select-option"];
    if (step.selector && actionsThatRequireInteraction.includes(step.action.toLowerCase())) {
      if (!isInteractableSelector(step.selector)) {
        throw new Error(`Cannot ${step.action} on "${step.selector}" - this element type is not interactable. Use assertions instead.`);
      }
    }
    if (step.selector && actionsThatRequireInteraction.includes(step.action.toLowerCase())) {
      try {
        const probe = await getStrictLocator(page, step.selector, false, step.alt_selectors);
        const enabled = await probe.isEnabled({ timeout: 1500 }).catch(() => true);
        if (!enabled) {
          const name = await probe.evaluate((el) => (el.textContent || el.ariaLabel || el.name || "").slice(0, 80)).catch(() => "");
          result.status = "skipped";
          result.actual_result = `Skipped \u2014 target element is disabled (name: "${name}"). Step '${step.action}' not attempted.`;
          logger.info(`[Test] Runtime-skip: ${step.action} on "${step.selector}" \u2014 element disabled`);
          return result;
        }
      } catch {
      }
    }
    const isApiStep = ["api-request", "http-request"].includes(step.action.toLowerCase());
    if (!isApiStep) {
      const screenshotBefore = path2.join(outputDir, `step-${step.id}-before.png`);
      const ok = await page.screenshot({ path: screenshotBefore }).then(() => true).catch(() => false);
      if (ok) result.screenshot_before = screenshotBefore;
    }
    switch (step.action.toLowerCase()) {
      case "navigate":
      case "goto":
        const targetUrl = step.value || step.selector;
        if (!targetUrl || targetUrl.trim() === "") {
          logger.info(`[Test] Skipping empty navigate step - page already at: ${page.url()}`);
          result.actual_result = `Already at ${page.url()} (skipped empty navigate)`;
          break;
        }
        if (targetUrl.includes("{{") && targetUrl.includes("}}")) {
          throw new Error(`URL contains unsubstituted variable: "${targetUrl}" - ensure test data set has the required variables`);
        }
        const navResp = await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
        try {
          if (navResp) page.__lastNavStatus = navResp.status();
        } catch {
        }
        try {
          if (!page.__entryUrl) page.__entryUrl = page.url() || targetUrl;
        } catch {
        }
        await page.waitForLoadState("load");
        await waitForSPAReady(page);
        await dismissCookieConsent(page);
        if (allowAutoLogin) {
          await handleAutoLogin(page, credentials, targetUrl);
        }
        result.actual_result = `Navigated to ${page.url()}`;
        break;
      case "click":
        await page.waitForLoadState("load", { timeout: 5e3 }).catch(() => {
        });
        await dismissCookieConsent(page);
        if (allowAutoLogin && isLoginPageUrl(page.url()) && credentials && !isLoginSubmitSelector(step.selector)) {
          logger.info(`[Test] Click step: currently on login page, attempting auto-login first...`);
          await handleAutoLogin(page, credentials);
        }
        if (/sign[ _-]?out|log[ _-]?out/i.test(String(step.selector || ""))) {
          page.__signedOutByTest = true;
          logger.info(`[Test] Sign-out click detected \u2014 auto-login disabled for the rest of this case`);
        }
        const urlBeforeClick = page.url();
        const clickLocator = await getStrictLocator(page, step.selector, false, step.alt_selectors);
        if (isLoginSubmitSelectorStep(step.selector) && !isLoginPageUrl(page.url())) {
          const present = await clickLocator.count().catch(() => 0);
          if (present === 0) {
            result.status = "skipped";
            result.actual_result = `Skipped redundant login submit \u2014 already authenticated (no login form, not on a login page).`;
            const c = /* @__PURE__ */ new Date();
            result.completed_at = c.toISOString();
            result.duration_ms = c.getTime() - startedAt.getTime();
            logger.info(`[Test] Idempotent-login: skipped submit "${step.selector}" \u2014 already authenticated`);
            return result;
          }
        }
        if (isConsentDismissTarget(step.selector)) {
          const present = await clickLocator.count().catch(() => 0);
          if (present === 0) {
            result.status = "skipped";
            result.actual_result = `Skipped consent-banner dismiss \u2014 banner not present (already accepted or absent in this environment).`;
            const c = /* @__PURE__ */ new Date();
            result.completed_at = c.toISOString();
            result.duration_ms = c.getTime() - startedAt.getTime();
            logger.info(`[Test] Consent-dismiss skip: "${step.selector}" not present`);
            return result;
          }
        }
        try {
          result.resolved_selectors = await extractResolvedSelectorsExec(clickLocator);
        } catch {
        }
        try {
          try {
            await clickLocator.waitFor({ state: "attached", timeout: 1e4 });
          } catch {
            logger.info(`[Test] Click target "${step.selector}" not attached, waiting for SPA...`);
            await waitForSPAReady(page);
            await clickLocator.waitFor({ state: "attached", timeout: 5e3 });
          }
          try {
            await clickLocator.scrollIntoViewIfNeeded({ timeout: 5e3 });
            await page.waitForTimeout(300);
          } catch (scrollErr) {
            logger.info(`[Test] Scroll failed, continuing: ${scrollErr}`);
          }
          try {
            await clickLocator.waitFor({ state: "visible", timeout: 5e3 });
          } catch (visErr) {
            logger.info(`[Test] Element not visible after scroll, trying force click`);
          }
          await clickLocator.click({ timeout: adaptiveActionTimeout(page, 1e4) });
        } catch (e) {
          const errorMsg = e.message || "";
          logger.info(`[Test] Standard click failed: ${errorMsg}`);
          let frameClicked = false;
          if (errorMsg.includes("not visible") || errorMsg.includes("not attached") || errorMsg.includes("not found") || errorMsg.includes("Timeout")) {
            try {
              const frames = page.frames();
              for (const f of frames) {
                if (f === page.mainFrame()) continue;
                try {
                  const frameLoc = f.locator(step.selector);
                  const cnt = await frameLoc.count();
                  if (cnt > 0) {
                    await frameLoc.first().click({ timeout: 5e3 });
                    logger.info(`[Test] Iframe-aware click succeeded in frame ${f.url().slice(0, 80)} for "${step.selector}"`);
                    frameClicked = true;
                    break;
                  }
                } catch {
                }
              }
            } catch (frameErr) {
              logger.info(`[Test] Iframe-recovery error (non-fatal): ${String(frameErr?.message || frameErr).slice(0, 120)}`);
            }
          }
          let hoverRecoveryClicked = frameClicked;
          if (!frameClicked && (errorMsg.includes("not visible") || errorMsg.includes("not attached") || errorMsg.includes("not found"))) {
            try {
              const hoverRecovered = await tryHoverRecovery(page, step.selector);
              if (hoverRecovered) {
                logger.info(`[Test] Hover-ancestor recovery surfaced the target \u2014 retrying click`);
                try {
                  await clickLocator.click({ timeout: 5e3 });
                  hoverRecoveryClicked = true;
                } catch (afterHoverErr) {
                  logger.info(`[Test] Click after hover-recovery still failed: ${String(afterHoverErr?.message || afterHoverErr).slice(0, 120)}`);
                }
              }
            } catch (hoverErr) {
              logger.info(`[Test] Hover-recovery error (non-fatal): ${String(hoverErr?.message || hoverErr).slice(0, 120)}`);
            }
          }
          if (!hoverRecoveryClicked && (errorMsg.includes("not visible") || errorMsg.includes("outside of the viewport") || errorMsg.includes("intercept") || errorMsg.includes("not attached"))) {
            try {
              logger.info(`[Test] Trying force click...`);
              await clickLocator.click({ force: true, timeout: 5e3 });
            } catch (forceErr) {
              logger.info(`[Test] Force click failed, trying JS click via locator...`);
              try {
                await clickLocator.evaluate((el) => {
                  el.scrollIntoView({ behavior: "instant", block: "center" });
                  el.click();
                });
              } catch (jsErr) {
                logger.info(`[Test] JS click failed, trying live-DOM heal...`);
                const healed = await healLocatorOnPage(page, step.selector);
                if (healed) {
                  try {
                    await healed.scrollIntoViewIfNeeded({ timeout: 3e3 }).catch(() => {
                    });
                    await healed.click({ timeout: 5e3 });
                    logger.info(`[Test] Heal succeeded for "${step.selector}"`);
                  } catch {
                    throw new Error(`Element "${step.selector}" not found or not clickable (heal also failed)`);
                  }
                } else {
                  const cssSelector = playwrightToCssSelector(step.selector);
                  if (cssSelector) {
                    const clicked = await page.evaluate((sel) => {
                      const el = document.querySelector(sel);
                      if (el) {
                        el.scrollIntoView({ behavior: "instant", block: "center" });
                        el.click();
                        return true;
                      }
                      return false;
                    }, cssSelector);
                    if (!clicked) {
                      throw new Error(`Element "${step.selector}" not found or not clickable`);
                    }
                  } else {
                    throw new Error(`Element "${step.selector}" not found or not clickable`);
                  }
                }
              }
            }
          } else if (errorMsg.includes("Timeout")) {
            let timeoutIframeClicked = false;
            try {
              const frames = page.frames();
              for (const f of frames) {
                if (f === page.mainFrame()) continue;
                try {
                  const frameLoc = f.locator(step.selector);
                  const cnt = await frameLoc.count();
                  if (cnt > 0) {
                    await frameLoc.first().click({ timeout: 5e3 });
                    logger.info(`[Test] Iframe-aware click (timeout path) succeeded in frame ${f.url().slice(0, 80)} for "${step.selector}"`);
                    timeoutIframeClicked = true;
                    break;
                  }
                } catch {
                }
              }
            } catch {
            }
            let timeoutHoverRecoveryClicked = timeoutIframeClicked;
            if (!timeoutIframeClicked) {
              try {
                const recovered = await tryHoverRecovery(page, step.selector);
                if (recovered) {
                  logger.info(`[Test] Hover-ancestor recovery surfaced the target after timeout \u2014 retrying click`);
                  try {
                    await clickLocator.click({ timeout: 5e3 });
                    timeoutHoverRecoveryClicked = true;
                  } catch (afterHoverErr) {
                    logger.info(`[Test] Click after hover-recovery (timeout path) failed: ${String(afterHoverErr?.message || afterHoverErr).slice(0, 120)}`);
                  }
                }
              } catch (hoverErr) {
                logger.info(`[Test] Hover-recovery (timeout path) error (non-fatal): ${String(hoverErr?.message || hoverErr).slice(0, 120)}`);
              }
            }
            if (timeoutHoverRecoveryClicked) {
            } else {
              logger.info(`[Test] Timeout waiting for element, trying live-DOM heal...`);
              const healed = await healLocatorOnPage(page, step.selector);
              if (healed) {
                try {
                  await healed.scrollIntoViewIfNeeded({ timeout: 3e3 }).catch(() => {
                  });
                  await healed.click({ timeout: 5e3 });
                  logger.info(`[Test] Heal succeeded for "${step.selector}"`);
                } catch {
                  throw new Error(`Element "${step.selector}" not found - heal click failed`);
                }
              } else {
                const cssSelector = playwrightToCssSelector(step.selector);
                if (cssSelector) {
                  const clicked = await page.evaluate((sel) => {
                    const el = document.querySelector(sel);
                    if (el) {
                      el.scrollIntoView({ behavior: "instant", block: "center" });
                      el.click();
                      return true;
                    }
                    return false;
                  }, cssSelector);
                  if (!clicked) {
                    throw new Error(`Element "${step.selector}" not found or not clickable`);
                  }
                } else {
                  throw new Error(`Element "${step.selector}" not found - timeout waiting`);
                }
              }
            }
          } else {
            throw e;
          }
        }
        if (step.waitFor && typeof step.waitFor === "string" && step.waitFor.trim()) {
          const waitForCondition = step.waitFor.trim();
          logger.info(`[Test] Processing waitFor: ${waitForCondition}`);
          const urlMatch = waitForCondition.match(/URL.*(?:change|navigate).*?(https?:\/\/[^\s]+)/i);
          if (urlMatch) {
            const expectedUrl = urlMatch[1];
            logger.info(`[Test] Waiting for URL to contain: ${expectedUrl}`);
            try {
              await page.waitForURL((url) => url.toString().includes(expectedUrl.replace(/^https?:\/\/[^/]+/, "")), { timeout: 15e3 });
              logger.info(`[Test] URL changed to: ${page.url()}`);
            } catch (urlErr) {
              logger.info(`[Test] URL wait timeout, current URL: ${page.url()}`);
            }
          } else {
            try {
              const waitForLocator = page.locator(waitForCondition);
              await waitForLocator.waitFor({ state: "visible", timeout: 1e4 });
            } catch (selectorErr) {
              logger.info(`[Test] waitFor selector not found: ${waitForCondition}`);
            }
          }
        } else {
          const isLinkSelector = step.selector.startsWith("a") || step.selector.startsWith("a[") || step.selector.includes("a:has-text") || step.selector.includes("a[href");
          if (isLinkSelector) {
            const urlBefore = urlBeforeClick;
            let opensInNewTab = false;
            let linkHref = "";
            try {
              const linkEl = await getStrictLocator(page, step.selector, false, step.alt_selectors);
              const target = await linkEl.getAttribute("target");
              linkHref = await linkEl.getAttribute("href") || "";
              opensInNewTab = target === "_blank";
              if (opensInNewTab) {
                logger.info(`[Test] Link opens in new tab (target="_blank"), href: ${linkHref}`);
                result._linkHref = linkHref;
                result._opensInNewTab = true;
              }
            } catch (attrErr) {
            }
            if (!opensInNewTab) {
              logger.info(`[Test] Clicked link element, waiting for SPA navigation...`);
              try {
                await page.waitForURL((url) => url.toString() !== urlBefore, { timeout: 15e3 });
                await page.waitForLoadState("domcontentloaded", { timeout: 5e3 }).catch(() => {
                });
                await waitForInteractionSettle2(page, 2500);
                const urlAfter = page.url();
                logger.info(`[Test] Navigation detected: ${urlBefore} -> ${urlAfter}`);
              } catch (navErr) {
                logger.info(`[Test] No immediate navigation, waiting for SPA route change...`);
                await waitForInteractionSettle2(page, 2500);
                const urlAfterWait = page.url();
                if (urlAfterWait !== urlBefore) {
                  logger.info(`[Test] Delayed SPA navigation detected: ${urlBefore} -> ${urlAfterWait}`);
                } else {
                  logger.info(`[Test] No navigation detected after link click (may be modal, hash, or same-page link)`);
                }
              }
              await waitForSPAReady(page);
            } else {
              await page.waitForTimeout(500);
            }
            if (allowAutoLogin && isLoginPageUrl(page.url())) {
              const intendedDestination = linkHref || urlBefore;
              if (isLoginPageUrl(intendedDestination)) {
                logger.info(`[Test] Intentionally navigated to login page via link href: ${intendedDestination}, skipping auto-login`);
              } else {
                logger.info(`[Test] Click resulted in redirect to login page, attempting auto-login...`);
                await handleAutoLogin(page, credentials, intendedDestination);
              }
            }
          } else {
            await waitForInteractionSettle2(page, 2500);
          }
        }
        if (isLoginSubmitSelectorStep(step.selector)) {
          await settleQuiet(page, 2e3).catch(() => {
          });
          logger.info(`[Test] post-login settle after submit "${step.selector}" \u2014 url now ${page.url()}`);
        }
        result.actual_result = `Clicked ${step.selector}`;
        break;
      case "fill":
      case "type":
        const fillLocator = await getStrictLocator(page, step.selector, false, step.alt_selectors);
        if (isLoginCredentialSelector(step.selector) && !isLoginPageUrl(page.url())) {
          const present = await fillLocator.count().catch(() => 0);
          if (present === 0) {
            result.status = "skipped";
            result.actual_result = `Skipped redundant login fill \u2014 already authenticated (no login form present, not on a login page).`;
            const c = /* @__PURE__ */ new Date();
            result.completed_at = c.toISOString();
            result.duration_ms = c.getTime() - startedAt.getTime();
            logger.info(`[Test] Idempotent-login: skipped "${step.selector}" \u2014 already authenticated`);
            return result;
          }
        }
        try {
          await fillLocator.waitFor({ state: "attached", timeout: adaptiveActionTimeout(page, 1e4) });
          const isFileInput = await fillLocator.evaluate((el) => {
            return el.tagName === "INPUT" && el.type === "file";
          }).catch(() => false);
          if (isFileInput) {
            logger.info(`[Test] Detected file input, using setInputFiles for ${step.selector}`);
            const fileName = step.value || "test-upload.txt";
            const fileContent = "Test file content for automated testing";
            await fillLocator.setInputFiles({
              name: fileName,
              mimeType: "text/plain",
              buffer: Buffer.from(fileContent)
            });
            result.actual_result = `Uploaded file ${fileName} to ${step.selector}`;
            break;
          }
          try {
            await fillLocator.scrollIntoViewIfNeeded({ timeout: 3e3 });
          } catch (scrollErr) {
          }
          const filled = await fillResilient(page, fillLocator, step.value || "");
          if (!filled) throw new Error(`fillResilient could not enter text into "${step.selector}"`);
          try {
            result.resolved_selectors = await extractResolvedSelectorsExec(fillLocator);
          } catch {
          }
        } catch (e) {
          const inFrame = await findInFrames(page, step.selector);
          if (inFrame) {
            try {
              await inFrame.locator.fill(step.value || "", { timeout: 5e3 });
              logger.info(`[Test] Iframe-aware fill succeeded in frame ${inFrame.frameUrl.slice(0, 80)} for "${step.selector}"`);
              result.actual_result = `Filled ${step.selector} (iframe)`;
              break;
            } catch (frameFillErr) {
              logger.info(`[Test] Iframe fill attempt failed: ${String(frameFillErr?.message || frameFillErr).slice(0, 120)} \u2014 falling through`);
            }
          }
          logger.info(`[Test] Standard fill failed, trying click+fill: ${e.message}`);
          try {
            await fillLocator.click({ timeout: adaptiveActionTimeout(page, 5e3) });
            await fillLocator.fill(step.value || "", { timeout: adaptiveActionTimeout(page, 5e3) });
          } catch (clickFillErr) {
            const healed = await healFillLocator(page, step.selector, step.value || "");
            if (healed) {
              logger.info(`[Test] Healed fill locator: ${step.selector} \u2192 ${healed.path}`);
              result.actual_result = `Filled ${step.selector} (healed via ${healed.path})`;
              break;
            }
            const cssSelector = playwrightToCssSelector(step.selector);
            if (cssSelector) {
              const isFile = await page.evaluate((sel) => {
                const el = document.querySelector(sel);
                return el?.type === "file";
              }, cssSelector).catch(() => false);
              if (isFile) {
                await fillLocator.setInputFiles({
                  name: step.value || "test-upload.txt",
                  mimeType: "text/plain",
                  buffer: Buffer.from("Test file content")
                });
              } else {
                await page.evaluate(({ sel, val }) => {
                  const el = document.querySelector(sel);
                  if (el) {
                    el.scrollIntoView({ behavior: "instant", block: "center" });
                    el.focus();
                    el.value = val;
                    el.dispatchEvent(new Event("input", { bubbles: true }));
                    el.dispatchEvent(new Event("change", { bubbles: true }));
                  }
                }, { sel: cssSelector, val: step.value || "" });
              }
            } else {
              const __ct = page.__caseTags;
              const isTemplatizedFill = Array.isArray(__ct) && __ct.some((t) => t === "rule-based" || t === "templatized");
              if (isTemplatizedFill) {
                result.status = "skipped";
                result.actual_result = `Skipped fill of "${step.selector}" \u2014 field not present on page (templatized rule-based fill).`;
                const c = /* @__PURE__ */ new Date();
                result.completed_at = c.toISOString();
                result.duration_ms = c.getTime() - startedAt.getTime();
                logger.info(`[Test] Templatized form-fill skip: "${step.selector}" not found`);
                return result;
              }
              throw e;
            }
          }
        }
        result.actual_result = `Filled ${step.selector} with value`;
        break;
      case "upload-file":
        const uploadLocator = await getStrictLocator(page, step.selector, false, step.alt_selectors);
        await uploadLocator.waitFor({ state: "attached", timeout: 1e4 });
        const uploadFileName = step.value || "test-upload.txt";
        await uploadLocator.setInputFiles({
          name: uploadFileName,
          mimeType: "text/plain",
          buffer: Buffer.from("Test file content for automated testing")
        });
        result.actual_result = `Uploaded file ${uploadFileName} to ${step.selector}`;
        break;
      case "clear":
        const clearLocator = await getStrictLocator(page, step.selector, false, step.alt_selectors);
        await clearLocator.fill("", { timeout: 1e4 });
        result.actual_result = `Cleared ${step.selector}`;
        break;
      case "select": {
        const selectLocator = await getStrictLocator(page, step.selector, false, step.alt_selectors);
        try {
          await selectLocator.selectOption(step.value || "", { timeout: adaptiveActionTimeout(page, 8e3) });
        } catch (e) {
          let handled = false;
          try {
            if (await selectResilient(page, selectLocator, step.value || "")) {
              logger.info(`[Test] select: custom-dropdown path chose "${step.value}"`);
              handled = true;
            }
          } catch {
          }
          if (!handled) {
            const inFrame = await findInFrames(page, step.selector);
            if (!inFrame) throw e;
            await inFrame.locator.selectOption(step.value || "", { timeout: 5e3 });
            logger.info(`[Test] Iframe-aware select succeeded in frame ${inFrame.frameUrl.slice(0, 80)}`);
          }
        }
        await waitForInteractionSettle2(page, 2e3);
        result.actual_result = `Selected ${step.value} in ${step.selector}`;
        break;
      }
      case "draganddrop":
      case "drag": {
        const dndTargetSel = step.value || "";
        if (!step.selector || !dndTargetSel) {
          throw new Error(`dragAndDrop requires both a source selector and a target (value); got source="${step.selector}" target="${dndTargetSel}"`);
        }
        const dragSrc = await getStrictLocator(page, step.selector, false, step.alt_selectors);
        const dragTgt = await getStrictLocator(page, dndTargetSel, false, void 0);
        await dragSrc.scrollIntoViewIfNeeded({ timeout: 3e3 }).catch(() => {
        });
        try {
          await dragSrc.dragTo(dragTgt, { timeout: 1e4 });
        } catch (dndErr) {
          logger.info(`[Test] dragTo failed (${String(dndErr?.message || dndErr).slice(0, 80)}), trying manual pointer drag`);
          const sb = await dragSrc.boundingBox();
          const tb = await dragTgt.boundingBox();
          if (!sb || !tb) throw dndErr;
          await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
          await page.mouse.down();
          await page.mouse.move(sb.x + sb.width / 2 + 8, sb.y + sb.height / 2 + 8, { steps: 5 });
          await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 12 });
          await page.mouse.up();
        }
        await waitForInteractionSettle2(page, 1500);
        result.actual_result = `Dragged "${step.selector}" onto "${dndTargetSel}"`;
        break;
      }
      case "check":
        try {
          const checkLocator = await getStrictLocator(page, step.selector, false, step.alt_selectors);
          await checkLocator.check({ timeout: 1e4 });
        } catch (e) {
          const inFrame = await findInFrames(page, step.selector);
          if (!inFrame) throw e;
          await inFrame.locator.check({ timeout: 5e3 });
          logger.info(`[Test] Iframe-aware check succeeded in frame ${inFrame.frameUrl.slice(0, 80)}`);
        }
        result.actual_result = `Checked ${step.selector}`;
        break;
      case "uncheck":
        try {
          const uncheckLocator = await getStrictLocator(page, step.selector, false, step.alt_selectors);
          await uncheckLocator.uncheck({ timeout: 1e4 });
        } catch (e) {
          const inFrame = await findInFrames(page, step.selector);
          if (!inFrame) throw e;
          await inFrame.locator.uncheck({ timeout: 5e3 });
          logger.info(`[Test] Iframe-aware uncheck succeeded in frame ${inFrame.frameUrl.slice(0, 80)}`);
        }
        result.actual_result = `Unchecked ${step.selector}`;
        break;
      case "hover":
        try {
          const hoverLocator = await getStrictLocator(page, step.selector, false, step.alt_selectors);
          await hoverLocator.hover({ timeout: 1e4 });
        } catch (e) {
          const inFrame = await findInFrames(page, step.selector);
          if (!inFrame) throw e;
          await inFrame.locator.hover({ timeout: 5e3 });
          logger.info(`[Test] Iframe-aware hover succeeded in frame ${inFrame.frameUrl.slice(0, 80)}`);
        }
        await waitForInteractionSettle2(page, 1500);
        result.actual_result = `Hovered over ${step.selector}`;
        break;
      case "select-option":
        logger.info(`[Test] select-option: waiting for dropdown option ${step.selector}`);
        try {
          const optionLocator = await getStrictLocator(page, step.selector, false, step.alt_selectors);
          await optionLocator.waitFor({ state: "attached", timeout: 15e3 });
          await page.waitForTimeout(100);
          try {
            await optionLocator.scrollIntoViewIfNeeded({ timeout: 3e3 });
            await page.waitForTimeout(100);
          } catch (scrollErr) {
            logger.info(`[Test] select-option scroll skipped: ${scrollErr}`);
          }
          await optionLocator.waitFor({ state: "visible", timeout: 5e3 });
          await optionLocator.click({ timeout: 5e3 });
          await waitForInteractionSettle2(page, 2e3);
        } catch (e) {
          const errorMsg = e.message || "";
          logger.info(`[Test] select-option standard approach failed: ${errorMsg}`);
          const cssSelector = playwrightToCssSelector(step.selector);
          if (cssSelector) {
            const clicked = await page.evaluate((sel) => {
              let el = document.querySelector(sel);
              if (!el) {
                const popperContainers = document.querySelectorAll('[data-popper-placement], [data-tippy-root], .tippy-box, [role="listbox"], [role="menu"]');
                for (const container of Array.from(popperContainers)) {
                  const found = container.querySelector(sel);
                  if (found) {
                    el = found;
                    break;
                  }
                }
              }
              if (el) {
                el.scrollIntoView({ behavior: "instant", block: "center" });
                el.click();
                return true;
              }
              return false;
            }, cssSelector);
            if (!clicked) {
              throw new Error(`Dropdown option "${step.selector}" not found or not clickable`);
            }
            await waitForInteractionSettle2(page, 2e3);
          } else {
            throw e;
          }
        }
        result.actual_result = `Selected dropdown option ${step.selector}`;
        break;
      case "focus":
        const focusLocator = await getStrictLocator(page, step.selector, false, step.alt_selectors);
        await focusLocator.focus({ timeout: 1e4 });
        result.actual_result = `Focused ${step.selector}`;
        break;
      case "press":
        const keyNames = ["Tab", "Enter", "Escape", "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Backspace", "Delete", "Home", "End", "PageUp", "PageDown", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"];
        const selectorIsKey = step.selector && keyNames.includes(step.selector.trim());
        if (selectorIsKey) {
          const keyToPress = step.selector.trim();
          await page.keyboard.press(keyToPress);
          result.actual_result = `Pressed ${keyToPress} on page`;
        } else if (step.selector && step.selector.trim() !== "") {
          const pressLocator = await getStrictLocator(page, step.selector, false, step.alt_selectors);
          await pressLocator.press(step.value || "Enter", { timeout: 1e4 });
          result.actual_result = `Pressed ${step.value || "Enter"} on ${step.selector}`;
        } else {
          await page.keyboard.press(step.value || "Enter");
          result.actual_result = `Pressed ${step.value || "Enter"} on page`;
        }
        break;
      case "scroll":
        if (step.selector) {
          if (step.selector.toLowerCase() === "footer") {
            let scrolled = false;
            for (const sel of ["footer", '[role="contentinfo"]']) {
              try {
                const count = await page.locator(sel).count();
                if (count > 0) {
                  await page.locator(sel).first().scrollIntoViewIfNeeded({ timeout: 5e3 });
                  scrolled = true;
                  break;
                }
              } catch {
              }
            }
            if (!scrolled) {
              await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            }
          } else {
            const scrollLocator = await getStrictLocator(page, step.selector, false, step.alt_selectors);
            await scrollLocator.scrollIntoViewIfNeeded({ timeout: 1e4 });
          }
        } else {
          await page.evaluate(() => window.scrollBy(0, 300));
        }
        result.actual_result = `Scrolled to ${step.selector || "page"}`;
        break;
      case "wait":
        const waitTime = parseInt(step.value || "1000");
        await page.waitForTimeout(waitTime);
        result.actual_result = `Waited ${waitTime}ms`;
        break;
      case "wait_for_url":
      case "wait-for-url":
      case "waitforurl": {
        const rawPattern = (step.selector || step.value || (typeof step.action === "object" ? step.action?.value : "") || "").toString().trim();
        if (!rawPattern) {
          result.actual_result = "wait_for_url: no pattern, skipped";
          break;
        }
        try {
          if (rawPattern.includes("*")) {
            await page.waitForURL(rawPattern, { timeout: 12e3, waitUntil: "domcontentloaded" });
          } else {
            const needle = rawPattern.replace(/^https?:\/\/[^/]+/, "");
            await page.waitForURL((u) => u.toString().includes(needle), { timeout: 12e3, waitUntil: "domcontentloaded" });
          }
          result.actual_result = `URL matched ${rawPattern}: ${page.url()}`;
        } catch {
          result.actual_result = `wait_for_url timeout for "${rawPattern}" (current: ${page.url()}) \u2014 continuing`;
          logger.info(`[Test] wait_for_url "${rawPattern}" did not match within timeout (current ${page.url()}) \u2014 continuing`);
        }
        break;
      }
      case "scan-qr":
      case "scan-barcode":
      case "scan": {
        const qrPayload = step.value || "";
        if (!qrPayload) {
          throw new Error(`scan-qr step requires a value (the payload to inject as the scanned code)`);
        }
        await page.addInitScript((payload) => {
          window.__aegisQRPayload = payload;
          try {
            const BD = window.BarcodeDetector;
            if (BD && BD.prototype && BD.prototype.detect) {
              BD.prototype.detect = async function() {
                return [{ rawValue: payload, format: "qr_code", boundingBox: { x: 0, y: 0, width: 100, height: 100 }, cornerPoints: [] }];
              };
            }
          } catch {
          }
        }, qrPayload);
        await page.evaluate((payload) => {
          window.__aegisQRPayload = payload;
          try {
            const BD = window.BarcodeDetector;
            if (BD && BD.prototype && BD.prototype.detect) {
              BD.prototype.detect = async () => [{ rawValue: payload, format: "qr_code", boundingBox: { x: 0, y: 0, width: 100, height: 100 }, cornerPoints: [] }];
            }
          } catch {
          }
        }, qrPayload);
        if (step.selector) {
          const scanLocator = await getStrictLocator(page, step.selector, false, step.alt_selectors);
          await scanLocator.click({ timeout: 1e4 });
          await page.waitForTimeout(500);
          result.actual_result = `Triggered scanner ${step.selector} with payload ${qrPayload.slice(0, 32)}${qrPayload.length > 32 ? "\u2026" : ""}`;
        } else {
          result.actual_result = `Pre-loaded scanner payload ${qrPayload.slice(0, 32)}${qrPayload.length > 32 ? "\u2026" : ""}`;
        }
        break;
      }
      case "network":
      case "throttle":
      case "network-condition": {
        const condition = (step.value || "").toLowerCase().trim();
        try {
          const cdpSession = await page.context().newCDPSession(page);
          if (condition === "offline") {
            await cdpSession.send("Network.emulateNetworkConditions", {
              offline: true,
              latency: 0,
              downloadThroughput: 0,
              uploadThroughput: 0
            });
            result.actual_result = `Network set to offline`;
          } else if (condition === "slow-3g" || condition === "slow3g") {
            await cdpSession.send("Network.emulateNetworkConditions", {
              offline: false,
              latency: 2e3,
              downloadThroughput: 5e4,
              uploadThroughput: 5e4
            });
            result.actual_result = `Network throttled to Slow 3G`;
          } else if (condition === "fast-3g" || condition === "fast3g" || condition === "3g") {
            await cdpSession.send("Network.emulateNetworkConditions", {
              offline: false,
              latency: 562,
              downloadThroughput: 18e4,
              uploadThroughput: 84375
            });
            result.actual_result = `Network throttled to Fast 3G`;
          } else {
            await cdpSession.send("Network.emulateNetworkConditions", {
              offline: false,
              latency: 0,
              downloadThroughput: -1,
              uploadThroughput: -1
            });
            result.actual_result = `Network conditions reset to online`;
          }
        } catch (cdpErr) {
          logger.info(`[Test] Network throttling not available: ${cdpErr?.message || cdpErr}`);
          result.actual_result = `Network throttling skipped (not supported in this browser)`;
        }
        break;
      }
      case "viewport":
      case "resize":
      case "set-viewport": {
        const vpValue = step.value || "1920x1080";
        const vpParts = vpValue.split(/[x,×]/i);
        const vpWidth = parseInt(vpParts[0]) || 1920;
        const vpHeight = parseInt(vpParts[1]) || 1080;
        await page.setViewportSize({ width: vpWidth, height: vpHeight });
        await page.waitForTimeout(500);
        await page.waitForLoadState("domcontentloaded", { timeout: 3e3 }).catch(() => {
        });
        result.actual_result = `Resized viewport to ${vpWidth}x${vpHeight}`;
        break;
      }
      case "wait-for-selector":
        const waitLocator = await getStrictLocator(page, step.selector, false, step.alt_selectors);
        await waitLocator.waitFor({ state: "attached", timeout: 1e4 });
        try {
          await waitLocator.scrollIntoViewIfNeeded({ timeout: 3e3 });
        } catch (scrollErr) {
        }
        await waitLocator.waitFor({ state: "visible", timeout: 1e4 });
        result.actual_result = `Waited for ${step.selector}`;
        break;
      case "assert":
      case "assertion":
      case "verify-visible": {
        const actionObj = typeof step.assertions === "object" && step.assertions ? step.assertions : typeof step.action === "string" ? (() => {
          try {
            return JSON.parse(step.action);
          } catch {
            return null;
          }
        })() : step.action;
        let assertType = step.assertions?.type || actionObj?.type;
        if (typeof assertType === "string") {
          const canonURLVis = {
            "url-contains": "url_contains",
            "urlcontains": "url_contains",
            "url-not-contains": "url_not_contains",
            "url-notcontains": "url_not_contains",
            "invisible": "hidden",
            "not-present": "hidden"
          };
          const k = assertType.toLowerCase().trim();
          if (canonURLVis[k]) assertType = canonURLVis[k];
        }
        const assertExpectedRaw = step.assertions?.expected ?? actionObj?.expected;
        const assertTargetRaw = step.assertions?.target ?? actionObj?.target;
        const expectedIsBool = typeof assertExpectedRaw === "boolean";
        const isNegatedUrl = assertType === "url_not_contains" || assertType === "url_contains" && assertExpectedRaw === false;
        const expectedValue = expectedIsBool ? assertTargetRaw || step.selector || step.value || "" : assertExpectedRaw || assertTargetRaw || step.value || "";
        const selectorStr = typeof step.selector === "string" ? step.selector : "";
        if ((!assertType || assertType === "visible" || assertType === "url_contains") && selectorStr) {
          if (/^\/[a-zA-Z0-9\-_\/\?\=\&\#\.]*$/.test(selectorStr) || /^\*?\*?\/[a-zA-Z0-9\-_\/]*\*?\*?$/.test(selectorStr) || selectorStr.includes("**/")) {
            assertType = "url";
            logger.info(`[Test] Auto-converted selector "${selectorStr}" to URL assertion`);
          }
        }
        if (assertType === "url_contains" || assertType === "url_not_contains") {
          assertType = "url";
        }
        if (assertType) {
          const at = String(assertType).toLowerCase().trim();
          const ALIAS = {
            "text-contains": "text_present",
            "text_contains": "text_present",
            "contains_text": "text_present",
            "text-present": "text_present",
            "assert-contains": "text_present",
            "assert-text": "text_present",
            "has-text": "text_present",
            "text-absent": "text_absent",
            "not_text": "text_absent",
            "absent": "text_absent",
            "text-matches": "text_matches",
            "text-regex": "text_matches",
            "text_regex": "text_matches",
            "matches": "text_matches",
            "api-status": "api_status",
            "is-checked": "checked",
            "is_checked": "checked",
            "is-hidden": "hidden",
            "is_hidden": "hidden",
            "not-visible": "hidden",
            "not_visible": "hidden",
            "assert-hidden": "hidden",
            "is-visible": "visible",
            "is_visible": "visible",
            "assert-visible": "visible",
            "clickable": "enabled",
            "is-clickable": "enabled",
            "value": "value_equals",
            "has_value": "value_equals",
            "input_value": "value_equals",
            "value-equals": "value_equals",
            "assert-equals": "value_equals",
            // M3-LLM invented synonyms observed in the cross-app matrix (2026-07-12) —
            // the run hard-fails unknown types, so an un-canonicalized synonym = a
            // "verified but fails at run" defect. Map to the canonical dispatch types.
            "assert-url": "url",
            "asserturl": "url",
            "url-path": "url",
            "url_path": "url",
            "urlpath": "url",
            "urlpathcontains": "url",
            "title-contains": "title",
            "title_contains": "title",
            "titlecontains": "title",
            "title-includes": "title",
            "assert-title": "title",
            "assert-count": "count",
            "element-count": "count"
          };
          if (ALIAS[at]) assertType = ALIAS[at];
        }
        if (assertType === "capture-count" || assertType === "capture-text" || assertType === "assert-count-delta" || assertType === "assert-appears-in-list") {
          const aRaw = step.assertions || actionObj || {};
          const vars = page.__capturedVars = page.__capturedVars || {};
          const invTarget = String(assertTargetRaw || step.selector || "");
          const invLoc = page.locator(invTarget);
          const normInv = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
          const finishInv = (msg, status = "passed") => {
            result.status = status;
            result.actual_result = msg;
            const c = /* @__PURE__ */ new Date();
            result.completed_at = c.toISOString();
            result.duration_ms = c.getTime() - startedAt.getTime();
            logger.info(`[Test] Invariant ${assertType}: ${msg}`);
            return result;
          };
          const readCount = async () => {
            const elems = await invLoc.count().catch(() => -1);
            if (elems === 1) {
              const txt = (await invLoc.first().textContent({ timeout: 2e3 }).catch(() => null) || "").trim();
              const aria = await invLoc.first().getAttribute("aria-label").catch(() => null) || "";
              const m = (txt + " " + aria).match(/\d[\d,]*/);
              if (m) return parseInt(m[0].replace(/,/g, ""), 10);
            }
            return elems === 0 ? -1 : elems;
          };
          try {
            if (assertType === "capture-count") {
              const cnt = await readCount();
              if (aRaw.storeAs && cnt >= 0) vars[aRaw.storeAs] = cnt;
              return finishInv(cnt >= 0 ? `Captured count(${invTarget})=${cnt} as "${aRaw.storeAs}"` : `Capture skipped \u2014 "${invTarget}" unresolved`, cnt >= 0 ? "passed" : "skipped");
            }
            if (assertType === "capture-text") {
              let v = (await invLoc.first().textContent({ timeout: 5e3 }).catch(() => null) || "").trim();
              if (!v) v = await invLoc.first().inputValue({ timeout: 2e3 }).catch(() => "") || "";
              if (aRaw.storeAs && v) vars[aRaw.storeAs] = v;
              return finishInv(v ? `Captured text "${v}" as "${aRaw.storeAs}"` : `Capture skipped \u2014 no text at "${invTarget}"`, v ? "passed" : "skipped");
            }
            if (assertType === "assert-count-delta") {
              const before = vars[aRaw.fromCapture || ""];
              if (typeof before !== "number") return finishInv(`Skipped count-delta \u2014 no prior capture "${aRaw.fromCapture}"`, "skipped");
              const want = typeof aRaw.expectedDelta === "number" ? aRaw.expectedDelta : 1;
              let after = -1;
              for (let t = 0; t < 4; t++) {
                after = await readCount();
                if (after < 0) break;
                const moved = want > 0 ? after > before : want < 0 ? after < before : after !== before;
                if (moved) return finishInv(`Count moved ${before}\u2192${after} (${want >= 0 ? "increase" : "decrease"} expected)`);
                await page.waitForTimeout(600).catch(() => {
                });
              }
              if (after < 0) return finishInv(`Skipped count-delta \u2014 "${invTarget}" unresolved`, "skipped");
              throw new Error(`Count of "${invTarget}" did not ${want >= 0 ? "increase" : "decrease"} after the action (was ${before}, now ${after})`);
            }
            const needle = normInv(String((aRaw.fromCapture ? vars[aRaw.fromCapture] : void 0) ?? assertExpectedRaw ?? ""));
            if (needle.length < 4 || !/[a-z]{3,}/.test(needle) || /^[\d\s.,:\/$-]+$/.test(needle)) {
              return finishInv(`Skipped appears-in-list \u2014 unstable or missing identifier "${needle}"`, "skipped");
            }
            const prefix2 = needle.slice(0, Math.min(24, needle.length));
            const hitInv = (hay) => {
              const h = normInv(hay);
              return h.includes(needle) || prefix2.length >= 6 && h.includes(prefix2);
            };
            const containers = [invTarget, "table", '[role="table"]', '[role="grid"]', '[role="list"]', "main"].filter(Boolean);
            for (let t = 0; t < 5; t++) {
              for (const sel of containers) {
                const loc = page.locator(sel);
                if (await loc.count().catch(() => 0) === 0) continue;
                if (hitInv(await loc.first().textContent({ timeout: 3e3 }).catch(() => "") || "")) return finishInv(`"${needle}" found in ${sel}`);
              }
              if (hitInv(await page.locator("body").textContent({ timeout: 3e3 }).catch(() => "") || "")) return finishInv(`"${needle}" found on page`);
              if (await page.getByText(needle, { exact: false }).count().catch(() => 0) > 0) return finishInv(`"${needle}" found via text search`);
              if (prefix2.length >= 6 && await page.getByText(prefix2, { exact: false }).count().catch(() => 0) > 0) return finishInv(`prefix "${prefix2}" found via text search`);
              await page.waitForTimeout(600).catch(() => {
              });
            }
            throw new Error(`Expected "${needle}" to appear on the page after the action, but it was not found`);
          } catch (invErr) {
            result.status = "failed";
            result.error_message = invErr?.message || String(invErr);
            const c = /* @__PURE__ */ new Date();
            result.completed_at = c.toISOString();
            result.duration_ms = c.getTime() - startedAt.getTime();
            return result;
          }
        }
        if (allowAutoLogin && isLoginPageUrl(page.url()) && credentials) {
          const isExpectingLoginPage = assertType === "url" && isLoginPageUrl(expectedValue);
          if (isExpectingLoginPage) {
            logger.info(`[Test] On login page as expected by URL assertion, skipping auto-login`);
          } else {
            logger.info(`[Test] Assertion step: currently on login page, attempting auto-login first...`);
            await handleAutoLogin(page, credentials);
          }
        }
        if (assertType === "status" || assertType === "http_status") {
          const expectedStatus = Number(step.assertions.expected ?? step.value ?? 200);
          const actualStatus = page.__lastNavStatus;
          if (typeof actualStatus !== "number") {
            result.actual_result = `HTTP status not observed for this step \u2014 skipped`;
          } else if (actualStatus !== expectedStatus) {
            throw new Error(`HTTP status assertion failed: expected ${expectedStatus} but got ${actualStatus}`);
          } else {
            result.actual_result = `Verified HTTP status ${actualStatus}`;
          }
        } else if (assertType === "title") {
          const expectedTitle = step.assertions.expected || step.value;
          let actualTitle = await page.title();
          const normT = (s) => (s || "").trim().toLowerCase();
          const titleMatches = () => {
            const a = normT(actualTitle), e = normT(expectedTitle);
            return !!e && (a === e || a.includes(e) || a !== "" && e.includes(a));
          };
          if (expectedTitle && !titleMatches()) {
            await page.waitForTimeout(800);
            actualTitle = await page.title();
          }
          if (expectedTitle && !titleMatches()) {
            if (actualTitle === "") {
              logger.info(`[Test] Title is empty \u2014 page may have redirected or require auth, skipping strict title check`);
              result.actual_result = `Page title is empty (expected "${expectedTitle}") \u2014 page may have redirected or require authentication`;
            } else {
              throw new Error(`Title assertion failed: expected "${expectedTitle}" but got "${actualTitle}"`);
            }
          } else {
            result.actual_result = `Verified page title: "${actualTitle}"`;
          }
        } else if (assertType === "attribute") {
          const targetSelector = step.assertions.target || step.selector;
          const expectedValue2 = step.assertions.expected;
          const attrNameFromAssertion = step.assertions.attribute;
          if (!targetSelector || targetSelector.trim() === "") {
            return skipNoTarget("Attribute");
          }
          const attrLocator = await getStrictLocator(page, targetSelector, true, step.alt_selectors);
          try {
            await attrLocator.waitFor({ state: "attached", timeout: 5e3 });
          } catch {
            throw new Error(`Attribute assertion failed: element "${targetSelector}" not found in DOM (attribute: ${attrNameFromAssertion || "auto-detect"})`);
          }
          let attrName = attrNameFromAssertion;
          if (!attrName) {
            if (targetSelector.includes("meta[")) {
              attrName = "content";
            } else if (targetSelector === "html") {
              attrName = "lang";
            } else if (targetSelector.includes("[target=")) {
              attrName = "target";
            } else if (targetSelector.includes("[rel=")) {
              attrName = "rel";
            } else if (targetSelector.includes("[role=")) {
              attrName = "role";
            } else if (targetSelector.includes("[aria-")) {
              const ariaMatch = targetSelector.match(/\[(aria-[^=\]]+)/);
              attrName = ariaMatch ? ariaMatch[1] : "aria-label";
            } else if (targetSelector === "main" || targetSelector === "nav" || targetSelector === "header" || targetSelector === "footer") {
              attrName = "role";
            } else if (targetSelector.includes("a[") && targetSelector.includes("aria-current")) {
              attrName = "aria-current";
            } else {
              if (expectedValue2 === "_blank" || expectedValue2 === "_self" || expectedValue2 === "_parent") {
                attrName = "target";
              } else if (expectedValue2 === "noopener" || expectedValue2 === "noreferrer" || expectedValue2 === "nofollow") {
                attrName = "rel";
              } else if (expectedValue2 === "en" || expectedValue2 === "es" || expectedValue2 === "fr" || expectedValue2 === "de") {
                attrName = "lang";
              } else if (expectedValue2 === "navigation" || expectedValue2 === "main" || expectedValue2 === "banner" || expectedValue2 === "contentinfo") {
                attrName = "role";
              } else if (expectedValue2?.startsWith("tel:") || expectedValue2?.startsWith("mailto:") || expectedValue2?.startsWith("http://") || expectedValue2?.startsWith("https://") || expectedValue2?.startsWith("/")) {
                attrName = "href";
              } else if (expectedValue2 === "true" || expectedValue2 === "false") {
                const el = await attrLocator.elementHandle();
                if (el) {
                  for (const attr of ["aria-expanded", "aria-hidden", "aria-checked", "aria-selected", "aria-pressed", "aria-disabled", "disabled", "checked", "hidden"]) {
                    const val = await attrLocator.getAttribute(attr);
                    if (val === expectedValue2) {
                      attrName = attr;
                      break;
                    }
                  }
                }
                if (!attrName) attrName = "aria-expanded";
              } else {
                const el = await attrLocator.elementHandle();
                if (el) {
                  for (const attr of ["lang", "role", "target", "rel", "href", "src", "aria-label", "aria-current", "aria-expanded", "value"]) {
                    const val = await attrLocator.getAttribute(attr);
                    if (val === expectedValue2) {
                      attrName = attr;
                      break;
                    }
                  }
                }
                if (!attrName) attrName = "value";
              }
            }
          }
          let actualValue;
          if (attrName === "value") {
            try {
              actualValue = await attrLocator.inputValue();
            } catch {
              actualValue = await attrLocator.getAttribute(attrName);
            }
          } else if (attrName === "focused") {
            const isFocused = await attrLocator.evaluate((el) => document.activeElement === el);
            actualValue = isFocused ? "true" : "false";
          } else {
            actualValue = await attrLocator.getAttribute(attrName);
          }
          const normalizedActual = actualValue?.trim() || "";
          if (expectedValue2 === true) {
            if (!actualValue) {
              throw new Error(`Attribute assertion failed: expected attribute "${attrName}" to exist but it was not found`);
            }
            result.actual_result = `Verified ${attrName} exists with value "${normalizedActual.substring(0, 50)}"`;
          } else {
            const normalizedExpected = typeof expectedValue2 === "string" ? expectedValue2.trim() : String(expectedValue2 || "");
            if (normalizedExpected && normalizedActual !== normalizedExpected) {
              throw new Error(`Attribute assertion failed: expected "${normalizedExpected}" but got "${normalizedActual}" (attribute: ${attrName})`);
            }
            result.actual_result = `Verified ${attrName}="${normalizedActual.substring(0, 50)}"`;
          }
        } else if (assertType === "url") {
          let expectedUrl = expectedValue;
          if (typeof expectedUrl === "string" && expectedUrl.startsWith("contains:")) {
            expectedUrl = expectedUrl.slice("contains:".length);
          }
          if (typeof expectedUrl === "string") {
            expectedUrl = expectedUrl.replace(/^\s*(the\s+)?(url|page|path)?\s*(should\s+)?(currently\s+)?(contains?|includes?|equals?|is|be|match(?:es)?|redirects?\s+to|navigates?\s+to)\b[:\s]*/i, "").trim();
            if (/\\[\/.\-?=&#]/.test(expectedUrl)) {
              expectedUrl = expectedUrl.replace(/\\([\/.\-?=&#])/g, "$1");
            }
            expectedUrl = expectedUrl.replace(/^["'`]|["'`]$/g, "").trim();
          }
          if (typeof expectedUrl === "string" && expectedUrl.includes("*")) {
            expectedUrl = expectedUrl.replace(/\*+/g, "").replace(/\/{2,}/g, "/");
          }
          const normalizeUrl = (url) => {
            if (!url || typeof url !== "string") return String(url || "").toLowerCase();
            try {
              return decodeURIComponent(url.replace(/\+/g, " ")).toLowerCase();
            } catch {
              return url.toLowerCase();
            }
          };
          logger.info(`[Test] URL assertion: waiting for URL to contain "${expectedUrl}"`);
          try {
            await page.waitForLoadState("domcontentloaded", { timeout: 5e3 }).catch(() => {
            });
            const normalizedExpected2 = normalizeUrl(expectedUrl);
            const dynExpected = stripVolatileUrlSegments(normalizedExpected2);
            await page.waitForURL((url) => {
              const n = normalizeUrl(url.toString());
              return n.includes(normalizedExpected2) || stripVolatileUrlSegments(n).includes(dynExpected);
            }, { timeout: 15e3 });
            logger.info(`[Test] URL matched after waiting: ${page.url()}`);
          } catch (urlWaitErr) {
            logger.info(`[Test] URL wait timeout, current URL: ${page.url()}`);
          }
          const currentUrl = page.url();
          const normalizedCurrent = normalizeUrl(currentUrl);
          const normalizedExpected = normalizeUrl(expectedUrl);
          if (isNegatedUrl) {
            if (expectedUrl && normalizedCurrent.includes(normalizedExpected)) {
              let bornUnderX = false;
              try {
                const entry = String(page.__entryUrl || "").toLowerCase();
                if (entry && normalizedExpected && entry.includes(normalizedExpected)) bornUnderX = true;
                if (!bornUnderX && entry && normalizedExpected.endsWith("?")) {
                  const expPathBareQ = normalizedExpected.slice(0, -1);
                  if (expPathBareQ.length > 1 && entry.includes(expPathBareQ)) bornUnderX = true;
                }
                if (!bornUnderX) {
                  const curPath = new URL(currentUrl).pathname.toLowerCase().replace(/\/+$/, "");
                  const expPath = String(normalizedExpected).replace(/^https?:\/\/[^/]+/, "").replace(/\/+$/, "");
                  if (expPath.startsWith("/") && curPath.startsWith(expPath) && curPath.length > expPath.length && curPath[expPath.length] === "/") {
                    bornUnderX = true;
                  }
                }
              } catch {
              }
              if (bornUnderX) {
                result.status = "skipped";
                result.actual_result = `Skipped malformed negated-URL oracle: the page is on/under "${expectedUrl}" (current: ${currentUrl}, entry: ${page.__entryUrl || "n/a"}) \u2014 "must NOT contain" can never hold`;
                logger.info(`[Test] skip-on-doubt: negated URL oracle "${expectedUrl}" unsatisfiable on ${currentUrl}`);
                break;
              }
              throw new Error(`URL assertion failed: expected URL to NOT contain "${expectedUrl}" but current URL is "${currentUrl}"`);
            }
            result.actual_result = `Verified URL does not contain "${expectedUrl}" (current: ${currentUrl})`;
            break;
          }
          const dropTrailingSlash = (s) => s.replace(/\/(?=$|[?#])/, "");
          const curTS = dropTrailingSlash(normalizedCurrent);
          const expTS = dropTrailingSlash(normalizedExpected);
          const urlMatchesPositive = !!expectedUrl && (normalizedCurrent.includes(normalizedExpected) || curTS.includes(expTS) || stripVolatileUrlSegments(normalizedCurrent).includes(stripVolatileUrlSegments(normalizedExpected)));
          if (expectedUrl && !urlMatchesPositive) {
            logger.info(`[Test] URL mismatch, checking for target="_blank" links with href containing: ${expectedUrl}`);
            let foundBlankLink = false;
            try {
              const linkSelectors = [
                `a[href="${expectedUrl}"]`,
                `a[href$="${expectedUrl}"]`,
                // Ends with the path
                `a[href*="${expectedUrl.replace(/^\//, "")}"]`
                // Contains the path without leading slash
              ];
              const isExternalUrl = /^https?:\/\//i.test(expectedUrl);
              if (isExternalUrl) {
                try {
                  const expectedDomain = new URL(expectedUrl).hostname;
                  linkSelectors.push(`a[href*="${expectedDomain}"]`);
                } catch {
                }
              }
              for (const sel of linkSelectors) {
                try {
                  const linkEl = page.locator(sel).first();
                  if (await linkEl.count() > 0) {
                    const target = await linkEl.getAttribute("target");
                    const href = await linkEl.getAttribute("href") || "";
                    if (target === "_blank") {
                      const hrefMatches = isExternalUrl ? normalizeUrl(href).includes(normalizedExpected.replace(/^https?:\/\//, "")) : href.includes(expectedUrl) || href.endsWith(expectedUrl);
                      if (hrefMatches) {
                        logger.info(`[Test] Found target="_blank" link with matching href: ${href}`);
                        result.actual_result = `Verified link href="${href}" (opens in new tab)`;
                        foundBlankLink = true;
                        break;
                      }
                    }
                  }
                } catch {
                }
              }
            } catch (linkErr) {
              logger.info(`[Test] Error checking for target="_blank" links: ${linkErr}`);
            }
            if (!foundBlankLink) {
              throw new Error(`URL assertion failed: expected "${expectedUrl}" in ${currentUrl}`);
            }
          } else {
            result.actual_result = `Verified URL contains "${expectedUrl}"`;
          }
        } else if (assertType === "text") {
          const targetSelector = step.assertions.target || step.selector;
          const expectedText = step.assertions.expected || step.value;
          if (!targetSelector || targetSelector.trim() === "") {
            return skipNoTarget("Text");
          }
          const textLocator = await getStrictLocator(page, targetSelector, true, step.alt_selectors);
          try {
            await textLocator.scrollIntoViewIfNeeded({ timeout: 3e3 });
          } catch (scrollErr) {
          }
          const actualText = await textLocator.evaluate((el) => {
            const clone = el.cloneNode(true);
            clone.querySelectorAll("br").forEach((br) => br.replaceWith(" "));
            return clone.textContent || "";
          });
          const normalizedActual = normalizeText(actualText);
          let normalizedExpected = normalizeText(expectedText);
          const isContainsMatch = normalizedExpected.toLowerCase().startsWith("contains:");
          if (isContainsMatch) {
            normalizedExpected = normalizedExpected.slice("contains:".length).trim();
          }
          if (normalizedExpected) {
            const actualLower = normalizedActual.toLowerCase();
            const expectedLower = normalizedExpected.toLowerCase();
            if (!actualLower.includes(expectedLower)) {
              const ariaLabel = await textLocator.getAttribute("aria-label").catch(() => null);
              const titleAttr = await textLocator.getAttribute("title").catch(() => null);
              const ariaLabelNorm = normalizeText(ariaLabel || "").toLowerCase();
              const titleNorm = normalizeText(titleAttr || "").toLowerCase();
              if (ariaLabelNorm.includes(expectedLower) || titleNorm.includes(expectedLower)) {
                logger.info(`[Test] Text assertion: textContent "${normalizedActual}" didn't match "${normalizedExpected}", but aria-label/title did \u2014 passing with fallback`);
              } else {
                throw new Error(`Text assertion failed: expected "${normalizedExpected}" but got "${normalizedActual}"`);
              }
            }
          }
          result.actual_result = `Verified text "${normalizedActual.substring(0, 50)}" contains "${normalizedExpected}"`;
        } else if (assertType === "visible") {
          const targetSelector = step.assertions.target || step.selector;
          const rawExpected = step.assertions.expected;
          const expectedVisible = rawExpected === null || rawExpected === void 0 ? true : rawExpected;
          if (!targetSelector || targetSelector.trim() === "") {
            return skipNoTarget("Visibility");
          }
          logger.info(`[Test] Visibility check for "${targetSelector}" at URL: ${page.url()}`);
          let visLocator = await getStrictLocator(page, targetSelector, true, step.alt_selectors);
          let elementInDom = true;
          try {
            await visLocator.waitFor({ state: "attached", timeout: 8e3 });
          } catch (attachErr) {
            logger.info(`[Test] Element "${targetSelector}" not found, waiting for SPA to finish rendering...`);
            await waitForSPAReady(page);
            try {
              await visLocator.waitFor({ state: "attached", timeout: 5e3 });
              logger.info(`[Test] Element "${targetSelector}" found after SPA wait`);
            } catch {
              logger.info(`[Test] Element "${targetSelector}" not found in DOM even after SPA wait`);
              elementInDom = false;
            }
          }
          if (!elementInDom && expectedVisible !== false) {
            const inFrame = await findInFrames(page, targetSelector);
            if (inFrame) {
              visLocator = inFrame.locator;
              elementInDom = true;
              logger.info(`[Test] Visibility target "${targetSelector}" found inside frame ${inFrame.frameUrl}`);
            }
          }
          if (!elementInDom) {
            if (expectedVisible === false) {
              result.actual_result = `Verified ${targetSelector} is not visible (not in DOM)`;
              break;
            }
            throw new Error(`Visibility assertion failed: element ${targetSelector} not found in DOM`);
          }
          try {
            await visLocator.scrollIntoViewIfNeeded({ timeout: 3e3 });
            await page.waitForTimeout(300);
            logger.info(`[Test] Scrolled element into view: ${targetSelector}`);
          } catch (scrollErr) {
            logger.info(`[Test] Could not scroll element into view: ${scrollErr instanceof Error ? scrollErr.message : scrollErr}`);
          }
          let isVisible = await visLocator.isVisible();
          if (!isVisible && expectedVisible !== false) {
            logger.info(`[Test] Element not immediately visible, waiting for visibility...`);
            try {
              await visLocator.waitFor({ state: "visible", timeout: 5e3 });
              isVisible = true;
              logger.info(`[Test] Element became visible after waiting`);
            } catch (visWaitErr) {
              logger.info(`[Test] Element still not visible after waiting`);
            }
          }
          if (!isVisible && expectedVisible !== false && elementInDom) {
            logger.info(`[Test] Element in DOM but hidden \u2014 trying to expand collapsed parent...`);
            const expanded = await visLocator.evaluate((el) => {
              let current = el.parentElement;
              while (current && current !== document.body) {
                const style = window.getComputedStyle(current);
                const isHidden = style.display === "none" || style.visibility === "hidden" || style.maxHeight === "0px" && style.overflow === "hidden" || current.clientHeight === 0 && style.overflow === "hidden";
                if (isHidden) {
                  const prevSibling = current.previousElementSibling;
                  if (prevSibling) {
                    const toggle = prevSibling.querySelector('button, [role="button"], .header, summary, span') || (prevSibling.getAttribute("role") === "button" ? prevSibling : null);
                    if (toggle) {
                      toggle.click();
                      return true;
                    }
                    if (prevSibling.tagName === "BUTTON" || prevSibling.tagName === "SUMMARY" || prevSibling.tagName === "DIV" || prevSibling.tagName === "SPAN" || prevSibling.classList.contains("header") || prevSibling.classList.contains("group-header") || prevSibling.classList.contains("card-header") || prevSibling.classList.contains("accordion-button")) {
                      prevSibling.click();
                      return true;
                    }
                  }
                  const parent = current.parentElement;
                  if (parent) {
                    const firstChild = parent.firstElementChild;
                    if (firstChild && firstChild !== current) {
                      const toggle = firstChild.querySelector('button, [role="button"], summary, span');
                      if (toggle) {
                        toggle.click();
                        return true;
                      }
                      if (firstChild.tagName !== "STYLE" && firstChild.tagName !== "SCRIPT" && firstChild.tagName !== "LINK") {
                        firstChild.click();
                        return true;
                      }
                    }
                  }
                  const containerId = current.id;
                  if (containerId) {
                    const toggle = document.querySelector(`[aria-controls="${containerId}"], [data-target="#${containerId}"], [data-bs-target="#${containerId}"]`);
                    if (toggle) {
                      toggle.click();
                      return true;
                    }
                  }
                }
                current = current.parentElement;
              }
              return false;
            }).catch(() => false);
            if (expanded) {
              logger.info(`[Test] Clicked a collapsed parent toggle \u2014 waiting for expansion...`);
              await page.waitForTimeout(800);
              isVisible = await visLocator.isVisible();
              if (!isVisible) {
                try {
                  await visLocator.waitFor({ state: "visible", timeout: 3e3 });
                  isVisible = true;
                } catch {
                }
              }
              logger.info(`[Test] After expansion: isVisible=${isVisible}`);
            }
          }
          logger.info(`[Test] Element "${targetSelector}" isVisible=${isVisible}, expected=${expectedVisible}`);
          if (typeof expectedVisible === "boolean") {
            if (isVisible !== expectedVisible) {
              throw new Error(`Visibility assertion failed: expected element to be ${expectedVisible ? "visible" : "hidden"}, but it was ${isVisible ? "visible" : "hidden"}`);
            }
            result.actual_result = `Verified ${targetSelector} is ${isVisible ? "visible" : "hidden"}`;
          } else if (typeof expectedVisible === "string" && expectedVisible.trim() !== "") {
            if (!isVisible) {
              throw new Error(`Visibility assertion failed: element ${targetSelector} is not visible`);
            }
            const textContent = await visLocator.textContent() || "";
            const normalizedActual = normalizeText(textContent);
            const normalizedExpected = normalizeText(expectedVisible);
            if (!normalizedActual.includes(normalizedExpected)) {
              throw new Error(`Visibility+text assertion failed: element is visible but text "${normalizedActual.substring(0, 100)}" does not contain "${normalizedExpected}"`);
            }
            result.actual_result = `Verified ${targetSelector} is visible and contains text "${normalizedExpected}"`;
          } else if (expectedVisible !== void 0) {
            const shouldBeVisible = Boolean(expectedVisible);
            if (isVisible !== shouldBeVisible) {
              throw new Error(`Visibility assertion failed: expected element to be ${shouldBeVisible ? "visible" : "hidden"}, but it was ${isVisible ? "visible" : "hidden"}`);
            }
            result.actual_result = `Verified ${targetSelector} is ${isVisible ? "visible" : "hidden"}`;
          } else {
            if (!isVisible) {
              throw new Error(`Visibility assertion failed: element ${targetSelector} is not visible`);
            }
            result.actual_result = `Verified ${targetSelector} is visible`;
          }
        } else if (assertType === "focused") {
          const targetSelector = step.assertions.target || step.selector;
          if (!targetSelector || targetSelector.trim() === "") {
            return skipNoTarget("Focus");
          }
          const cssFocusSelector = playwrightToCssSelector(targetSelector);
          if (!cssFocusSelector) {
            throw new Error(`Focus assertion failed: selector "${targetSelector}" contains Playwright-specific syntax that cannot be used with native browser API`);
          }
          const isFocused = await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            return el === document.activeElement;
          }, cssFocusSelector);
          const expectedFocused = step.assertions.expected !== false;
          if (isFocused !== expectedFocused) {
            throw new Error(`Focus assertion failed: expected ${expectedFocused}, got ${isFocused}`);
          }
          result.actual_result = `Verified ${targetSelector} is ${isFocused ? "focused" : "not focused"}`;
        } else if (assertType === "count") {
          const targetSelector = step.assertions.target || step.selector;
          const expectedCount = parseInt(step.assertions.expected || "0", 10);
          if (!targetSelector || targetSelector.trim() === "") {
            return skipNoTarget("Count");
          }
          const countLocator = targetSelector.startsWith("getBy") ? resolvePlaywrightLocator(page, targetSelector) || page.locator(targetSelector) : page.locator(targetSelector);
          const count = await countLocator.count();
          if (count < expectedCount) {
            throw new Error(`Count assertion failed: expected at least ${expectedCount} elements, got ${count}`);
          }
          result.actual_result = `Verified ${count} elements match "${targetSelector}"`;
        } else if (assertType === "response_header") {
          const headerName = step.assertions.target;
          const expectedPresent = step.assertions.expected;
          if (!headerName) {
            throw new Error(`Response header assertion requires a target header name`);
          }
          const currentUrl = page.url();
          const headResp = await page.request.head(currentUrl);
          const headerValue = headResp.headers()[headerName.toLowerCase()];
          if (expectedPresent === true || expectedPresent === "true") {
            if (!headerValue) {
              throw new Error(`Response header assertion failed: header "${headerName}" is not present`);
            }
            result.actual_result = `Verified header "${headerName}" is present: "${(headerValue || "").substring(0, 80)}"`;
          } else if (expectedPresent === false || expectedPresent === "false") {
            if (headerValue) {
              throw new Error(`Response header assertion failed: header "${headerName}" should not be present but has value "${headerValue}"`);
            }
            result.actual_result = `Verified header "${headerName}" is not present`;
          } else {
            const expectedStr = String(expectedPresent);
            if (!headerValue) {
              throw new Error(`Response header assertion failed: header "${headerName}" is not present (expected: "${expectedStr}")`);
            }
            if (!headerValue.toLowerCase().includes(expectedStr.toLowerCase())) {
              throw new Error(`Response header assertion failed: header "${headerName}" is "${headerValue}", expected to contain "${expectedStr}"`);
            }
            result.actual_result = `Verified header "${headerName}": "${headerValue.substring(0, 80)}"`;
          }
        } else if (assertType === "cookie_security") {
          const cookieName = step.assertions.target;
          if (!cookieName) {
            throw new Error(`Cookie security assertion requires a target cookie name`);
          }
          const cookies = await page.context().cookies(page.url());
          const cookie = cookies.find((c) => c.name === cookieName);
          if (!cookie) {
            throw new Error(`Cookie security assertion failed: cookie "${cookieName}" not found`);
          }
          const flags = [];
          if (cookie.httpOnly) flags.push("HttpOnly");
          if (cookie.secure) flags.push("Secure");
          if (cookie.sameSite && cookie.sameSite !== "None" && cookie.sameSite !== "none") flags.push(`SameSite=${cookie.sameSite}`);
          result.actual_result = `Verified cookie "${cookieName}" exists with flags: ${flags.length > 0 ? flags.join(", ") : "none"}`;
        } else if (assertType === "a11y_violation_count") {
          const impactLevel = String(step.assertions.target || "").toLowerCase();
          const expectedCount = Number(step.assertions.expected);
          if (!["critical", "serious", "moderate", "minor"].includes(impactLevel)) {
            throw new Error(`a11y_violation_count assertion requires target=critical|serious|moderate|minor, got "${impactLevel}"`);
          }
          if (Number.isNaN(expectedCount)) {
            throw new Error(`a11y_violation_count assertion requires numeric expected value`);
          }
          let results;
          try {
            results = await new AxeBuilder({ page }).analyze();
          } catch (axeErr) {
            throw new Error(`a11y audit failed: ${axeErr?.message || axeErr}`);
          }
          const matching = (results.violations || []).filter((v) => (v.impact || "").toLowerCase() === impactLevel);
          const actualCount = matching.length;
          if (actualCount > expectedCount) {
            const sample = matching.slice(0, 3).map((v) => `${v.id}: ${v.help}`).join("; ");
            const msg = `expected \u2264${expectedCount} ${impactLevel} a11y violations but found ${actualCount}${sample ? " \u2014 " + sample : ""}`;
            if (/^(1|true)$/i.test(String(process.env.AEGIS_A11Y_HARD_GATE || ""))) {
              throw new Error(`a11y assertion failed: ${msg}`);
            }
            result.actual_result = `\u26A0 a11y (reported, non-blocking): ${msg}`;
          } else {
            result.actual_result = `Verified ${actualCount} ${impactLevel} a11y violation(s) (threshold: ${expectedCount})`;
          }
        } else if (assertType === "console_error_count" || assertType === "network_error_count") {
          const isConsole = assertType === "console_error_count";
          const bucket = isConsole ? page.__consoleErrors : page.__networkErrors;
          const items = Array.isArray(bucket) ? bucket : [];
          const expectedMax = expectedIsBool ? 0 : Number(assertExpectedRaw ?? expectedValue);
          if (Number.isNaN(expectedMax)) {
            throw new Error(`${assertType} assertion requires a numeric expected value`);
          }
          const label = isConsole ? "console error" : "failed network request";
          if (items.length > expectedMax) {
            const sample = items.slice(0, 3).join(" | ");
            const msg = `expected \u2264${expectedMax} ${label}(s) but found ${items.length}${sample ? " \u2014 " + sample.slice(0, 200) : ""}`;
            if (/^(1|true)$/i.test(String(process.env.AEGIS_RUNTIME_ERROR_HARD_GATE || ""))) {
              throw new Error(`${assertType} assertion failed: ${msg}`);
            }
            result.actual_result = `\u26A0 ${assertType} (reported, non-blocking): ${msg}`;
          } else {
            result.actual_result = `Verified ${items.length} ${label}(s) (threshold: ${expectedMax})`;
          }
        } else if (assertType === "performance") {
          const metric = step.assertions.target;
          const threshold = parseFloat(String(step.assertions.expected || "0"));
          if (!metric) {
            throw new Error(`Performance assertion requires a target metric name`);
          }
          const metricValue = await page.evaluate((metricName) => {
            const perf = performance;
            if (metricName === "ttfb") {
              const nav = perf.getEntriesByType("navigation")[0];
              return nav ? nav.responseStart - nav.requestStart : null;
            }
            if (metricName === "fcp") {
              const fcp = perf.getEntriesByName("first-contentful-paint")[0];
              return fcp ? fcp.startTime : null;
            }
            if (metricName === "lcp") {
              const entries = perf.getEntriesByType("largest-contentful-paint");
              return entries.length > 0 ? entries[entries.length - 1].startTime : null;
            }
            if (metricName === "cls") {
              const entries = perf.getEntriesByType("layout-shift");
              let cls = 0;
              for (const e of entries) {
                if (!e.hadRecentInput) cls += e.value;
              }
              return entries.length > 0 ? cls : null;
            }
            return null;
          }, metric);
          if (metricValue === null) {
            result.actual_result = `Performance metric "${metric}" not available via browser API (passed with caveat)`;
          } else if (metric === "cls") {
            if (metricValue > threshold) {
              throw new Error(`Performance assertion failed: ${metric} = ${metricValue.toFixed(3)} exceeds threshold ${threshold}`);
            }
            result.actual_result = `Verified ${metric} = ${metricValue.toFixed(3)} (threshold: ${threshold})`;
          } else {
            if (metricValue > threshold) {
              throw new Error(`Performance assertion failed: ${metric} = ${metricValue.toFixed(0)}ms exceeds threshold ${threshold}ms`);
            }
            result.actual_result = `Verified ${metric} = ${metricValue.toFixed(0)}ms (threshold: ${threshold}ms)`;
          }
        } else if (assertType === "text_matches") {
          const tgt = String(step.assertions.target || "page");
          const pattern = String(step.assertions.expected || "");
          let scopeText = "";
          let matched = false;
          let regex;
          try {
            regex = new RegExp(pattern, "i");
          } catch (rxErr) {
            throw new Error(`text_matches: invalid regex /${pattern}/: ${rxErr?.message || rxErr}`);
          }
          const POLL_TIMEOUT_MS = 5e3;
          const POLL_INTERVAL_MS = 100;
          const deadline = Date.now() + POLL_TIMEOUT_MS;
          while (true) {
            if (tgt === "page" || tgt === "" || tgt === "body") {
              scopeText = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
              if (!regex.test(scopeText)) {
                for (const f of page.frames()) {
                  if (f === page.mainFrame()) continue;
                  const ftext = await f.evaluate(() => document.body?.innerText || "").catch(() => "");
                  if (ftext) scopeText += "\n" + ftext;
                  if (regex.test(scopeText)) break;
                }
              }
            } else {
              try {
                const loc = await getStrictLocator(page, tgt, true, step.alt_selectors);
                scopeText = await loc.innerText().catch(() => "");
              } catch {
                scopeText = "";
              }
              if (!regex.test(scopeText)) {
                const inFrame = await findInFrames(page, tgt);
                if (inFrame) {
                  scopeText = await inFrame.locator.innerText().catch(() => scopeText);
                }
              }
            }
            matched = regex.test(scopeText);
            if (matched) break;
            if (Date.now() >= deadline) break;
            await page.waitForTimeout(POLL_INTERVAL_MS);
          }
          if (!matched) {
            throw new Error(`Text regex assertion failed: /${pattern}/i did not match (target=${tgt})`);
          }
          result.actual_result = `Verified text matches /${pattern}/i on ${tgt}`;
        } else if (assertType === "text_present" || assertType === "text_absent") {
          const tgt = String(step.assertions.target || "page");
          const expected = String(step.assertions.expected || "");
          const wantPresent = assertType === "text_present";
          await page.waitForLoadState("domcontentloaded", { timeout: 1e4 }).catch(() => {
          });
          const POLL_TIMEOUT_MS = 5e3;
          const POLL_INTERVAL_MS = 100;
          const deadline = Date.now() + POLL_TIMEOUT_MS;
          let scopeText = "";
          let found = false;
          while (true) {
            if (tgt === "page" || tgt === "" || tgt === "body") {
              scopeText = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
              if (!scopeText.includes(expected)) {
                for (const f of page.frames()) {
                  if (f === page.mainFrame()) continue;
                  const ftext = await f.evaluate(() => document.body?.innerText || "").catch(() => "");
                  if (ftext) scopeText += "\n" + ftext;
                  if (scopeText.includes(expected)) break;
                }
              }
            } else {
              try {
                const loc = await getStrictLocator(page, tgt, true, step.alt_selectors);
                scopeText = await loc.innerText().catch(() => "");
              } catch {
                scopeText = "";
              }
              if (!scopeText.includes(expected)) {
                const inFrame = await findInFrames(page, tgt);
                if (inFrame) {
                  scopeText = await inFrame.locator.innerText().catch(() => scopeText);
                }
              }
            }
            found = scopeText.includes(expected);
            if (found === wantPresent) break;
            if (Date.now() >= deadline) break;
            await page.waitForTimeout(POLL_INTERVAL_MS);
          }
          if (wantPresent && !found) {
            try {
              const curUrl = page.url();
              const snippet = (scopeText || "").slice(0, 200).replace(/\s+/g, " ").trim();
              logger.warn(`[Test][textPresent-fail] expected="${expected.slice(0, 60)}" target=${tgt} url=${curUrl} bodyLen=${(scopeText || "").length} bodySnippet=${JSON.stringify(snippet)}`);
            } catch {
            }
            throw new Error(`Text assertion failed: expected "${expected}" to be present (target=${tgt})`);
          }
          if (!wantPresent && found) {
            throw new Error(`Text assertion failed: expected "${expected}" to be absent (target=${tgt})`);
          }
          result.actual_result = `Verified text ${wantPresent ? "present" : "absent"}: "${expected.slice(0, 60)}" on ${tgt}`;
        } else if ((!assertType || assertType === "visible" || assertType === "exists" || assertType === "displayed" || assertType === "present") && step.selector && step.selector.trim() !== "") {
          const visibilityLocator = await getStrictLocator(page, step.selector, true, step.alt_selectors);
          try {
            await visibilityLocator.waitFor({ state: "attached", timeout: 1e4 });
          } catch (attachErr) {
            const currentUrl = page.url();
            throw new Error(`Element ${step.selector} not found in DOM (current URL: ${currentUrl})`);
          }
          try {
            await visibilityLocator.scrollIntoViewIfNeeded({ timeout: 5e3 });
            await page.waitForTimeout(300);
          } catch (scrollErr) {
          }
          try {
            await visibilityLocator.waitFor({ state: "visible", timeout: 5e3 });
          } catch (visErr) {
            const isVisible = await visibilityLocator.isVisible();
            if (!isVisible) {
              throw new Error(`Element ${step.selector} is not visible`);
            }
          }
          result.actual_result = `Verified ${step.selector} is visible`;
        } else if (assertType === "api_status") {
          const expected = String(expectedValue || "").trim();
          let m = expected.match(/^([A-Z]+)\s+(\S+)\s*(?:→|->|to|expect)?\s*(\d{3}|[1-5]xx)$/i);
          if (!m) {
            const bare = expected.match(/^(\d{3}|[1-5]xx)$/i);
            const tgtPath = String(assertTargetRaw || selectorStr || "").trim();
            if (bare && tgtPath) {
              let p = tgtPath;
              try {
                p = new URL(tgtPath).pathname;
              } catch {
              }
              m = ["", "[A-Z]+", p, bare[1]];
            }
          }
          if (!m) {
            throw new Error(`api_status assertion needs expected="METHOD /path \u2192 STATUS" or a bare status with target=URL (got: ${JSON.stringify(expected)}, target=${JSON.stringify(assertTargetRaw)})`);
          }
          const wantMethodRaw = (m[1] || "").toUpperCase();
          const anyMethod = wantMethodRaw === "[A-Z]+" || wantMethodRaw === "";
          const wantMethod = wantMethodRaw;
          const wantPath = (m[2] || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const wantStatusRaw = (m[3] || "").toLowerCase();
          const inRange = (s) => {
            if (/^[1-5]xx$/.test(wantStatusRaw)) {
              const lo = parseInt(wantStatusRaw[0], 10) * 100;
              return s >= lo && s <= lo + 99;
            }
            return s === parseInt(wantStatusRaw, 10);
          };
          const buf = ensureApiBuffer(page);
          const POLL_TIMEOUT_MS = 5e3;
          const POLL_INTERVAL_MS = 100;
          const deadline = Date.now() + POLL_TIMEOUT_MS;
          let match = null;
          while (true) {
            for (let i = buf.length - 1; i >= 0; i--) {
              const e = buf[i];
              if (!anyMethod && e.method !== wantMethod) continue;
              if (!new RegExp(wantPath).test(e.urlPath)) continue;
              if (!inRange(e.status)) continue;
              match = e;
              break;
            }
            if (match) break;
            if (Date.now() >= deadline) break;
            await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          }
          if (!match) {
            const seen = buf.filter((e) => anyMethod || e.method === wantMethod).slice(-5).map((e) => `${e.method} ${e.urlPath}\u2192${e.status}`).join(", ") || "none";
            const label = anyMethod ? `any request to ${m[2]}` : `${wantMethod} ${m[2]}`;
            throw new Error(`Expected ${label} \u2192 ${wantStatusRaw} but no matching request fired in 5s. Recent: ${seen}`);
          }
          result.actual_result = `${match.method} ${match.urlPath} \u2192 ${match.status} (matched expected ${wantStatusRaw})`;
        } else if (assertType === "hidden") {
          const tgt = selectorStr || String(assertTargetRaw || expectedValue || "");
          const loc = await getStrictLocator(page, tgt, true, step.alt_selectors);
          const visible = await loc.isVisible().catch(() => false);
          if (visible) throw new Error(`Expected element to be hidden but it is visible: ${tgt}`);
          result.actual_result = `Element is hidden: ${tgt}`;
        } else if (assertType === "checked") {
          const tgt = selectorStr || String(assertTargetRaw || expectedValue || "");
          const loc = await getStrictLocator(page, tgt, true, step.alt_selectors);
          const checked = await loc.isChecked().catch(() => null);
          if (checked !== true) throw new Error(`Expected element to be checked but it is not: ${tgt}`);
          result.actual_result = `Element is checked: ${tgt}`;
        } else if (assertType === "value_equals") {
          const tgt = selectorStr || String(assertTargetRaw || "");
          const loc = await getStrictLocator(page, tgt, true, step.alt_selectors);
          const actual = await loc.inputValue().catch(() => null);
          const want = String(assertExpectedRaw ?? step.value ?? "");
          if (actual !== want) throw new Error(`Expected input value "${want}" but got "${actual}" in ${tgt}`);
          result.actual_result = `Input value equals "${want}"`;
        } else if (assertType === "enabled" || assertType === "disabled") {
          const tgt = selectorStr || String(assertTargetRaw || "");
          const loc = await getStrictLocator(page, tgt, true, step.alt_selectors);
          const isEnabled = await loc.isEnabled().catch(() => null);
          const wantEnabled = assertType === "enabled";
          if (isEnabled !== wantEnabled) throw new Error(`Expected element to be ${wantEnabled ? "enabled" : "disabled"} but it was ${isEnabled ? "enabled" : "disabled"}: ${tgt}`);
          result.actual_result = `Element is ${wantEnabled ? "enabled" : "disabled"}: ${tgt}`;
        } else if (assertType === "stay_on_form" || assertType === "stays_on_form" || assertType === "stay-on-form") {
          const stillOnForm = await page.evaluate(() => {
            const forms = Array.from(document.querySelectorAll("form"));
            return forms.some((f) => f.querySelectorAll("input, textarea, select").length > 0);
          }).catch(() => false);
          if (!stillOnForm) {
            throw new Error(`Expected to stay on the form after an invalid submit, but the page navigated on to ${page.url()} \u2014 the invalid submission appears to have been accepted`);
          }
        } else if (assertType) {
          throw new Error(`Unsupported assertion type "${assertType}" \u2014 cannot evaluate; failing instead of silently passing.`);
        } else {
          result.actual_result = `Assertion step completed (no oracle)`;
        }
        break;
      }
      case "verify-text":
      case "assert-text":
        const verifyTextLocator = await getStrictLocator(page, step.selector, true, step.alt_selectors);
        const text = await verifyTextLocator.textContent();
        if (step.value && !text?.includes(step.value)) {
          throw new Error(`Expected text "${step.value}" not found in ${step.selector}`);
        }
        result.actual_result = `Verified text in ${step.selector}: "${text?.substring(0, 50)}"`;
        break;
      case "verify-value":
      case "assert-value":
        const verifyValueLocator = await getStrictLocator(page, step.selector, true, step.alt_selectors);
        const inputValue = await verifyValueLocator.inputValue();
        if (step.value && inputValue !== step.value) {
          throw new Error(`Expected value "${step.value}" but got "${inputValue}"`);
        }
        result.actual_result = `Verified value of ${step.selector}: "${inputValue}"`;
        break;
      case "screenshot":
        const screenshotPath = path2.join(outputDir, `screenshot-${step.id}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: step.value === "fullpage" });
        result.actual_result = `Screenshot saved to ${screenshotPath}`;
        break;
      case "download":
      case "expect-download": {
        const dlLocator = await getStrictLocator(page, step.selector, false, step.alt_selectors);
        const dlPromise = page.waitForEvent("download", { timeout: 2e4 });
        await dlLocator.click();
        const download = await dlPromise;
        const dlName = download.suggestedFilename();
        let dlBytes = 0;
        try {
          const stream = await download.createReadStream();
          if (stream) {
            for await (const chunk of stream) {
              dlBytes += chunk.length;
              if (dlBytes > 1024 * 1024) break;
            }
          }
        } catch {
        }
        if (step.value && !dlName.toLowerCase().includes(String(step.value).toLowerCase())) {
          throw new Error(`Downloaded "${dlName}" but expected the name to contain "${step.value}"`);
        }
        if (dlBytes === 0) {
          throw new Error(`Download "${dlName}" was empty (0 bytes)`);
        }
        result.actual_result = `Downloaded "${dlName}" (${dlBytes > 1024 * 1024 ? ">1MB" : dlBytes + " bytes"})`;
        break;
      }
      case "api-request":
      case "http-request": {
        const apiMethod = (step.value || "GET").toUpperCase();
        const apiUrl = step.selector;
        if (typeof apiUrl === "string" && isSSRFTarget(apiUrl)) {
          result.status = "failed";
          result.error_message = `Blocked api-request to an internal/reserved address: ${apiUrl}`;
          logger.warn(`[Test] api-request SSRF blocked: ${apiUrl}`);
          const doneAt = /* @__PURE__ */ new Date();
          result.completed_at = doneAt.toISOString();
          result.duration_ms = doneAt.getTime() - startedAt.getTime();
          return result;
        }
        const apiHeaders = {};
        let apiBody = void 0;
        let expectedStatus;
        let expectedBody = void 0;
        let maxResponseTime;
        if (step.assertions) {
          const a = step.assertions;
          if (a.headers && typeof a.headers === "object") {
            Object.assign(apiHeaders, a.headers);
          }
          if (a.body !== void 0) apiBody = a.body;
          if (a.expectedStatus) expectedStatus = parseInt(String(a.expectedStatus));
          if (a.expectedBody) expectedBody = a.expectedBody;
          if (a.maxResponseTime) maxResponseTime = parseInt(String(a.maxResponseTime));
        }
        if (apiBody && !apiHeaders["Content-Type"] && !apiHeaders["content-type"]) {
          apiHeaders["Content-Type"] = "application/json";
        }
        const fetchOptions = {
          method: apiMethod,
          headers: apiHeaders,
          signal: AbortSignal.timeout(3e4)
        };
        if (apiBody && apiMethod !== "GET" && apiMethod !== "HEAD") {
          fetchOptions.body = typeof apiBody === "string" ? apiBody : JSON.stringify(apiBody);
        }
        result.api_request = {
          method: apiMethod,
          url: apiUrl,
          headers: apiHeaders,
          body: apiBody
        };
        const apiStart = Date.now();
        const apiResp = await ssrfSafeFetch(apiUrl, fetchOptions);
        const apiElapsed = Date.now() - apiStart;
        result.api_response_time_ms = apiElapsed;
        let respBody;
        let respBodyText;
        const contentType = apiResp.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          respBody = await apiResp.json();
          respBodyText = JSON.stringify(respBody, null, 2);
        } else {
          respBodyText = await apiResp.text();
          respBody = respBodyText;
        }
        const respHeaders = {};
        apiResp.headers.forEach((v, k) => {
          respHeaders[k] = v;
        });
        result.api_response = {
          status: apiResp.status,
          statusText: apiResp.statusText,
          headers: respHeaders,
          body: respBody,
          bodyText: respBodyText.substring(0, 1e4)
          // Limit stored body size
        };
        const apiErrors = [];
        if (expectedStatus && apiResp.status !== expectedStatus) {
          apiErrors.push(`Expected status ${expectedStatus}, got ${apiResp.status}`);
        }
        if (maxResponseTime && apiElapsed > maxResponseTime) {
          apiErrors.push(`Response time ${apiElapsed}ms exceeded max ${maxResponseTime}ms`);
        }
        if (expectedBody && typeof respBody === "object") {
          const checkJsonPath = (obj, pathStr) => {
            return pathStr.split(".").reduce((o, k) => o && o[k] !== void 0 ? o[k] : void 0, obj);
          };
          if (typeof expectedBody === "object") {
            for (const [jsonPath, expected] of Object.entries(expectedBody)) {
              const actual = checkJsonPath(respBody, jsonPath);
              if (String(actual) !== String(expected)) {
                apiErrors.push(`Body path "${jsonPath}": expected "${expected}", got "${actual}"`);
              }
            }
          }
        }
        if (apiErrors.length > 0) {
          throw new Error(`API assertion failed: ${apiErrors.join("; ")}`);
        }
        result.actual_result = `${apiMethod} ${apiUrl} \u2192 ${apiResp.status} ${apiResp.statusText} (${apiElapsed}ms)`;
        break;
      }
      default: {
        const actLower = String(step.action || "").toLowerCase();
        const tgt = (typeof step.selector === "string" ? step.selector : "") || "";
        const looksLikeUrl = /^https?:\/\//.test(tgt) || tgt.includes("**/") || /^\*?\*?\//.test(tgt);
        if (/wait|url|navigat/.test(actLower) || looksLikeUrl) {
          const needle = tgt.replace(/\*+/g, "").replace(/^https?:\/\/[^/]+/, "").replace(/\/{2,}/g, "/");
          if (needle) {
            try {
              await page.waitForURL((u) => u.toString().includes(needle), { timeout: 1e4, waitUntil: "domcontentloaded" });
              result.actual_result = `Waited for URL ~"${needle}": ${page.url()}`;
            } catch {
              result.actual_result = `Unknown action "${step.action}" treated as URL wait; "${needle}" not matched (current ${page.url()}) \u2014 continuing`;
            }
          } else {
            result.actual_result = `Unknown action "${step.action}" with no actionable target \u2014 skipped`;
          }
          break;
        }
        logger.info(`[Test] Unknown action "${step.action}", attempting click`);
        const defaultLocator = await getStrictLocator(page, step.selector, false, step.alt_selectors);
        await defaultLocator.click({ timeout: 1e4 });
        result.actual_result = `Clicked ${step.selector} (fallback)`;
      }
    }
    if (!isApiStep) {
      const screenshotAfter = path2.join(outputDir, `step-${step.id}-after.png`);
      const ok = await page.screenshot({ path: screenshotAfter }).then(() => true).catch(() => false);
      if (ok) result.screenshot_after = screenshotAfter;
    }
    if (step.assertions) {
      await page.waitForTimeout(300);
      if (step.assertions.visible !== void 0) {
        const assertVisLocator = await getStrictLocator(page, step.selector, true, step.alt_selectors);
        try {
          await assertVisLocator.scrollIntoViewIfNeeded({ timeout: 3e3 });
          await page.waitForTimeout(200);
        } catch {
        }
        const visible = await assertVisLocator.isVisible();
        if (visible !== step.assertions.visible) {
          throw new Error(`Visibility assertion failed: expected ${step.assertions.visible}, got ${visible}`);
        }
      }
      if (step.assertions.text) {
        const assertTextLocator = await getStrictLocator(page, step.selector, true, step.alt_selectors);
        try {
          await assertTextLocator.scrollIntoViewIfNeeded({ timeout: 3e3 });
        } catch {
        }
        const textContent = await assertTextLocator.textContent();
        if (!textContent?.includes(step.assertions.text)) {
          throw new Error(`Text assertion failed: expected "${step.assertions.text}" in element`);
        }
      }
      if (step.assertions.url) {
        const currentUrl = page.url();
        const normalizeUrlForCompare = (url) => {
          if (!url || typeof url !== "string") return String(url || "").toLowerCase();
          try {
            return decodeURIComponent(url.replace(/\+/g, " ")).toLowerCase();
          } catch {
            return url.toLowerCase();
          }
        };
        const normalizedCurrent = normalizeUrlForCompare(currentUrl);
        const normalizedExpected = normalizeUrlForCompare(step.assertions.url);
        if (!normalizedCurrent.includes(normalizedExpected)) {
          throw new Error(`URL assertion failed: expected "${step.assertions.url}" in ${currentUrl}`);
        }
      }
    }
    result.status = "passed";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isParseError = /Unexpected token|while parsing|not a valid selector|Unknown attribute|Unknown engine|Unexpected end of selector|malformed/i.test(msg);
    const isAssertionStep = !!step.assertions || /^(assert|expect|verify)/i.test(step.action || "");
    if (isParseError && isAssertionStep) {
      result.status = "skipped";
      result.actual_result = `Skipped \u2014 malformed/unparseable assertion selector (${msg.slice(0, 90)})`;
      logger.info(`[Test] Skipped malformed assertion (step ${step.id}): ${msg.slice(0, 90)}`);
      const c = /* @__PURE__ */ new Date();
      result.completed_at = c.toISOString();
      result.duration_ms = c.getTime() - startedAt.getTime();
      return result;
    }
    const isFragileAssertFail = isAssertionStep && process.env.AEGIS_HARD_CONTENT_ASSERT !== "1" && !/URL assertion|api[_ ]?status|response (status|code)/i.test(msg) && /(Visibility assertion failed|Text assertion failed|Attribute assertion failed|Count assertion|not found in DOM|not (?:found|visible|present)|expected .* to be (?:visible|present))/i.test(msg);
    if (isFragileAssertFail) {
      result.failure_type = "soft_content_assertion";
      logger.warn(`[Test] Fragile content assertion (step ${step.id}) \u2014 will re-check, then needs_review if still failing: ${msg.slice(0, 80)}`);
    }
    result.status = "failed";
    result.error_message = msg;
    try {
      const failureScreenshot = path2.join(outputDir, `step-${step.id}-failure.png`);
      await page.screenshot({ path: failureScreenshot });
      result.screenshot_after = failureScreenshot;
    } catch {
    }
  }
  const completedAt = /* @__PURE__ */ new Date();
  result.completed_at = completedAt.toISOString();
  result.duration_ms = completedAt.getTime() - startedAt.getTime();
  return result;
}
async function healLocatorOnPage(page, originalSelector) {
  let role = "";
  let name = "";
  const roleMatch = originalSelector.match(/^role=(\w+)\[name=["/]([^"/\]]+)["/]\w*\]$/);
  if (roleMatch) {
    role = roleMatch[1];
    name = roleMatch[2];
  }
  const textMatch = originalSelector.match(/^text=["']([^"']+)["']$/);
  if (textMatch) {
    name = textMatch[1];
  }
  const getByMatch = originalSelector.match(/getByRole\(['"](\w+)['"][^)]*name:\s*['"]([^'"]+)['"]/);
  if (getByMatch) {
    role = getByMatch[1];
    name = getByMatch[2];
  }
  if (!name) return null;
  const strategies = [];
  if (role) {
    strategies.push(() => page.getByRole(role, { name, exact: false }));
    strategies.push(() => page.getByRole(role, { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }));
  }
  strategies.push(() => page.getByText(name, { exact: false }));
  strategies.push(() => page.locator(`[aria-label*="${name.replace(/"/g, '\\"')}" i]`));
  for (const buildLocator of strategies) {
    try {
      const loc = buildLocator().first();
      const count = await loc.count();
      if (count > 0 && await loc.isVisible().catch(() => false)) {
        return loc;
      }
    } catch {
    }
  }
  return null;
}

// src/runnerRunExecutor.ts
var API = (process.env.AEGIS_API || "https://app.aegisrunner.com/api/v1").replace(/\/+$/, "");
var rlog = (m) => console.log(`  \u25C6 aegis-runner  ${m}`);
function arrHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}
var NEGATIVE_TAGS = /* @__PURE__ */ new Set(["negative", "unauthenticated", "logged_out"]);
function isNegative(c) {
  return (c.tags || []).some((t) => NEGATIVE_TAGS.has(String(t).toLowerCase()) || /-negative$/i.test(String(t)));
}
async function runRunSession(job) {
  const sid = job.sessionId;
  const arr = job.token;
  const cres = await fetch(`${API}/runner-run/${sid}/cases`, { headers: arrHeaders(arr), signal: AbortSignal.timeout(3e4) }).catch(() => null);
  if (!cres || !cres.ok) {
    rlog(`! could not fetch the suite for run ${job.runId} (HTTP ${cres?.status ?? "network"})`);
    await complete(sid, arr, "fetch_cases_failed");
    return;
  }
  const payload = await cres.json();
  const cases = payload.cases || [];
  const baseUrl = payload.baseUrl || "";
  rlog(`run ${job.runId} claimed \u2014 ${cases.length} case(s)${baseUrl ? ` against ${baseUrl}` : ""}, browser on this machine`);
  const credentials = process.env.AEGIS_USERNAME ? { username: process.env.AEGIS_USERNAME, password: process.env.AEGIS_PASSWORD || "" } : void 0;
  const hb = setInterval(() => {
    void heartbeat(sid, arr);
  }, 3e4);
  let browser = null;
  let reason = "completed";
  try {
    browser = await chromium.launch({ headless: true });
    for (const c of cases) {
      const result = await runOneCase(browser, c, baseUrl, credentials);
      rlog(`  case "${c.name || c.case_result_id}" \u2192 ${result.status}`);
      await postResult(sid, arr, result);
    }
  } catch (err) {
    reason = "runner_error";
    rlog(`! run ${job.runId} error: ${err?.message ?? err}`);
  } finally {
    clearInterval(hb);
    try {
      if (browser) await browser.close();
    } catch {
    }
    await complete(sid, arr, reason);
  }
}
async function runOneCase(browser, c, baseUrl, credentials) {
  const t0 = Date.now();
  const outDir = await mkdtemp(join(tmpdir(), "aegis-run-"));
  const tr = { case_result_id: c.case_result_id, status: "passed", step_results: [], duration_ms: 0 };
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  try {
    if (baseUrl) {
      try {
        await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 3e4 });
      } catch {
      }
    }
    for (const step of c.steps) {
      const sr = await executeStepAdvanced(page, step, outDir, {
        enableRetry: true,
        credentials,
        allowAutoLogin: !isNegative(c)
      });
      tr.step_results.push(sr);
      if (sr.accessibility && !tr.accessibility) tr.accessibility = sr.accessibility;
      if (sr.status === "failed") {
        tr.status = "failed";
        tr.error_message = sr.error_message;
        break;
      }
    }
  } catch (err) {
    tr.status = "failed";
    tr.error_message = err instanceof Error ? err.message : String(err);
  } finally {
    tr.duration_ms = Date.now() - t0;
    try {
      await context.close();
    } catch {
    }
    void rm(outDir, { recursive: true, force: true }).catch(() => {
    });
  }
  applyNeedsReviewRollup(tr);
  return tr;
}
async function postResult(sid, arr, result) {
  try {
    await fetch(`${API}/runner-run/${sid}/result`, {
      method: "POST",
      headers: { ...arrHeaders(arr), "Content-Type": "application/json" },
      body: JSON.stringify(result),
      signal: AbortSignal.timeout(3e4)
    });
  } catch (e) {
    rlog(`! failed to stream result for case ${result.case_result_id}: ${e?.message ?? e}`);
  }
}
async function heartbeat(sid, arr) {
  try {
    await fetch(`${API}/runner-run/${sid}/heartbeat`, { method: "POST", headers: arrHeaders(arr), signal: AbortSignal.timeout(1e4) });
  } catch {
  }
}
async function complete(sid, arr, reason) {
  try {
    await fetch(`${API}/runner-run/${sid}/complete`, {
      method: "POST",
      headers: { ...arrHeaders(arr), "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
      signal: AbortSignal.timeout(15e3)
    });
  } catch {
  }
}

// src/runnerExecutor.ts
var API2 = (process.env.AEGIS_API || "https://app.aegisrunner.com/api/v1").replace(/\/+$/, "");
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
    const pr = await fetch(`${API2}/runner-scan/${sessionId}/screenshot-url`, {
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
    browser = await chromium2.launch({
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
        res = await fetch(`${API2}/runner-scan/${sid}/actions?batch=${POLL_BATCH}`, {
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
    await fetch(`${API2}/runner-scan/${sid}/complete`, {
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
  await fetch(`${API2}/runner-scan/${sid}/observation`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ars}`, "Content-Type": "application/json" },
    body: JSON.stringify({ actionId, observation })
  }).catch((e) => log(`! observation post failed: ${e?.message ?? e}`));
}
async function scanLoop() {
  for (; ; ) {
    let res;
    try {
      res = await fetch(`${API2}/runner/scan-jobs/next`, { headers: ciHeaders(), signal: AbortSignal.timeout(3e4) });
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
async function runLoop() {
  for (; ; ) {
    let res;
    try {
      res = await fetch(`${API2}/runner/run-jobs/next`, { headers: ciHeaders(), signal: AbortSignal.timeout(3e4) });
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
      await runRunSession(job);
    } catch (e) {
      log(`! run ${job.runId} crashed: ${e?.message ?? e}`);
    }
    log("run finished \u2014 back to waiting for the next job");
  }
}
async function main() {
  if (!CI_TOKEN) {
    console.error("AEGIS_TOKEN is required (a CI trigger token from Manage \u2192 CI/CD).");
    process.exit(1);
  }
  log(`executor online \u2014 polling ${API2} for scan + run jobs (outbound only)`);
  await Promise.all([scanLoop(), runLoop()]);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
