# Data Handling & Compliance Documentation

**Status: draft, prepared by an AI hardening session, not reviewed by counsel.**
This document describes what the system actually does, as of 2026-07-25, so an
institution's legal/compliance/privacy team has an accurate starting point. It is
not legal advice, and nothing here should be treated as a compliance
certification. Have qualified counsel review this against your institution's
actual jurisdiction, student population, and existing policies before relying on
it — FERPA, India's DPDP Act, and GDPR each have specific procedural and
notice requirements this document doesn't attempt to satisfy on its own (signed
notices, designated officers, registration/filing obligations, etc.).

This is part of Phase 2 of the hardening work order's compliance gate
("required before real student data"). It covers three of that gate's four
items — what's stored, the retention/erasure mechanism, and a DPA outline. The
fourth (a structured penetration test) is a separate document; see
`docs/SECURITY_REVIEW.md` if present.

---

## 1. What biometric and personal data is stored

"Biometric data" here means the face-embedding vectors used for attendance
identity verification, plus the metadata directly tied to them. This is the
data category that gets the most scrutiny under all three frameworks below.

| Table                                     | What it holds                                                                                                                                                                                                          | Encrypted at rest?                                                        | Who can read it                                                                |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `face_embeddings`                         | The actual biometric template: a 128-dimension face embedding vector, AES-256-GCM encrypted, one row per student (latest enrollment only — old embeddings are overwritten, not versioned)                              | Yes (`BIOMETRIC_ENC_KEY`, see `docs/../README.md`'s Key Rotation section) | Server only (service_role; RLS policy is `using (false)` for all client roles) |
| `biometric_consent`                       | Consent grant/withdrawal timestamps, policy version consented to, retention deadline (`retention_until`), whether the student opted into the non-biometric fallback flow                                               | N/A (no biometric content, just metadata)                                 | Student (own row only), server                                                 |
| `biometric_withdrawals`                   | Audit trail of erasures: who, when, why (user-initiated or `retention_period_expired` from the automated job)                                                                                                          | N/A                                                                       | Server only                                                                    |
| `device_fingerprints`                     | Hashed device fingerprints tied to a student, used for the multi-student-per-device anti-proxy check                                                                                                                   | Hashed, not raw                                                           | Student (own rows), server                                                     |
| `webauthn_credentials`                    | Public keys and signature counters for registered platform authenticators (Face ID/Touch ID/etc.) — **not** biometric data itself; the actual biometric match happens inside the user's own device and never leaves it | Public key only (not sensitive; private key never leaves the device)      | Server only                                                                    |
| `attendance_ledger` / `attendance_events` | Check-in decisions, similarity scores, IP addresses, device fingerprint hashes, geolocation coordinates                                                                                                                | No                                                                        | Student (own rows), teacher (own course sessions), admin                       |

What is genuinely sensitive and irreversible if leaked: the contents of
`face_embeddings`. Everything else is either non-biometric metadata or, for
`device_fingerprints`, a one-way hash.

**Minors:** many students at a given institution may be under 18 depending on
jurisdiction and program (e.g., dual-enrollment high schoolers, some
undergraduate cohorts). This system does not currently distinguish minor from
adult students anywhere in the schema or consent flow — the same biometric
consent and retention rules apply to everyone. If your institution enrolls
minors, additional requirements likely apply (parental/guardian consent under
FERPA and many state laws, COPPA if under 13 in the US, DPDP's specific
provisions for children in India) that this system does not currently
implement as a distinct path. Flagging this explicitly rather than letting the
uniform-consent-flow imply it's been handled — it hasn't.

## 2. Retention period and the automated deletion job

- `biometric_consent.retention_until` is set at consent time (the value itself
  is chosen by whatever collected consent — this system doesn't hardcode a
  retention period; check your enrollment flow's consent copy for what
  students were actually told).
- As of 2026-07-25, `20260725150000_biometric_retention_job.sql` adds a
  Postgres function, `enforce_biometric_retention()`, that erases
  `face_embeddings` for any student whose `retention_until` has passed, marks
  their consent as withdrawn, and logs the erasure to `biometric_withdrawals`
  with reason `retention_period_expired`. **Before this migration, nothing
  read `retention_until` back — it was collected but never enforced.**
- It's scheduled via `pg_cron` to run daily, with a fallback admin-callable
  server function (`runBiometricRetentionSweep`) for environments where
  `pg_cron` isn't available or you'd rather trigger it externally.
- **What this doesn't cover:** `attendance_ledger`/`attendance_events` rows
  (check-in history, similarity scores) are not touched by this job — they're
  append-only audit records, kept indefinitely by design (see README's
  Throttling & Audit Ledger section). If your retention policy requires
  deleting attendance _history_, not just biometric templates, after some
  period, that's separate, unimplemented work — decide and document the
  distinction between "biometric template retention" (now enforced) and
  "attendance record retention" (an institutional records-retention policy
  question, likely governed by different rules than biometric data
  specifically).

## 3. Right-to-erasure workflow

Two paths exist:

1. **Student-initiated** (`withdrawBiometric` in `admin.functions.ts`,
   reachable from the enrollment page): deletes the student's
   `face_embeddings` row immediately, marks `biometric_consent.withdrawn_at`,
   and logs to `biometric_withdrawals` with the student's stated reason (or
   none). This has existed since before this hardening session.
