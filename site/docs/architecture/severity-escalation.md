---
id: severity-escalation
title: Severity Escalation
sidebar_label: Severity Escalation
sidebar_position: 4
description: How individual ECO dimension failures combine to force lane escalation and pipeline gates.
---

<span class="u-eyebrow">Architecture · Intent & ECO</span>

# Severity Escalation

Dimension failures **compose** into a task-level severity that forces lane escalation. The final lane is always `max(eco_forced_min, analyst_override)`.

---

## Escalation Matrix

| ECO state | Forced minimum lane | Notes |
|-----------|--------------------|----|
| All dimensions OK | A | Default — most commits |
| Any dimension at `warn` | A | Penalty applied, lane unchanged |
| Any dimension at `escalate` | B | Analyst notified |
| Any dimension at `block` | C | Human gate required |
| 2+ dimensions at `escalate` | C | Compound escalation |
| Coverage `block` + Graph `block` | C + pipeline halt | Insufficient evidence |

---

## Escalation is a Floor

Escalation can only **raise** the lane — it can never lower it. A task the analyst manually classified as Lane C stays in Lane C even if all ECO dimensions are OK.

```
final_lane = max(eco_forced_minimum, analyst_override, default_lane)
```

---

## Notification Behaviour

| Severity | Developer notification | Analyst notification |
|----------|----------------------|---------------------|
| warn | None (silent) | None |
| escalate | In-terminal warning | Yes — queue entry |
| block | Blocking error + reason | Yes — priority |

---

## Recovery

Escalated tasks can recover without manual intervention if the root cause is fixed:
- **Freshness escalation** — resolves after `nirnex index` catches up to HEAD
- **Coverage escalation** — resolves after missing modules are indexed
- **Conflict escalation** — requires manual conflict resolution or source override
- **Mapping block** — requires fixing the spec reference or creating the missing module
