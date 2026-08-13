# Suite Desktop Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the existing version-pinned Suite V1 assets in the desktop app so a user can edit, preflight, run, cancel, and inspect a Suite using the same `SuiteRunner` already used by the CLI.

**Architecture:** Keep scheduling in `electron/runtime/suite-runner.ts`. Add one desktop adapter in `RuntimeBundle` that runs each resolved Case through `runTestCase`, aggregates the shared `SuiteRunResult` with its persisted Case details, and emits a Suite response through a new IPC endpoint. The renderer owns only draft editing and presentation: it persists immutable Suite versions in the selected project's `suites`, submits an exact Suite reference, and adds returned Case details to the existing run history.

**Tech Stack:** TypeScript, React 19, Electron IPC, Vitest, existing shadcn primitives, existing `SuiteRunner`.

---

## File Structure

- `shared/studio.ts`: Suite request/response contracts and a pure empty-Suite factory.
- `electron/runtime/runtime-bundle.ts`: Main-process Suite adapter that delegates execution to the existing TestRunner path and `SuiteRunner`.
- `electron/runtime/runtime-bundle.test.ts`: Adapter tests proving exact Suite selection, serial effective concurrency, and cancellation routing.
- `electron/main.ts`, `electron/preload.cts`, `src/lib/runtime.ts`: Typed, renderer-safe `runSuite` bridge.
- `src/features/suites/SuiteManagementPage.tsx`: Suite list, immutable editor, preflight, live execution summary, and Case-result links.
- `src/features/suites/SuiteManagementPage.test.tsx`: UI tests for creation, version pinning, invalid preflight, submission, and result rendering.
- `src/App.tsx`, `src/app/pageMeta.ts`, `src/i18n/index.ts`: Route, navigation, state selection, and localized labels.
- `docs/implementation-roadmap.md`, `docs/agent-progress-and-target.md`: Evidence-based Phase 4 status update.

### Task 1: Define the Desktop Suite Contract

**Files:**
- Modify: `shared/studio.ts`
- Test: `shared/studio.test.ts`

- [ ] **Step 1: Write the failing shared contract tests.**

Add a test that calls `createEmptySuiteAsset(project, 1)` and expects a V1 Suite with the project's selected environment, no references, `concurrency: 1`, `failurePolicy: 'continue'`, `retryLimit: 0`, and a positive immutable version. Add a second test that calls `normalizeSuiteRunRequest` with a project plus `{ id, version }` and expects the exact persisted Suite, while an unknown version returns `undefined`.

- [ ] **Step 2: Verify RED.**

Run: `pnpm exec vitest run shared/studio.test.ts -t "empty Suite|Suite run request"`

Expected: FAIL because the factory and request resolver do not exist.

- [ ] **Step 3: Implement the minimal contracts.**

Add `RunSuiteRequest`, `RunSuiteResponse`, and `SuiteRunDetail` to `shared/studio.ts`. `RunSuiteRequest` contains `project`, an exact `suite: VersionedTestAssetReference`, optional runtime/model/session config, plus main-process-only cancellation and fixture trust fields. `SuiteRunDetail` contains the `SuiteRunResult` and Case `RunDetail[]`; it never adds a synthetic per-suite Case record. Implement `createEmptySuiteAsset(project, seed)` and `findSuiteAsset(project, reference)` without upgrading versions implicitly.

- [ ] **Step 4: Verify GREEN.**

Run: `pnpm exec vitest run shared/studio.test.ts -t "empty Suite|Suite run request"`

Expected: selected tests pass.

### Task 2: Adapt the Shared Runner for Desktop Calls

**Files:**
- Modify: `electron/runtime/runtime-bundle.ts`
- Modify: `electron/runtime/runtime-bundle.test.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.cts`
- Modify: `src/lib/runtime.ts`
- Test: `src/lib/runtime.test.ts`

- [ ] **Step 1: Write the failing bundle tests.**

Construct a project with two immutable Case versions and a Suite reference. Spy on `bundle.runTestCase`, invoke `bundle.runSuite`, and assert the adapter delegates every Case through the existing `runTestCase` with the Suite's environment. Assert the result preserves `suiteId`, `suiteVersion`, ordered Case results, and the returned `RunDetail` values. Add a cancellation test: abort the Suite before dispatch and assert no Case runner executes and the result is neutral with no active work remaining.

- [ ] **Step 2: Verify RED.**

Run: `pnpm exec vitest run electron/runtime/runtime-bundle.test.ts -t "desktop Suite"`

Expected: FAIL because `runSuite` is not defined.

- [ ] **Step 3: Implement the narrow main-process adapter.**

Add `runSuite` to `RuntimeBundle`. Resolve the exact Suite with `findSuiteAsset`; unknown references return a neutral response with an issue rather than an implicit latest version. Register one parent AbortController via `withActiveRun`; `SuiteRunner` receives `maxConcurrency: 1`, because `BrowserRuntime` owns one session. Its executor calls the bundle's normal `runTestCase` for each Case, preserving fixtures, deterministic steps, recording, and Agent routing. Collect each returned `RunDetail`, and return `SuiteRunDetail` with shared scheduling result and Case details.

