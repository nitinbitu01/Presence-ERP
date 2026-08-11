# Multi-Region High Availability & Disaster Recovery Runbook

## Presence ERP — Resilience & Failover Architecture

**Version:** 1.0  
**RPO SLA:** < 1 minute (Recovery Point Objective)  
**RTO SLA:** < 5 minutes (Recovery Time Objective)

---

## 1. Multi-Region Architecture Topology

```
┌─────────────────────────────────────────────────────────────┐
│                    Cloudflare Anycast DNS                    │
│                      (Edge Global Network)                   │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
               ▼                              ▼
┌──────────────────────────────┐┌──────────────────────────────┐
│  Region 1: Primary (Mumbai)  ││ Region 2: Secondary (Singapore)
│  - Cloudflare Pages Worker   ││ - Cloudflare Pages Worker    │
│  - Supabase Primary DB (ap-south-1)││ - Supabase Read-Replica    │
└──────────────┬───────────────┘└──────────────┬───────────────┘
               │                               │
               └───────────────┬───────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│               Automated Cross-Region Failover               │
│                (Healthcheck probe interval: 10s)             │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Failover Trigger Conditions & SLA Matrix

| Failure Scenario             | Automatic Action                                                      | RPO      | RTO     |
| ---------------------------- | --------------------------------------------------------------------- | -------- | ------- |
| Region 1 Worker Outage       | Cloudflare Anycast re-routes traffic to Region 2 Worker               | 0 sec    | < 2 sec |
| Primary Database Degradation | Read traffic shifted to Secondary Replica; Circuit Breaker trips OPEN | < 10 sec | < 5 sec |
| Complete Regional Outage     | Automated promotion of Read-Replica to Primary via Supabase CLI       | < 1 min  | < 5 min |

---

## 3. Disaster Recovery Execution Steps (Automated Drill)

### Step 1: Healthcheck Monitor Detection

The monitoring probe checks `GET /api/health` every 10 seconds. If 3 consecutive probes fail:

```bash
# Verify Primary Health Endpoint
curl -i https://rru-presence.pages.dev/api/health
```

### Step 2: Trigger Circuit Breaker

If the database primary is degraded, the circuit breaker state machine (`chaos-resilience.server.ts`) automatically transitions to `OPEN` and routes traffic to read-only fallback cache.

### Step 3: Promote Secondary Replica to Primary

In a catastrophic primary outage:

```bash
# Execute via Supabase CLI
supabase db failover --project-ref kdqcfhhaffsbhnmvrjmt --target-region ap-southeast-1
```

### Step 4: Post-Failover Verification

Run verification suite to confirm full write capability on the new primary:

```bash
npx tsc --noEmit
npx vitest run
```

---

## 4. Backup & Point-in-Time Recovery (PITR) Policy

- **WAL Archiving**: Continuous Write-Ahead Log (WAL) archiving to S3 bucket every 60 seconds.
- **Daily Snapshots**: Automated full database snapshots taken daily at 02:00 UTC with 30-day retention.
- **Biometric Encryption Keys**: Keys backed up in AWS KMS / HashiCorp Vault across 3 availability zones.
