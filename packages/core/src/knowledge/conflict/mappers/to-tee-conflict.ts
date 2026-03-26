// Maps ConflictRecord[] to TEEConflictSection — injected into the Task Execution Envelope.
// Converts conflict findings into actionable blocked_paths, blocked_symbols,
// clarification_questions, and proceed_warnings.

import type { ConflictRecord, TEEConflictSection } from '../types.js';

export function toTEEConflictSection(conflicts: ConflictRecord[]): TEEConflictSection {
  const blocked_paths: string[] = [];
  const blocked_symbols: string[] = [];
  const clarification_questions: string[] = [];
  const proceed_warnings: string[] = [];

  for (const conflict of conflicts) {
    if (conflict.resolution_hint === 'must_block') {
      // Extract files/symbols as blocked paths
      for (const f of conflict.scope.files ?? []) {
        if (!blocked_paths.includes(f)) blocked_paths.push(f);
      }
      for (const s of conflict.scope.symbols ?? []) {
        if (!blocked_symbols.includes(s)) blocked_symbols.push(s);
      }
    } else if (conflict.resolution_hint === 'needs_clarification') {
      const question = buildClarificationQuestion(conflict);
      if (!clarification_questions.includes(question)) {
        clarification_questions.push(question);
      }
    } else if (conflict.resolution_hint === 'needs_explore') {
      const warning = `[EXPLORE] ${conflict.summary}`;
      if (!proceed_warnings.includes(warning)) proceed_warnings.push(warning);
    } else if (conflict.resolution_hint === 'can_proceed_with_warning') {
      const warning = `[WARN] ${conflict.summary}`;
      if (!proceed_warnings.includes(warning)) proceed_warnings.push(warning);
    }
  }

  return { blocked_paths, blocked_symbols, clarification_questions, proceed_warnings };
}

function buildClarificationQuestion(conflict: ConflictRecord): string {
  switch (conflict.type) {
    case 'ambiguity_cluster':
      return `Which of the following targets should be modified? ${(conflict.scope.claims ?? []).slice(0, 4).join(', ')}`;
    case 'multi_source_disagreement':
      return `Sources disagree on: ${conflict.summary}. Which source should be treated as authoritative?`;
    case 'ownership_overlap':
      return `The change spans ${(conflict.scope.modules ?? []).join(' and ')}. Which zone owns this requirement?`;
    case 'source_claim_contradiction':
      return `Contradictory claims detected: ${conflict.summary}. Which claim reflects the correct behavior?`;
    default:
      return `Clarification needed: ${conflict.summary}`;
  }
}
