# Telegram UI Components

一个可视化工作台，用来设计 Telegram 机器人消息和 inline keyboard 流程；带全屏编辑器、关系图、离线/云端持久化、导入导出、一键分享。Built with Vite + React + TypeScript + Tailwind + shadcn-ui.

## 目录 / Table of contents
- TL;DR (最短路径)
- 开发环境搭建（含 Supabase）
- 常用脚本
- 测试与质量门禁
- 功能概览
- 适用场景
- 参考文档
- Workbench 提示
- 编辑方式
- 部署
- 质量门禁与运维

## TL;DR
```bash
git clone https://github.com/tytsxai/telegram-ui-components.git
cd telegram-ui-components
npm ci
cp .env.example .env # 填写你的 Supabase 项目/本地 dev 实例
npm run dev
# 浏览器打开 http://localhost:5173
```

## 开发环境搭建（含 Supabase）
Prereqs: Node.js ≥18, npm.

1) 环境变量（`.env`，已提供模板）

| Key | 说明 |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase 项目 URL，或本地 `supabase start` 地址 |
| `VITE_SUPABASE_PROJECT_ID` | 项目标识，用于迁移/类型生成 |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | anon/publishable key，前端调用 Supabase 用 |
| `VITE_SUPABASE_STORAGE_URL` | 可选，若使用自定义 Storage 域名 |
| `SUPABASE_SERVICE_ROLE_KEY` | 可选，脚本/烟雾测试使用（服务端安全存储） |
| `SUPABASE_ACCESS_TOKEN` | 可选，`supabase gen types` CLI 登录用 |

2) 初始化数据库（任选其一）
- 已有项目：执行 `scripts/supabase/schema.sql` 或 `supabase db push` 应用 `supabase/migrations/*`。
- 本地 dev：安装 Supabase CLI，运行 `supabase start`，然后 `supabase db push`。

3) 生成/校验类型（需要 `SUPABASE_PROJECT_REF` 可用）
```bash
SUPABASE_PROJECT_REF=<ref> npm run supabase:types
SUPABASE_PROJECT_REF=<ref> npm run check:supabase-types
```

## 常用脚本
| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 本地开发（Vite） |
| `npm run build` | 生产构建 |
| `npm run preview` | 本地预览生产构建 |
| `npm test` | Vitest 单元/集成测试 |
| `npm run lint` / `npm run lint:fix` | ESLint 检查/修复 |
| `npm run test:e2e` | Playwright（需先 `npm run dev` 并提供 Supabase env） |
| `npm run smoke:rls` | Supabase RLS 烟雾测试（需 service role） |

## 测试与质量门禁
- 本地提交前：`npm run lint && npm test && npm run build`。
- 涉及 Supabase schema/type：运行 `check:supabase-types` 并确保无 diff。
- E2E：启动本地 dev + Supabase，再跑 `npm run test:e2e`。

## 功能概览
- 消息编辑器：Markdown 风格格式化、实时预览、inline keyboard 构建。
- 屏幕管理：分支流程、撤销重做、循环检测、安全删除提示。
- 持久化：Supabase 云端 + 本地离线队列；RLS 保护；分享/入口 token 管理。
- 导入导出：JSON/Telegram 兼容格式；模板库；分享页可复制到个人账户。

## 适用场景
- 多轮问答、问卷、引导类机器人对话设计。
- 为运营/产品提供可视化工作台，避免直接编辑 JSON。
- 先验证文案/按钮布局，再对接真实机器人后端。

## 参考文档
- `docs/improvement-plan.md`（整体规划）
- `docs/backend-readiness.md`（Supabase/RLS 检查清单）
- `docs/cloud-persistence.md`（云持久化步骤）
- `docs/ops-runbook.md`（同步/重试运维）
- `docs/ui-test-plan.md`（UI 测试清单）
- `docs/telemetry.md`（同步遥测接入）

## Workbench 提示
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

## 质量门禁与运维
- CI gates: lint → unit tests → build → Playwright e2e (see `.github/workflows/ci.yml`; provide Supabase test env or mock for e2e).
- Runbook: `docs/ops-runbook.md` covers Supabase backoff, offline queue, rate-limit guidance, and recovery steps.
- Sync badges in the UI surface share/layout request status with correlation IDs for debugging.‬‬
- Telemetry: hook `setSyncTelemetryPublisher` (see `docs/telemetry.md`) to forward sync events (share/layout/queue) with requestIds to your logging/analytics sink.
