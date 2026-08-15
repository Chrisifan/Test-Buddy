# Wave 7 Acceptance and Release Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the completed regression platform against explicitly classified local, staging, and model targets, publish reproducible acceptance evidence, and prevent release claims that lack the required gate results.

**Architecture:** A small acceptance harness executes immutable suites through the same CLI and desktop-main adapters, retains only frozen provenance and manifest evidence, and writes signed-by-content-hash summaries. The repository-owned local-fixture lane runs in CI. Staging and model lanes are opt-in, environment-protected jobs that receive endpoint/credential references through platform secrets, never through project assets, logs, or generated reports. A pure gate evaluator converts the matrix into pass/fail/no-claim release decisions.

**Tech Stack:** TypeScript, Node.js, GitHub Actions, Playwright, Electron runtime/CLI adapters, ArtifactManifest, Vitest, `pnpm`.

---

## File Map

| File | Responsibility |
| --- | --- |
| `shared/acceptance.ts` / `.test.ts` | Acceptance target/matrix contracts, immutable attempts, stability statistics, and release-gate evaluation. |
| `electron/runtime/acceptance-harness.ts` / `.test.ts` | Main/CLI adapter runner that writes redacted, provenance-pinned acceptance records. |
| `electron/runtime/acceptance-fixtures.ts` / `.test.ts` | Twenty deterministic, test-owned local fixture Cases and environment builder. |
| `scripts/run-acceptance.ts` | CLI entry that selects a declared lane, checks explicit consent/configuration, and emits JSON/JUnit summaries. |
| `scripts/verify-acceptance-report.ts` | Validates report hashes, required attempts, terminal states, and threshold decisions before publishing artifacts. |
| `.github/workflows/verify.yml` | Required local-fixture acceptance gate after ordinary check/smoke coverage. |
| `.github/workflows/acceptance.yml` | Manual, environment-protected staging/model lane with no secret output. |
| `docs/acceptance/matrix.md`, `docs/acceptance/staging-runbook.md`, `docs/acceptance/release-gate.md` | Target ownership, setup, thresholds, and human release decision records. |

## Task 1: Define a reproducible acceptance matrix and gate evaluator

**Files:** Create `shared/acceptance.ts`, `shared/acceptance.test.ts`, `docs/acceptance/matrix.md`, `docs/acceptance/release-gate.md`.

- [ ] **Step 1: Write failing matrix tests.** Cover one local fixture target, one opt-in staging target, and one opt-in model target. Verify 20 desktop/CLI pair records for each required attempt, 10 stability attempts, allowed retry/flaky fields, and distinct outcomes for `passed`, `failed`, `error`, `blocked`, and an absent external lane.

```ts
const decision = evaluateReleaseGate(matrix, attempts);
expect(decision).toMatchObject({ status: 'blocked', reasons: ['modelAcceptanceNotRun'] });
expect(evaluateReleaseGate(matrix, localFixtureAttempts)).toMatchObject({
  status: 'readyForLocalReleaseClaim', passedPairs: 20, stableAttempts: 10,
});
```

- [ ] **Step 2: Run the focused tests and confirm failure.**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run shared/acceptance.test.ts`

Expected: FAIL because acceptance contracts and gate evaluation are absent.

- [ ] **Step 3: Implement precise, redacted records.** Define `AcceptanceTarget` (`localFixture | staging | model`), `AcceptanceMatrix`, `AcceptanceAttempt`, `AcceptancePair`, and `ReleaseGateDecision`. An attempt must include target config fingerprint, exact Suite reference, project revision, child RunProvenance hashes, artifact manifest hashes, terminal summary, retry/flaky summary, and human conclusion field; it must not include URLs with credentials, secret references, raw model prompts, storage state, or artifact paths. Require 20 exact desktop/CLI pairs and 10 stable repetitions for a completed lane. A required lane not explicitly run is `notRun`, never `passed` or `failed`.

- [ ] **Step 4: Document target ownership and thresholds.** In `matrix.md`, name the local fixture as CI-required; staging/model as environment-controlled release-claim gates; document that a local-green build cannot claim staging/model acceptance. In `release-gate.md`, define zero `failed`/`error`, zero unclassified terminal records, a stable 10-run result, exact pair equality, evidence availability, and a signed human conclusion as the release threshold.

- [ ] **Step 5: Run tests and commit the contract/documentation.**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run shared/acceptance.test.ts`

Expected: PASS; gate decisions are deterministic and external work stays explicitly unverified when absent.

