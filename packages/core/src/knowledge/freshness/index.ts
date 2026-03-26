export type {
  FreshnessSnapshot,
  RequiredScopeRef,
  StaleScopeRef,
  FreshnessImpact,
  FreshnessDimensionEntry,
} from './types.js';

export { FRESHNESS_REASON_CODES } from './freshness-reason-codes.js';
export type { FreshnessReasonCode } from './freshness-reason-codes.js';

export { buildFreshnessSnapshot } from './build-freshness-snapshot.js';
export { extractStaleScopes } from './extract-stale-scopes.js';
export { extractRequiredScopes } from './extract-required-scopes.js';
export { computeFreshnessImpact } from './compute-freshness-impact.js';
