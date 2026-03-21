import fs from 'fs';

export function detectIntent(specPath: string | null, opts?: { query?: string }) {
  if (!specPath && opts?.query) return { primary: "quick_fix", composite: false };

  const content = fs.readFileSync(specPath!, 'utf8').toLowerCase();
  
  const signals = {
    new_feature: ["in scope", "out of scope", "acceptance criteria"],
    bug_fix: ["reproduction steps", "expected vs actual"],
    refactor: ["current structure", "target structure"],
    dep_update: ["old dependency", "new dependency"],
    config_infra: ["env var", "config", "environment variable"]
  };

  const detected: string[] = [];
  for (const [intent, keywords] of Object.entries(signals)) {
    if (keywords.some(kw => content.includes(kw))) detected.push(intent);
  }

  if (detected.length === 0) return { primary: "unknown", confidence: "low", composite: false };
  if (detected.length >= 3) return { error: "split spec file into multiple intents" };
  
  if (detected.length === 2) return {
    primary: detected[0],
    secondary: detected[1],
    composite: true,
    retrieval_strategy: ["union"],
    constraint_rule: "strictest_of_both"
  };

  return { primary: detected[0], composite: false };
}
