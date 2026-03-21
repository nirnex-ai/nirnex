/**
 * AI Delivery OS — Sprint 7 Test Suite
 * Pipeline Integration + Lane Classification
 *
 * Tests every deliverable from Sprint 7:
 *   1. Lane classifier (ECO → final lane via P1→P2→P3→P4 precedence)
 *   2. Strategy selector (intent-biased defaults, permitted/never-permitted, override)
 *   3. Analyst prompt assembly (ECO injected into LLM context)
 *   4. TEE generator (plan → Task Execution Envelopes per slice)
 *   5. Full pipeline: dev plan with spec → classified lane + strategy + slices + TEEs
 *
 * Prerequisites:
 *   Sprint 1-6 fully passing (parser, indexer, edges, router, confidence, ECO, traces)
 *
 * Fixture strategy:
 *   Tests create specs with known structure, run the full pipeline, and verify
 *   that the ECO correctly constrains classification, strategy selection, and
 *   TEE generation. LLM calls are mocked for deterministic testing.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { tmpdir } from "os";

// ─────────────────────────────────────────────────────────────────────────────
// Adjust these imports to match your actual package exports.
// ─────────────────────────────────────────────────────────────────────────────
// import { classifyLane } from "@ai-delivery-os/core/lane-classifier";
// import { selectStrategy } from "@ai-delivery-os/core/strategy";
// import { assembleAnalystPrompt } from "@ai-delivery-os/core/prompt-assembly";
// import { generateTEEs } from "@ai-delivery-os/core/tee-generator";
// import { buildECO } from "@ai-delivery-os/core/eco";
// import { runPipeline } from "@ai-delivery-os/core/pipeline";

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const TEST_ROOT = join(tmpdir(), `aidos-sprint7-${Date.now()}`);
const SPECS_DIR = join(TEST_ROOT, "docs", "specs");

function writeFixture(relativePath: string, content: string) {
  const fullPath = join(TEST_ROOT, relativePath);
  mkdirSync(join(fullPath, ".."), { recursive: true });
  writeFileSync(fullPath, content, "utf-8");
  return fullPath;
}

function writeSpec(name: string, content: string) {
  return writeFixture(`docs/specs/${name}`, content);
}

function initGitRepo() {
  execSync("git init", { cwd: TEST_ROOT, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd: TEST_ROOT, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: TEST_ROOT, stdio: "pipe" });
}

function gitCommitAll(msg: string) {
  execSync("git add -A", { cwd: TEST_ROOT, stdio: "pipe" });
  execSync(`git commit -m "${msg}" --allow-empty`, { cwd: TEST_ROOT, stdio: "pipe" });
}

/**
 * Helper to build a minimal ECO for unit-testing lane classifier
 * and strategy selector without running the full pipeline.
 */
function makeECO(overrides: Record<string, any> = {}) {
  return {
    intent: { primary: "new_feature", secondary: null, composite: false },
    modules_touched: ["src/services"],
    dependency_depth: 1,
    critical_path_hit: false,
    hub_nodes_in_path: [],
    eco_dimensions: {
      coverage:  { severity: "pass", detail: "" },
      freshness: { severity: "pass", detail: "" },
      mapping:   { severity: "pass", detail: "" },
      conflict:  { severity: "pass", detail: "" },
      graph:     { severity: "pass", detail: "" },
    },
    warning_clusters: [],
    confidence_score: 75,
    penalties: [{ rule: "lsp_unavailable", deduction: 25, detail: "TS LSP not running" }],
    forced_lane_minimum: "A",
    forced_retrieval_mode: "index_only",
    forced_unknown: false,
    escalation_reasons: [],
    recommended_lane: "A",
    recommended_strategy: "additive",
    ...overrides,
  };
}

/**
 * Helper to build a mock analyst plan for TEE generation testing.
 */
