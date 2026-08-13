# Reproducible Regression Foundation Design

## Goal

Deliver Waves 0-2 of the Grill Me renovation plan: make TestBuddy's local regression assets version-addressable, make every new run explain exactly what it executed, and make historical reruns refuse ambiguity instead of silently using current project state.

The repository's completion boundary is local deterministic verification: `pnpm` quality checks, CI, Electron IPC smoke coverage, and a local Playwright fixture page. Real business systems and model providers remain separately configured external acceptance work; they do not become a repository CI dependency.

## Scope

This design delivers:

- A reliable `pnpm check` entry point, GitHub Actions verification, and local Electron/main-preload smoke coverage.
- Immutable, exact-version Case assets at `cases/<id>@<version>.json`, with compatibility migration from legacy current-Case storage.
- A revision-pinned `ProjectRepository` that is authoritative for bound project directories and shared by desktop main process and CLI.
- Exact Case resolution for desktop, CLI, Suite members, and rerun planning.
- Six terminal run states, stable reason codes, and separate flaky metadata.
- Frozen `RunProvenance` for every new Case run and a parent `SuiteRunRecord` contract ready for later Suite reporting.
- Rerun planning that resolves the original exact references and environment snapshot or returns an explicit blocked reason.

This design does not deliver:

- Model secret migration, artifact retention, reusable Flow UI/execution, browser pooling, Maintenance drafts, or new browser interactions. Those belong to Waves 3-6.
- Automatic verification against a proprietary staging environment, credentials, or paid model provider.
- Automatic migration publication, latest-version resolution, or implicit Suite rewrites.
- A full unrelated split of `src/App.tsx` or `electron/studioRuntime.ts`. New contracts are extracted only where this work needs an independently testable boundary.

## Constraints

- Use `pnpm` for package management and all repository commands.
- Work occurs on the current branch. Existing uncommitted Suite Desktop Adapter changes are preserved and are not staged or committed as part of these waves.
- Renderer never supplies execution-authoritative project assets or secrets to main process. Main process resolves a revision-pinned snapshot before execution.
- All storage migration is read-compatible first, reviewable before write, atomic after confirmation, and idempotent after a completed migration.
- The renderer and reports never receive an API key, resolved credential value, or raw storage-state value.

## Wave 0: Verification Baseline

### Package Contract

`package.json` remains `pnpm`-native. `test`, TypeScript and Vite scripts invoke package-local binaries through `pnpm exec`; `check` composes those stable scripts. It must not rely on a pre-existing root `.bin` link in the invoking shell.

```text
pnpm check
  -> pnpm test
  -> pnpm typecheck
  -> pnpm build
  -> git diff --check
```

The repository provides a `typecheck` script that checks renderer and Electron TypeScript projects. `check` runs the complete deterministic suite and build once. The CI runner installs with `pnpm install --frozen-lockfile`, invokes `pnpm check`, and runs a smoke command that tests typed preload/main request wiring against a temporary Studio data root. The smoke does not need a visible Electron window or a model key.

### Layered Local Verification

Tests are split by evidence source, rather than claiming all tests prove browser integration:

1. Existing pure/shared and React component tests protect contracts and UI rendering.
2. Electron main/preload integration tests call registered handlers using controlled temporary roots.
3. A local Playwright fixture page exercises one confirmed deterministic Case, artifact capture, Suite cancellation, and artifact opening through the real BrowserRuntime boundary. It never calls a real model endpoint.

The local fixture can be started in a test-owned process. It has deterministic routes and no external network dependency. CI records failures but does not upload application-run secrets or private artifacts.

## Wave 1: Versioned Cases and Project Authority

### Case Assets

The asset contract introduces a `VersionedCaseAssetReference` using the existing `{ id, version }` representation. Case versions are immutable published assets:

```text
<project-directory>/
  project.json
  cases/
    <encoded-case-id>@1.json
    <encoded-case-id>@2.json
```

`project.json` manifest v2 stores every exact Case reference, not just a Case ID. A Case's `version` must match its filename and manifest reference. Duplicate `(id, version)` pairs, unreferenced files, missing manifest files, malformed version metadata, and references to unknown fixtures/flows/baselines are validation failures.

The persisted project snapshot maintains `testCases: TestCaseDraft[]` for compatibility, but each array item represents a published exact version. Shared helpers own these invariants:

- `findTestCaseVersion(project, reference)` resolves only the requested version.
- `listLatestTestCaseVersions(project)` derives one highest version per Case ID for default inventory views.
- `createNextTestCaseVersion(project, source, patch)` clones an exact source and assigns the next version for that ID.
- `resolveSuiteCases(project, suite)` resolves every member reference without fallback.

