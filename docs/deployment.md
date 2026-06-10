# Deployment

The app deploys as static files. There is no Node application server required after `npm run build:prod`; a server or container only needs to serve `dist/` with SPA rewrites.

## Local Development

Prerequisites:

- Node.js 18+; CI currently uses Node.js 20.
- npm.
- Optional: Supabase CLI for local database/auth.

```bash
npm ci
cp .env.example .env
npm run dev
```

Open `http://localhost:8080`. If you need local Supabase:

```bash
supabase start
supabase db push
```

Then set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env` from the local Supabase CLI output.

Local verification:

```bash
npm run lint
npm test
npm run build
npm run test:e2e
```

`npm run test:e2e` starts/reuses the Vite server on `127.0.0.1:8080`.

## Production Build

Use real build-time env:

```bash
export VITE_SUPABASE_URL="https://<project>.supabase.co"
export VITE_SUPABASE_PUBLISHABLE_KEY="<anon-or-publishable-key>"
export VITE_APP_VERSION="$(git rev-parse --short HEAD)"
export VITE_COMMIT_SHA="$(git rev-parse HEAD)"

npm run build:prod
```

`build:prod` runs `npm run check:env` first. It fails on missing production Supabase vars, placeholder values, service-role keys in browser env, localhost production URLs, and insecure production Supabase URLs.

The output is `dist/`.

## Static Hosting

### Vercel

`vercel.json` is already committed:

- Build command: `npm run build:prod`
- SPA rewrite: `/(.*)` to `/index.html`

Set env vars in Vercel project settings before deploying.

### Netlify / Cloudflare Pages

`netlify.toml` and `public/_redirects` are already committed:

- Build command: `npm run build:prod`
- Publish directory: `dist`
- Rewrite: `/* /index.html 200`

Cloudflare Pages can use the same build command and output directory.

### GitHub Pages

`.github/workflows/pages.yml` builds on `main` with:

```bash
npm run build:prod -- --base=/telegram-ui-builder/
```

Required repository secrets:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Recommended secrets:

- `VITE_ERROR_REPORTING_URL`

The workflow injects `VITE_APP_VERSION` and `VITE_COMMIT_SHA` from `github.sha`. GitHub Pages must be configured to use GitHub Actions as the Pages source. The fallback file `public/404.html` is hardcoded to `/telegram-ui-builder/`; update it if the base path changes.

## Container Deployment

The repository does not currently ship a Dockerfile. A container should still be treated as static hosting: build once with Vite env baked in, then serve `dist/` with Nginx or another static server.

Minimal Dockerfile pattern:

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_ERROR_REPORTING_URL
ARG VITE_APP_VERSION
ARG VITE_COMMIT_SHA
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_ERROR_REPORTING_URL=$VITE_ERROR_REPORTING_URL
ENV VITE_APP_VERSION=$VITE_APP_VERSION
ENV VITE_COMMIT_SHA=$VITE_COMMIT_SHA
RUN npm run build:prod

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
HEALTHCHECK CMD wget -qO- http://127.0.0.1/health.json | grep -q '"status": "ok"'
```

Nginx config:

```nginx
server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;

  location = /health.json {
    try_files /health.json =404;
    add_header Cache-Control "no-store";
  }

  location /assets/ {
    try_files $uri =404;
    add_header Cache-Control "public, max-age=31536000, immutable";
  }

  location / {
    try_files $uri /index.html;
  }
}
```

Build example:

```bash
docker build \
  --build-arg VITE_SUPABASE_URL="$VITE_SUPABASE_URL" \
  --build-arg VITE_SUPABASE_PUBLISHABLE_KEY="$VITE_SUPABASE_PUBLISHABLE_KEY" \
  --build-arg VITE_APP_VERSION="$(git rev-parse --short HEAD)" \
  --build-arg VITE_COMMIT_SHA="$(git rev-parse HEAD)" \
  -t telegram-ui-builder:$(git rev-parse --short HEAD) .
```

Run example:

```bash
docker run --rm -p 8080:80 telegram-ui-builder:$(git rev-parse --short HEAD)
curl -fsS http://127.0.0.1:8080/health.json
```

Do not pass `SUPABASE_SERVICE_ROLE_KEY` into this frontend container.

## Server Deployment

For a traditional VM:

1. Build on CI or on the server with production env.
2. Copy `dist/` to a versioned release directory such as `/var/www/telegram-ui-builder/releases/<sha>`.
3. Atomically switch a symlink `/var/www/telegram-ui-builder/current` to the new release.
4. Serve the symlink with Nginx using SPA `try_files`.
5. Verify health, auth, builder route, and share route.

Nginx server block:

```nginx
server {
  listen 80;
  server_name example.com;
  root /var/www/telegram-ui-builder/current;
  index index.html;

  location = /health.json {
    try_files /health.json =404;
    add_header Cache-Control "no-store";
  }

  location /assets/ {
    try_files $uri =404;
    add_header Cache-Control "public, max-age=31536000, immutable";
  }

  location / {
    try_files $uri /index.html;
  }
}
```

Rollback is symlink-based: point `current` back to the previous release and reload Nginx.

## Supabase Deployment Dependency

Frontend deployment alone is not enough for cloud features. The target Supabase project must have:

- Current migrations/schema applied.
- RLS enabled for `screens`, `user_pins`, and `screen_layouts`.
- `get_public_screen_by_token` RPC available.
- No broad public SELECT policy on `screens`.
- Auth settings compatible with the deployment origin/base path.

Run:

```bash
npm run security:scan
npm run security:verify
npm run smoke:rls
```

`security:verify` and `smoke:rls` require Supabase service credentials. Keep them in CI/server secrets only.

## Release Checklist

1. `npm run lint`
2. `npm test`
3. `npm run build`
4. `npm run test:e2e`
5. `npm run check:env` with production env
6. `npm run pre-deploy` with production env after `dist/` exists
7. Deploy `dist/`
8. Verify `/health.json`, `/`, `/auth`, and a known `/share/:token`
9. Record commit SHA, migration version, deploy target, and rollback target
