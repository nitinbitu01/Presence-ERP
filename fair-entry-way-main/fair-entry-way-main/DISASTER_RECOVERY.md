# Presence ERP — Disaster Recovery & Backup Runbook

## Target Service Level Objectives

- **Recovery Point Objective (RPO)**: < 1 hour (Maximum allowable data loss window)
- **Recovery Time Objective (RTO)**: < 2 hours (Maximum allowable system downtime)

---

## 1. Automated Backup Infrastructure

- **Database (PostgreSQL)**: Supabase Point-In-Time Recovery (PITR) enabled with 30-day continuous WAL archiving.
- **Biometric Embeddings & Storage**: Daily automated snapshot of Supabase Storage buckets.
- **Secrets & Configuration**: Versioned in Supabase Vault and environment secret stores.

---

## 2. Disaster Recovery Restoration Procedure (Quarterly Drill)

### Step 1: Initialize Scratch Environment

```bash
supabase projects create presence-scratch-dr
```

### Step 2: Restore Database Snapshot to Target Timestamp

```bash
supabase db restore --project-ref <SCRATCH_REF> --timestamp "2026-07-31T12:00:00Z"
```

### Step 3: Run Integrity & RLS Verification Suite

```bash
npm run verify
```

### Step 4: Validate RTO/RPO Metrics

- Document restore duration and verify database record count matches pre-incident baseline.
