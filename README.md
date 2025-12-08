# Telegram UI Components

Telegram UI Components 是一个交互式可视化工作台，用来设计 Telegram 机器人消息和带 inline keyboard 的对话流程。它提供完整的全屏编辑器、关系图、云端/本地持久化、导入导出和一键分享，让你从「构思对话」到「可直接接入 Bot 的 JSON/代码」一路打通。

An interactive toolkit for building Telegram-style chat flows with inline keyboards. It ships with a full-screen editor, Supabase-backed persistence (with local fallback), import/export helpers, and shareable previews—all built on Vite, React, TypeScript, Tailwind CSS, and shadcn-ui.

## Features
- Visual message composer with Markdown-style formatting, live preview, and inline keyboard builder
- Screen manager for branching flows with undo/redo history, circular reference detection, and safe delete guardrails
- Supabase storage with ready-to-use schema, offline queue, and localStorage fallback when cloud tables are unavailable
- Import/export for JSON and Telegram-compatible payloads, plus share tokens for quick demos or handoff to teammates

适用场景示例：
- 设计多轮问答、分支问卷、引导类机器人对话
- 为运营/产品搭建可视化工作台，避免直接改 JSON
- 快速验证文案和按钮布局，再接入真实机器人后端

## Quick start
Prerequisites: Node.js and npm.

```sh
git clone <your-repo-url>
cd telegram-ui-components
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

## Workbench guide
- **Entry & share**: Pick an entry screen from the left sidebar before exporting/sharing; sharing is blocked if the entry is missing or any button points to a deleted screen. Use “生成/复制入口链接” to publish and copy, “刷新链接” to rotate the token, and “取消公开” to revoke. Public pages live at `/share/:token`, show author/time metadata, and expose a “复制并编辑” action for signed-in users.
- **Template library**: Click the `模板库` button in the canvas toolbar to load curated starters from `public/templates/*.json`. Cards auto-validate keyboard/message content; use the refresh icon if the list fails to load. On first visit, the onboarding banner guides you to open the library.
- **Keyboard editor**: Inline edit or drag rows/buttons; double-click to rename quickly. Open button settings to choose callback/URL/link targets with byte counters (64B limit) and automatic text suffixes when linking screens. Row and button count limits are enforced with warnings, and overflow shows a red hint instead of breaking layout.
- **Flow diagram**: Open “查看关系图” from the left sidebar to inspect links between screens. Toggle layout direction, mind-map mode, focus on current node only, hide isolated nodes, or show button labels. Right-click nodes to set entry or delete, drag to rearrange, and connect nodes to create links. “保存布局” persists positions locally and to Supabase when signed in; “重置位置” clears saved layouts in both places and reverts to auto layout.

## Editing options
- **Local IDE**: Clone the repo, install dependencies, and develop with your preferred tools.
- **Edit on GitHub**: Use the GitHub UI to edit files directly and commit changes.
- **GitHub Codespaces**: Launch a codespace from the repository page to develop in a fully configured cloud environment.

## Deployment
Run `npm run build`, then deploy the generated `dist/` folder to any static host (e.g., Vercel, Netlify, Cloudflare Pages) or serve it with your preferred Node/edge runtime. Ensure the environment variables for Supabase are configured in your hosting platform.

## Quality gates & ops
- CI gates: lint → unit tests → build → Playwright e2e (see `.github/workflows/ci.yml`; provide Supabase test env or mock for e2e).
- Runbook: `docs/ops-runbook.md` covers Supabase backoff, offline queue, rate-limit guidance, and recovery steps.
- Sync badges in the UI surface share/layout request status with correlation IDs for debugging.‬‬
- Telemetry: hook `setSyncTelemetryPublisher` (see `docs/telemetry.md`) to forward sync events (share/layout/queue) with requestIds to your logging/analytics sink.
