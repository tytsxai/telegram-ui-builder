export const FALLBACK_SUPABASE_URL = "http://localhost:54321";
export const FALLBACK_SUPABASE_PUBLISHABLE_KEY = "test-key";
const EXAMPLE_SUPABASE_URL = "https://your-project.supabase.co";
const EXAMPLE_SUPABASE_KEY = "public-anon-key";
type RuntimeEnv = Pick<ImportMetaEnv, "VITE_SUPABASE_URL" | "VITE_SUPABASE_PUBLISHABLE_KEY" | "PROD">;

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
      level: isProd ? "error" : "warning",
      message: `Missing env: ${missing.join(", ")}.`,
    });
  }

  const usingFallback = url === FALLBACK_SUPABASE_URL || key === FALLBACK_SUPABASE_PUBLISHABLE_KEY;
  const usingExample = looksLikeExampleValues(url, key);
  if (url && key && (usingFallback || usingExample)) {
    issues.push({
      level: isProd ? "error" : "warning",
      message: "Supabase env values look like placeholders; replace with real project credentials.",
    });
  }

  if (url && looksLikeLocalSupabaseUrl(url) && isProd && !isLocalHostname()) {
    issues.push({
      level: "error",
      message: "Supabase URL points to localhost in production.",
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
