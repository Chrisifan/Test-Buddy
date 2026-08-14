# Wave 1 Versioned Cases and Project Repository Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make published Cases immutable and exact-version addressable, then make both desktop and CLI resolve a revision-pinned project snapshot before they execute one.

**Architecture:** `ProjectDraft.testCases` becomes an in-memory collection of every published Case version. `ProjectAssetStore` persists that collection as `cases/<encoded-id>@<version>.json` and a manifest-v2 collection of exact references. A new main-process `ProjectRepository` selects either the validated bound directory snapshot or the legacy `StudioStore` project; renderer IPC and CLI supply only exact run intent and an observed revision, while the repository supplies the execution-authoritative project.

**Tech Stack:** TypeScript, Vitest, Electron IPC/preload, Node `fs/promises`, Playwright runtime, pnpm.

**Working constraints:** Work on the current branch (the user explicitly declined a worktree). Use `pnpm` for every package command. Preserve the externally staged `.npmrc`: every commit in this plan must use explicit pathspecs or `git commit --only`, never a bare `git commit`.

---

## File map

| File | Responsibility after Wave 1 |
| --- | --- |
| `shared/studio.ts` | Shared exact-Case resolver, latest inventory helper, next-version publisher, suite resolution, hydrated v1 compatibility, and public run-intent types. |
| `shared/studio.test.ts` | Pure Case history, resolver, Suite compatibility, and hydration regression tests. |
| `electron/projectAssetStore.ts` | Manifest v2, versioned Case paths, strict layout validation, and reviewable legacy Case migration. |
| `electron/projectAssetStore.test.ts` | Disk-level v1/v2 coexistence, conflicts, backup retention, atomic confirmation, and idempotence tests. |
| `electron/projectRepository.ts` | Revision-pinned authoritative project loader shared by Electron and CLI. |
| `electron/projectRepository.test.ts` | Bound/legacy source selection, expected revision and stale renderer tests. |
| `electron/runtime/runtime-bundle.ts` | Internal-only resolved execution requests; keeps runners unaware of renderer state. |
| `electron/ipc/runtime-ipc-handlers.ts` | Resolves public run intent in main before calling the runtime and persists only returned records. |
| `electron/ipc/runtime-ipc-handlers.test.ts` | Verifies IPC does not forward renderer `ProjectDraft`, rejects stale revisions, and keeps trust resolution main-owned. |
| `electron/main.ts` | Constructs the repository from `StudioStore` and provides it to runtime IPC registration. |
| `electron/preload.cts` / `src/lib/runtime.ts` | Typed public run intent bridge; browser-only fallback remains explicitly legacy. |
| `electron/cli.ts` / `electron/cli.test.ts` | Exact `--case-id id@version` selection and repository-backed project load. |
| `src/App.tsx` | Published Case selection by exact reference, local editing draft, publish/discard lifecycle, and revision-aware run intents. |
| `src/features/cases/TestCaseManagementPage.tsx` / `.test.tsx` | Latest-version inventory, version selector, read-only published state, and publish/discard controls. |

## Task 1: Establish exact Case history helpers and Suite resolution

**Files:**
- Modify: `shared/studio.ts:149-202`, `shared/studio.ts:648-877`, `shared/studio.ts:2514-2534`
- Test: `shared/studio.test.ts`

- [ ] **Step 1: Write the failing exact-resolution tests**

  Add tests that use two published objects with the same ID and versions 1 and 2. The tests must prove exact lookup has no latest fallback, latest inventory returns v2 once, the next publisher makes v3 without mutating its source, and a Suite pinned to v1 resolves v1 after v2 exists.

  ```ts
  import {
    createNextTestCaseVersion,
    findTestCaseVersion,
    listLatestTestCaseVersions,
    resolveSuiteCases,
  } from './studio.js';

  it('resolves an exact Case version and never substitutes the latest version', () => {
    const project = projectWithCaseVersions(1, 2);

    expect(findTestCaseVersion(project, { id: 'case/checkout', version: 1 })?.name).toBe('Checkout v1');
    expect(findTestCaseVersion(project, { id: 'case/checkout', version: 3 })).toBeUndefined();
    expect(listLatestTestCaseVersions(project)).toEqual([
      expect.objectContaining({ id: 'case/checkout', version: 2 }),
    ]);
  });

  it('keeps a Suite pinned to Case v1 executable after Case v2 is published', () => {
    const project = projectWithCaseVersions(1, 2);
    const suite = suiteWithReferences([{ id: 'case/checkout', version: 1, dependsOn: [] }]);

    expect(resolveSuiteCases(project, suite)).toMatchObject({
      issues: [],
      orderedCases: [expect.objectContaining({ testCase: expect.objectContaining({ version: 1 }) })],
    });
  });

  it('creates a distinct next Case version without changing the source asset', () => {
    const source = caseVersion('case/checkout', 2);
    const next = createNextTestCaseVersion({ testCases: [source] }, source, { name: 'Checkout v3' });

    expect(source).toMatchObject({ version: 2, name: 'Checkout v2' });
    expect(next).toMatchObject({ id: source.id, version: 3, name: 'Checkout v3' });
  });
  ```

