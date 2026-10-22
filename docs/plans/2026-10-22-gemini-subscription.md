# Gemini Subscription Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan. Steps use checkbox syntax for tracking.

**Goal:** Add a Gemini subscription backend through the existing CLIProxyAPI connection, with regression tests and setup instructions.

**Architecture:** Reuse the router's existing `models` routing, `modelMapping`, credential isolation, and model picker. Add a `gemini` entry to the example configuration; do not change the proxy implementation or existing default backend. Use CLIProxyAPI's documented Antigravity Google OAuth path rather than the removed Gemini CLI login flag.

**Tech Stack:** Node.js 18+, built-in `node:test` and HTTP servers, existing CLIProxyAPI, Docker.

**Spec:** The user approved Gemini support, a separate branch, and a PR in the conversation on 2026-10-22, then selected subscription authentication rather than a Gemini API key. Antigravity OAuth is an implementation choice based on installed CLIProxyAPI v7.3.15; it is not a claim that the user has authenticated or accepted account-access risks.

## Global Constraints

- Keep `activeBackend` set to `claude` and preserve existing GPT and MiniMax configuration.
- Reuse `CLIPROXY_BASE_URL` and `CLIPROXY_KEY`; the latter authenticates to the local proxy, not Google's paid API.
- Do not add dependencies, change the external CLIProxyAPI installation, or overwrite local `config.json`.
- Do not run Google login, inspect OAuth credentials, or send real model-generation requests.
- Warn about reported third-party OAuth access restrictions, subscription eligibility, quotas, and optional credit spending before login instructions.
- Do not add Chinese characters, secrets, or conversational persona text to files.
- Create the PR from `feat/gemini-backend`; do not merge it.

## Review Focus

1. Gemini model selection must override the active Claude backend without changing the model ID.
2. Global switching to Gemini must map unlisted Claude model IDs while explicit GPT choices still route to GPT.
3. Client Claude bearer tokens, cookies, and API keys must not reach CLIProxyAPI.
4. A missing local proxy key must hide Gemini from the picker and reject switching or model requests, without disabling Claude.
5. Gemini token-count and SSE requests must use the same generic proxy path without corrupting the response.

## Task 1: Configuration, tests, and setup guide

**Files:**
- Modify: `config.example.json`, `README.md`, `docs/launcher.md`, `docs/ai-setup.md`, `skill/switch-backend.md`.
- Create: `test/gemini.test.js`, `docs/gemini-setup.md`.

**Interfaces:**
- Consume: `loadConfig(configPath)`, `selectBackend(state, model)`, `buildModelPicker(state)`, `createServer(state)`.
- Produce: `backends.gemini` using the shared CLIProxyAPI address/key, `modelMapping: "gemini-pro-agent"`, and Gemini Pro/Flash picker models.

- [x] Verify installed login flags and official model IDs without accessing credentials.
- [x] Add tests against the real example configuration and local HTTP upstreams. Cover each Review Focus item, default Claude routing, picker output, and unavailable Gemini requests.
- [x] Run `node --test test/gemini.test.js` before the configuration change; confirm failure because the Gemini backend is absent.
- [x] Add the Gemini backend with verified IDs `gemini-pro-agent` and `gemini-3-flash`. Keep client-auth forwarding disabled.
- [x] Run the new tests and full suite. Run coverage and verify at least 80% for application lines.
- [x] Document OAuth risks, exact supported login command, model discovery, safe incremental config changes, model selection, switching, and manual verification.
- [x] Review the full diff, run syntax and whitespace checks, and scan changed files for secrets and Chinese characters. Record unavailable independent review rather than claiming it ran.

## Publication

After verification, commit the changes, push with upstream tracking, and open a PR with the verification evidence and remaining manual login steps. The user authorized these actions; do not merge the PR.

## Verification Evidence

- Installed container help: CLIProxyAPI v7.3.15, commit `673131f`; `-antigravity-login` and `-no-browser` exist, while `-login` does not.
- Installed-version model catalog includes `gemini-pro-agent` and `gemini-3-flash`.
- Existing CLIProxyAPI `/v1/models` returns HTTP 200 but no Gemini IDs before subscription login.
- Official OAuth instructions: https://help.router-for.me/configuration/provider/antigravity
- Subscription plan conditions: https://antigravity.google/docs/plans
- User-reported restriction, not a proven causal finding: https://github.com/router-for-me/CLIProxyAPI/issues/1814
- RED: all 8 new tests failed before the backend was added; GREEN: all 8 passed afterward.
- Full suite: 131 passed, 0 failed, 0 skipped. Application coverage: lines 93.68%, branches 86.54%, functions 96.67%.
- Syntax and diff checks passed. Changed files passed credential-pattern, forbidden-character, local-link, and guide/example JSON consistency checks.
- Independent automated review could not run: Claude subagents hit their weekly limit and native Codex requests were rejected for account/model compatibility. The main session reviewed the changes and ran the checks above; no independent-review success is claimed.
- Google OAuth login, account eligibility, and a real Gemini response remain manual and unverified. The live router, ignored `config.json`, and upstream settings were not changed.
