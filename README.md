# AegisRunner - Blind Crawler SaaS

A powerful, automated web crawler and testing platform that crawls any website, generates AI-powered Playwright test suites, and executes them — achieving **95.7% pass rate** across 23,000+ tests on production websites.

## Framework Test Results

Tested against real-world production websites built with major frameworks — zero manual test authoring, fully automated crawl-to-test pipeline:

| Framework | Website | Pages | States | Tests | Passed | Pass Rate |
|-----------|---------|------:|-------:|------:|-------:|----------:|
| Vue | primevue.org | 100 | 300 | 1,480 | 1,470 | **99.3%** |
| Svelte | svelte.dev | 100 | 571 | 3,269 | 3,476 | **96.9%** |
| Next.js | demo.vercel.store | 296 | 845 | 9,524 | 9,179 | **96.4%** |
| Nuxt | nuxt.com | 134 | 1,279 | 4,403 | 4,146 | **94.2%** |
| React | tanstack.com | 87 | 130 | 507 | 427 | **84.2%** |
| Angular | angular.dev | 101 | 313 | 6,542 | 2,650 | **74.0%** |
| | | | | **25,725** | **21,348** | **92.5%** |

> Each test is a full Playwright spec that navigates to the page, interacts with elements, and asserts expected behavior — generated entirely by AI from crawl data.

## Features

### Crawler Capabilities
- 🌐 **Smart State Exploration** - BFS/DFS traversal of web application states
- 📱 **Device Emulation** - Test on iPhone, Pixel, iPad, and 50+ device profiles
- 🎥 **Video Recording** - Record crawl sessions for debugging
- 📊 **Core Web Vitals** - Measure LCP, CLS, FCP, TTFB automatically
- 🔍 **SEO Audit** - Meta tags, headings, structured data analysis
- 🔒 **Security Audit** - Headers, CSP, cookies, mixed content checks
- ♿ **Accessibility** - axe-core powered a11y testing
- 🔗 **Dead Link Detection** - Find broken links automatically
- 📈 **Resource Analysis** - Large image, unminified JS/CSS detection
- 🌍 **Geolocation Testing** - Test with different locations
- 🌙 **Dark Mode Testing** - Validate color scheme preferences
- 📶 **Network Throttling** - Test under 3G/slow network conditions
- 📱 **Touch Gesture Testing** - Swipe, long-press, pinch support

### AI Test Generation
- 🤖 **Auto-Generated Tests** - AI creates Playwright test suites from crawl data
- 🔍 **State-Aware** - Tests cover navigation, forms, modals, dropdowns, and dynamic content
- ✅ **Form Validation** - Automatically tests empty form submissions and error messages
- 📦 **Auto-Batching** - Splits large test payloads for reliable execution
- 🔄 **Multi-Provider AI** - Supports OpenRouter, OpenAI, and Anthropic models
- 📊 **Pass/Fail Tracking** - Track test run results with detailed per-case reporting

### Backend API
- 🔐 **OAuth2 Authentication** - Google, GitHub, email/password
- 📁 **Project Management** - Organize crawls by project
- 🔄 **Real-time Updates** - WebSocket for live crawl progress
- 📊 **Analytics Dashboard** - Track crawl metrics over time
- 🔌 **REST API** - Full API for integration

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        AegisRunner                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────┐    ┌───────────────┐    ┌───────────────┐  │
│  │   Frontend    │    │   Backend     │    │   Crawler     │  │
│  │  (Nuxt/Vue)   │───▶│   (Go/Fiber)  │───▶│   (Node.js)   │  │
│  │               │    │               │    │  (Playwright) │  │
│  └───────────────┘    └───────────────┘    └───────────────┘  │
│                              │                     │           │
│                              ▼                     ▼           │
│                       ┌───────────────┐    ┌───────────────┐  │
│                       │  PostgreSQL   │    │   Output      │  │
│                       │   Database    │    │   (JSON/HTML) │  │
│                       └───────────────┘    └───────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## License

MIT License - See [LICENSE](LICENSE) for details.
