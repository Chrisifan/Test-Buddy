# Wave 2 Run Identity and Rerun Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every new Case and Suite run immutable, secret-free provenance, one unambiguous terminal status, and a rerun plan that never substitutes current assets.

**Architecture:** Keep `ProjectRepository` as the sole bound-project authority. Main-process IPC freezes `RunProvenance` from its resolved `ProjectSnapshot` before dispatch, while runners return an explicit `RunStatus` plus `RunReason`. `StudioStore` persists Case details and separate `SuiteRunRecord` parents; renderer and CLI render only these frozen records. A rerun is a main-owned provenance resolution plan, not a renderer lookup by Case ID.

**Tech Stack:** TypeScript, Vitest, Electron IPC/preload, `ProjectRepository`, `StudioStore`, React, `pnpm`.

---

## File Map

| File | Responsibility |
| --- | --- |
| `shared/studio.ts` / `.test.ts` | Status/reason/provenance contracts, conservative legacy migration, report and coverage semantics. |
| `electron/runtime/run-provenance.ts` / `.test.ts` | Freeze redacted provenance and resolve a historical rerun against a repository snapshot. |
| `electron/runtime/run-history.ts` / `.test.ts` | Persist Case records and independent Suite parent records without rewriting provenance. |
| `electron/runtime/test-runner.ts`, `suite-runner.ts`, `runtime-bundle.ts` and tests | Map execution paths to terminal status/reason and aggregate Suite members. |
| `electron/ipc/runtime-ipc-handlers.ts` / `.test.ts`, `electron/preload.cts` | Freeze provenance in main, expose rerun-plan/run channels, and keep renderer requests authority-free. |
| `electron/cli.ts` / `.test.ts` | JSON/JUnit status/provenance parity and nonzero exit only for `failed`/`error`. |
| `src/App.tsx`, `src/features/runs/RunRecordsPage.tsx` and tests | Render frozen provenance, blocked rerun plans, and new terminal-state filters. |

## Task 1: Define lifecycle, reason, and frozen provenance contracts

**Files:**
- Modify: `shared/studio.ts:1-40`, `shared/studio.ts:200-240`, `shared/studio.ts:1120-1255`, `shared/studio.ts:3400-3575`
- Test: `shared/studio.test.ts`

- [ ] **Step 1: Write failing shared contract tests**

```ts
it('migrates ambiguous legacy neutral runs to blocked without inventing a failure', () => {
  const state = hydrateStudioState({ runDetails: [{ ...legacyRun, status: 'neutral' }] });
  expect(state.runDetails[0]).toMatchObject({
    status: 'blocked',
    reason: { code: 'legacyAmbiguousNeutral' },
  });
});

it('keeps a frozen provenance independent from later environment and Case edits', () => {
  const provenance = createRunProvenance(snapshot, caseV1, environment, runtimeMetadata);
  environment.url = 'https://changed.example';
  expect(provenance).toMatchObject({ testCase: { id: caseV1.id, version: 1 } });
  expect(provenance.environment.baseUrl).not.toContain('changed');
});
```

- [ ] **Step 2: Run the shared tests and verify the status/provenance contract is absent**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run shared/studio.test.ts`

Expected: FAIL because `RunTone` still accepts `neutral` and no provenance migration/factory exists.

- [ ] **Step 3: Add the minimum immutable contracts**

```ts
export type RunStatus = 'running' | 'passed' | 'failed' | 'blocked' | 'skipped' | 'cancelled' | 'error';
export type RunReasonCode =
  | 'assertionFailed' | 'actionFailed' | 'missingAssetVersion' | 'fixturePreflight'
  | 'credentialUnavailable' | 'dependencyFailed' | 'userCancelled' | 'unsupportedAction'
  | 'executorError' | 'legacyAmbiguousNeutral';

export interface RunReason { code: RunReasonCode; message: string; }
export interface RunProvenance {
  schemaVersion: 1;
  projectId: string;
  projectRevision: string;
  source: 'projectDirectory' | 'legacyStudioStore';
  reproducibility: 'versioned' | 'legacy';
  testCase: VersionedTestAssetReference;
  fixtures: VersionedTestAssetReference[];
  reusableFlows: VersionedTestAssetReference[];
  baselines: VersionedTestAssetReference[];
  environment: { id: string; name: string; baseUrl: string; storageStateRef?: string };
  browserProfile: { engine: BrowserEngine; headless: boolean };
  executor: { appVersion: string; runnerVersion: string };
  model: { provider?: string; model?: string; endpointFingerprint?: string; hasKey: boolean };
  createdAt: string;
}
```

Replace `RunTone` in persisted contracts with `RunStatus`, add optional `reason` to new records, and update hydration so old neutral entries become only evidence-supported values or `blocked/legacyAmbiguousNeutral`. Preserve old data during read; all constructors for new records must require a terminal status other than `neutral`.

- [ ] **Step 4: Update report/coverage calculations for six terminal states**

Treat `failed` and `error` as failures, `blocked`/`skipped`/`cancelled` as non-executed risks, and `passed` as verified. Expand report count maps explicitly instead of coercing status strings.

- [ ] **Step 5: Run shared tests and commit**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run shared/studio.test.ts`

