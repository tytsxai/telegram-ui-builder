import { describe, it, expect } from "vitest";
import {
  FALLBACK_SUPABASE_PUBLISHABLE_KEY,
  FALLBACK_SUPABASE_URL,
  getRuntimeConfigReport,
} from "../runtimeConfig";

type RuntimeEnv = {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  PROD: boolean;
};

const buildEnv = (overrides: Partial<RuntimeEnv> = {}): RuntimeEnv => ({
  VITE_SUPABASE_URL: undefined,
  VITE_SUPABASE_PUBLISHABLE_KEY: undefined,
  PROD: false,
  ...overrides,
});

describe("runtimeConfig", () => {
  it("returns fallbacks and warnings in dev when env missing", () => {
    const report = getRuntimeConfigReport(buildEnv());
    expect(report.supabaseUrl).toBe(FALLBACK_SUPABASE_URL);
    expect(report.supabasePublishableKey).toBe(FALLBACK_SUPABASE_PUBLISHABLE_KEY);
    expect(report.hasBlockingIssues).toBe(false);
    expect(report.issues.some((issue) => issue.level === "warning")).toBe(true);
  });

  it("marks missing env as blocking in prod", () => {
    const report = getRuntimeConfigReport(buildEnv({ PROD: true }));
    expect(report.hasBlockingIssues).toBe(true);
    expect(report.issues.some((issue) => issue.level === "error")).toBe(true);
  });

  it("marks placeholder env as blocking in prod", () => {
    const report = getRuntimeConfigReport(
      buildEnv({
        VITE_SUPABASE_URL: "https://your-project.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: "public-anon-key",
        PROD: true,
      }),
    );
    expect(report.hasBlockingIssues).toBe(true);
    expect(report.issues.some((issue) => issue.message.includes("placeholders"))).toBe(true);
  });

  it("flags service role keys even outside prod", () => {
    const serviceRoleKey = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature";
    const report = getRuntimeConfigReport(
      buildEnv({
        VITE_SUPABASE_URL: "https://example.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: serviceRoleKey,
        PROD: false,
      }),
    );
    expect(report.issues.some((issue) => issue.message.includes("service role"))).toBe(true);
  });

  it("flags insecure Supabase URL in prod", () => {
    const report = getRuntimeConfigReport(
      buildEnv({
        VITE_SUPABASE_URL: "http://example.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: "public-anon-key-2",
        PROD: true,
      }),
    );
    expect(report.hasBlockingIssues).toBe(true);
    expect(report.issues.some((issue) => issue.message.includes("https"))).toBe(true);
  });
});