Add `runtime:run-suite` in the Electron main process. It resolves script-trust records once, calls `bundle.runSuite`, and persists each Case detail through the existing `appendRunToStudioState` semantics. Do not persist a synthetic Suite RunDetail because current run records require a Case ID. Expose the endpoint through preload and the renderer bridge. In browser fallback, resolve the exact Suite and sequentially call existing `runTestCase`; return the same response shape.

- [ ] **Step 4: Write bridge tests and verify GREEN.**

In `src/lib/runtime.test.ts`, mock `window.desktopApi.runSuite` and assert `runSuite(request)` delegates unchanged. Add a fallback Suite test that supplies two manual Cases and asserts both results are neutral and ordered.

Run: `pnpm exec vitest run electron/runtime/runtime-bundle.test.ts src/lib/runtime.test.ts -t "Suite|suite"`

Expected: selected tests pass.

### Task 3: Build the Suite Workspace

**Files:**
- Create: `src/features/suites/SuiteManagementPage.tsx`
- Create: `src/features/suites/SuiteManagementPage.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/app/pageMeta.ts`
- Modify: `src/i18n/index.ts`

- [ ] **Step 1: Write failing page tests.**

Render `SuiteManagementPage` with a project containing two Cases. Verify a user can create a Suite, set a name, select an environment, include Cases at their current exact versions, set a dependency only to another selected Case, configure continue/fail-fast and retry count, and save a new immutable version. Add an invalid state test for an empty Suite and a cyclic dependency: the run command remains disabled and visible preflight messages explain why. Add a run test that calls `onRunSuite` with `{ id, version }` and renders returned `SuiteRunResult` rows including `attempts`, `flaky`, status, and a link callback for a Case result.

- [ ] **Step 2: Verify RED.**

Run: `pnpm exec vitest run src/features/suites/SuiteManagementPage.test.tsx`

Expected: FAIL because the page does not exist.

- [ ] **Step 3: Implement the compact Suite editor.**

Use the existing workbench `PageShell`, `PageHeader`, `PageBody`, `Surface`, `Button`, `Select`, and `Badge` primitives. Keep the visual direction quiet and operational: left-side Suite inventory, central selected Suite definition, and a right-side preflight/run summary. Do not nest generic cards. Treat persisted Suite versions as immutable: editing an existing Suite starts a draft which is saved as `version + 1` with a fresh timestamp; never change an existing version in place. Case selection writes exact current Case versions. Dependency controls only offer other selected members and reject self-dependency. The shared `resolveSuiteTestCases()` result supplies the preflight state, and the Run button only submits a valid saved Suite version. Clearly label effective desktop concurrency as one while retaining the persisted requested value.

- [ ] **Step 4: Integrate the route and state.**

Add `suites` to `AppPage`, both navs, i18n labels, and a lazy route. Add `selectedSuiteId` state. In `App`, implement create/update handlers that replace only the selected project's `suites` and use immediate persistence. Implement `handleRunSuite(reference)`: set the existing running state, call `runSuite` with the selected project and shared runtime settings, prepend each returned Case `RunDetail` and summary to the existing state, select the first returned detail, then navigate to run records. Pass a click-through callback from the Suite result rows to select its Case run and navigate to the run page.

- [ ] **Step 5: Verify the page and route.**

Run: `pnpm exec vitest run src/features/suites/SuiteManagementPage.test.tsx src/features/home/HomePage.test.tsx`

Expected: all selected tests pass.

### Task 4: Verify and Update the Roadmap

**Files:**
- Modify: `docs/implementation-roadmap.md`
- Modify: `docs/agent-progress-and-target.md`
- Verify: `shared/studio.test.ts`
- Verify: `electron/runtime/runtime-bundle.test.ts`
- Verify: `src/lib/runtime.test.ts`
- Verify: `src/features/suites/SuiteManagementPage.test.tsx`

- [ ] **Step 1: Run the focused Suite tests.**

Run:

```bash
pnpm exec vitest run shared/studio.test.ts electron/runtime/suite-runner.test.ts electron/runtime/runtime-bundle.test.ts src/lib/runtime.test.ts src/features/suites/SuiteManagementPage.test.tsx
```

Expected: all selected tests pass.

- [ ] **Step 2: Update only evidence-backed documentation.**

Update Phase 4 to state that desktop has a Suite V1 inventory/editor, preflight, exact reference submission, cancellation, serial shared-runner adapter, and Case-level result handoff. Retain explicit limits: BrowserRuntime forces desktop effective concurrency to one; isolated browser pool, six-terminal-state migration, synthetic/full Suite RunResult reports, and 10-100 Case real acceptance remain unfinished.

- [ ] **Step 3: Run the full offline quality gate.**

Run: `pnpm check`

Expected: tests, TypeScript, both production builds, and diff check exit successfully.

- [ ] **Step 4: Inspect the final diff.**

Run: `git diff --check && git status --short`

Expected: no whitespace errors and only the intended Suite desktop adapter files changed.