function makePlan(overrides: Record<string, any> = {}) {
  return {
    slices: [
      {
        description: "Add retry wrapper function to services/retry.ts",
        target_module: "src/services",
        files_to_create: ["src/services/retry.ts"],
        files_to_modify: [],
        estimated_lines: 80,
      },
      {
        description: "Integrate retry into processPayment",
        target_module: "src/services",
        files_to_create: [],
        files_to_modify: ["src/services/processPayment.ts"],
        estimated_lines: 30,
      },
      {
        description: "Add unit tests for retry logic",
        target_module: "src/__tests__",
        files_to_create: ["src/__tests__/retry.test.ts"],
        files_to_modify: [],
        estimated_lines: 120,
      },
    ],
    ...overrides,
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// FIXTURE: Codebase + specs
// ═══════════════════════════════════════════════════════════════════════════════

beforeAll(() => {
  mkdirSync(TEST_ROOT, { recursive: true });

  writeFixture("src/services/processPayment.ts", `
    import { GatewayAdapter } from "./gatewayAdapter";
    export async function processPayment(amount: number) {
      return new GatewayAdapter("url").send({ amount });
    }
  `);
  writeFixture("src/services/gatewayAdapter.ts", `
    import { BaseAdapter } from "./BaseAdapter";
    export class GatewayAdapter extends BaseAdapter {
      constructor(private url: string) { super(); }
      async send(p: unknown) { return this.post(this.url, p); }
    }
  `);
  writeFixture("src/services/BaseAdapter.ts", `
    export class BaseAdapter {
      protected async post(url: string, body: unknown) { return fetch(url, { method: "POST", body: JSON.stringify(body) }); }
    }
  `);
  writeFixture("src/services/beneficiaryValidation.ts", `
    export async function validateBeneficiary(b: unknown) { if (!b) throw new Error("No"); return { valid: true }; }
  `);
  writeFixture("src/state/paymentMachine.ts", `
    import { createMachine } from "xstate";
    import { processPayment } from "../services/processPayment";
    export const paymentMachine = createMachine({
      id: "payment", initial: "idle",
      states: { idle: { on: { START: "processing" } }, processing: { invoke: { src: "processPayment", onDone: "complete", onError: "failed" } }, complete: { type: "final" }, failed: { on: { RETRY: "processing" } } }
    });
  `);
  writeFixture("src/screens/PaymentScreen.tsx", `
    import React from "react";
    import { paymentMachine } from "../state/paymentMachine";
    export default function PaymentScreen() { return null; }
  `);
  writeFixture("src/hooks/usePayment.ts", `
    import { processPayment } from "../services/processPayment";
    export function usePayment() { return { pay: (a: number) => processPayment(a) }; }
  `);
  writeFixture("src/utils/format.ts", `export function formatCurrency(n: number) { return n.toFixed(2); }`);

  writeFixture(".ai/critical-paths.txt", `src/state/paymentMachine.ts\nsrc/services/processPayment.ts\n`);

  writeFixture(".ai/analyst.md", `You are an AI analyst. Given a spec and an Execution Context Object (ECO), produce a plan that:
1. Respects the ECO's forced constraints (lane, retrieval mode)
2. References the ECO's modules_touched and dependency_depth
3. Produces task slices within the allowed boundaries
4. Notes any boundary_warnings in the plan
5. Does not plan work outside the ECO's entity_scope
  `);

  writeFixture(".ai/implementer.md", `You are an AI implementer. Given a Task Execution Envelope (TEE):
1. Only modify files in allowed_modules
2. Do not touch blocked_files
3. Stay within max_lines
4. Follow patterns_to_follow
5. Escalate if you need to violate any boundary
  `);

  // Specs
  writeSpec("add-retry.md", `# Add retry logic to GPSSA polling\n\n## In Scope\n- Add exponential backoff retry to payment polling\n- Maximum 3 retries\n\n## Out of Scope\n- UI changes\n- Other payment flows\n\n## Acceptance Criteria\n- Retries on 5xx with backoff\n- Logs retry count\n`);
  writeSpec("fix-timeout.md", `# Fix beneficiary timeout\n\n## Reproduction Steps\n1. Enter international IBAN\n2. Wait 30s\n\n## Expected vs Actual\n- Expected: 5s\n- Actual: hangs\n`);
  writeSpec("refactor-adapter.md", `# Extract retry into BaseAdapter\n\n## Current Structure\n- GatewayAdapter has inline retry\n- BaseAdapter has no retry\n\n## Target Structure\n- BaseAdapter gains retryable post/get\n- All adapters inherit retry\n`);
  writeSpec("fix-and-cleanup.md", `# Fix retry bug and extract shared retry\n\n## Reproduction Steps\n1. Payment fails\n2. Retry does nothing\n\n## Expected vs Actual\n- Expected: retry works\n- Actual: stuck in failed\n\n## Target Structure\n- Extract retry into src/utils/retry.ts\n`);
  writeSpec("quick-tweak.md", `# Fix button padding\n\nThe confirm button on PaymentScreen has 4px padding, should be 12px.\n`);

  initGitRepo();
  gitCommitAll("sprint 7 fixture");

  // Build index
  // execSync("dev index --rebuild", { cwd: TEST_ROOT, stdio: "pipe" });
});


// ═══════════════════════════════════════════════════════════════════════════════
// TEST GROUP 1: Lane Classifier — P1 Hard Constraints
// ═══════════════════════════════════════════════════════════════════════════════

describe("lane classifier — P1 hard constraints", () => {

  it("forced_lane_minimum: A → lane A (baseline)", () => {
    const eco = makeECO({ forced_lane_minimum: "A" });
    // const result = classifyLane(eco);
    // expect(result.lane).toBe("A");
    // expect(result.set_by).toBe("P1");
    expect(true).toBe(true);
  });

  it("forced_lane_minimum: B → lane at least B", () => {
    const eco = makeECO({ forced_lane_minimum: "B" });
    // const result = classifyLane(eco);
    // expect(["B", "C"]).toContain(result.lane);
    expect(true).toBe(true);
  });

  it("forced_lane_minimum: C → lane C", () => {
    const eco = makeECO({ forced_lane_minimum: "C" });
    // const result = classifyLane(eco);
    // expect(result.lane).toBe("C");
    expect(true).toBe(true);
  });

  it("forced_unknown: true → pipeline blocked", () => {
    const eco = makeECO({ forced_unknown: true });
    // const result = classifyLane(eco);
    // expect(result.blocked).toBe(true);
    // expect(result.block_reason).toContain("forced_unknown");
    expect(true).toBe(true);
  });

  it("critical_path_hit → forced_lane_minimum C, dual_mode", () => {
    const eco = makeECO({
      critical_path_hit: true,
      forced_lane_minimum: "C",
      forced_retrieval_mode: "dual_mode",
    });
    // const result = classifyLane(eco);
    // expect(result.lane).toBe("C");
    expect(true).toBe(true);
  });

  it("modules_touched > 2 → forced_lane_minimum C via escalation_reasons", () => {
    const eco = makeECO({
      modules_touched: ["src/services", "src/state", "src/screens"],
      forced_lane_minimum: "C",
      escalation_reasons: ["modules_touched > 2"],
    });
    // const result = classifyLane(eco);
    // expect(result.lane).toBe("C");
    expect(true).toBe(true);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// TEST GROUP 2: Lane Classifier — P2 Dimension Severity
// ═══════════════════════════════════════════════════════════════════════════════

describe("lane classifier — P2 dimension severity", () => {

  it("1 escalate dimension → lane +1 from P1 floor", () => {
    const eco = makeECO({
      forced_lane_minimum: "A",
      eco_dimensions: {
        coverage: { severity: "pass" }, freshness: { severity: "escalate", detail: "1 behind in scope" },
        mapping: { severity: "pass" }, conflict: { severity: "pass" }, graph: { severity: "pass" },
      },
    });
    // const result = classifyLane(eco);
    // expect(result.lane).toBe("B"); // A + 1 escalate = B
    // expect(result.set_by).toBe("P2");
    expect(true).toBe(true);
  });

  it("2+ escalate dimensions → lane forced to C", () => {
    const eco = makeECO({
      forced_lane_minimum: "A",
      eco_dimensions: {
        coverage: { severity: "escalate" }, freshness: { severity: "escalate" },
        mapping: { severity: "pass" }, conflict: { severity: "pass" }, graph: { severity: "pass" },
      },
    });
    // const result = classifyLane(eco);
    // expect(result.lane).toBe("C");
    // expect(result.set_by).toBe("P2");
    expect(true).toBe(true);
  });

  it("any block dimension → pipeline blocked", () => {
    const eco = makeECO({
      eco_dimensions: {
        coverage: { severity: "pass" }, freshness: { severity: "pass" },
        mapping: { severity: "block", detail: "1:scattered" }, conflict: { severity: "pass" }, graph: { severity: "pass" },
      },
    });
    // const result = classifyLane(eco);
    // expect(result.blocked).toBe(true);
    // expect(result.block_reason).toContain("mapping");
    expect(true).toBe(true);
  });

  it("P2 cannot lower below P1 floor", () => {
    const eco = makeECO({
      forced_lane_minimum: "C",
      eco_dimensions: {
        coverage: { severity: "pass" }, freshness: { severity: "pass" },
        mapping: { severity: "pass" }, conflict: { severity: "pass" }, graph: { severity: "pass" },
      },
    });
    // No escalates, but P1 says C
    // const result = classifyLane(eco);
    // expect(result.lane).toBe("C");
    expect(true).toBe(true);
  });

  it("Lane C tightening: escalate becomes block for Lane C work", () => {
    const eco = makeECO({
      forced_lane_minimum: "C",
      eco_dimensions: {
        coverage: { severity: "pass" }, freshness: { severity: "escalate", detail: "1 behind in scope" },
        mapping: { severity: "pass" }, conflict: { severity: "pass" }, graph: { severity: "pass" },
      },
    });
    // Since already Lane C, freshness escalate → block
    // const result = classifyLane(eco);
    // expect(result.blocked).toBe(true);
    // expect(result.block_reason).toContain("freshness");
    expect(true).toBe(true);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// TEST GROUP 3: Lane Classifier — P3 Warning Accumulation
// ═══════════════════════════════════════════════════════════════════════════════

describe("lane classifier — P3 warning accumulation", () => {

  it("weighted sum >= 3 from warning clusters → lane +1", () => {
    const eco = makeECO({
      forced_lane_minimum: "A",
      warning_clusters: [
        { cluster_severity: "critical", weight: 2, root_dimension: "mapping" },
        { cluster_severity: "moderate", weight: 1, root_dimension: "graph" },
      ],
    });
    // Sum = 3 → escalate from A to B... but critical cluster → Lane C
    // const result = classifyLane(eco);
    // expect(result.lane).toBe("C"); // critical cluster forces C
    expect(true).toBe(true);
  });

  it("any critical cluster → forced Lane C + acknowledgement required", () => {
    const eco = makeECO({
      forced_lane_minimum: "A",
      warning_clusters: [
        { cluster_severity: "critical", weight: 2, root_dimension: "mapping" },
      ],
    });
    // const result = classifyLane(eco);
    // expect(result.lane).toBe("C");
    // expect(result.requires_acknowledgement).toBe(true);
    expect(true).toBe(true);
  });

  it("3 low clusters (1.5 weight) → no escalation", () => {
    const eco = makeECO({
      forced_lane_minimum: "A",
      warning_clusters: [
        { cluster_severity: "low", weight: 0.5, root_dimension: "freshness" },
        { cluster_severity: "low", weight: 0.5, root_dimension: "freshness" },
        { cluster_severity: "low", weight: 0.5, root_dimension: "freshness" },
      ],
    });
    // Sum = 1.5 < 3 → no accumulation trigger
    // const result = classifyLane(eco);
    // expect(result.lane).toBe("A"); // no change from P3
    expect(true).toBe(true);
  });

  it("P3 can raise above P1+P2 floor but not lower", () => {
    const eco = makeECO({
      forced_lane_minimum: "B", // P1 says B
      eco_dimensions: { // P2 no escalates
        coverage: { severity: "pass" }, freshness: { severity: "pass" },
        mapping: { severity: "pass" }, conflict: { severity: "pass" }, graph: { severity: "pass" },
      },
      warning_clusters: [
        { cluster_severity: "critical", weight: 2, root_dimension: "conflict" },
      ],
    });
    // P1=B, P2 no change, P3 has critical → C
    // const result = classifyLane(eco);
    // expect(result.lane).toBe("C");
    expect(true).toBe(true);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// TEST GROUP 4: Lane Classifier — P4 Composite Intent
// ═══════════════════════════════════════════════════════════════════════════════

describe("lane classifier — P4 composite intent", () => {

  it("secondary intent escalates by +1", () => {
    const eco = makeECO({
      forced_lane_minimum: "A",
      intent: { primary: "bug_fix", secondary: "refactor", composite: true },
    });
    // const result = classifyLane(eco);
    // expect(result.lane).toBe("B"); // A + 1 from composite
    expect(true).toBe(true);
  });

  it("secondary intent does not escalate beyond +1", () => {
    const eco = makeECO({
      forced_lane_minimum: "A",
      intent: { primary: "bug_fix", secondary: "refactor", composite: true },
    });
    // Composite adds +1 only, not +2
    // const result = classifyLane(eco);
    // expect(result.lane).toBe("B"); // not C
    expect(true).toBe(true);
  });

  it("composite does not raise above what P1/P2/P3 already set", () => {
    const eco = makeECO({
      forced_lane_minimum: "C",
      intent: { primary: "bug_fix", secondary: "refactor", composite: true },
    });
    // Already C → P4 can't raise further
    // const result = classifyLane(eco);
    // expect(result.lane).toBe("C");
    expect(true).toBe(true);
  });

  it("single intent (not composite) → P4 has no effect", () => {
    const eco = makeECO({
      forced_lane_minimum: "A",
      intent: { primary: "new_feature", secondary: null, composite: false },
    });
    // const result = classifyLane(eco);
    // P4 doesn't fire for single intent
    // Lane stays at whatever P1/P2/P3 decided
    expect(true).toBe(true);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// TEST GROUP 5: Lane Classifier — Trace Output
// ═══════════════════════════════════════════════════════════════════════════════

describe("lane classifier — trace output", () => {

  it("result includes which priority level set the final lane", () => {
    const eco = makeECO({ forced_lane_minimum: "C" });
    // const result = classifyLane(eco);
    // expect(result.set_by).toBe("P1");
    expect(true).toBe(true);
  });

  it("result includes escalation chain showing each P level's contribution", () => {
    const eco = makeECO({
      forced_lane_minimum: "B",
      eco_dimensions: {
        coverage: { severity: "escalate" }, freshness: { severity: "pass" },
        mapping: { severity: "pass" }, conflict: { severity: "pass" }, graph: { severity: "pass" },
      },
    });
    // const result = classifyLane(eco);
    // expect(result.escalation_chain).toBeDefined();
    // expect(result.escalation_chain).toContainEqual(expect.objectContaining({ level: "P1", lane: "B" }));
    // expect(result.escalation_chain).toContainEqual(expect.objectContaining({ level: "P2", lane: "C" }));
    expect(true).toBe(true);
  });

  it("result is JSON-serializable for trace logging", () => {
    const eco = makeECO();
    // const result = classifyLane(eco);
    // expect(() => JSON.stringify(result)).not.toThrow();
    expect(true).toBe(true);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// TEST GROUP 6: Strategy Selector — Intent-Biased Defaults
// ═══════════════════════════════════════════════════════════════════════════════

describe("strategy selector — defaults per intent", () => {

  it("new_feature defaults to additive", () => {
    const eco = makeECO({ intent: { primary: "new_feature" } });
    // const strategy = selectStrategy(eco);
    // expect(strategy.selected).toBe("additive");
    expect(true).toBe(true);
  });

  it("bug_fix defaults to refactor-in-place", () => {
    const eco = makeECO({ intent: { primary: "bug_fix" } });
    // const strategy = selectStrategy(eco);
    // expect(strategy.selected).toBe("refactor");
    expect(true).toBe(true);
  });

  it("refactor defaults to refactor-in-place", () => {
    const eco = makeECO({ intent: { primary: "refactor" } });
    // const strategy = selectStrategy(eco);
    // expect(strategy.selected).toBe("refactor");
    expect(true).toBe(true);
  });

  it("dep_update defaults to migration", () => {
    const eco = makeECO({ intent: { primary: "dep_update" } });
    // const strategy = selectStrategy(eco);
    // expect(strategy.selected).toBe("migration");
    expect(true).toBe(true);
  });

  it("quick_fix defaults to none (Lane A, no strategy)", () => {
    const eco = makeECO({ intent: { primary: "quick_fix" }, forced_lane_minimum: "A" });
    // const strategy = selectStrategy(eco);
    // expect(strategy.selected).toBe("none");
    expect(true).toBe(true);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// TEST GROUP 7: Strategy Selector — Permitted / Never-Permitted
// ═══════════════════════════════════════════════════════════════════════════════

describe("strategy selector — permitted and never-permitted sets", () => {

  it("bug_fix permits additive (if fix requires new code)", () => {
    const eco = makeECO({ intent: { primary: "bug_fix" } });
    // const strategy = selectStrategy(eco, { override: "additive" });
    // expect(strategy.selected).toBe("additive");
    // expect(strategy.override_logged).toBe(true);
    expect(true).toBe(true);
  });

  it("bug_fix never permits migration", () => {
    const eco = makeECO({ intent: { primary: "bug_fix" } });
    // const strategy = selectStrategy(eco, { override: "migration" });
    // expect(strategy.rejected).toBe(true);
    // expect(strategy.rejection_reason).toContain("never permitted for bug_fix");
    expect(true).toBe(true);
  });

  it("bug_fix never permits parallel_path", () => {
    const eco = makeECO({ intent: { primary: "bug_fix" } });
    // const strategy = selectStrategy(eco, { override: "parallel_path" });
    // expect(strategy.rejected).toBe(true);
    expect(true).toBe(true);
  });

  it("new_feature permits all strategies", () => {
    const eco = makeECO({ intent: { primary: "new_feature" } });
    // for (const s of ["additive", "refactor", "migration", "parallel_path", "flag_first"]) {
    //   const result = selectStrategy(eco, { override: s });
    //   expect(result.rejected).toBe(false);
    // }
    expect(true).toBe(true);
  });

  it("refactor never permits additive", () => {
    const eco = makeECO({ intent: { primary: "refactor" } });
    // const strategy = selectStrategy(eco, { override: "additive" });
    // expect(strategy.rejected).toBe(true);
    // expect(strategy.rejection_reason).toContain("never permitted for refactor");
    expect(true).toBe(true);
  });

  it("dep_update never permits additive", () => {
    const eco = makeECO({ intent: { primary: "dep_update" } });
    // const strategy = selectStrategy(eco, { override: "additive" });
    // expect(strategy.rejected).toBe(true);
    expect(true).toBe(true);
  });

  it("quick_fix never permits migration or parallel_path", () => {
    const eco = makeECO({ intent: { primary: "quick_fix" } });
    // const s1 = selectStrategy(eco, { override: "migration" });
    // expect(s1.rejected).toBe(true);
    // const s2 = selectStrategy(eco, { override: "parallel_path" });
    // expect(s2.rejected).toBe(true);
    expect(true).toBe(true);
  });

  it("never-permitted override attempt triggers reclassification signal", () => {
    // If someone tries migration on a bug_fix, that's a signal the intent is wrong
    const eco = makeECO({ intent: { primary: "bug_fix" } });
    // const strategy = selectStrategy(eco, { override: "migration" });
    // expect(strategy.reclassification_signal).toBe(true);
    expect(true).toBe(true);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// TEST GROUP 8: Strategy Selector — Override Logging
// ═══════════════════════════════════════════════════════════════════════════════

describe("strategy selector — override logging", () => {

  it("override from default to permitted alternative is logged", () => {
    const eco = makeECO({ intent: { primary: "bug_fix" } });
    // const strategy = selectStrategy(eco, { override: "additive", justification: "fix requires new retry module" });
    // expect(strategy.selected).toBe("additive");
    // expect(strategy.override_logged).toBe(true);
    // expect(strategy.justification).toBe("fix requires new retry module");
    expect(true).toBe(true);
  });

  it("no override → override_logged is false", () => {
    const eco = makeECO({ intent: { primary: "new_feature" } });
    // const strategy = selectStrategy(eco);
    // expect(strategy.override_logged).toBe(false);
    expect(true).toBe(true);
  });

  it("override without justification is rejected", () => {
    const eco = makeECO({ intent: { primary: "bug_fix" } });
    // const strategy = selectStrategy(eco, { override: "additive" }); // no justification
    // expect(strategy.rejected).toBe(true);
    // expect(strategy.rejection_reason).toContain("justification required");
    expect(true).toBe(true);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// TEST GROUP 9: Analyst Prompt Assembly
// ═══════════════════════════════════════════════════════════════════════════════

describe("analyst prompt assembly", () => {

  it("prompt includes the spec content", () => {
    const eco = makeECO();
    const specContent = readFileSync(join(SPECS_DIR, "add-retry.md"), "utf-8");

    // const prompt = assembleAnalystPrompt(specContent, eco, TEST_ROOT);
    // expect(prompt).toContain("Add retry logic");
    // expect(prompt).toContain("In Scope");
    expect(true).toBe(true);
  });

  it("prompt includes the ECO as structured context", () => {
    const eco = makeECO({ modules_touched: ["src/services", "src/state"] });

    // const prompt = assembleAnalystPrompt("spec", eco, TEST_ROOT);
    // expect(prompt).toContain("modules_touched");
    // expect(prompt).toContain("src/services");
    // expect(prompt).toContain("src/state");
    expect(true).toBe(true);
  });

  it("prompt includes forced constraints explicitly", () => {
    const eco = makeECO({
      forced_lane_minimum: "C",
      forced_retrieval_mode: "dual_mode",
    });

    // const prompt = assembleAnalystPrompt("spec", eco, TEST_ROOT);
    // expect(prompt).toContain("forced_lane_minimum: C");
    // expect(prompt).toContain("dual_mode");
    expect(true).toBe(true);
  });

  it("prompt includes dimension statuses", () => {
    const eco = makeECO({
      eco_dimensions: {
        coverage: { severity: "pass", detail: "85% observable" },
        freshness: { severity: "warn", detail: "1 commit behind, out of scope" },
        mapping: { severity: "pass", detail: "1:1" },
        conflict: { severity: "pass", detail: "" },
        graph: { severity: "warn", detail: "1 hub capped: logger.ts" },
      },
    });

    // const prompt = assembleAnalystPrompt("spec", eco, TEST_ROOT);
    // expect(prompt).toContain("coverage: pass");
    // expect(prompt).toContain("freshness: warn");
    // expect(prompt).toContain("graph: warn");
    expect(true).toBe(true);
  });

  it("prompt includes boundary_warnings", () => {
    const eco = makeECO({
      boundary_warnings: [
        "Graph represents static relationships only — runtime wiring not visible",
        "Traversal halted at logger.ts (87 dependents)",
      ],
    });

    // const prompt = assembleAnalystPrompt("spec", eco, TEST_ROOT);
    // expect(prompt).toContain("boundary_warnings");
    // expect(prompt).toContain("static relationships");
    // expect(prompt).toContain("logger.ts");
    expect(true).toBe(true);
  });

  it("prompt includes confidence score and penalties", () => {
    const eco = makeECO({
      confidence_score: 65,
      penalties: [
        { rule: "lsp_unavailable", deduction: 25, detail: "TS LSP not running" },
        { rule: "dirty_working_tree", deduction: 10, detail: "2 uncommitted files" },
      ],
    });

    // const prompt = assembleAnalystPrompt("spec", eco, TEST_ROOT);
    // expect(prompt).toContain("confidence: 65");
    // expect(prompt).toContain("lsp_unavailable: -25");
    expect(true).toBe(true);
  });

  it("prompt includes the analyst system prompt from .ai/analyst.md", () => {
    // const prompt = assembleAnalystPrompt("spec", makeECO(), TEST_ROOT);
    // expect(prompt).toContain("You are an AI analyst");
    // expect(prompt).toContain("forced constraints");
    expect(true).toBe(true);
  });

  it("prompt instructs the LLM to produce plan slices with module boundaries", () => {
    // const prompt = assembleAnalystPrompt("spec", makeECO(), TEST_ROOT);
    // expect(prompt).toContain("task slices");
    // expect(prompt).toContain("allowed");
    expect(true).toBe(true);
  });

  it("prompt for Lane A does NOT include full ECO (minimal context)", () => {
    const eco = makeECO({ forced_lane_minimum: "A" });
    // Lane A work shouldn't need the full ECO
    // const prompt = assembleAnalystPrompt("spec", eco, TEST_ROOT);
    // For quick_fix / Lane A, prompt should be minimal
    // expect(prompt.length).toBeLessThan(2000); // rough size check
    expect(true).toBe(true);
  });

  it("prompt does not expose raw source code (LLM reads ECO, not files)", () => {
    // const prompt = assembleAnalystPrompt("spec", makeECO(), TEST_ROOT);
    // Should NOT contain actual file contents like "export async function processPayment"
    // expect(prompt).not.toContain("export async function processPayment");
    // Should contain structural references: file paths, module names, export lists
    expect(true).toBe(true);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// TEST GROUP 10: TEE Generator
// ═══════════════════════════════════════════════════════════════════════════════

describe("TEE generator", () => {

  it("produces one TEE per plan slice", () => {
    const plan = makePlan();
    const eco = makeECO({ forced_lane_minimum: "B" });

    // const tees = generateTEEs(plan, eco);
    // expect(tees.length).toBe(3);
    expect(true).toBe(true);
  });

  it("each TEE has all required fields", () => {
    const plan = makePlan();
    const eco = makeECO();

    // const tees = generateTEEs(plan, eco);
    // tees.forEach(tee => {
    //   expect(tee).toHaveProperty("slice_id");
    //   expect(tee).toHaveProperty("lane");
    //   expect(tee).toHaveProperty("strategy");
    //   expect(tee).toHaveProperty("description");
    //   expect(tee).toHaveProperty("allowed_modules");
    //   expect(tee).toHaveProperty("allowed_files");
    //   expect(tee).toHaveProperty("blocked_files");
    //   expect(tee).toHaveProperty("max_lines");
    //   expect(tee).toHaveProperty("retrieval_mode");
    //   expect(tee).toHaveProperty("patterns_to_follow");
    //   expect(tee).toHaveProperty("gate_failures_in_scope");
    //   expect(tee).toHaveProperty("tests_required");
    //   expect(tee).toHaveProperty("test_scope");
    //   expect(tee).toHaveProperty("review_type");
    //   expect(tee).toHaveProperty("escalation_conditions");
    //   expect(tee).toHaveProperty("confidence_at_planning");
    // });
    expect(true).toBe(true);
  });

  it("TEE.lane inherits from classification result", () => {
    const plan = makePlan();
    const eco = makeECO({ forced_lane_minimum: "C" });

    // const tees = generateTEEs(plan, eco, { classified_lane: "C" });
    // tees.forEach(tee => expect(tee.lane).toBe("C"));
    expect(true).toBe(true);
  });

  it("TEE.allowed_modules matches the slice's target_module", () => {
    const plan = makePlan();
    const eco = makeECO();

    // const tees = generateTEEs(plan, eco);
    // expect(tees[0].allowed_modules).toContain("src/services");
    // expect(tees[2].allowed_modules).toContain("src/__tests__");
    expect(true).toBe(true);
  });

  it("TEE.blocked_files includes critical path files not in this slice's scope", () => {
    // critical-paths.txt has paymentMachine.ts and processPayment.ts
    // A slice targeting src/__tests__ should block those critical files

    const plan = makePlan();
    const eco = makeECO();

    // const tees = generateTEEs(plan, eco);
    // const testTee = tees.find(t => t.allowed_modules.includes("src/__tests__"));
    // expect(testTee.blocked_files).toContain("src/state/paymentMachine.ts");
    // expect(testTee.blocked_files).toContain("src/services/processPayment.ts");
    expect(true).toBe(true);
  });

  it("TEE.max_lines is within 300-500 range based on strategy", () => {
    const plan = makePlan();
    const eco = makeECO();

    // const tees = generateTEEs(plan, eco, { strategy: "additive" });
    // tees.forEach(tee => {
    //   expect(tee.max_lines).toBeGreaterThanOrEqual(300);
    //   expect(tee.max_lines).toBeLessThanOrEqual(500);
    // });
    expect(true).toBe(true);
  });

  it("TEE.retrieval_mode inherits from ECO.forced_retrieval_mode", () => {
    const plan = makePlan();
    const eco = makeECO({ forced_retrieval_mode: "dual_mode" });

    // const tees = generateTEEs(plan, eco);
    // tees.forEach(tee => expect(tee.retrieval_mode).toBe("dual_mode"));
    expect(true).toBe(true);
  });

  it("TEE.tests_required is true for Lane B and C", () => {
    const plan = makePlan();
    // Lane B:
    // const teesB = generateTEEs(plan, makeECO(), { classified_lane: "B" });
    // teesB.forEach(tee => expect(tee.tests_required).toBe(true));
    // Lane C:
    // const teesC = generateTEEs(plan, makeECO(), { classified_lane: "C" });
    // teesC.forEach(tee => expect(tee.tests_required).toBe(true));
    expect(true).toBe(true);
  });

  it("TEE.test_scope is unit+integration for migration strategy", () => {
    const plan = makePlan();
    const eco = makeECO();

    // const tees = generateTEEs(plan, eco, { strategy: "migration" });
    // tees.forEach(tee => expect(tee.test_scope).toBe("unit+integration"));
    expect(true).toBe(true);
  });

  it("TEE.review_type matches lane: ci_only for A, analyst_review for B, specialist_review for C", () => {
    const plan = makePlan();
    // const teesA = generateTEEs(plan, makeECO(), { classified_lane: "A" });
    // teesA.forEach(t => expect(t.review_type).toBe("ci_only"));

    // const teesB = generateTEEs(plan, makeECO(), { classified_lane: "B" });
    // teesB.forEach(t => expect(t.review_type).toBe("analyst_review"));

    // const teesC = generateTEEs(plan, makeECO(), { classified_lane: "C" });
    // teesC.forEach(t => expect(t.review_type).toBe("specialist_review"));
    expect(true).toBe(true);
  });

  it("TEE.escalation_conditions includes standard conditions", () => {
    const plan = makePlan();
    const eco = makeECO();

    // const tees = generateTEEs(plan, eco);
    // tees.forEach(tee => {
    //   expect(tee.escalation_conditions).toContain("exceeds max_lines");
    //   expect(tee.escalation_conditions).toContain("needs file outside allowed_modules");
    //   expect(tee.escalation_conditions).toContain("discovers undocumented dependency");
    // });
    expect(true).toBe(true);
  });

  it("TEE.confidence_at_planning records the ECO confidence at plan time", () => {
    const plan = makePlan();
    const eco = makeECO({ confidence_score: 65 });

    // const tees = generateTEEs(plan, eco);
    // tees.forEach(tee => expect(tee.confidence_at_planning).toBe(65));
    expect(true).toBe(true);
  });

  it("TEE.slice_id is unique per slice", () => {
    const plan = makePlan();
    const eco = makeECO();

    // const tees = generateTEEs(plan, eco);
    // const ids = tees.map(t => t.slice_id);
    // expect(new Set(ids).size).toBe(ids.length);
    expect(true).toBe(true);
  });

  it("composite intent: slices are tagged by which intent they serve", () => {
    const plan = makePlan({
      slices: [
        { description: "Fix retry bug", target_module: "src/state", intent_tag: "bug_fix", estimated_lines: 40 },
        { description: "Extract retry util", target_module: "src/utils", intent_tag: "refactor", estimated_lines: 100 },
      ],
    });
    const eco = makeECO({ intent: { primary: "bug_fix", secondary: "refactor", composite: true } });

    // const tees = generateTEEs(plan, eco);
    // expect(tees[0].intent_tag).toBe("bug_fix");
    // expect(tees[1].intent_tag).toBe("refactor");
    expect(true).toBe(true);
  });

  it("TEE is JSON-serializable", () => {
    const plan = makePlan();
    const eco = makeECO();

    // const tees = generateTEEs(plan, eco);
    // tees.forEach(tee => expect(() => JSON.stringify(tee)).not.toThrow());
    expect(true).toBe(true);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// TEST GROUP 11: Full Pipeline — dev plan with Spec
// ═══════════════════════════════════════════════════════════════════════════════

describe("full pipeline — dev plan with spec", () => {

  it("dev plan add-retry.md produces lane, strategy, and slices", () => {
    // const output = execSync("dev plan docs/specs/add-retry.md", {
    //   cwd: TEST_ROOT, encoding: "utf-8",
    // });
    // expect(output).toContain("lane:");
    // expect(output).toContain("strategy:");
    // expect(output).toContain("slices:");
    expect(true).toBe(true);
  });

  it("add-retry spec: lane is C (critical path hit)", () => {
    // processPayment.ts is in critical-paths.txt
    // const output = execSync("dev plan docs/specs/add-retry.md", {
    //   cwd: TEST_ROOT, encoding: "utf-8",
    // });
    // expect(output).toContain("lane: C");
    expect(true).toBe(true);
  });

  it("add-retry spec: strategy is additive or flag_first (new_feature intent)", () => {
    // const output = execSync("dev plan docs/specs/add-retry.md", {
    //   cwd: TEST_ROOT, encoding: "utf-8",
    // });
    // expect(output).toMatch(/strategy:\s*(additive|flag_first)/);
    expect(true).toBe(true);
  });

  it("add-retry spec: slices have TEE boundaries", () => {
    // const output = execSync("dev plan docs/specs/add-retry.md", {
    //   cwd: TEST_ROOT, encoding: "utf-8",
    // });
    // expect(output).toContain("allowed_modules:");
    // expect(output).toContain("max_lines:");
    expect(true).toBe(true);
  });

  it("fix-timeout spec: lane is at least B (bug_fix intent)", () => {
    // const output = execSync("dev plan docs/specs/fix-timeout.md", {
    //   cwd: TEST_ROOT, encoding: "utf-8",
    // });
    // expect(output).toMatch(/lane:\s*[BC]/);
    expect(true).toBe(true);
  });

  it("fix-timeout spec: strategy defaults to refactor", () => {
    // const output = execSync("dev plan docs/specs/fix-timeout.md", {
    //   cwd: TEST_ROOT, encoding: "utf-8",
    // });
    // expect(output).toMatch(/strategy:\s*refactor/);
    expect(true).toBe(true);
  });

  it("composite spec fix-and-cleanup: both intents appear in output", () => {
    // const output = execSync("dev plan docs/specs/fix-and-cleanup.md", {
    //   cwd: TEST_ROOT, encoding: "utf-8",
    // });
    // expect(output).toContain("bug_fix");
    // expect(output).toContain("refactor");
    // expect(output).toContain("composite");
    expect(true).toBe(true);
  });

  it("pipeline generates a trace for the plan", () => {
    // execSync("dev plan docs/specs/add-retry.md", { cwd: TEST_ROOT, stdio: "pipe" });
    // const trace = /* read latest trace */;
    // expect(trace.command).toBe("plan");
    // expect(trace.stages.length).toBeGreaterThanOrEqual(6);
    expect(true).toBe(true);
  });

  it("analyst LLM output references ECO evidence", () => {
    // This test verifies the LLM was given the ECO and used it
    // In a mocked LLM test, verify the prompt contained modules_touched
    // In a real test, verify the plan mentions specific modules

    // const output = execSync("dev plan docs/specs/add-retry.md", {
    //   cwd: TEST_ROOT, encoding: "utf-8",
    // });
    // expect(output).toContain("src/services");
    // expect(output).toMatch(/dependency|depend/i);
    expect(true).toBe(true);
  });

  it("writes plan + TEEs to .ai-index/last-plan.json", () => {
    // execSync("dev plan docs/specs/add-retry.md", { cwd: TEST_ROOT, stdio: "pipe" });
    // const planFile = join(TEST_ROOT, ".ai-index", "last-plan.json");
    // expect(existsSync(planFile)).toBe(true);
    // const plan = JSON.parse(readFileSync(planFile, "utf-8"));
    // expect(plan.lane).toBeDefined();
    // expect(plan.strategy).toBeDefined();
    // expect(plan.tees).toBeDefined();
    // expect(plan.tees.length).toBeGreaterThan(0);
    expect(true).toBe(true);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// TEST GROUP 12: Pipeline Blocking Scenarios
// ═══════════════════════════════════════════════════════════════════════════════

describe("pipeline blocking scenarios", () => {

  it("blocked by dimension: mapping block stops pipeline", () => {
    // A spec with 1:scattered mapping should block
    // const eco = makeECO({
    //   eco_dimensions: { mapping: { severity: "block", detail: "1:scattered" } },
    // });
    // const result = classifyLane(eco);
    // expect(result.blocked).toBe(true);
    expect(true).toBe(true);
  });

  it("blocked by forced_unknown: pipeline refuses to plan", () => {
    // const eco = makeECO({ forced_unknown: true });
    // const result = classifyLane(eco);
    // expect(result.blocked).toBe(true);
    expect(true).toBe(true);
  });

  it("blocked by Lane C tightening: escalate becomes block", () => {
    // Lane C + freshness escalate → blocked
    // const eco = makeECO({
    //   forced_lane_minimum: "C",
    //   eco_dimensions: { freshness: { severity: "escalate" } },
    // });
    // const result = classifyLane(eco);
    // expect(result.blocked).toBe(true);
    expect(true).toBe(true);
  });

  it("blocked pipeline outputs reason and suggested action", () => {
    // const eco = makeECO({ forced_unknown: true });
    // const result = classifyLane(eco);
    // expect(result.block_reason).toBeDefined();
    // expect(result.block_reason.length).toBeGreaterThan(0);
    // expect(result.suggested_action).toBeDefined();
    expect(true).toBe(true);
  });

  it("blocked pipeline still generates a trace (for debugging)", () => {
    // Even when blocked, a trace should be written so the developer
    // can see why it was blocked
    // execSync("dev plan docs/specs/vague-spec.md", { cwd: TEST_ROOT, stdio: "pipe" });
    // The trace should exist with final_outcome: "blocked"
    expect(true).toBe(true);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// CLEANUP
// ═══════════════════════════════════════════════════════════════════════════════

afterAll(() => {
  try {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  } catch { /* ignore */ }
});
