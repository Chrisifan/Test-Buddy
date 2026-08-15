# Wave 4 Versioned Reusable Flows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement immutable deterministic reusable Flows that Cases, Suites, provenance, and impact analysis resolve only by exact version.

**Architecture:** Follow `docs/superpowers/specs/2026-08-13-reusable-flows-v1-design.md`, replacing its obsolete mutable-Case assumption with Wave 1 `createNextTestCaseVersion`. Project assets persist all Flow versions in manifest storage. Main resolves Flow references before browser start, records them in Wave 2 provenance, and desktop upgrades produce new Case versions plus explicit Suite proposals.

**Tech Stack:** TypeScript, ProjectAssetStore, ProjectRepository, TestRunner/RuntimeBundle, Electron IPC, React, Vitest, `pnpm`.

---

## File Map

| File | Responsibility |
| --- | --- |
| `shared/studio.ts` / `.test.ts` | Immutable Flow schema, exact resolvers, Case binding validation, and read-only impact/upgrade proposals. |
| `electron/projectAssetStore.ts` / `.test.ts` | Manifest storage, validation, and atomic persistence of every Flow version. |
| `electron/projectRepository.ts` / `.test.ts` | Revision-pinned Flow-bearing snapshots used by desktop and CLI execution. |
| `electron/runtime/run-provenance.ts` | Frozen Flow references on each Case/Suite execution. |
| `electron/runtime/test-runner.ts`, `runtime-bundle.ts` and tests | Preflight, in-memory Flow flattening, Flow-origin log records, and terminal status mapping. |
| `electron/ipc/runtime-ipc-handlers.ts`, `electron/preload.cts`, `src/lib/runtime.ts` | Main-authoritative exact Flow/Cases run intents. |
| `src/features/flows/ReusableFlowsPage.tsx` / `.test.tsx` | Immutable Flow inventory, draft, publication, binding, and impact-review UI. |
| `src/features/cases/TestCaseManagementPage.tsx` / `.test.tsx`, `src/App.tsx` | Exact Case Flow bindings that publish a next Case version rather than mutate a published Case. |
| `src/i18n/index.ts` | Labels and validation/error text for Flow drafting and impact review. |

## Task 1: Add immutable Flow assets and exact resolvers

**Files:** `shared/studio.ts`, `shared/studio.test.ts`

- [ ] Add red tests for v1/v2 exact Flow lookup, strict allowed deterministic steps, duplicate reference rejection, and ordered Case resolution with no latest fallback.
- [ ] Run: `pnpm exec node node_modules/vitest/vitest.mjs run shared/studio.test.ts` (expect missing factories/resolvers).
- [ ] Add `ReusableFlowAsset`, `createEmptyReusableFlowAsset`, `findReusableFlowAsset`, `listLatestReusableFlowVersions`, `createNextReusableFlowVersion`, `validateReusableFlow`, and `resolveTestCaseReusableFlows`. Accept only confirmed supported `ai` action and `aiAssert` assertion steps; reject manual, recording replay, query, fixture output binding, unconfirmed, and unsupported steps.
- [ ] Re-run shared tests and commit:

```bash
git commit --only shared/studio.ts shared/studio.test.ts -m "feat: define immutable reusable flow assets"
```

## Task 2: Persist all Flow versions and validate Case references

**Files:** `electron/projectAssetStore.ts`, `electron/projectAssetStore.test.ts`, `shared/studio.ts`

- [ ] Add red disk tests for `reusable-flows/<encoded-id>@1.json` and `@2.json`, manifest references, Flow-less manifest compatibility, malformed Flow rejection, and a Case that names a missing Flow version.
- [ ] Run: `pnpm exec node node_modules/vitest/vitest.mjs run electron/projectAssetStore.test.ts`.
- [ ] Add `assetIds.reusableFlows` and versioned directory layout to snapshot, hash, atomic writer, migration-compatible hydration, and exact Case-reference validation. Do not auto-upgrade old Flow refs.
- [ ] Re-run tests and commit `feat: persist versioned reusable flows`.

## Task 3: Execute Flow steps before Case steps and record provenance

**Files:** `electron/runtime/test-runner.ts`, `electron/runtime/runtime-bundle.ts`, `electron/runtime/test-runner.test.ts`, `electron/runtime/runtime-bundle.test.ts`, `electron/runtime/run-provenance.ts`

- [ ] Write red tests for Flow-A@1 then Flow-B@2 then Case ordering, missing/invalid Flow preflight blocking before BrowserRuntime, Flow failure stopping later Case steps, cancellation, and `RunDetail.provenance.reusableFlows` plus Flow origin on step log.
- [ ] Run focused runner tests; expect Flow refs to be ignored.
- [ ] Resolve all Case Flow refs from the repository snapshot before fixture setup/browser startup. Flatten only in memory; execute Fixtures once around the full sequence; preserve Flow origin in logs. Map preflight failures to Wave 2 `blocked/missingAssetVersion` or `blocked/unsupportedAction` and never fall back to newest. Route Flow-bearing agent Cases through TestRunner rather than direct workflow execution.
- [ ] Re-run tests and commit `feat: execute exact reusable flow versions`.

## Task 4: Add Flow desktop drafting and exact Case bindings

**Files:** create `src/features/flows/ReusableFlowsPage.tsx` and test; modify `src/App.tsx`, `src/features/cases/TestCaseManagementPage.tsx` and tests, `src/i18n/index.ts`

- [ ] Add red UI tests that a saved Flow is read-only, edit/publish preserves v1 and creates v2, invalid drafts cannot publish, and Case binding/reorder/remove stores exact `{ id, version }` references.
- [ ] Run Flow/Case UI tests; expect missing route and controls.
- [ ] Add a `flows` route, latest inventory/version picker, ephemeral Flow draft state, immutable publication, and Case binding controls. Case binding changes must publish a new Case version via `createNextTestCaseVersion`; no Flow edit mutates a Case/Suite.
- [ ] Re-run UI tests and commit `feat: manage exact reusable flow references`.

## Task 5: Compute impact and publish explicit upgrade proposals

**Files:** `shared/studio.ts`, `shared/studio.test.ts`, `src/features/flows/ReusableFlowsPage.tsx` and test, `src/App.tsx`

- [ ] Add red pure tests for sorted direct Case versions, Suite references, Fixture/Baseline context, missing source/target versions, and a selected bulk proposal that creates Case vN+1 without Suite mutation.
- [ ] Run: `pnpm exec node node_modules/vitest/vitest.mjs run shared/studio.test.ts src/features/flows/ReusableFlowsPage.test.tsx`.
- [ ] Implement read-only `analyzeReusableFlowImpact(project, source, target)` and `planReusableFlowCaseUpgrade`. Confirmation must append one next Case version per selected exact Case, replace only the named Flow reference, and produce explicit immutable Suite upgrade proposals rather than modifying existing Suites.
- [ ] Run Wave 4 verification plus `pnpm check` and browser smoke; commit `feat: analyze and propose flow upgrades`.

## Plan Self-Review

- Every Flow/Cases/Suite reference uses exact version pairs; no task has a latest fallback.
- Wave 2 provenance receives Flow versions, while Wave 5 Suite parent/history is not redesigned here.
- Flow upgrades create Case versions and proposals only; existing Suite assets remain immutable.
