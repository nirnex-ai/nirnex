/**
 * Explicit rule tables for the Nirnex scope classifier.
 *
 * All rules are path-based and expressed as:
 *   - Directory prefixes (ending with /)
 *   - File extension suffixes
 *   - Exact filenames
 *   - Glob-style patterns matched against repo-root-relative paths
 *
 * Rules are table-driven. To add or change a rule, edit the array.
 * Do not add inline logic to the classifier helpers — update these tables.
 */

// ─── Binary / non-indexable extensions ───────────────────────────────────────

export const BINARY_EXTENSIONS = new Set([
  // Images
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.avif',
  '.tiff', '.tif', '.heic', '.raw',
  // Video
  '.mp4', '.mov', '.avi', '.webm', '.mkv', '.flv', '.wmv', '.m4v',
  // Audio
  '.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma',
  // Documents / archives
  '.pdf', '.zip', '.tar', '.gz', '.tgz', '.bz2', '.rar', '.7z', '.xz',
  // Fonts
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  // Compiled / native
  '.exe', '.dll', '.so', '.dylib', '.o', '.a', '.lib', '.obj',
  // Data blobs
  '.db', '.sqlite', '.sqlite3', '.mdb',
  // Certificates / keys
  '.pem', '.key', '.crt', '.cer', '.p12', '.pfx',
  // Misc
  '.pyc', '.class', '.jar', '.war',
]);

// Extensions Nirnex can currently parse
export const SUPPORTED_EXTENSIONS = new Set(['.ts', '.tsx']);

// ─── Known noise — directory prefixes (repo-root-relative, forward slashes) ──

export const NOISE_DIR_PREFIXES: ReadonlyArray<string> = [
  'dist/',
  'build/',
  '.next/',
  'out/',
  '.turbo/',
  '.vercel/',
  '.netlify/',
  'coverage/',
  '.nyc_output/',
  '.cache/',
  'tmp/',
  '.temp/',
  'temp/',
  '__pycache__/',
  '.pytest_cache/',
  'vendor/',
  'third_party/',
  'storybook-static/',
  '.storybook/public/',
  'public/build/',         // remix, gatsby
  '.svelte-kit/',
  '.remix/',
  'ios/build/',
  'android/build/',
  'android/.gradle/',
  '.gradle/',
  '.mvn/',
  'target/',               // maven/java
  '__mocks__/',            // jest mock directories
  '__fixtures__/',         // test fixture directories
];

// ─── Known noise — filename patterns ─────────────────────────────────────────

export const NOISE_EXACT_FILENAMES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'npm-shrinkwrap.json',
  'CHANGELOG.md',
  'CHANGELOG',
  'LICENSE',
  'LICENCE',
  'AUTHORS',
  'CONTRIBUTORS',
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
]);

// ─── Known noise — extension patterns ────────────────────────────────────────

export const NOISE_EXTENSIONS = new Set([
  '.map',          // source maps
  '.snap',         // jest snapshots (handled separately but also here)
  '.log',
  '.lock',
  '.patch',
]);

// Minified file name patterns (checked via suffix)
export const NOISE_FILENAME_SUFFIXES: ReadonlyArray<string> = [
  '.d.ts',       // TypeScript declaration files are generated build artifacts
  '.d.ts.map',
  '.min.js',
  '.min.css',
  '.min.ts',
  '.bundle.js',
  '.chunk.js',
];

// ─── Known noise — glob patterns (repo-root-relative) ────────────────────────

export const NOISE_GLOB_PATTERNS: ReadonlyArray<string> = [
  '**/__snapshots__/**',
  '**/__generated__/**',
  '**/generated/**',
  '**/fixtures/**',     // large fixture folders are noise; small fixture files are contextual
  '**/*.snap',
  '**/*.generated.ts',
  '**/*.generated.tsx',
  '**/*.gen.ts',
  '**/*.gen.tsx',
  '**/node_modules/**',
  '**/.git/**',
];

// ─── Execution-critical — directory segments ──────────────────────────────────
//
// A file whose repo-root-relative path contains one of these DIRECTORY
// SEGMENTS (i.e., as a full path component, not a substring) is treated as
// execution-critical.

