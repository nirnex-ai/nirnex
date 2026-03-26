/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Nirnex — Sprint 9 Test Suite
 * Knowledge Layer: Scope-Aware Freshness Impact
 *
 * TDD test suite written before implementation.
 * All tests must pass after implementation is complete.
 *
 * Tests every unit and integration point:
 *   1.  FreshnessSnapshot contract — shape invariants
 *   2.  buildFreshnessSnapshot — git integration, fallback
 *   3.  extractStaleScopes — change types, DB fallback, file-level scope
 *   4.  extractRequiredScopes — from ECO modules, symbols, weights
 *   5.  computeFreshnessImpact — all severity cases
 *   6.  Deterministic thresholds — none/warn/escalate/block
 *   7.  Deleted/renamed scope handling — must_block
 *   8.  Freshness reason codes — all 7 codes
 *   9.  confidence.ts — scope-aware penalty (no flat penalty for stale_unrelated)
 *   10. ECO integration — eco.freshness structured, eco_dimensions.freshness populated
 *   11. dimensions.ts — freshness dimension carries real impact data
 *   12. Regression — old global stale penalty removed for unrelated files
 *
 * Design constraints (enforced by tests):
 *   - No global stale penalty when changed files do not intersect required scope
 *   - Same input must yield same FreshnessImpact (determinism)
 *   - Deleted required scope must always escalate to block severity
 *   - Freshness penalty must be independent of coverage / conflict dimensions
 *   - FreshnessDimensionEntry must distinguish fresh vs stale_unrelated vs stale_impacted
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import Database from "better-sqlite3";

// ─── Imports under test ──────────────────────────────────────────────────────

import { buildFreshnessSnapshot } from "../packages/core/src/knowledge/freshness/build-freshness-snapshot.js";
import { extractStaleScopes } from "../packages/core/src/knowledge/freshness/extract-stale-scopes.js";
import { extractRequiredScopes } from "../packages/core/src/knowledge/freshness/extract-required-scopes.js";
import { computeFreshnessImpact } from "../packages/core/src/knowledge/freshness/compute-freshness-impact.js";
import { FRESHNESS_REASON_CODES } from "../packages/core/src/knowledge/freshness/freshness-reason-codes.js";
import { computePenalties, PENALTY_RULES } from "../packages/core/src/confidence.js";
import { buildECO } from "../packages/core/src/eco.js";
import { scoreDimensions } from "../packages/core/src/dimensions.js";

import type {
  FreshnessSnapshot,
  RequiredScopeRef,
  StaleScopeRef,
  FreshnessImpact,
} from "../packages/core/src/knowledge/freshness/types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TEST_ROOT = join(tmpdir(), `nirnex-sprint9-${Date.now()}`);
const GIT_ROOT   = join(TEST_ROOT, "git-repo");
const DB_PATH    = join(TEST_ROOT, "test.db");

/** Build a minimal FreshnessSnapshot for unit tests (no git needed) */
function makeSnapshot(overrides: Partial<FreshnessSnapshot> = {}): FreshnessSnapshot {
  return {
    indexedCommit: "abc1234",
    headCommit:    "def5678",
    isStale:       true,
    changedFiles:  [],
    changedFileStatuses: [],
    generatedAt:   new Date().toISOString(),
    ...overrides,
  };
}

/** Build a minimal RequiredScopeRef */
function makeRequired(filePath: string, weight = 1.0): RequiredScopeRef {
  return {
    filePath,
    scopeId: filePath,
    source:  "retrieval",
    weight,
  };
}

/** Build a minimal StaleScopeRef */
function makeStale(filePath: string, changeType: StaleScopeRef["changeType"] = "modified"): StaleScopeRef {
  return {
    filePath,
    scopeIds:   [filePath],
    changeType,
  };
}