- [ ] **Step 2: Run the focused test and verify it fails for missing helpers / stale-version behavior**

  Run: `pnpm exec node node_modules/vitest/vitest.mjs run shared/studio.test.ts`

  Expected: FAIL because the four helpers are not exported and the current Suite resolver maps by Case ID only.

- [ ] **Step 3: Implement the smallest shared Case API**

  Export these functions near `VersionedTestAssetReference`; use `versionedReferenceKey()` for all exact map keys. Keep `VersionedTestAssetReference` as the shared representation rather than creating a structurally duplicate type.

  ```ts
  export function findTestCaseVersion(
    project: Pick<ProjectDraft, 'testCases'>,
    reference: VersionedTestAssetReference,
  ): TestCaseDraft | undefined {
    return project.testCases.find((testCase) => (
      testCase.id === reference.id && normalizeTestCaseVersion(testCase.version) === reference.version
    ));
  }

  export function listLatestTestCaseVersions(
    project: Pick<ProjectDraft, 'testCases'>,
  ): TestCaseDraft[] {
    const latest = new Map<string, TestCaseDraft>();
    project.testCases.forEach((testCase) => {
      const previous = latest.get(testCase.id);
      if (!previous || normalizeTestCaseVersion(testCase.version) > normalizeTestCaseVersion(previous.version)) {
        latest.set(testCase.id, testCase);
      }
    });
    return [...latest.values()];
  }

  export function createNextTestCaseVersion(
    project: Pick<ProjectDraft, 'testCases'>,
    source: TestCaseDraft,
    patch: Partial<TestCaseDraft>,
  ): TestCaseDraft {
    const highestVersion = project.testCases
      .filter((candidate) => candidate.id === source.id)
      .reduce((highest, candidate) => Math.max(highest, normalizeTestCaseVersion(candidate.version)), 0);
    return { ...structuredClone(source), ...structuredClone(patch), id: source.id, version: highestVersion + 1 };
  }
  ```

  Replace the ID-only `casesById` map in `resolveSuiteTestCases()` with exact lookup through `findTestCaseVersion()`. Rename and export that resolver as `resolveSuiteCases()`, retaining `resolveSuiteTestCases` as a one-release alias only if all existing callers cannot be migrated in this task. Missing versions must yield `missingCase`, never `staleCaseVersion` or a current-version substitution.

- [ ] **Step 4: Run the focused tests and the shared suite**

  Run: `pnpm exec node node_modules/vitest/vitest.mjs run shared/studio.test.ts`

  Expected: PASS. Existing fixture/suite helpers retain their public behavior except that historical Case references now resolve.

- [ ] **Step 5: Commit the shared resolver contract**

  ```bash
  git add shared/studio.ts shared/studio.test.ts
  git commit --only shared/studio.ts shared/studio.test.ts -m "feat: resolve immutable case versions exactly"
  ```

## Task 2: Persist Case history in manifest v2 and versioned Case files

**Files:**
- Modify: `electron/projectAssetStore.ts:20-52`, `electron/projectAssetStore.ts:219-427`, `electron/projectAssetStore.ts:720-1035`
- Test: `electron/projectAssetStore.test.ts`

- [ ] **Step 1: Write failing v2 persistence and integrity tests**

  Add a project with `case/checkout@1` and `case/checkout@2`. Assert that the manifest uses schema version 2 and exact `assetIds.cases` references, both files exist, load returns both objects, an unreferenced `cases/...@3.json` is rejected, and a filename/embedded-version mismatch is rejected.

  ```ts
  it('persists every immutable Case version and validates manifest/file integrity', async () => {
    const project = projectWithCaseVersions(1, 2);
    const store = new ProjectAssetStore(projectDirectory);
    await store.saveInitial(project);

    await expect(fs.readFile(path.join(projectDirectory, 'cases', 'case%2Fcheckout@1.json'), 'utf8')).resolves.toContain('"version": 1');
    await expect(fs.readFile(path.join(projectDirectory, 'cases', 'case%2Fcheckout@2.json'), 'utf8')).resolves.toContain('"version": 2');
    await expect(store.load()).resolves.toMatchObject({
      testCases: [
        expect.objectContaining({ id: 'case/checkout', version: 1 }),
        expect.objectContaining({ id: 'case/checkout', version: 2 }),
      ],
    });

    await fs.writeFile(path.join(projectDirectory, 'cases', 'case%2Fcheckout@3.json'), '{}\n');
    await expect(store.load()).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ path: 'cases/case%2Fcheckout@3.json' })]),
    });
  });
  ```

