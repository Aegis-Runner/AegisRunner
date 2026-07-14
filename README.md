<p align="center">
  <a href="https://aegisrunner.com">
    <img src="https://aegisrunner.com/logo.svg" alt="AegisRunner" width="60" height="60" />
  </a>
</p>

<h1 align="center"><a href="https://aegisrunner.com">AegisRunner</a></h1>

<p align="center">
  <strong>Enter a URL or upload your app, get a full test suite.</strong><br/>
  AI that tests your website <em>and</em> your native iOS &amp; Android apps on real devices — discovering flows, generating Playwright tests, and auditing accessibility, SEO, security &amp; performance, automatically.
</p>

<p align="center">
  <a href="https://aegisrunner.com/scan"><strong>Free Website Audit</strong></a> &middot;
  <a href="https://aegisrunner.com/use-cases/mobile-app-testing-automation"><strong>Mobile App Testing</strong></a> &middot;
  <a href="https://aegisrunner.com/live-demos"><strong>Live Demos</strong></a> &middot;
  <a href="https://aegisrunner.com/docs"><strong>Docs</strong></a> &middot;
  <a href="https://aegisrunner.com/pricing"><strong>Pricing</strong></a> &middot;
  <a href="https://aegisrunner.com/blog"><strong>Blog</strong></a>
</p>

<p align="center">
  <a href="https://aegisrunner.com"><img src="https://img.shields.io/badge/Website-aegisrunner.com-cyan?style=flat-square" alt="Website" /></a>
  <a href="https://github.com/Aegis-Runner/AegisRunner/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT License" /></a>
  <a href="https://www.producthunt.com/products/aegisrunner"><img src="https://img.shields.io/badge/Product%20Hunt-AegisRunner-orange?style=flat-square&logo=producthunt" alt="Product Hunt" /></a>
  <a href="https://www.g2.com/products/aegisrunner/reviews"><img src="https://img.shields.io/badge/G2-Review%20Us-red?style=flat-square" alt="G2" /></a>
  <a href="https://www.npmjs.com/package/@aegisrunner/cli"><img src="https://img.shields.io/npm/v/@aegisrunner/cli?style=flat-square&logo=npm&label=%40aegisrunner%2Fcli" alt="npm" /></a>
  <a href="https://hub.docker.com/r/aegisrunner1/runner"><img src="https://img.shields.io/docker/image-size/aegisrunner1/runner/latest?style=flat-square&logo=docker&label=runner" alt="Docker image" /></a>
</p>

---

## What is AegisRunner?