export const EXECUTION_CRITICAL_DIR_SEGMENTS = new Set([
  'routes',
  'api',
  'services',
  'controllers',
  'middleware',
  'hooks',
  'store',
  'reducers',
  'actions',
  'screens',
  'pages',        // Next.js pages router (not app router — covered by framework rules)
  'server',
  'workers',
  'jobs',
  'tasks',
  'handlers',
  'resolvers',    // GraphQL resolvers
  'subscribers',  // event subscribers
  'guards',       // NestJS guards / XState guards
  'interceptors',
  'providers',
  'modules',      // NestJS modules
  'gateways',     // WebSocket gateways
]);

// ─── Execution-critical — filename suffix patterns ───────────────────────────

export const EXECUTION_CRITICAL_FILENAME_PATTERNS: ReadonlyArray<string> = [
  '.machine.ts',
  '.machine.tsx',
  '.store.ts',
  '.store.tsx',
  '.reducer.ts',
  '.service.ts',
  '.service.tsx',
  '.controller.ts',
  '.controller.tsx',
  '.middleware.ts',
  '.route.ts',
  '.routes.ts',
  '.guard.ts',
  '.gateway.ts',
  '.module.ts',       // NestJS modules
  '.resolver.ts',     // GraphQL resolvers
  '.saga.ts',         // Redux-saga
  '.effect.ts',       // NgRx effects
];

// ─── Execution-critical — exact root-level config filenames ──────────────────
//
// Matched only when the file is directly under the app root (not nested).

export const EXECUTION_CRITICAL_CONFIG_FILENAMES = new Set([
  'next.config.ts',
  'next.config.js',
  'next.config.mjs',
  'next.config.cjs',
  'vite.config.ts',
  'vite.config.js',
  'vite.config.mjs',
  'metro.config.ts',
  'metro.config.js',
  'app.config.ts',
  'app.config.js',
  'nuxt.config.ts',
  'nuxt.config.js',
  'remix.config.ts',
  'remix.config.js',
  'sveltekit.config.ts',
  'astro.config.ts',
  'astro.config.mjs',
  'gatsby-config.ts',
  'gatsby-config.js',
  'angular.json',
  'nest-cli.json',
]);

// ─── Execution-critical — known entry-point filenames ────────────────────────

export const EXECUTION_CRITICAL_ENTRY_FILENAMES = new Set([
  'main.ts',
  'main.tsx',
  'index.ts',        // root-level or app-level entry
  'app.ts',
  'app.tsx',
  'server.ts',
  'worker.ts',
  'entry.ts',
  'entry.tsx',
  'entry-server.ts',
  'entry-client.ts',
  'bootstrap.ts',
]);

// ─── Framework-critical — Next.js ─────────────────────────────────────────────

export const NEXT_CRITICAL_FILENAME_PATTERNS: ReadonlyArray<string> = [
  // App Router segments
  'page.tsx',
  'page.ts',
  'layout.tsx',
  'layout.ts',
  'template.tsx',
  'template.ts',
  'loading.tsx',
  'loading.ts',
  'error.tsx',
  'error.ts',
  'not-found.tsx',
  'not-found.ts',
  'global-error.tsx',
  'global-error.ts',
  'default.tsx',
  'default.ts',
  // Route handlers
  'route.ts',
  'route.tsx',
  // Instrumentation
  'instrumentation.ts',
  'middleware.ts',
];

export const NEXT_CRITICAL_CONFIG_FILES = new Set([
  'next.config.ts',
  'next.config.js',
  'next.config.mjs',
  'next.config.cjs',
]);

// ─── Framework-critical — Expo / React Native ─────────────────────────────────

export const EXPO_CRITICAL_FILENAME_PATTERNS: ReadonlyArray<string> = [
  '_layout.tsx',
  '_layout.ts',
  '+not-found.tsx',
  '+html.tsx',
];

export const EXPO_CRITICAL_CONFIG_FILES = new Set([
  'app.json',
  'app.config.ts',
  'app.config.js',
  'metro.config.ts',
  'metro.config.js',
  'babel.config.ts',
  'babel.config.js',
  'eas.json',
]);

// ─── Framework-critical — Node / NestJS ───────────────────────────────────────

export const NODE_CRITICAL_FILENAME_PATTERNS: ReadonlyArray<string> = [
  'main.ts',
  'server.ts',
  'app.module.ts',
  'app.ts',
  'bootstrap.ts',
];