- [ ] **Step 2: Run the store tests and verify the current v1 path fails the new expectations**

  Run: `pnpm exec node node_modules/vitest/vitest.mjs run electron/projectAssetStore.test.ts`

  Expected: FAIL because `assetIds.cases` is `string[]`, the manifest is schema v1, and Case files have no `@version` suffix.

- [ ] **Step 3: Implement manifest v2 and strict Case collection I/O**

  Set `projectAssetSchemaVersion` to `2`. Change the manifest fields to this exact shape, introduce `caseRelativePath(reference)`, and give Cases their own strict collection functions:

  ```ts
  export interface ProjectAssetManifest extends Omit<ProjectDraft, 'testCases' | 'recordings' | 'documents' | 'fixtures' | 'suites'> {
    schemaVersion: 2;
    revision?: string;
    legacyCaseBackupDirectory?: string;
    assetIds: {
      cases: VersionedTestAssetReference[];
      recordings: string[];
      documents: string[];
      fixtures?: VersionedTestAssetReference[];
      suites?: VersionedTestAssetReference[];
    };
  }
  ```

  ```ts
  function caseRelativePath(reference: Pick<TestCaseDraft, 'id' | 'version'>): string {
    return path.posix.join('cases', `${encodeURIComponent(reference.id)}@${reference.version}.json`);
  }

  async function readCaseCollection(
    rootDirectory: string,
    references: VersionedTestAssetReference[],
  ): Promise<TestCaseDraft[]> {
    return Promise.all(references.map(async (reference) => {
      const relativePath = caseRelativePath(reference);
      const testCase = await readJson(path.join(rootDirectory, relativePath), relativePath) as TestCaseDraft;
      if (!testCase || testCase.id !== reference.id || testCase.version !== reference.version) {
        throw new ProjectAssetStoreError('Case 文件与 manifest 引用不一致。', [
          { path: relativePath, message: 'Case ID 或版本不匹配。' },
        ]);
      }
      return testCase;
    }));
  }
  ```

  Update `createProjectAssetSnapshot`, `validateProjectAssetSnapshot`, `listAssetFiles`, layout checks, atomic writer, and reference validation to use exact `(id, version)` keys. Reject duplicate references, duplicate in-memory Case pairs, missing manifest Case files, and any on-disk entry not listed by the v2 manifest. Continue to validate fixture references against all Case versions, not just latest ones.

- [ ] **Step 4: Run the ProjectAssetStore suite**

  Run: `pnpm exec node node_modules/vitest/vitest.mjs run electron/projectAssetStore.test.ts`

  Expected: PASS, including old fixture/Suite tests now using `cases/<id>@<version>.json` paths.

- [ ] **Step 5: Commit v2 asset persistence**

  ```bash
  git add electron/projectAssetStore.ts electron/projectAssetStore.test.ts
  git commit --only electron/projectAssetStore.ts electron/projectAssetStore.test.ts -m "feat: persist immutable case assets in manifest v2"
  ```

## Task 3: Add reviewable, atomic, idempotent legacy Case migration

**Files:**
- Modify: `shared/studio.ts:930-948`
- Modify: `electron/projectAssetStore.ts`
- Test: `electron/projectAssetStore.test.ts`
- Test: `electron/main.test.ts` (create if main asset-binding behavior needs an isolated test seam)

- [ ] **Step 1: Write failing migration tests**

  Cover each required migration outcome using a legacy manifest v1 and `cases/<encoded-id>.json`: preview makes no writes; confirmation writes a v2 Case `@1` file and retains the old file below the manifest-recorded backup directory; an existing conflicting `@1` file blocks confirmation; a post-write reload validates before success; a second preview/confirmation is idempotent and creates no `@2` Case.

  ```ts
  it('migrates a legacy Case only after review and retains an explicit backup', async () => {
    await writeLegacyCaseProject(projectDirectory, legacyProject);
    const store = new ProjectAssetStore(projectDirectory);

    const preview = await store.planLegacyCaseMigration();
    expect(preview).toMatchObject({ status: 'ready', targetSchemaVersion: 2 });
    await expect(fs.stat(path.join(projectDirectory, 'cases', 'case%2Fcheckout@1.json'))).rejects.toMatchObject({ code: 'ENOENT' });

    await store.confirmLegacyCaseMigration(preview);
    const loaded = await store.loadWithRevision();
    expect(loaded.project.testCases).toContainEqual(expect.objectContaining({ id: 'case/checkout', version: 1 }));
    await expect(fs.readFile(path.join(projectDirectory, 'migration-backup', preview.migrationId, 'cases', 'case%2Fcheckout.json'), 'utf8')).resolves.toContain('case/checkout');
  });
  ```

- [ ] **Step 2: Run the focused migration test and verify it fails because no preview/confirmation API exists**

  Run: `pnpm exec node node_modules/vitest/vitest.mjs run electron/projectAssetStore.test.ts -t "migrates a legacy Case"`

  Expected: FAIL with missing `planLegacyCaseMigration` / `confirmLegacyCaseMigration` methods.

