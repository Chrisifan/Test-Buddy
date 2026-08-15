# Wave 6 Maintenance Safety and Interaction Breadth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn run evidence into reviewable, auditable maintenance drafts and add deterministic browser interactions without allowing either path to bypass exact asset, secret, evidence, terminal-status, or retention contracts.

**Architecture:** A main-owned maintenance service turns frozen RunProvenance plus manifest-backed evidence into immutable `MaintenanceDraft` records; it never edits a project during analysis. Approval checks the original project revision and asset reference, creates the next immutable Case version through the repository publication boundary, then records an audit entry. New browser effects are represented as explicit deterministic step payloads, validated before BrowserRuntime, executed only in the main process, and annotated with redacted evidence metadata.

**Tech Stack:** TypeScript, Electron IPC/preload, ProjectRepository/ProjectAssetStore, SecretStore, ArtifactManifest, Playwright BrowserRuntime, React, Vitest, `pnpm`.

---

## File Map

| File | Responsibility |
| --- | --- |
| `shared/maintenance.ts` / `.test.ts` | Pure maintenance contracts, immutable proposal diffs, impact references, and draft transition validation. |
| `electron/runtime/maintenance-service.ts` / `.test.ts` | Main-only draft creation, review, exact-revision approval/rejection, audit persistence. |
| `electron/runtime/deterministic-step-contract.ts` / `.test.ts` | Structured interaction payloads, allowlists, redaction, and preflight validation. |
| `shared/studio.ts` / `.test.ts` | Exact Case-version helpers and StudioState-compatible maintenance record hydration. |
| `electron/runtime/browser-runtime.ts` / `.test.ts` | Main-process execution for iframe/tab/upload/download/hover/drag/clipboard/network/mock and registered evidence. |
| `electron/runtime/test-runner.ts` / `.test.ts` | Preflight and terminal reasons for every new deterministic effect. |
| `electron/ipc/runtime-ipc-channels.cts`, `electron/ipc/runtime-ipc-handlers.ts` / tests, `electron/preload.cts`, `src/lib/runtime.ts` / tests | Narrow typed maintenance and interaction IPC boundaries. |
| `src/features/maintenance/MaintenanceQueuePage.tsx` / `.test.tsx`, `src/App.tsx`, `src/i18n/index.ts` | Review-only maintenance queue and explicit approve/reject controls. |
| `electron/runtime/browser-smoke.test.ts` | Local fixture proof that each supported effect respects evidence and cancellation boundaries. |

## Task 1: Define maintenance drafts as immutable, evidence-backed records

**Files:** Create `shared/maintenance.ts`, `shared/maintenance.test.ts`; modify `shared/studio.ts`, `shared/studio.test.ts`.

- [ ] **Step 1: Write failing contract tests.** Cover a Case proposal that is pinned to `case-login@1`, carries an ordered evidence list and impact references, rejects an empty candidate diff, and cannot transition from `accepted` back to `draft`.

```ts
const draft = createMaintenanceDraft({
  projectId: 'project-1', projectRevision: revision, target: { kind: 'case', id: 'case-login', version: 1 },
  proposedCase: { ...caseV1, steps: [{ ...caseV1.steps[0], body: 'click #sign-in' }] },
  evidence: [{ runId: 'run-1', artifactId: 'artifact-1', contentHash: 'a'.repeat(64) }],
  impact: [{ kind: 'suite', id: 'suite-smoke', version: 1 }],
});
expect(validateMaintenanceDraft(draft)).toEqual([]);
expect(() => transitionMaintenanceDraft({ ...draft, status: 'accepted' }, 'draft')).toThrow(/terminal/i);
```

- [ ] **Step 2: Run the focused tests and confirm the contract does not exist.**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run shared/maintenance.test.ts shared/studio.test.ts`

Expected: FAIL because maintenance types and transitions are absent.

- [ ] **Step 3: Implement the minimal public contract.** Define `MaintenanceDraft` with `id`, `projectId`, `projectRevision`, exact Case target, `baseAssetHash`, `candidate`, `diff`, evidence `{ runId, artifactId, contentHash }[]`, impact `{ kind, id, version }[]`, status `draft | accepted | rejected | stale`, authorless timestamps, and an append-only audit list. Restrict v1 candidates to a complete replacement `TestCaseDraft`; require the same ID, source version, valid deterministic steps, and a material canonical JSON diff. Expose pure `createMaintenanceDraft`, `validateMaintenanceDraft`, `transitionMaintenanceDraft`, and `analyzeMaintenanceImpact` helpers. Hydrate malformed or legacy queue entries by omitting them rather than treating them as approved work.

- [ ] **Step 4: Run focused tests and commit the contracts.**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run shared/maintenance.test.ts shared/studio.test.ts`

