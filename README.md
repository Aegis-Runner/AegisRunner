<p align="center">
  <a href="https://aegisrunner.com">
    <img src="https://aegisrunner.com/logo.svg" alt="AegisRunner" width="60" height="60" />
  </a>
</p>

<h1 align="center"><a href="https://aegisrunner.com">AegisRunner</a></h1>

<p align="center">
  <strong>Enter a URL, get a full test suite.</strong><br/>
  AI-powered web crawler that discovers pages, generates Playwright tests, and audits accessibility, SEO, security & performance — automatically.
</p>

<p align="center">
  <a href="https://aegisrunner.com/scan"><strong>Free Website Audit</strong></a> &middot;
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
</p>

---

## What is AegisRunner?

[AegisRunner](https://aegisrunner.com) is a regression testing platform that crawls your website like a real user, discovers every page and interactive state, then generates production-ready Playwright test suites using AI.

**No scripts to write. No selectors to maintain. Just paste your URL.**

### How it works

1. **Crawl** — AegisRunner navigates your site using real browsers (Chromium, Firefox, WebKit), clicking buttons, filling forms, and discovering UI states
2. **Audit** — Every page gets accessibility (WCAG/axe-core), SEO, security header, and Core Web Vitals analysis
3. **Generate** — AI creates Playwright test specs from discovered states — exportable as `.spec.ts` files
4. **Run** — Execute tests on every deploy via CI/CD integration (GitHub Actions, GitLab CI, Jenkins)

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

## Architecture

```
Frontend (Nuxt 3 / Vue)  →  Backend (Go / Fiber)  →  Crawler (Node.js / Playwright)
                                    ↓
                            PostgreSQL + Redis
```

- **Frontend**: Nuxt 3, Vue 3, Tailwind CSS, WebSocket real-time updates
- **Backend**: Go with Fiber framework, JWT auth, RBAC, WebSocket hub
- **Crawler**: Node.js with Playwright (Chromium, Firefox, WebKit), Patchright stealth
- **Database**: PostgreSQL 18, Redis 7 for caching/pub-sub
- **Deployment**: Docker Swarm, Hetzner Cloud

---

## Links

- **Website**: [aegisrunner.com](https://aegisrunner.com)
- **Free Scan**: [aegisrunner.com/scan](https://aegisrunner.com/scan)
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
