<div align="center">
  <img src="https://img.shields.io/badge/Playwright-45ba4b?style=for-the-badge&logo=Playwright&logoColor=white" alt="Playwright" />
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Node-18%2B-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node >= 18" />
  <img src="https://img.shields.io/github/stars/RomanChovgun/playwright-forensics?style=for-the-badge&logo=github&label=stars" alt="GitHub stars" />
  <img src="https://img.shields.io/github/last-commit/RomanChovgun/playwright-forensics?style=for-the-badge&logo=github&label=updated" alt="last commit" />
</div>

<br />

<div align="center">
  <h1>🔍 Playwright Forensics</h1>
  <p><strong>Evidence-based post-mortem analysis for Playwright tests.<br />
  Not just "test failed" — a confidence-rated explanation of what likely went wrong.</strong></p>

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
| **Time-Travel DOM** | Every `snapshot()` call captures a bounded, redacted DOM representation with attributes, visibility, direct text, and boolean state. |
| **Selector Archaeology** | The locator from the error message is traced backwards through the snapshot history. When did it last exist? What changed after that? |
| **Structural Diff** | A tree-aware diff matches children using structural and semantic evidence rather than position alone. Ambiguous fallback matches are marked with lower confidence. |
| **Error Pattern Matching** | Playwright error messages are parsed against 28 ordered patterns. A timeout is classified differently for navigation, locator lookup, and actionability. |
| **Causal Chain** | Evidence is assembled into a human-readable verdict, confidence level, limitations, and recommendation. |

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
  │  │ 28 patterns  │   │ key-based│   │ Tracer (O(n)) │   │
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
| `dom-snapshot.ts` | Serialises a bounded, redacted DOM tree | Captures direct text, ARIA semantics, structural identity, open Shadow DOM and CSS visibility including opacity. |
| `mutation-log.ts` | Bounded `MutationObserver` injected via `page.evaluate()` | Flushes one redacted batch at each snapshot boundary and reports dropped ring-buffer records. |
| `error-patterns.ts` | 28 regex patterns ordered from most specific to most general | Critical ordering constraint: `"wait-visible-enabled-stable"` must precede `"wait-visible"` because the former is a superset of the latter. This is documented in a JSDoc warning. |
| `error-parser.ts` | Extracts failure evidence and a locator AST | Preserves chains and supports string/regex, exact/name, filter text, nth/first/last, CSS, basic XPath and frames. |
| `selector-tracer.ts` | Evaluates the AST through snapshot history | Uses scoped chains, implicit roles, accessible names and direct text; ambiguity becomes a limitation. |
| `dom-diff.ts` | Identity-aware structural diff | Keeps text/testid mutations as `changed` and reorder as `moved`, with match confidence. |
| `verdict-builder.ts` | 25 evidence-based verdict templates | Emits `confirmed`, `likely`, or `insufficient-evidence` with evidence and limitations. |
| `trace-reader.ts` | Version-tolerant `trace.zip` reader | Normalizes actions, DOM snapshots, network, console, source locations, and subtree references; unknown records degrade to warnings. |
| `plugin.ts` | Full plugin system with `onVerdict` and `onReport` hooks | Lazy `createRequire(import.meta.url)` — first call only. Falls back to dynamic `import()`. Duplicate plugin detection with a console warning. Plugins can modify the verdict or the report text/HTML. |

---

## 📦 Installation

The package is currently an unpublished **0.2.0 release candidate**. Install its verified tarball:

```bash
npm ci && npm run build && npm pack
npm install --save-dev ./playwright-forensics-0.2.0-rc.1.tgz
```

`npm install playwright-forensics --save-dev` will be supported after the public release.

Requires **Node >= 18** and **@playwright/test >= 1.40**.

---

## 🚀 Trace-First Quick Start

