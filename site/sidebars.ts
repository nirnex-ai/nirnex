/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  mainSidebar: [

    // ── INTRODUCTION ─────────────────────────────────────────
    {
      type: 'category',
      label: '00 · Introduction',
      collapsed: false,
      items: [
        'intro/overview',
        'intro/design-principles',
        'intro/three-lanes',
        'intro/dual-inputs',
        'intro/roadmap',
      ],
    },

    // ── KNOWLEDGE ENGINE ─────────────────────────────────────
    {
      type: 'category',
      label: '01 · Knowledge Engine',
      collapsed: false,
      items: [
        'knowledge-engine/overview',
        'knowledge-engine/parsing-layer',
        'knowledge-engine/storage-layer',
        'knowledge-engine/retrieval-sources',
        'knowledge-engine/query-router',
        'knowledge-engine/confidence-scoring',
      ],
    },

    // ── INTENT & ECO ─────────────────────────────────────────
    {
      type: 'category',
      label: '02 · Intent & ECO',
      collapsed: false,
      items: [
        'architecture/intent-detection',
        'architecture/eco-schema',
        'architecture/eco-dimensions',
        'architecture/severity-escalation',
        'architecture/dynamic-reclassification',
      ],
    },

    // ── TASK PIPELINE ────────────────────────────────────────
    {
      type: 'category',
      label: '03 · Task Pipeline',
      collapsed: false,
      items: [
        'task-pipeline/overview',
        'task-pipeline/strategy-selection',
        'task-pipeline/task-execution-envelope',
        'task-pipeline/decomposition',
      ],
    },

    // ── DECISION LEDGER ──────────────────────────────────────
    {
      type: 'category',
      label: '04 · Decision Ledger',
      collapsed: false,
      items: [
        'decision-ledger/overview',
        'decision-ledger/trace-schema',
        'decision-ledger/ground-truth-sampling',
        'decision-ledger/replay-calibration',
        'decision-ledger/operational-contracts',
      ],
    },

    // ── REFERENCE ────────────────────────────────────────────
    {
      type: 'category',
      label: '05 · Reference',
      collapsed: true,
      items: [
        'architecture/design-boundaries',
        'architecture/tool-decisions',
        'architecture/adoption-design',
      ],
    },

    // ── BUSINESS CASE ────────────────────────────────────────
    {
      type: 'category',
      label: '06 · Business Case',
      collapsed: true,
      items: [
        'business/executive-summary',
        'business/3cs-analysis',
        'business/customer-segmentation',
        'business/competitive-matrix',
        'business/pricing',
        'business/go-to-market',
        'business/next-steps',
      ],
    },

  ],
};

module.exports = sidebars;