[AegisRunner](https://aegisrunner.com) is a regression testing platform for **web and mobile**. It crawls your website like a real user — and explores your native **iOS &amp; Android** apps on **real physical devices** — discovering every page, screen and interactive state, then generates production-ready Playwright test suites using AI. It's the only platform that tests your app and your website in one **cross-platform journey**, catching the moment mobile and web drift out of sync.

**No scripts to write. No selectors to maintain. No Appium setup. Just paste your URL or upload your build.**

### How it works

1. **Crawl / explore** — AegisRunner navigates your site using real browsers (Chromium, Firefox, WebKit), and explores your `.apk` / `.ipa` on real iOS &amp; Android devices, clicking buttons, filling forms, and discovering UI states
2. **Audit** — Every page gets accessibility (WCAG/axe-core), SEO, security header, and Core Web Vitals analysis
3. **Generate** — AI creates Playwright test specs from discovered states — exportable as `.spec.ts` files
4. **Run** — Execute tests on real browsers and real devices on every deploy via CI/CD integration (GitHub Actions, GitLab CI, Jenkins)

### Try it free

Scan any website in 2 minutes, no signup required:

**[https://aegisrunner.com/scan](https://aegisrunner.com/scan)**

---

## Framework Test Results

Tested against real-world production websites — zero manual test authoring, fully automated:

| Framework | Website | Pages | States | Tests | Passed | Pass Rate |
|-----------|---------|------:|-------:|------:|-------:|----------:|
| Vue | primevue.org | 100 | 300 | 1,480 | 1,470 | **99.3%** |
| Svelte | svelte.dev | 100 | 571 | 3,269 | 3,476 | **96.9%** |
| Next.js | demo.vercel.store | 296 | 845 | 9,524 | 9,179 | **96.4%** |
| Nuxt | nuxt.com | 134 | 1,279 | 4,403 | 4,146 | **94.2%** |
| React | tanstack.com | 87 | 130 | 507 | 427 | **84.2%** |
| Angular | angular.dev | 101 | 313 | 6,542 | 2,650 | **74.0%** |
| | | | | **25,725** | **21,348** | **92.5%** |

> Each test is a real Playwright spec that navigates, interacts, and asserts — generated entirely by AI from crawl data.

---

## Features

### Crawler
- Smart BFS/DFS state exploration across SPAs and multi-page sites
- 50+ device profiles (iPhone, Pixel, iPad, desktop)
- Handles authentication (login forms, OAuth, session cookies)
- Form discovery and interaction (fills forms, submits, validates errors)
- Pagination detection and deep link following

### Audits
- **Accessibility** — axe-core WCAG 2.1 AA compliance checking
- **SEO** — Meta tags, headings, structured data, canonical URLs, internal links
- **Security** — HTTP headers, CSP, HSTS, cookie flags, mixed content, HTTPS
- **Performance** — Core Web Vitals (LCP, CLS, FCP, TTFB, TTI, TBT)
- **Link Health** — Dead link detection across the entire site

### AI Test Generation
- Generates Playwright TypeScript test specs from crawl data
- Covers navigation, forms, modals, dropdowns, accordions, and dynamic content
- Multi-provider AI (DeepSeek, MiniMax, OpenRouter, Cerebras, and more)
- BYOK — bring your own API key (OpenAI, Anthropic, Google, etc.)
- Export as `.spec.ts` files ready for your CI/CD pipeline

### Mobile App Testing (iOS &amp; Android)
- Upload an Android `.apk` or iOS `.ipa` — no Appium, no SDK, no device lab
- AI explores your app **live on a real device** (iPhone, Pixel, Samsung Galaxy)
- Generates and runs grounded test cases on real hardware — no scripts
- Native iOS, native Android, React Native, Flutter and mobile web
- **Cross-platform sync** — one journey acts in the app and verifies on the website
- Self-healing, semantic selectors instead of brittle XCUI / UiAutomator locators

### Visual Regression Testing
- Pixel-level screenshot comparison (pixelmatch)
- Baseline accept/reject workflow
- 3-panel diff view (before / after / diff)

### Platform
- Team collaboration with RBAC (Owner, Admin, Member, Viewer)
- CI/CD integration (GitHub Actions, GitLab CI, webhooks)
- Scheduled runs (cron-based)
- Notifications (Email, Slack, Discord, Microsoft Teams)
- Issue tracking (GitHub Issues, Jira)
- SSO/SAML support
- API testing (REST endpoints with JSON assertions)
- Billing via Paddle (Starter $9/mo, Pro $29/mo, Business $79/mo)

---

## CLI & self-hosted runner

Drive AegisRunner from any CI pipeline with the open-source [`@aegisrunner/cli`](https://www.npmjs.com/package/@aegisrunner/cli) — zero dependencies, Node 18+:

```bash
npm install -g @aegisrunner/cli
export AEGIS_TOKEN=aegis_xxxxxxxx        # a project CI trigger token

aegis run --format junit --output results.xml       # run your suite, write JUnit for CI
aegis scan --url https://staging.example.com         # re-scan after a deploy
aegis scan --url https://staging.example.com --watch # …and stream live progress until done
aegis mobile-scan --platform android --role customer

# scan pages behind a login (password from stdin — never on the command line):
printf %s "$STAGING_PW" | aegis scan --username qa@example.com --password-stdin --watch
```

Exit code `0` = passed, `1` = test failures (fails the pipeline step), `2` = error.

### Testing behind a firewall

Targets the cloud can't reach — a VPN, `localhost`, or an IP-restricted staging box — are covered by the same CLI:

```bash
# expose a local dev app to the cloud scanner (temporary, encrypted)
aegis tunnel --port 3000

# or run a self-hosted runner INSIDE your network (outbound-only, no inbound port)
docker run --network host -e AEGIS_TOKEN=aegis_xxx aegisrunner1/runner
#   also on GHCR: ghcr.io/aegis-runner/runner
```

Full guide: [`cli/RUNNER.md`](cli/RUNNER.md) · [docs → Testing behind a firewall](https://aegisrunner.com/docs/testing-behind-a-firewall)

The CLI and runner source live in [`cli/`](cli/) and are MIT-licensed.

---

## Links

- **Website**: [aegisrunner.com](https://aegisrunner.com)
- **Free Scan**: [aegisrunner.com/scan](https://aegisrunner.com/scan)
- **Mobile App Testing**: [aegisrunner.com/use-cases/mobile-app-testing-automation](https://aegisrunner.com/use-cases/mobile-app-testing-automation)
- **Live Demos**: [aegisrunner.com/live-demos](https://aegisrunner.com/live-demos)
- **Documentation**: [aegisrunner.com/docs](https://aegisrunner.com/docs)
- **Blog**: [aegisrunner.com/blog](https://aegisrunner.com/blog)
- **Pricing**: [aegisrunner.com/pricing](https://aegisrunner.com/pricing)
- **Status**: [aegisrunner.com/status](https://aegisrunner.com/status)

---

## Comparisons

- [AegisRunner vs Cypress](https://aegisrunner.com/blog/aegisrunner-vs-cypress)
- [AegisRunner vs Selenium](https://aegisrunner.com/blog/aegisrunner-vs-selenium)
- [AegisRunner vs Katalon](https://aegisrunner.com/compare/katalon)
- [AegisRunner vs mabl](https://aegisrunner.com/compare/mabl)
- [Playwright Alternative](https://aegisrunner.com/playwright-alternative)

---

## License

MIT License — see [LICENSE](LICENSE) for details.

Built by [SecuredAll](https://securedall.com)
