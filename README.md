<div align="center">
  <img src="https://img.shields.io/badge/Playwright-45ba4b?style=for-the-badge&logo=Playwright&logoColor=white" alt="Playwright" />
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/npm/v/playwright-forensics?style=for-the-badge&logo=npm&label=version" alt="npm version" />
  <img src="https://img.shields.io/github/actions/workflow/status/anomalyco/playwright-forensics/ci.yml?style=for-the-badge&label=CI" alt="CI" />
  <img src="https://img.shields.io/badge/Node-18%2B-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node >= 18" />
  <img src="https://img.shields.io/github/stars/anomalyco/playwright-forensics?style=for-the-badge&logo=github&label=stars" alt="GitHub stars" />
  <img src="https://img.shields.io/github/last-commit/anomalyco/playwright-forensics?style=for-the-badge&logo=github&label=updated" alt="last commit" />
</div>

<br />

<div align="center">
  <h1>🔍 Playwright Forensics</h1>
  <p><strong>Post-mortem analysis for Playwright tests.<br />
  Not "test failed" — a full causal reconstruction of what went wrong in the DOM.</strong></p>

  <p>
    <a href="#-the-problem">The Problem</a> •
    <a href="#-our-approach">Our Approach</a> •
    <a href="#-architecture">Architecture</a> •
    <a href="#-quick-start">Quick Start</a> •
    <a href="#-features">Features</a> •
    <a href="#%EF%B8%8F-cli">CLI</a> •
    <a href="#-failure-scenarios">Scenarios</a> •
    <a href="#%EF%B8%8F-configuration">Config</a>
  </p>
</div>

---

## 🤔 The Problem

Every Playwright developer has been there:

```
locator.click: Timeout 5000ms exceeded
╔══════════════════════════════════════════════════════════╗
║ Wait ended. All 5 attempts failed.                      ║
║   - element was not found in the DOM                    ║
╚══════════════════════════════════════════════════════════╝
```

The test failed. **But why?** Was the element never there? Did a re-render remove it? Did its `data-testid` change? Did a modal pop up and cover it? Did an animation prevent it from becoming stable? Did the page navigate away?

Standard Playwright reports give you the error. They don't give you the **story**.

Existing debugging workflows are manual and repetitive:
1. Add `page.pause()` — guess where the failure is
2. Re-run, inspect the DOM — try to spot the difference
3. Add more logging — re-run again
4. Finally give up and use `{ force: true }` — you'll never know what really happened

**This is the gap we set out to close.**

---

## 💡 Our Approach

Instead of just logging test steps, **playwright-forensics** treats each test as a **crime scene investigation**:

| Concept | What it means |
|---|---|
| **Time-Travel DOM** | Every `snapshot()` call freezes the page state — a complete DOM skeleton with attributes, visibility, text, and boolean state. You can rewind to any moment. |
| **Selector Archaeology** | The locator from the error message is traced backwards through the snapshot history. When did it last exist? What changed after that? |
| **Structural Diff** | Not just text comparison — a tree-aware diff that matches children by identity (id → testid → tag+text) rather than position. Children that shift order aren't falsely reported as "added and removed". |
| **Error Pattern Matching** | Playwright error messages are parsed against 30+ known patterns. A "Timeout 5000ms exceeded" is classified differently depending on whether it's a navigation timeout, a locator not found, or an element not stable. |
| **Causal Chain** | All of this is assembled into a human-readable verdict with a recommendation — not just what failed, but **why it failed** and **what to do about it**. |

The goal: **Every test failure should come with a debrief.** Not a stack trace — an explanation.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Your Test                            │
│  forensics.snapshot()  forensics.snapshot()  💥 fail   │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  Fixture Layer  (src/fixtures.ts)                       │
│                                                         │
│  ┌─────────────────┐  ┌──────────────────────────┐     │
│  │ DOM Snapshot     │  │ Mutation Log (optional)  │     │
│  │ page.evaluate()  │  │ MutationObserver inside  │     │
│  │ → DomNode tree   │  │ the page → batch records│     │
│  └────────┬─────────┘  └──────────┬───────────────┘     │
│           │                       │                     │
│           ▼                       ▼                     │
│  ┌──────────────────────────────────────────┐           │
│  │  History (immutable frozen snapshots)     │           │
│  └──────────────────────────────────────────┘           │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼  on test failure
┌─────────────────────────────────────────────────────────┐
│  Analysis Pipeline                                       │
│                                                         │
│  ┌──────────────┐   ┌──────────┐   ┌───────────────┐   │
│  │ Error Parser │──▶│ DOM Diff │──▶│ Selector      │   │
  │ │ 28 patterns  │   │ key-based│   │ Tracer (O(n)) │   │
