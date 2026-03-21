import { execSync } from 'child_process';
import { openDb } from './db.js';
import path from 'path';

export const PENALTY_RULES = {
  LSP_UNAVAILABLE: { id: "lsp_unavailable", deduction: 25 },
  INDEX_STALE: { id: "index_stale", deduction: 20 },
  CROSS_LAYER_CONFLICT: { id: "cross_layer_conflict", deduction: 20 },
  HUB_NODE_CAP: { id: "hub_node_cap", deduction: 15 },
  SUMMARY_ONLY_EVIDENCE: { id: "summary_only_evidence", deduction: 15 },
  CTAGS_FALLBACK: { id: "ctags_fallback", deduction: 10 },
  VECTOR_DORMANT_TRIGGERED: { id: "vector_dormant_triggered", deduction: 10 },
  GRAPH_DEPTH_TRUNCATED: { id: "graph_depth_truncated", deduction: 10 },
  DIRTY_WORKING_TREE: { id: "dirty_working_tree", deduction: 10 },
  TIER_3_4_DEGRADATION: { id: "tier_3_4_degradation", deduction: 30 },
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
  if (context.freshness?.status === 'stale') {
    penalties.push({ rule: PENALTY_RULES.INDEX_STALE.id, deduction: PENALTY_RULES.INDEX_STALE.deduction, detail: context.freshness.delta + ' commit(s) behind' });
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
