export type {
  Tier,
  ReasonCode,
  DecisionSource,
  CandidateFile,
  ScopeDecision,
  AppContext,
  Framework,
  RepoContext,
  CompiledPattern,
  ScopePolicy,
  ExplainScopeResult,
  ScopeSummary,
} from './types.js';

export { discoverCandidates } from './candidates.js';
export { detectRepoContext } from './context.js';
export { loadScopePolicy, describeScopePolicy, type CliScopeOpts, type PolicySummary } from './policy.js';
export {
  classifyFile,
  isFrameworkCritical,
  isExecutionCritical,
  isKnownNoise,
  globToRegex,
  matchesGlob,
  isBinaryByExtension,
} from './classifier.js';
export {
  buildScopeSummary,
  printScopeSummary,
  explainScope,
  printExplainScope,
} from './summary.js';
