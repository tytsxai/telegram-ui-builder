# Telegram UI Builder - Telegram Bot UI & Inline Keyboard Designer

> Open-source Telegram bot UI designer / 开源 Telegram 机器人消息与 inline keyboard 可视化设计器。
> A React + TypeScript workbench for designing, previewing, sharing, and exporting Telegram bot messages, inline keyboards, and multi-screen conversation flows.

[![CI](https://github.com/tytsxai/telegram-ui-builder/actions/workflows/ci.yml/badge.svg)](https://github.com/tytsxai/telegram-ui-builder/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/tytsxai/telegram-ui-builder)](LICENSE)
[![Release](https://img.shields.io/github/v/release/tytsxai/telegram-ui-builder)](https://github.com/tytsxai/telegram-ui-builder/releases)

[Live Demo](https://telegram-ui-components.lovable.app) · [Docs](docs/README.md) · [llms.txt](llms.txt) · [Changelog](CHANGELOG.md) · [Contributing](docs/contributing.md) · [Security](SECURITY.md) · [Issues](https://github.com/tytsxai/telegram-ui-builder/issues)

## 项目定位 / Project Snapshot

Telegram UI Builder 是一个 **Telegram bot conversation UI builder**：产品、运营和开发者可以在浏览器里设计 Telegram 机器人消息内容、inline keyboard、入口屏幕和分支流程，先把交互结构看清楚，再导出 JSON 或代码片段交给真实机器人后端实现。

English positioning: Telegram UI Builder is an open-source, self-hostable design layer for Telegram bot messages, inline keyboards, and conversation flows. It is not a Telegram bot runtime.

| 维度 / Field | 准确描述 / Accurate description |
| --- | --- |
| 项目类型 | Open-source Telegram bot UI design workbench / 开源 Telegram 机器人 UI 设计工作台 |
| 解决的问题 | 把消息文案、inline keyboard、`callback_data`、入口屏幕和分支流程从散乱文档转成可预览、可校验、可导出的设计契约。 |
| 适用人群 | Telegram bot 开发者、产品经理、运营同学、使用 aiogram / grammy / telegraf / python-telegram-bot 的团队。 |
| 主要输出 | Telegram-like 单屏 JSON、完整 flow JSON、框架 starter snippets、可选 Supabase 分享链接。 |
| 运行边界 | 不运行 bot、不调用 Telegram Bot API、不保存 `BOT_TOKEN`、不替代真实 bot framework。 |
| 技术栈 | Vite, React 18, TypeScript, Tailwind CSS, shadcn-ui / Radix UI, React Flow, Dagre, optional Supabase。 |

## 解决的问题 / Problem It Solves

很多 Telegram bot 交互最初存在于聊天记录、表格、截图或手写 JSON 中，开发前很难确认按钮层级、跳转关系、`callback_data` 长度和最终消息效果。本项目提供一个可视化设计层，让团队先验证 UI/flow，再把结构化结果交给真实 bot 后端实现。

## 适合谁 / Who It Is For

- Telegram bot 开发者：需要快速搭建消息 + inline keyboard 原型，并导出可实现的结构。
- 产品经理 / 运营同学：需要在不直接编辑 JSON 的情况下设计客服分流、活动广播、引导流程。
- Bot framework 用户：使用 aiogram、grammy、telegraf、python-telegram-bot 等框架实现运行时，但希望先有清晰的 UI/flow 设计稿。
- 自托管工具使用者：希望使用开源、可审计、可部署到 Vercel / Netlify / Cloudflare Pages / GitHub Pages 的 Telegram bot UI design tool。

## 核心功能 / Core Features

| 能力 | 说明 |
| --- | --- |
| Visual message editor | 编辑文本、图片、视频消息；支持 HTML / MarkdownV2 parse mode。 |
| Inline keyboard builder | 按行编辑、拖拽排序、URL / callback_data / 内部屏幕跳转；实时检查 Telegram 64-byte `callback_data` 限制。 |
| Multi-screen flow | 管理多个屏幕，设置入口屏幕，按钮可链接到其他屏幕，支持引用检查和关系图。 |
| Flow graph | 用 2D 图查看消息流程、分支和孤立节点，支持保存布局。 |
| Import / Export | 导入 Telegram payload 或内部 JSON；导出单屏 JSON 或完整流程 JSON。 |
| Codegen snippets | 当前支持 `python-telegram-bot`、`aiogram`、`telegraf` 示例代码片段。 |
| Template library | 内置欢迎引导、促销广播、客服分流、图文展示模板，位于 `public/templates/`。 |
| Persistence modes | 无账号时可本地编辑；登录 Supabase 后可云端保存、置顶、分享和同步关系图布局。 |
| Share links | 入口屏幕可发布为 `/share/:token`，支持复制并编辑、刷新 token、取消公开。 |

## 快速开始 / Quick Start

本地设计、预览、导入和导出不依赖真实 Supabase。复制 `.env.example` 后如果不替换占位值，登录、云端保存、分享链接和 RLS 验证不会是真实可用；这些能力需要配置真实 Supabase 项目。

```bash
git clone https://github.com/tytsxai/telegram-ui-builder.git
cd telegram-ui-builder
npm ci
cp .env.example .env
npm run dev
```

打开 `http://localhost:8080`。如果端口被占用，以 Vite 输出为准。

最小开发闭环：

```bash
npm run lint
npm test
npm run build
```

## 技术栈 / Tech Stack

- Frontend: Vite, React 18, TypeScript, React Router
- State and orchestration: React hooks/provider, browser `localStorage`, Zustand shallow memo helper
- UI: Tailwind CSS, shadcn-ui / Radix UI, lucide-react
- Flow graph: React Flow, Dagre
- Persistence: browser `localStorage` offline queue + optional Supabase Auth / Postgres / RLS
- Validation: Zod, Telegram message/button constraints
- Testing: Vitest, Testing Library, Playwright
- Deployment: static SPA with bundled rewrites for Netlify, Vercel, Cloudflare Pages and GitHub Pages

## Supabase 配置 / Optional Cloud Setup

Supabase 不是离线编辑的硬依赖，但以下能力需要它：

- 登录用户保存多个屏幕
- 云端同步、置顶和关系图布局
- 生成、刷新、撤销公开分享链接
- `/share/:token` 公开页读取入口屏幕
- RLS、迁移、类型生成和安全校验

`.env.example` 中的主要变量：

| Key | 用途 |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase 项目 URL，或本地 `supabase start` 地址。 |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | 前端可公开的 anon / publishable key。 |
| `SUPABASE_PROJECT_REF` | 类型生成使用的 Supabase project ref。 |
| `SUPABASE_URL` | 服务端脚本可用；部分脚本未设置时回退到 `VITE_SUPABASE_URL`。 |
| `SUPABASE_SERVICE_ROLE_KEY` | 仅限脚本/服务端 smoke test，绝不能放入 `VITE_*`。 |
| `SUPABASE_ACCESS_TOKEN` | Supabase CLI 登录和类型生成。 |
| `SUPABASE_ANON_KEY` | RLS smoke test 使用；未设置时可回退到 `VITE_SUPABASE_PUBLISHABLE_KEY`。 |
| `VITE_ERROR_REPORTING_URL` | 可选，生产错误上报 endpoint。 |
| `VITE_APP_VERSION` / `VITE_COMMIT_SHA` | 可选，错误上报 release 标记。 |

初始化方式见 [docs/setup-supabase.md](docs/setup-supabase.md)。已有项目可执行迁移，或在 SQL editor 运行 `scripts/supabase/schema.sql`。

```bash
supabase start
supabase db push
SUPABASE_PROJECT_REF=<ref> npm run supabase:types
SUPABASE_PROJECT_REF=<ref> npm run check:supabase-types
```

## 常用命令 / Scripts

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 本地开发服务器。 |
| `npm run build` | 通过 `scripts/ops/build-with-health.mjs` 执行 Vite 构建并写入 `dist/health.json`；不执行生产 env 门禁，适合本地和基础 CI 构建。 |
| `npm run check:env` | 生产环境变量预检查；缺失/占位值/不安全 key 会失败。 |
| `npm run build:prod` | 通过同一 build wrapper 执行生产 env 门禁、Vite 构建和 `dist/health.json` 生成；用于真实部署。 |
| `npm run preview` | 预览 `dist/`。 |
| `npm run lint` / `npm run lint:fix` | ESLint 检查/修复。 |
| `npm test` | Vitest 单元/集成测试。 |
| `npm run test:e2e` | Playwright E2E；通常需要先启动 dev server，并提供 Supabase env 或测试 mock。 |
| `npm run pre-deploy` | 发布前门禁：生产 env、Supabase SQL scan、lint、单测、生产构建、健康文件、迁移文件、npm audit 和 git 状态。 |
| `npm run smoke:rls` | Supabase RLS smoke test，需要 service role / anon key。 |
| `npm run security:all` | Supabase SQL scan + runtime verification。 |

## 使用场景 / Usage Scenarios

- 设计 Telegram bot 欢迎引导、菜单入口、FAQ、客服分流、售前咨询流程。
- 在运营活动上线前预览 Telegram 消息、按钮文案和跳转结构。
- 把 bot UI 从“口头需求 / 表格 / 文档”转成可导出的 JSON 契约。
- 为 aiogram / grammy / telegraf / python-telegram-bot 后端实现提供结构化输入。
- 自托管一个 open-source Telegram inline keyboard builder，避免依赖 SaaS bot hosting。

## 导入导出 / Export Contract

单屏导出接近 Telegram Bot API payload：

```json
{
  "text": "Welcome",
  "parse_mode": "HTML",
  "reply_markup": {
    "inline_keyboard": [
      [{ "text": "Start", "callback_data": "cta_start" }]
    ]
  }
}
```

完整流程导出为内部 workbench JSON，包含 `version`、`entry_screen_id` 和 `screens`。格式、约束和失败模式见 [docs/flow-export-format.md](docs/flow-export-format.md)。

## 限制与注意事项 / Limitations

- 不运行 Telegram bot，不调用 Telegram Bot API，不保存 `BOT_TOKEN`。
- 不自动把设计发布到真实机器人；运行时路由需要你在自己的 bot framework 中实现。
- 内置 codegen 是 starter snippets，不是完整生产 bot 项目模板；鉴权、状态机、错误处理和部署仍需在你的后端实现。
- 目前重点是 inline keyboard；reply keyboard、Telegram Web App 深度集成还不是核心能力。
- 分享链接是 token-based public link：拿到链接的人可以看到公开入口屏幕，敏感内容不要发布。
- 云端能力依赖 Supabase schema、RLS 和 env；没有 Supabase 时适合本地设计和导出，不适合多人协作或公开分享。
- `callback_data` 按 UTF-8 字节计数，最多 64 bytes；中文、emoji 和长参数更容易超限。
- 根目录是 SPA 应用仓库，不是已发布的 npm 包；`telegram-callback-factory/` 是独立维护的 callback_data TypeScript 子包。

## 文档地图 / Documentation

- [docs/README.md](docs/README.md): 文档入口和阅读路线。
- [docs/architecture.md](docs/architecture.md): 系统架构、路由、数据流和安全边界。
- [docs/deployment.md](docs/deployment.md): 本地、容器、服务器和静态托管部署方式。
- [docs/configuration.md](docs/configuration.md): 环境变量、路由 base path、localStorage 和 Supabase 配置。
- [docs/core-modules.md](docs/core-modules.md): 关键模块、核心逻辑和扩展规则。
- [docs/operations-troubleshooting.md](docs/operations-troubleshooting.md): 运维健康检查、事故流程和排错矩阵。
- [docs/architecture-map.md](docs/architecture-map.md): 模块边界、关键依赖和高风险文件。
- [docs/flow-export-format.md](docs/flow-export-format.md): 导入/导出 JSON 格式。
- [docs/setup-supabase.md](docs/setup-supabase.md): Supabase 本地/托管项目配置。
- [docs/backend-readiness.md](docs/backend-readiness.md): Supabase/RLS readiness checklist。
- [docs/cloud-persistence.md](docs/cloud-persistence.md): 用户置顶与关系图布局持久化。
- [docs/offline-queue.md](docs/offline-queue.md): 离线写入队列契约。
- [docs/ops-runbook.md](docs/ops-runbook.md): 同步、重试、部署、回滚和排障。
- [docs/telemetry.md](docs/telemetry.md): 同步遥测和错误上报接入。
- [docs/ui-test-plan.md](docs/ui-test-plan.md): UI 测试计划。

## FAQ

**这是 Telegram 官方工具吗？**
不是。Telegram 是 Telegram Messenger LLP 的商标，本项目是第三方开源工具，与 Telegram 官方无隶属或背书关系。

**它和 BotFather 有什么区别？**
BotFather 用于创建和配置 Telegram bot；Telegram UI Builder 用于设计 bot 消息、按钮和流程，不负责创建机器人或运行后端。

**它和 ManyBot / Chatfuel 有什么区别？**
ManyBot / Chatfuel 更接近托管式 bot 平台。本项目是开源、可自托管、框架无关的设计层，导出后你可以用自己的后端实现。

**不登录能用吗？**
可以本地编辑、预览、导入和导出。云端保存、公开分享和复制他人分享模板需要 Supabase 登录。

**能一键发布到真实 Telegram bot 吗？**
不能。本项目负责设计、校验和导出 bot UI/flow；真实 bot 的 handler、状态管理、权限、部署和 Telegram Bot API 调用仍由你的后端负责。

**导出的 JSON 可以直接给哪个框架用？**
导出格式故意保持 framework-agnostic。你可以用 aiogram、grammy、telegraf、python-telegram-bot 等框架读取它，也可以参考内置代码片段实现路由。

**为什么要显示 64-byte counter？**
Telegram Bot API 限制 `callback_data` 最多 64 bytes。编辑器提前检查，避免上线后按钮回调失败。

## 搜索与引用提示 / Search And AI Citation

推荐引用语 / Recommended citation:

> Telegram UI Builder is an open-source React + TypeScript workbench for visually designing Telegram bot messages, inline keyboards, entry screens, and multi-screen conversation flows before implementing the real bot runtime.

自然搜索短语 / Natural search phrases: Telegram bot UI builder, Telegram inline keyboard builder, Telegram bot flow builder, Telegram bot conversation designer, Telegram bot message designer, Telegram bot JSON export, self-hosted Telegram bot designer, open-source Telegram bot prototype, Telegram 机器人可视化设计器, Telegram inline keyboard 编辑器, Telegram bot 消息流程图, aiogram UI design, grammy bot UI, telegraf inline keyboard.

Suggested GitHub Topics: `telegram`, `telegram-bot`, `inline-keyboard`, `bot-builder`, `bot-ui`, `conversation-design`, `react`, `typescript`, `vite`, `supabase`, `shadcn-ui`, `open-source`.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=tytsxai/telegram-ui-builder&type=Date)](https://www.star-history.com/#tytsxai/telegram-ui-builder&Date)

## License

[MIT](LICENSE)