No custom fixture or manual `forensics.snapshot()` calls are required. Enable Playwright tracing:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  use: {
    trace: 'retain-on-failure',
  },
});
```

Run the tests, then analyze any failed trace:

```bash
npx playwright test
npx pwf analyze test-results/my-failed-test/trace.zip --output trace-report/
```

The command reconstructs the failed action and available DOM snapshots, correlates network and console evidence, and writes:

- `forensics-report.html`
- `forensics-report.txt`
- `forensics-report.json`

```bash
npx pwf analyze trace.zip --open
```

Trace versions 3–8 are accepted through version-tolerant adapters. The current Playwright trace format is covered by a real browser-generated trace test. Unknown or partially decodable records are reported as limitations instead of confident conclusions.

---

## 🧩 Fixture-Assisted Workflow

Use the fixture when you need explicit domain-specific checkpoints or mutation batches.

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

Most DOM diff tools compare by **position**. The matcher instead combines:

1. structural snapshot identity
2. `id` and `data-testid`
3. accessible name and direct text
4. a low-confidence positional fallback

Reordered children are reported as `moved`. Text and `data-testid` mutations remain changes to the same matched element instead of becoming misleading removal/addition pairs.

---

## 🖥️ CLI

```
npx pwf open <path>                        — Open a forensics report
npx pwf analyze <trace.zip> [-o dir]       — Analyze a trace without fixtures
npx pwf report [dir]                       — Summary of all failures
npx pwf watch [pattern] [...args]          — File watcher with auto re-run
npx pwf diff <run1> <run2>                 — Compare two test runs
npx pwf demo                               — Quick reference
```

### analyze

```bash
npx pwf analyze ./test-results/failed-test/trace.zip
npx pwf analyze ./trace.zip --output ./report --open
```

Finds the failed action, decodes available Playwright DOM snapshots, and generates standalone HTML/TXT/JSON reports. It exits with an error for missing or invalid archives and records compatibility gaps in the report.

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
  "maxNodes": 5000,
  "maxSnapshotBytes": 2000000,
  "maxTextLength": 500,
  "maxMutationRecords": 1000,
  "redaction": {
    "enabled": true,
    "replacement": "[REDACTED]",
    "attributes": ["value", "authorization", "cookie", "data-token"],
    "urlQuery": true
  },
  "trace": { "enabled": true, "maxEvents": 1000 },
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
| `snapshotCount` | `number` | `25` | Maximum snapshots retained and embedded in reports. |
| `maxNodes` | `number` | `5000` | Maximum nodes per snapshot. |
| `maxSnapshotBytes` | `number` | `2000000` | Maximum serialized bytes per snapshot. |
| `maxTextLength` | `number` | `500` | Maximum captured text/attribute length. |
| `maxMutationRecords` | `number` | `1000` | Mutation ring-buffer size per interval. |
| `redaction` | `object` | enabled | Sensitive attributes, form values, and URL query policy. |
| `trace` | `object` | enabled | Best-effort trace ingestion and event limit. |
| `plugins` | `string[]` | `[]` | Paths to plugin files (see Plugin System). |

---

## 🎯 Failure Scenarios

The test suite covers **16 diagnostic failure scenarios**, one closed-page teardown regression, and a passing baseline:

| # | Scenario | Page | Failure Detected | Verdict Category |
|---|---|---|---|---|
| 00 | Passing test — no report generated | `page1` | — (baseline) |
| 01 | `data-testid` changes on re-render | `page1` | `locator-timeout` | `dom-disappeared` |
| 02 | Element removed after list refresh | `page2` | `locator-timeout` | `dom-disappeared` |
| 03 | SPA route change destroys previous DOM | `page3` | `locator-timeout` | `dom-disappeared` |
| 04 | API data loads too slowly | `page4` | `locator-timeout` | `locator-not-found` |
| 05 | Modal overlay blocks target button | `page5` | `obscured` | `actionability` |
| 06 | Element hidden (display/visibility/opacity) | `page6` | `not-visible` | `actionability` |
| 07 | Iframe content replaced mid-test | `page7` | `locator-timeout` | `locator-not-found` with insufficient frame evidence |
| 08 | CSS animation prevents stabilisation | `page8` | `not-stable` | `actionability` |
| 09 | Multiple elements match (strict mode) | `page9` | `strict-mode-violation` | `locator-not-found` |
| 10 | Button has `disabled` attribute | `page10` | `not-enabled` | `actionability` |
| 11 | Page closed during interaction | `page3` | `target-closed` | `runtime` |
| 12 | Network error (unreachable port) | — | `network-error` | `network` |
| 13 | Navigation replaces previous DOM | `page13` | `locator-timeout` | `dom-disappeared` |
| 14 | `fill()` on a non-input `<div>` | `page14` | `not-editable` | `actionability` |
| 15 | `check()` on a `<button>` | `page15` | `not-checkbox` | `actionability` |
| 16 | Mutation logging captures re-render | `page1` | `locator-timeout` with mutation data | `dom-disappeared` |
| 17 | Page closes while mutation logging is active | inline page | `target-closed` | `runtime` |

CI validates generated TXT/HTML/JSON artifacts and expected verdict categories for all diagnostic scenarios. Verdicts include confidence and limitations when evidence is ambiguous. The passing baseline (00) does not generate a report.

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

The collector calls `checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true })`, then uses computed style and client rects as a compatibility fallback. It captures `display:none`, `visibility:hidden`, and `opacity:0`; this is diagnostic visibility, not a complete reimplementation of Playwright actionability.

### Why key-based child matching in DOM diff?

Index-based matching assumes a stable tree. The matcher instead prioritises structural identity, `id`, `data-testid`, accessible name, and direct text, with a low-confidence positional fallback. Ambiguous matches are marked rather than presented as certain.

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
- **17 failure integration tests** — 16 diagnostic scenarios plus the closed-page mutation regression
- **1 passing baseline test**
- **Focused hardening tests** — locator AST/ARIA semantics, safe collection, redaction/limits, mutation batching, identity diff, trace parsing, and report safety
- **CI** on push/PR to `main` — matrix: Ubuntu / macOS / Windows × Node 18 / 20 / 22

---

## Original Concept

The original idea and product direction for Playwright Forensics were created by **Roman Chovgun**.

- [GitHub](https://github.com/RomanChovgun)
- [Telegram](https://t.me/romanchovgun)
