// Claim extractor — converts evidence items into normalized Claim records.
// Uses bounded, pattern-based extraction only. No LLM inference.

import { randomUUID } from 'crypto';
import type { Claim, ClaimPolarity, EvidenceItem, ConflictEvidenceSource } from '../types.js';

// Polarity patterns matched against sentence content
type PolarityPattern = {
  polarity: ClaimPolarity;
  patterns: RegExp[];
};

const POLARITY_PATTERNS: PolarityPattern[] = [
  // More-specific / negative patterns must come before broad positive ones
  {
    polarity: 'forbids',
    patterns: [
      /\bmust not\b/i, /\bshould not\b/i, /\bcannot\b/i,
      /\bforbids?\b/i, /\bprohibited\b/i, /\bnot allowed\b/i,
      /\bdo not use\b/i, /\bavoid\b/i,
    ],
  },
  {
    polarity: 'denies',
    patterns: [
      /\bdoes not\b/i, /\bdoesn't\b/i, /\bnot implemented\b/i,
      /\bmissing\b/i, /\bnot found\b/i, /\bno .+ check\b/i,
      /\bno .+ validation\b/i, /\bnever\b/i,
    ],
  },
  {
    polarity: 'requires',
    patterns: [
      /\bmust use\b/i, /\bshould use\b/i, /\brequires?\b/i,
      /\bdepends on\b/i, /\bmust call\b/i, /\bmust go through\b/i,
      /\bneeds to use\b/i, /\bexpected to use\b/i,
    ],
  },
  {
    polarity: 'implements',
    patterns: [
      /\bimplements?\b/i, /\bwired up\b/i, /\bintegrated\b/i,
      /\bconnects? to\b/i, /\bcalls?\b/i,
    ],
  },
  {
    polarity: 'asserts',
    patterns: [
      /\balready\b/i, /\bcurrently\b/i, /\bis implemented\b/i,
      /\bdoes\b/i, /\bprovides?\b/i, /\bcontains?\b/i,
      /\bhandles?\b/i, /\bvalidates?\b/i,
    ],
  },
];

// Subject extraction: look for noun phrases after common predicates
const SUBJECT_PATTERNS = [
  /the\s+([a-z][a-z\s-]{2,30}?)\s+(?:must|should|is|does|cannot|will)/i,
  /([a-z][a-z\s-]{2,30}?)\s+(?:validation|check|service|module|logic|handler|component)/i,
  /(?:for|in)\s+([a-z][a-z\s-]{2,30}?)[\s,:]/i,
];

function extractSubject(text: string, fallback: string): string {
  for (const pattern of SUBJECT_PATTERNS) {
    const m = text.match(pattern);
    if (m && m[1] && m[1].trim().length > 2) {
      return m[1].trim().toLowerCase();
    }
  }
  return fallback;
}

function detectPolarity(sentence: string): ClaimPolarity {
  for (const { polarity, patterns } of POLARITY_PATTERNS) {
    if (patterns.some(p => p.test(sentence))) {
      return polarity;
    }
  }
  return 'asserts'; // neutral default
}

function splitIntoSentences(text: string): string[] {
  return text
    .split(/[.!?\n]/)
    .map(s => s.trim())
    .filter(s => s.length > 15 && s.length < 300);
}

function sourceToConflictSource(src: EvidenceItem['source']): ConflictEvidenceSource {
  return src as ConflictEvidenceSource;
}

export function extractClaims(evidence: EvidenceItem[]): Claim[] {
  const claims: Claim[] = [];

  for (const item of evidence) {
    const sentences = splitIntoSentences(item.content);

    for (const sentence of sentences) {
      const polarity = detectPolarity(sentence);
      const subject = extractSubject(sentence, item.ref);

      // Compute predicate as the polarity trigger phrase (first match)
      let predicate: string = polarity;
      for (const { patterns } of POLARITY_PATTERNS) {
        for (const p of patterns) {
          const m = sentence.match(p);
          if (m) {
            predicate = m[0].trim();
            break;
          }
        }
        if (predicate !== polarity) break;
      }

      // Object: remainder of sentence after predicate phrase, trimmed
      const object = sentence.replace(new RegExp(predicate, 'i'), '').trim().slice(0, 100) || sentence.slice(0, 100);

      // Confidence: higher for explicit polarity signals, lower for neutral
      const confidence = polarity === 'asserts' ? 0.5 : 0.75;

      claims.push({
        id: randomUUID(),
        subject,
        predicate,
        object,
        polarity,
        sourceRef: {
          source: sourceToConflictSource(item.source),
          ref: item.ref,
          excerpt: sentence.slice(0, 120),
        },
        confidence,
      });
    }
  }

  return claims;
}
