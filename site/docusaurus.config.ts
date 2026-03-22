const { themes } = require('prism-react-renderer');
const lightCodeTheme = themes.dracula;

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Nirnex',
  tagline: 'Decision Intelligence for Software Delivery',
  url: 'https://nirnex-ai.github.io',
  baseUrl: '/',
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',
  favicon: 'img/favicon.ico',
  organizationName: 'nirnex-ai',
  projectName: 'nirnex-site',
  trailingSlash: false,

  markdown: {
    mermaid: true,
  },

  themes: ['@docusaurus/theme-mermaid'],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      colorMode: {
        defaultMode: 'light',
        disableSwitch: true,         // brutalist light mode only
        respectPrefersColorScheme: false,
      },

      mermaid: {
        theme: { light: 'dark', dark: 'dark' },
      },

      navbar: {
        title: 'Nirnex',
        hideOnScroll: false,
        style: 'dark',
        items: [
          {
            type: 'doc',
            docId: 'intro/overview',
            position: 'left',
            label: 'Architecture',
          },
          {
            type: 'doc',
            docId: 'business/executive-summary',
            position: 'left',
            label: 'Business Case',
          },
          {
            type: 'doc',
            docId: 'architecture/system-overview',
            position: 'left',
            label: 'Technical Spec',
          },
          {
            to: '/docs/intro/roadmap',
            label: 'Roadmap',
            position: 'left',
          },
          {
            href: 'https://github.com/ai-delivery-os',
            label: 'Request Access →',
            position: 'right',
          },
        ],
      },

      footer: {
        style: 'dark',
        links: [
          {
            title: 'Architecture',
            items: [
              { label: 'System Overview', to: '/docs/intro/overview' },
              { label: 'Knowledge Engine', to: '/docs/knowledge-engine/overview' },
              { label: 'Task Orchestrator', to: '/docs/task-pipeline/overview' },
              { label: 'Decision Ledger', to: '/docs/decision-ledger/overview' },
            ],
          },
          {
            title: 'Reference',
            items: [
              { label: 'ECO Schema', to: '/docs/architecture/eco-schema' },
              { label: 'Confidence Scoring', to: '/docs/knowledge-engine/confidence-scoring' },
              { label: 'Design Boundaries', to: '/docs/architecture/design-boundaries' },
              { label: 'Tool Decisions', to: '/docs/architecture/tool-decisions' },
            ],
          },
          {
            title: 'Business',
            items: [
              { label: 'Executive Summary', to: '/docs/business/executive-summary' },
              { label: '3Cs Analysis', to: '/docs/business/3cs-analysis' },
              { label: 'Competitive Matrix', to: '/docs/business/competitive-matrix' },
              { label: 'Pricing Guidance', to: '/docs/business/pricing' },
            ],
          },
        ],
        copyright: `AI DELIVERY OS · V9.0 · MARCH 2026 · IMPLEMENTATION-READY SPECIFICATION`,
      },

      prism: {
        theme: lightCodeTheme,
        darkTheme: lightCodeTheme,
        additionalLanguages: ['bash', 'json', 'typescript', 'python', 'sql'],
      },

      docs: {
        sidebar: {
          hideable: false,
          autoCollapseCategories: false,
        },
      },
    }),

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: require.resolve('./sidebars.js'),
          editUrl: 'https://github.com/ai-delivery-os/docs/edit/main/',
          showLastUpdateTime: true,
          remarkPlugins: [],
          rehypePlugins: [],
        },
        blog: false,    // no blog
        theme: {
          customCss: require.resolve('./src/css/custom.css'),
        },
      }),
    ],
  ],
};

module.exports = config;
