#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DIST_DIR = path.join(ROOT, "dist");
const HEALTH_PATH = path.join(DIST_DIR, "health.json");

const args = process.argv.slice(2);
const checkEnv = args.includes("--check-env");
const viteArgs = args.filter((arg) => arg !== "--check-env");
const passthroughOnly = viteArgs.some((arg) => ["--help", "-h", "--version", "-v"].includes(arg));

const run = (command, commandArgs, label) => {
  const result = spawnSync(command, commandArgs, {
    cwd: ROOT,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`[build] ${label} failed:`, result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const git = (gitArgs) => {
  try {
    return execFileSync("git", gitArgs, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
};

const getBasePath = () => {
  const equalsArg = viteArgs.find((arg) => arg.startsWith("--base="));
  if (equalsArg) return equalsArg.slice("--base=".length) || "/";
  const idx = viteArgs.findIndex((arg) => arg === "--base");
  if (idx >= 0) return viteArgs[idx + 1] || "/";
  return "/";
};

const writeHealth = () => {
  const commitSha = process.env.VITE_COMMIT_SHA || git(["rev-parse", "HEAD"]) || "unknown";
  const shortSha = commitSha === "unknown" ? "unknown" : commitSha.slice(0, 12);
  const version = process.env.VITE_APP_VERSION || shortSha;
  const health = {
    status: "ok",
    service: "telegram-ui-builder",
    runtime: "static",
    version,
    commit: commitSha,
    buildTime: new Date().toISOString(),
    basePath: getBasePath(),
  };

  if (!existsSync(DIST_DIR)) {
    mkdirSync(DIST_DIR, { recursive: true });
  }
  writeFileSync(HEALTH_PATH, `${JSON.stringify(health, null, 2)}\n`);
  console.log(`[build] wrote ${path.relative(ROOT, HEALTH_PATH)}`);
};

if (checkEnv) {
  run(process.execPath, [path.join(ROOT, "scripts/ops/verify-env.mjs"), "--mode", "production"], "env check");
}

const viteBin = path.join(
  ROOT,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "vite.cmd" : "vite",
);
run(viteBin, ["build", ...viteArgs], "vite build");
if (passthroughOnly) {
  process.exit(0);
}
writeHealth();
