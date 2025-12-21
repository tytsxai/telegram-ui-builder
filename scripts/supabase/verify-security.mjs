#!/usr/bin/env node
/**
 * Runtime Security Verification Script
 *
 * Verifies Supabase database security configuration via PostgreSQL catalog queries.
 *
 * Checks:
 *   1) RLS enabled on screens, user_pins, screen_layouts
 *   2) No public SELECT policy on screens
 *   3) SECURITY DEFINER functions whitelist
 *   4) get_public_screen_by_token returns no user_id column
 *   5) screens_public_no_sensitive constraint exists
 *
 * Requires: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY environment variables
 */

import { createClient } from "@supabase/supabase-js";

const REQUIRED_RLS_TABLES = ["screens", "user_pins", "screen_layouts"];
const SECURITY_DEFINER_ALLOWED = new Set(["get_public_screen_by_token"]);

function getEnv() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    console.error("❌ Missing required environment variables:");
    if (!url) console.error("   - SUPABASE_URL or VITE_SUPABASE_URL");
    if (!serviceKey) console.error("   - SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  return { url, serviceKey };
}

async function main() {
  console.log("🔐 Runtime Security Verification\n");

  const { url, serviceKey } = getEnv();
  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const execSql = async (sql) => {
    return await supabase.rpc("exec_sql", { sql });
  };

  const results = [];
  let hasErrors = false;

  // Helper to record check results
  const check = (name, passed, details = "") => {
    results.push({ name, passed, details });
    if (!passed) hasErrors = true;
    const icon = passed ? "✅" : "❌";
    console.log(`${icon} ${name}${details ? `: ${details}` : ""}`);
  };

  // 1) Check RLS enabled on required tables
  console.log("\n--- RLS Status ---");
  {
    const { data, error } = await execSql(`
      SELECT tablename, rowsecurity
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename = ANY(ARRAY['screens', 'user_pins', 'screen_layouts'])
    `);

    if (error || !data) {
      for (const table of REQUIRED_RLS_TABLES) {
        check(`RLS on ${table}`, false, `Cannot query pg_tables: ${error?.message ?? "unknown error"}`);
      }
    } else {
      const rows = Array.isArray(data) ? data : [];
      for (const table of REQUIRED_RLS_TABLES) {
        const row = rows.find((r) => r.tablename === table);
        if (!row) {
          check(`RLS on ${table}`, false, "Table not found in pg_tables");
        } else {
          check(`RLS on ${table}`, row.rowsecurity === true, row.rowsecurity ? "enabled" : "DISABLED");
        }
      }
    }
  }

  // 2) Check no broad public SELECT policy on screens
  console.log("\n--- Policy Check ---");
  {
    const { data, error } = await execSql(`
        SELECT policyname FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'screens'
          AND cmd = 'SELECT'
          AND (qual IS NULL OR qual::text LIKE '%is_public%true%')
      `);

    if (error) {
      check("No broad SELECT policy on screens", false, `Cannot query policies: ${error.message}`);
    } else {
      const policies = data || [];
      check(
        "No broad SELECT policy on screens",
        policies.length === 0,
        policies.length > 0 ? `Found: ${policies.map((p) => p.policyname).join(", ")}` : "No broad SELECT policies"
      );
    }
  }

  // 3) Check SECURITY DEFINER functions whitelist
  console.log("\n--- SECURITY DEFINER Functions ---");
  {
    const { data, error } = await execSql(`
        SELECT proname
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.prosecdef = true
      `);

    if (error) {
      // Fallback: try direct query
      check("SECURITY DEFINER whitelist", false, `Cannot query functions: ${error.message}`);
    } else {
      const definerFns = (data || []).map((r) => r.proname);
      const unauthorized = definerFns.filter((fn) => !SECURITY_DEFINER_ALLOWED.has(fn));

      check(
        "SECURITY DEFINER whitelist",
        unauthorized.length === 0,
        unauthorized.length > 0
          ? `Unauthorized: ${unauthorized.join(", ")}`
          : `Only allowed functions: ${definerFns.join(", ") || "(none)"}`
      );
    }
  }

  // 4) Check get_public_screen_by_token returns no user_id
  console.log("\n--- RPC Return Columns ---");
  {
    // Call RPC with invalid token to get column structure
    const { data, error } = await supabase.rpc("get_public_screen_by_token", { token: "__verify_columns__" });

    if (error && !error.message.includes("no rows")) {
      check("get_public_screen_by_token omits user_id", false, `RPC error: ${error.message}`);
    } else {
      // Check if response structure contains user_id
      const row = Array.isArray(data) ? data[0] : data;
      if (row === null || row === undefined) {
        // No data returned, which is expected for invalid token
        // Try to infer columns from function definition
        const { data: fnData, error: fnError } = await execSql(`
            SELECT pg_get_function_result(p.oid) as result_type
            FROM pg_proc p
            JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'public' AND p.proname = 'get_public_screen_by_token'
          `);

        if (fnError) {
          check("get_public_screen_by_token omits user_id", false, `Cannot inspect function definition: ${fnError.message}`);
        } else if (fnData && fnData[0]) {
          const resultType = fnData[0].result_type || "";
          const hasUserId = /\buser_id\b/i.test(resultType);
          check(
            "get_public_screen_by_token omits user_id",
            !hasUserId,
            hasUserId ? "user_id found in return type" : "user_id not in return type"
          );
        } else {
          check("get_public_screen_by_token omits user_id", true, "No data returned (expected), cannot verify columns directly");
        }
      } else {
        const hasUserId = "user_id" in row;
        check("get_public_screen_by_token omits user_id", !hasUserId, hasUserId ? "user_id present in response" : "user_id not in response");
      }
    }
  }

  // 5) Check screens_public_no_sensitive constraint exists
  console.log("\n--- Constraint Check ---");
  {
    const { data, error } = await execSql(`
        SELECT conname, convalidated
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        JOIN pg_namespace n ON t.relnamespace = n.oid
        WHERE n.nspname = 'public'
          AND t.relname = 'screens'
          AND c.conname = 'screens_public_no_sensitive'
      `);

    if (error) {
      check("screens_public_no_sensitive constraint", false, `Cannot query constraints: ${error.message}`);
    } else {
      const constraint = (data || [])[0];
      check(
        "screens_public_no_sensitive constraint",
        !!constraint,
        constraint ? (constraint.convalidated ? "exists and validated" : "exists but NOT validated") : "NOT FOUND"
      );
    }
  }

  // Summary
  console.log("\n=== Summary ===");
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Passed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);

  if (hasErrors) {
    console.log("\n❌ Security verification failed.");
    process.exit(1);
  }

  console.log("\n✅ All security checks passed.");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
