# Changelog

## [0.2.0-rc.1] - 2026-07-13

### Added
- Evidence-based verdict confidence and limitations.
- Locator AST/engine for scoped chains, ARIA semantics, regex/exact, filters, nth, CSS/basic XPath, and frame evidence.
- Bounded/redacted DOM schema v2, per-snapshot mutation batches, and JSON reports.
- Best-effort Playwright trace action/network/console ingestion.
- Trace-first `pwf analyze trace.zip` workflow with no fixture or manual snapshots required.
- Playwright DOM snapshot and subtree-reference decoding for trace versions 3–8.
- Shared failure-analysis pipeline and standalone HTML/TXT/JSON artifact writer.
- Real browser-generated trace and packaged CLI smoke tests.
- Golden-style hardening tests, package smoke CI, and gated release workflow.

### Fixed
- Reports now survive a closed page while mutation logging is active.
- `snapshotCount` is loaded before the first snapshot and enforced.
- Visibility includes opacity and CSS visibility.
- Text/testid mutations and sibling reorder no longer become false removed/added pairs.
- Repository metadata and Node 18 watcher compatibility.

### Security
- Default redaction for form values, secret-like attributes, headers, and URL queries.
- Node, byte, text, mutation, snapshot, and trace-event limits.

## [0.1.0] - 2026-07-07

### Added
- Initial release of `playwright-forensics`

### Fixed (pre-release polish)
- Fixed Windows `start` command in CLI (`spawn('start', ...)` → `cmd /c start ""`)
- Fixed `data-testid` removal detection in selector-tracer (three-branch logic: removed/added/changed)
- Fixed regex `\n` to `\r?\n` for Windows CRLF compatibility in CLI
- Fixed duplicate key collision in DOM diff `nodeKey()` — added `@${index}` suffix
- Fixed `moduleResolution` from `"bundler"` to `"Node16"` in `tsconfig.json`
- Fixed Scenario 11 test — rewritten to test `target-closed` using `page3-spa-router.html`
- Removed stale `test-pages/page11-dialog-blocking.html` (unreachable in PW v1.52+)

### Changed
- Added attribute-level diff in `dom-diff.ts` (compares full attributes map excluding `data-testid`)
- Added config key validation in `config.ts` — warns on unknown keys
- Added `resetConfigCache()` calls in CLI watch mode on file change events
- Added SIGINT handler in CLI — calls `watcher.close()` before exit
- Moved `chokidar` from `dependencies` to `optionalDependencies` with lazy dynamic import
- Exported `stripAnsi` from `fixtures.ts` and switched unit tests to use it
- Removed `dialog-blocking` pattern (unreachable in Playwright v1.52+)
- Removed `reportDir` from config interface (dead option — never read)
- Removed `.ts` fallback in `resolvePluginPath` (unsupported at runtime)
- Limited HTML report inlining to last 25 snapshots (was unbounded)
- Added graceful fallback in `playwright.config.ts` if `dist/` is not built
- Improved error logging in `snapshot()` — suppresses only expected page-closed errors
- Added `sideEffects: false`, `exports` paths, `funding`, `engines.npm >=9` to `package.json`
- Updated `keywords` with `e2e`, `testing`, `automation`, `quality-assurance`
- Added `*.log`, `coverage/`, `.env` to `.gitignore`
- Updated README — fixed failure type count (28→25), scenario count, added badges and "Built by" section
- Updated CI — added `tsc --noEmit` type-check step, uses config reporter instead of `--reporter=list`
- LICENSE, CONTRIBUTING.md, SECURITY.md, CHANGELOG.md all in place

### Added (tests)
- 73 unit tests covering: matchPattern, parseErrorMessage, diffDomTrees, traceSelector, buildVerdict, stripAnsi, escapeHtml, plugin system, loadConfig
- 17 integration tests covering real failure scenarios + 1 passing baseline
