# Contributing to Playwright Forensics

Thanks for your interest! Here's how to get started.

## Development

```bash
git clone <your-fork>
cd playwright-forensics
npm install
npx playwright install chromium
npm run build
npm test
```

## Code Style

- TypeScript strict mode
- 2-space indentation
- No semicolons where possible
- Use `import type` for type-only imports
- All exports from `src/index.ts`

## Pull Requests

1. Fork the repo
2. Create a feature branch
3. Add tests for your changes
4. Run `npm run build && npm test`
5. Open a PR against `main`

## Adding a New Failure Scenario

1. Create an HTML page in `test-pages/` that reproduces the condition
2. Create a test in `test/scenarios/` using `test.fail()`
3. Add the scenario to the table in `README.md`
4. If a new `FailureType` is needed, add it to `error-parser.ts`, `error-patterns.ts`, and `verdict-builder.ts`

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
