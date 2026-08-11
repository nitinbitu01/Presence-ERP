# Digital Personal Data Protection (DPDP) Act 2023 Compliance Framework

**Institution**: Rashtriya Raksha University (RRU)  
**System Name**: Presence ERP  
**Nominated Data Protection Officer (DPO)**: `dpo@rru.ac.in`

---

## Statutory Principles & Technical Controls

### 1. Consent Architecture (Section 6)

- Explicit opt-in consent captured during biometric enrollment (`enroll.tsx`).
- Right to withdraw biometric processing consent at any time (`onWithdrawBiometric`).

### 2. Data Subject Rights (Sections 11–13)

- **Right to Access Data**: Implemented via `downloadMyData()` API in [`data-subject-requests.functions.ts`](file:///c:/Users/24bcscs031/Downloads/fair-entry-way-main-erp-v8/fair-entry-way-main/src/lib/data-subject-requests.functions.ts).
- **Right to Erasure**: Implemented via `requestAccountDeletion()` API.

### 3. Automated Retention & Purge Policy

- Biometric face descriptors and session probe logs are automatically deleted upon student graduation or withdrawal (`runBiometricRetentionPurge`).

### 4. 72-Hour Breach Notification Workflow

- Automated incident alerting to the DPO dashboard and CERT-In compliance queue upon detecting security threshold breaches.
