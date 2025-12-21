#!/usr/bin/env node
/**
 * Static security scanner for Supabase SQL
 *
 * Scans:
 *   - supabase/migrations/*.sql
 *   - scripts/supabase/schema.sql
 *
 * Checks:
 *   1) SECURITY DEFINER usage (allowlist)
 *   2) RETURNS public.<table> whole-row return pattern (prefer RETURNS TABLE)
 *   3) Broad SELECT policy like "Anyone can view public screens"
 *   4) GRANT EXECUTE ... TO anon allowlist
 *   5) --check-drift: detect drift between schema.sql and final migrations state
 *
 * Output:
 *   - human-readable summary
 *   - JSON report (always)
 *
 * Strict mode:
 *   --strict exits 1 if any error-level findings exist
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
const SCHEMA_PATH = path.join(ROOT, "scripts", "supabase", "schema.sql");

const SECURITY_DEFINER_ALLOWED = new Set([
  "get_public_screen_by_token",
]);

const GRANT_EXECUTE_TO_ANON_ALLOWED = new Set([
  "get_public_screen_by_token",
]);

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const strict = flags.has("--strict");
const checkDrift = flags.has("--check-drift");

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function lineOfIndex(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

function snippetAtLine(lines, line, radius = 0) {
  const start = Math.max(1, line - radius);
  const end = Math.min(lines.length, line + radius);
  return lines.slice(start - 1, end).join("\n");
}

function normalizeIdent(ident) {
  return (ident ?? "").replace(/"/g, "").trim();
}

function normalizeFnName(name) {
  const cleaned = normalizeIdent(name);
  const parts = cleaned.split(".");
  return parts.length === 2 ? parts[1] : cleaned;
}

function parseArgsOrUnknown(argStr) {
  if (!argStr) return "";
  return argStr.trim().replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ");
}

function isAnonInGrant(grantToClause) {
  return /\bto\b[\s\S]*\banon\b/i.test(grantToClause);
}

function makeIssue({ id, severity, file, line, message, context, meta }) {
  return {
    id,
    severity,
    file: toPosix(path.relative(ROOT, file)),
    line,
    message,
    context,
    meta: meta ?? {},
  };
}

async function listTargetFiles() {
  let migrationFiles = [];
  try {
    const entries = await fs.readdir(MIGRATIONS_DIR);
    migrationFiles = entries
      .filter((e) => e.endsWith(".sql"))
      .sort()
      .map((e) => path.join(MIGRATIONS_DIR, e));
  } catch (e) {
    throw new Error(`Failed to read migrations dir: ${toPosix(MIGRATIONS_DIR)} (${e instanceof Error ? e.message : String(e)})`);
  }

  return {
    migrationFiles,
    schemaFile: SCHEMA_PATH,
    allFiles: [...migrationFiles, SCHEMA_PATH],
  };
}

async function readText(file) {
  return await fs.readFile(file, "utf8");
}

function scanTextForFindings(file, text) {
  const issues = [];
  const lines = text.split(/\r?\n/);

  // (A) SECURITY DEFINER: allowlist per function
  // Skip matches in SQL comments (lines starting with --)
  {
    const re = /security\s+definer/gi;
    let m;
    while ((m = re.exec(text))) {
      const idx = m.index;
      const line = lineOfIndex(text, idx);

      // Skip if this is in a comment line
      const lineContent = lines[line - 1] || "";
      if (lineContent.trim().startsWith("--")) {
        continue;
      }

      const lookbackStart = Math.max(0, idx - 4000);
      const prefix = text.slice(lookbackStart, idx);

      // Find the most recent CREATE FUNCTION before this SECURITY DEFINER
      // Use a more robust regex that handles multiline RETURNS TABLE
      const fnMatches = [...prefix.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([a-zA-Z0-9_."']+)\s*\(/gi)];
      const lastFnMatch = fnMatches.length > 0 ? fnMatches[fnMatches.length - 1] : null;
      const rawName = lastFnMatch?.[1] ?? "";
      const fnName = normalizeFnName(rawName);

      const allowed = fnName && SECURITY_DEFINER_ALLOWED.has(fnName);

      issues.push(makeIssue({
        id: "SECURITY_DEFINER",
        severity: allowed ? "info" : "error",
        file,
        line,
        message: allowed
          ? `SECURITY DEFINER allowed for function '${fnName}'`
          : `SECURITY DEFINER is not allowed${fnName ? ` for function '${fnName}'` : ""} (only allow: ${Array.from(SECURITY_DEFINER_ALLOWED).join(", ")})`,
        context: snippetAtLine(lines, line, 1),
        meta: { function: fnName || null },
      }));
    }
  }

  // (B) Whole-row return: RETURNS public.<table>
  {
    const re = /^\s*returns\s+public\.[a-zA-Z0-9_"]+\s*$/gim;
    let m;
    while ((m = re.exec(text))) {
      const idx = m.index;
      const line = lineOfIndex(text, idx);

      issues.push(makeIssue({
        id: "RETURNS_WHOLE_ROW",
        severity: "error",
        file,
        line,
        message: "Function returns a whole row type (e.g. RETURNS public.screens). Prefer RETURNS TABLE (...) and explicit column list.",
        context: snippetAtLine(lines, line, 1),
      }));
    }
  }

  // (C) Broad SELECT policy
  {
    const re = /create\s+policy\s+"Anyone can view public screens"[\s\S]*?for\s+select[\s\S]*?using\s*\(\s*is_public\s*=\s*true\s*\)/gi;
    let m;
    while ((m = re.exec(text))) {
      const idx = m.index;
      const line = lineOfIndex(text, idx);

      issues.push(makeIssue({
        id: "BROAD_PUBLIC_SELECT_POLICY",
        severity: "error",
        file,
        line,
        message: "Broad SELECT policy detected: \"Anyone can view public screens\". Public access should be via RPC, not table SELECT policy.",
        context: snippetAtLine(lines, line, 2),
        meta: { policy: "Anyone can view public screens" },
      }));
    }

    const reNameOnly = /"Anyone can view public screens"/g;
    while ((m = reNameOnly.exec(text))) {
      const idx = m.index;
      const line = lineOfIndex(text, idx);
      issues.push(makeIssue({
        id: "BROAD_PUBLIC_SELECT_POLICY_MENTION",
        severity: "warn",
        file,
        line,
        message: "Policy name \"Anyone can view public screens\" appears in file (ensure it is dropped and not re-created).",
        context: snippetAtLine(lines, line, 0),
      }));
    }
  }

  // (D) GRANT EXECUTE ... TO anon allowlist
  {
    const re = /grant\s+execute\s+on\s+function\s+([a-zA-Z0-9_."']+)\s*\(([^)]*)\)\s+to\s+([^;]+);/gim;
    let m;
    while ((m = re.exec(text))) {
      const idx = m.index;
      const line = lineOfIndex(text, idx);

      const rawName = m[1];
      const argStr = m[2];
      const toClause = m[3];

      if (!isAnonInGrant(`TO ${toClause}`)) continue;

      const fnName = normalizeFnName(rawName);
      const allowed = GRANT_EXECUTE_TO_ANON_ALLOWED.has(fnName);

      issues.push(makeIssue({
        id: "GRANT_EXECUTE_TO_ANON",
        severity: allowed ? "info" : "error",
        file,
        line,
        message: allowed
          ? `GRANT EXECUTE TO anon allowed for function '${fnName}'`
          : `GRANT EXECUTE TO anon is not allowed for function '${fnName}' (only allow: ${Array.from(GRANT_EXECUTE_TO_ANON_ALLOWED).join(", ")})`,
        context: snippetAtLine(lines, line, 0),
        meta: { function: fnName, args: parseArgsOrUnknown(argStr) },
      }));
    }
  }

  return issues;
}

function buildFinalStateFromMigrations(migrationTexts) {
  const functions = new Map();
  const anonGrants = new Map();
  let publicPolicyAnyoneCanView = null;

  for (const { file, text } of migrationTexts) {
    // DROP FUNCTION
    {
      const re = /drop\s+function\s+if\s+exists\s+([a-zA-Z0-9_."']+)\s*\(/gim;
      let m;
      while ((m = re.exec(text))) {
        const fnName = normalizeFnName(m[1]);
        functions.delete(fnName);
        anonGrants.delete(fnName);
      }
    }

    // CREATE/REPLACE FUNCTION
    {
      const re = /create\s+(?:or\s+replace\s+)?function\s+([a-zA-Z0-9_."']+)\s*\(([^)]*)\)([\s\S]*?)\bas\b\s+\$/gim;
      let m;
      while ((m = re.exec(text))) {
        const fnName = normalizeFnName(m[1]);
        const header = m[3] ?? "";
        const returnsMatch = /\breturns\s+([^\n\r]+)/i.exec(header);
        const returnsClause = (returnsMatch?.[1] ?? "").trim();

        const securityDefiner = /\bsecurity\s+definer\b/i.test(header);
        const returnsTable = /\breturns\s+table\b/i.test(header);
        const returnsWholeRow = /\breturns\s+public\.[a-zA-Z0-9_"]+\b/i.test(header) && !returnsTable;

        functions.set(fnName, {
          from: file,
          securityDefiner,
          returnsClause,
          returnsTable,
          returnsWholeRow,
        });
      }
    }

    // GRANT EXECUTE ... TO ...
    {
      const re = /grant\s+execute\s+on\s+function\s+([a-zA-Z0-9_."']+)\s*\(([^)]*)\)\s+to\s+([^;]+);/gim;
      let m;
      while ((m = re.exec(text))) {
        const fnName = normalizeFnName(m[1]);
        const toClause = m[3] ?? "";
        if (isAnonInGrant(`TO ${toClause}`)) {
          anonGrants.set(fnName, true);
        }
      }
    }

    // Policy create/drop tracking
    {
      if (/drop\s+policy\s+if\s+exists\s+"Anyone can view public screens"\s+on\s+public\.screens\s*;/i.test(text)) {
        publicPolicyAnyoneCanView = false;
      }
      if (/create\s+policy\s+"Anyone can view public screens"\s+on\s+public\.screens/i.test(text)) {
        publicPolicyAnyoneCanView = true;
      }
    }
  }

  return { functions, anonGrants, publicPolicyAnyoneCanView };
}

function parseSchemaState(schemaFile, schemaText) {
  const functions = new Map();
  const anonGrants = new Map();
  let publicPolicyAnyoneCanView = null;

  {
    const re = /create\s+(?:or\s+replace\s+)?function\s+([a-zA-Z0-9_."']+)\s*\(([^)]*)\)([\s\S]*?)\bas\b\s+\$/gim;
    let m;
    while ((m = re.exec(schemaText))) {
      const fnName = normalizeFnName(m[1]);
      const header = m[3] ?? "";
      const returnsMatch = /\breturns\s+([^\n\r]+)/i.exec(header);
      const returnsClause = (returnsMatch?.[1] ?? "").trim();

      const securityDefiner = /\bsecurity\s+definer\b/i.test(header);
      const returnsTable = /\breturns\s+table\b/i.test(header);
      const returnsWholeRow = /\breturns\s+public\.[a-zA-Z0-9_"]+\b/i.test(header) && !returnsTable;

      functions.set(fnName, {
        from: schemaFile,
        securityDefiner,
        returnsClause,
        returnsTable,
        returnsWholeRow,
      });
    }
  }

  {
    const re = /grant\s+execute\s+on\s+function\s+([a-zA-Z0-9_."']+)\s*\(([^)]*)\)\s+to\s+([^;]+);/gim;
    let m;
    while ((m = re.exec(schemaText))) {
      const fnName = normalizeFnName(m[1]);
      const toClause = m[3] ?? "";
      if (isAnonInGrant(`TO ${toClause}`)) anonGrants.set(fnName, true);
    }
  }

  {
    if (/drop\s+policy\s+if\s+exists\s+"Anyone can view public screens"\s+on\s+public\.screens\s*;/i.test(schemaText)) {
      publicPolicyAnyoneCanView = false;
    }
    if (/create\s+policy\s+(?:if\s+not\s+exists\s+)?\"Anyone can view public screens\"\s+on\s+public\.screens/i.test(schemaText)) {
      publicPolicyAnyoneCanView = true;
    }
  }

  return { functions, anonGrants, publicPolicyAnyoneCanView };
}

function computeEffectiveIssues(rawIssues, finalState) {
  return rawIssues.map((issue) => {
    const inMigrations = issue.file.startsWith("supabase/migrations/");
    if (!inMigrations) return issue;

    if (issue.id === "SECURITY_DEFINER" && issue.meta?.function) {
      const fn = issue.meta.function;
      const finalFn = finalState.functions.get(fn);
      const effectiveSecurityDefiner = finalFn?.securityDefiner === true;
      if (!effectiveSecurityDefiner) {
        return { ...issue, severity: "warn", message: `${issue.message} (historical in migrations; final state no longer SECURITY DEFINER)` };
      }
    }

    if (issue.id === "RETURNS_WHOLE_ROW") {
      const finalFn = finalState.functions.get("get_public_screen_by_token");
      if (finalFn && finalFn.returnsTable) {
        return { ...issue, severity: "warn", message: `${issue.message} (historical in migrations; final state uses RETURNS TABLE)` };
      }
    }

    if (issue.id === "BROAD_PUBLIC_SELECT_POLICY" || issue.id === "BROAD_PUBLIC_SELECT_POLICY_MENTION") {
      if (finalState.publicPolicyAnyoneCanView === false) {
        return { ...issue, severity: "warn", message: `${issue.message} (historical in migrations; final state drops this policy)` };
      }
    }

    if (issue.id === "GRANT_EXECUTE_TO_ANON" && issue.meta?.function) {
      const fn = issue.meta.function;
      const effectiveAnonGrant = finalState.anonGrants.get(fn) === true;
      if (!effectiveAnonGrant) {
        return { ...issue, severity: "warn", message: `${issue.message} (historical in migrations; final state no longer grants to anon)` };
      }
    }

    return issue;
  });
}

function driftIssues({ finalState, schemaState }) {
  const issues = [];

  const allFnNames = new Set([
    ...finalState.functions.keys(),
    ...schemaState.functions.keys(),
    ...finalState.anonGrants.keys(),
    ...schemaState.anonGrants.keys(),
  ]);

  for (const fnName of Array.from(allFnNames).sort()) {
    const mig = finalState.functions.get(fnName) ?? null;
    const sch = schemaState.functions.get(fnName) ?? null;

    if (mig && sch) {
      if (mig.securityDefiner !== sch.securityDefiner) {
        issues.push({
          id: "DRIFT_SECURITY_DEFINER",
          severity: "error",
          file: toPosix(path.relative(ROOT, SCHEMA_PATH)),
          line: 1,
          message: `Drift: function '${fnName}' SECURITY DEFINER differs (migrations=${mig.securityDefiner}, schema.sql=${sch.securityDefiner})`,
          context: "",
          meta: { function: fnName },
        });
      }
      if (mig.returnsWholeRow !== sch.returnsWholeRow) {
        issues.push({
          id: "DRIFT_RETURNS_STYLE",
          severity: "error",
          file: toPosix(path.relative(ROOT, SCHEMA_PATH)),
          line: 1,
          message: `Drift: function '${fnName}' return style differs (migrations returnsWholeRow=${mig.returnsWholeRow}, schema.sql returnsWholeRow=${sch.returnsWholeRow})`,
          context: "",
          meta: { function: fnName },
        });
      }
    }
  }

  for (const fnName of Array.from(allFnNames).sort()) {
    const migAnon = finalState.anonGrants.get(fnName) === true;
    const schAnon = schemaState.anonGrants.get(fnName) === true;
    if (migAnon !== schAnon) {
      issues.push({
        id: "DRIFT_ANON_GRANT",
        severity: "error",
        file: toPosix(path.relative(ROOT, SCHEMA_PATH)),
        line: 1,
        message: `Drift: function '${fnName}' GRANT EXECUTE TO anon differs (migrations=${migAnon}, schema.sql=${schAnon})`,
        context: "",
        meta: { function: fnName },
      });
    }
  }

  if (
    finalState.publicPolicyAnyoneCanView !== null &&
    schemaState.publicPolicyAnyoneCanView !== null &&
    finalState.publicPolicyAnyoneCanView !== schemaState.publicPolicyAnyoneCanView
  ) {
    issues.push({
      id: "DRIFT_POLICY_ANYONE_CAN_VIEW",
      severity: "error",
      file: toPosix(path.relative(ROOT, SCHEMA_PATH)),
      line: 1,
      message: `Drift: policy "Anyone can view public screens" differs (migrations=${finalState.publicPolicyAnyoneCanView}, schema.sql=${schemaState.publicPolicyAnyoneCanView})`,
      context: "",
    });
  }

  return issues;
}

async function main() {
  console.log("🔍 Security Scanner for Supabase SQL\n");

  const { migrationFiles, schemaFile, allFiles } = await listTargetFiles();

  console.log(`Scanning ${migrationFiles.length} migration files + schema.sql\n`);

  const migrationTexts = [];
  const allIssues = [];

  for (const file of allFiles) {
    let text;
    try {
      text = await readText(file);
    } catch (e) {
      if (file === schemaFile) {
        console.warn(`⚠️  schema.sql not found at ${toPosix(path.relative(ROOT, schemaFile))}, skipping.\n`);
        continue;
      }
      throw e;
    }

    if (file !== schemaFile) {
      migrationTexts.push({ file, text });
    }

    const issues = scanTextForFindings(file, text);
    allIssues.push(...issues);
  }

  const finalState = buildFinalStateFromMigrations(migrationTexts);

  let schemaState = null;
  try {
    const schemaText = await readText(schemaFile);
    schemaState = parseSchemaState(schemaFile, schemaText);
  } catch {
    // schema.sql not found
  }

  const effectiveIssues = computeEffectiveIssues(allIssues, finalState);

  let driftResults = [];
  if (checkDrift && schemaState) {
    driftResults = driftIssues({ finalState, schemaState });
  }

  const allFinalIssues = [...effectiveIssues, ...driftResults];

  const errors = allFinalIssues.filter((i) => i.severity === "error");
  const warns = allFinalIssues.filter((i) => i.severity === "warn");
  const infos = allFinalIssues.filter((i) => i.severity === "info");

  // Human-readable summary
  console.log("=== Summary ===\n");
  console.log(`Errors: ${errors.length}`);
  console.log(`Warnings: ${warns.length}`);
  console.log(`Info: ${infos.length}\n`);

  if (errors.length > 0) {
    console.log("--- Errors ---");
    for (const e of errors) {
      console.log(`[${e.id}] ${e.file}:${e.line}`);
      console.log(`  ${e.message}\n`);
    }
  }

  if (warns.length > 0) {
    console.log("--- Warnings ---");
    for (const w of warns) {
      console.log(`[${w.id}] ${w.file}:${w.line}`);
      console.log(`  ${w.message}\n`);
    }
  }

  // JSON report
  const report = {
    timestamp: new Date().toISOString(),
    strict,
    checkDrift,
    filesScanned: allFiles.map((f) => toPosix(path.relative(ROOT, f))),
    summary: {
      errors: errors.length,
      warnings: warns.length,
      info: infos.length,
    },
    issues: allFinalIssues,
  };

  const reportPath = path.join(ROOT, "security-scan-report.json");
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n📄 JSON report written to: ${toPosix(path.relative(ROOT, reportPath))}`);

  if (strict && errors.length > 0) {
    console.log("\n❌ Strict mode: exiting with code 1 due to errors.");
    process.exit(1);
  }

  console.log("\n✅ Scan complete.");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
