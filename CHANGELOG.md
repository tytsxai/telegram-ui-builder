# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project adheres to Semantic Versioning.


## [0.1.2] - 2026-05-19

### Added (Documentation)

- **`llms.txt`** — AI-search-engine index covering positioning ("design layer, not runtime"), what it does / doesn't do, common questions, framework-agnostic export rationale.
- **README — title** expanded to bilingual SEO-friendly form.
- **README — keyword block** with long-tail terms (Telegram bot UI designer, Telegram inline keyboard builder, BotFather UI alternative, ManyBot / Chatfuel alternative).
- **README — 7-question FAQ** clarifying it's not the official Telegram tool, not a runtime, framework-agnostic export, 64-byte callback limit, share-token rotation, and competitive comparison.
- **README — Live demo / llms.txt / Changelog / Contributing / Security / Issues nav row**.

### Notes

Documentation-only release. Editor, flow graph, Supabase persistence, share token, and import/export behavior unchanged from 0.1.1.

## [0.1.1] - 2025-12-24

### Fixed
- **UI**: Decoupled the top toolbar from the phone simulator width constraint to resolve overlapping text issues.
- **Config**: Relaxed runtime environment checks (`runtimeConfig.ts`) so the app can launch even with missing or placeholder Supabase keys.
- **Build**: Updated `verify-env.mjs` to prevent build failures on environment validation warnings.
- **Tests**: Fixed `supabaseMock.ts` to support `get_public_screen_by_token` RPC calls in E2E tests.

### Changed
- **Docs**: Updated `README.md` and `package.json` with the new Lovable demo URL: `https://telegram-ui-components.lovable.app`.
- **Dev**: Updated Playwright config to default to port 8080.


### Added
- Repository governance docs: `LICENSE`, `SECURITY.md`, `CODE_OF_CONDUCT.md`
- Social preview metadata improvements (OG image points to a repo-owned asset)

### Changed
- Repository renamed to `telegram-ui-builder` for clearer product positioning
- Documentation and in-app repository links updated to the new canonical URL

---

Keep a Changelog: https://keepachangelog.com/en/1.1.0/  
Semantic Versioning: https://semver.org/

