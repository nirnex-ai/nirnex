import { execSync } from 'child_process';
import { openDb } from './db.js';
import path from 'path';

export const PENALTY_RULES = {
  LSP_UNAVAILABLE: { id: "lsp_unavailable", deduction: 25 },
  /**
   * @deprecated INDEX_STALE is the legacy flat penalty.
   * Use FRESHNESS_WARN / FRESHNESS_ESCALATE / FRESHNESS_BLOCK instead.
   * Kept for backward compatibility with callers that do not yet provide
   * a FreshnessImpact. Will be removed in a future major release.
   */
  INDEX_STALE: { id: "index_stale", deduction: 20 },
  CROSS_LAYER_CONFLICT: { id: "cross_layer_conflict", deduction: 20 },
  HUB_NODE_CAP: { id: "hub_node_cap", deduction: 15 },
  SUMMARY_ONLY_EVIDENCE: { id: "summary_only_evidence", deduction: 15 },
  CTAGS_FALLBACK: { id: "ctags_fallback", deduction: 10 },
  VECTOR_DORMANT_TRIGGERED: { id: "vector_dormant_triggered", deduction: 10 },
  GRAPH_DEPTH_TRUNCATED: { id: "graph_depth_truncated", deduction: 10 },
  DIRTY_WORKING_TREE: { id: "dirty_working_tree", deduction: 10 },
  TIER_3_4_DEGRADATION: { id: "tier_3_4_degradation", deduction: 30 },
  /** Scope-aware freshness penalty — stale scopes intersect required at low ratio (<0.25). */
  FRESHNESS_WARN:     { id: "freshness_warn",     deduction: 5  },
  /** Scope-aware freshness penalty — intersection at medium ratio (≥0.25, <0.60). */
  FRESHNESS_ESCALATE: { id: "freshness_escalate", deduction: 15 },
  /** Scope-aware freshness penalty — intersection at high ratio (≥0.60) or deleted/renamed scope. */
  FRESHNESS_BLOCK:    { id: "freshness_block",    deduction: 25 },
};

export function checkFreshness(targetDir: string) {
  try {
    const dbPath = path.join(targetDir, '.aidos.db');
    const db = openDb(dbPath);
    const meta = db.prepare('SELECT value FROM _meta WHERE key = ?').get('commit_hash') as { value: string } | undefined;
    const currentHead = execSync('git rev-parse HEAD', { cwd: targetDir, encoding: 'utf8' }).trim();
    
    if (meta && meta.value === currentHead) {
      return { status: 'fresh', delta: 0, index_commit: meta.value, head_commit: currentHead };
    }
    
    // Stale check
    let delta = 1;
    if (meta) {
      try {
        const diff = execSync('git rev-list --count ' + meta.value + '..HEAD', { cwd: targetDir, encoding: 'utf8' });
        delta = parseInt(diff.trim(), 10) || 1;
      } catch (e) {}
    }
    
    let severity = 'escalate';
    if (delta >= 3) severity = 'block';
    
    return { status: 'stale', delta, index_commit: meta?.value || 'none', head_commit: currentHead, dimension_severity: severity };
  } catch (err) {
    return { status: 'unknown', delta: 0 };
  }
}