│  └──────────────┘   └──────────┘   └───────┬───────┘   │
│                                            │           │
│                                            ▼           │
│  ┌──────────────┐   ┌──────────┐   ┌───────────────┐   │
│  │ HTML Report  │◀──│ Verdict  │◀──│ Causal Chain  │   │
│  │ interactive  │   │ Builder  │   │ Assembly      │   │
│  └──────────────┘   └──────────┘   └───────────────┘   │
│                                                         │
│  ┌──────────────┐                                       │
│  │ Plugin Hooks │  onVerdict / onReport                 │
│  └──────────────┘                                       │
└─────────────────────────────────────────────────────────┘
```

### Components in Detail

| Module | What it does | Key design decision |
|---|---|---|
| `dom-snapshot.ts` | Serialises the DOM from inside the browser into a lightweight `DomNode` tree | Uses `checkVisibility()` instead of `getBoundingClientRect()` — no layout thrashing. Traverses open Shadow DOM roots. Captures boolean attributes (`disabled`, `checked`, `readonly`, etc.) as a separate field — they're invisible in `getAttribute()`. |
| `mutation-log.ts` | Standalone `MutationObserver` injected into the page via `page.evaluate()` | Records are stored on `window.__forensicsMutationRecords` as a global array — survives page navigations within the same origin. Each record includes a CSS selector path to the target element, built by walking up the tree with `:nth-of-type()` disambiguation. |
| `error-patterns.ts` | 28 regex patterns ordered from most specific to most general | Critical ordering constraint: `"wait-visible-enabled-stable"` must precede `"wait-visible"` because the former is a superset of the latter. This is documented in a JSDoc warning. |
| `error-parser.ts` | Extracts locators, timeouts, expected/actual values from error text. Classifies errors against 28 ordered patterns. | Supports chained locators: `getByTestId('list').getByText('Item 1')` is parsed into a chain array. Handles both the error message body and the `Locator:` annotation. |
| `selector-tracer.ts` | Traces a locator backwards through snapshot history | Pre-computes a single-pass cache (`O(n)` per snapshot) instead of searching from scratch for each step. Detects `className`, `text`, `visibility`, `data-testid`, and `booleanAttrs` changes between steps. |
| `dom-diff.ts` | Structural diff of two `DomNode` trees | Children are matched by **identity key** (`id` → `data-testid` → tag+text) rather than index. This prevents false positives when sibling elements are reordered. Tracks tag existence, class, text, visibility, and boolean attribute changes. |
| `verdict-builder.ts` | 26 verdict templates with context-aware explanations | A `locator-timeout` verdict is dynamically categorised: if the element was found at the failure step → actionability issue; if it disappeared earlier → `dom-disappeared`; if never found → `locator-not-found`. Each verdict includes a human-readable recommendation. |
| `plugin.ts` | Full plugin system with `onVerdict` and `onReport` hooks | Lazy `createRequire(import.meta.url)` — first call only. Falls back to dynamic `import()`. Duplicate plugin detection with a console warning. Plugins can modify the verdict or the report text/HTML. |

---

## 📦 Installation

```bash
npm install playwright-forensics --save-dev
```

Requires **Node >= 18** and **@playwright/test >= 1.40**.

---

## 🚀 Quick Start

### 1️⃣ Add the reporter

In `playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['list'],
    ['playwright-forensics/reporter'],
  ],
});
```

### 2️⃣ Use the forensics fixture in your tests

```ts
import { test, expect } from 'playwright-forensics';

test('form submission', async ({ page, forensics }) => {
  await page.goto('/form');
  await forensics.snapshot();              // 📸 Step 0 — initial state

  await page.fill('#name', 'John');
  await forensics.snapshot();              // 📸 Step 1

  await page.click('#submit-btn');
  await forensics.snapshot();              // 📸 Step 2 — after submission

  await expect(page.getByTestId('success-message')).toBeVisible();
});
```

### 3️⃣ Run your tests

```bash
npx playwright test
```

After each failure, the console prints a direct link to the forensics report:

```
  ── [playwright-forensics] ─────────────────────────
     🔍 Open report:
        /home/.../test-results/.../forensics-report.html
     🖥️  Or: npx pwf open "test-results/..."
  ─────────────────────────────────────────────────────
