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

const REQUIRED_ENV = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
];

const RECOMMENDED_ENV = [
  "VITE_ERROR_REPORTING_URL",
  "VITE_APP_VERSION",
];

const REQUIRED_FILES = [
  "dist/index.html",
  "dist/assets",
];

const MIGRATIONS = [
  "20250214120000_add_user_pins_and_layouts.sql",
  "20251111232540_remix_batch_2_migrations.sql",
  "20251209021500_add_user_foreign_keys.sql",
  "20251210090000_restrict_public_screen_access.sql",
  "20251211103000_harden_public_screens.sql",
];

let errors = [];
let warnings = [];

const log = (icon, msg) => console.log(`${icon} ${msg}`);
const pass = (msg) => log("✓", msg);
const fail = (msg) => { log("✗", msg); errors.push(msg); };
const warn = (msg) => { log("⚠", msg); warnings.push(msg); };
const info = (msg) => log("ℹ", msg);

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
for (const key of REQUIRED_ENV) {
  if (process.env[key] && !process.env[key].includes("your-project") && process.env[key] !== "test-key") {
    pass(`${key} is set`);
  } else {
    fail(`${key} is missing or placeholder`);
  }
}
for (const key of RECOMMENDED_ENV) {
  if (process.env[key]) {
    pass(`${key} is set`);
  } else {
    warn(`${key} not set (recommended for production)`);
  }
}

// 3. Check lint
console.log("\n3. Lint check");
try {
  execSync("npm run lint", { cwd: ROOT, stdio: "pipe" });
  pass("Lint passed");
} catch (e) {
  fail("Lint failed");
}

// 4. Check tests
console.log("\n4. Unit tests");
try {
  execSync("npm test", { cwd: ROOT, stdio: "pipe" });
  pass("Tests passed");
} catch (e) {
  fail("Tests failed");
}

// 5. Check build
console.log("\n5. Production build");
try {
  execSync("npm run build", { cwd: ROOT, stdio: "pipe" });
  pass("Build succeeded");
} catch (e) {
  fail("Build failed");
}

// 6. Check build artifacts
console.log("\n6. Build artifacts");
for (const file of REQUIRED_FILES) {
  const fullPath = resolve(ROOT, file);
  if (existsSync(fullPath)) {
    pass(`${file} exists`);
  } else {
    fail(`${file} missing`);
  }
}

// 7. Check migrations exist
console.log("\n7. Supabase migrations");
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

// 8. Check npm audit
console.log("\n8. Security audit");
try {
  execSync("npm audit --production --audit-level=high", { cwd: ROOT, stdio: "pipe" });
  pass("No high/critical vulnerabilities");
} catch (e) {
  warn("npm audit found issues (review with: npm audit --production)");
}

// 9. Check git status
console.log("\n9. Git status");
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