```bash
git commit --only shared/acceptance.ts shared/acceptance.test.ts docs/acceptance/matrix.md docs/acceptance/release-gate.md -m "feat: define acceptance matrix and release gates"
```

## Task 2: Build a shared desktop/CLI acceptance harness

**Files:** Create `electron/runtime/acceptance-harness.ts`, `electron/runtime/acceptance-harness.test.ts`, `electron/runtime/acceptance-fixtures.ts`, `electron/runtime/acceptance-fixtures.test.ts`; modify `electron/cli.ts`, `electron/cli.test.ts`, `electron/ipc/runtime-ipc-handlers.ts`, `electron/ipc/runtime-ipc-handlers.test.ts`.

- [ ] **Step 1: Write failing harness tests.** Prove a local twenty-Case Suite runs through the CLI and desktop-main intent path using the same pinned project revision and produces matching terminal summaries/provenance hashes. Add cases for cancelled, blocked, and failed members, and ensure a harness run refuses a legacy/non-reproducible project.

```ts
const pair = await harness.runPair({ target: localTarget, suite: suiteV1, repetitions: 10 });
expect(pair.desktop.provenanceHashes).toEqual(pair.cli.provenanceHashes);
expect(pair.desktop.memberStatuses).toEqual(pair.cli.memberStatuses);
expect(JSON.stringify(pair)).not.toContain('sk-live');
```

- [ ] **Step 2: Run focused tests and confirm failure.**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run electron/runtime/acceptance-harness.test.ts electron/runtime/acceptance-fixtures.test.ts electron/cli.test.ts electron/ipc/runtime-ipc-handlers.test.ts`

Expected: FAIL because no accepted-run harness or 20-Case fixture suite exists.

- [ ] **Step 3: Implement test-owned fixture assets and adapter parity.** Build the local fixture page/fixtures with exactly 20 immutable Case@1 assets exercising success, controlled assertion failure, blocked preflight, Suite cancellation, screenshot evidence, a fixture lifecycle, and the interactions enabled in Wave 6. Create one immutable Suite@1 with serial semantics first. `AcceptanceHarness.runPair` must invoke the public CLI command and registered runtime IPC handler against isolated temporary data roots, compare only canonical/redacted records, and retain each actual RunDetail/SuiteRunRecord/manifest entry for auditing.

- [ ] **Step 4: Run focused tests and commit the harness.**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run electron/runtime/acceptance-harness.test.ts electron/runtime/acceptance-fixtures.test.ts electron/cli.test.ts electron/ipc/runtime-ipc-handlers.test.ts`

Expected: PASS; the parity result is derived from real adapter boundaries rather than a shared mock.

```bash
git commit --only electron/runtime/acceptance-harness.ts electron/runtime/acceptance-harness.test.ts electron/runtime/acceptance-fixtures.ts electron/runtime/acceptance-fixtures.test.ts electron/cli.ts electron/cli.test.ts electron/ipc/runtime-ipc-handlers.ts electron/ipc/runtime-ipc-handlers.test.ts -m "test: add provenance pinned acceptance harness"
```

## Task 3: Add opt-in staging and model lanes without secret leakage

**Files:** Create `scripts/run-acceptance.ts`, `scripts/verify-acceptance-report.ts`, `docs/acceptance/staging-runbook.md`; modify `package.json`, `electron/runtime/acceptance-harness.ts` and tests.

- [ ] **Step 1: Write failing command tests.** Assert `pnpm acceptance --lane localFixture` needs no network or secret; staging/model reject missing `TESTBUDDY_ACCEPTANCE_CONSENT=1`, missing target allowlist, or unavailable main-owned secret reference; assert JSON/JUnit output has fingerprinted target metadata but no target secret, raw endpoint query, storage state, or model key.

```ts
await expect(runAcceptance(['--lane', 'model'], {})).rejects.toThrow(/explicit consent/i);
expect(await runAcceptance(['--lane', 'localFixture'], {})).toMatchObject({ lane: 'localFixture', attempts: 10 });
expect(JSON.stringify(await runAcceptance(['--lane', 'staging'], stagedEnvironment))).not.toContain(stagedEnvironment.apiKey);
```