Expected: PASS; exact source, evidence, impact, and terminal transition checks are covered.

```bash
git commit --only shared/maintenance.ts shared/maintenance.test.ts shared/studio.ts shared/studio.test.ts -m "feat: define evidence backed maintenance drafts"
```

## Task 2: Create, review, and audit drafts in the main process

**Files:** Create `electron/runtime/maintenance-service.ts`, `electron/runtime/maintenance-service.test.ts`; modify `electron/projectRepository.ts`, `electron/projectAssetStore.ts`, `electron/studioStore.ts` and corresponding tests.

- [ ] **Step 1: Write failing service tests.** Prove creation reads a `RunDetail` only after its provenance, artifact manifest hashes, and exact Case source resolve; prove accepting a draft writes `case-login@2`, retains `@1`, and records the accepted audit; prove revision drift or a changed base hash returns `stale` without writing assets.

```ts
await expect(service.accept({ draftId: draft.id, expectedRevision: revision })).resolves.toMatchObject({
  status: 'accepted', published: { id: 'case-login', version: 2 },
});
expect(await assets.readCase({ id: 'case-login', version: 1 })).toEqual(caseV1);
expect(await assets.readCase({ id: 'case-login', version: 2 })).toMatchObject({ version: 2 });
```

- [ ] **Step 2: Run the focused tests and confirm they fail.**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run electron/runtime/maintenance-service.test.ts electron/projectRepository.test.ts electron/projectAssetStore.test.ts electron/studioStore.test.ts`

Expected: FAIL because no main-owned draft service exists.

- [ ] **Step 3: Implement review-first lifecycle.** `createFromRun` must use `ProjectRepository.loadBound(projectId, provenance.projectRevision)`, exact-resolve the Case, and require every cited artifact to be a retained ArtifactManifest entry with matching hash. Persist only the draft/audit records in StudioStore. `accept` must reload the bound project at the draft revision, recompute the base asset hash and impact, then publish exactly one `createNextTestCaseVersion` through ProjectAssetStore's CAS update path; an obsolete draft becomes `stale` with an audit event. `reject` only changes the record and audit. Neither method may call an AI planner, mutate an existing asset, or update a Suite reference.

- [ ] **Step 4: Run focused tests and commit the service.**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run electron/runtime/maintenance-service.test.ts electron/projectRepository.test.ts electron/projectAssetStore.test.ts electron/studioStore.test.ts`

Expected: PASS; acceptance is exact, single-publication, revision-checked, and auditable.

```bash
git commit --only electron/runtime/maintenance-service.ts electron/runtime/maintenance-service.test.ts electron/projectRepository.ts electron/projectRepository.test.ts electron/projectAssetStore.ts electron/projectAssetStore.test.ts electron/studioStore.ts electron/studioStore.test.ts -m "feat: review and publish maintenance drafts safely"
```

## Task 3: Expose a narrow maintenance review boundary and queue

**Files:** Modify `electron/ipc/runtime-ipc-channels.cts`, `electron/ipc/runtime-ipc-handlers.ts`, `electron/ipc/runtime-ipc-handlers.test.ts`, `electron/preload.cts`, `electron/preload-contract.test.ts`, `src/lib/runtime.ts`, `src/lib/runtime.test.ts`; create `src/features/maintenance/MaintenanceQueuePage.tsx`, `src/features/maintenance/MaintenanceQueuePage.test.tsx`; modify `src/App.tsx`, `src/App.test.tsx`, `src/i18n/index.ts`.

- [ ] **Step 1: Write failing IPC and UI tests.** Assert renderer requests include only `runId`, an exact target reference, candidate Case content, and citations; reject raw paths, artifact contents, project snapshots, and model configuration. Assert the queue displays source/version, unified diff, impact/evidence, and that an approve action requiring stale revalidation cannot claim success on a stale result.

