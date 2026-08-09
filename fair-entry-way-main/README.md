# Presence — Hardened College Attendance ERP System

`fair-entry-way` is a TanStack Start + Supabase attendance system designed for higher education institutions. It combines face recognition, multi-frame liveness verification, geofence radius checking, IPv4/IPv6 CIDR subnet enforcement, rotating 6-digit OTPs, and append-only audit ledgers to eliminate proxy attendance.

---

## 🔒 Security Architecture

### 1. Multi-Frame Liveness & Anti-Spoof Verification

- **Challenge Actions:** HMAC-signed 60-second TTL challenges (`blink`, `turn_left`, `turn_right`, `nod`).
- **Signal Trajectory:** Captures an 8-frame sequence (~1.5s). Computes Eye Aspect Ratio (EAR) for blinks, landmark-derived head yaw for horizontal turns, and pitch for nods.
- **Frame Sequence Identity Check:** Computes pairwise cosine similarity across all frame embeddings to reject frame-swap video attacks.
- **Static Photo Rejection:** Analyzes bounding box and landmark center variances across frames to detect printed photos and screen recordings.
- **Loud Biometric Failure Mode:** If `face-api.js` CDN or local model fails to load, fallback pseudo-embeddings are **strictly disabled**. Check-in is blocked, logged as `verification_unavailable`, and manual fallback requested.
- **Known residual risk — read this before trusting these signals in isolation:** the EAR/yaw/pitch/embedding numbers above are computed _client-side_, in the browser, and submitted as plain numbers. The HMAC on the challenge secures the challenge _metadata_ (action/session/TTL) — it does not attest that a real camera produced the numbers. A scripted HTTP client could in principle POST fabricated-but-plausible signal sequences straight to `submitAttendance` without ever opening a camera. Section 6 below (WebAuthn device attestation) closes this gap for students who've registered a device, but it's opt-in, not yet mandatory for everyone — see that section for the honest scope of what's actually closed versus still open. A certified server-side liveness SDK (AWS Rekognition Face Liveness, FaceTec, iProov) would close it more completely and isn't done here.

### 2. Authorization & Role Management

- **Role Escalation Protection:** Self-serve privilege escalation (`becomeTeacher`) is completely removed.
- **Role Requests Queue:** Students must submit a formal request (`role_requests` table) with department justification for admin approval.
- **Row Level Security (RLS):** Policies are enforced at PostgreSQL level using `private.has_role()`. Service-role keys are isolated to server functions only.

### 3. Multi-Factor Geofencing & Network Gates

- **Haversine Radius:** Checks physical client coordinates against session radius.
- **GPS Accuracy Rejection:** Rejects synthetic zero-variance or implausibly perfect GPS accuracy (< 0.5m).
- **CIDR Subnet Matching:** Supports exact IPv4/IPv6 address and subnet range matching (`matchCidr`).
- **Rotating Classroom OTP:** Teachers can generate a 6-digit rotating OTP on their classroom screen.

### 4. Throttling & Audit Ledger

- **Rate Limiting:** Enforces 5 attempts per session window per student, and 10 attempts per hour per IP address via `rate_limit_attempts`.
- **Append-Only Ledger:** `attendance_ledger` and `attendance_events` enforce PostgreSQL triggers blocking `UPDATE` and `DELETE`.
- **Multi-Student Device Flagging:** Looks back 24h for other distinct students who checked in from the same device fingerprint (not IP — shared classroom WiFi is expected and would otherwise flood false positives) and logs a `multi_student_flag` audit event once 2+ other students are found on one device.

### 5. ERP Workflows

- **Leave / On-Duty (OD) Requests:** Students submit leave/OD requests with an optional supporting document; admins review and approve/reject from the "Leave / OD Approvals" tab. Approved days are excluded from the student's attendance percentage. Approval/rejection triggers an in-app notification.
- **Bulk Roster & Faculty CSV Import:** Admins upload a CSV (`email, display_name, roll_no, department_code, program_code, current_semester, role`) from the "CSV Import" tab. Each row is validated server-side (unknown department/program codes, malformed emails, out-of-range semester, duplicate emails within the file) and classified as **matched** (existing account, will be updated), **will_invite** (new account, will be created via Supabase Admin invite), or **invalid**. Nothing is written until the admin reviews the preview and clicks Confirm Import.

### 6. Device Attestation (WebAuthn platform authenticators)