```

### 4️⃣ (Optional) Enable mutation logging

```ts
test('form with mutation log', async ({ page, forensics }) => {
  await page.goto('/form');
  await forensics.startMutationLog();       // Start watching for DOM changes
  await forensics.snapshot();

  await page.fill('#name', 'John');
  await forensics.snapshot();              // Changes between step 0→1 captured

  await page.click('#submit-btn');
  await forensics.snapshot();              // Changes between step 1→2 captured

  await expect(page.getByTestId('message')).toBeVisible();
});
```

Mutation logs appear in the report as per-step batches with type, target path, attribute name, and added/removed node counts.

> **Note:** The first `forensics.snapshot()` call happens automatically when the test starts — capturing the initial page state before any user action. This means snapshot #0 is always available in the report, even if you never call `snapshot()` explicitly. Your explicit calls create snapshots #1, #2, etc.

---

## 🎯 Features

### Time-Travel DOM Viewer

Each `forensics.snapshot()` call captures a portable DOM skeleton:

```json
{
  "tag": "button",
  "id": "submit-btn",
  "className": "btn primary",
  "text": "Submit",
  "attributes": {
    "data-testid": "submit-btn",
    "type": "submit"
  },
  "children": [],
  "visible": true,
  "booleanAttrs": ["disabled"]
}
```

The HTML report includes an interactive timeline — click through snapshots to watch the DOM change step by step, with the failure point highlighted in red.

### Smart Error Classification

Playwright throws generic timeouts. We classify them into **25 specific failure types** by analysing the error message against an ordered set of patterns:

| Pattern | Example error text | Classification |
|---|---|---|
| `net::ERR_\w+` | `net::ERR_CONNECTION_REFUSED` | `network-error` |
| `strict mode violation` | `strict mode violation: resolved to 3 elements` | `strict-mode-violation` |
| `element is not visible` | `element is not visible` | `not-visible` |
| `element is not stable` | `element is not stable` | `not-stable` |
| `intercepts pointer events` | `element is not receiving events` | `obscured` |
| `expect.*\.toHaveText()` | `expect(locator).toHaveText()` | `assertion-text-mismatch` |
| `expect.*\.toHaveCount()` | `expect(locator).toHaveCount()` | `assertion-count-mismatch` |

And many more — including `target-closed`, `frame-detached`, `execution-context-destroyed`, `navigation-timeout`, `page-crash`, and 9 assertion sub-types.

### Context-Aware Verdicts

The same error type gets different explanations depending on the DOM history:

- **Element never found** → "The selector was never present in any snapshot. Possible cause: wrong URL, element loads after timeout, or the locator is incorrect."
- **Element found but disappeared** → "The selector existed at step 2 but was removed at step 3. Changes: class changed from 'loading' to 'complete', then the element was replaced with a new DOM subtree."
- **Element found at failure point** → "The selector exists in the DOM but failed actionability checks. It may be hidden by an overlay, still animating, or not yet enabled."

### DOM Diff with Identity Tracking

Most DOM diff tools compare by **position** (first child vs first child). This breaks when elements are reordered. Our diff uses **identity keys**:

1. `id` attribute (highest priority — HTML spec guarantees uniqueness)
2. `data-testid` attribute (Playwright convention)
3. Fallback: `tag + text`

When children are swapped, the diff correctly reports **no change**. When a child's `data-testid` changes, it's detected as a modification of the same element — not a removal + addition.

---

## 🖥️ CLI

```
npx pwf open <path>                        — Open a forensics report
npx pwf report [dir]                       — Summary of all failures
npx pwf watch [pattern] [...args]          — File watcher with auto re-run
npx pwf diff <run1> <run2>                 — Compare two test runs
npx pwf demo                               — Quick reference
```

### open

```bash
# Open a specific report file
npx pwf open ./test-results/.../forensics-report.html

# Open by test results directory (auto-resolves to report)
npx pwf open ./test-results/my-failed-test/
```

Opens the HTML report in your default browser (uses `open` on macOS, `xdg-open` on Linux, `start` on Windows).

### report

```bash
# Generate a summary page from all failures in a directory
npx pwf report test-results/
```

Scans all `forensics-report.html` files, extracts test names, and generates `forensics-summary.html` with a clean card layout — each failure links to its full report.

### watch

```bash
# Watch test files and re-run on changes
npx pwf watch

