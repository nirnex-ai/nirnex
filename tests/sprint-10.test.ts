/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Nirnex — Sprint 10 Test Suite
 * Stage Machine: Determinism + Enforcement
 *
 * TDD test suite written before implementation.
 * All tests must FAIL until implementation is complete.
 *
 * Tests every unit and integration point:
 *   1.  StageRegistry     — STAGES const, ordering, immutability, no duplicates
 *   2.  Validators        — valid/invalid shapes per stage (input + output)
 *   3.  StageExecutor     — validate → call handler → validate output → trace
 *   4.  Failure semantics — BLOCK stops pipeline, ESCALATE flags, DEGRADE continues
 *   5.  Orchestrator      — runs STAGES in order, stops on BLOCK, collects traces
 *   6.  TraceBinder       — deterministic hash, all required trace record fields
 *   7.  LaneClassifier    — P1 forced > P2 ECO dims > P3 warnings > P4 composite
 *   8.  StrategySelector  — intent→default, permitted overrides, never-permitted blocks
 *
 * Design constraints (enforced by tests):
 *   - STAGES const is readonly and defines canonical ordering
 *   - Same input → same stage output (determinism enforced at boundary)
 *   - BLOCK failure must halt pipeline; no stages after it run
 *   - DEGRADE failure must run next stage with fallback output
 *   - ESCALATE failure must run next stage with escalation flag set
 *   - Validators are structural (no Zod), pure functions
 *   - LaneClassifier P1 always wins over P2-P4
 *   - StrategySelector must reject never-permitted combos even if caller requests them
 */

import { describe, it, expect } from "vitest";

// ─── Imports under test ──────────────────────────────────────────────────────
// These imports WILL FAIL until the pipeline module is implemented.
// That is intentional — TDD red phase.

import {
  STAGES,
  type StageId,
  type StageResult,
  type FailureMode,
} from "../packages/core/src/pipeline/types.js";

import {
  validateIntentDetectInput,
  validateIntentDetectOutput,
  validateEcoBuildInput,
  validateEcoBuildOutput,
  validateSufficiencyGateInput,
  validateSufficiencyGateOutput,
  validateTeeBuildInput,
  validateTeeBuildOutput,
  validateClassifyLaneInput,
  validateClassifyLaneOutput,
} from "../packages/core/src/pipeline/validators.js";

import {
  FAILURE_POLICY,
  applyFailureMode,
} from "../packages/core/src/pipeline/failure-policy.js";

import {
  bindTrace,
  hashInputs,
  type BoundTrace,
} from "../packages/core/src/pipeline/trace-binder.js";

import {
  StageExecutor,
} from "../packages/core/src/pipeline/stage-executor.js";

import {
  runOrchestrator,
  type OrchestratorResult,
} from "../packages/core/src/pipeline/orchestrator.js";

import {
  classifyLane,
  type LaneDecision,
} from "../packages/core/src/lane.js";

import {
  selectStrategy,
  STRATEGY_DEFAULTS,
  NEVER_PERMITTED,
  type StrategyDecision,
} from "../packages/core/src/strategy.js";

// ═════════════════════════════════════════════════════════════════════════════
// 1. StageRegistry — STAGES const
// ═════════════════════════════════════════════════════════════════════════════