- [ ] **Step 3: Implement migration preview and confirmation**

  Add these shared plan fields so the renderer can explain every proposed change without receiving asset content:

  ```ts
  export interface ProjectAssetMigrationPlan {
    projectId: string;
    projectDirectory: string;
    snapshotRevision: string;
    files: string[];
    status: 'ready' | 'requiresReview' | 'blocked' | 'alreadyMigrated';
    conflicts: string[];
    migrationId?: string;
    targetSchemaVersion?: 2;
    backupDirectory?: string;
  }
  ```

  `planLegacyCaseMigration()` must read only. It normalizes an absent/invalid legacy Case version to 1, preserves a positive legacy version only if that exact target is free, constructs the full v2 snapshot, and reports `blocked` for duplicate targets, malformed IDs, mismatched embedded IDs, missing exact Suite Case references, or a target version-file conflict. `confirmLegacyCaseMigration(plan)` must reject non-ready or stale plans, write the v2 manifest and versioned Case collection through the existing staging/rename mechanism, move legacy Case files into `migration-backup/<migration-id>/cases/`, record that relative backup directory in the v2 manifest, then call `loadWithRevision()` before returning. Once the manifest is v2, preview returns `alreadyMigrated` and confirmation performs no write.

  Do not loosen `saveInitial()`: first binding from an unbound `StudioStore` project remains a review-first migration path in `main.ts`; it must not overwrite a selected non-empty directory.

- [ ] **Step 4: Run the full store suite**

  Run: `pnpm exec node node_modules/vitest/vitest.mjs run electron/projectAssetStore.test.ts`

  Expected: PASS. Failure injection tests continue to show the original snapshot restored when the atomic swap cannot complete.

- [ ] **Step 5: Commit migration support**

  ```bash
  git add shared/studio.ts electron/projectAssetStore.ts electron/projectAssetStore.test.ts electron/main.test.ts
  git commit --only shared/studio.ts electron/projectAssetStore.ts electron/projectAssetStore.test.ts electron/main.test.ts -m "feat: migrate legacy case assets by review"
  ```

  If `electron/main.test.ts` was not needed, omit it from both commands rather than creating an empty file.

## Task 4: Create the revision-pinned ProjectRepository

**Files:**
- Create: `electron/projectRepository.ts`
- Create: `electron/projectRepository.test.ts`
- Modify: `electron/studioStore.ts` only if a narrowly typed read-only accessor is necessary

- [ ] **Step 1: Write failing repository tests**

  Test a bound project loaded from `ProjectAssetStore`, a matching expected revision, a mismatched expected revision, an external directory revision change, and an unbound project that loads only from `StudioStore` with legacy reproducibility.

  ```ts
  it('loads a bound project from its pinned directory and rejects a stale expected revision', async () => {
    const repository = new ProjectRepository({ studioStore });
    const bound = await repository.loadBound('project-orders', binding.revision);

    expect(bound).toMatchObject({
      source: 'projectDirectory',
      reproducibility: 'versioned',
      revision: binding.revision,
      project: expect.objectContaining({ id: 'project-orders' }),
    });
    await expect(repository.loadBound('project-orders', 'f'.repeat(64))).rejects.toMatchObject({
      code: 'staleProjectRevision',
    });
  });

  it('uses StudioStore only for an unbound legacy project', async () => {
    await expect(repository.load('legacy-project')).resolves.toMatchObject({
      source: 'legacyStudioStore',
      reproducibility: 'legacy',
    });
  });
  ```

- [ ] **Step 2: Run the repository test and verify it fails because the service is absent**

  Run: `pnpm exec node node_modules/vitest/vitest.mjs run electron/projectRepository.test.ts`

  Expected: FAIL with module-not-found or missing `ProjectRepository`.

- [ ] **Step 3: Implement the repository and structured errors**

  Create the exact contracts below. Clone the returned project before exposing it so callers cannot mutate repository-owned state.

  ```ts
  export interface ProjectSnapshot {
    project: ProjectDraft;
    revision: string;
    source: 'projectDirectory' | 'legacyStudioStore';
    reproducibility: 'versioned' | 'legacy';
  }

  export class ProjectRepositoryError extends Error {
    constructor(
      readonly code: 'projectNotFound' | 'bindingUnavailable' | 'staleProjectRevision' | 'projectRevisionChanged',
      message: string,
    ) {
      super(message);
      this.name = 'ProjectRepositoryError';
    }
  }

  export interface ProjectRepository {
    load(projectId: string): Promise<ProjectSnapshot>;
    loadBound(projectId: string, expectedRevision?: string): Promise<ProjectSnapshot>;
  }

  export function createProjectRepository(
    dependencies: { studioStore: Pick<StudioStore, 'load'> },
  ): ProjectRepository;
  ```

  `createProjectRepository()` returns an object whose `load()` reads the state once, finds its normalized binding, and delegates bound loading to `ProjectAssetStore.loadWithRevision()`. It requires the project ID to match and compares the loaded revision to the binding revision before returning. Its `loadBound()` rejects unbound projects, missing directories, mismatched project IDs, stored binding revisions that differ from disk, and explicit expected revisions that differ from the pinned snapshot. Legacy loads compute `calculateProjectAssetRevision(project)`, set `legacyStudioStore` / `legacy`, and never inspect a random directory.

