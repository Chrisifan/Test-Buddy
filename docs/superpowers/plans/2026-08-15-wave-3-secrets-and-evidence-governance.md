# Wave 3 Secrets and Evidence Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove model keys from persisted/renderer state and make evidence manifest-backed, truthful, and retention-safe.

**Architecture:** Add a main-only `ModelSecretStore` beside `CredentialStore`; renderer config stores only stable secret references and `hasKey`. Every artifact is registered in an `ArtifactManifest` with hash, owner, classification, and protection reasons. TestRunner captures real browser PNGs when a page exists and records synthetic diagnostics distinctly; retention plans only delete unprotected manifest entries after review.

**Tech Stack:** Electron `safeStorage`, Node `crypto`/`fs/promises`, Playwright BrowserRuntime, TypeScript, Vitest, React, `pnpm`.

---

## File Map

| File | Responsibility |
| --- | --- |
| `shared/studio.ts` | Public key-free model config, artifact metadata, retention plan types. |
| `electron/runtime/model-secret-store.ts` / `.test.ts` | Encrypted model-key storage, migration, resolve-by-reference. |
| `electron/studioStore.ts` / `.test.ts` | Read-compatible import of legacy keys, atomic key stripping only after secret save. |
| `electron/main.ts`, `electron/ipc/*`, `electron/preload.cts`, `src/lib/runtime.ts` | Key-free IPC and explicit main-owned secret configuration calls. |
| `electron/runtime/artifact-manager.ts` / `.test.ts` | Manifest, hashes, protected-reference analysis, preview/execute retention. |
| `electron/runtime/browser-runtime.ts`, `test-runner.ts` and tests | Real PNG evidence or explicit synthetic diagnostic metadata. |
| `src/features/settings/SettingsModal.tsx`, `RunRecordsPage.tsx`, `src/i18n/index.ts` | Secret-entry UX without readback and evidence/retention review surfaces. |

## Task 1: Replace model key fields with main-only secret references

**Files:** `shared/studio.ts`, `electron/runtime/model-secret-store.ts`, `electron/runtime/model-secret-store.test.ts`, `electron/studioStore.ts`, `electron/studioStore.test.ts`

- [ ] Write failing tests that save a provider/role key, assert `safe:` ciphertext is the only disk representation, and assert `JSON.stringify(StudioState)` has no submitted key.

```ts
expect(await store.save({ scope: 'midscene', value: 'sk-live' })).toMatchObject({ hasKey: true });
expect(JSON.stringify(await studioStore.load())).not.toContain('sk-live');
expect(await secrets.resolve({ scope: 'midscene' })).toBe('sk-live');
```

- [ ] Run: `pnpm exec node node_modules/vitest/vitest.mjs run electron/runtime/model-secret-store.test.ts electron/studioStore.test.ts`.
Expected: FAIL because `MidsceneConfig.modelApiKey` and each `AgentRoleModelConfig.modelApiKey` are persisted.

- [ ] Introduce `ModelSecretRef { id; hasKey; updatedAt }`; replace public config key fields with that reference. Implement `ModelSecretStore` using `safeStorage` and scoped IDs (`midscene`, `agent:<role>`). On StudioState load, detect a legacy nonempty key, save it first, replace the state field with a ref only after successful encryption, and leave state untouched on save failure.

- [ ] Run the focused tests; commit:

```bash
git commit --only shared/studio.ts electron/runtime/model-secret-store.ts electron/runtime/model-secret-store.test.ts electron/studioStore.ts electron/studioStore.test.ts -m "feat: isolate model keys in encrypted secret store"
```

## Task 2: Keep all renderer and runtime requests key-free

**Files:** `electron/main.ts`, `electron/preload.cts`, `electron/preload-contract.test.ts`, `electron/ipc/runtime-ipc-handlers.ts`, `src/lib/runtime.ts`, `src/lib/runtime.test.ts`, `src/App.tsx`, `src/features/settings/SettingsModal.tsx` and tests