Added 2026-07-25 to partially close the liveness trust gap noted in Section 1.

- **What it does:** at enrollment (`/enroll`), a student can optionally bind their phone/laptop's platform authenticator (Face ID, Touch ID, Windows Hello, Android biometric unlock) via WebAuthn. Once bound, check-in (`submitAttendance`) requires a fresh hardware-backed signature over the _same_ server-issued challenge the liveness gate uses — see `webauthn.server.ts`. A scripted HTTP client cannot forge this even with perfectly fabricated liveness numbers, because the signing key never leaves the authenticator.
- **How it's implemented:** `webauthn_credentials` is a service-role-only table (no grant to `authenticated`/`anon` at all, same pattern as `session_otp_secrets` and `rate_limit_attempts`); registration uses a stateless HMAC-signed challenge envelope (same shape as the existing `LivenessChallenge`); the signature counter is checked and persisted on every use as replay/cloning defense.
- **Known residual risk — this does not fully close the gap in Section 1:** registration is **opt-in per student**, not mandatory. A student who hasn't registered a device still checks in on the liveness-signal gates alone, with the same trust-model limitation described in Section 1. Making registration mandatory at enrollment is a rollout/policy decision for the institution (existing enrolled students would need a migration window, and not every device has a platform authenticator), not purely a code change, and hasn't been done. Treat this as raising the bar for students who opt in, not as attested liveness for the whole student body.

### 7. Key Rotation

Added 2026-07-25. `BIOMETRIC_ENC_KEY` and `LIVENESS_HMAC_KEY` can now rotate without breaking already-encrypted embeddings or in-flight challenges/OTPs/WebAuthn registration ceremonies — previously these were documented as a manual TODO with no actual rotation support in code.

