#!/usr/bin/env node
/**
 * Pre-deployment checklist script
 * Run before deploying to production: node scripts/ops/pre-deploy-check.mjs
 */

import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const MAX_COMMAND_OUTPUT = 20 * 1024 * 1024;

const RECOMMENDED_ENV = [
  "VITE_ERROR_REPORTING_URL",
  "VITE_APP_VERSION",
];

const REQUIRED_FILES = [
  "dist/index.html",
  "dist/assets",
  "dist/health.json",
];

const MIGRATIONS = [
  "20250214120000_add_user_pins_and_layouts.sql",
  "20251111232540_remix_batch_2_migrations.sql",
  "20251209021500_add_user_foreign_keys.sql",
  "20251210090000_restrict_public_screen_access.sql",
  "20251211103000_harden_public_screens.sql",
  "20251211110000_remove_security_definer_update_updated_at.sql",
  "20260329000100_fix_screens_update_policy.sql",
];

let errors = [];
let warnings = [];

const log = (icon, msg) => console.log(`${icon} ${msg}`);
const pass = (msg) => log("✓", msg);
const fail = (msg) => { log("✗", msg); errors.push(msg); };
const warn = (msg) => { log("⚠", msg); warnings.push(msg); };
const info = (msg) => log("ℹ", msg);

const commandOutput = (error) => {
  const stdout = error?.stdout?.toString?.() ?? "";
  const stderr = error?.stderr?.toString?.() ?? "";
  return [stdout, stderr].filter(Boolean).join("\n").trim();
};

const checkOutputCommand = (command) => execSync(command, {
  cwd: ROOT,
  stdio: "pipe",
  maxBuffer: MAX_COMMAND_OUTPUT,
});

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    fail(`${file} is not valid JSON`);
    return null;
  }
};

const validateHealth = () => {
  const healthPath = resolve(ROOT, "dist/health.json");
  if (!existsSync(healthPath)) return;

  const health = readJson(healthPath);
  if (!health) return;

  if (health.status === "ok") {
    pass("health.json status is ok");
  } else {
    fail("health.json status is not ok");
  }

  if (health.service === "telegram-ui-builder") {
    pass("health.json service matches telegram-ui-builder");
  } else {
    fail("health.json service is missing or wrong");
  }

  if (typeof health.buildTime === "string" && !Number.isNaN(Date.parse(health.buildTime))) {
    pass("health.json includes buildTime");
  } else {
    fail("health.json missing valid buildTime");
  }

  if (typeof health.version === "string" && health.version.trim() && typeof health.commit === "string" && health.commit.trim()) {
    pass("health.json includes version and commit");
  } else {
    fail("health.json missing version or commit");
  }
};

console.log("\n=== Pre-Deployment Checklist ===\n");

// 1. Check Node version
console.log("1. Node.js version");
const nodeVersion = process.version.match(/^v(\d+)/)?.[1];
if (parseInt(nodeVersion, 10) >= 18) {
  pass(`Node.js ${process.version}`);
} else {
  fail(`Node.js >= 18 required, got ${process.version}`);
}

// 2. Check environment variables
console.log("\n2. Environment variables");
try {
  checkOutputCommand("npm run check:env");
  pass("Production environment gate passed");
} catch (e) {
  const output = commandOutput(e);
  fail(`Production environment gate failed${output ? `:\n${output}` : ""}`);
}
for (const key of RECOMMENDED_ENV) {
  if (process.env[key]) {
    pass(`${key} is set`);
  } else {
    warn(`${key} not set (recommended for production)`);
  }
}

// 3. Static Supabase security scan
console.log("\n3. Static Supabase security scan");
try {
  checkOutputCommand("npm run security:scan");
  pass("Supabase SQL security scan passed");
} catch (e) {
  const output = commandOutput(e);
  fail(`Supabase SQL security scan failed${output ? `:\n${output}` : ""}`);
}

// 4. Check lint
console.log("\n4. Lint check");
try {
  checkOutputCommand("npm run lint");
  pass("Lint passed");
} catch (e) {
  fail("Lint failed");
}

// 5. Check tests
console.log("\n5. Unit tests");
try {
  checkOutputCommand("npm test");
  pass("Tests passed");
} catch (e) {
  const output = commandOutput(e);
  fail(`Tests failed${output ? `:\n${output}` : ""}`);
}

// 6. Check build
console.log("\n6. Production build");
try {
  checkOutputCommand("npm run build:prod");
  pass("Build succeeded");
} catch (e) {
  const output = commandOutput(e);
  fail(`Build failed${output ? `:\n${output}` : ""}`);
}

// 7. Check build artifacts
console.log("\n7. Build artifacts");
for (const file of REQUIRED_FILES) {
  const fullPath = resolve(ROOT, file);
  if (existsSync(fullPath)) {
    pass(`${file} exists`);
  } else {
    fail(`${file} missing`);
  }
}
validateHealth();

// 8. Check migrations exist
console.log("\n8. Supabase migrations");
const migrationsDir = resolve(ROOT, "supabase/migrations");
if (existsSync(migrationsDir)) {
  for (const migration of MIGRATIONS) {
    const migrationPath = resolve(migrationsDir, migration);
    if (existsSync(migrationPath)) {
      pass(`Migration ${migration.slice(0, 14)}...`);
    } else {
      warn(`Migration ${migration} not found locally`);
    }
  }
  info("Reminder: Verify migrations are applied to production Supabase");
} else {
  warn("supabase/migrations directory not found");
}

// 9. Check npm audit
console.log("\n9. Security audit");
try {
  checkOutputCommand("npm audit --omit=dev --audit-level=high");
  pass("No high/critical vulnerabilities");
} catch (e) {
  warn("npm audit found issues (review with: npm audit --omit=dev)");
}

// 10. Check git status
console.log("\n10. Git status");
try {
  const status = execSync("git status --porcelain", { cwd: ROOT, encoding: "utf8" });
  if (status.trim()) {
    warn("Uncommitted changes detected");
  } else {
    pass("Working directory clean");
  }
} catch (e) {
  info("Not a git repository or git not available");
}

// Summary
console.log("\n=== Summary ===\n");

if (errors.length === 0 && warnings.length === 0) {
  console.log("🚀 All checks passed! Ready to deploy.\n");
  process.exit(0);
} else {
  if (errors.length > 0) {
    console.log(`❌ ${errors.length} error(s) - must fix before deploy:`);
    errors.forEach((e) => console.log(`   - ${e}`));
  }
  if (warnings.length > 0) {
    console.log(`⚠️  ${warnings.length} warning(s) - review recommended:`);
    warnings.forEach((w) => console.log(`   - ${w}`));
  }
  console.log("");
  process.exit(errors.length > 0 ? 1 : 0);
}
