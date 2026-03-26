/**
 * Pipeline Validators — Structural input/output validation (no Zod)
 *
 * Each validator is a pure function: (value: unknown) → ValidationResult
 * Validators enforce shape contracts at stage boundaries. They do NOT
 * perform semantic validation — that's the executor's concern.
 *
 * Design constraints:
 *   - Pure functions — no side effects, no I/O
 *   - No external dependencies (no Zod, no ajv)
 *   - Return { valid: true } or { valid: false, reason: string }
 */

import type { ValidationResult } from "./types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ok(): ValidationResult { return { valid: true }; }
function fail(reason: string): ValidationResult { return { valid: false, reason }; }

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isString(v: unknown): v is string { return typeof v === "string"; }
function isNumber(v: unknown): v is number { return typeof v === "number"; }
function isArray(v: unknown): v is unknown[] { return Array.isArray(v); }

function hasKey(obj: Record<string, unknown>, key: string): boolean {
  return key in obj;
}

// ─── INTENT_DETECT ────────────────────────────────────────────────────────────

/**
 * Input: { specPath: string | null, query?: string }
 */
export function validateIntentDetectInput(value: unknown): ValidationResult {
  if (!isObject(value)) return fail("input must be an object");

  // specPath must be string or null
  if (!hasKey(value, "specPath")) return fail("missing required field: specPath");
  const specPath = value["specPath"];
  if (specPath !== null && !isString(specPath)) {
    return fail("specPath must be a string or null");
  }

  // query is optional but must be string if present
  if (hasKey(value, "query") && !isString(value["query"])) {
    return fail("query must be a string");
  }

  return ok();
}

/**
 * Output: { primary: string, composite: boolean, ...optional }
 */
export function validateIntentDetectOutput(value: unknown): ValidationResult {
  if (!isObject(value)) return fail("output must be an object");
  if (!hasKey(value, "primary") || !isString(value["primary"])) {
    return fail("output must have primary: string");
  }
  return ok();
}

// ─── ECO_BUILD ────────────────────────────────────────────────────────────────

/**
 * Input: { intent: { primary: string, ... }, specPath: string | null, ... }
 */
export function validateEcoBuildInput(value: unknown): ValidationResult {
  if (!isObject(value)) return fail("input must be an object");
  if (!hasKey(value, "intent") || !isObject(value["intent"])) {
    return fail("input must have intent: object");
  }
  const intent = value["intent"] as Record<string, unknown>;
  if (!hasKey(intent, "primary") || !isString(intent["primary"])) {
    return fail("intent.primary must be a string");
  }
  return ok();
}

/**
 * Output: { intent, eco_dimensions: { coverage, freshness, mapping, conflict, graph }, confidence_score }
 */
export function validateEcoBuildOutput(value: unknown): ValidationResult {
  if (!isObject(value)) return fail("output must be an object");
  if (!hasKey(value, "eco_dimensions") || !isObject(value["eco_dimensions"])) {
    return fail("output must have eco_dimensions: object");
  }
  const dims = value["eco_dimensions"] as Record<string, unknown>;
  for (const dim of ["coverage", "freshness", "mapping", "conflict", "graph"] as const) {
    if (!hasKey(dims, dim) || !isObject(dims[dim])) {
      return fail(`eco_dimensions.${dim} must be an object`);
    }
    const d = dims[dim] as Record<string, unknown>;
    if (!hasKey(d, "severity") || !isString(d["severity"])) {
      return fail(`eco_dimensions.${dim}.severity must be a string`);
    }
  }
  if (!hasKey(value, "confidence_score") || !isNumber(value["confidence_score"])) {
    return fail("output must have confidence_score: number");
  }
  return ok();
}

// ─── SUFFICIENCY_GATE ─────────────────────────────────────────────────────────

/**
 * Input: eco object with confidence_score and eco_dimensions
 */
export function validateSufficiencyGateInput(value: unknown): ValidationResult {
  // Reuse ECO_BUILD output validation — same shape
  if (!isObject(value)) return fail("input must be an object");
  if (!hasKey(value, "confidence_score") || !isNumber(value["confidence_score"])) {
    return fail("input must have confidence_score: number");
  }
  if (!hasKey(value, "eco_dimensions") || !isObject(value["eco_dimensions"])) {
    return fail("input must have eco_dimensions: object");
  }
  return ok();
}

/**
 * Output: { behavior: 'pass'|'block'|'ask'|'explore', lane: string, reason: string }
 */
export function validateSufficiencyGateOutput(value: unknown): ValidationResult {
  if (!isObject(value)) return fail("output must be an object");
  if (!hasKey(value, "behavior") || !isString(value["behavior"])) {
    return fail("output must have behavior: string");
  }
  const validBehaviors = ["pass", "block", "ask", "explore"];
  if (!validBehaviors.includes(value["behavior"] as string)) {
    return fail(`behavior must be one of: ${validBehaviors.join(", ")}`);
  }
  if (!hasKey(value, "lane") || !isString(value["lane"])) {
    return fail("output must have lane: string");
  }
  if (!hasKey(value, "reason") || !isString(value["reason"])) {
    return fail("output must have reason: string");
  }
  return ok();
}

// ─── TEE_BUILD ────────────────────────────────────────────────────────────────

/**
 * Input: { eco: object, gate: object }
 */
export function validateTeeBuildInput(value: unknown): ValidationResult {
  if (!isObject(value)) return fail("input must be an object");
  if (!hasKey(value, "eco") || !isObject(value["eco"])) {
    return fail("input must have eco: object");
  }
  if (!hasKey(value, "gate") || !isObject(value["gate"])) {
    return fail("input must have gate: object");
  }
  return ok();
}

/**
 * Output: { blocked_paths, blocked_symbols, clarification_questions, proceed_warnings }
 */
export function validateTeeBuildOutput(value: unknown): ValidationResult {
  if (!isObject(value)) return fail("output must be an object");
  const required = ["blocked_paths", "blocked_symbols", "clarification_questions", "proceed_warnings"] as const;
  for (const field of required) {
    if (!hasKey(value, field)) return fail(`output must have ${field}: array`);
    if (!isArray(value[field])) return fail(`${field} must be an array`);
  }
  return ok();
}

// ─── CLASSIFY_LANE ────────────────────────────────────────────────────────────

/**
 * Input: { eco: object, tee: object }
 */
export function validateClassifyLaneInput(value: unknown): ValidationResult {
  if (!isObject(value)) return fail("input must be an object");
  if (!hasKey(value, "eco") || !isObject(value["eco"])) {
    return fail("input must have eco: object");
  }
  if (!hasKey(value, "tee") || !isObject(value["tee"])) {
    return fail("input must have tee: object");
  }
  return ok();
}

/**
 * Output: { lane: string, set_by: 'P1'|'P2'|'P3'|'P4', reason: string }
 */
export function validateClassifyLaneOutput(value: unknown): ValidationResult {
  if (!isObject(value)) return fail("output must be an object");
  if (!hasKey(value, "lane") || !isString(value["lane"])) {
    return fail("output must have lane: string");
  }
  if (!hasKey(value, "set_by") || !isString(value["set_by"])) {
    return fail("output must have set_by: string");
  }
  const validSetBy = ["P1", "P2", "P3", "P4"];
  if (!validSetBy.includes(value["set_by"] as string)) {
    return fail(`set_by must be one of: ${validSetBy.join(", ")}`);
  }
  return ok();
}