- [ ] **Step 4: Run repository and affected store tests**

  Run: `pnpm exec node node_modules/vitest/vitest.mjs run electron/projectRepository.test.ts electron/studioStore.test.ts electron/projectAssetStore.test.ts`

  Expected: PASS.

- [ ] **Step 5: Commit the repository**

  ```bash
  git add electron/projectRepository.ts electron/projectRepository.test.ts electron/studioStore.ts electron/studioStore.test.ts
  git commit --only electron/projectRepository.ts electron/projectRepository.test.ts electron/studioStore.ts electron/studioStore.test.ts -m "feat: load revision-pinned project snapshots"
  ```

  Omit unchanged StudioStore paths from the command.

## Task 5: Replace renderer-owned run assets with exact run intent

**Files:**
- Modify: `shared/studio.ts:1289-1334`
- Modify: `electron/runtime/runtime-bundle.ts:39-292`
- Modify: `electron/ipc/runtime-ipc-handlers.ts:24-179`
- Modify: `electron/ipc/runtime-ipc-handlers.test.ts`
- Modify: `electron/main.ts`

- [ ] **Step 1: Write failing IPC tests for authority and stale revision rejection**

  Assert a renderer `project` property is ignored, a bound request with an old `expectedProjectRevision` is rejected before `RuntimeBundle.runTestCase`, and a successful request passes the repository-resolved v1 Case and environment into the internal runtime request.

  ```ts
  await expect(handler({}, {
    projectId: project.id,
    testCase: { id: 'case/checkout', version: 1 },
    expectedProjectRevision: '0'.repeat(64),
    project: forgedRendererProject,
  } as unknown as RunTestCaseIntent)).rejects.toMatchObject({ code: 'staleProjectRevision' });

  expect(runtime.runTestCase).not.toHaveBeenCalled();
  ```

- [ ] **Step 2: Run the IPC suite and verify it fails because public requests still require `ProjectDraft`**

  Run: `pnpm exec node node_modules/vitest/vitest.mjs run electron/ipc/runtime-ipc-handlers.test.ts`

  Expected: FAIL due to absent intent type/repository dependency and the current direct request forwarding.

- [ ] **Step 3: Define public intent and internal resolved request contracts**

  In `shared/studio.ts`, use renderer-safe public intent only:

  ```ts
  export interface RunTestCaseIntent {
    runId?: string;
    projectId: string;
    testCase: VersionedTestAssetReference;
    expectedProjectRevision?: string;
  }

  export interface RunSuiteIntent {
    runId?: string;
    projectId: string;
    suite: VersionedTestAssetReference;
    expectedProjectRevision?: string;
  }
  ```

  Keep runtime profile, model config, browser session, cancellation signal, fixture script trust, and full `ProjectDraft` out of these IPC types. Define unexported-or-Electron-only resolved request types in `runtime-bundle.ts` that contain `ProjectSnapshot`, exact Case/Suite asset, environment, and main-owned runtime configuration. `RuntimeBundle` must only accept resolved requests.

  Add `projectRepository: Pick<ProjectRepository, 'load' | 'loadBound'>` to `RuntimeIpcDependencies`. The handler calls `loadBound(projectId, expectedProjectRevision)` when the project is bound, `load(projectId)` when it is not, calls `findTestCaseVersion` or exact Suite lookup, and throws a structured `missingAssetVersion` error before invoking a browser if resolution fails. Continue to obtain fixture trust in main using the project ID. Configure this dependency in `main.ts` once when registering handlers.

- [ ] **Step 4: Run focused IPC/runtime tests**

  Run: `pnpm exec node node_modules/vitest/vitest.mjs run electron/ipc/runtime-ipc-handlers.test.ts electron/runtime/runtime-bundle.test.ts electron/runtime/test-runner.test.ts electron/runtime/suite-runner.test.ts`

  Expected: PASS. Existing runtime tests build internal resolved requests, while IPC tests exercise public intent.

- [ ] **Step 5: Commit main-process authority enforcement**

  ```bash
  git add shared/studio.ts electron/runtime/runtime-bundle.ts electron/ipc/runtime-ipc-handlers.ts electron/ipc/runtime-ipc-handlers.test.ts electron/main.ts electron/runtime/runtime-bundle.test.ts electron/runtime/test-runner.test.ts electron/runtime/suite-runner.test.ts
  git commit --only shared/studio.ts electron/runtime/runtime-bundle.ts electron/ipc/runtime-ipc-handlers.ts electron/ipc/runtime-ipc-handlers.test.ts electron/main.ts electron/runtime/runtime-bundle.test.ts electron/runtime/test-runner.test.ts electron/runtime/suite-runner.test.ts -m "feat: resolve exact run assets in main"
  ```

