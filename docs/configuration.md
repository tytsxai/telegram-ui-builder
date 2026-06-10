# Configuration

Configuration is split into build-time browser variables, Supabase tooling variables, host routing, and browser localStorage state. Vite only exposes variables prefixed with `VITE_` to client code; never put service-role or admin credentials behind `VITE_`.

## Browser Build-Time Env

| Variable | Required for | Consumed by | Notes |
| --- | --- | --- | --- |
| `VITE_SUPABASE_URL` | Auth, cloud save, share, layout/pins | `runtimeConfig`, Supabase client | Required for real deployments. Dev/test fallback is `http://localhost:54321`. Production must not point to localhost. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Auth and browser Supabase access | `runtimeConfig`, Supabase client | Must be anon/publishable. Service-role/admin JWTs are blocked. Dev/test fallback is `test-key`. |
| `VITE_ERROR_REPORTING_URL` | Production error capture | `errorReportingClient` | Optional but recommended. In production absence is a warning. |
| `VITE_ERROR_REPORTING_API_KEY` | Error-reporting endpoint auth | `errorReportingClient` | Optional `x-api-key` header. Do not use secrets that should never reach browsers. |
| `VITE_APP_VERSION` | Error-report release tag | `errorReportingClient`, `runtimeConfig` | Optional; recommended in production. |
| `VITE_COMMIT_SHA` | Error-report release tag | `errorReportingClient`, `runtimeConfig` | Optional fallback/alternative to `VITE_APP_VERSION`. |

`npm run check:env` validates production values and exits non-zero on blocking errors. `npm run build:prod` runs that check before `vite build`. Use `npm run build` for local/CI build checks when real production env is intentionally unavailable.

## Supabase Tooling Env

| Variable | Required for | Notes |
| --- | --- | --- |
| `SUPABASE_PROJECT_REF` | `npm run supabase:types`, `npm run check:supabase-types` | Supabase project ref used by `supabase gen types --project-id`. |
| `SUPABASE_ACCESS_TOKEN` | CI/non-interactive Supabase CLI auth | Can be replaced by an interactive `supabase login` locally. |
| `SUPABASE_URL` | `verify-security`, `verify-migrations`, `rls-smoke` | Some scripts fall back to `VITE_SUPABASE_URL`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Security verification, migration verification, RLS smoke | Server/CI only. Never expose via `VITE_*`. |
| `SUPABASE_ANON_KEY` | RLS smoke tests | Falls back to `VITE_SUPABASE_PUBLISHABLE_KEY` in `rls-smoke`. |

`.env.example` lists both browser and tooling variables. Keep it in sync with this document and scripts.

## Runtime Config Behavior

`src/lib/runtimeConfig.ts` returns a report with warnings and errors:

- Missing Supabase browser vars: warning in non-production.
- Placeholder or fallback Supabase values: warning.
- Production localhost Supabase URL on a non-local host: error.
- Production `http://` Supabase URL outside local hosts: error.
- Service-role/admin key in `VITE_SUPABASE_PUBLISHABLE_KEY`: error.
- Missing production error reporting URL or release tag: warning.

`src/main.tsx` logs warnings/errors and renders `RuntimeConfigError` if `hasBlockingIssues` is true.

## Routing And Base Path

- Vite dev server is configured in `vite.config.ts` to listen on port `8080`.
- Playwright uses `http://127.0.0.1:8080` and can reuse an existing dev server.
- `BrowserRouter` basename comes from `import.meta.env.BASE_URL`.
- GitHub Pages builds with `--base=/telegram-ui-builder/`; `public/404.html` is hardcoded for that path.
- Vercel and Netlify rewrites are committed in `vercel.json`, `netlify.toml`, and `public/_redirects`.

If the repository name or deployment base path changes, update the Pages workflow build `--base`, `public/404.html`, and any share-link expectations.

## Browser localStorage Keys

| Key | Owner | Purpose | Migration rule |
| --- | --- | --- | --- |
| `telegram_ui_entry_screen` | `useScreenNavigation` | Selected entry screen id | Clear only if screen list has loaded and the id no longer exists. |
| `pending_ops_v2_<userId|anon>` | `pendingQueue` | Offline save/update queue | Version bump requires migration and `pendingQueue` tests. |
| `pending_ops_<userId|anon>` | `pendingQueue` | Legacy v1 queue | Auto-migrated on read. Keep one-version compatibility if changing again. |
| `telegram_ui_onboarding_state_v1` | `useBuilderStore` | Onboarding progress | Low-risk UI state. |
| `telegram_ui_onboarding_done_v1` | `useBuilderStore` | Onboarding dismissal | Low-risk UI state. |
| `repo_badge_pos` | `App` | Draggable GitHub badge position | Low-risk UI state. |
| `diagram_positions_<userId|anon>` | Flow diagram/layout code | Local diagram positions | Must stay compatible with `screen_layouts` cloud sync. |

Supabase Auth also writes its own localStorage keys derived from the Supabase URL. Do not depend on those internal key names in application logic.

## Supabase Project Settings

- Enable email/password auth if using `src/pages/Auth.tsx`.
- Set allowed redirect URLs to the app origin/base path because sign-up uses `getAppBaseUrl()`.
- Apply `scripts/supabase/schema.sql` or the migrations in `supabase/migrations`.
- Keep RLS enabled on `screens`, `user_pins`, and `screen_layouts`.
- Keep public share access behind `get_public_screen_by_token`.
- Enable leaked password protection in hosted Supabase Auth settings.