- [ ] Add red tests proving Settings submits a write-only key, state returned to App has `hasKey` but no value, and `runTestCase`/`runSuite` renderer intents do not stringify a key.
- [ ] Run: `pnpm exec node node_modules/vitest/vitest.mjs run electron/preload-contract.test.ts src/lib/runtime.test.ts src/features/settings/SettingsModal.test.tsx src/App.test.tsx`.
- [ ] Add `runtime:save-model-secret` and `runtime:clear-model-secret` handlers; only main resolves secrets immediately before model execution. Change Settings inputs to uncontrolled write-only inputs (blank after save), and gate model readiness on `hasKey`. Strip model secret refs/values from events, RunDetail, ProjectReport and errors.
- [ ] Re-run focused tests; commit only scoped IPC/runtime/UI files with message `feat: keep model secrets out of renderer state`.

## Task 3: Add manifest-backed, honest artifacts

**Files:** `shared/studio.ts`, `electron/runtime/artifact-manager.ts`, `electron/runtime/artifact-manager.test.ts`, `electron/runtime/browser-runtime.ts`, `electron/runtime/test-runner.ts` and tests

- [ ] Add failing tests for a real PNG manifest entry and a synthetic entry:

```ts
expect(await artifacts.registerExisting(png, { ownerRunId: 'run-1', kind: 'pageScreenshot' })).toMatchObject({ contentHash: expect.any(String), synthetic: false });
expect(detail.artifacts[0]).toMatchObject({ type: 'snapshot', evidenceKind: 'syntheticDiagnostic' });
```

- [ ] Run: `pnpm exec node node_modules/vitest/vitest.mjs run electron/runtime/artifact-manager.test.ts electron/runtime/browser-runtime.test.ts electron/runtime/test-runner.test.ts`.
- [ ] Define `ArtifactManifestEntry` with ID, path, content hash, byte count, timestamp, owner run/suite IDs, `pageScreenshot | trace | report | attachment | syntheticDiagnostic`, retention class, and `protectedBy`. Write manifests atomically beneath `studio-data/artifacts/manifest.json`. Have BrowserRuntime screenshot capture register real PNGs at pre-step, post-step, and failure checkpoints; preserve the SVG generator only as `syntheticDiagnostic`, never `screenshot`.
- [ ] Run tests and commit `feat: track verifiable run artifacts`.

## Task 4: Plan and review protected retention

**Files:** `electron/runtime/artifact-manager.ts`, `electron/runtime/artifact-manager.test.ts`, `electron/main.ts`, `electron/preload.cts`, `src/lib/runtime.ts`, `src/features/runs/RunRecordsPage.tsx` and tests, `src/i18n/index.ts`

- [ ] Write failing tests for a retention preview that excludes RunDetail, baseline, pending-maintenance, and export-locked paths; confirmation must delete only previewed hashes and return an audit list.
- [ ] Run: `pnpm exec node node_modules/vitest/vitest.mjs run electron/runtime/artifact-manager.test.ts src/features/runs/RunRecordsPage.test.tsx`.
- [ ] Implement `planArtifactRetention({ now, maxBytes, keepDays })` and `confirmArtifactRetention(planId)`. Recompute hash/path/protection at confirmation and fail if the plan no longer matches. Add a review-only UI list with classification, size, protected reason, and deletion count; no automatic delete scheduler.
- [ ] Run Wave 3 verification:

```bash
pnpm exec node node_modules/vitest/vitest.mjs run electron/runtime/model-secret-store.test.ts electron/studioStore.test.ts electron/preload-contract.test.ts electron/runtime/artifact-manager.test.ts electron/runtime/browser-runtime.test.ts electron/runtime/test-runner.test.ts src/features/settings/SettingsModal.test.tsx src/features/runs/RunRecordsPage.test.tsx
pnpm check
pnpm test:browser-smoke
```

- [ ] Commit scoped files with `feat: govern secret-free evidence retention`.

## Plan Self-Review

- Key migration is failure-safe, main-only, and tested against State/IPC/report leakage.
- Screenshot labels distinguish real PNG evidence from synthetic diagnostics.
- Retention is a reviewed, recomputed operation and cannot remove protected references.