## Task 6: Route preload, renderer bridge, and CLI through the repository

**Files:**
- Modify: `electron/preload.cts`
- Modify: `electron/preload-contract.test.ts`
- Modify: `src/lib/runtime.ts`
- Modify: `src/lib/runtime.test.ts`
- Modify: `electron/cli.ts`
- Modify: `electron/cli.test.ts`

- [ ] **Step 1: Write failing bridge and CLI tests**

  Update preload expectations to invoke exactly the new intent. Change CLI examples to require `--case-id <id@version>`, and add a test proving a bound project executes Case v1 even when state.json contains Case v2. Add a CLI test that rejects bare `--case-id case/checkout`.

  ```ts
  it('requires an exact immutable Case reference', () => {
    expect(() => parseCliArguments([
      'run', '--data-dir', '/workspace/testbuddy', '--project-id', 'project-web', '--case-id', 'case-login',
    ])).toThrow('--case-id 必须使用 <id@version> 格式。');
  });
  ```

- [ ] **Step 2: Run the bridge and CLI suites and verify they fail under the old request shape**

  Run: `pnpm exec node node_modules/vitest/vitest.mjs run electron/preload-contract.test.ts src/lib/runtime.test.ts electron/cli.test.ts`

  Expected: FAIL because the renderer bridge passes a full project/test case and CLI parses bare Case IDs.

- [ ] **Step 3: Implement exact public calls and shared CLI loading**

  Make `desktopApi.runTestCase` and `desktopApi.runSuite` accept `RunTestCaseIntent` / `RunSuiteIntent`. In the browser-only fallback, resolve with `findTestCaseVersion()` from the in-memory legacy project and label the response path legacy; it must not claim bound reproducibility.

  Update CLI parsing so every `--case-id` uses the existing `parseVersionedReference(value, '--case-id')`. Have `executeCliCommand()` build `ProjectRepository({ studioStore: store })`, load its snapshot once, select exact Cases via `findTestCaseVersion`, and pass an internal resolved runtime request. Preserve `--suite-id` exact behavior. Keep `--data-dir` as the source of binding and credentials; add optional `--project-directory <path>` only if needed to run a directory that has no StudioStore binding, and in that case require explicit data-dir for runtime secrets and validate the directory project ID before execution.

- [ ] **Step 4: Run all bridge and CLI tests**

  Run: `pnpm exec node node_modules/vitest/vitest.mjs run electron/preload-contract.test.ts src/lib/runtime.test.ts electron/cli.test.ts electron/projectRepository.test.ts`

  Expected: PASS. CLI and desktop are both repository-backed for bound projects.

- [ ] **Step 5: Commit the shared desktop/CLI execution route**

  ```bash
  git add electron/preload.cts electron/preload-contract.test.ts src/lib/runtime.ts src/lib/runtime.test.ts electron/cli.ts electron/cli.test.ts
  git commit --only electron/preload.cts electron/preload-contract.test.ts src/lib/runtime.ts src/lib/runtime.test.ts electron/cli.ts electron/cli.test.ts -m "feat: run exact case versions from desktop and cli"
  ```

## Task 7: Make Case editing draft-first and publishing append-only

**Files:**
- Modify: `src/App.tsx:189-275`, `src/App.tsx:687-723`, `src/App.tsx:1335-1360`, `src/App.tsx:1902-1963`, `src/App.tsx:2365-2461`
- Modify: `src/features/cases/TestCaseManagementPage.tsx:220-286`, `src/features/cases/TestCaseManagementPage.tsx:993-1301`
- Modify: `src/features/cases/TestCaseManagementPage.test.tsx`
- Test: `src/App.test.tsx` (create if App behavior cannot be isolated through page callbacks)

- [ ] **Step 1: Write failing UI tests for immutable publish semantics**

  Add tests that select v1, begin editing, change a title, discard and observe no project mutation; publish and observe `[v1, v2]` with v1 unchanged; select the older v1 and invoke run, asserting the outgoing intent contains `{ id, version: 1 }`; and default inventory lists v2 once per Case ID.

  ```tsx
  await user.click(screen.getByRole('button', { name: /edit as new version/i }));
  await user.type(screen.getByLabelText(/name/i), ' v2');
  await user.click(screen.getByRole('button', { name: /publish version/i }));

  expect(onPublishCase).toHaveBeenCalledWith(expect.objectContaining({ id: 'case/checkout', version: 2 }));
  expect(project.testCases.find((item) => item.version === 1)?.name).toBe('Checkout v1');
  ```

- [ ] **Step 2: Run the Case page tests and verify the current in-place update fails the new contract**

  Run: `pnpm exec node node_modules/vitest/vitest.mjs run src/features/cases/TestCaseManagementPage.test.tsx`

  Expected: FAIL because the page has only `onUpdateTestCase` and App increments/replaces the current Case object.