- [ ] **Step 2: Run focused command tests and confirm failure.**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run electron/runtime/acceptance-harness.test.ts scripts/run-acceptance.test.ts scripts/verify-acceptance-report.test.ts`

Expected: FAIL because the command and report verifier do not exist.

- [ ] **Step 3: Implement explicit external acceptance safeguards.** The script accepts only `localFixture`, `staging`, or `model`; staging/model require consent plus an exact origin allowlist from CI environment configuration. Resolve credentials/model keys through Wave 3 main-owned secret stores at execution time and pass them only into memory. Write JSON/JUnit plus a canonical report hash under a caller-selected artifact directory; `verify-acceptance-report` recomputes hashes, rejects secrets/absolute paths/legacy provenance, and evaluates thresholds. Register `acceptance:local` and `acceptance` pnpm scripts that invoke these files with package-local Node.

- [ ] **Step 4: Write the controlled staging/model runbook.** Document configuration only by secret variable names, environment protection/approval, target ownership, test data reset, browser/model version pinning, manual conclusion capture, retention review, and incident handling. State that failed acceptance repairs create Maintenance drafts, never direct asset writes.

- [ ] **Step 5: Run focused tests and commit commands/runbook.**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run electron/runtime/acceptance-harness.test.ts scripts/run-acceptance.test.ts scripts/verify-acceptance-report.test.ts`

Expected: PASS; missing authority is a blocked acceptance run, not a silent local fallback.

```bash
git commit --only scripts/run-acceptance.ts scripts/run-acceptance.test.ts scripts/verify-acceptance-report.ts scripts/verify-acceptance-report.test.ts package.json electron/runtime/acceptance-harness.ts electron/runtime/acceptance-harness.test.ts docs/acceptance/staging-runbook.md -m "feat: add consented acceptance lanes"
```

## Task 4: Enforce CI and release publication gates

**Files:** Modify `.github/workflows/verify.yml`; create `.github/workflows/acceptance.yml`; modify `docs/acceptance/release-gate.md`, `electron/runtime/browser-smoke.test.ts`.

- [ ] **Step 1: Write a failing local acceptance smoke assertion.** Add a browser-smoke test that loads the 20-Case fixture suite, asserts all expected terminal states and manifest evidence, validates exact desktop/CLI record parity, and runs ten repetitions with no undisclosed flake.

```ts
expect(report.decision).toMatchObject({ status: 'readyForLocalReleaseClaim', passedPairs: 20, stableAttempts: 10 });
expect(report.artifacts.every((artifact) => /^[a-f0-9]{64}$/.test(artifact.contentHash))).toBe(true);
```

- [ ] **Step 2: Run local acceptance verification and confirm failure.**

Run: `pnpm acceptance:local`

Expected: FAIL until the fixture acceptance harness and threshold evaluator are integrated.

- [ ] **Step 3: Update CI configuration.** Keep `verify.yml` as the required deterministic job: frozen `pnpm` install, `pnpm check`, browser installation, browser smoke, `pnpm acceptance:local`, and report verification. Create manually dispatched `acceptance.yml` with `lane` input restricted to `staging`/`model`, a protected GitHub Environment matching the lane, no `pull_request` trigger, minimum token permissions, masked secret references, retention-limited report artifacts, and an explicit failing gate when a lane is incomplete or below threshold. Do not echo environment values or upload application artifacts by default.

- [ ] **Step 4: Record a release decision template.** Amend `release-gate.md` with a table that requires the commit SHA, matrix hash, project revision, browser/runtime/model fingerprints, 20-pair and 10-run results, evidence retention status, known flaky count, owner conclusion, and a `not claimed` state for unrun external lanes.

- [ ] **Step 5: Run final Wave 7 verification and commit.**

Run:

```bash
pnpm exec node node_modules/vitest/vitest.mjs run shared/acceptance.test.ts electron/runtime/acceptance-harness.test.ts electron/runtime/acceptance-fixtures.test.ts scripts/run-acceptance.test.ts scripts/verify-acceptance-report.test.ts electron/runtime/browser-smoke.test.ts
pnpm check
pnpm test:browser-smoke
pnpm acceptance:local
```

Expected: all commands exit 0; local acceptance is evidenced, while staging/model remain explicitly `notRun` unless an authorized job supplies their environment.

```bash
git commit --only .github/workflows/verify.yml .github/workflows/acceptance.yml docs/acceptance/release-gate.md electron/runtime/browser-smoke.test.ts -m "ci: gate releases on classified acceptance evidence"
```

## Plan Self-Review

- Local fixture verification is required and offline; staging/model execution requires a separate, protected, explicit authority boundary.
- Every acceptance claim is tied to exact Suite/Case references, frozen provenance, report/manifest hashes, terminal reasons, retries/flakiness, and a human conclusion.
- Desktop/CLI parity uses distinct public adapter boundaries and compares canonical records, not test doubles.
- No external endpoint, key, credential value, raw prompt, storage state, absolute artifact path, or temporary repair is persisted in reports or project assets.
