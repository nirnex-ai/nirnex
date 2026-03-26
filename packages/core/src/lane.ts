/**
 * LaneClassifier — Deterministic lane classification with P1→P4 precedence
 *
 * Lanes: A (baseline) → B (elevated) → C (critical) → D (restricted) → E (blocked)
 * Higher lanes = more restrictive retrieval/planning behaviour.
 *
 * Precedence:
 *   P1 — Forced constraints (forced_unknown, forced_lane_minimum, critical_path_hit)
 *   P2 — ECO dimension severity (escalate → B, block → C)
 *   P3 — Warning accumulation (≥3 boundary_warnings → B)
 *   P4 — Composite intent (composite=true → B)
 *
 * P1 always beats P2-P4. Within the same tier, the most restrictive lane wins.
 *
 * Design constraints:
 *   - Pure function — no side effects, no I/O
 *   - Deterministic — same input → same output
 *   - Lane ordering: A < B < C < D < E (string comparison holds)
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type Lane = "A" | "B" | "C" | "D" | "E";
export type PrecedenceTier = "P1" | "P2" | "P3" | "P4";

export interface LaneDecision {
  lane: Lane;
  set_by: PrecedenceTier;
  reason: string;
}

// ─── Lane ordering ────────────────────────────────────────────────────────────

const LANE_ORDER: Lane[] = ["A", "B", "C", "D", "E"];

function maxLane(a: Lane, b: Lane): Lane {
  return LANE_ORDER.indexOf(a) >= LANE_ORDER.indexOf(b) ? a : b;
}

function atLeast(lane: Lane, minimum: Lane): Lane {
  return maxLane(lane, minimum);
}

// ─── ECO dimension severity → lane mapping ────────────────────────────────────

function severityToLane(severity: string): Lane {
  switch (severity) {
    case "block":    return "C";
    case "escalate": return "B";
    case "warn":     return "A"; // warn alone does not escalate lane
    default:         return "A";
  }
}

// ─── classifyLane ─────────────────────────────────────────────────────────────

/**
 * Classify the operational lane for the current ECO context.
 *
 * @param eco - the ECO object (or any object with the relevant fields)
 * @returns   LaneDecision with lane, set_by, and reason
 */
export function classifyLane(eco: Record<string, any>): LaneDecision {
  // ── P1 — Forced constraints ──────────────────────────────────────────────
  const forcedLaneMin: Lane = (eco.forced_lane_minimum as Lane) || "A";
  const forcedUnknown: boolean = eco.forced_unknown === true;
  const criticalPath: boolean = eco.critical_path_hit === true;

  if (forcedUnknown) {
    return { lane: "E", set_by: "P1", reason: "forced_unknown=true — mapping is 1:scattered, cannot proceed" };
  }

  let p1Lane: Lane = forcedLaneMin;
  let p1Reason = "";

  if (criticalPath) {
    const bumped = atLeast(p1Lane, "C");
    if (bumped !== p1Lane) {
      p1Lane = bumped;
      p1Reason = "critical_path_hit=true forces minimum lane C";
    } else {
      p1Reason = `critical_path_hit=true; forced_lane_minimum=${forcedLaneMin} already at ${p1Lane}`;
    }
  }

  if (p1Lane > "A" && p1Reason === "") {
    p1Reason = `forced_lane_minimum=${p1Lane}`;
  }

  // ── P2 — ECO dimension severity ───────────────────────────────────────────
  const dims = eco.eco_dimensions ?? {};
  let p2Lane: Lane = "A";
  let p2Reason = "";
  let worstDim = "";

  for (const [dimName, dim] of Object.entries(dims)) {
    if (dim && typeof dim === "object" && "severity" in (dim as object)) {
      const dimLane = severityToLane((dim as any).severity as string);
      if (dimLane > p2Lane) {
        p2Lane = dimLane;
        worstDim = dimName;
      }
    }
  }

  if (p2Lane > "A") {
    p2Reason = `eco_dimensions.${worstDim} severity triggers lane ${p2Lane}`;
  }

  // ── P3 — Warning accumulation ─────────────────────────────────────────────
  const warnings: string[] = eco.boundary_warnings ?? [];
  let p3Lane: Lane = "A";
  let p3Reason = "";

  if (warnings.length >= 3) {
    p3Lane = "B";
    p3Reason = `${warnings.length} boundary_warnings accumulate to lane B`;
  }

  // ── P4 — Composite intent ─────────────────────────────────────────────────
  const intent = eco.intent ?? {};
  let p4Lane: Lane = "A";
  let p4Reason = "non-composite intent, all dimensions pass";

  if (intent.composite === true) {
    p4Lane = "B";
    p4Reason = "composite intent requires elevated lane B";
  }

  // ── Resolution: P1 > P2 > P3 > P4 ───────────────────────────────────────
  // P1 is authoritative when it forces anything above A
  if (p1Lane > "A" || criticalPath || forcedUnknown) {
    // P1 forced something — it wins
    const finalLane = maxLane(p1Lane, "A");
    return {
      lane: finalLane,
      set_by: "P1",
      reason: p1Reason || `forced_lane_minimum=${p1Lane}`,
    };
  }

  // P2 — ECO dimension severity
  if (p2Lane > "A") {
    return { lane: p2Lane, set_by: "P2", reason: p2Reason };
  }

  // P3 — Warning accumulation
  if (p3Lane > "A") {
    return { lane: p3Lane, set_by: "P3", reason: p3Reason };
  }

  // P4 — Composite intent
  return { lane: p4Lane, set_by: "P4", reason: p4Reason };
}