Expected: PASS, including conservative neutral migration and status report coverage.

```bash
git commit --only shared/studio.ts shared/studio.test.ts -m "feat: define run lifecycle and provenance contracts"
```

## Task 2: Freeze main-owned provenance and resolve safe rerun plans

**Files:**
- Create: `electron/runtime/run-provenance.ts`
- Test: `electron/runtime/run-provenance.test.ts`
- Modify: `electron/projectRepository.ts`, `electron/projectRepository.test.ts`

- [ ] **Step 1: Write failing provenance and rerun-plan tests**

```ts
it('freezes only exact, redacted run inputs from a versioned snapshot', () => {
  expect(createRunProvenance(snapshot, caseV1, environment, runtime)).toEqual(expect.objectContaining({
    projectRevision: snapshot.revision,
    testCase: { id: caseV1.id, version: 1 },
    model: expect.objectContaining({ hasKey: true }),
  }));
  expect(JSON.stringify(createRunProvenance(snapshot, caseV1, environment, runtime))).not.toContain('api-key');
});

it('blocks a rerun before BrowserRuntime when a recorded Case version is missing', async () => {
  await expect(resolveRerunPlan(repository, provenance)).resolves.toMatchObject({
    status: 'blocked', reason: { code: 'missingAssetVersion' }, missingReferences: [{ id: caseV1.id, version: 1 }],
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run electron/runtime/run-provenance.test.ts electron/projectRepository.test.ts`

Expected: FAIL because no provenance factory or rerun plan exists.

- [ ] **Step 3: Implement pure provenance and repository revision loading**

Implement `createRunProvenance(snapshot, testCase, environment, runtimeMetadata)` using only reference IDs/versions and `redactProjectUrl()` output. Implement `resolveRerunPlan(repository, provenance)` to call `loadBound(projectId, projectRevision)`, exact-resolve the recorded Case/Fixture/Flow/Baseline references and return either `{ status: 'ready', snapshot, testCase, environment }` or `{ status: 'blocked', reason, missingReferences }`. Legacy provenance always returns `blocked/legacyAmbiguousNeutral` for historical rerun.

- [ ] **Step 4: Run the tests and commit**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run electron/runtime/run-provenance.test.ts electron/projectRepository.test.ts`

Expected: PASS with no browser dependency.

```bash
git commit --only electron/runtime/run-provenance.ts electron/runtime/run-provenance.test.ts electron/projectRepository.ts electron/projectRepository.test.ts -m "feat: freeze provenance and plan exact reruns"
```

## Task 3: Map runners and Suite aggregation to terminal reasons

**Files:**
- Modify: `electron/runtime/test-runner.ts`, `electron/runtime/suite-runner.ts`, `electron/runtime/runtime-bundle.ts`
- Test: `electron/runtime/test-runner.test.ts`, `electron/runtime/suite-runner.test.ts`, `electron/runtime/runtime-bundle.test.ts`

- [ ] **Step 1: Add failing path-to-status tests**

```ts
expect(await runner.run(cancelledRequest)).toMatchObject({ detail: { status: 'cancelled', reason: { code: 'userCancelled' } } });
expect(await runner.run(invalidFixtureRequest)).toMatchObject({ detail: { status: 'blocked', reason: { code: 'fixturePreflight' } } });
expect(await suite.run(project, suite, signal)).toMatchObject({ results: [
  expect.objectContaining({ status: 'failed' }),
  expect.objectContaining({ status: 'skipped', reason: { code: 'dependencyFailed' } }),
] });
```

- [ ] **Step 2: Run targeted runner tests and verify they fail**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run electron/runtime/test-runner.test.ts electron/runtime/suite-runner.test.ts electron/runtime/runtime-bundle.test.ts`

Expected: FAIL on neutral-status assertions.

- [ ] **Step 3: Make all runner exits explicit**

Use a single local `terminalDetail(status, reason)` builder in `TestRunner`. Map fixture and credential preflight to `blocked`; unsupported actions to `blocked/unsupportedAction`; user abort to `cancelled/userCancelled`; dependency/fail-fast nonstarts to `skipped/dependencyFailed`; uncaught executor exceptions at the bundle boundary to `error/executorError`; assertion/action failure to `failed`. Preserve `flaky` separately in Suite result retry metadata.

