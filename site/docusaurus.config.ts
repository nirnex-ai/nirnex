const { themes } = require('prism-react-renderer');
const lightCodeTheme = themes.github;
const darkCodeTheme = themes.dracula;

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Nirnex',
  tagline: 'Decision Intelligence for Software Delivery',
  url: 'https://nirnex-ai.github.io',
  baseUrl: '/nirnex/',
  onBrokenLinks: 'throw',
  favicon: 'img/favicon.ico',
  organizationName: 'nirnex-ai',
  projectName: 'nirnex',
  trailingSlash: false,

  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  themes: ['@docusaurus/theme-mermaid'],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      colorMode: {
        defaultMode: 'dark',
        disableSwitch: false,
        respectPrefersColorScheme: true,
      },

      mermaid: {
        theme: { light: 'dark', dark: 'dark' },
      },

      navbar: {
        title: '',
        logo: {
          alt: 'Nirnex',
          src: 'img/nirnex-logo-navbar.svg',
          height: 32,
        },
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
            docId: 'architecture/eco-schema',
            position: 'left',
            label: 'Technical Spec',
          },
          {
            to: '/docs/intro/roadmap',
            label: 'Roadmap',
            position: 'left',
          },
          {
            type: 'doc',
            docId: 'intro/overview',
            position: 'left',
            label: 'Docs',
          },
          {
            href: 'https://github.com/nirnex-ai/nirnex',
            label: 'GitHub',
            position: 'right',
            className: 'navbar__link--github',
          },
          {
            to: '/docs/business/executive-summary',
            label: 'Business Case',
            position: 'right',
            className: 'navbar__link--secondary',
          },
          {
            to: '/docs/intro/overview',
            label: 'See the Architecture',
            position: 'right',
            className: 'navbar__link--cta',
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
        copyright: `&copy; ${new Date().getFullYear()} Nirnex· AI Company`,
      },

      prism: {
        theme: lightCodeTheme,
        darkTheme: darkCodeTheme,
        additionalLanguages: ['bash', 'json', 'typescript', 'python', 'sql'],
      },

      docs: {
        sidebar: {
          hideable: false,
          autoCollapseCategories: false,
        },
      },
    }),

  plugins: [
    [
      '@docusaurus/plugin-google-gtag',
      {
        trackingID: 'G-RD2P2RGQLL',
        anonymizeIP: false,
      },
    ],
  ],

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: require.resolve('./sidebars.ts'),
          editUrl: 'https://github.com/nirnex-ai/nirnex/edit/nirnex-site/site/',
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
