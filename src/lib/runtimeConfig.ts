export const FALLBACK_SUPABASE_URL = "http://localhost:54321";
export const FALLBACK_SUPABASE_PUBLISHABLE_KEY = "test-key";
const EXAMPLE_SUPABASE_URL = "https://your-project.supabase.co";
const EXAMPLE_SUPABASE_KEY = "public-anon-key";
type RuntimeEnv = Pick<
  ImportMetaEnv,
  | "VITE_SUPABASE_URL"
  | "VITE_SUPABASE_PUBLISHABLE_KEY"
  | "VITE_ERROR_REPORTING_URL"
  | "VITE_APP_VERSION"
  | "VITE_COMMIT_SHA"
  | "PROD"
>;
const SERVICE_ROLE = "service_role";
const ADMIN_ROLE = "supabase_admin";

export type RuntimeConfigIssue = {
  level: "warning" | "error";
  message: string;
};

export type RuntimeConfigReport = {
  supabaseUrl: string;
  supabasePublishableKey: string;
  issues: RuntimeConfigIssue[];
  hasBlockingIssues: boolean;
};

const isLocalHostname = () => {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
};

const looksLikeLocalSupabaseUrl = (value?: string) => {
  if (!value) return false;
  return value.includes("localhost") || value.includes("127.0.0.1");
};

const looksLikeExampleValues = (url?: string, key?: string) =>
  url === EXAMPLE_SUPABASE_URL || key === EXAMPLE_SUPABASE_KEY;

const decodeBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  if (typeof globalThis.atob !== "function") return null;
  try {
    return globalThis.atob(padded);
  } catch {
    return null;
  }
};

const getJwtRole = (token?: string) => {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const decoded = decodeBase64Url(parts[1]);
  if (!decoded) return null;
  try {
    const payload = JSON.parse(decoded) as { role?: string };
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
};

const looksLikeServiceRoleKey = (value?: string) => {
  const role = getJwtRole(value);
  return role === SERVICE_ROLE || role === ADMIN_ROLE;
};

const isInsecureProdUrl = (value?: string) => {
  if (!value) return false;
  if (looksLikeLocalSupabaseUrl(value)) return false;
  return value.startsWith("http://");
};

export const getRuntimeConfigReport = (env: RuntimeEnv = import.meta.env): RuntimeConfigReport => {
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const isProd = env.PROD;
  const issues: RuntimeConfigIssue[] = [];

  const missing: string[] = [];
  if (!url) missing.push("VITE_SUPABASE_URL");
  if (!key) missing.push("VITE_SUPABASE_PUBLISHABLE_KEY");
  if (missing.length > 0) {
    issues.push({
      level: "warning",
      message: `Missing env: ${missing.join(", ")}.`,
    });
  }

  const usingFallback = url === FALLBACK_SUPABASE_URL || key === FALLBACK_SUPABASE_PUBLISHABLE_KEY;
  const usingExample = looksLikeExampleValues(url, key);
  if (url && key && (usingFallback || usingExample)) {
    issues.push({
      level: "warning",
      message: "Supabase env values look like placeholders; replace with real project credentials.",
    });
  }

  if (env.VITE_SUPABASE_URL && looksLikeLocalSupabaseUrl(url) && isProd && !isLocalHostname()) {
    issues.push({
      level: "error",
      message: "Supabase URL points to localhost in production.",
    });
  }

  if (key && looksLikeServiceRoleKey(key)) {
    issues.push({
      level: "error",
      message: "Supabase publishable key appears to be a service role key; never expose it to the client.",
    });
  }

  if (env.VITE_SUPABASE_URL && isProd && isInsecureProdUrl(url)) {
    issues.push({
      level: "error",
      message: "Supabase URL must use https in production.",
    });
  }

  if (isProd && !env.VITE_ERROR_REPORTING_URL) {
    issues.push({
      level: "warning",
      message: "Error reporting is disabled in production.",
    });
  }

  if (isProd && !env.VITE_APP_VERSION && !env.VITE_COMMIT_SHA) {
    issues.push({
      level: "warning",
      message: "Release version not set (VITE_APP_VERSION or VITE_COMMIT_SHA).",
    });
  }

  const report: RuntimeConfigReport = {
    supabaseUrl: url ?? FALLBACK_SUPABASE_URL,
    supabasePublishableKey: key ?? FALLBACK_SUPABASE_PUBLISHABLE_KEY,
    issues,
    hasBlockingIssues: isProd && issues.some((issue) => issue.level === "error"),
  };

  return report;
};

export const logRuntimeConfigIssues = (report: RuntimeConfigReport) => {
  if (import.meta.env.MODE === "test") return;
  report.issues.forEach((issue) => {
    if (issue.level === "error") {
      console.error("[Config]", issue.message);
    } else {
      console.warn("[Config]", issue.message);
    }
  });
};

export const getSupabaseConfig = () => {
  const report = getRuntimeConfigReport();
  return {
    url: report.supabaseUrl,
    publishableKey: report.supabasePublishableKey,
  };
};

export const hasSupabaseEnv = (env: RuntimeEnv = import.meta.env) =>
  Boolean(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_PUBLISHABLE_KEY);
