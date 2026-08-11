/**
 * 00-seed-test-students.ts — Days 1-2: create and enroll 5 test students.
 *
 * Run ONCE before starting any attack scripts:
 *   bun attack-harness/00-seed-test-students.ts
 *
 * What it does:
 *   1. Creates 5 test user accounts in Supabase Auth via admin API
 *   2. Inserts student profile rows in public.students
 *   3. Generates a synthetic 128-dim face embedding for each and enrolls it
 *      (embeddings are random unit vectors — enroll real faces via /enroll for Day 5)
 *
 * Requirements:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — set in your shell or copy from ../.env
 *
 * Note: This script uses the service_role key which bypasses RLS. Only run in a
 * dedicated test/staging Supabase project, never against production.
 */

import { createClient } from "@supabase/supabase-js";
import { config, randomEmbedding } from "./attack.config.ts";

async function main() {
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    console.error(
      "ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n" +
        "The service_role key is required to create users via admin API.\n" +
        "Find it in: Supabase Dashboard → Project Settings → API → service_role secret",
    );
    process.exit(1);
  }

  const admin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("🌱 Seeding 5 attack test students...\n");

  for (const student of config.testStudents) {
    process.stdout.write(`  Creating ${student.email}... `);

    // 1. Create auth user
    const { data: authData, error: authErr } = await admin.auth.admin.createUser({
      email: student.email,
      password: student.password,
      email_confirm: true, // skip verification email
      user_metadata: { full_name: student.name },
    });

    if (authErr) {
      if (authErr.message.includes("already been registered")) {
        console.log("already exists, skipping");
        continue;
      }
      console.log(`ERROR: ${authErr.message}`);
      continue;
    }

    const userId = authData.user?.id;
    if (!userId) {
      console.log("ERROR: no user ID returned");
      continue;
    }

    // 2. Insert student profile row
    const { error: profileErr } = await admin.from("students").upsert(
      {
        id: userId,
        full_name: student.name,
        email: student.email,
        student_code: `ATTACK-${student.email.split("@")[0].toUpperCase()}`,
      },
      { onConflict: "id" },
    );
    if (profileErr) {
      console.log(`profile error: ${profileErr.message}`);
      // Not fatal — continue to enrollment
    }

    // 3. Enroll a synthetic face embedding (AES-GCM encrypted via supabaseAdmin)
    // For Day 5 (identity gate), replace with a real enrolled face.
    // This synthetic embedding is orthogonal to all others, so identity cross-checks won't
    // produce false positives.
    const embedding = randomEmbedding(128);

    // Embed as hex directly — the server function handles encryption, but here we call
    // the face_embeddings table directly as admin with a placeholder ciphertext.
    // This is enough to satisfy "has enrollment" for all gates EXCEPT the final
    // identity cosine-similarity check, which requires the right embedding.
    const { error: embedErr } = await admin.from("face_embeddings").upsert(
      {
        student_id: userId,
        // We store raw float bytes as hex with \x prefix (matches the server's format)
        // For attack purposes this placeholder passes the "no_enrollment" check.
        // Replace with real encrypted embedding via /enroll UI for Day 5 tests.
        ciphertext: "\\x" + Buffer.from(new Float32Array(embedding).buffer).toString("hex"),
        algo: "raw_attack_seed_replace_via_enroll_ui",
      },
      { onConflict: "student_id" },
    );

    if (embedErr) {
      console.log(`embed error: ${embedErr.message}`);
    } else {
      console.log(`OK (userId: ${userId})`);
    }
  }

  console.log("\n✅ Seeding complete.");
  console.log("\nNext steps:");
  console.log("  1. Open the app and sign in as each student");
  console.log("  2. Go to /enroll and enroll a REAL face (needed for Day 5 identity test)");
  console.log("  3. Create a test class session and copy its ID into attack.config.ts");
  console.log("  4. Find the server function URL (see attack.config.ts instructions)");
  console.log("  5. Run bun attack-harness/day3-photo-spoof.ts to begin");
}

main().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