```ts
expect(window.desktopApi.createMaintenanceDraft).toHaveBeenCalledWith(expect.objectContaining({
  runId: 'run-1', target: { kind: 'case', id: 'case-login', version: 1 },
}));
expect(JSON.stringify(window.desktopApi.createMaintenanceDraft.mock.calls)).not.toContain('/private/');
expect(screen.getByText('case-login@1')).toBeInTheDocument();
expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled();
```

- [ ] **Step 2: Run focused IPC/UI tests and confirm failure.**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run electron/ipc/runtime-ipc-handlers.test.ts electron/preload-contract.test.ts src/lib/runtime.test.ts src/features/maintenance/MaintenanceQueuePage.test.tsx src/App.test.tsx`

Expected: FAIL because the channels and queue page are absent.

- [ ] **Step 3: Implement the review experience.** Add `list`, `create`, `accept`, and `reject` IPC handlers backed solely by `MaintenanceService`; serialize only typed stale/missing-version errors. Add the queue route with fixed draft rows, evidence links opened through the managed artifact path, source/candidate diff, impact list, audit timeline, explicit reject rationale, and an approve confirmation that passes the visible expected revision. App state refreshes from the main result; it never applies the candidate locally.

- [ ] **Step 4: Run focused tests and commit the queue.**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run electron/ipc/runtime-ipc-handlers.test.ts electron/preload-contract.test.ts src/lib/runtime.test.ts src/features/maintenance/MaintenanceQueuePage.test.tsx src/App.test.tsx`

Expected: PASS; queue operations cannot mutate a project from renderer memory.

```bash
git commit --only electron/ipc/runtime-ipc-channels.cts electron/ipc/runtime-ipc-handlers.ts electron/ipc/runtime-ipc-handlers.test.ts electron/preload.cts electron/preload-contract.test.ts src/lib/runtime.ts src/lib/runtime.test.ts src/features/maintenance/MaintenanceQueuePage.tsx src/features/maintenance/MaintenanceQueuePage.test.tsx src/App.tsx src/App.test.tsx src/i18n/index.ts -m "feat: add reviewed maintenance queue"
```

## Task 4: Add structured, safe deterministic interaction contracts

**Files:** Create `electron/runtime/deterministic-step-contract.ts`, `electron/runtime/deterministic-step-contract.test.ts`; modify `shared/studio.ts`, `shared/studio.test.ts`, `electron/runtime/test-runner.ts`, `electron/runtime/test-runner.test.ts`.

- [ ] **Step 1: Write failing contract and preflight tests.** Cover a same-origin iframe selector, a new-tab URL allowlist, upload through a selected main-owned path, a managed download artifact, hover/drag coordinates, clipboard writes with a secret sentinel, response observation, and a network mock. Also prove cross-origin frames, arbitrary local file paths, untrusted downloads, values containing a resolved secret, and mocks outside the exact host are blocked before BrowserRuntime.

```ts
expect(validateDeterministicStep({ type: 'ai', deterministic: { kind: 'upload', selector: '#avatar', fileRef: 'attachment-1' } }, context)).toEqual([]);
expect(validateDeterministicStep({ type: 'ai', deterministic: { kind: 'networkMock', url: 'https://other.example/api' } }, context))
  .toContainEqual(expect.objectContaining({ code: 'unsupportedAction' }));
```

- [ ] **Step 2: Run focused tests and confirm they fail.**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run electron/runtime/deterministic-step-contract.test.ts shared/studio.test.ts electron/runtime/test-runner.test.ts`

Expected: FAIL because these structured effects are unsupported.

- [ ] **Step 3: Implement allowlisted payloads and blockers.** Add discriminated `DeterministicStepInstruction` values for `iframe`, `tab`, `upload`, `download`, `hover`, `drag`, `clipboard`, `networkObserve`, and `networkMock`. Keep selectors, URLs, mock bodies, file references, and clipboard values separate from prose. Validate scheme, same-origin/frame policy, endpoint host/method, byte limits, and scoped fixture/attachment IDs. Resolve credential or secret values only in main memory and reject any value equal to a known secret before it can enter a step log, artifact label, maintenance draft, or report. Map all validation failures to `blocked/unsupportedAction` with a stable reason.

- [ ] **Step 4: Run focused tests and commit the contracts.**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run electron/runtime/deterministic-step-contract.test.ts shared/studio.test.ts electron/runtime/test-runner.test.ts`