- [ ] **Step 3: Implement explicit draft state and append-only publishing**

  In `App.tsx`, retain persisted `selectedTestCaseReference: VersionedTestAssetReference` (derive the legacy `selectedTestCaseId` only for old state hydration), and add ephemeral `caseDraft: TestCaseDraft | undefined`. `handleEditCaseVersion()` clones the selected published asset into `caseDraft`; all editor callbacks update only that draft. `handlePublishCase()` calls `createNextTestCaseVersion(selectedProject, selectedPublishedCase, caseDraft)`, appends it to `project.testCases`, selects its exact reference, then clears the draft. `handleCreateTestCase()` creates one published v1. `handleDiscardCaseDraft()` clears the draft without touching the project.

  Change every automatic Case-changing path in this wave (step mutations, recording detach, agent-save-as-Case) to route through a draft or explicitly append `createNextTestCaseVersion`; do not increment `version` in place. The UI page receives `publishedTestCase`, `draftTestCase`, `selectedReference`, `onEditAsNewVersion`, `onPublishCase`, and `onDiscardCaseDraft`. Disable Run while a draft is open; otherwise call `onRunTestCase` with the selected published exact reference. Use `listLatestTestCaseVersions(project)` for the default selector, and provide an explicit version picker that displays all published versions for the selected Case ID.

- [ ] **Step 4: Run UI-focused tests**

  Run: `pnpm exec node node_modules/vitest/vitest.mjs run src/features/cases/TestCaseManagementPage.test.tsx src/App.test.tsx`

  Expected: PASS. Existing editing tests are updated to assert draft mutation followed by publish, not immediate project mutation.

- [ ] **Step 5: Commit immutable Case editing**

  ```bash
  git add src/App.tsx src/App.test.tsx src/features/cases/TestCaseManagementPage.tsx src/features/cases/TestCaseManagementPage.test.tsx
  git commit --only src/App.tsx src/App.test.tsx src/features/cases/TestCaseManagementPage.tsx src/features/cases/TestCaseManagementPage.test.tsx -m "feat: publish case edits as immutable versions"
  ```

  Omit `src/App.test.tsx` if its creation was not required.

## Task 8: Connect bound revision state to UI execution and legacy disclosure

**Files:**
- Modify: `src/App.tsx:1990-2030`, `src/App.tsx:2365-2461`
- Modify: `src/features/project/ProjectManagementPage.tsx`
- Modify: `src/features/project/ProjectManagementPage.test.tsx`
- Modify: `src/features/runs/RunRecordsPage.tsx`
- Modify: `src/features/runs/RunRecordsPage.test.tsx`
- Modify: `src/i18n/index.ts`

- [ ] **Step 1: Write failing UI tests for revision intent and legacy labeling**

  Test that a bound Case/Suite run contains the binding revision, stale-revision failures display a reload action rather than retrying with the editor object, and an unbound project is labeled non-reproducible in project/run surfaces. Test rerun remains disabled or displays legacy-unavailable text for prior records that lack future Wave 2 provenance.

  ```tsx
  expect(runTestCase).toHaveBeenCalledWith({
    projectId: project.id,
    testCase: { id: 'case/checkout', version: 2 },
    expectedProjectRevision: binding.revision,
  });
  expect(screen.getByText(/legacy.*not reproducible/i)).toBeInTheDocument();
  ```

- [ ] **Step 2: Run project/run UI tests and verify they fail because calls still include `ProjectDraft`**

  Run: `pnpm exec node node_modules/vitest/vitest.mjs run src/features/project/ProjectManagementPage.test.tsx src/features/runs/RunRecordsPage.test.tsx`

  Expected: FAIL with old run request shape or absent reproducibility UI.

- [ ] **Step 3: Implement revision-aware intents and honest legacy presentation**

  Derive the active binding once from `projectAssetBindings`. For a bound run, send `expectedProjectRevision: binding.revision`; for legacy, omit it and display a translated `legacy/non-reproducible` badge. On `ProjectRepositoryError.code === 'staleProjectRevision' || 'projectRevisionChanged'`, show a reload instruction and do not invoke a fallback run. Suite requests send the selected exact Suite reference and the same binding revision. Rerun in this wave must keep using the currently selected exact Case only for a new legacy run and must not be labeled historical rerun; Wave 2 replaces it with provenance-based rerun.

- [ ] **Step 4: Run the affected UI suites**

  Run: `pnpm exec node node_modules/vitest/vitest.mjs run src/features/project/ProjectManagementPage.test.tsx src/features/runs/RunRecordsPage.test.tsx src/features/cases/TestCaseManagementPage.test.tsx`

  Expected: PASS.

