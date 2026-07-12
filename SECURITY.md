# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Playwright Forensics, please report it privately by opening a [GitHub Security Advisory](https://github.com/RomanChovgun/playwright-forensics/security/advisories/new).

Please do **not** report security vulnerabilities through public GitHub issues.

We will acknowledge receipt within 48 hours and strive to provide a fix within 14 days.

## Sensitive diagnostic data

Forensics reports can contain DOM structure, test errors, mutation values, URLs, console output, and network metadata. Redaction and storage limits are enabled by default, including form values, password/token-like attributes, authorization/cookie headers, and URL query strings.

- Keep redaction enabled in shared CI.
- Add application-specific secret attributes to `redaction.attributes`.
- Treat `test-results` and `trace.zip` as sensitive artifacts; use short retention and restricted access.
- Review custom plugins: they receive already-redacted core context, but can append arbitrary content.
- Never use reports as a secrets store. Redaction is defense in depth and cannot identify every domain-specific PII format.

If an unredacted secret reaches an artifact, revoke it, remove the artifact, and report any collector bypass privately.
