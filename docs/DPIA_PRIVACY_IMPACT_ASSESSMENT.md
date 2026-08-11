# Data Protection Impact Assessment (DPIA)
## Presence ERP — Biometric & Personal Data Processing

**Date:** 2026-08-01  
**Framework Compliance:** India DPDP Act 2023 (Digital Personal Data Protection) & EU GDPR Article 35  
**Data Controller:** Educational Institution / University  
**Data Processor:** Presence ERP Platform Engine

---

## 1. Biometric Data Processing & Storage Security

- **No Raw Photo Storage**: Raw facial camera frames are processed in-memory client-side/server-side and converted to 128D mathematical embedding vectors.
- **AES-256-GCM Encryption at Rest**: Embedding vectors are encrypted with per-user salt keys via `encryptEmbedding` prior to PostgreSQL database insertion.
- **Mandatory Consent Lifecycle**: Users must explicitly accept biometric processing terms (`saveEnrollment`). Consent records track policy version, timestamp, and optional retention period (default 365 days).
- **Automated Biometric Retention Purge (`biometric-retention-policy.server.ts`)**: Automated background job purges biometric vectors and facial logs older than the institution's retention threshold.

---

## 2. Data Subject Rights (DPDP / GDPR)

| Data Subject Right | Implementation Mechanism | SLA |
|---|---|---|
| **Right to Access (SAR)** | `exportDataSubjectRecords` server function generates JSON/CSV data export | < 24 hours |
| **Right to Erasure / Right to be Forgotten** | `purgeStudentBiometricData` deletes all embeddings, photo ciphers, and logs | Instant |
| **Right to Correction** | `updateStudentProfile` updates profile attributes and roll number mappings | Instant |
| **Consent Withdrawal** | `revokeBiometricConsent` marks consent inactive and queues immediate vector wipe | Instant |
