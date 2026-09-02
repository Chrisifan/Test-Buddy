# Serial Suite Baseline

This is the correctness baseline for Suite execution before BrowserPool leases
or controlled concurrency. It makes no throughput, isolation, or concurrency
claim beyond the current serial runtime cap of one active browser context.

## Fixture Setup

`electron/runtime/suite-benchmark.test.ts` creates its own loopback HTTP
fixture and temporary runtime directory. Each Case uses an executable HTTP
Fixture with an exclusive shared resource lock and matching setup/cleanup
endpoints. The Suite asks for more concurrency than one, while
`RuntimeBundle` deliberately caps it at one.

The 10- and 20-Case completed runs each include one controlled assertion
failure that succeeds on retry. The cancellation run aborts after browser
startup for Case 8 of a 20-Case Suite. It verifies the started Case is
cancelled and every later member is durably recorded as cancelled with zero
attempts. The test asserts all 20 ordered Case IDs, exact versions, terminal
result fields, and the persisted parent summary (`7 passed`, `13 cancelled`).

The benchmark invokes the registered runtime IPC Suite handler and persists
each parent/child progression through `StudioStateUpdateQueue` and
`StudioStore`; fresh store instances reload each captured progression point.
It checks:

- exactly one durable parent, exact member results, child IDs, retry metadata,
  and parent status counts;
- a serial effective concurrency plus an instrumented `BrowserRuntime`
  context lifecycle (created, closed, live, and peak) with no overlapping
  live contexts;
- fixture resources return to zero, `BrowserRuntime.close()` clears its
  browser/context/page handles, and no manifest-indexed artifact is orphaned;
- artifact storage remains below the fixed per-Case limit.

## Release Gates

The benchmark cases are release blockers. They use the following fixed,
hardware-tolerant limits:

| Metric | 10 complete | 20 complete/cancelled | Gate |
| --- | ---: | ---: | --- |
| Wall time | measured | measured | less than 60,000 ms safety timeout |
| Peak live contexts | 1 | 1 | exactly 1, measured from actual context create/close lifecycle |
| Artifact bytes | measured | measured | at most 2 MiB per declared Case |
| Cleanup | true | true | all fixture resources released; browser handles cleared; manifest has no orphaned files |

Run locally with the installed Playwright Chromium:

```sh
TEST_BUDDY_BENCHMARK_REPORT=1 pnpm exec node node_modules/vitest/vitest.mjs run electron/runtime/suite-benchmark.test.ts electron/runtime/browser-smoke.test.ts
```

`TEST_BUDDY_BENCHMARK_REPORT=1` only emits benchmark metric JSON; the normal
test command remains quiet.

## Measured Local Run

Measured on 2026-08-24 with the deterministic loopback fixture and the
headless Playwright Chromium installed for this workspace.

| Run | Wall time | Context lifecycle (created/closed/live/peak) | Artifact bytes | Fixture cleanup |
| --- | ---: | ---: | ---: | --- |
| 10 Cases, complete with one retry | 4,921 ms | 11 / 10 / 1 / 1 | 1,721,247 B | true |
| 20 Cases, complete with one retry | 7,968 ms | 21 / 20 / 1 / 1 | 3,284,618 B | true |
| 20 Cases, cancelled at Case 8 | 2,865 ms | 8 / 7 / 1 / 1 | 1,105,533 B | true |

Lifecycle counts are sampled immediately before harness disposal; disposal then
closes the one remaining live context and asserts no browser/context/page
handle remains.

The focused serial benchmark and browser smoke run passed 7/7 tests.

## Controlled Pool Acceptance

The same local fixture now also covers versioned, headless Chromium Suites
through an isolated `BrowserPool` with a fixed capacity of two. Each member
receives a fresh context; resource locks, storage-state compatibility, and
headed or non-Chromium execution remain outside this pooled lane. The harness
persists the parent running and terminal boundaries through a fresh store
hydration, then asserts all child history and the final parent record after
completion. It does not repeatedly rehydrate an already-observed running
boundary, because that would measure test-observer allocation rather than
Suite execution resources.

The pool benchmark gates wall time below 60,000 ms, heap growth at or below
128 MiB, artifact bytes at or below 2 MiB per Case, a peak of two contexts,
and zero live worker contexts or leases at Suite completion.

Measured on 2026-08-25 with the same deterministic loopback fixture and
installed headless Playwright Chromium:

| Run | Wall time | Heap growth | Context lifecycle (created/closed/live/peak) | Artifact bytes | Fixture cleanup |
| --- | ---: | ---: | ---: | ---: | --- |
| 2 Cases, pooled | 301 ms | 0 B | 2 / 2 / 0 / 2 | 323,153 B | true |
| 10 Cases, pooled | 1,358 ms | 10,488,376 B | 10 / 10 / 0 / 2 | 1,528,743 B | true |
| 20 Cases, pooled | 2,609 ms | 18,917,192 B | 20 / 20 / 0 / 2 | 3,080,188 B | true |
| 100 Cases, pooled | 14,970 ms | 86,782,592 B | 100 / 100 / 0 / 2 | 15,074,264 B | true |

This is local Chromium evidence only. It does not constitute staging, model,
or production-site acceptance.

## Renderer Bundle Baseline

Measured on 2026-09-02 with `pnpm analyze:bundle`. The renderer keeps its
feature pages and settings modal as independent dynamic entries; the initial
application entry remains the main optimization candidate.

| Asset | Minified | Gzip |
| --- | ---: | ---: |
| Initial renderer entry (`index`) | 573.86 kB | 176.93 kB |
| Renderer stylesheet (`index`) | 214.29 kB | 34.97 kB |

Vite reports the JavaScript entry as larger than its 500 kB advisory limit.
This is recorded as a follow-up candidate for splitting application
coordination, not as a reason to alter the existing page-level lazy-loading
boundaries without a focused behavior and loading-performance test.
