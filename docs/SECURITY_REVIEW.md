# Internal Security Architecture & Threat Model Assessment

**System**: Presence ERP (Proof-of-Presence Architecture v8.0)  
**Assessment Date**: August 2026  
**Document Status**: Internal Self-Assessment & Zero-Trust Threat Model (Pre-Counsel Review)  
**Target Compliance Frameworks**: DPDP Act 2023 (India), ISO/IEC 27001:2022 (A.8.24 Cryptography), GDPR (Art. 32 Technical Measures)

---

## 1. Executive Summary & Scope

This document provides a technical self-assessment of the security controls, biometric privacy guarantees, and threat mitigations implemented across Presence ERP.

> [!IMPORTANT]
> **Audit Status Clarification**:
> This document represents an **internal engineering security evaluation** and threat model. Formal third-party penetration testing and independent auditor sign-off are scheduled prior to full multi-campus production deployment.

---

## 2. Threat Modeling & Attack Surface Analysis

| Threat Vectors | Risk Level | Implemented Mitigation | Verification Mechanism |
| :--- | :--- | :--- | :--- |
| **2D Presentation Attack (Photo/Screen Spoofing)** | High | Multi-frame 3D depth variance, screen Moiré lattice analysis, blink kinetics | `analyzeFacialDepthMap()`, `detectScreenMoirePattern()` |
| **API Replay / Attendance Fraud** | High | Dynamic liveness action challenges with HMAC-SHA256 signatures, single-use state nonces | `generateLivenessActionSequence()`, `verifyActionSequenceTimestamps()` |
| **Database Ledger Tampering** | Medium | Cryptographic SHA-256 hash chaining on `attendance_ledger` with append-only triggers | `verifyLedgerChain()`, DB trigger `attendance_ledger_compute_hash()` |
| **PKCE / OAuth Code Hijacking** | High | True SHA-256 base64url PKCE `S256` code challenge digest | `computePkceS256CodeChallenge()` |
| **Biometric Template Leakage** | Critical | AES-256-GCM field-level encryption with versioned master keys & automated re-encryption | `encryptEmbedding()`, `reencryptBiometricDataJob()` |
| **Bootstrap Authorization Hijacking** | Medium | Rate-limited `claimBootstrapAdmin` with `BOOTSTRAP_ADMIN_EMAIL` verification | Rate limiting (5 req/hr), `checkRateLimit()` |

---

## 3. Cryptographic Implementation Details

1. **PKCE S256 Code Challenge**:
   Computes `base64url(SHA-256(code_verifier))` using `crypto.subtle.digest("SHA-256")` as defined in RFC 7636 Section 4.2.
2. **Biometric Template Encryption**:
   Raw 128-dimensional facial feature vectors are serialized and encrypted using AES-256-GCM before database insertion. Raw biometrics are never stored in plain text.
3. **Tamper-Evident Ledger Chaining**:
   Each row in `attendance_ledger` includes `record_hash = SHA-256(prev_hash | session_id | student_id | decision | trust_score | timestamp)`.

---

## 4. Operational Risk & Ongoing Hardening Roadmap

- **External Pen-Testing**: Engaging CERT-In empanelled auditing agency for third-party blackbox and greybox penetration testing.
- **KMS Vault Integration**: Migrating master key material (`BIOMETRIC_ENC_KEY`, `LIVENESS_HMAC_KEY`) from Cloudflare Workers secret bindings to AWS KMS / HashiCorp Vault.
- **Hardware Token Attestation**: Enforcing FIDO2 WebAuthn hardware key binding (`WEBAUTHN_POLICY=mandatory`).

---

*Last Updated: August 2026 by Presence ERP Engineering Security Team*
