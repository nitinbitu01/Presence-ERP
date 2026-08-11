# Presence ERP — Build Roadmap

Scope decision (locked in): **single-tenant now, split-ready later.** We are not turning
on multi-tenancy today, but we are laying the foundation so a future split doesn't require
a schema rewrite. See "Tenancy Foundation" below.

Time horizon: months, several sessions. This doc is the source of truth for sequencing —
update it at the start/end of each session so future sessions pick up where this one left off.

## Status Legend

✅ Done and verified (tsc/eslint/tests pass) · 🚧 In progress · ⬜ Not started

## Module Sequencing

| #   | Module                                                            | Status | Notes                                       |
| --- | ----------------------------------------------------------------- | ------ | ------------------------------------------- |
| 0   | Tenancy foundation (`institutions` table, scoping)                | ✅     | Session 2                                   |
| 1   | Attendance & biometric verification                               | ✅     | Prior work — hardened, tested, builds clean |
| 2   | Core academics (departments/programs/semesters/courses/timetable) | ✅     | Prior work                                  |
| 3   | Leave/OD workflow                                                 | ✅     | Prior work                                  |
| 4   | Bulk roster/faculty CSV import                                    | ✅     | Prior work                                  |
| 5   | **Examinations & Gradebook**                                      | ✅     | Session 2                                   |
| 6   | Parent portal + SMS/WhatsApp notifications                        | ✅     | Session 3                                   |
| 7   | Fees & Finance (Razorpay)                                         | ✅     | Session 4                                   |
| 8   | HR/Payroll (faculty & staff)                                      | ✅     | Session 5                                   |
| 9   | Hostel management                                                 | ⬜     | **Next priority**                           |
| 10  | Library management                                                | ⬜     |                                             |
| 11  | Transport management                                              | ⬜     |                                             |
| 12  | BI / analytics dashboards (at-risk students, trends)              | ⬜     |                                             |
| 13  | Native mobile app / real offline-first PWA                        | ⬜     |                                             |
| 14  | SSO (SAML/OIDC) + LMS integration                                 | ⬜     |                                             |
| 15  | Actual multi-tenant cutover (flip the switch built in #0)         | ⬜     | Only if/when needed                         |
| 16  | Compliance: pen test, FERPA/DPDP documentation, SOC 2 prep        | 🟡     | Partial — see Session 6 Phase 2 log below   |

## Tenancy Foundation (Module 0)

Rather than stamping `institution_id` onto every table (expensive, mostly unnecessary
for one tenant), we scope at the top of the hierarchy only:

- New `institutions` table, one seeded row for the current college.
- `departments.institution_id` — every other academic entity (programs, courses,
  timetable, profiles) already hangs off `department_id`, so they inherit tenant scope
  transitively.
- When we actually cut over to multi-tenant (module 15), the work is: denormalize
  `institution_id` onto the tables that need it for RLS/index performance, add
  `institution_id` checks to RLS policies, add an institution switcher to the UI.
  It is NOT a schema rewrite.

## Examinations & Gradebook (Module 5) — this session's build

- `exams` — one row per (course, exam type, semester): midterm/end-sem/practical/quiz,
  max marks, weightage %, exam date.
- `grade_scales` + `grade_bands` — institution-configurable letter-grade boundaries and
  grade points (supports the standard 10-point Indian GPA scale by default).
- `exam_marks` — one row per (exam, student): marks obtained, absent flag, remarks,
  entered_by/at. Append-friendly, teacher/admin write, student read-only-own.
- Computed course result: weighted percentage → letter grade → grade point, done in a
  server function rather than a DB view for now (simpler to evolve while the module is new).
- Backlog tracking: a student below the pass threshold on a course is flagged; admin can
  see a backlog list per semester.
- Roles:
  - **Admin:** create/edit exams, configure grade scales, view all results, backlog report.
  - **Teacher:** bulk marks entry for their own courses, view their course's results.
  - **Student:** view marks per exam, computed course grade, semester result summary.

## Explicitly deferred within this module (future session)

- PDF transcript generation (there's a `pdf` skill available for this later).
- SGPA/CGPA rollups across semesters (needs semester credit-weighting design decision).
- Grade revaluation/appeal workflow.
- Moderation (scaling a class's marks up/down before finalizing).

## Session Log

**Session 2:** Built tenancy foundation (`institutions` table,
`departments.institution_id`, trigger-based single-tenant default) and the full
Examinations & Gradebook module — schema + RLS, admin exam CRUD + grade scale
seeding + backlog report, teacher bulk marks entry UI, student results view with
computed weighted percentage and letter grade. 27 new tests (49 total added this
session: exam logic + auth policy tests). Verified: `tsc --noEmit` clean,
`eslint .` clean (0 errors), `vitest run` 128/128 passing, `npm run build` succeeds.

Two new migrations to apply in order after the original hardening migration:
`20260723200000_institutions_tenancy_foundation.sql`,
`20260723210000_examinations_gradebook.sql`.

**Session 3:** Built the Parent/Guardian portal. Schema: `guardians` +
`guardian_students` tables, RLS granting guardians read-only access to their
linked students' attendance/exam-marks(published only)/leave data, and a
`handle_new_user` trigger update so guardian-invited accounts (via
`is_guardian` metadata flag) don't get a default student profile/role.
SMS/WhatsApp abstraction added to `notifications.server.ts` (Twilio-ready via
env vars, safe console-log fallback when unconfigured) and wired into three
real triggers: leave/OD approval-rejection, exam-publish, and a new
admin-triggered "send low-attendance alerts" bulk action. New
`guardian.functions.ts` (admin management + guardian-facing reads), new admin
"Guardians" tab, and a new `/parent` portal route. 20 new tests (168 total).
Verified: `tsc --noEmit` clean, `eslint .` clean (0 errors), `vitest run`
148/148 passing, `npm run build` succeeds (route tree regenerated).

One new migration to apply after the exams migration:
`20260724100000_parent_guardian_portal.sql`.

**Known limitation to flag for the next session:** guardian invites currently
send only Supabase's default auth-invite email — there's no branded
"you've been invited to view your child's attendance" email copy yet. Low
priority, but worth a quick pass before a real pilot.

**Session 4:** Built Fees & Finance with Razorpay. Schema: `fee_structures`,
`fee_invoices`, `fee_payments` (append-only — UPDATE/DELETE revoked from
`authenticated`, corrections are new rows not edits), RLS including guardian
read access reusing the `private.is_guardian_of()` helper from session 3. New
`razorpay.server.ts`: order creation + HMAC-SHA256 signature verification
(constant-time compare) per Razorpay's documented scheme — verification is
server-side only, the client-reported "payment succeeded" is never trusted
directly. New `fee.functions.ts`: admin fee-structure/invoice management,
bulk invoice generation per program, manual payment recording (cash/cheque/
bank transfer) for offline payments, waiver workflow, collection-summary
dashboard; student-facing invoice list + Razorpay checkout flow. New admin
"Fees & Finance" tab and a "Fees" card on the student dashboard. Payment
confirmation notifies the student and their linked guardians. 18 new tests
(166 total) covering invoice status transitions, signature verification
(including tamper/wrong-secret/wrong-order rejection), and authorization.
Verified: `tsc --noEmit` clean, `eslint .` clean (0 errors), `vitest run`
166/166 passing, `npm run build` succeeds.

One new migration to apply after the parent/guardian migration:
`20260724150000_fees_finance.sql`.

**Note:** Razorpay requires `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` env vars
in production; `createPaymentOrder` throws a clear configuration error
(rather than silently no-op like the SMS fallback) since payments can't be
faked the way a notification can.

**Session 5:** Built HR/Payroll. Schema: `employees` (distinct from
`profiles` — any account, including existing teachers, can be onboarded),
`payroll_runs`, `payslips` (append-only, same pattern as fee_payments),
`staff_leave_requests`. Extended the `handle_new_user` trigger with a third
branch (`is_employee` metadata flag) alongside the existing guardian/student
branches. New `hr.functions.ts`: admin employee management (invite new OR
link an existing account, e.g. onboarding an existing teacher into payroll),
payroll run creation (bulk-generates payslips from active employees' base
salaries), per-payslip allowance/deduction editing, finalize-and-pay (notifies
every employee), staff leave approval. New admin "HR & Payroll" tab (3
sub-views: employees, payroll, staff leave) and a new `/employee` portal
route (own payslips, leave request submission and status). 18 new tests
(184 total) covering payslip math, payroll run lifecycle, and authorization.
Verified: `tsc --noEmit` clean, `eslint .` clean (0 errors), `vitest run`
184/184 passing, `npm run build` succeeds (route tree regenerated for
`/employee`).

One new migration to apply after the fees migration:
`20260725100000_hr_payroll.sql`.

**Session 6 (2026-07-25):** Hardening pass, Phase 0 of the college-readiness work
order (`docs/` — see the work order text if still around; not committed to this
repo). Fixed all 4 confirmed Phase 0 bugs:

1. **`session_otp` RLS leak.** `class_sessions_read_enrolled` grants full-row
   SELECT to enrolled students; RLS filters rows, not columns, so
   `session_otp`/`otp_generated_at` (added later, no column-level restriction)
   were readable by any enrolled student directly via the Supabase client.
   Moved both to a new `session_otp_secrets` table with no grant to
   `authenticated`/`anon` at all (mirrors the existing `rate_limit_attempts`
   pattern), migration `20260725110000_session_otp_privacy_fix.sql`.
   **While fixing this, found a second, worse bug**: `refreshSessionOtp`'s
   ownership check joined `courses!inner(teacher_id)` but never actually
   compared it to the caller — and `courses` has a `using (true)` read policy
   for all authenticated users — so any enrolled student could call
   `refreshSessionOtp` directly and get the OTP handed back in the response,
   no RLS bypass needed. Fixed with an explicit two-step ownership check
   (same pattern as `createClassSession`). Added a real regression test
   (`rls.integration.test.ts`, new `describe` block) that reads the actual
   migration SQL from disk and asserts the grant/column properties hold —
   more rigorous than this suite's usual mocked-assertion style, since there's
   no live Supabase instance here to test RLS enforcement against directly.

2. **Rate limiter TOCTOU race.** `checkRateLimit`'s count-SELECT and
   insert were two separate round trips; concurrent requests could all pass
   the count check before any committed. Replaced with a single Postgres
   function, `check_and_increment_rate_limit`, that does count+insert in one
   call under a transaction-scoped advisory lock keyed on the rate-limit key
   (migration `20260725120000_atomic_rate_limit.sql`). New test file
   `rate-limit-atomicity.test.ts`: fires 30 concurrent calls at the real
   `checkRateLimit` (stubs `global.fetch`, not the Supabase client module —
   an earlier attempt using `vi.mock` on the client module was unreliable
   under concurrent first-time dynamic `import()` in this Vitest/vite-node
   version) and asserts exactly `maxAttempts` succeed; a second describe
   block reproduces the old two-round-trip shape inline to concretely show
   it overshoots under the same concurrency, for contrast.

3. **4 ESLint errors.** Root cause turned out to be more than formatting:
   the 4 broken files (`src/routes/[.mcp]/**`, `src/routes/[.well-known]/**`,
   `src/routes/mcp.ts`) are auto-generated by the `@lovable.dev/mcp-js` Vite
   plugin on every build (each carries a "do not edit, regenerated by the
   Vite plugin" banner), and regenerated in a form that doesn't match this
   project's Prettier config. `eslint --fix` alone isn't durable — the next
   `npm run build` regenerates and un-formats them again (confirmed:
   verified this actually happened mid-session). Fixed properly by excluding
   these paths from `eslint.config.js`'s `ignores`, respecting the plugin's
   own ownership model instead of fighting output it controls. Confirmed
   fixed durably by rebuilding and re-linting afterward.

4. **Inflated doc claims.** `IMPLEMENTATION_SUMMARY.md` and
   `VERIFICATION_CHECKLIST.md` both claimed "350 tests" / "350+ integration
   tests" across 3 test files (`attendance-crypto.test.ts` 102,
   `submitAttendance.integration.test.ts` 95, `rls.integration.test.ts` 153);
   actual `vitest run` output was, and remains, 9 files. Corrected both docs
   to the real, freshly-run count (192 tests, up from 184 due to the two new
   regression test files above) with a note not to trust a hardcoded number
   going forward. Also corrected `IMPLEMENTATION_SUMMARY.md`'s "Exploitable
   Holes Found: None" (false — see #1 above) and both docs' "production-ready"
   / "100% compliant" / "READY FOR PRODUCTION PILOT DEPLOYMENT" self-certification
   language, which wasn't accurate given items 1-2 above were live bugs and
   Phases 1-4 of the work order (liveness trust gap, compliance, multi-tenancy,
   SSO, mobile, independent human sign-off) haven't been started.

**Verified fresh this session** (all four, re-run after all changes above,
not carried forward): `npx tsc --noEmit` → 0 errors. `npx eslint .` → 0
errors, 12 pre-existing warnings (unrelated `react-hooks/exhaustive-deps`
and `react-refresh/only-export-components`, not touched). `npx vitest run`
→ **9 files, 192/192 passing**. `npm run build` → succeeds, including a
rebuild specifically to confirm fix #3 above survives regeneration.

**Explicitly deferred to the next session** — none of these were started:
Phase 1 (liveness trust gap — client-reported signals still aren't
attested server-side against raw camera data), Phase 2 (pen test, FERPA/DPDP
docs, secrets manager + key rotation, structured audit alerting), Phase 3
(multi-tenant cutover, SSO, statutory payroll compliance), Phase 4 (load
testing, offline mobile PWA, BI dashboards, WCAG pass, and — importantly —
a named human review/sign-off on the security-relevant modules, which no
session so far has had). Module 16 in the table above (Compliance) is still
accurately marked ⬜.

**Session 6, continued — Phase 1 (liveness trust gap):** Picked the second
of the work order's three options: WebAuthn platform-authenticator device
binding as an additional bound factor, opt-in per student (not the
certified-liveness-SDK option — no AWS/FaceTec/iProov credentials are
available in this environment to integrate and test against; not
mandatory-enrollment either, since that's a rollout/policy decision, not
purely a code change).

- Two new migrations: `20260725130000_webauthn_device_binding.sql`
  (`webauthn_credentials` table, service-role-only — same locked-down grant
  pattern as `session_otp_secrets`/`rate_limit_attempts` from Phase 0) and
  `20260725140000_webauthn_event_type.sql` (extends the
  `attendance_events.event_type` check constraint for the new gate's
  failure logging).
- `webauthn.server.ts`: registration options + verification and
  authentication (assertion) verification via `@simplewebauthn/server`.
  Registration uses a stateless HMAC-signed challenge envelope, same shape
  as the existing `LivenessChallenge` — reuses `LIVENESS_HMAC_KEY` rather
  than adding a new required secret, with domain-tagged payloads so the two
  can't be confused. Check-in doesn't need its own challenge round trip: it
  reuses the _same_ `livenessChallenge.sig` the existing Gate 3 already
  issues, so the WebAuthn assertion and the liveness signals are bound to
  the same server-issued nonce.
- New Gate 2c in `submitAttendance` (`attendance.functions.ts`): if a
  student has a registered device, check-in requires a valid assertion over
  that challenge; if not, the gate is skipped and existing behavior is
  unchanged. RP ID/origin are derived from the request's `Origin`/`Host`
  headers rather than a hardcoded env var, so this works across dev/preview/
  prod without new required config.
- Client wiring: `enroll.tsx` gets a "Bind a device" section
  (`@simplewebauthn/browser`'s `startRegistration`, list/remove registered
  devices); `attend.$sessionId.tsx` checks `hasWebauthnDevice` on load and,
  if true, prompts for `startAuthentication` before submitting.
- Tests (`webauthn.test.ts`, 14 new): real HMAC round-trip tests for the
  registration challenge envelope (issue/verify, wrong user, expired,
  tampered signature, swapped nonce — all genuine, no mocking needed since
  it's pure crypto); `resolveRpConfig`; and `hasRegisteredDevice`/
  `verifyDeviceAssertion` against a stubbed `global.fetch` (same approach as
  Phase 0's rate-limit test — real exported functions, not
  re-implementations) with `@simplewebauthn/server`'s
  `verifyAuthenticationResponse` mocked via `vi.mock` (a _static_ import
  this time, not the dynamic-import-under-concurrency case that was flaky
  in Phase 0 — this one was reliable on the first attempt). Covers: unknown
  credential fails closed without even calling the verify library; a
  verified assertion persists the new counter; an unverified or
  throwing (e.g. non-increasing counter — cloned authenticator) result
  fails closed and does _not_ bump the counter.
- `README.md`'s security section: added an explicit "known residual risk"
  paragraph to the existing liveness section (previous wording didn't
  disclose that the signals are client-computed) and a new Section 6
  documenting what the WebAuthn addition does and, just as importantly,
  what it _doesn't_ close (opt-in only — most students still rely on the
  liveness-signal gates alone until an institution rolls out mandatory
  registration, which hasn't happened here).

**Verified fresh this session:** `npx tsc --noEmit` → 0 errors. `npx
eslint .` → 0 errors, 12 pre-existing warnings (unchanged). `npx vitest
run` → **10 files, 206/206 passing** (192 from Phase 0 + 14 new). `npm run
build` → succeeds, including the new `@simplewebauthn/server`/`browser`
dependencies bundling cleanly.

**Explicitly not done in Phase 1:** the certified-liveness-SDK option
(needs real vendor credentials this environment doesn't have); making
device registration mandatory (policy/rollout decision, plus needs a
migration window for already-enrolled students); native-shell device
attestation (Play Integrity/App Attest — needs an actual native app
wrapper, out of scope for a web-only TanStack Start project as it
currently exists). Phases 2-4 remain entirely untouched, as noted above.

**Session 6, continued — Phase 2 (production & compliance readiness):**
All four items got real progress; none are fully closed out per the work
order's own Definition of Done (see honest caveats under each below).

1. **Security review** (`docs/SECURITY_REVIEW.md`, new): targeted manual
   review of the specific areas named — `role_requests` privilege
   escalation, IDOR on session/enrollment IDs, RLS gaps, CSV import/invite
   flow. Found and fixed a **critical**: `reviewFallbackRequest`
   (`attendance.functions.ts`) had no authorization check beyond "is logged
   in" — any authenticated user, including a student, could approve any
   fallback request (their own or anyone else's) and be granted
   `fallback_present` attendance credit, bypassing all 5 gates entirely.
   The read-path sibling, `listFallbackRequests`, was already correctly
   scoped to the teacher's own courses, which likely made this look
   reviewed at a glance. Fixed with the same explicit
   teacher-owns-course-or-admin check used for the `refreshSessionOtp` fix
   earlier this session. Regression test asserts the check's presence and
   that it runs before the status update / ledger insert
   (`review-fallback-authz.test.ts`) — testing the real createServerFn
   handler directly would need simulating its auth middleware, which no
   test in this suite does, so this asserts the fix is actually in the
   source rather than skipping a regression test for a bug this serious.
   Also checked and documented clean: every other `review*`/`approve*`
   function (all correctly call `requireAdmin` except the one above), CSV
   bulk import's role assignment (never grants `admin`), guardian-student
   IDOR (`getGuardianStudentSummary` checks the link row explicitly), and
   cross-user liveness-challenge reuse (already checked against
   `context.userId`). **Explicitly not a real pentest** — no dynamic
   testing, no Burp/ZAP, no fuzzing, no dependency CVE scan, and exam/fees/
   HR modules weren't in scope for this pass. Documented as such rather
   than implied-solved.

2. **FERPA/DPDP/GDPR data handling docs + retention job**
   (`docs/COMPLIANCE.md`, new): data inventory (what's stored, encrypted,
   readable by whom), retention/erasure workflow, framework-specific notes
   for each of FERPA/DPDP/GDPR, and a DPA outline for institutions —
   explicitly framed as informing counsel's review, not legal advice.
   Backed by real code, not just documentation: migration
   `20260725150000_biometric_retention_job.sql` adds
   `enforce_biometric_retention()`, a SECURITY DEFINER function that erases
   `face_embeddings` for any student whose `biometric_consent.
retention_until` has passed, marks consent withdrawn, and logs to
   `biometric_withdrawals` — previously that column was collected at
   consent time but nothing ever read it back; the only working erasure
   path was the student-initiated `withdrawBiometric`. Scheduled via
   `pg_cron` (wrapped in exception handling so the migration still applies
   if `pg_cron` isn't enabled on a given project), with an admin-callable
   fallback (`runBiometricRetentionSweep`) for environments without it.
   Regression test reads the real migration SQL (`biometric-retention.
test.ts`), same approach as the Phase 0 session_otp fix.

3. **Key rotation** (`attendance-crypto.server.ts`, `webauthn.server.ts`):
   `BIOMETRIC_ENC_KEY` now supports versioned rotation — ciphertext embeds
   a 2-byte marker+version prefix, so old rows keep decrypting under
   whichever key encrypted them while new encryptions use the current
   version; fully backward compatible (unversioned mode, the default, is
   byte-for-byte unchanged from before). `LIVENESS_HMAC_KEY` supports a
   current+previous grace window (`LIVENESS_HMAC_KEY_PREVIOUS`), applied to
   every HMAC-signed token in the system: liveness challenges, session
   OTPs, and the WebAuthn registration challenge from Phase 1. 8 new tests
   (`key-rotation.test.ts`) cover round-trips, rotation continuity, legacy
   ciphertext surviving a switch to versioned mode, fail-closed on a wrong
   key, and the HMAC grace window opening/closing. **Honestly incomplete**:
   this makes rotation _possible_ in code; neither key actually lives in a
   real secrets manager (Cloud KMS/Vault/host secret store) yet — both are
   still plain env vars — and no automatic re-encryption-on-rotation job
   exists (old key material must be kept until such a job is written or
   rows are manually migrated).

4. **Structured audit alerting** (`alerting.server.ts`, new): webhook-based
   push alerts (Slack/Discord-compatible payload, configurable via
   `ALERT_WEBHOOK_URL`, falls back to `console.warn`/`error` if unset) for
   the four events the work order named — repeated liveness failures (3+
   from one student in 15 minutes), IP-level rate-limit spikes,
   `multi_student_flag` events, and admin-role grants. Wired into 5 real
   call sites: the IP rate-limit check in `submitAttendance`, the
   multi-student-flag log point, `recordAndReturn`'s liveness-failure path
   (checked centrally so every liveness-rejection call site is covered),
   and all three places the codebase can actually grant the admin role
   (`setUserRole`, `reviewRoleRequest`, `claimBootstrapAdmin`). 7 tests
   (`alerting.test.ts`) cover webhook dispatch, the console fallback,
   fire-and-forget failure handling, and each alert helper's payload shape.

**Verified fresh this session:** `npx tsc --noEmit` → 0 errors. `npx
eslint .` → 0 errors, 12 pre-existing warnings (unchanged). `npx vitest
run` → **14 files, 231/231 passing** (206 from Phases 0-1 + 25 new). `npm
run build` → succeeds.

Module 16 above is updated to 🟡 (partial) rather than ✅ — a third-party
or more thoroughly tooled pentest, a real secrets manager integration, and
a full institutional records-retention policy (beyond biometric templates
specifically) are all still open, and said so explicitly in the two new
docs rather than left implied-solved.

**Explicitly not done in Phase 2, carried to Phase 3/4:** multi-tenant
cutover, SSO, statutory payroll compliance (Phase 3); load testing,
offline mobile PWA, BI dashboards, WCAG pass, and the still-missing named
human sign-off (Phase 4). Modules outside attendance/role_requests/CSV
import (exams, fees, HR/payroll) were not part of this session's security
review scope and should get their own pass before a broader
"production-ready" claim would be accurate.

**Session 7 (2026-07-29):** 7-Day College Pilot Deployment for **Rashtriya Raksha University (RRU)**.
Built and verified key infrastructure, auth/navigation gaps, branding, and institutional documentation:

- **Database Seed & Setup:** Created `supabase/seed.sql` for RRU (`RRU` institution, 5 schools/departments: `SITA`, `SISDP`, `SISSP`, `SICSR`, `SCBS`, 4 programs, active semester `2026-FALL`). Created `SETUP.md` for non-technical database & deployment guidance. Confirmed graceful degradation when optional secrets are unconfigured.
- **Login & Navigation:** Extended `getMyRoles` (`isAdmin`, `isTeacher`, `isStudent`, `isGuardian`, `isEmployee`, `displayName`). Implemented role-aware post-login redirect in `auth.tsx` with `next` deep-link support. Added "Forgot password?" link on `auth.tsx` and created `/reset-password` recovery page. Created persistent `AppNav.tsx` with multi-role support and mounted it in `_authenticated/route.tsx`. 9 new unit tests (`navigation.test.ts`) covering open-redirect protection and role routing logic (240 total).
- **Branding & Content:** Updated landing page (`index.tsx`) and root metadata (`__root.tsx`) with RRU logo, name, and slogan (_"National Security is Supreme • राष्ट्रीय सुरक्षा सर्वोपरि"_). Updated `privacy.tsx` with DPDP policy copy and explicit liveness residual risk disclosure. Created student 5-gate FAQ page (`help.tsx`), linked from `student.tsx`.
- **Handover:** Created `HANDOVER.md` detailing operational instructions, admin bootstrap flow, secrets reference, out-of-scope modules, and post-pilot security hardening backlog.

**Verification:** `npx tsc --noEmit` clean (0 errors), `npm run lint` clean (0 errors), `vitest run` **15 files, 240/240 passing**, `npm run build` succeeds cleanly.

**Session 8 (2026-07-31): 3-Day Anti-Proxy Hardening Sprint.**
Hardened anti-proxy attendance controls across 9 core tasks:
1. **Auth Type Fix**: Fixed `auth.tsx` AuthChangeEvent comparison cleanly without suppressing types.
2. **Mandatory WebAuthn Binding & Admin Exemptions**: Gate 2c now fails closed with `device_attestation_missing` if a student lacks a registered platform authenticator, unless granted an active admin exemption via new `webauthn_exemptions` table. Added admin functions `listWebauthnExemptions`, `grantWebauthnExemption`, and `revokeWebauthnExemption`. 4 new tests (`webauthn-mandatory.test.ts`).
3. **Secure Photo Persistence & Retention**: Stored AES-GCM encrypted enrollment photos in `enrollment_photos` with student-read RLS policy, wired into `enforce_biometric_retention()`.
4. **Mid-Session Spot-Checks**: Server function `triggerMidSessionSpotCheck` issues liveness re-verification challenges to a random ~15% subset of checked-in students; failure/timeout within 2 minutes flags `spot_check_failed` and downgrades ledger decision to `review`. 2 new tests (`spot-check.test.ts`).
5. **Human Review Queue & Append-Only Ledger**: Admin/Teacher UI and APIs (`listReviewQueue`, `resolveReviewCheckIn`) for side-by-side photo comparison of `review` bucket check-ins (similarity 0.75-0.82). Approvals/rejections insert new amendment rows into `attendance_ledger` (preserving append-only database triggers). 2 new tests (`human-review.test.ts`).
6. **Virtual Camera Driver Detection**: `detectVirtualCamera` inspects `MediaStreamTrack` capabilities against known virtual camera drivers (`OBS`, `DroidCam`, `ManyCam`, `Iriun`, `Snap Camera`, etc.) and fails attempt closed with `virtual_camera_detected`. 4 new tests (`virtual-camera.test.ts`).
7. **Behavioral Timing Anomaly Detection**: Sub-800ms latencies or zero-variance historical attempts flag `timing_anomaly`, alert via webhook, and route attempt to review queue. 4 new tests (`timing-anomaly.test.ts`).
8. **Fraud Risk Aggregation**: Aggregate signals (`multi_student_flag`, `timing_anomaly`, `virtual_camera_detected`, `spot_check_failed`, review reject rate) into `getFraudRiskMetrics` server function and visible risk badges on `/admin`. 4 new tests (`fraud-risk-aggregation.test.ts`).
9. **Explicitly Out of Scope**: NFC/RFID card issuance (hardware procurement required), Bluetooth classroom beacons (lack of iOS Web Bluetooth support), Wi-Fi MAC binding (browser JS security restriction), certified third-party liveness SDK (requires vendor contract/credentials), native app device attestation (requires native app shell).