# Custom glob pattern + extra args to Playwright
npx pwf watch "src/**/*.spec.ts" --headed --project=chromium
```

Uses chokidar with 500ms debounce. Extra arguments are passed directly to `npx playwright test`. Automatically re-runs when test files change and prints pass/fail status.

### diff

```bash
# Compare failures between two test runs
npx pwf diff ./test-results/run1/ ./test-results/run2/
```

Parses `forensics-report.txt` files in each directory and shows:
- **New Failures** — tests that passed in run 1 but failed in run 2
- **Fixed** — tests that failed in run 1 but pass in run 2
- **Still Failing** — with verdict comparison and change indicators

---

## ⚙️ Configuration

Create `.forensicsrc` or `forensics.config.json` in your project root:

```json
{
  "snapshotCount": 10,
  "plugins": ["./path/to/my-plugin.js"]
}
```

Or add to `package.json`:

```json
{
  "forensics": {
    "snapshotCount": 10
  }
}
```

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `snapshotCount` | `number` | unlimited | Maximum number of DOM snapshots to keep (oldest trimmed from head). Limits report size for long-running tests. |
| `plugins` | `string[]` | `[]` | Paths to plugin files (see Plugin System). |

---

## 🎯 Failure Scenarios

We tested against **16 real-world failure scenarios** (plus a passing baseline), each with its own HTML page that reproduces the exact conditions:

| # | Scenario | Page | Failure Detected | Verdict Category |
|---|---|---|---|---|
| 00 | Passing test — no report generated | `page1` | — (baseline) |
| 01 | `data-testid` changes on re-render | `page1` | `locator-timeout` | `dom-disappeared` |
| 02 | Element removed after list refresh | `page2` | `locator-timeout` | `dom-disappeared` |
| 03 | SPA route change destroys previous DOM | `page3` | `locator-timeout` | `dom-disappeared` |
| 04 | API data loads too slowly | `page4` | `locator-timeout` | `locator-not-found` |
| 05 | Modal overlay blocks target button | `page5` | `obscured` | `actionability` |
| 06 | Element hidden (display/visibility/opacity) | `page6` | `not-visible` | `actionability` |
| 07 | Iframe content replaced mid-test | `page7` | `locator-timeout` | `dom-disappeared` |
| 08 | CSS animation prevents stabilisation | `page8` | `not-stable` | `actionability` |
| 09 | Multiple elements match (strict mode) | `page9` | `strict-mode-violation` | `locator-not-found` |
| 10 | Button has `disabled` attribute | `page10` | `not-enabled` | `actionability` |
| 11 | Page closed during interaction | `page3` | `target-closed` | `runtime` |
| 12 | Network error (unreachable port) | — | `network-error` | `network` |
| 13 | Navigation race condition | `page13` | `target-closed` | `runtime` |
| 14 | `fill()` on a non-input `<div>` | `page14` | `not-editable` | `actionability` |
| 15 | `check()` on a `<button>` | `page15` | `not-checkbox` | `actionability` |
| 16 | Mutation logging captures re-render | `page1` | `locator-timeout` with mutation data | `dom-disappeared` |

All 16 failure scenarios (01–16) produce correct verdicts with appropriate categories, explanations, and recommendations. The passing baseline (00) does not generate a forensics report.

---

## 🔌 Plugin System

Extend forensics with custom hooks:

```ts
import type { ForensicsPlugin } from 'playwright-forensics';

const myPlugin: ForensicsPlugin = {
  name: 'slack-notifier',
  onVerdict(verdict, parsed, context) {
    console.log(`Test "${context.testName}" failed: ${verdict.label}`);
    return verdict;
  },
  onReport(report, context) {
    return {
      text: report.text + '\nCustom footer',
      html: report.html + '<p>Custom footer</p>',
    };
  },
};

export default myPlugin;
```

Load via config:

```json
{
  "plugins": ["./path/to/slack-notifier.js"]
}
```

Or register programmatically:

```ts
import { registerPlugin, getPlugin } from 'playwright-forensics';
registerPlugin(myPlugin);

// Later, retrieve a registered plugin by name
const plugin = getPlugin('slack-notifier');
```

> **Note:** `getPlugin()` is useful when you need to access a plugin that was registered by a third-party library or configuration file.

### Plugin API

```ts
interface PluginContext {
  testName: string;
  errorMessage: string;
  history: DomNode[];
  diffs: DiffResult[];
  trace?: SelectorTrace;
  mutationLogCount: number;
  networkErrorCode?: string;  // e.g. "ERR_CONNECTION_REFUSED"
}

