# Service Level Agreement (SLA) & Service Level Objectives (SLO)

**Target System**: Presence ERP  
**Target Uptime**: **99.9%** Availability during core academic hours (08:00 to 20:00 IST).

---

## Performance Targets (SLOs)

| Metric                      | Target Threshold | Monitoring Mechanism                    |
| :-------------------------- | :--------------- | :-------------------------------------- |
| **Check-in API Latency**    | < 2.0s p95       | Server Function APM Tracing             |
| **Biometric Match Latency** | < 500ms p95      | Cosine Similarity Benchmark             |
| **Service Availability**    | 99.9%            | Synthetic Uptime Pings (5-min interval) |
| **Database RLS Overhead**   | < 50ms per query | Supabase PostgREST Latency Monitor      |