- [ ] **Step 4: Run focused tests and commit**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run electron/runtime/test-runner.test.ts electron/runtime/suite-runner.test.ts electron/runtime/runtime-bundle.test.ts`

Expected: PASS with no new neutral writes.

```bash
git commit --only electron/runtime/test-runner.ts electron/runtime/test-runner.test.ts electron/runtime/suite-runner.ts electron/runtime/suite-runner.test.ts electron/runtime/runtime-bundle.ts electron/runtime/runtime-bundle.test.ts -m "feat: classify runner terminal outcomes"
```

## Task 4: Persist provenance and separate Suite parent history

**Files:**
- Modify: `electron/runtime/run-history.ts`, `electron/ipc/runtime-ipc-handlers.ts`, `electron/main.ts`
- Test: `electron/runtime/run-history.test.ts`, `electron/ipc/runtime-ipc-handlers.test.ts`

- [ ] **Step 1: Write failing persistence tests**

```ts
expect(next.suiteRunRecords).toContainEqual(expect.objectContaining({
  id: suiteRunId,
  provenance: expect.objectContaining({ suite: { reference: { id: suite.id, version: 1 }, parentRunId: suiteRunId } }),
  memberRunIds: [caseRunId],
}));
expect(next.runDetails[0]!.provenance).toEqual(caseProvenance);
```

- [ ] **Step 2: Run the history/IPC tests and verify failure**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run electron/runtime/run-history.test.ts electron/ipc/runtime-ipc-handlers.test.ts`

Expected: FAIL because only Case details are persisted and no frozen provenance is attached.

- [ ] **Step 3: Persist immutable Case and Suite records in main**

Add `suiteRunRecords: SuiteRunRecord[]` to `StudioState`. In `runtime-ipc-handlers`, call the Task 2 factory after snapshot/exact resolution and before `RuntimeBundle`; attach cloned provenance to every returned Case detail. For Suite dispatch create one parent record before member execution, update its member IDs/status only from result data, and never synthesize it as a Case `RunDetail`.

- [ ] **Step 4: Run targeted tests and commit**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run electron/runtime/run-history.test.ts electron/ipc/runtime-ipc-handlers.test.ts`

Expected: PASS; snapshot values do not change after runner mutations.

```bash
git commit --only shared/studio.ts electron/runtime/run-history.ts electron/runtime/run-history.test.ts electron/ipc/runtime-ipc-handlers.ts electron/ipc/runtime-ipc-handlers.test.ts electron/main.ts -m "feat: persist run provenance and suite parents"
```

## Task 5: Align renderer, CLI, and reports with frozen history

**Files:**
- Modify: `electron/cli.ts`, `src/App.tsx`, `src/features/runs/RunRecordsPage.tsx`, `src/components/StatusPill.tsx`, `src/i18n/index.ts`, `shared/studio.ts`
- Test: `electron/cli.test.ts`, `src/App.test.tsx`, `src/features/runs/RunRecordsPage.test.tsx`, `shared/studio.test.ts`

- [ ] **Step 1: Add failing CLI/UI tests**

```ts
expect(renderJUnitReport(summary)).toContain('<error');
expect(renderJUnitReport(summary)).toContain('<skipped');
expect(screen.getByText('Blocked: missing asset version')).toBeInTheDocument();
expect(screen.getByRole('button', { name: /rerun exact version/i })).toBeDisabled();
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run electron/cli.test.ts src/App.test.tsx src/features/runs/RunRecordsPage.test.tsx shared/studio.test.ts`

Expected: FAIL because UI derives names/current Cases and JUnit collapses neutral work.

- [ ] **Step 3: Render only frozen provenance**

Add status/reason translations and StatusPill styles. Display exact Case/Suite/Fixture/Flow/Baseline references and redacted environment snapshot from `RunDetail.provenance`; do not look up current assets for historical labels. Add a main IPC rerun-plan call, render a blocked missing-reference list without calling run, and execute only a ready plan. Make CLI JSON include `provenance`, map `failed` to failure, `error` to error, and `blocked`/`skipped`/`cancelled` to skipped output.

- [ ] **Step 4: Run Wave 2 verification and commit**

Run:

```bash
pnpm exec node node_modules/vitest/vitest.mjs run shared/studio.test.ts electron/runtime/run-provenance.test.ts electron/runtime/test-runner.test.ts electron/runtime/suite-runner.test.ts electron/runtime/runtime-bundle.test.ts electron/runtime/run-history.test.ts electron/ipc/runtime-ipc-handlers.test.ts electron/cli.test.ts src/App.test.tsx src/features/runs/RunRecordsPage.test.tsx
pnpm check
pnpm test:browser-smoke
```

Expected: all commands exit 0; browser smoke records explicit terminal reasons.

```bash
git commit --only electron/cli.ts electron/cli.test.ts electron/preload.cts src/lib/runtime.ts src/App.tsx src/App.test.tsx src/features/runs/RunRecordsPage.tsx src/features/runs/RunRecordsPage.test.tsx src/components/StatusPill.tsx src/i18n/index.ts shared/studio.ts shared/studio.test.ts -m "feat: render provenance based run history"
```

## Plan Self-Review

- Status migration, frozen provenance, serial Suite parents, provenance-only rerun, UI, JSON/JUnit, and reports each have a task and a failing test.
- No task adds secrets, artifact retention, Flow execution, browser pooling, or maintenance drafts.
- Every rerun path requires exact stored references and blocks before BrowserRuntime on unavailable history.