There is no helper that turns a missing exact reference into the latest Case. A normal "run current Case" UI action first obtains the selected published version and sends its explicit reference.

### Case Editing Workflow

Published Cases are read-only. The Case inventory defaults to each Case's latest published version, with version selection available. Editing creates a draft based on the chosen version. Publishing creates the next version for the same ID; creating a new Case creates v1. Discarding a draft does not change the project snapshot.

This is a semantic change from replacing one Case object in `ProjectDraft.testCases`. UI reducers and any bulk upgrade paths use `createNextTestCaseVersion` rather than incrementing an object in place. Existing Suite references remain unchanged; their old Case versions remain executable.

### Legacy Case Migration

Legacy project snapshots have one Case object per ID and may be stored in `studio-data/state.json` or as `cases/<id>.json` in a bound directory. Binding a project directory produces a migration preview:

1. Read legacy project and directory assets without modification.
2. Normalize each Case's published version to `1` if it has no history; retain its existing positive `version` as the proposed initial version only when no version file conflict exists.
3. Propose every required `cases/<id>@<version>.json` file and a manifest v2 Case reference collection.
4. Detect duplicate target references, malformed IDs, mismatched file IDs, missing exact Suite references, or an existing conflicting version file. Any issue blocks confirmation.
5. On user confirmation, atomically write the new manifest and version files. Legacy Case files are retained in a migration backup location recorded by the manifest.
6. Load and validate the new snapshot before switching the binding. A completed migration preview is idempotent and must not create additional versions.

An unbound StudioStore project remains executable only through an explicit `legacy` path. It is labelled non-reproducible, generates conservative provenance, and cannot claim historical rerun fidelity. First binding must use the review flow; it cannot silently write a project directory.

### ProjectRepository

`ProjectRepository` is a main-process and CLI service that returns a validated immutable project snapshot:

```ts
interface ProjectSnapshot {
  project: ProjectDraft;
  revision: string;
  source: 'projectDirectory' | 'legacyStudioStore';
  reproducibility: 'versioned' | 'legacy';
}

interface ProjectRepository {
  load(projectId: string): Promise<ProjectSnapshot>;
  loadBound(projectId: string, expectedRevision?: string): Promise<ProjectSnapshot>;
}
```

For a bound project, the repository calls `ProjectAssetStore.loadWithRevision()` and requires the requested revision when one is supplied. It rejects external directory changes and stale renderer edit state before a run starts. For a legacy project, it reads StudioStore only and sets `source: 'legacyStudioStore'` and `reproducibility: 'legacy'`.

StudioStore retains project bindings, UI state, run history, secret references and caches. It no longer acts as the authoritative long-term asset source for bound project execution. CLI receives a project directory or binding and uses the same repository path as desktop instead of reconstructing a `ProjectDraft` independently.

## Wave 2: Run Identity and Terminal Semantics

### Run States and Reason Codes

`RunTone` is replaced by a lifecycle status:

```ts
type RunStatus =
  | 'running'
  | 'passed'
  | 'failed'
  | 'blocked'
  | 'skipped'
  | 'cancelled'
  | 'error';

type RunReasonCode =
  | 'assertionFailed'
  | 'actionFailed'
  | 'missingAssetVersion'
  | 'fixturePreflight'
  | 'credentialUnavailable'
  | 'dependencyFailed'
  | 'userCancelled'
  | 'unsupportedAction'
  | 'executorError'
  | 'legacyAmbiguousNeutral';
```

`flaky` is a separate boolean with retry metadata; it is never a terminal status. Every non-passed terminal result carries a reason code and human-readable message. New writes cannot use `neutral`.

Migration is conservative. Historical `neutral` entries map to a specific status only when existing structured evidence proves it. All remaining entries become `blocked` with `legacyAmbiguousNeutral`; migration never turns an ambiguous old result into a pass or assertion failure.

Suite aggregation uses the member statuses. A member not started because a dependency failed is `skipped/dependencyFailed`; a parent cancellation is `cancelled/userCancelled`; runner crashes are `error/executorError`. JSON and JUnit preserve the distinction: `failed` and `error` make the command fail, while `blocked`, `skipped`, and `cancelled` are reported as non-executed work.

### Frozen RunProvenance

Main process creates provenance from the immutable `ProjectSnapshot` before fixture setup or browser startup:

```ts
interface RunProvenance {
  schemaVersion: 1;
  projectId: string;
  projectRevision: string;
  source: 'projectDirectory' | 'legacyStudioStore';
  reproducibility: 'versioned' | 'legacy';
  testCase: VersionedTestAssetReference;
  suite?: {
    reference: VersionedTestAssetReference;
    parentRunId: string;
  };
  fixtures: VersionedTestAssetReference[];
  reusableFlows: VersionedTestAssetReference[];
  baselines: VersionedTestAssetReference[];
  environment: {
    id: string;
    name: string;
    baseUrl: string;
    storageStateRef?: string;
  };
  browserProfile: {
    engine: 'chromium';
    headless: boolean;
  };
  executor: {
    appVersion: string;
    runnerVersion: string;
  };
  model: {
    provider?: string;
    model?: string;
    endpointFingerprint?: string;
    hasKey: boolean;
  };
  createdAt: string;
}
```

No provenance field contains API keys, credentials, `storageState`, headers, resolved Fixture outputs or model prompts. Environment names and base URLs are persisted only after existing report-redaction rules run. Provenance is generated once, attached to the resulting `RunDetail`, Suite child record, report export and CLI output, then treated as immutable.

`SuiteRunRecord` becomes a separate parent contract, not a fabricated Case run:

```ts
interface SuiteRunRecord {
  id: string;
  provenance: Omit<RunProvenance, 'testCase'> & {
    suite: { reference: VersionedTestAssetReference; parentRunId: string };
  };
  startedAt: string;
  finishedAt?: string;
  status: Exclude<RunStatus, 'running'> | 'running';
  reasonCode?: RunReasonCode;
  memberRunIds: string[];
  summary: Record<Exclude<RunStatus, 'running'>, number>;
}
```

Wave 2 persists the parent record serially and supports reporting it. Browser pool and concurrent capacity remain Wave 5 work.

### Rerun Planning

Rerun accepts only a stored `RunProvenance`. The repository loads the stored project revision and resolves every exact reference. If any reference, environment dependency or original project revision is unavailable, the runner does not start a browser; it writes or returns `blocked/missingAssetVersion` with a missing-reference list.

For `legacy` provenance, the UI explicitly states that rerun is not historically reproducible. It may offer a user-confirmed "run latest legacy Case" as a new run, never as a rerun of the old run. New versioned runs use the original environment snapshot and exact Case version without substituting a current Case, Suite, Fixture, Flow or Baseline.

## Interfaces and Data Flow

```text
Renderer run intent (project ID + exact reference + known revision)
  -> typed preload IPC
  -> main ProjectRepository.loadBound()
  -> immutable ProjectSnapshot
  -> exact asset resolver
  -> RunProvenance freeze
  -> Shared Runner
  -> RunDetail / SuiteRunRecord / artifact references
  -> StudioStore run history + renderer report

CLI (project binding/directory + exact reference)
  -> ProjectRepository
  -> identical resolver, provenance and Shared Runner path
```

Renderer requests that carry an out-of-date binding revision receive a structured stale-revision response and must reload before retrying. Main process never accepts a renderer-supplied full `ProjectDraft` as the authority for a bound run. Project asset updates remain user-confirmed and use existing CAS/revision protections.

## Tests and Acceptance Criteria

Wave 0 tests verify `pnpm check` in a clean installed workspace, CI workflow syntax, typed IPC smoke registration, artifact-open validation and a local fixture deterministic Case/Suite cancellation path.

Wave 1 tests verify:

- Case v1/v2 coexist and exact lookup never falls back to latest.
- Suite references to Case v1 continue to resolve after Case v2 publishes.
- Asset snapshot/write/load validates manifest/file integrity and preserves every Case version.
- Legacy migration preview, conflict blocking, atomic confirmation, backup retention and idempotence.
- Desktop and CLI obtain the same revision and exact Case from one bound directory.
- Main rejects stale renderer revision and legacy runs are visibly marked non-reproducible.

Wave 2 tests verify:

- Each terminal state/reason code maps from runner paths, including cancellation, preflight blocks, dependency skips, action/assertion failures and executor errors.
- Legacy `neutral` migration is conservative.
- New `RunDetail` provenance is immutable, exact and secret-free.
- Suite parent record tracks member run IDs and status aggregation without pretending to be a Case.
- Rerun continues to select the historical Case/Fixture/Suite/Flow/Baseline versions after newer assets publish.
- Missing historical dependencies return `blocked/missingAssetVersion` before BrowserRuntime starts.
- Desktop and CLI JSON/JUnit report identical status and provenance semantics.

Waves 0-2 are accepted only after the fresh `pnpm check`, CI workflow, focused tests, and local Playwright fixture run all pass. Real external acceptance conditions are documented separately with their required environment, data, browser, model version and manual result.