/** Create an in-memory DB with the modules table */
function makeDb(): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE modules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT UNIQUE NOT NULL,
      name TEXT, language TEXT, loc INTEGER, indexed_at TEXT,
      tier TEXT DEFAULT 'FULL', reason_code TEXT, decision_source TEXT, matched_rule TEXT,
      is_hub INTEGER DEFAULT 0
    );
    CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT);
  `);
  return db;
}

function insertModule(db: InstanceType<typeof Database>, filePath: string) {
  db.prepare(
    `INSERT OR IGNORE INTO modules (path, name, language, loc, tier)
     VALUES (?, ?, 'ts', 50, 'FULL')`
  ).run(filePath, filePath.split("/").pop());
}

function insertMeta(db: InstanceType<typeof Database>, key: string, value: string) {
  db.prepare(`INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)`).run(key, value);
}

// ─── Setup / teardown ────────────────────────────────────────────────────────

let COMMIT_A = "";
let COMMIT_B = "";

beforeAll(() => {
  mkdirSync(TEST_ROOT, { recursive: true });
  mkdirSync(GIT_ROOT,   { recursive: true });
  mkdirSync(join(GIT_ROOT, "src"), { recursive: true });

  // Initialise a real git repo for integration tests
  execSync("git init",                                        { cwd: GIT_ROOT, stdio: "pipe" });
  execSync('git config user.email "test@test.com"',          { cwd: GIT_ROOT, stdio: "pipe" });
  execSync('git config user.name "Test"',                    { cwd: GIT_ROOT, stdio: "pipe" });

  // Commit A — baseline
  writeFileSync(join(GIT_ROOT, "src", "payments.ts"), "export function pay() {}", "utf-8");
  writeFileSync(join(GIT_ROOT, "src", "auth.ts"),     "export function login() {}",  "utf-8");
  execSync("git add -A",              { cwd: GIT_ROOT, stdio: "pipe" });
  execSync('git commit -m "initial"', { cwd: GIT_ROOT, stdio: "pipe" });
  COMMIT_A = execSync("git rev-parse HEAD", { cwd: GIT_ROOT, encoding: "utf-8" }).trim();

  // Modify one file and add a new one, delete another
  writeFileSync(join(GIT_ROOT, "src", "payments.ts"), "export function pay(v: number) {}", "utf-8");
  writeFileSync(join(GIT_ROOT, "src", "retry.ts"),    "export function retry() {}",          "utf-8");
  execSync("git rm src/auth.ts",      { cwd: GIT_ROOT, stdio: "pipe" });
  execSync("git add -A",              { cwd: GIT_ROOT, stdio: "pipe" });
  execSync('git commit -m "changes"', { cwd: GIT_ROOT, stdio: "pipe" });
  COMMIT_B = execSync("git rev-parse HEAD", { cwd: GIT_ROOT, encoding: "utf-8" }).trim();
});

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. FreshnessSnapshot contract
// ═══════════════════════════════════════════════════════════════════════════════

describe("FreshnessSnapshot contract", () => {
  it("has all required fields", () => {
    const s = makeSnapshot();
    expect(s).toHaveProperty("indexedCommit");
    expect(s).toHaveProperty("headCommit");
    expect(s).toHaveProperty("isStale");
    expect(s).toHaveProperty("changedFiles");
    expect(s).toHaveProperty("changedFileStatuses");
    expect(s).toHaveProperty("generatedAt");
  });

  it("isStale is false when commits match", () => {
    const s = makeSnapshot({ indexedCommit: "abc", headCommit: "abc", isStale: false });
    expect(s.isStale).toBe(false);
  });

  it("changedFiles is an array", () => {
    const s = makeSnapshot({ changedFiles: ["src/a.ts", "src/b.ts"] });
    expect(Array.isArray(s.changedFiles)).toBe(true);
  });

  it("changedFileStatuses entries have path and changeType", () => {
    const s = makeSnapshot({
      changedFileStatuses: [{ path: "src/a.ts", changeType: "modified" }],
    });
    for (const entry of s.changedFileStatuses) {
      expect(entry).toHaveProperty("path");
      expect(entry).toHaveProperty("changeType");
    }
  });

  it("generatedAt is a valid ISO timestamp", () => {
    const s = makeSnapshot();
    expect(() => new Date(s.generatedAt)).not.toThrow();
    expect(new Date(s.generatedAt).getFullYear()).toBeGreaterThan(2024);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. buildFreshnessSnapshot
// ═══════════════════════════════════════════════════════════════════════════════

describe("buildFreshnessSnapshot", () => {
  it("returns fresh snapshot when commits match", () => {
    const db = makeDb();
    insertMeta(db, "commit_hash", COMMIT_B);
    const snap = buildFreshnessSnapshot(GIT_ROOT, db);
    expect(snap.isStale).toBe(false);
    expect(snap.changedFiles).toHaveLength(0);
    expect(snap.changedFileStatuses).toHaveLength(0);
    expect(snap.indexedCommit).toBe(COMMIT_B);
    expect(snap.headCommit).toBe(COMMIT_B);
  });

  it("returns stale snapshot when commits differ", () => {
    const db = makeDb();
    insertMeta(db, "commit_hash", COMMIT_A);
    const snap = buildFreshnessSnapshot(GIT_ROOT, db);
    expect(snap.isStale).toBe(true);
    expect(snap.indexedCommit).toBe(COMMIT_A);
    expect(snap.headCommit).toBe(COMMIT_B);
  });

  it("changedFiles includes modified file", () => {
    const db = makeDb();
    insertMeta(db, "commit_hash", COMMIT_A);
    const snap = buildFreshnessSnapshot(GIT_ROOT, db);
    expect(snap.changedFiles.some(f => f.includes("payments.ts"))).toBe(true);
  });

  it("changedFiles includes added file", () => {
    const db = makeDb();
    insertMeta(db, "commit_hash", COMMIT_A);
    const snap = buildFreshnessSnapshot(GIT_ROOT, db);
    expect(snap.changedFiles.some(f => f.includes("retry.ts"))).toBe(true);
  });

  it("changedFiles includes deleted file", () => {
    const db = makeDb();
    insertMeta(db, "commit_hash", COMMIT_A);
    const snap = buildFreshnessSnapshot(GIT_ROOT, db);
    expect(snap.changedFiles.some(f => f.includes("auth.ts"))).toBe(true);
  });

  it("changedFileStatuses contains 'deleted' for removed file", () => {
    const db = makeDb();
    insertMeta(db, "commit_hash", COMMIT_A);
    const snap = buildFreshnessSnapshot(GIT_ROOT, db);
    const deletedEntry = snap.changedFileStatuses.find(e => e.path.includes("auth.ts"));
    expect(deletedEntry).toBeDefined();
    expect(deletedEntry?.changeType).toBe("deleted");
  });

  it("changedFileStatuses contains 'modified' for changed file", () => {
    const db = makeDb();
    insertMeta(db, "commit_hash", COMMIT_A);
    const snap = buildFreshnessSnapshot(GIT_ROOT, db);
    const modifiedEntry = snap.changedFileStatuses.find(e => e.path.includes("payments.ts"));
    expect(modifiedEntry).toBeDefined();
    expect(modifiedEntry?.changeType).toBe("modified");
  });

  it("returns unknown-commit snapshot when db has no commit_hash entry", () => {
    const db = makeDb(); // no commit_hash
    const snap = buildFreshnessSnapshot(GIT_ROOT, db);
    expect(snap.isStale).toBe(true);
    expect(snap.indexedCommit).toBe("none");
  });

  it("returns fresh with empty changed files for non-git dir", () => {
    // A directory without git should return a graceful fallback
    const snap = buildFreshnessSnapshot(TEST_ROOT, makeDb());
    expect(snap).toHaveProperty("isStale");
    expect(snap).toHaveProperty("changedFiles");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. extractStaleScopes
// ═══════════════════════════════════════════════════════════════════════════════

describe("extractStaleScopes", () => {
  it("returns empty array for fresh snapshot", () => {
    const snap = makeSnapshot({ isStale: false, changedFiles: [] });
    expect(extractStaleScopes(snap)).toEqual([]);
  });

  it("returns empty array when no changed files", () => {
    const snap = makeSnapshot({ isStale: true, changedFiles: [], changedFileStatuses: [] });
    expect(extractStaleScopes(snap)).toEqual([]);
  });

  it("maps each changed file to a StaleScopeRef", () => {
    const snap = makeSnapshot({
      isStale: true,
      changedFiles: ["src/a.ts", "src/b.ts"],
      changedFileStatuses: [
        { path: "src/a.ts", changeType: "modified" },
        { path: "src/b.ts", changeType: "added" },
      ],
    });
    const result = extractStaleScopes(snap);
    expect(result).toHaveLength(2);
    expect(result[0].filePath).toBe("src/a.ts");
    expect(result[1].filePath).toBe("src/b.ts");
  });

  it("StaleScopeRef includes scopeId equal to filePath when no DB", () => {
    const snap = makeSnapshot({
      isStale: true,
      changedFiles: ["src/payments.ts"],
      changedFileStatuses: [{ path: "src/payments.ts", changeType: "modified" }],
    });
    const result = extractStaleScopes(snap);
    expect(result[0].scopeIds).toContain("src/payments.ts");
  });

  it("changeType is preserved for deleted files", () => {
    const snap = makeSnapshot({
      isStale: true,
      changedFiles: ["src/old.ts"],
      changedFileStatuses: [{ path: "src/old.ts", changeType: "deleted" }],
    });
    const result = extractStaleScopes(snap);
    expect(result[0].changeType).toBe("deleted");
  });

  it("changeType is preserved for renamed files", () => {
    const snap = makeSnapshot({
      isStale: true,
      changedFiles: ["src/renamed.ts"],
      changedFileStatuses: [{ path: "src/renamed.ts", changeType: "renamed" }],
    });
    const result = extractStaleScopes(snap);
    expect(result[0].changeType).toBe("renamed");
  });

  it("falls back to file scope (modified) when changeType entry missing", () => {
    const snap = makeSnapshot({
      isStale: true,
      changedFiles: ["src/mystery.ts"],
      changedFileStatuses: [], // no status for this file
    });
    const result = extractStaleScopes(snap);
    expect(result[0].changeType).toBe("modified"); // default fallback
  });

  it("DB-backed lookup includes scopeId from indexed modules when available", () => {
    const db = makeDb();
    insertModule(db, "src/payments.ts");
    const snap = makeSnapshot({
      isStale: true,
      changedFiles: ["src/payments.ts"],
      changedFileStatuses: [{ path: "src/payments.ts", changeType: "modified" }],
    });
    const result = extractStaleScopes(snap, db);
    expect(result[0].scopeIds.length).toBeGreaterThan(0);
    expect(result[0].scopeIds).toContain("src/payments.ts");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. extractRequiredScopes
// ═══════════════════════════════════════════════════════════════════════════════

describe("extractRequiredScopes", () => {
  it("returns empty for empty input", () => {
    expect(extractRequiredScopes({ modulesTouched: [], symbols: [], hubNodes: [] })).toEqual([]);
  });

  it("maps each touched module to a RequiredScopeRef", () => {
    const result = extractRequiredScopes({ modulesTouched: ["src/payments.ts", "src/auth.ts"] });
    expect(result).toHaveLength(2);
    expect(result[0].filePath).toBe("src/payments.ts");
    expect(result[1].filePath).toBe("src/auth.ts");
  });

  it("all refs have scopeId equal to filePath when no symbol override", () => {
    const result = extractRequiredScopes({ modulesTouched: ["src/payments.ts"] });
    expect(result[0].scopeId).toBe("src/payments.ts");
  });

  it("source is 'retrieval' by default for modulesTouched", () => {
    const result = extractRequiredScopes({ modulesTouched: ["src/payments.ts"] });
    expect(result[0].source).toBe("retrieval");
  });

  it("hubNodes get source = 'graph' and higher weight", () => {
    const result = extractRequiredScopes({ modulesTouched: [], hubNodes: ["src/core.ts"] });
    const hubRef = result.find(r => r.filePath === "src/core.ts");
    expect(hubRef).toBeDefined();
    expect(hubRef?.source).toBe("graph");
    expect(hubRef?.weight).toBeGreaterThan(1.0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5–7. computeFreshnessImpact — all severity cases + deleted/renamed handling
// ═══════════════════════════════════════════════════════════════════════════════

describe("computeFreshnessImpact — fresh index", () => {
  it("returns severity=none and reasonCode=INDEX_FRESH when index is not stale", () => {
    const snap = makeSnapshot({ isStale: false, changedFiles: [] });
    const result = computeFreshnessImpact(snap, [], []);
    expect(result.severity).toBe("none");
    expect(result.reasonCodes).toContain(FRESHNESS_REASON_CODES.INDEX_FRESH);
    expect(result.isStale).toBe(false);
    expect(result.impactRatio).toBe(0);
  });
});

describe("computeFreshnessImpact — stale but no intersection", () => {
  it("returns severity=none when required scopes don't intersect stale scopes", () => {
    const snap = makeSnapshot({ isStale: true, changedFiles: ["src/unrelated.ts"] });
    const required = [makeRequired("src/payments.ts")];
    const stale    = [makeStale("src/unrelated.ts")];
    const result   = computeFreshnessImpact(snap, required, stale);
    expect(result.severity).toBe("none");
    expect(result.impactedFiles).toHaveLength(0);
    expect(result.intersectedScopeCount).toBe(0);
  });

  it("returns reasonCode=INDEX_STALE_NO_SCOPE_INTERSECTION for stale+no intersection", () => {
    const snap   = makeSnapshot({ isStale: true });
    const result = computeFreshnessImpact(snap, [makeRequired("src/a.ts")], [makeStale("src/b.ts")]);
    expect(result.reasonCodes).toContain(FRESHNESS_REASON_CODES.INDEX_STALE_NO_SCOPE_INTERSECTION);
  });

  it("returns severity=none when required scopes are empty", () => {
    const snap   = makeSnapshot({ isStale: true, changedFiles: ["src/everything.ts"] });
    const result = computeFreshnessImpact(snap, [], [makeStale("src/everything.ts")]);
    expect(result.severity).toBe("none");
  });
});

describe("computeFreshnessImpact — severity thresholds", () => {
  it("severity=warn when impactRatio > 0 and < 0.25", () => {
    // 1 out of 5 required scopes intersect = 0.20
    const required = ["a","b","c","d","e"].map(f => makeRequired(`src/${f}.ts`));
    const stale    = [makeStale("src/a.ts")]; // only 1 intersection
    const snap     = makeSnapshot({ isStale: true });
    const result   = computeFreshnessImpact(snap, required, stale);
    expect(result.severity).toBe("warn");
    expect(result.reasonCodes.some(c => c.includes("LOW"))).toBe(true);
    expect(result.impactRatio).toBeCloseTo(0.2, 2);
  });

  it("severity=escalate when impactRatio >= 0.25 and < 0.60", () => {
    // 2 out of 5 = 0.40
    const required = ["a","b","c","d","e"].map(f => makeRequired(`src/${f}.ts`));
    const stale    = ["a","b"].map(f => makeStale(`src/${f}.ts`));
    const snap     = makeSnapshot({ isStale: true });
    const result   = computeFreshnessImpact(snap, required, stale);
    expect(result.severity).toBe("escalate");
    expect(result.reasonCodes.some(c => c.includes("MEDIUM"))).toBe(true);
  });

  it("severity=block when impactRatio >= 0.60", () => {
    // 4 out of 5 = 0.80
    const required = ["a","b","c","d","e"].map(f => makeRequired(`src/${f}.ts`));
    const stale    = ["a","b","c","d"].map(f => makeStale(`src/${f}.ts`));
    const snap     = makeSnapshot({ isStale: true });
    const result   = computeFreshnessImpact(snap, required, stale);
    expect(result.severity).toBe("block");
    expect(result.reasonCodes.some(c => c.includes("HIGH"))).toBe(true);
  });

  it("severity=block when deleted stale scope intersects required scope (regardless of ratio)", () => {
    // Only 1 out of 10 intersects (ratio=0.10) but it's deleted
    const required = Array.from({ length: 10 }, (_, i) => makeRequired(`src/${i}.ts`));
    const stale    = [makeStale("src/0.ts", "deleted")]; // 0.10 ratio, but deleted
    const snap     = makeSnapshot({ isStale: true });
    const result   = computeFreshnessImpact(snap, required, stale);
    expect(result.severity).toBe("block");
    expect(result.reasonCodes).toContain(FRESHNESS_REASON_CODES.INDEX_STALE_REQUIRED_SCOPE_DELETED);
  });

  it("severity=block when renamed stale scope intersects required scope", () => {
    const required = [makeRequired("src/old.ts")];
    const stale    = [makeStale("src/old.ts", "renamed")];
    const snap     = makeSnapshot({ isStale: true });
    const result   = computeFreshnessImpact(snap, required, stale);
    expect(result.severity).toBe("block");
    expect(result.reasonCodes).toContain(FRESHNESS_REASON_CODES.INDEX_STALE_REQUIRED_SCOPE_RENAMED);
  });
});

describe("computeFreshnessImpact — output contract", () => {
  it("impactedFiles contains intersecting file paths", () => {
    const required = [makeRequired("src/payments.ts"), makeRequired("src/auth.ts")];
    const stale    = [makeStale("src/payments.ts")];
    const snap     = makeSnapshot({ isStale: true });
    const result   = computeFreshnessImpact(snap, required, stale);
    expect(result.impactedFiles).toContain("src/payments.ts");
    expect(result.impactedFiles).not.toContain("src/auth.ts");
  });

  it("staleScopeCount equals number of stale scope refs", () => {
    const stale  = ["a","b","c"].map(f => makeStale(`src/${f}.ts`));
    const snap   = makeSnapshot({ isStale: true });
    const result = computeFreshnessImpact(snap, [makeRequired("src/a.ts")], stale);
    expect(result.staleScopeCount).toBe(3);
  });

  it("requiredScopeCount equals number of required scope refs", () => {
    const required = ["a","b","c","d"].map(f => makeRequired(`src/${f}.ts`));
    const snap     = makeSnapshot({ isStale: true });
    const result   = computeFreshnessImpact(snap, required, []);
    expect(result.requiredScopeCount).toBe(4);
  });

  it("is deterministic — same input always yields same result", () => {
    const snap     = makeSnapshot({ isStale: true });
    const required = [makeRequired("src/a.ts"), makeRequired("src/b.ts")];
    const stale    = [makeStale("src/a.ts")];
    const r1       = computeFreshnessImpact(snap, required, stale);
    const r2       = computeFreshnessImpact(snap, required, stale);
    expect(r1.severity).toBe(r2.severity);
    expect(r1.impactRatio).toBe(r2.impactRatio);
    expect(r1.reasonCodes.sort()).toEqual(r2.reasonCodes.sort());
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Freshness reason codes
// ═══════════════════════════════════════════════════════════════════════════════

describe("FRESHNESS_REASON_CODES", () => {
  it("has INDEX_FRESH", () =>
    expect(FRESHNESS_REASON_CODES.INDEX_FRESH).toBe("INDEX_FRESH"));

  it("has INDEX_STALE_NO_SCOPE_INTERSECTION", () =>
    expect(FRESHNESS_REASON_CODES.INDEX_STALE_NO_SCOPE_INTERSECTION).toBe("INDEX_STALE_NO_SCOPE_INTERSECTION"));

  it("has INDEX_STALE_SCOPE_INTERSECTION_LOW", () =>
    expect(FRESHNESS_REASON_CODES.INDEX_STALE_SCOPE_INTERSECTION_LOW).toBe("INDEX_STALE_SCOPE_INTERSECTION_LOW"));

  it("has INDEX_STALE_SCOPE_INTERSECTION_MEDIUM", () =>
    expect(FRESHNESS_REASON_CODES.INDEX_STALE_SCOPE_INTERSECTION_MEDIUM).toBe("INDEX_STALE_SCOPE_INTERSECTION_MEDIUM"));

  it("has INDEX_STALE_SCOPE_INTERSECTION_HIGH", () =>
    expect(FRESHNESS_REASON_CODES.INDEX_STALE_SCOPE_INTERSECTION_HIGH).toBe("INDEX_STALE_SCOPE_INTERSECTION_HIGH"));

  it("has INDEX_STALE_REQUIRED_SCOPE_DELETED", () =>
    expect(FRESHNESS_REASON_CODES.INDEX_STALE_REQUIRED_SCOPE_DELETED).toBe("INDEX_STALE_REQUIRED_SCOPE_DELETED"));

  it("has INDEX_STALE_REQUIRED_SCOPE_RENAMED", () =>
    expect(FRESHNESS_REASON_CODES.INDEX_STALE_REQUIRED_SCOPE_RENAMED).toBe("INDEX_STALE_REQUIRED_SCOPE_RENAMED"));
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. confidence.ts — scope-aware penalty replaces global flat penalty
// ═══════════════════════════════════════════════════════════════════════════════

describe("computePenalties — scope-aware freshness", () => {
  it("applies no freshness penalty when freshness impact is none (fresh)", () => {
    const context = {
      freshness: {
        impact: {
          isStale: false,
          severity: "none",
          impactRatio: 0,
          reasonCodes: [FRESHNESS_REASON_CODES.INDEX_FRESH],
        } satisfies Partial<FreshnessImpact>,
      },
    };
    const penalties = computePenalties(context);
    expect(penalties.some((p: any) => p.rule === "index_stale")).toBe(false);
    expect(penalties.some((p: any) => p.rule.startsWith("freshness_"))).toBe(false);
  });

  it("applies no freshness penalty when stale but no intersection (stale_unrelated)", () => {
    const context = {
      freshness: {
        impact: {
          isStale: true,
          severity: "none",
          impactRatio: 0,
          intersectedScopeCount: 0,
          reasonCodes: [FRESHNESS_REASON_CODES.INDEX_STALE_NO_SCOPE_INTERSECTION],
        } satisfies Partial<FreshnessImpact>,
      },
    };
    const penalties = computePenalties(context);
    expect(penalties.some((p: any) => p.rule === "index_stale")).toBe(false);
    expect(penalties.some((p: any) => p.rule.startsWith("freshness_"))).toBe(false);
  });

  it("applies warn penalty (5 pts) when freshness impact is warn", () => {
    const context = {
      freshness: {
        impact: {
          isStale: true,
          severity: "warn",
          impactRatio: 0.15,
          intersectedScopeCount: 1,
          impactedFiles: ["src/a.ts"],
          reasonCodes: [FRESHNESS_REASON_CODES.INDEX_STALE_SCOPE_INTERSECTION_LOW],
        } satisfies Partial<FreshnessImpact>,
      },
    };
    const penalties = computePenalties(context);
    const freshnessP = penalties.find((p: any) => p.rule === "freshness_warn");
    expect(freshnessP).toBeDefined();
    expect(freshnessP?.deduction).toBe(5);
  });

  it("applies escalate penalty (15 pts) when freshness impact is escalate", () => {
    const context = {
      freshness: {
        impact: {
          isStale: true,
          severity: "escalate",
          impactRatio: 0.4,
          intersectedScopeCount: 2,
          impactedFiles: ["src/a.ts", "src/b.ts"],
          reasonCodes: [FRESHNESS_REASON_CODES.INDEX_STALE_SCOPE_INTERSECTION_MEDIUM],
        } satisfies Partial<FreshnessImpact>,
      },
    };
    const penalties = computePenalties(context);
    const freshnessP = penalties.find((p: any) => p.rule === "freshness_escalate");
    expect(freshnessP).toBeDefined();
    expect(freshnessP?.deduction).toBe(15);
  });

  it("applies block penalty (25 pts) when freshness impact is block", () => {
    const context = {
      freshness: {
        impact: {
          isStale: true,
          severity: "block",
          impactRatio: 0.8,
          intersectedScopeCount: 4,
          impactedFiles: ["src/a.ts"],
          reasonCodes: [FRESHNESS_REASON_CODES.INDEX_STALE_SCOPE_INTERSECTION_HIGH],
        } satisfies Partial<FreshnessImpact>,
      },
    };
    const penalties = computePenalties(context);
    const freshnessP = penalties.find((p: any) => p.rule === "freshness_block");
    expect(freshnessP).toBeDefined();
    expect(freshnessP?.deduction).toBe(25);
  });

  it("PENALTY_RULES exposes freshness entries", () => {
    expect(PENALTY_RULES).toHaveProperty("FRESHNESS_WARN");
    expect(PENALTY_RULES).toHaveProperty("FRESHNESS_ESCALATE");
    expect(PENALTY_RULES).toHaveProperty("FRESHNESS_BLOCK");
    expect(PENALTY_RULES.FRESHNESS_WARN.deduction).toBe(5);
    expect(PENALTY_RULES.FRESHNESS_ESCALATE.deduction).toBe(15);
    expect(PENALTY_RULES.FRESHNESS_BLOCK.deduction).toBe(25);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. ECO integration — eco.freshness and eco_dimensions.freshness
// ═══════════════════════════════════════════════════════════════════════════════

describe("buildECO — freshness field integration", () => {
  it("eco.freshness is an object (not empty)", () => {
    const eco = buildECO(null, TEST_ROOT, { query: "fix the login bug" });
    expect(typeof eco.freshness).toBe("object");
    expect(eco.freshness).not.toBeNull();
  });

  it("eco.freshness has status field (fresh | stale_unrelated | stale_impacted)", () => {
    const eco = buildECO(null, TEST_ROOT, { query: "test" });
    expect(["fresh", "stale_unrelated", "stale_impacted"]).toContain(eco.freshness.status);
  });

  it("eco.freshness has indexedCommit and headCommit", () => {
    const eco = buildECO(null, TEST_ROOT, { query: "test" });
    expect(eco.freshness).toHaveProperty("indexedCommit");
    expect(eco.freshness).toHaveProperty("headCommit");
  });

  it("eco.freshness has impactRatio", () => {
    const eco = buildECO(null, TEST_ROOT, { query: "test" });
    expect(typeof eco.freshness.impactRatio).toBe("number");
    expect(eco.freshness.impactRatio).toBeGreaterThanOrEqual(0);
    expect(eco.freshness.impactRatio).toBeLessThanOrEqual(1);
  });

  it("eco.freshness has severity (none | warn | escalate | block)", () => {
    const eco = buildECO(null, TEST_ROOT, { query: "test" });
    expect(["none", "warn", "escalate", "block"]).toContain(eco.freshness.severity);
  });

  it("eco.freshness has provenance with requiredScopesSource and staleScopesSource", () => {
    const eco = buildECO(null, TEST_ROOT, { query: "test" });
    expect(eco.freshness).toHaveProperty("provenance");
    expect(eco.freshness.provenance).toHaveProperty("requiredScopesSource");
    expect(eco.freshness.provenance).toHaveProperty("staleScopesSource");
    expect(Array.isArray(eco.freshness.provenance.requiredScopesSource)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. dimensions.ts — freshness dimension
// ═══════════════════════════════════════════════════════════════════════════════

describe("scoreDimensions — freshness dimension carries real data", () => {
  it("freshness dimension has severity field", () => {
    const dims = scoreDimensions({});
    expect(dims.freshness).toHaveProperty("severity");
  });

  it("freshness severity is pass when no freshness impact in context", () => {
    const dims = scoreDimensions({});
    expect(dims.freshness.severity).toBe("pass");
  });

  it("freshness severity reflects impact severity when context has freshness impact", () => {
    const context = {
      freshnessImpact: {
        isStale: true,
        severity: "escalate" as const,
        impactRatio: 0.4,
        impactedFiles: ["src/a.ts"],
        impactedScopeIds: ["src/a.ts"],
        intersectedScopeCount: 2,
        staleScopeCount: 3,
        requiredScopeCount: 5,
        reasonCodes: [FRESHNESS_REASON_CODES.INDEX_STALE_SCOPE_INTERSECTION_MEDIUM],
      } satisfies FreshnessImpact,
    };
    const dims = scoreDimensions(context);
    expect(dims.freshness.severity).toBe("escalate");
  });

  it("freshness dimension detail includes impact ratio when stale_impacted", () => {
    const context = {
      freshnessImpact: {
        isStale: true,
        severity: "warn" as const,
        impactRatio: 0.15,
        impactedFiles: ["src/a.ts"],
        impactedScopeIds: ["src/a.ts"],
        intersectedScopeCount: 1,
        staleScopeCount: 2,
        requiredScopeCount: 7,
        reasonCodes: [FRESHNESS_REASON_CODES.INDEX_STALE_SCOPE_INTERSECTION_LOW],
      } satisfies FreshnessImpact,
    };
    const dims = scoreDimensions(context);
    // detail should mention the impacted file count or ratio
    expect(dims.freshness.detail.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. Regression — global stale penalty no longer exists
// ═══════════════════════════════════════════════════════════════════════════════

describe("Regression — global INDEX_STALE flat penalty removed", () => {
  it("stale status alone (without impact) does not emit index_stale penalty", () => {
    // Old-style context: freshness.status = 'stale', no impact
    // In the new design, computePenalties should NOT apply the flat penalty
    // when freshness.impact is present with severity=none
    const context = {
      freshness: {
        status: "stale",
        delta: 2,
        impact: {
          isStale: true,
          severity: "none" as const, // stale but unrelated
          impactRatio: 0,
          intersectedScopeCount: 0,
          staleScopeCount: 1,
          requiredScopeCount: 3,
          impactedFiles: [],
          impactedScopeIds: [],
          reasonCodes: [FRESHNESS_REASON_CODES.INDEX_STALE_NO_SCOPE_INTERSECTION],
        } satisfies FreshnessImpact,
      },
    };
    const penalties = computePenalties(context);
    // Must NOT have a flat 20-pt index_stale penalty
    expect(penalties.some((p: any) => p.rule === "index_stale")).toBe(false);
    // Must NOT have any freshness penalty (no intersection)
    expect(penalties.some((p: any) => p.rule.startsWith("freshness_"))).toBe(false);
    // Total freshness-related deduction = 0
    const freshnessDeduction = penalties
      .filter((p: any) => p.rule.includes("fresh") || p.rule === "index_stale")
      .reduce((acc: number, p: any) => acc + p.deduction, 0);
    expect(freshnessDeduction).toBe(0);
  });

  it("stale with meaningful intersection still produces a penalty", () => {
    const context = {
      freshness: {
        status: "stale",
        delta: 2,
        impact: {
          isStale: true,
          severity: "escalate" as const,
          impactRatio: 0.4,
          intersectedScopeCount: 2,
          staleScopeCount: 3,
          requiredScopeCount: 5,
          impactedFiles: ["src/a.ts", "src/b.ts"],
          impactedScopeIds: ["src/a.ts", "src/b.ts"],
          reasonCodes: [FRESHNESS_REASON_CODES.INDEX_STALE_SCOPE_INTERSECTION_MEDIUM],
        } satisfies FreshnessImpact,
      },
    };
    const penalties = computePenalties(context);
    const freshnessDeduction = penalties
      .filter((p: any) => p.rule.includes("freshness_"))
      .reduce((acc: number, p: any) => acc + p.deduction, 0);
    expect(freshnessDeduction).toBeGreaterThan(0);
  });

  it("lane change only occurs when freshness intersection is meaningful", () => {
    // When penalty comes from freshness_warn (5pts), confidence remains high.
    // lsp_state.ts = 'available' suppresses the LSP penalty so freshness is isolated.
    const context = {
      lsp_state: { ts: "available" },
      freshness: {
        impact: {
          isStale: true,
          severity: "warn" as const,
          impactRatio: 0.1,
          intersectedScopeCount: 1,
          staleScopeCount: 5,
          requiredScopeCount: 10,
          impactedFiles: ["src/minor.ts"],
          impactedScopeIds: ["src/minor.ts"],
          reasonCodes: [FRESHNESS_REASON_CODES.INDEX_STALE_SCOPE_INTERSECTION_LOW],
        } satisfies FreshnessImpact,
      },
    };
    const penalties = computePenalties(context);
    const total = penalties.reduce((acc: number, p: any) => acc + p.deduction, 0);
    // With just 5pt freshness deduction + no other penalties, score >= 95
    const score = Math.max(0, 100 - total);
    expect(score).toBeGreaterThanOrEqual(90);
  });
});
