const REQUIRED = ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"];
const EXAMPLE_SUPABASE_URL = "https://your-project.supabase.co";
const EXAMPLE_SUPABASE_KEY = "public-anon-key";
const FALLBACK_SUPABASE_URL = "http://localhost:54321";
const FALLBACK_SUPABASE_KEY = "test-key";
const SERVICE_ROLE = "service_role";
const ADMIN_ROLE = "supabase_admin";

const parseMode = () => {
  const modeArg = process.argv.find((arg) => arg === "--mode" || arg.startsWith("--mode="));
  if (modeArg === "--mode") {
    const idx = process.argv.indexOf(modeArg);
    return process.argv[idx + 1] ?? process.env.NODE_ENV ?? "production";
  }
  if (modeArg?.startsWith("--mode=")) {
    return modeArg.split("=")[1] || process.env.NODE_ENV || "production";
  }
  return process.env.NODE_ENV ?? "production";
};

const decodeBase64Url = (value) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  try {
    return Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return null;
  }
};

const getJwtRole = (token) => {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const decoded = decodeBase64Url(parts[1]);
  if (!decoded) return null;
  try {
    const payload = JSON.parse(decoded);
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
};

const isLocalUrl = (value) => value.includes("localhost") || value.includes("127.0.0.1");
const isInsecureProdUrl = (value) => value.startsWith("http://") && !isLocalUrl(value);

const mode = parseMode();
const isProd = mode === "production";
const errors = [];
const warnings = [];

const report = (level, message) => {
  if (level === "error") {
    errors.push(message);
  } else {
    warnings.push(message);
  }
};

const url = process.env.VITE_SUPABASE_URL || "";
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length) {
  report(isProd ? "error" : "warn", `Missing env: ${missing.join(", ")}.`);
}

const usingPlaceholder = url === EXAMPLE_SUPABASE_URL || key === EXAMPLE_SUPABASE_KEY;
const usingFallback = url === FALLBACK_SUPABASE_URL || key === FALLBACK_SUPABASE_KEY;
if (usingPlaceholder || usingFallback) {
  report(isProd ? "error" : "warn", "Supabase env values look like placeholders; replace with real project credentials.");
}

if (url && isProd && isInsecureProdUrl(url)) {
  report("error", "Supabase URL must use https in production.");
}

if (url && isProd && isLocalUrl(url)) {
  report("error", "Supabase URL points to localhost in production.");
}

const role = getJwtRole(key);
if (role === SERVICE_ROLE || role === ADMIN_ROLE) {
  report("error", "Supabase publishable key appears to be a service role key; never expose it to the client.");
}

const errorReportingUrl = process.env.VITE_ERROR_REPORTING_URL || "";
if (isProd && !errorReportingUrl) {
  report("warn", "VITE_ERROR_REPORTING_URL not set; production errors will not be reported.");
}

const releaseTag = process.env.VITE_APP_VERSION || process.env.VITE_COMMIT_SHA || "";
if (isProd && !releaseTag) {
  report("warn", "VITE_APP_VERSION or VITE_COMMIT_SHA not set; error reports will lack release tagging.");
}

if (warnings.length) {
  console.warn("[env-check] warnings:");
  warnings.forEach((msg) => console.warn(`- ${msg}`));
}

if (errors.length) {
  console.error("[env-check] failed:");
  errors.forEach((msg) => console.error(`- ${msg}`));
  process.exit(1);
}

console.log(`[env-check] ok (mode: ${mode})`);