- [ ] **Step 5: Commit revision-aware UI behavior**

  ```bash
  git add src/App.tsx src/features/project/ProjectManagementPage.tsx src/features/project/ProjectManagementPage.test.tsx src/features/runs/RunRecordsPage.tsx src/features/runs/RunRecordsPage.test.tsx src/i18n/index.ts
  git commit --only src/App.tsx src/features/project/ProjectManagementPage.tsx src/features/project/ProjectManagementPage.test.tsx src/features/runs/RunRecordsPage.tsx src/features/runs/RunRecordsPage.test.tsx src/i18n/index.ts -m "feat: send revision-pinned run intents"
  ```

## Task 9: Prove end-to-end Wave 1 compatibility and record evidence

**Files:**
- Modify: `electron/projectAssetStore.test.ts`
- Modify: `electron/projectRepository.test.ts`
- Modify: `electron/ipc/runtime-ipc-handlers.test.ts`
- Modify: `electron/cli.test.ts`
- Modify: `docs/2026-08-13-grill-me-application-renovation-plan.md`

- [ ] **Step 1: Write one cross-boundary failing regression test**

  Use a temporary bound directory containing Case v1/v2 and a Suite pinned to v1. Invoke the main/IPC path and CLI path with the same binding revision. Assert both execute v1 and that neither begins browser execution when the requested revision is stale or Case v1 is missing.

  ```ts
  expect(mainRuntime.runTestCase).toHaveBeenCalledWith(expect.objectContaining({
    snapshot: expect.objectContaining({ revision: binding.revision, reproducibility: 'versioned' }),
    testCase: expect.objectContaining({ id: 'case/checkout', version: 1 }),
  }));
  expect(cliSummary.results[0]).toMatchObject({ testCaseId: 'case/checkout' });
  expect(browserRuntime.start).not.toHaveBeenCalled();
  ```

- [ ] **Step 2: Run the cross-boundary test and verify it fails before the last integration gap is fixed**

  Run: `pnpm exec node node_modules/vitest/vitest.mjs run electron/projectRepository.test.ts electron/ipc/runtime-ipc-handlers.test.ts electron/cli.test.ts`

  Expected: FAIL until desktop and CLI use the same repository-resolved snapshot/Case object.

- [ ] **Step 3: Make only the minimal integration correction**

  Fix the remaining boundary revealed by the red test. Do not add Wave 2 provenance, terminal-status migration, secret migration, browser pooling, or Flow support. Preserve all legacy run records; this wave only labels their future execution path as legacy/non-reproducible.

- [ ] **Step 4: Run the complete Wave 1 verification set**

  Run:

  ```bash
  pnpm exec node node_modules/vitest/vitest.mjs run shared/studio.test.ts electron/projectAssetStore.test.ts electron/projectRepository.test.ts electron/ipc/runtime-ipc-handlers.test.ts electron/preload-contract.test.ts electron/cli.test.ts src/lib/runtime.test.ts src/features/cases/TestCaseManagementPage.test.tsx src/features/project/ProjectManagementPage.test.tsx src/features/runs/RunRecordsPage.test.tsx
  pnpm check
  pnpm test:browser-smoke
  ```

  Expected: all commands exit 0. `pnpm check` stays independent of browser download; the dedicated smoke remains the only Playwright launch command.

- [ ] **Step 5: Update evidence and commit Wave 1 verification**

  In the Grill Me document, replace Wave 1's future-tense status with exact local command outcomes and retain the statement that hosted CI is unverified until GitHub has run it.

  ```bash
  git add electron/projectAssetStore.test.ts electron/projectRepository.test.ts electron/ipc/runtime-ipc-handlers.test.ts electron/cli.test.ts docs/2026-08-13-grill-me-application-renovation-plan.md
  git commit --only electron/projectAssetStore.test.ts electron/projectRepository.test.ts electron/ipc/runtime-ipc-handlers.test.ts electron/cli.test.ts docs/2026-08-13-grill-me-application-renovation-plan.md -m "docs: record wave one verification"
  ```

## Plan self-review

- Spec coverage: Tasks 1-3 implement immutable Cases, manifest v2, strict exact resolution, migration preview/conflicts/backups/atomicity/idempotence, and historical Suite Case execution. Tasks 4-6 establish a shared revision-pinned repository and remove renderer/CLI reconstruction authority. Tasks 7-8 implement publish-only Case editing, exact UI run selection, stale revision handling, and explicit legacy disclosure. Task 9 proves desktop/CLI parity plus final local gates.
- Deferred by design: RunProvenance, rerun fidelity, terminal status/reason codes, Suite parent history, secrets, evidence retention, Flow assets, and browser concurrency remain Wave 2+ work.
- Consistency: Case versions use `VersionedTestAssetReference` everywhere; bound snapshots are always `projectDirectory/versioned`; only main and CLI construct resolved runtime requests; `expectedProjectRevision` is an optimistic read guard, never a renderer-provided asset source.
- Commit safety: every listed command is path-scoped. Never stage or commit the external `.npmrc` change.