Expected: PASS; blocked effects never start BrowserRuntime.

```bash
git commit --only electron/runtime/deterministic-step-contract.ts electron/runtime/deterministic-step-contract.test.ts shared/studio.ts shared/studio.test.ts electron/runtime/test-runner.ts electron/runtime/test-runner.test.ts -m "feat: validate controlled deterministic interactions"
```

## Task 5: Execute supported effects with manifest-backed evidence

**Files:** Modify `electron/runtime/browser-runtime.ts`, `electron/runtime/browser-runtime.test.ts`, `electron/runtime/artifact-manager.ts`, `electron/runtime/artifact-manager.test.ts`, `electron/runtime/test-runner.ts`, `electron/runtime/test-runner.test.ts`, `electron/runtime/browser-smoke.test.ts`.

- [ ] **Step 1: Write failing runtime tests.** Use a test-owned local page to assert iframe click, new tab, hover, drag, upload, download, clipboard, response observation, and route mock execution. Assert every output file enters ArtifactManifest with owner run, content hash, supported evidence kind, and retention protections; cancellation during drag/download leaves no unowned file.

```ts
expect(await runtime.executeDeterministicStep({ kind: 'download', selector: '#download' })).toMatchObject({
  artifacts: [expect.objectContaining({ evidenceKind: 'attachment', contentHash: expect.any(String) })],
});
expect(await manifest.byOwner('run-1')).toHaveLength(1);
```

- [ ] **Step 2: Run runtime and smoke tests and confirm failure.**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run electron/runtime/browser-runtime.test.ts electron/runtime/artifact-manager.test.ts electron/runtime/test-runner.test.ts electron/runtime/browser-smoke.test.ts`

Expected: FAIL because the new effects and registered artifacts are absent.

- [ ] **Step 3: Implement main-only effect execution.** Extend the typed Playwright seam only for the needed methods (`frameLocator`, `waitForEvent`, `hover`, `dragTo`, `setInputFiles`, `route`, and clipboard evaluation). Download to an ArtifactManager-owned temporary path, hash/register it before exposing metadata, and delete it on cancelled/failed registration. Register response observations and mocks as redacted diagnostic evidence, never as an opaque network dump. Capture real pre/failure/post PNG evidence according to Wave 3; use `cancelled/userCancelled`, `blocked/unsupportedAction`, `failed/actionFailed`, and `error/executorError` consistently.

- [ ] **Step 4: Run Wave 6 verification and commit.**

Run:

```bash
pnpm exec node node_modules/vitest/vitest.mjs run shared/maintenance.test.ts electron/runtime/maintenance-service.test.ts electron/runtime/deterministic-step-contract.test.ts electron/runtime/browser-runtime.test.ts electron/runtime/artifact-manager.test.ts electron/runtime/test-runner.test.ts electron/ipc/runtime-ipc-handlers.test.ts electron/preload-contract.test.ts src/features/maintenance/MaintenanceQueuePage.test.tsx
pnpm check
pnpm test:browser-smoke
```

Expected: all commands exit 0; no effect writes unregistered files or bypasses a terminal reason.

```bash
git commit --only electron/runtime/browser-runtime.ts electron/runtime/browser-runtime.test.ts electron/runtime/artifact-manager.ts electron/runtime/artifact-manager.test.ts electron/runtime/test-runner.ts electron/runtime/test-runner.test.ts electron/runtime/browser-smoke.test.ts -m "feat: execute audited deterministic interactions"
```

## Plan Self-Review

- Maintenance analysis and approval are separate; only explicit approval can publish a new immutable Case version.
- Every candidate carries exact source/version, project revision, hash-verified evidence, impact, and append-only acceptance/rejection audit.
- Every added interaction has a typed preflight, main-owned secret/file resolution, manifest-backed evidence, cancellation cleanup, and explicit terminal reason.
- This plan does not add automatic asset repair, automatic Suite upgrades, arbitrary script execution, raw network capture, or a renderer-side filesystem/clipboard escape.
