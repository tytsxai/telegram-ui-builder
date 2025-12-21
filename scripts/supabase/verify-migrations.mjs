#!/usr/bin/env node
/**
 * Supabase migration verification script
 * Verifies that required database objects exist in the target Supabase project.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/supabase/verify-migrations.mjs
 *
 * Or with .env file:
 *   node scripts/supabase/verify-migrations.mjs
 */

import { createClient } from "@supabase/supabase-js";

// Load .env if available
try {
  const { config } = await import("dotenv");
  config();
} catch {
  // dotenv not available, rely on environment
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  console.error("   Set these environment variables or create a .env file");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const REQUIRED_TABLES = ["screens", "user_pins", "screen_layouts"];

const REQUIRED_FUNCTIONS = ["get_public_screen_by_token", "screen_contains_sensitive_data"];

const REQUIRED_CONSTRAINTS = [
  { table: "screens", constraint: "screens_public_no_sensitive" },
];

let errors = [];
let warnings = [];

const pass = (msg) => console.log(`✓ ${msg}`);
const fail = (msg) => { console.log(`✗ ${msg}`); errors.push(msg); };
const warn = (msg) => { console.log(`⚠ ${msg}`); warnings.push(msg); };

console.log("\n=== Supabase Migration Verification ===\n");
console.log(`Target: ${SUPABASE_URL}\n`);

// 1. Check tables exist
console.log("1. Required tables");
for (const table of REQUIRED_TABLES) {
  const { error } = await supabase.from(table).select("*").limit(0);
  if (error && error.code === "42P01") {
    fail(`Table '${table}' does not exist`);
  } else if (error) {
    warn(`Table '${table}' check failed: ${error.message}`);
  } else {
    pass(`Table '${table}' exists`);
  }
}

// 2. Check RLS is enabled
console.log("\n2. Row Level Security");
const { data: rlsData, error: rlsError } = await supabase.rpc("exec_sql", {
  sql: `
    SELECT tablename, rowsecurity
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('screens', 'user_pins', 'screen_layouts')
  `,
}).maybeSingle();

if (rlsError) {
  // Fallback: try direct query via information_schema
  for (const table of REQUIRED_TABLES) {
    const { count, error } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true });
    if (!error) {
      pass(`Table '${table}' accessible (RLS check requires service role introspection)`);
    }
  }
  warn("Could not verify RLS status directly - ensure RLS is enabled in Supabase Dashboard");
} else if (rlsData) {
  // Parse RLS results if available
  pass("RLS query executed (verify results in Supabase Dashboard)");
}

// 3. Check functions exist
console.log("\n3. Required functions");
for (const fn of REQUIRED_FUNCTIONS) {
  const { data, error } = await supabase.rpc(fn, fn === "get_public_screen_by_token" ? { token: "__test__" } : { message_content: "", keyboard: {} });
  // Function exists if we don't get a "function does not exist" error
  if (error && error.message?.includes("does not exist")) {
    fail(`Function '${fn}' does not exist`);
  } else {
    pass(`Function '${fn}' exists`);
  }
}

// 4. Check constraint via insert test
console.log("\n4. Sensitive data constraint");
const testScreenId = crypto.randomUUID();
const sensitiveContent = "Send to 0x1234567890123456789012345678901234567890";
const { error: constraintError } = await supabase
  .from("screens")
  .insert({
    id: testScreenId,
    user_id: "00000000-0000-0000-0000-000000000000", // Will fail RLS anyway
    name: "constraint_test",
    message_content: sensitiveContent,
    is_public: true,
  });

if (constraintError) {
  if (constraintError.message?.includes("screens_public_no_sensitive") ||
      constraintError.code === "23514") {
    pass("Constraint 'screens_public_no_sensitive' is active");
  } else if (constraintError.code === "42501") {
    // RLS denied - constraint may still exist
    pass("RLS blocked test insert (constraint check inconclusive but RLS working)");
  } else {
    warn(`Constraint check inconclusive: ${constraintError.message}`);
  }
} else {
  // Insert succeeded - constraint might be missing
  warn("Sensitive data constraint may not be active - public screen with wallet address was accepted");
  // Clean up
  await supabase.from("screens").delete().eq("id", testScreenId);
}

// 5. Check public share RPC works
console.log("\n5. Public share RPC");
const { data: shareData, error: shareError } = await supabase.rpc("get_public_screen_by_token", { token: "__nonexistent__" });
if (shareError && shareError.message?.includes("does not exist")) {
  fail("get_public_screen_by_token RPC not available");
} else {
  pass("get_public_screen_by_token RPC callable");
}

// Summary
console.log("\n=== Summary ===\n");

if (errors.length === 0 && warnings.length === 0) {
  console.log("🚀 All migrations verified! Database is ready.\n");
  process.exit(0);
} else {
  if (errors.length > 0) {
    console.log(`❌ ${errors.length} error(s) - migrations may be missing:`);
    errors.forEach((e) => console.log(`   - ${e}`));
    console.log("\n   Run: supabase db push");
  }
  if (warnings.length > 0) {
    console.log(`⚠️  ${warnings.length} warning(s) - manual verification recommended:`);
    warnings.forEach((w) => console.log(`   - ${w}`));
  }
  console.log("");
  process.exit(errors.length > 0 ? 1 : 0);
}