export function computePenalties(context: any) {
  const penalties: any[] = [];

  if (context.lsp_state?.ts !== 'available') {
    penalties.push({ rule: PENALTY_RULES.LSP_UNAVAILABLE.id, deduction: PENALTY_RULES.LSP_UNAVAILABLE.deduction, detail: 'TypeScript LSP not running' });
  }

  // ── Scope-aware freshness penalty (replaces the old flat INDEX_STALE rule) ─
  // When a FreshnessImpact is available, use it for a deterministic,
  // intersection-based penalty. No intersection = no penalty, even if stale.
  // Legacy path (no impact) kept only for backward compatibility.
  const freshnessImpact = context.freshness?.impact;
  if (freshnessImpact) {
    // New path: scope-aware, graduated penalty
    const severity: string = freshnessImpact.severity ?? 'none';
    if (severity === 'warn') {
      const files: string[] = freshnessImpact.impactedFiles ?? [];
      const detail = files.length
        ? `Stale scope in required path(s): ${files.slice(0, 3).join(', ')}`
        : 'Stale scope intersects required scope (low)';
      penalties.push({ rule: PENALTY_RULES.FRESHNESS_WARN.id, deduction: PENALTY_RULES.FRESHNESS_WARN.deduction, detail });
    } else if (severity === 'escalate') {
      const count: number = freshnessImpact.intersectedScopeCount ?? 0;
      penalties.push({
        rule:      PENALTY_RULES.FRESHNESS_ESCALATE.id,
        deduction: PENALTY_RULES.FRESHNESS_ESCALATE.deduction,
        detail:    `${count} stale required scope(s) need reindex (impact ratio: ${((freshnessImpact.impactRatio ?? 0) * 100).toFixed(0)}%)`,
      });
    } else if (severity === 'block') {
      const codes: string[] = freshnessImpact.reasonCodes ?? [];
      const hasDeleted = codes.includes('INDEX_STALE_REQUIRED_SCOPE_DELETED');
      const detail = hasDeleted
        ? 'Required scope was deleted — reindex required before planning'
        : `Stale scope covers ${((freshnessImpact.impactRatio ?? 0) * 100).toFixed(0)}% of required paths`;
      penalties.push({ rule: PENALTY_RULES.FRESHNESS_BLOCK.id, deduction: PENALTY_RULES.FRESHNESS_BLOCK.deduction, detail });
    }
    // severity === 'none' → no penalty (fresh or stale_unrelated)
  } else if (context.freshness?.status === 'stale') {
    // Legacy path: no FreshnessImpact available — apply the old flat penalty
    // (only reached when callers have not yet been migrated to the new API)
    penalties.push({ rule: PENALTY_RULES.INDEX_STALE.id, deduction: PENALTY_RULES.INDEX_STALE.deduction, detail: (context.freshness.delta ?? '?') + ' commit(s) behind' });
  }

  if (context.working_tree === 'dirty') {
    penalties.push({ rule: PENALTY_RULES.DIRTY_WORKING_TREE.id, deduction: PENALTY_RULES.DIRTY_WORKING_TREE.deduction, detail: 'Uncommitted changes in tree' });
  }
  if (context.graph_result?.hub_boundaries?.length) {
    penalties.push({ rule: PENALTY_RULES.HUB_NODE_CAP.id, deduction: PENALTY_RULES.HUB_NODE_CAP.deduction, detail: 'Graph reached hub cap' });
  }

  let preTier = computeDegradationTier(penalties);
  if (preTier >= 3) {
    penalties.push({ rule: PENALTY_RULES.TIER_3_4_DEGRADATION.id, deduction: PENALTY_RULES.TIER_3_4_DEGRADATION.deduction, detail: 'Compound tier degradation' });
  }

  return penalties;
}

export function computeConfidence(penalties: any[]) {
  const sum = penalties.reduce((acc, p) => acc + p.deduction, 0);
  const score = Math.max(0, 100 - sum);
  return { score, penalties };
}

export function getConfidenceLabel(score: number | null | undefined): string {
  if (score == null) return 'unknown';
  if (score >= 80) return 'high';
  if (score >= 60) return 'medium';
  if (score >= 40) return 'low';
  if (score >= 20) return 'unreliable';
  return 'insufficient_evidence';
}

export function computeDegradationTier(penalties: any[]): number {
  const sum = penalties.reduce((acc, p) => acc + p.deduction, 0);
  if (sum === 0) return 1;
  if (sum <= 25) return 2;
  if (sum <= 55) return 3;
  return 4;
}

export function getSuggestedNext(score: number, context: string) {
  if (score >= 80) return { action: 'Proceed with auto generation', allows_automated: true, reason: 'High confidence index match' };
  if (score >= 60) return { action: 'Narrow search constraints or reindex', allows_automated: false, reason: 'Medium confidence results' };
  if (score >= 40) return { action: 'Human verification required', allows_automated: false, reason: 'Low confidence matching' };
  return { action: 'Stop automated processing, manual investigation required', allows_automated: false, reason: 'Insufficient or unreliable index' };
}
