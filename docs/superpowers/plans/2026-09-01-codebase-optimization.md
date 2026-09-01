# Codebase Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the largest modules into explicit domain boundaries, use arrow functions for ordinary functions, and add evidence-based quality checks without changing desktop behavior.

**Architecture:** Keep `shared/studio.ts` as the public compatibility barrel while extracting cohesive pure helpers into `shared/studio/`. Keep Electron and renderer public APIs stable while moving only independently testable helpers. Quality tools remain developer-only commands and do not run in production builds.

**Tech Stack:** TypeScript, React 19, Electron 37, Vite 7, Vitest 4, pnpm, Knip, jscpd, ESLint with typescript-eslint, rollup-plugin-visualizer.

---

## Research Record

| Candidate | GitHub evidence checked 2026-09-01 | Decision |
| --- | --- | --- |
| [Knip](https://github.com/webpro-nl/knip) | 12k stars; active TypeScript repository; pushed 2026-08-31 | Adopt as an on-demand unused-code report. |
| [jscpd](https://github.com/kucherenko/jscpd) | 6k stars; active TypeScript repository; pushed 2026-08-31 | Adopt as an on-demand duplication report. |
| [rollup-plugin-visualizer](https://github.com/btd/rollup-plugin-visualizer) | Active TypeScript repository; pushed 2026-08-14 | Adopt only for bundle analysis, not normal builds. |
| [typescript-eslint](https://github.com/typescript-eslint/typescript-eslint) | 16k stars; active TypeScript repository; pushed 2026-08-31 | Adopt ESLint plus the TypeScript parser for style enforcement. |
| [Madge](https://github.com/pahen/madge) | Mature dependency graph tool, but last push was 2026-01-21 and the open issue count is high | Do not add. Existing TypeScript and targeted imports cover this need. |

## Guardrails

- Preserve every import from `shared/studio.js`; extracted modules are re-exported through that file.
- Convert function declarations to `const name = (...) => ...` only after a test proves their public contract. Constructors, accessors, and deliberate prototype methods are excluded because arrow fields change allocation and `this` semantics.
- Apply dynamic imports only to renderer routes. Never lazy-load contracts or Electron runtime code.
- Each extraction is an atomic commit with a focused test, `pnpm typecheck`, and an appropriate Vitest command.

### Task 1: Establish Reproducible Quality Commands

**Files:**
- Create: `knip.json`
- Create: `jscpd.json`
- Create: `eslint.config.js`
- Create: `scripts/quality-tools.test.ts`
- Modify: `package.json`
- Modify: `vite.config.ts`

- [ ] **Step 1: Write the failing command-contract test**

```ts
import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';

test('quality commands remain opt-in and keep normal builds unchanged', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
    scripts: Record<string, string>;
  };

  expect(packageJson.scripts.quality).toContain('pnpm lint');
  expect(packageJson.scripts['quality:unused']).toContain('knip');
  expect(packageJson.scripts['quality:duplicates']).toContain('jscpd');
  expect(packageJson.scripts['analyze:bundle']).toContain('ANALYZE_BUNDLE=1');
  expect(packageJson.scripts.build).not.toContain('visualizer');
});
```

- [ ] **Step 2: Verify the test is red**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run scripts/quality-tools.test.ts`

Expected: FAIL because the quality scripts do not exist.

- [ ] **Step 3: Install researched developer-only tools**

```bash
pnpm add -D eslint @eslint/js typescript-eslint knip jscpd rollup-plugin-visualizer
```

- [ ] **Step 4: Add narrow configurations and commands**

```json
{
  "scripts": {
    "lint": "eslint .",
    "quality": "pnpm lint",
    "quality:unused": "knip --config knip.json",
    "quality:duplicates": "jscpd --config jscpd.json",
    "analyze:bundle": "ANALYZE_BUNDLE=1 pnpm build:renderer"
  }
}
```

`quality` is the passing enforcement gate. `quality:unused` and
`quality:duplicates` are opt-in audits: preserve their native nonzero exit
codes when they identify candidates, and review their output before deciding
whether a targeted refactor is safe.

```js
export default [
  {
    files: ['**/*.{ts,tsx}'],
    rules: { 'func-style': ['error', 'expression', { allowArrowFunctions: true }] },
  },
];
```

Use `visualizer({ filename: 'stats.html', open: false })` only when `process.env.ANALYZE_BUNDLE === '1'`.

- [ ] **Step 5: Verify green and commit**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run scripts/quality-tools.test.ts && pnpm lint`

Expected: PASS.

```bash
git add package.json pnpm-lock.yaml eslint.config.js knip.json jscpd.json vite.config.ts scripts/quality-tools.test.ts
git commit -m "chore(quality): add opt-in code health checks"
```

### Task 2: Extract Test Case Version Helpers

**Files:**
- Create: `shared/studio/test-cases.ts`
- Create: `shared/studio/test-cases.test.ts`
- Modify: `shared/studio.ts`

- [ ] **Step 1: Write a failing direct-module versioning test**

```ts
import { createNextTestCaseVersion, nextTestCaseVersion } from './test-cases.js';
import { expect, test } from 'vitest';

test('test case versions advance monotonically', () => {
  const source = { id: 'case-1', version: 7 } as never;
  const project = { testCases: [source] } as never;

  expect(nextTestCaseVersion(7)).toBe(8);
  expect(createNextTestCaseVersion(project, source, { name: 'Edited case' })).toMatchObject({ id: 'case-1', version: 8 });
});
```

- [ ] **Step 2: Verify the test is red**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run shared/studio/test-cases.test.ts`

Expected: FAIL because `shared/studio/test-cases.js` does not exist.

- [ ] **Step 3: Extract and re-export test case versioning**

```ts
export const nextTestCaseVersion = (version: number): number => version + 1;

export const findMatchingTestCaseVersions = (
  project: Pick<ProjectDraft, 'testCases'>,
  reference: VersionedTestAssetReference,
): TestCaseDraft[] => project.testCases.filter((testCase) => (
  testCase.id === reference.id && normalizeTestCaseVersion(testCase.version) === reference.version
));
```

Move `findMatchingTestCaseVersions`, `findTestCaseVersion`, `listLatestTestCaseVersions`, `nextTestCaseVersion`, `createNextTestCaseVersion`, and `appendLatestTestCaseTransforms` to `test-cases.ts`. Use type-only barrel imports, make every moved ordinary function an arrow, re-export public functions from `shared/studio.ts`, and keep `findMatchingTestCaseVersions` private to direct domain imports.

- [ ] **Step 4: Verify compatibility and commit**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run shared/studio/test-cases.test.ts shared/studio.test.ts electron/projectRepository.test.ts && pnpm typecheck`

Expected: PASS.

```bash
git add shared/studio.ts shared/studio/test-cases.ts shared/studio/test-cases.test.ts
git commit -m "refactor(shared): extract test case version helpers"
```

### Task 3: Extract Suite Domain Functions

**Files:**
- Create: `shared/studio/suites.ts`
- Create: `shared/studio/suites.test.ts`
- Modify: `shared/studio.ts`

- [ ] **Step 1: Write a failing direct-module contract test**

```ts
import { createEmptySuiteAsset, resolveSuiteCases } from './suites.js';
import { expect, test } from 'vitest';

test('suite helpers create a version-1 asset and retain its selected environment', () => {
  const suite = createEmptySuiteAsset({ selectedEnvironmentId: 'env-local' }, 7);

  expect(suite).toMatchObject({ version: 1, environmentId: 'env-local', caseReferences: [] });
  expect(resolveSuiteCases({ testCases: [], environments: [{ id: 'env-local' }] as never }, suite)).toMatchObject({
    environment: { id: 'env-local' },
    issues: [{ kind: 'emptySuite' }],
  });
});
```

- [ ] **Step 2: Verify the test is red**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run shared/studio/suites.test.ts`

Expected: FAIL because `shared/studio/suites.js` does not exist.

- [ ] **Step 3: Extract and re-export the suite implementation**

```ts
import { findMatchingTestCaseVersions } from './test-cases.js';
import type { ProjectDraft, SuiteAsset, VersionedTestAssetReference } from '../studio.js';

export const findSuiteAsset = (
  project: Pick<ProjectDraft, 'suites'>,
  reference: VersionedTestAssetReference,
): SuiteAsset | undefined => project.suites.find((suite) => suite.id === reference.id && suite.version === reference.version);
```

Move `createEmptySuiteAsset`, `findSuiteAsset`, `resolveSuiteCases`, and `resolveSuiteTestCases` to `suites.ts`; import `findMatchingTestCaseVersions` from the prior extraction, make every moved ordinary function an arrow, re-export public functions from `shared/studio.ts`, and remove their source declarations.

- [ ] **Step 4: Verify compatibility and commit**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run shared/studio/suites.test.ts shared/studio.test.ts electron/runtime/suite-runner.test.ts && pnpm typecheck`

Expected: PASS.

```bash
git add shared/studio.ts shared/studio/suites.ts shared/studio/suites.test.ts
git commit -m "refactor(shared): extract suite domain helpers"
```

### Task 4: Extract Reusable Flow Lifecycle Functions

**Files:**
- Create: `shared/studio/reusable-flows.ts`
- Create: `shared/studio/reusable-flows.test.ts`
- Modify: `shared/studio.ts`

- [ ] **Step 1: Write a failing direct-module test**

```ts
import { createEmptyReusableFlowAsset, createNextReusableFlowVersion } from './reusable-flows.js';
import { expect, test } from 'vitest';

test('publishing a reusable flow increments its version without changing its id', () => {
  const draft = createEmptyReusableFlowAsset(4);
  const project = { reusableFlows: [draft] };
  const published = createNextReusableFlowVersion(project, draft, { name: 'Checkout setup' });

  expect(published).toMatchObject({ id: draft.id, version: 2, name: 'Checkout setup' });
});
```

- [ ] **Step 2: Verify the test is red**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run shared/studio/reusable-flows.test.ts`

Expected: FAIL because `shared/studio/reusable-flows.js` does not exist.

- [ ] **Step 3: Extract immutable flow lifecycle operations**

```ts
export const createNextReusableFlowVersion = (
  project: Pick<ProjectDraft, 'reusableFlows'>,
  source: ReusableFlowAsset,
  patch: Omit<Partial<ReusableFlowAsset>, 'id' | 'version' | 'schemaVersion' | 'createdAt'>,
): ReusableFlowAsset => {
  const canonicalSource = findReusableFlowAsset(project, { id: source.id, version: source.version });
  if (!canonicalSource) throw new Error('Reusable Flow source must match exactly one published version.');
  return { ...structuredClone(canonicalSource), ...structuredClone(patch), id: canonicalSource.id, version: canonicalSource.version + 1 };
};
```

Move `createEmptyReusableFlowAsset`, `findReusableFlowAsset`, `listLatestReusableFlowVersions`, and `createNextReusableFlowVersion`. Keep flow validation, impact analysis, and flow-to-case planning in `shared/studio.ts` until the state extraction; those functions depend on deterministic-step and case mutation helpers.

- [ ] **Step 4: Verify compatibility and commit**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run shared/studio/reusable-flows.test.ts shared/studio.test.ts electron/runtime/maintenance-service.test.ts && pnpm typecheck`

Expected: PASS.

```bash
git add shared/studio.ts shared/studio/reusable-flows.ts shared/studio/reusable-flows.test.ts
git commit -m "refactor(shared): extract reusable flow lifecycle helpers"
```

### Task 5: Split Shared State, Electron, and Renderer by Responsibility

**Files:**
- Create: `shared/studio/defaults.ts`
- Create: `shared/studio/hydration.ts`
- Create: `electron/studio-runtime/routes.ts`
- Create: `electron/studio-runtime/browser-session.ts`
- Create: `electron/studio-runtime/run-orchestration.ts`
- Create: `electron/studio-runtime/project-assets.ts`
- Create: `src/app/DesktopApiProvider.tsx`
- Create: `src/app/page-registry.tsx`
- Create: `src/i18n/locales/en-US.ts`
- Create: `src/i18n/locales/zh-CN.ts`
- Modify: `shared/studio.ts`, `electron/studioRuntime.ts`, `src/App.tsx`, `src/i18n/index.ts`

- [ ] **Step 1: Write failing boundary tests**

```ts
import { hydrateStudioState } from './hydration.js';
import { expect, test } from 'vitest';

test('hydration removes legacy plaintext model keys', () => {
  expect(hydrateStudioState({ midsceneConfig: { apiKey: 'sk-test' } }).midsceneConfig).not.toHaveProperty('apiKey');
});
```

```tsx
test('page registry resolves the settings page lazily', async () => {
  const { getPageComponent } = await import('./page-registry.js');

  await expect(getPageComponent('settings')).resolves.toBeDefined();
});
```

- [ ] **Step 2: Verify the tests are red**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run shared/studio/hydration.test.ts src/app/page-registry.test.tsx`

Expected: FAIL because the extracted modules do not exist.

- [ ] **Step 3: Move one stable boundary at a time**

```ts
export const createRunIntentRoutes = (dependencies: RunIntentDependencies) => ({
  runTestCase: (request: RunTestCaseRequest) => dependencies.runTestCase(request),
  runSuite: (request: RunSuiteRequest) => dependencies.runSuite(request),
});
```

Move default state creation and hydration first, then Electron routing, browser session lifecycle, run orchestration, and project asset operations. Keep `StudioRuntime` public methods as prototype methods. Finally, move the desktop API adapter, dynamic page-loader map, and immutable locale dictionaries; keep application composition and locale selection in their current entrypoints.

- [ ] **Step 4: Verify each surface and commit separately**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run shared/studio.test.ts electron/studioRuntime.test.ts src/App.test.tsx && pnpm typecheck`

Expected: PASS.

```bash
git add shared/studio electron/studioRuntime.ts electron/studio-runtime src/App.tsx src/app src/i18n
git commit -m "refactor(app): separate runtime and renderer coordination"
```

### Task 6: Split Stylesheet Layers and Measure the Entry Bundle

**Files:**
- Create: `src/styles/tokens.css`
- Create: `src/styles/shell.css`
- Create: `src/styles/workbench.css`
- Create: `src/styles/settings.css`
- Modify: `src/styles/luminous-precision.css`
- Modify: `src/main.tsx`
- Modify: `docs/benchmarks/suite-baseline.md`

- [ ] **Step 1: Write a failing stylesheet entrypoint test**

```ts
test('the renderer retains one stylesheet entrypoint', async () => {
  const source = await readFile(new URL('../main.tsx', import.meta.url), 'utf8');

  expect(source).toContain("import './styles/luminous-precision.css'");
});
```

- [ ] **Step 2: Verify it is red, then split by existing source order**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run src/styles/stylesheet-entry.test.ts`

Expected: FAIL until the test exists.

```css
@import './tokens.css';
@import './shell.css';
@import './workbench.css';
@import './settings.css';
```

Move declarations without changing selectors, in the order token variables, app shell, workbench pages, settings modal, then responsive rules.

- [ ] **Step 3: Verify and commit**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run src/styles/stylesheet-entry.test.ts src/App.test.tsx && pnpm analyze:bundle`

Expected: PASS; record the measured initial entry chunk in `docs/benchmarks/suite-baseline.md`.

```bash
git add src/styles src/main.tsx docs/benchmarks/suite-baseline.md
git commit -m "refactor(styles): split precision stylesheet by layer"
```

### Task 7: Apply and Enforce Arrow Function Style

**Files:**
- Modify: affected `*.ts` and `*.tsx` source modules
- Modify: `eslint.config.js`
- Test: affected focused tests

- [ ] **Step 1: Write the failing lint fixture**

```ts
export function declarationStyleOnly(): string {
  return 'must be an arrow';
}
```

Run: `pnpm eslint scripts/fixtures/function-style.ts`

Expected: FAIL with `func-style`.

- [ ] **Step 2: Convert only ordinary functions**

```ts
export const declarationStyleOnly = (): string => 'must be an arrow';
```

Convert top-level and nested functions in each touched module after its focused tests are green. When a declaration relies on hoisting, move the arrow above its first call and rerun the focused suite. Do not convert constructors, getters, setters, or intentional prototype methods.

- [ ] **Step 3: Verify the enforcement gate, inspect reports, and complete final acceptance**

Run: `pnpm quality && pnpm test && pnpm typecheck && pnpm build && git diff --check`

Expected: every enforcement command exits 0. Run `pnpm quality:unused` and
`pnpm quality:duplicates` separately as reports; their nonzero exit codes
mean candidates were found, not that the acceptance gate failed. Browser smoke
remains explicitly recorded as unavailable only when the sandbox cannot bind
`127.0.0.1`.

```bash
git add <module-family-files> eslint.config.js docs/acceptance/matrix.md
git commit -m "refactor(style): enforce arrow function conventions"
```