describe("StageRegistry", () => {
  it("STAGES is a readonly tuple with exactly 5 entries", () => {
    expect(STAGES).toHaveLength(5);
    // Ensure it's frozen / non-writable
    const attempt = () => { (STAGES as any)[0] = "HACKED"; };
    expect(attempt).toThrow();
  });

  it("STAGES contains the canonical stage IDs in correct order", () => {
    expect(STAGES[0]).toBe("INTENT_DETECT");
    expect(STAGES[1]).toBe("ECO_BUILD");
    expect(STAGES[2]).toBe("SUFFICIENCY_GATE");
    expect(STAGES[3]).toBe("TEE_BUILD");
    expect(STAGES[4]).toBe("CLASSIFY_LANE");
  });

  it("STAGES has no duplicate entries", () => {
    const unique = new Set(STAGES);
    expect(unique.size).toBe(STAGES.length);
  });

  it("StageId type includes all 5 canonical stage names", () => {
    const ids: StageId[] = [
      "INTENT_DETECT",
      "ECO_BUILD",
      "SUFFICIENCY_GATE",
      "TEE_BUILD",
      "CLASSIFY_LANE",
    ];
    // Type-level check — just verify the array can be typed
    expect(ids).toHaveLength(5);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Validators — structural input/output validation (no Zod)
// ═════════════════════════════════════════════════════════════════════════════

describe("Validators — INTENT_DETECT", () => {
  it("accepts valid input: specPath string or null, optional query string", () => {
    expect(validateIntentDetectInput({ specPath: null, query: "fix bug" }).valid).toBe(true);
    expect(validateIntentDetectInput({ specPath: "/some/spec.md" }).valid).toBe(true);
  });

  it("rejects input with wrong types", () => {
    expect(validateIntentDetectInput({ specPath: 42 }).valid).toBe(false);
    expect(validateIntentDetectInput(null).valid).toBe(false);
    expect(validateIntentDetectInput(undefined).valid).toBe(false);
  });

  it("accepts valid output: intent object with primary string", () => {
    expect(validateIntentDetectOutput({ primary: "bug_fix", composite: false }).valid).toBe(true);
    expect(validateIntentDetectOutput({ primary: "new_feature", composite: true, secondary: "refactor" }).valid).toBe(true);
  });

  it("rejects output without primary", () => {
    expect(validateIntentDetectOutput({}).valid).toBe(false);
    expect(validateIntentDetectOutput({ composite: false }).valid).toBe(false);
  });
});

describe("Validators — ECO_BUILD", () => {
  it("accepts valid input: intent object with primary and optional specPath", () => {
    expect(validateEcoBuildInput({ intent: { primary: "bug_fix", composite: false }, specPath: null }).valid).toBe(true);
  });

  it("rejects input missing intent", () => {
    expect(validateEcoBuildInput({ specPath: null }).valid).toBe(false);
    expect(validateEcoBuildInput({}).valid).toBe(false);
  });

  it("accepts valid output: eco object with required ECO fields", () => {
    const minimalEco = {
      intent: { primary: "bug_fix", composite: false },
      eco_dimensions: {
        coverage: { severity: "pass" },
        freshness: { severity: "pass" },
        mapping: { severity: "pass" },
        conflict: { severity: "pass" },
        graph: { severity: "pass" },
      },
      confidence_score: 80,
    };
    expect(validateEcoBuildOutput(minimalEco).valid).toBe(true);
  });

  it("rejects output missing eco_dimensions", () => {
    expect(validateEcoBuildOutput({ intent: { primary: "bug_fix" }, confidence_score: 80 }).valid).toBe(false);
  });
});

describe("Validators — SUFFICIENCY_GATE", () => {
  it("accepts valid input: eco with confidence_score and eco_dimensions", () => {
    const eco = {
      confidence_score: 80,
      eco_dimensions: {
        coverage: { severity: "pass" },
        freshness: { severity: "pass" },
        mapping: { severity: "pass" },
        conflict: { severity: "pass" },
        graph: { severity: "pass" },
      },
    };
    expect(validateSufficiencyGateInput(eco).valid).toBe(true);
  });

  it("rejects input missing confidence_score", () => {
    expect(validateSufficiencyGateInput({ eco_dimensions: {} }).valid).toBe(false);
  });

  it("accepts valid output: gate decision with behavior and lane", () => {
    expect(validateSufficiencyGateOutput({ behavior: "pass", lane: "A", reason: "ok" }).valid).toBe(true);
    expect(validateSufficiencyGateOutput({ behavior: "block", lane: "E", reason: "blocked" }).valid).toBe(true);
  });

  it("rejects output missing behavior", () => {
    expect(validateSufficiencyGateOutput({ lane: "A" }).valid).toBe(false);
  });
});

describe("Validators — TEE_BUILD", () => {
  it("accepts valid input: eco and gate decision", () => {
    const input = {
      eco: { intent: { primary: "bug_fix" }, eco_dimensions: {} },
      gate: { behavior: "pass", lane: "A", reason: "ok" },
    };
    expect(validateTeeBuildInput(input).valid).toBe(true);
  });

  it("rejects input missing eco or gate", () => {
    expect(validateTeeBuildInput({ eco: {} }).valid).toBe(false);
    expect(validateTeeBuildInput({ gate: {} }).valid).toBe(false);
    expect(validateTeeBuildInput({}).valid).toBe(false);
  });

  it("accepts valid output: tee with required sections", () => {
    const tee = {
      blocked_paths: [],
      blocked_symbols: [],
      clarification_questions: [],
      proceed_warnings: [],
    };
    expect(validateTeeBuildOutput(tee).valid).toBe(true);
  });

  it("rejects output missing blocked_paths", () => {
    expect(validateTeeBuildOutput({ blocked_symbols: [], clarification_questions: [], proceed_warnings: [] }).valid).toBe(false);
  });
});

describe("Validators — CLASSIFY_LANE", () => {
  it("accepts valid input: eco and tee", () => {
    const input = {
      eco: {
        forced_lane_minimum: "A",
        forced_unknown: false,
        critical_path_hit: false,
        eco_dimensions: { coverage: { severity: "pass" }, freshness: { severity: "pass" }, mapping: { severity: "pass" }, conflict: { severity: "pass" }, graph: { severity: "pass" } },
        boundary_warnings: [],
        intent: { primary: "bug_fix", composite: false },
      },
      tee: { blocked_paths: [], blocked_symbols: [], clarification_questions: [], proceed_warnings: [] },
    };
    expect(validateClassifyLaneInput(input).valid).toBe(true);
  });

  it("rejects input missing eco or tee", () => {
    expect(validateClassifyLaneInput({ eco: {} }).valid).toBe(false);
  });

  it("accepts valid output: lane decision with lane and set_by", () => {
    expect(validateClassifyLaneOutput({ lane: "B", set_by: "P2", reason: "escalated" }).valid).toBe(true);
  });

  it("rejects output without lane or set_by", () => {
    expect(validateClassifyLaneOutput({ lane: "A" }).valid).toBe(false);
    expect(validateClassifyLaneOutput({ set_by: "P1" }).valid).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Failure Policy
// ═════════════════════════════════════════════════════════════════════════════

describe("FailurePolicy", () => {
  it("FAILURE_POLICY maps INTENT_DETECT to DEGRADE", () => {
    expect(FAILURE_POLICY["INTENT_DETECT"]).toBe("DEGRADE");
  });

  it("FAILURE_POLICY maps ECO_BUILD to ESCALATE", () => {
    expect(FAILURE_POLICY["ECO_BUILD"]).toBe("ESCALATE");
  });

  it("FAILURE_POLICY maps SUFFICIENCY_GATE to BLOCK", () => {
    expect(FAILURE_POLICY["SUFFICIENCY_GATE"]).toBe("BLOCK");
  });

  it("FAILURE_POLICY maps TEE_BUILD to DEGRADE", () => {
    expect(FAILURE_POLICY["TEE_BUILD"]).toBe("DEGRADE");
  });

  it("FAILURE_POLICY maps CLASSIFY_LANE to ESCALATE", () => {
    expect(FAILURE_POLICY["CLASSIFY_LANE"]).toBe("ESCALATE");
  });

  it("applyFailureMode BLOCK returns blocked StageResult", () => {
    const error = new Error("validation failed");
    const result = applyFailureMode("BLOCK", "SUFFICIENCY_GATE", error);
    expect(result.status).toBe("blocked");
    expect(result.error).toBeDefined();
    expect(result.output).toBeUndefined();
  });

  it("applyFailureMode ESCALATE returns escalated StageResult with fallback output", () => {
    const error = new Error("eco build failed");
    const fallback = { eco_dimensions: {}, confidence_score: 50 };
    const result = applyFailureMode("ESCALATE", "ECO_BUILD", error, fallback);
    expect(result.status).toBe("escalated");
    expect(result.output).toEqual(fallback);
    expect(result.error).toBeDefined();
  });

  it("applyFailureMode DEGRADE returns degraded StageResult with fallback output", () => {
    const error = new Error("intent detection failed");
    const fallback = { primary: "unknown", composite: false };
    const result = applyFailureMode("DEGRADE", "INTENT_DETECT", error, fallback);
    expect(result.status).toBe("degraded");
    expect(result.output).toEqual(fallback);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. TraceBinder
// ═════════════════════════════════════════════════════════════════════════════

describe("TraceBinder", () => {
  it("hashInputs returns a stable string for the same input", () => {
    const input = { specPath: "/spec.md", query: "fix bug" };
    const h1 = hashInputs(input);
    const h2 = hashInputs(input);
    expect(h1).toBe(h2);
    expect(typeof h1).toBe("string");
    expect(h1.length).toBeGreaterThan(0);
  });

  it("hashInputs returns different hashes for different inputs", () => {
    const h1 = hashInputs({ specPath: "/a.md" });
    const h2 = hashInputs({ specPath: "/b.md" });
    expect(h1).not.toBe(h2);
  });

  it("bindTrace returns a BoundTrace with required fields", () => {
    const trace = bindTrace("INTENT_DETECT", { specPath: null }, { primary: "bug_fix", composite: false }, "ok");
    expect(trace.stage).toBe("INTENT_DETECT");
    expect(trace.status).toBe("ok");
    expect(trace.inputHash).toBeDefined();
    expect(trace.timestamp).toBeDefined();
    expect(trace.durationMs).toBeGreaterThanOrEqual(0);
    expect(trace.input).toBeDefined();
    expect(trace.output).toBeDefined();
  });

  it("bindTrace with error status includes error message", () => {
    const trace = bindTrace("ECO_BUILD", { intent: { primary: "bug_fix" } }, undefined, "blocked", new Error("gate failed"));
    expect(trace.status).toBe("blocked");
    expect(trace.errorMessage).toBeDefined();
    expect(typeof trace.errorMessage).toBe("string");
  });

  it("bindTrace timestamps are ISO 8601 strings", () => {
    const trace = bindTrace("TEE_BUILD", {}, {}, "ok");
    expect(() => new Date(trace.timestamp)).not.toThrow();
    const d = new Date(trace.timestamp);
    expect(isNaN(d.getTime())).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. StageExecutor
// ═════════════════════════════════════════════════════════════════════════════

describe("StageExecutor", () => {
  const executor = new StageExecutor();

  it("calls handler when input is valid and returns success StageResult", async () => {
    const handler = async (input: any) => ({ primary: "bug_fix", composite: false });
    const result = await executor.execute(
      "INTENT_DETECT",
      handler,
      { specPath: null, query: "fix the bug" },
      validateIntentDetectInput,
      validateIntentDetectOutput,
    );
    expect(result.status).toBe("ok");
    expect(result.output).toMatchObject({ primary: "bug_fix" });
    expect(result.trace).toBeDefined();
  });

  it("does NOT call handler when input is invalid — returns degraded/blocked result", async () => {
    let handlerCalled = false;
    const handler = async (input: any) => { handlerCalled = true; return {}; };
    const result = await executor.execute(
      "INTENT_DETECT",
      handler,
      { specPath: 999 }, // invalid — specPath must be string | null
      validateIntentDetectInput,
      validateIntentDetectOutput,
    );
    expect(handlerCalled).toBe(false);
    expect(result.status).not.toBe("ok");
  });

  it("returns failure status when output validation fails", async () => {
    const handler = async (_input: any) => ({ no_primary_field: true }); // missing primary
    const result = await executor.execute(
      "INTENT_DETECT",
      handler,
      { specPath: null },
      validateIntentDetectInput,
      validateIntentDetectOutput,
    );
    expect(result.status).not.toBe("ok");
  });

  it("applies BLOCK policy for SUFFICIENCY_GATE failures", async () => {
    const handler = async (_input: any) => ({ no_behavior: true }); // bad output
    const result = await executor.execute(
      "SUFFICIENCY_GATE",
      handler,
      { confidence_score: 80, eco_dimensions: { coverage: { severity: "pass" }, freshness: { severity: "pass" }, mapping: { severity: "pass" }, conflict: { severity: "pass" }, graph: { severity: "pass" } } },
      validateSufficiencyGateInput,
      validateSufficiencyGateOutput,
    );
    expect(result.status).toBe("blocked");
  });

  it("applies DEGRADE policy for INTENT_DETECT failures", async () => {
    const handler = async (_input: any) => ({ bad_output: true });
    const result = await executor.execute(
      "INTENT_DETECT",
      handler,
      { specPath: null },
      validateIntentDetectInput,
      validateIntentDetectOutput,
    );
    expect(result.status).toBe("degraded");
  });

  it("binds trace record on every successful execution", async () => {
    const handler = async (_input: any) => ({ primary: "refactor", composite: false });
    const result = await executor.execute(
      "INTENT_DETECT",
      handler,
      { specPath: null },
      validateIntentDetectInput,
      validateIntentDetectOutput,
    );
    expect(result.status).toBe("ok");
    expect(result.trace).toMatchObject({
      stage: "INTENT_DETECT",
      status: "ok",
      inputHash: expect.any(String),
      timestamp: expect.any(String),
      durationMs: expect.any(Number),
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. Orchestrator
// ═════════════════════════════════════════════════════════════════════════════

describe("Orchestrator", () => {
  it("runs all 5 stages in canonical STAGES order when all succeed", async () => {
    const stagesRun: string[] = [];

    const handlers: Record<string, (input: any) => Promise<any>> = {
      INTENT_DETECT: async () => { stagesRun.push("INTENT_DETECT"); return { primary: "bug_fix", composite: false }; },
      ECO_BUILD: async () => {
        stagesRun.push("ECO_BUILD");
        return {
          intent: { primary: "bug_fix", composite: false },
          eco_dimensions: { coverage: { severity: "pass" }, freshness: { severity: "pass" }, mapping: { severity: "pass" }, conflict: { severity: "pass" }, graph: { severity: "pass" } },
          confidence_score: 85,
        };
      },
      SUFFICIENCY_GATE: async () => { stagesRun.push("SUFFICIENCY_GATE"); return { behavior: "pass", lane: "A", reason: "sufficient" }; },
      TEE_BUILD: async () => { stagesRun.push("TEE_BUILD"); return { blocked_paths: [], blocked_symbols: [], clarification_questions: [], proceed_warnings: [] }; },
      CLASSIFY_LANE: async () => { stagesRun.push("CLASSIFY_LANE"); return { lane: "A", set_by: "P4", reason: "composite intent" }; },
    };

    const result: OrchestratorResult = await runOrchestrator({ specPath: null, query: "fix the timeout bug" }, handlers);

    expect(stagesRun).toEqual(["INTENT_DETECT", "ECO_BUILD", "SUFFICIENCY_GATE", "TEE_BUILD", "CLASSIFY_LANE"]);
    expect(result.completed).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.stageResults).toHaveLength(5);
  });

  it("stops pipeline at SUFFICIENCY_GATE when it returns blocked", async () => {
    const stagesRun: string[] = [];

    const handlers: Record<string, (input: any) => Promise<any>> = {
      INTENT_DETECT: async () => { stagesRun.push("INTENT_DETECT"); return { primary: "bug_fix", composite: false }; },
      ECO_BUILD: async () => {
        stagesRun.push("ECO_BUILD");
        return {
          intent: { primary: "bug_fix", composite: false },
          eco_dimensions: { coverage: { severity: "pass" }, freshness: { severity: "pass" }, mapping: { severity: "pass" }, conflict: { severity: "block" }, graph: { severity: "pass" } },
          confidence_score: 30,
        };
      },
      // SUFFICIENCY_GATE returns output that causes BLOCK
      SUFFICIENCY_GATE: async () => { stagesRun.push("SUFFICIENCY_GATE"); return { behavior: "block", lane: "E", reason: "conflict blocked" }; },
      TEE_BUILD: async () => { stagesRun.push("TEE_BUILD"); return { blocked_paths: [], blocked_symbols: [], clarification_questions: [], proceed_warnings: [] }; },
      CLASSIFY_LANE: async () => { stagesRun.push("CLASSIFY_LANE"); return { lane: "E", set_by: "P1", reason: "blocked" }; },
    };

    const result: OrchestratorResult = await runOrchestrator({ specPath: null, query: "conflicted change" }, handlers);

    // TEE_BUILD and CLASSIFY_LANE must NOT run
    expect(stagesRun).toContain("SUFFICIENCY_GATE");
    expect(stagesRun).not.toContain("TEE_BUILD");
    expect(stagesRun).not.toContain("CLASSIFY_LANE");
    expect(result.blocked).toBe(true);
    expect(result.blockedAt).toBe("SUFFICIENCY_GATE");
  });

  it("continues past ESCALATE stages with escalation flag", async () => {
    const handlers: Record<string, (input: any) => Promise<any>> = {
      INTENT_DETECT: async () => ({ primary: "bug_fix", composite: false }),
      ECO_BUILD: async () => {
        throw new Error("ECO build error — simulated failure");
      },
      SUFFICIENCY_GATE: async () => ({ behavior: "pass", lane: "A", reason: "ok" }),
      TEE_BUILD: async () => ({ blocked_paths: [], blocked_symbols: [], clarification_questions: [], proceed_warnings: [] }),
      CLASSIFY_LANE: async () => ({ lane: "A", set_by: "P4", reason: "intent" }),
    };

    const result: OrchestratorResult = await runOrchestrator({ specPath: null, query: "fix bug" }, handlers);

    // Pipeline must continue — not blocked
    expect(result.blocked).toBe(false);
    // ECO_BUILD must be escalated
    const ecoBuildResult = result.stageResults.find(r => r.stage === "ECO_BUILD");
    expect(ecoBuildResult?.status).toBe("escalated");
    // Escalation flag must be set at orchestrator level
    expect(result.escalated).toBe(true);
  });

  it("produces a trace record per stage", async () => {
    const handlers: Record<string, (input: any) => Promise<any>> = {
      INTENT_DETECT: async () => ({ primary: "bug_fix", composite: false }),
      ECO_BUILD: async () => ({
        intent: { primary: "bug_fix", composite: false },
        eco_dimensions: { coverage: { severity: "pass" }, freshness: { severity: "pass" }, mapping: { severity: "pass" }, conflict: { severity: "pass" }, graph: { severity: "pass" } },
        confidence_score: 85,
      }),
      SUFFICIENCY_GATE: async () => ({ behavior: "pass", lane: "A", reason: "ok" }),
      TEE_BUILD: async () => ({ blocked_paths: [], blocked_symbols: [], clarification_questions: [], proceed_warnings: [] }),
      CLASSIFY_LANE: async () => ({ lane: "A", set_by: "P4", reason: "intent" }),
    };

    const result: OrchestratorResult = await runOrchestrator({ specPath: null, query: "test trace" }, handlers);

    expect(result.stageResults.every(r => r.trace != null)).toBe(true);
    expect(result.stageResults.every(r => typeof r.trace!.durationMs === "number")).toBe(true);
    expect(result.stageResults.every(r => r.trace!.inputHash.length > 0)).toBe(true);
  });

  it("OrchestratorResult includes final lane and strategy from last stage", async () => {
    const handlers: Record<string, (input: any) => Promise<any>> = {
      INTENT_DETECT: async () => ({ primary: "new_feature", composite: false }),
      ECO_BUILD: async () => ({
        intent: { primary: "new_feature", composite: false },
        eco_dimensions: { coverage: { severity: "pass" }, freshness: { severity: "pass" }, mapping: { severity: "pass" }, conflict: { severity: "pass" }, graph: { severity: "pass" } },
        confidence_score: 90,
      }),
      SUFFICIENCY_GATE: async () => ({ behavior: "pass", lane: "B", reason: "ok" }),
      TEE_BUILD: async () => ({ blocked_paths: [], blocked_symbols: [], clarification_questions: [], proceed_warnings: [] }),
      CLASSIFY_LANE: async () => ({ lane: "B", set_by: "P2", reason: "eco escalate" }),
    };

    const result = await runOrchestrator({ specPath: null, query: "add feature" }, handlers);
    expect(result.finalLane).toBe("B");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. LaneClassifier — P1 > P2 > P3 > P4
// ═════════════════════════════════════════════════════════════════════════════

describe("LaneClassifier", () => {
  // ── P1 — Forced constraints ──────────────────────────────────────────────

  describe("P1 — Forced constraints", () => {
    it("forced_unknown=true → lane E, set_by P1", () => {
      const eco = makeEco({ forced_unknown: true });
      const decision = classifyLane(eco);
      expect(decision.lane).toBe("E");
      expect(decision.set_by).toBe("P1");
    });

    it("forced_lane_minimum=C overrides ECO dimension severity (P1 > P2)", () => {
      const eco = makeEco({
        forced_lane_minimum: "C",
        eco_dimensions: allPassDimensions(), // all dimensions pass → P2 would say A
      });
      const decision = classifyLane(eco);
      expect(decision.lane).toBe("C");
      expect(decision.set_by).toBe("P1");
    });

    it("critical_path_hit=true forces minimum lane C when forced_lane_minimum is A", () => {
      const eco = makeEco({
        critical_path_hit: true,
        forced_lane_minimum: "A",
        eco_dimensions: allPassDimensions(),
      });
      const decision = classifyLane(eco);
      // critical_path_hit bumps minimum to C
      expect(["C", "D", "E"]).toContain(decision.lane);
      expect(decision.set_by).toBe("P1");
    });

    it("forced_lane_minimum=B with no other signals → lane B from P1", () => {
      const eco = makeEco({ forced_lane_minimum: "B" });
      const decision = classifyLane(eco);
      expect(decision.lane >= "B").toBe(true); // can't be A
      expect(decision.set_by).toBe("P1");
    });
  });

  // ── P2 — ECO dimension severity ──────────────────────────────────────────

  describe("P2 — ECO dimension severity", () => {
    it("all dimensions pass → lane A from P4 (not escalated by P2)", () => {
      const eco = makeEco({
        forced_lane_minimum: "A",
        forced_unknown: false,
        critical_path_hit: false,
        eco_dimensions: allPassDimensions(),
        boundary_warnings: [],
        intent: { primary: "bug_fix", composite: false },
      });
      const decision = classifyLane(eco);
      // With all pass, P2 should not escalate
      expect(decision.lane).toBe("A");
    });

    it("any dimension with severity=escalate → minimum lane B from P2", () => {
      const eco = makeEco({
        forced_lane_minimum: "A",
        forced_unknown: false,
        critical_path_hit: false,
        eco_dimensions: {
          ...allPassDimensions(),
          freshness: { severity: "escalate", detail: "stale" },
        },
        boundary_warnings: [],
        intent: { primary: "bug_fix", composite: false },
      });
      const decision = classifyLane(eco);
      expect(decision.lane >= "B").toBe(true);
      expect(decision.set_by).toBe("P2");
    });

    it("any dimension with severity=block → minimum lane C from P2", () => {
      const eco = makeEco({
        forced_lane_minimum: "A",
        forced_unknown: false,
        critical_path_hit: false,
        eco_dimensions: {
          ...allPassDimensions(),
          conflict: { severity: "block", detail: "hard conflict", conflict_payload: null },
        },
        boundary_warnings: [],
        intent: { primary: "bug_fix", composite: false },
      });
      const decision = classifyLane(eco);
      expect(decision.lane >= "C").toBe(true);
      expect(decision.set_by).toBe("P2");
    });

    it("multiple dimensions escalate → still resolves via max severity", () => {
      const eco = makeEco({
        forced_lane_minimum: "A",
        forced_unknown: false,
        critical_path_hit: false,
        eco_dimensions: {
          coverage: { severity: "warn", detail: "" },
          freshness: { severity: "escalate", detail: "" },
          mapping: { severity: "pass", detail: "" },
          conflict: { severity: "escalate", detail: "", conflict_payload: null },
          graph: { severity: "pass", detail: "" },
        },
        boundary_warnings: [],
        intent: { primary: "bug_fix", composite: false },
      });
      const decision = classifyLane(eco);
      expect(decision.lane >= "B").toBe(true);
    });
  });

  // ── P3 — Warning accumulation ────────────────────────────────────────────

  describe("P3 — Warning accumulation", () => {
    it("≥3 boundary_warnings → lane bumped to minimum B", () => {
      const eco = makeEco({
        forced_lane_minimum: "A",
        forced_unknown: false,
        critical_path_hit: false,
        eco_dimensions: allPassDimensions(),
        boundary_warnings: ["w1:blocked", "w2:blocked", "w3:blocked"],
        intent: { primary: "bug_fix", composite: false },
      });
      const decision = classifyLane(eco);
      expect(decision.lane >= "B").toBe(true);
    });

    it("1 boundary_warning → no P3 bump (stays at P4 resolution)", () => {
      const eco = makeEco({
        forced_lane_minimum: "A",
        forced_unknown: false,
        critical_path_hit: false,
        eco_dimensions: allPassDimensions(),
        boundary_warnings: ["one_warning"],
        intent: { primary: "bug_fix", composite: false },
      });
      const decision = classifyLane(eco);
      // One warning should not trigger P3 — stays at A from P4
      expect(decision.lane).toBe("A");
    });
  });

  // ── P4 — Composite intent ────────────────────────────────────────────────

  describe("P4 — Composite intent", () => {
    it("non-composite intent with all-pass dimensions → lane A", () => {
      const eco = makeEco({
        forced_lane_minimum: "A",
        forced_unknown: false,
        critical_path_hit: false,
        eco_dimensions: allPassDimensions(),
        boundary_warnings: [],
        intent: { primary: "bug_fix", composite: false },
      });
      const decision = classifyLane(eco);
      expect(decision.lane).toBe("A");
      expect(decision.set_by).toBe("P4");
    });

    it("composite intent bumps lane to minimum B from P4", () => {
      const eco = makeEco({
        forced_lane_minimum: "A",
        forced_unknown: false,
        critical_path_hit: false,
        eco_dimensions: allPassDimensions(),
        boundary_warnings: [],
        intent: { primary: "bug_fix", secondary: "refactor", composite: true },
      });
      const decision = classifyLane(eco);
      expect(decision.lane >= "B").toBe(true);
      expect(decision.set_by).toBe("P4");
    });
  });

  // ── P1 dominance over all ────────────────────────────────────────────────

  it("P1 always beats P2 even when P2 would block", () => {
    const eco = makeEco({
      forced_lane_minimum: "A",
      forced_unknown: true, // P1 forces E
      critical_path_hit: false,
      eco_dimensions: allPassDimensions(), // P2 would say A
      boundary_warnings: [],
      intent: { primary: "bug_fix", composite: false },
    });
    const decision = classifyLane(eco);
    expect(decision.lane).toBe("E");
    expect(decision.set_by).toBe("P1");
  });

  it("classifyLane returns a LaneDecision with lane, set_by, and reason", () => {
    const eco = makeEco({});
    const decision = classifyLane(eco);
    expect(typeof decision.lane).toBe("string");
    expect(["A", "B", "C", "D", "E"]).toContain(decision.lane);
    expect(["P1", "P2", "P3", "P4"]).toContain(decision.set_by);
    expect(typeof decision.reason).toBe("string");
  });

  it("classifyLane is deterministic — same input yields same output", () => {
    const eco = makeEco({
      forced_lane_minimum: "A",
      forced_unknown: false,
      critical_path_hit: false,
      eco_dimensions: allPassDimensions(),
      boundary_warnings: ["w1:x", "w2:x", "w3:x"],
      intent: { primary: "refactor", composite: false },
    });
    const d1 = classifyLane(eco);
    const d2 = classifyLane(eco);
    expect(d1.lane).toBe(d2.lane);
    expect(d1.set_by).toBe(d2.set_by);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. StrategySelector
// ═════════════════════════════════════════════════════════════════════════════

describe("StrategySelector", () => {
  describe("STRATEGY_DEFAULTS — intent→default strategy mapping", () => {
    it("bug_fix defaults to 'surgical'", () => {
      const decision = selectStrategy("bug_fix");
      expect(decision.strategy).toBe("surgical");
      expect(decision.source).toBe("default");
    });

    it("new_feature defaults to 'additive'", () => {
      const decision = selectStrategy("new_feature");
      expect(decision.strategy).toBe("additive");
      expect(decision.source).toBe("default");
    });

    it("refactor defaults to 'structural'", () => {
      const decision = selectStrategy("refactor");
      expect(decision.strategy).toBe("structural");
      expect(decision.source).toBe("default");
    });

    it("dep_update defaults to 'additive'", () => {
      const decision = selectStrategy("dep_update");
      expect(decision.strategy).toBe("additive");
      expect(decision.source).toBe("default");
    });

    it("config_infra defaults to 'surgical'", () => {
      const decision = selectStrategy("config_infra");
      expect(decision.strategy).toBe("surgical");
      expect(decision.source).toBe("default");
    });

    it("unknown intent defaults to 'additive'", () => {
      const decision = selectStrategy("unknown");
      expect(decision.strategy).toBe("additive");
      expect(decision.source).toBe("default");
    });
  });

  describe("Permitted overrides", () => {
    it("bug_fix allows override to 'full_replacement' when explicitly requested", () => {
      const decision = selectStrategy("bug_fix", "full_replacement");
      // full_replacement is permitted for bug_fix (edge case — big refactor disguised as bug fix)
      expect(decision.strategy).toBe("full_replacement");
      expect(decision.source).toBe("override");
    });

    it("new_feature allows override to 'structural'", () => {
      const decision = selectStrategy("new_feature", "structural");
      expect(decision.strategy).toBe("structural");
      expect(decision.source).toBe("override");
    });
  });

  describe("NEVER_PERMITTED — rejected overrides", () => {
    it("refactor cannot use 'surgical' strategy", () => {
      // Refactor + surgical is never permitted (surgical implies minimal change, refactor implies restructuring)
      const decision = selectStrategy("refactor", "surgical");
      expect(decision.strategy).toBe("structural"); // falls back to default
      expect(decision.source).toBe("default");
      expect(decision.rejectedOverride).toBe("surgical");
      expect(decision.rejectionReason).toBeDefined();
    });

    it("config_infra cannot use 'full_replacement' strategy", () => {
      // config_infra + full_replacement is dangerous — never permit
      const decision = selectStrategy("config_infra", "full_replacement");
      expect(decision.strategy).toBe("surgical"); // falls back to default
      expect(decision.source).toBe("default");
      expect(decision.rejectedOverride).toBe("full_replacement");
    });

    it("NEVER_PERMITTED export is a record mapping intent→strategy[]", () => {
      expect(typeof NEVER_PERMITTED).toBe("object");
      // refactor should have "surgical" in its never-permitted list
      expect(NEVER_PERMITTED["refactor"]).toContain("surgical");
      // config_infra should have "full_replacement"
      expect(NEVER_PERMITTED["config_infra"]).toContain("full_replacement");
    });
  });

  describe("STRATEGY_DEFAULTS export", () => {
    it("is a record mapping intent string → strategy string", () => {
      expect(typeof STRATEGY_DEFAULTS).toBe("object");
      expect(STRATEGY_DEFAULTS["bug_fix"]).toBe("surgical");
      expect(STRATEGY_DEFAULTS["new_feature"]).toBe("additive");
      expect(STRATEGY_DEFAULTS["refactor"]).toBe("structural");
    });
  });

  describe("StrategyDecision shape", () => {
    it("selectStrategy always returns a StrategyDecision with strategy and source", () => {
      const decision: StrategyDecision = selectStrategy("bug_fix");
      expect(typeof decision.strategy).toBe("string");
      expect(["default", "override"]).toContain(decision.source);
    });

    it("selectStrategy is deterministic — same input → same output", () => {
      const d1 = selectStrategy("refactor");
      const d2 = selectStrategy("refactor");
      expect(d1.strategy).toBe(d2.strategy);
      expect(d1.source).toBe(d2.source);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Helpers
// ═════════════════════════════════════════════════════════════════════════════

function allPassDimensions() {
  return {
    coverage: { severity: "pass", detail: "" },
    freshness: { severity: "pass", detail: "" },
    mapping: { severity: "pass", detail: "" },
    conflict: { severity: "pass", detail: "", conflict_payload: null },
    graph: { severity: "pass", detail: "" },
  };
}

function makeEco(overrides: Record<string, any>) {
  return {
    forced_lane_minimum: "A",
    forced_unknown: false,
    critical_path_hit: false,
    eco_dimensions: allPassDimensions(),
    boundary_warnings: [] as string[],
    intent: { primary: "bug_fix", composite: false },
    ...overrides,
  };
}
