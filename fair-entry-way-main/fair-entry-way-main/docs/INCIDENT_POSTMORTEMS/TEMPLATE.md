# Incident Post-Mortem Template

> This is a **blameless** post-mortem. The goal is to understand what happened
> and permanently prevent recurrence — not to assign blame.

## Incident Metadata

| Field                  | Value                                  |
| ---------------------- | -------------------------------------- |
| **Incident ID**        | INC-YYYY-NNN                           |
| **Date**               | YYYY-MM-DD                             |
| **Severity**           | P1 / P2 / P3 / P4                      |
| **Duration**           | HH:MM                                  |
| **Systems Affected**   | e.g. Check-in API, Notification Engine |
| **Incident Commander** | @name                                  |
| **Reviewers**          | @name1, @name2                         |

## Executive Summary

_One paragraph: what happened, impact, and what fixed it._

## Impact Assessment

- **Users affected:** N students / N teachers / N admins
- **Data loss:** Yes / No / Partial
- **SLA breach:** Yes / No (target: 99.9% uptime during 08:00–20:00 IST)
- **Regulatory exposure:** Yes / No (DPDP Act 2023 72-hour notification requirement)

## Timeline

| Time (IST) | Event                        |
| ---------- | ---------------------------- |
| HH:MM      | Detection: first alert fired |
| HH:MM      | On-call engineer paged       |
| HH:MM      | Root cause identified        |
| HH:MM      | Mitigation applied           |
| HH:MM      | Full service restored        |

## Root Cause Analysis

_Describe the technical root cause. Use the 5-Whys framework:_

1. **Why** did the system fail? → _answer_
2. **Why** did that happen? → _answer_
3. **Why** did that happen? → _answer_
4. **Why** did that happen? → _answer_
5. **Why** did that happen? → _answer (root cause)_

## Contributing Factors

- Factor 1
- Factor 2

## What Went Well

- Detection was fast (< X minutes)
- Runbooks were available

## Action Items

| Action               | Owner     | Priority | Due Date   | Status  |
| -------------------- | --------- | -------- | ---------- | ------- |
| Fix root cause       | @engineer | P1       | YYYY-MM-DD | ❌ Open |
| Add monitoring alert | @infra    | P2       | YYYY-MM-DD | ❌ Open |
| Update runbook       | @oncall   | P3       | YYYY-MM-DD | ❌ Open |

## Lessons Learned

_What did this incident teach us about our system, process, or culture?_
