# Reusable Flows V1 Design

## Goal

Implement Phase 5 as a version-pinned reusable-flow path for confirmed deterministic browser work. A Case binds one or more exact `flowId@version` references in order; desktop and CLI resolve those exact assets before a run, execute every Flow before the Case's own steps, and record the resolved versions in the Case result.

The design makes public setup such as navigation and deterministic login steps reusable without allowing edits to one Flow to silently change a Case or Suite execution.

## Scope

V1 delivers:

- Immutable `ReusableFlowAsset` versions stored in a project's `reusable-flows/` directory.
- Exact Flow references on Cases, ordered execution, and browser-start preflight.
- Flow inventory and immutable editing in desktop; Case settings can bind and unbind an exact Flow version.
- Case and Suite execution through the existing `TestRunner` / `RuntimeBundle` path; CLI reuses the same resolution.
- Run evidence that identifies all resolved Flows and labels individual Flow-originated step logs.
- Read-only Flow impact analysis for directly affected Cases, their Suites, and the related Fixture/Baseline references.
- User-confirmed, single-project batch upgrades of selected direct Case references to a chosen newer Flow version.

V1 explicitly does not deliver:

- Reusable Agent, manual, recording-replay, or arbitrary Workflow segments.
- Flow nesting, recursion, per-Flow fixtures, or Flow-specific environments.
- A Flow-only CLI command or a synthetic Flow run record.
- Automatic Case, Suite, Fixture, or Baseline upgrades.
- Case-version history storage. The existing Case model keeps a current revision only; an upgraded Case makes a Suite that pins its prior Case version fail existing stale-version preflight rather than silently changing it. Historical RunDetail evidence remains unchanged. Full historical Case replay belongs to the unfinished Regression Case V2 / Project Asset version-history work.

## Asset Contract

`shared/studio.ts` adds:

```ts
interface ReusableFlowAsset {
  schemaVersion: 1;
  id: string;
  version: number;
  name: string;
  description: string;
  tags: string[];
  steps: TestStepDraft[];
  createdAt: string;
  updatedAt: string;
}
```

The `ProjectDraft` gains `reusableFlows: ReusableFlowAsset[]`. Its existing `TestCaseAssetReferences.reusableFlows` field remains the ordered list of exact `{ id, version }` references. A Case can bind at most one version of a given Flow ID, matching the existing reference normalization rule.

A valid Flow step is either:

- an `ai` step with a confirmed supported deterministic action; or
- an `aiAssert` step with a confirmed explicit assertion.

`manual`, `recordingReplay`, `aiQuery`, unconfirmed actions/assertions, and unsupported action shapes are invalid in a Flow. Flow input actions may use an already-supported literal or project credential binding. They cannot use `fixtureOutput`: a Flow has no hidden Fixture dependency, and fixture response values must remain scoped to an explicitly bound Case.

`createEmptyReusableFlowAsset()` creates a V1 draft with no steps. `findReusableFlowAsset()` resolves only the requested `{ id, version }`. `resolveTestCaseReusableFlows()` returns the ordered assets plus explicit missing-version and invalid-flow issues; it never chooses a newer version.

The runtime-only evidence contract adds the ordered resolved references to `RunDetail` and an optional Flow source reference to `RunStepLog`. Neither changes project assets or exposes resolved credentials / Fixture values.

## Project Asset Storage

`ProjectAssetStore` treats Flow versions like Fixture and Suite versions:

- Manifest: `assetIds.reusableFlows: VersionedTestAssetReference[]`.
- Files: `reusable-flows/<encoded-id>@<version>.json`.
- Snapshot creation, validation, directory-layout checks, revision calculation, atomic writes, and load hydration include every Flow version.
- Validation rejects duplicate `(id, version)` pairs, malformed Flow metadata, and unsupported Flow steps. Case Flow references must resolve exactly within the same project snapshot.

Old snapshots without `assetIds.reusableFlows` load with an empty Flow collection, just as snapshots written before Fixture/Suite support remain compatible. Any Flow-aware snapshot writes the collection and its directory entry atomically with the rest of the project snapshot.

## Execution Model

Before Fixture setup or browser startup, `TestRunner` resolves each Flow reference in Case order. It validates all Flow steps and produces an ephemeral sequence:

```text
Flow A@1 steps -> Flow B@3 steps -> Case-owned steps
```

The sequence is not written back to the Case. The normal Case Fixture lifecycle is still executed once around the whole sequence. A missing Flow, stale Flow version, invalid Flow step, or cancellation before startup returns a neutral preflight response and does not start the browser.

