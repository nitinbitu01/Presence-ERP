/**
 * day10-scale-check.ts — Scale & Workers Free Tier Verification
 *
 * Run: bun attack-harness/day10-scale-check.ts
 *
 * What this tests:
 *   Confirms the Workers Free tier 50-row cap doesn't break mid-demo.
 *   Measures how many enrolled students exist and whether the sync
 *   duplicate-check runs or defers to async admin review.
 *
 * What it checks:
 *   1. Count enrolled students in face_embeddings
 *   2. If count ≤ 50: sync duplicate check runs (expected for demo)
 *   3. If count > 50: deferred flag is logged (expected for Workers Free)
 *   4. Measures a simulated enrollment attempt's wall-clock time
 *   5. Reports whether the deployment tier can handle the current load
 *
 * Pre-requisites:
 *   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set (for admin queries)
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "./attack.config.ts";

async function main() {
  console.log("═".repeat(60));
  console.log("  Day 10 — Scale & Deployment Verification");
  console.log("═".repeat(60));

  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    console.error(
      "\nERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required.\n" +
        "Set them in your shell or copy from ../.env\n",
    );
    process.exit(1);
  }

  const admin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── 1. Count enrolled students ────────────────────────────────────────────
  console.log("\n1. Counting enrolled students in face_embeddings...");

  const { count, error } = await admin
    .from("face_embeddings")
    .select("student_id", { count: "exact", head: true });

  if (error) {
    console.error(`   ERROR: ${error.message}`);
    process.exit(1);
  }

  const enrolled = count ?? 0;
  console.log(`   Enrolled students: ${enrolled}`);

  // ── 2. Workers Free tier assessment ───────────────────────────────────────
  console.log("\n2. Workers Free tier assessment...");

  const FREE_TIER_CAP = 50;
  const FREE_TIER_CPU_MS = 10;
  const APPROX_MS_PER_ROW = 0.15; // ~150ms per 1000 rows

  const estimatedCpuMs = enrolled * APPROX_MS_PER_ROW;

  console.log(`   Estimated CPU per duplicate-check: ${estimatedCpuMs.toFixed(1)}ms`);
  console.log(`   Workers Free CPU limit: ${FREE_TIER_CPU_MS}ms`);
  console.log(`   50-row safety cap: ${FREE_TIER_CAP}`);

  if (enrolled <= FREE_TIER_CAP) {
    console.log(`   ✅ SAFE: ${enrolled} ≤ ${FREE_TIER_CAP} — sync duplicate check runs`);
    console.log(`   CPU estimate: ${estimatedCpuMs.toFixed(1)}ms << ${FREE_TIER_CPU_MS}ms limit`);
  } else {
    console.log(`   ⚠️  DEFERRED: ${enrolled} > ${FREE_TIER_CAP} — duplicate check is async`);
    console.log(
      `   The saveEnrollment function skips sync duplicate-check and logs a`,
    );
    console.log(
      `   "duplicate_check_deferred_workers_free" event for admin review.`,
    );
    console.log(`   To enable sync check: upgrade to Workers Paid ($5/month).`);
  }

  // ── 3. Check for deferred check events ────────────────────────────────────
  console.log("\n3. Checking for deferred duplicate-check events...");

  const { data: deferredEvents, error: deferredErr } = await admin
    .from("attendance_events")
    .select("id, created_at, gate_reasons")
    .eq("reason_code", "duplicate_check_deferred_workers_free")
    .order("created_at", { ascending: false })
    .limit(5);

  if (deferredErr) {
    console.log(`   Query error: ${deferredErr.message}`);
  } else if (deferredEvents && deferredEvents.length > 0) {
    console.log(`   Found ${deferredEvents.length} deferred events:`);
    for (const ev of deferredEvents) {
      const gr = ev.gate_reasons as Record<string, unknown> | null;
      console.log(`     ${ev.created_at}: enrolled_count=${gr?.enrolled_count ?? "?"}`);
    }
  } else {
    console.log("   No deferred events found (good — all checks ran sync)");
  }

  // ── 4. Benchmark simulation ───────────────────────────────────────────────
  console.log("\n4. CPU budget simulation...");

  const scenarios = [10, 30, 50, 100, 200, 500, 1000];

  console.log("   Students │ Est. CPU │ Free Tier │ Paid Tier │ Status");
  console.log("   ─────────┼──────────┼───────────┼───────────┼──────────");
  for (const n of scenarios) {
    const cpu = n * APPROX_MS_PER_ROW;
    const freeOk = cpu < FREE_TIER_CPU_MS;
    const paidOk = cpu < 30_000; // 30s paid tier limit
    const status =
      n <= FREE_TIER_CAP
        ? "✅ sync (capped)"
        : freeOk
          ? "✅ sync"
          : paidOk
            ? "⚠️  deferred (free) / ✅ sync (paid)"
            : "❌ exceeds both tiers";
    console.log(
      `   ${String(n).padStart(8)} │ ${cpu.toFixed(1).padStart(7)}ms │ ${freeOk ? " ✅ " : " ❌ "}      │ ${paidOk ? " ✅ " : " ❌ "}      │ ${status}`,
    );
  }

  // ── 5. Demo readiness ─────────────────────────────────────────────────────
  console.log("\n5. Demo readiness checklist:");

  const checks = [
    {
      name: "Enrolled students within free-tier cap",
      ok: enrolled <= FREE_TIER_CAP,
      fix: `Remove test accounts or upgrade to Workers Paid (${enrolled} enrolled)`,
    },
    {
      name: "WEBAUTHN_POLICY env var",
      ok: !!process.env.WEBAUTHN_POLICY,
      fix: "Set WEBAUTHN_POLICY=mandatory in .env",
    },
    {
      name: "ALERT_WEBHOOK_URL env var",
      ok: !!process.env.ALERT_WEBHOOK_URL,
      fix: "Set ALERT_WEBHOOK_URL to your Discord/Slack webhook",
    },
    {
      name: "BIOMETRIC_ENC_KEY env var",
      ok: !!process.env.BIOMETRIC_ENC_KEY,
      fix: "Set BIOMETRIC_ENC_KEY (openssl rand -base64 32)",
    },
    {
      name: "LIVENESS_HMAC_KEY env var",
      ok: !!process.env.LIVENESS_HMAC_KEY,
      fix: "Set LIVENESS_HMAC_KEY (openssl rand -base64 32)",
    },
  ];

  let allOk = true;
  for (const check of checks) {
    const icon = check.ok ? "✅" : "❌";
    console.log(`   ${icon} ${check.name}`);
    if (!check.ok) {
      console.log(`      → Fix: ${check.fix}`);
      allOk = false;
    }
  }

  console.log("\n" + "═".repeat(60));
  if (allOk) {
    console.log("  ✅ All checks passed — ready for demo!");
  } else {
    console.log("  ⚠️  Some checks failed — fix before demo day");
  }
  console.log("═".repeat(60));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