interface ForensicsPlugin {
  name: string;
  onVerdict?: (verdict: Verdict, parsed: ParsedError, context: PluginContext) => Verdict;
  onReport?: (report: { text: string; html: string }, context: PluginContext) => { text: string; html: string };
}
```

---

## 📊 Sample HTML Report

The generated HTML report is a self-contained file (no external dependencies) with:

- **Verdict box** — icon, label, category badge (colour-coded: purple for `locator-not-found`, red for `dom-disappeared`, orange for `actionability`, teal for `network`, pink for `assertion`, grey for `runtime`/`unknown`)
- **Snapshot timeline** — clickable step numbers with keyboard navigation (← Previous / Next →)
- **DOM tree viewer** — expandable tree with syntax-highlighted tags, attributes, IDs, classes, and text; invisible elements are shown with strikethrough
- **DOM changes section** — colour-coded diff entries (green for added, red for removed, yellow for changed) with old/new values
- **Mutation log section** — per-batch breakdown with target paths, attribute names, and node counts
- **Error box** — full error message in a red monospace block
- **Responsive design** — works on desktop and mobile

---

## 🔬 Technical Details

### Why `checkVisibility()` instead of `getBoundingClientRect()`?

The standard approach to checking element visibility is `getBoundingClientRect()` + checking dimensions. This triggers a synchronous layout calculation (layout thrashing) and misses CSS-level invisibility (`visibility: hidden`, `opacity: 0`). The `checkVisibility()` method was added to the platform specifically for this use case — it checks all CSS visibility conditions in a single call without forcing layout.

### Why key-based child matching in DOM diff?

Index-based matching assumes the DOM tree structure is stable between snapshots. In dynamic applications (SPA routing, list re-rendering, conditional rendering), children are frequently reordered. Index-based diff would report every reordering as `removed` + `added` pairs — noise that obscures real changes. Key-based matching (by `id` → `data-testid` → tag+text) matches logical elements across structural changes, producing diffs that reflect actual semantic changes.

### Why `Object.freeze()` on history?

The `history` and `mutationLogs` arrays exposed to users are frozen to prevent accidental mutation. A test writer who does `forensics.history.push(...)` would silently corrupt the snapshot data without freezing. The getter-based implementation returns a fresh frozen copy on each access, so the array is always consistent with the current test state.

### How error pattern ordering works

The pattern matcher iterates through patterns in definition order and returns the first match. This means more specific patterns must appear before more general ones. For example:

- `"wait-visible-enabled-stable"` (matches "waiting for element to be visible, enabled and stable") comes before `"wait-visible"` (matches "waiting for element to be visible") — because the longer pattern is a superset of the shorter one
- `"not-enabled"` comes before `"wait-enabled"` — because the assertion error is more specific than the wait log
- `"assertion-attribute-mismatch"` comes before `"assertion-other"` — because attribute checks are a subset of general assertions

This ordering is documented with a JSDoc warning and enforced by code review.

---

## 🧪 Running This Package's Tests

```bash
# Build TypeScript
npm run build

# Run all tests (integration + unit)
npm test

# With Playwright HTML reporter
npm run test:report

# With visible browser
npm run test:headed

# Run unit tests only
npx playwright test test/scenarios/unit.spec.ts
```

The test suite includes:
- **16 integration tests** — each reproducing a real failure scenario with a dedicated HTML page and Playwright `test.fail()` assertions
- **1 passing baseline test**
- **73 unit tests** — covering `matchPattern`, `parseErrorMessage`, `diffDomTrees`, `traceSelector`, `buildVerdict`, `stripAnsi`, `escapeHtml`, plugin system, and config loading
- **CI** on push/PR to `main` — matrix: Ubuntu / macOS / Windows × Node 18 / 20 / 22

---

## 📄 License

MIT © [Roman Chovgun](https://github.com/anomalyco) — [Telegram](https://t.me/romanchovgun)

---

## 🧑‍💻 Built by Roman Chovgun

**Roman Chovgun** (Роман Човгун) is a test automation architect passionate about making developer tools that turn cryptic test failures into clear, actionable stories.

- 🔗 [GitHub](https://github.com/anomalyco)
- 💬 [Telegram](https://t.me/romanchovgun)
- 🐦 [X / Twitter](https://x.com/romanchovgun)

If you find this tool valuable, consider [sponsoring](https://github.com/sponsors/anomalyco) or starring the repo. Contributions, issues, and feature requests are always welcome.
