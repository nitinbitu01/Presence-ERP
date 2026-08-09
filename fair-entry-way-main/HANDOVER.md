# Rashtriya Raksha University (RRU) — Presence ERP Handover Document

## Overview

This document provides all operational details, setup instructions, architecture summary, and security disclosures for the **Rashtriya Raksha University (RRU)** pilot deployment of **Presence ERP**.

---

## 1. System Access & Initial Setup

### Deployed Environment URL

- **Production URL**: `https://rru-presence.pages.dev` (or your configured Cloudflare domain)
- **Authentication Portal**: `/auth`

### How to Create the Primary Administrator Account

1. Open `https://rru-presence.pages.dev/auth` in your browser.
2. Sign up with your official university email (e.g. `admin@rru.ac.in`).
3. Once logged in, navigate to `/admin`.
4. Click **"Claim Administrator Role"** on the admin bootstrap panel.
5. You are now the primary admin. You can manage roles, create departments, add courses, and view audit ledgers from the console.

---

## 2. Managing Academics & Roster Setup

1. **Departments & Semesters**:
   - Go to **Admin Console → Departments & Semesters**.
   - Create university departments (e.g. `SITA`, `SISDP`) and active academic semesters (e.g. `2026-FALL`).
2. **Programs & Courses**:
   - Go to **Teacher / Admin Console → Course Management**.
   - Assign courses to departments, semesters, and course instructors.
3. **Bulk Roster Import**:
   - Go to **Admin Console → CSV Import**.
   - Upload a CSV containing student rosters (`email`, `display_name`, `roll_no`, `department_code`, `program_code`, `current_semester`, `role`).
   - Review the preview validation and click **Commit Import** to provision accounts.

---

## 3. Secrets & Configuration Management

Environment secrets are configured in the hosting environment (Cloudflare Workers / Pages Secrets dashboard):

| Secret Name                 | Purpose                                                              |
| --------------------------- | -------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`         | Supabase project API endpoint                                        |
| `VITE_SUPABASE_ANON_KEY`    | Public client API key                                                |
| `SUPABASE_SERVICE_ROLE_KEY` | High-privilege server key (bypasses RLS for admin operations)        |
| `BIOMETRIC_ENC_KEY`         | 32-byte secret key for AES-GCM-256 face descriptor vector encryption |
| `LIVENESS_HMAC_KEY`         | Secret key for signing 60-second liveness challenge tokens           |

---

## 4. Scope & Modules Out of Scope for Version 1.0

Per the system roadmap (`docs/ERP_ROADMAP.md`), the following modules are explicitly **out of scope** for this initial pilot phase:

- Hostel Management (Module 9)
- Library Management (Module 10)
- Transport Management (Module 11)
- SSO (SAML/OIDC) & External LMS Integration (Module 14)
- Automated PDF Transcript Generation

---

## 5. Known Limitations & Security Disclosures

> [!WARNING]
> **1. Liveness Attestation Trust Gap**
> Active liveness signals (Eye Aspect Ratio, head yaw, head pitch) are currently computed on the student's browser client prior to HMAC submission. Raw camera video frames are not currently uploaded for server-side attestation. Server-side frame attestation or certified SDK integration is scheduled for post-pilot hardening.

> [!IMPORTANT]
> **2. Penetration Testing Status**
> While internal manual code review and automated RLS/privilege tests are passing, no third-party penetration test has been conducted on the live deployment. A formal third-party security assessment is recommended prior to scaling beyond the pilot group.

---

## 6. Post-Pilot Security Hardening Backlog (Phase 8)

The following items are queued for immediate post-pilot implementation:

1. Server-side liveness detection & frame attestation pipeline.
2. Mandatory-by-default WebAuthn hardware device binding for new enrollments.
3. Migration of encryption keys into a dedicated Cloudflare / AWS KMS secrets vault.
4. Extension of the structured security review methodology to Exam, Fee, and HR modules.
5. System-wide client-trust audit pass.
