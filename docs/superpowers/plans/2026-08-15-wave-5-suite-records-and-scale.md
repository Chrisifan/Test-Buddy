# Wave 5 Suite Records and Controlled Scale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Suite execution a durable parent-run product with truthful exports, then add bounded browser concurrency only after isolation benchmarks pass.

**Architecture:** Build on Wave 2 `SuiteRunRecord`: persisted parent records own resolved provenance, member IDs, timings, terminal summaries, cancellation, and exports. Keep serial execution as the correctness baseline. A BrowserPool leases isolated browser contexts keyed by environment/storage-state/fixture resource constraints; SuiteRunner receives only pool-backed execution after lease isolation tests pass.

**Tech Stack:** TypeScript, Playwright BrowserRuntime, SuiteRunner, ArtifactManifest, Electron IPC/CLI, Vitest, `pnpm`.

---

## File Map

| File | Responsibility |
| --- | --- |
| `shared/studio.ts` / `.test.ts` | Durable `SuiteRunRecord`, child linkage, status counts, and provenance/report contracts. |
| `electron/runtime/run-history.ts` / `.test.ts` | Atomic parent/child record persistence without rewriting frozen provenance. |
| `electron/runtime/suite-runner.ts` / `.test.ts` | Dependency, lock, retry, fail-fast, cancellation, and bounded-concurrency scheduling semantics. |
| `electron/runtime/browser-pool.ts` / `.test.ts` | Isolated worker-context lease lifecycle, compatibility keys, capacity, and cancellation cleanup. |
| `electron/runtime/runtime-bundle.ts`, `browser-runtime.ts` and tests | Pool construction/injection while preserving the independent interactive browser session. |
| `electron/runtime/suite-benchmark.test.ts`, `browser-smoke.test.ts` | Deterministic 10/20/100 acceptance metrics and browser/artifact cleanup assertions. |
| `electron/cli.ts` / `.test.ts` | Complete Suite JSON/JUnit export and status-sensitive exit behavior. |
| `electron/runtime/artifact-manager.ts` / `.test.ts` | Parent-owned export/evidence references and orphan-artifact checks. |
| `src/features/suites/SuiteManagementPage.tsx` / `.test.tsx`, `src/features/runs/RunRecordsPage.tsx` / `.test.tsx` | Parent search/detail, cancellation, capacity feedback, and member navigation. |
| `docs/benchmarks/suite-baseline.md` | Checked-in benchmark environment, metrics, thresholds, and measured results. |

## Task 1: Complete parent Suite record lifecycle and exports

**Files:** `shared/studio.ts`, `electron/runtime/run-history.ts`, `electron/cli.ts`, `electron/runtime/artifact-manager.ts`, `src/features/suites/SuiteManagementPage.tsx`, `src/features/runs/RunRecordsPage.tsx` and tests

- [ ] Add red tests for parent creation, started/finished timestamps, member statuses/reasons/flaky attempts, parent cancellation, JSON output and JUnit parent suite report.
- [ ] Run: `pnpm exec node node_modules/vitest/vitest.mjs run electron/runtime/run-history.test.ts electron/cli.test.ts src/features/suites/SuiteManagementPage.test.tsx src/features/runs/RunRecordsPage.test.tsx`.
- [ ] Make `SuiteRunRecord` the persisted parent source, link every child by ID, include exact Suite/Case/Flow provenance, and export one JSON/JUnit document with explicit status counts. UI must search/open parents without fabricating a Case detail.
- [ ] Re-run tests and commit `feat: persist and export suite parent records`.

## Task 2: Benchmark serial Suite correctness at 10 and 20 Cases

**Files:** create `electron/runtime/suite-benchmark.test.ts`; modify `electron/runtime/browser-smoke.test.ts`, `docs/benchmarks/suite-baseline.md`

- [ ] Create deterministic local fixture Cases with resource locks, fixture cleanup, controlled failure/retry, and cancellation at Case N. Assert 10/20 serial runs have one parent, exact child count, no leaked browser handles, no orphan artifacts, and stable storage growth.
- [ ] Run: `pnpm exec node node_modules/vitest/vitest.mjs run electron/runtime/suite-benchmark.test.ts electron/runtime/browser-smoke.test.ts`.
- [ ] Record wall time, peak active contexts, artifact bytes, and cleanup result in the benchmark markdown; do not loosen concurrency yet.
- [ ] Commit `test: establish serial suite scale baseline`.

## Task 3: Introduce isolated BrowserPool leases

**Files:** create `electron/runtime/browser-pool.ts` and test; modify `electron/runtime/runtime-bundle.ts`, `browser-runtime.ts`, `suite-runner.ts` and tests

- [ ] Write failing tests that two compatible leases use isolated contexts, incompatible storage state/fixture lock lease serializes, release closes context, and cancellation returns every lease exactly once.
- [ ] Run: `pnpm exec node node_modules/vitest/vitest.mjs run electron/runtime/browser-pool.test.ts electron/runtime/suite-runner.test.ts`.
- [ ] Implement `BrowserPool.acquire({ environment, storageStateRef, locks, signal })`, only allowing a configured bounded capacity and using a fresh Playwright context per lease. Preserve BrowserRuntime’s single interactive session; Suite worker contexts cannot update renderer browser-session state.
- [ ] Re-run tests and commit `feat: lease isolated suite browser contexts`.

## Task 4: Enable controlled Suite concurrency and 10/20/100 acceptance

**Files:** `electron/runtime/runtime-bundle.ts`, `suite-runner.ts`, benchmark/smoke tests, `electron/cli.ts`, Suite UI, `docs/benchmarks/suite-baseline.md`

- [ ] Add red tests that `execution.concurrency` is capped by pool capacity, locks/dependencies/fail-fast preserve semantics under parallel scheduling, and Suite cancellation records unstarted members as `cancelled` or `skipped` with reasons.
- [ ] Run focused runner/pool benchmarks.
- [ ] Pass pool executor into `SuiteRunner` only for versioned, isolation-qualified Suite runs. Add 10/20/100 deterministic fixture benchmarks, enforce a fixed timeout/memory/artifact-growth threshold in the test, and leave a failed benchmark as a release blocker rather than auto-retrying.
- [ ] Run full Suite verification, `pnpm check`, and browser smoke; commit `feat: run suites with controlled browser concurrency`.

## Plan Self-Review

- Parent reporting lands before parallelism.
- Browser isolation, locks, cancellation, cleanup, artifact growth, and capacity are verified before 100-case claims.
- Existing interactive BrowserRuntime remains separate from pooled Suite contexts.