The runner processes the flattened sequence using the existing confirmed deterministic action/assertion path. A Flow step failure or cancellation stops the remaining Flow and Case-owned steps, creating neutral logs for unexecuted entries. Each resulting `RunStepLog` retains the Flow reference when applicable; the `RunDetail` retains the full ordered resolved reference list.

`RuntimeBundle.executeTestCase()` routes any Case with Flow references through `TestRunner`, even when the Case otherwise contains Agent-runnable steps. This preserves the Flow-first order and lets `TestRunner` delegate only the remaining dynamic Case steps through its existing path. Suite execution already calls the same Case adapter, so it inherits exact Flow resolution and Flow evidence without a second Suite-specific implementation. Browser fallback uses the same pure resolver and emits a neutral result for invalid/missing assets rather than resolving a latest Flow.

## Desktop Workflow

The desktop adds a `flows` workspace route and navigation item:

- Inventory shows every published version, with `name` and `vN` independently selectable.
- A saved version is read-only. “Edit as new version” clones it into a draft; publish assigns the next version for the same Flow ID. New Flow creates a new ID at v1.
- The editor accepts only allowed deterministic action/assertion step forms and shows invalid draft reasons before publishing.
- A Case settings panel offers exact available Flow versions, displays its ordered bindings, and permits reorder/remove. Updating a Case continues to use its normal incremented revision behavior.

The selected Flow's impact panel can choose an older source version and a newer target version of the same Flow ID. It displays:

- Direct Cases referencing the source exact version.
- Suites that pin those exact Case revisions.
- Fixture and Baseline references attached to those direct Cases as related context.
- A per-Case reference diff from `flowId@old` to `flowId@new`.

No project asset changes occur while viewing the impact analysis. The confirmation dialog defaults to all direct Cases and allows the user to exclude individual Cases. Confirming applies one `updateSelectedProject` transition: each selected Case has its Flow reference replaced, receives its normal next Case revision, and all other project arrays are preserved. The project state is saved as one immediate update. A bound project directory still uses the existing explicit update-plan/CAS confirmation before publishing that revised project snapshot.

Suites are impact-only in V1. They retain their exact old Case references and are never rewritten. If a selected Case revision makes an existing Suite stale, the user creates a new immutable Suite version separately.

## Reverse Impact Analysis

Impact is a pure shared helper computed from the current project graph; no mutable reverse-index cache is persisted:

```text
source Flow reference
  -> Cases whose ordered reusableFlows contains the exact reference
  -> Suites whose Case references match those Cases' current revisions
  -> Fixture / Baseline references declared by the direct Cases
```

The helper returns stable, ID/version-sorted references and never infers a version upgrade. It also reports missing source/target Flow versions as analysis issues so the desktop cannot offer an unsafe confirmation.

## Error and Cancellation Behavior

- Invalid or unresolved Flow references are neutral preflight failures before browser start.
- Invalid Flow drafts cannot publish.
- A Flow step that fails stops the Case exactly as a failed Case-owned deterministic step does.
- A parent Suite cancellation reaches the Flow step through the Case cancellation signal; unexecuted Flow and Case steps are neutral and a started Case retains its real run ID.
- Impact computation and upgrade planning are read-only. The only mutation is the user-confirmed, single-project update.

## Test Plan

Add focused tests for:

- Empty Flow factory, exact lookup, strict validation, hydration compatibility, and Flow reference normalization.
- Project asset snapshot/write/load with multiple Flow versions, malformed Flow rejection, and exact Case reference integrity.
- TestRunner preflight blocking before browser start, Flow-before-Case ordering, Flow failure/cancellation stopping later entries, and Flow provenance in RunDetail / RunStepLog.
- RuntimeBundle and browser fallback propagation; Suite runs record the same resolved Flow versions through Case details.
- Desktop Flow creation/new-version publishing, Case exact-version binding/reordering, immutable old-version selection, impact display, and confirmed selected-Case upgrade behavior.
- Pure impact analysis: direct Cases, matching Suites, Fixture/Baseline context, deterministic ordering, and no automatic Suite rewrite.

The normal quality gate remains the project's `pnpm`-based test, TypeScript, renderer/Electron build, and diff checks. In this workspace, use the established `pnpm exec node node_modules/...` equivalents if the root executable links are unavailable.

## Acceptance Criteria

- Editing a Flow produces a new Flow version; existing Case references and historical RunDetails remain unchanged.
- A Case and Suite run resolve only the Flow versions they explicitly reference, and their run evidence identifies those versions.
- Missing/invalid Flow assets block before browser startup and never fall back to the newest version.
- Users can inspect the exact Cases and Suites affected by a Flow upgrade, review Case-level diffs, and confirm one atomic Case update without implicit Suite changes.
- Project asset snapshots preserve every Flow version and retain compatibility with Flow-less existing snapshots.