- **Biometric key (`BIOMETRIC_ENC_KEY`):** long-lived data (face embeddings at rest), so rotation uses full version history. To rotate: pick the next version number `N`, set `BIOMETRIC_ENC_KEY_V{N}` to a new secret, set `BIOMETRIC_ENC_KEY_CURRENT_VERSION={N}`. New encryptions use version `N`; the key version is embedded in the ciphertext itself (a 2-byte marker+version prefix), so existing rows keep decrypting correctly under whichever key encrypted them — keep old `BIOMETRIC_ENC_KEY_V*` values (and the original unversioned `BIOMETRIC_ENC_KEY`, if any pre-versioning data exists) around until a re-encryption migration has moved every row to the new version. **A re-encryption migration job itself is not implemented** — rotating the active key is safe today, but nothing automatically re-encrypts old rows under the new key, so old key material must be retained indefinitely unless you write that job.
- **HMAC key (`LIVENESS_HMAC_KEY`):** every token signed with it (liveness challenges, session OTPs, WebAuthn registration challenges) has a TTL of minutes, so a simple two-key scheme is enough. To rotate: set `LIVENESS_HMAC_KEY` to the new secret and `LIVENESS_HMAC_KEY_PREVIOUS` to the old one; new tokens sign with the current key only, verification accepts either, for as long as `LIVENESS_HMAC_KEY_PREVIOUS` stays set. Remove it once you're confident nothing issued under the old key is still outstanding (a few minutes, given the TTLs involved).
- **Still not done:** neither key actually lives in a secrets manager (Cloud KMS / Vault / hosting provider's secret store) yet — both are still read from process env vars (`.env` locally, host-provided env vars in production). This code change makes rotation _possible_; wiring the values themselves to come from a real secrets manager instead of env vars, and automating rotation on a schedule, is separate infrastructure work not done here.

### 8. Structured Audit Alerting

Added 2026-07-25. The admin dashboard's health metrics (`/admin`) are pull-based — someone has to be looking. `ALERT_WEBHOOK_URL` (optional; Slack/Discord-compatible incoming webhook, or any endpoint that accepts a JSON POST) now pushes alerts for: repeated liveness failures from one student (3+ in 15 minutes), IP-level rate-limit spikes, `multi_student_flag` events, and admin-role grants (via role-request approval, direct role assignment, or bootstrap). If unset, alerts fall back to `console.warn`/`console.error` (still visible to any log aggregator watching stdout) rather than silently disappearing. See `alerting.server.ts`.

---

## 🩹 Hardening Changelog (post-review fixes)

A review of the initial implementation found the project did not actually type-check or build, plus a few feature gaps. These have been fixed:

- **Build was broken:** `src/integrations/supabase/types.ts` was never regenerated after the ERP migration, causing 88 TypeScript errors and a failing `npm run build`. Regenerated to match the migration; `tsc --noEmit`, `npm run lint`, and `npm run build` all pass clean.
- **Latent runtime bugs surfaced by fixing `any` types:**
  - `getUserEmail` queried a non-existent `profiles.email` column — rewritten to use the Supabase Admin Auth API (`auth.admin.getUserById`), since email lives on `auth.users`, not `profiles`.
  - Several admin/teacher queries (`role_requests`, `leave_requests`, `enrollments`, `fallback_requests`) embedded `profiles:*_id(...)` without a real foreign key to `profiles` — PostgREST would reject these at runtime. Added explicit FK constraints in `20260723193000_role_requests_profiles_fk.sql`.
- **Multi-student device flagging** was previously just a declared event-type enum value with no detection logic — now implemented (see above).
- **Admin-side leave/OD approval** did not exist (students could submit but nobody could approve) — implemented `listLeaveRequests` / `reviewLeaveRequest` plus an admin UI tab.
- **Bulk roster/faculty CSV import** only supported enrolling users that already had accounts — implemented full CSV parsing, server-side validation preview, and commit (including inviting brand-new accounts) as described above.

---

## 🚀 Environment Variables

Copy `.env.example` to `.env` and fill in the required keys:

```env
# Supabase Configuration
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Cryptographic Secrets
BIOMETRIC_ENC_KEY=your-32-byte-aes-gcm-encryption-secret
LIVENESS_HMAC_KEY=your-hmac-sha256-signing-secret

# Optional: key rotation (see README's "Key Rotation" section under Security
# Architecture for the full procedure). Leave unset for existing single-key
# behavior, byte-for-byte unchanged.
# BIOMETRIC_ENC_KEY_CURRENT_VERSION=2
# BIOMETRIC_ENC_KEY_V1=...
# BIOMETRIC_ENC_KEY_V2=...
# LIVENESS_HMAC_KEY_PREVIOUS=...

# Optional: structured security alerting (Slack/Discord incoming webhook URL, or
# any endpoint that accepts a JSON POST). If unset, alerts fall back to
# console.warn/console.error instead of silently disappearing.
ALERT_WEBHOOK_URL=
```

---

## 📦 Database Migrations

Apply migrations to your Supabase instance using Supabase CLI:

```bash
npx supabase db push
```

Migrations include:

1. Core schema & append-only ledger (`20260709143622_...sql`)
2. Private schema role functions (`20260714110831_...sql`)
3. Immutable security audit events (`20260714113829_...sql`)
4. Department & Semester org hierarchy (`20260715165742_...sql`)
5. ERP and Hardening expansion (`20260721190000_erp_and_security_hardening.sql`)

This list is illustrative, not exhaustive — it was already missing several migrations (fees, HR/payroll) before this note was added. `supabase/migrations/` is the authoritative, current list; check there rather than trusting a hardcoded list in this doc, which has gone stale before.

---

## 🚀 Deployment

For complete deployment instructions (environment setup, database migrations, hosting options, post-deployment checks, and troubleshooting), see **[DEPLOYMENT.md](./DEPLOYMENT.md)**.

### Quick Start

```bash
# 1. Set up environment variables
cp .env.example .env.local
# Edit .env.local with your Supabase URL, API keys, and crypto secrets

# 2. Push migrations to Supabase
npx supabase db push

# 3. Build for production
npm run build

# 4. Deploy to your hosting (Vercel, Netlify, Cloud Run, etc.)
vercel --prod  # or netlify deploy --prod, etc.
```

---

## 🛠 Local Development & Testing

```bash
# Install dependencies
npm install

# Start local dev server
npm run dev

# Run TypeScript typechecks
npx tsc --noEmit

# Run unit tests (now blocking CI)
npm test

# Run linting
npm run lint

# Format code
npm run format
```

---

## 📊 Monitoring & Admin Dashboard

After deployment, access the admin dashboard at `/admin`:

- **Health Metrics:** Liveness failure rate, review backlog, fallback requests pending
- **Role Requests:** Approve/reject pending role escalation requests
- **Audit Logs:** Complete append-only attendance event ledger

---

## 📄 License & Accreditation Compliance

Designed for higher education accreditation compliance (NAAC / NBA attendance register exports).
