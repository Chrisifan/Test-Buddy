# Runtime And Entry Optimization Design

**Date:** 2026-09-02

## Goal

Continue the completed codebase-optimization pass by reducing runtime
coordination coupling, moving desktop-only renderer work off the initial
bundle, and removing only behaviorally identical duplication.

## Scope And Order

The work proceeds in this order because each phase has a different risk
profile and a distinct acceptance surface:

1. Extract browser-session operations and Agent run orchestration from
   `electron/studioRuntime.ts`.
2. Lazy-load desktop runtime client operations from `src/App.tsx` so they do
   not inflate the initial renderer entry.
3. Remove duplicated pure result-building helpers only where their inputs,
   outputs, error classification, and evidence semantics are identical.

The work does not change IPC contracts, run status classification, secret
handling, browser lifecycle ownership, page-level lazy-loading, or user
visible behavior.

## Runtime Boundary

`StudioRuntime` remains the public class used by `RuntimeBundle` and keeps its
current prototype methods. It becomes a thin coordinator over two internal
units:

- `electron/studio-runtime/browser-session.ts` owns browser preparation,
  observation capture, selector fallback, retry waits, and session snapshots.
- `electron/studio-runtime/run-orchestration.ts` owns planner/verifier/reporter
  configuration, replanning, retry progression, event emission, and assembly
  of terminal Agent results.

Both units receive explicit dependency objects. They never construct browser
or model clients, read Electron globals, or write persistence directly. The
runtime continues to own cancellation scope and trace lifecycle so a child
cannot outlive a Run.

## Renderer Loading Boundary

`src/lib/runtime.ts` remains the single typed desktop API adapter. A new
renderer-side lazy facade resolves it only when a user performs a desktop
operation, such as browser control, run dispatch, recording, export, or
maintenance action. Initial application composition, navigation, state
hydration, and page-level dynamic imports remain eager as they are required
for first render.

The facade returns the same promise values and errors as the current adapter.
Its unavailable-desktop fallback remains unchanged. Tests mock the facade, not
Electron globals, so error paths remain deterministic.

## Duplication Policy

Candidates from jscpd are not merged solely because their token sequences
match. Extraction is allowed only for a pure helper whose callers share all of
the following:

- returned domain shape;
- terminal status and failure-category semantics;
- evidence and artifact fields;
- cancellation behavior.

IPC channel mirrors, TypeScript declarations, CSS selectors, and branches that
have different recovery or audit behavior remain separate. The first audit
targets repeated execution-result assembly in `StudioRuntime`; `test-runner`
is changed only if a focused contract test proves equivalence.

## Verification

Each extraction starts with a direct-module contract test, then runs the
affected `StudioRuntime`, `RuntimeBundle`, IPC, CLI, and renderer tests.
Renderer loading changes add tests that prove the initial path does not import
the desktop runtime until an operation is invoked. `pnpm analyze:bundle`
records the entry size before and after the facade.

Every phase must pass `pnpm quality`, `pnpm typecheck`, focused Vitest suites,
`pnpm build`, and `git diff --check`. The final pass also runs the normal
Vitest suite, browser smoke, Knip, and jscpd. BrowserPool benchmarks are
recorded as environment-limited only when the sandbox denies loopback binding.

## Acceptance Criteria

- `StudioRuntime` loses browser-session and run-orchestration implementation
  details without public API changes.
- Initial renderer JavaScript is reduced from the 573.86 kB baseline, with the
  resulting size documented even if it remains over Vite's advisory threshold.
- Any extracted duplicate has direct tests for success, failure, and
  cancellation/evidence behavior.
- No secret value can cross the renderer persistence boundary.
