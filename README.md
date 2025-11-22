# Telegram UI Components

An interactive toolkit for building Telegram-style chat flows with inline keyboards. The project ships with a full-screen editor, Supabase-backed persistence (with local fallback), import/export helpers, and shareable previews—all built on Vite, React, TypeScript, Tailwind CSS, and shadcn-ui.

## What's in the box
- Message composer with Markdown-style formatting, live preview, and inline keyboard builder
- Screen manager for branching flows, undo/redo history, and circular reference detection
- Supabase storage with ready-to-use schema and localStorage fallback when cloud tables are unavailable
- Import/export for JSON and Telegram-compatible payloads, plus share tokens for quick demos

## Quick start
Prerequisites: Node.js and npm.

```sh
git clone <your-repo-url>
cd telegram-ui-components-main
npm install
npm run dev
```

## Environment variables
The repo includes a `.env` file with a default Supabase project for previews. To point at your own project, copy `.env.example` to `.env` (or edit the existing file) and update:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_STORAGE_URL` (if applicable to your setup)

## Useful scripts
- `npm run dev` — start the development server with hot reload
- `npm run build` — create a production build in `dist/`
- `npm run preview` — preview the production build locally
- `npm run lint` — run ESLint across the codebase
- `npm run test` — run unit tests (Vitest + jsdom)
- `npm run test:e2e` — run Playwright E2E suite (requires dev server env)

## Editing options
- **Local IDE**: Clone the repo, install dependencies, and develop with your preferred tools.
- **Edit on GitHub**: Use the GitHub UI to edit files directly and commit changes.
- **GitHub Codespaces**: Launch a codespace from the repository page to develop in a fully configured cloud environment.

## Deployment
Run `npm run build`, then deploy the generated `dist/` folder to any static host (e.g., Vercel, Netlify, Cloudflare Pages) or serve it with your preferred Node/edge runtime. Ensure the environment variables for Supabase are configured in your hosting platform.

## Quality gates & ops
- CI gates: lint → unit tests → build (see `.github/workflows/ci.yml`).
- Runbook: `docs/ops-runbook.md` covers Supabase backoff, offline queue, rate-limit guidance, and recovery steps.
- Sync badges in the UI surface share/layout request status with correlation IDs for debugging.‬‬
- Telemetry: hook `setSyncTelemetryPublisher` (see `docs/telemetry.md`) to forward sync events (share/layout/queue) with requestIds to your logging/analytics sink.