2. **Automatic, time-based** (`enforce_biometric_retention()`, above, added
   this session): the same effect, triggered by `retention_until` passing
   rather than a student action.

Both leave the student's account, roles, attendance history, and other
records intact — only the biometric template itself is erased. If "right to
erasure" in your jurisdiction is interpreted to require deleting the
attendance history too on request, that's not what either path does today;
that would need a separate, explicit account-deletion workflow, which doesn't
exist in this system.

## 4. Framework-specific notes

### FERPA (US)

Face embeddings and attendance records are "education records" under FERPA
once tied to an identifiable student. Relevant points to have counsel confirm:

- Whether your use case falls under an existing FERPA exception (school
  officials with legitimate educational interest) or needs separate written
  consent — this varies by whether attendance data is used only internally.
- Directory information rules don't obviously apply to biometric templates;
  treat them as sensitive, non-directory records.
- Parent/eligible-student access and amendment rights apply to whatever
  records this system produces (attendance decisions, consent status) —
  there's no built-in FERPA-specific access-request workflow here beyond the
  student's own dashboard views.

### DPDP Act 2023 (India)

Given the Razorpay integration and INR-oriented payroll defaults, this system
appears built with an Indian institution in mind, so DPDP is likely the most
directly relevant framework:

- Biometric data is "personal data" under the Act; face embeddings, being
  used to uniquely identify a person, warrant treating consent and purpose
  limitation carefully even though the Act doesn't have a GDPR-style special
  category regime.
- Consent must be free, specific, informed, unconditional, and unambiguous,
  with a clear affirmative action — confirm the actual consent-collection UI
  text (not audited as part of this session) meets that bar, and that
  withdrawal is as easy as granting (the `withdrawBiometric` flow gives
  a functional withdrawal path; whether its UI/copy meets the "as easy as"
  standard wasn't reviewed here).
- Data principal rights (access, correction, erasure, grievance redressal)
  need a designated contact/process — this system provides withdrawal and
  self-view functionality but no formal grievance-officer workflow.
- If your institution qualifies as a Significant Data Fiduciary (thresholds
  set by the central government under the Act), additional obligations
  apply (DPIA, data auditor, etc.) that are entirely outside this system's
  scope to satisfy in code.

### GDPR (EU, if applicable)

Only relevant if the institution has EU students/staff or otherwise falls
under GDPR's territorial scope. If so:

- Face embeddings are biometric data processed "for the purpose of uniquely
  identifying a natural person" — special category data under Article 9,
  requiring explicit consent (or another Article 9(2) basis) on top of the
  general Article 6 basis.
- A Data Protection Impact Assessment (DPIA) is very likely required before
  deploying biometric identification at this scale — not done as part of
  this session, and not something a code change can substitute for.
- Right to erasure (Article 17) and data portability (Article 20) — erasure
  is covered per Section 3 above; portability (giving a student their own
  data in a machine-readable format) is not implemented.

## 5. Data processing agreement (DPA) — outline for institutions

If Presence is operated by a vendor on behalf of an institution (rather than
the institution self-hosting it), a DPA between vendor and institution should
cover at minimum:

1. **Roles:** which party is the data controller/fiduciary and which is the
   processor, for each data category in the table above.
2. **Scope and purpose:** biometric data processed solely for attendance
   identity verification; no secondary use (e.g., no training of third-party
   models on collected embeddings, no sale/sharing).
3. **Subprocessors:** list any third parties data flows through —
   Supabase (database/auth/storage), Razorpay (payment data only, not
   biometric), Resend (email), any SMS provider (Twilio/MSG91/Gupshup per
   `notifications.server.ts`), and the hosting platform (Cloudflare Workers,
   per `wrangler.json`, if deployed there). Confirm each has its own adequate
   data processing terms for the categories of data they touch.
4. **Retention and deletion:** reference Sections 2-3 above; specify the
   actual `retention_until` policy the institution has configured, and confirm
   the automated job (Section 2) is running (check `cron.job` in the Supabase
   dashboard, or confirm the external scheduler calling
   `runBiometricRetentionSweep` is actually configured — an unscheduled job is
   silently a no-op).
5. **Breach notification:** timeline and process for notifying the
   institution if `face_embeddings`, `BIOMETRIC_ENC_KEY`, or
   `SUPABASE_SERVICE_ROLE_KEY` are ever compromised. Not automated by this
   system — needs an operational incident-response process outside of code.
6. **Data location:** confirm which Supabase region hosts the project, and
   whether that satisfies any data-residency requirements (relevant
   particularly for DPDP's cross-border transfer provisions).
7. **Audit rights:** the institution's right to request evidence of the
   controls described in this document and `README.md`'s Security
   Architecture section.
8. **Cross-border transfer:** if the institution and vendor/hosting are in
   different jurisdictions, confirm the applicable transfer mechanism (DPDP's
   government-notified restricted-country list, GDPR SCCs, etc.) — a code
   review can't determine this; it depends on where the Supabase project and
   institution actually are.

This outline is a starting checklist, not a signable document — actual DPA
language should come from counsel, informed by the technical facts in
Sections 1-4 above.
