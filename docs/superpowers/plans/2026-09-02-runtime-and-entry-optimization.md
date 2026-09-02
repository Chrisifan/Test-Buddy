# Runtime And Entry Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Reduce runtime coordination coupling and initial renderer JavaScript without changing desktop contracts, execution semantics, or secret boundaries.

**Architecture:** Keep `StudioRuntime` as the public class used by `RuntimeBundle`, but delegate browser-session preparation and Agent execution orchestration to explicit internal dependencies. Keep `src/lib/runtime.ts` as the typed Electron adapter, but expose a renderer facade that imports it only after a desktop operation begins. Extract only pure duplication with a direct contract test that proves matching success, error, evidence, and cancellation behavior.

**Tech Stack:** TypeScript, Electron 37, React 19, Vite 7, Vitest 4, pnpm, Playwright, Knip, jscpd.

---

### Task 1: Extract Browser Session Coordination

**Files:**
- Create: `electron/studio-runtime/browser-session.ts`
- Create: `electron/studio-runtime/browser-session.test.ts`
- Modify: `electron/studioRuntime.ts`
- Test: `electron/studioRuntime.test.ts`

- [x] **Step 1: Write the direct browser-session boundary test**

Create a test for the new coordinator with a `BrowserObserver` double that
returns a session and structured observation. The test must assert that a
planned `navigate` step calls `navigate`, returns the new session URL, and
keeps structured tables and charts in the returned observation:

```ts
const coordinator = createBrowserSessionCoordinator({
  browserObserver: {
    getState: () => idleSession,
    navigate: vi.fn().mockResolvedValue({ ...idleSession, currentUrl: 'https://example.test/orders' }),
    captureObservation: vi.fn().mockResolvedValue({ tables: [table], charts: [chart] }),
  },
});

await expect(coordinator.prepareForAgent(request, navigateStep)).resolves.toMatchObject({
  navigatedUrl: 'https://example.test/orders',
  observation: { tables: [table], charts: [chart] },
});
```

- [x] **Step 2: Verify the test is red**

Run:

```bash
pnpm exec node node_modules/vitest/vitest.mjs run electron/studio-runtime/browser-session.test.ts
```

Expected: FAIL because `browser-session.js` does not exist.

- [x] **Step 3: Move browser-only interfaces and operations**

Move `BrowserObserver`, `BrowserPreparationResult`, `prepareBrowserForAgent`,
`captureBrowserObservation`, `prepareDeterministicAssertion`, and
`prepareDeterministicBoundInput` into the new module. Export an explicit
factory and types:

```ts
export interface BrowserSessionCoordinator {
  captureObservation: (cancellationSignal?: AbortSignal) => Promise<AgentObservation | undefined>;
  prepareDeterministicAssertion: (request: RunDeterministicStepRequest) => Promise<ExplicitAssertionIntent | undefined>;
  prepareDeterministicBoundInput: (request: RunDeterministicStepRequest) => Promise<string | undefined>;
  prepareForAgent: (
    request: ResolvedChatCommandRequest,
    step?: AgentPlanStepDraft,
  ) => Promise<BrowserPreparationResult>;
}

export const createBrowserSessionCoordinator = (
  dependencies: BrowserSessionCoordinatorDependencies,
): BrowserSessionCoordinator => ({
  captureObservation: (cancellationSignal) => captureBrowserObservation(dependencies, cancellationSignal),
  prepareDeterministicAssertion: (request) => prepareDeterministicAssertion(dependencies, request),
  prepareDeterministicBoundInput: (request) => prepareDeterministicBoundInput(dependencies, request),
  prepareForAgent: (request, step) => prepareBrowserForAgent(dependencies, request, step),
});
```

`StudioRuntime` stores one coordinator and delegates through it. Preserve the
existing public constructor argument order and all public prototype methods.
Keep cancellation checks adjacent to awaited browser calls.

- [x] **Step 4: Verify browser and deterministic execution contracts**

Run:

```bash
pnpm exec node node_modules/vitest/vitest.mjs run electron/studio-runtime/browser-session.test.ts electron/studioRuntime.test.ts electron/runtime/test-runner.test.ts
pnpm typecheck
```

Expected: PASS with no change to session snapshots, deterministic assertion
statuses, or input-binding redaction behavior.

- [x] **Step 5: Commit the isolated browser boundary**

```bash
git add electron/studioRuntime.ts electron/studioRuntime.test.ts electron/studio-runtime/browser-session.ts electron/studio-runtime/browser-session.test.ts
git commit -m "refactor(runtime): isolate browser session coordination"
```

### Task 2: Extract Agent Run Orchestration

**Files:**
- Create: `electron/studio-runtime/run-orchestration.ts`
- Create: `electron/studio-runtime/run-orchestration.test.ts`
- Modify: `electron/studioRuntime.ts`
- Test: `electron/studioRuntime.test.ts`, `electron/runtime/runtime-bundle.test.ts`

- [x] **Step 1: Write an orchestration retry/replan contract test**

Test the new module with injected planner, browser-session coordinator, and
event emitter. The first prepared execution must fail, the second must pass,
and the test must assert exactly one retry metric, preserved first-attempt
evidence, and no extra event after cancellation:

```ts
await expect(orchestrator.runChatCommand(request)).resolves.toMatchObject({
  agentRun: expect.objectContaining({
    metrics: expect.objectContaining({ retryAttempts: 1 }),
    executions: [expect.objectContaining({ retryAttempts: [expect.objectContaining({ status: 'failed' })] })],
  }),
});
expect(emitRunEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent:step-completed' }));
```

- [x] **Step 2: Verify the test is red**

Run:

```bash
pnpm exec node node_modules/vitest/vitest.mjs run electron/studio-runtime/run-orchestration.test.ts
```

Expected: FAIL because `run-orchestration.js` does not exist.

- [x] **Step 3: Move the Agent command loop behind injected dependencies**

Move `sendChatCommand`'s planning, retry, selector fallback, replanning,
reporter enhancement, trace handling, and command-response assembly into a
factory. Its dependency object receives the browser-session coordinator,
planner/verifier/reporter clients, report writer, event emitter, and trace
callbacks. Keep these exports internal to `electron/studio-runtime/`:

```ts
export interface AgentRunOrchestrator {
  runChatCommand: (request: ResolvedChatCommandRequest) => Promise<ChatCommandResponse>;
}

export const createAgentRunOrchestrator = (
  dependencies: AgentRunOrchestratorDependencies,
): AgentRunOrchestrator => ({
  runChatCommand: (request) => runChatCommand(dependencies, request),
});
```

`StudioRuntime.sendChatCommand` delegates without changing its return value.
`StudioRuntime` remains the single owner of the active trace scope and passes
`beginTraceScope` and `finishTraceScope` callbacks to the orchestrator.

- [x] **Step 4: Verify runtime integration**

Run:

```bash
pnpm exec node node_modules/vitest/vitest.mjs run electron/studio-runtime/run-orchestration.test.ts electron/studioRuntime.test.ts electron/runtime/runtime-bundle.test.ts electron/ipc/runtime-ipc-handlers.test.ts electron/cli.test.ts
pnpm typecheck
```

Expected: PASS with unchanged run IDs, event sequence, cancellation behavior,
secret redaction, reporter artifacts, retry history, and replanning history.

- [x] **Step 5: Commit the orchestration boundary**

```bash
git add electron/studioRuntime.ts electron/studioRuntime.test.ts electron/studio-runtime/run-orchestration.ts electron/studio-runtime/run-orchestration.test.ts electron/runtime/runtime-bundle.test.ts electron/ipc/runtime-ipc-handlers.test.ts electron/cli.test.ts
git commit -m "refactor(runtime): separate agent run orchestration"
```

### Task 3: Lazy-Load the Renderer Desktop Runtime Adapter

**Files:**
- Create: `src/app/desktop-runtime-client.ts`
- Create: `src/app/desktop-runtime-client.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `docs/benchmarks/suite-baseline.md`

- [x] **Step 1: Write a lazy-module contract test**

The test must mock `../lib/runtime.js`, import the facade, and prove no
desktop adapter module is evaluated until a facade method is called:

```ts
const loadRuntime = vi.fn(async () => ({ captureBrowserSnapshot: vi.fn().mockResolvedValue(session) }));
vi.doMock('../lib/runtime.js', () => loadRuntime());

const { captureBrowserSnapshot } = await import('./desktop-runtime-client.js');
expect(loadRuntime).not.toHaveBeenCalled();
await expect(captureBrowserSnapshot()).resolves.toEqual(session);
expect(loadRuntime).toHaveBeenCalledTimes(1);
```

- [x] **Step 2: Verify the test is red**

Run:

```bash
pnpm exec node node_modules/vitest/vitest.mjs run src/app/desktop-runtime-client.test.ts
```

Expected: FAIL because `desktop-runtime-client.js` does not exist.

- [x] **Step 3: Add a cached lazy facade and migrate App imports**

Implement one module promise and method-level proxies for every `App.tsx`
runtime import. The facade uses type-only imports and dynamic loading:

```ts
type DesktopRuntime = typeof import('../lib/runtime.js');

let desktopRuntimePromise: Promise<DesktopRuntime> | undefined;

const loadDesktopRuntime = (): Promise<DesktopRuntime> => {
  desktopRuntimePromise ??= import('../lib/runtime.js');
  return desktopRuntimePromise;
};

export const captureBrowserSnapshot = async () => {
  return (await loadDesktopRuntime()).captureBrowserSnapshot();
};
```

Replace only `App.tsx`'s static `./lib/runtime` import with the facade. Keep
feature-page imports untouched because those pages are already independent
dynamic chunks. Preserve every unavailable-desktop error and return value.

- [x] **Step 4: Verify behavior and bundle measurement**

Run:

```bash
pnpm exec node node_modules/vitest/vitest.mjs run src/app/desktop-runtime-client.test.ts src/App.test.tsx src/lib/runtime.test.ts
pnpm analyze:bundle
pnpm build
```

Record the resulting `index` JavaScript and gzip sizes in
`docs/benchmarks/suite-baseline.md`. Expected: the adapter moves to a dynamic
chunk and the initial entry is smaller than the 573.86 kB baseline.

- [x] **Step 5: Commit the renderer loading boundary**

```bash
git add src/App.tsx src/App.test.tsx src/app/desktop-runtime-client.ts src/app/desktop-runtime-client.test.ts docs/benchmarks/suite-baseline.md
git commit -m "refactor(renderer): lazy-load desktop runtime client"
```

### Task 4: Deduplicate Shared Recursive Freezing

**Files:**
- Create: `shared/deep-freeze.ts`
- Create: `shared/deep-freeze.test.ts`
- Modify: `electron/ipc/runtime-ipc-handlers.ts`
- Modify: `electron/runtime/artifact-manager.ts`
- Modify: `electron/runtime/run-history.ts`

- [x] **Step 1: Write the recursive-freezing contract test**

The audit identified byte-equivalent `deepFreeze` implementations in
`runtime-ipc-handlers.ts`, `artifact-manager.ts`, and `run-history.ts`. Test
the shared helper freezes nested arrays and objects, preserves primitive
values, and returns an already-frozen object without replacing it:

```ts
const source = { metadata: { values: [{ id: 'one' }] } };
const result = deepFreeze(source);

expect(result).toBe(source);
expect(Object.isFrozen(result)).toBe(true);
expect(Object.isFrozen(result.metadata)).toBe(true);
expect(Object.isFrozen(result.metadata.values)).toBe(true);
expect(Object.isFrozen(result.metadata.values[0])).toBe(true);
expect(deepFreeze('stable')).toBe('stable');
expect(deepFreeze(result)).toBe(result);
```

- [x] **Step 2: Verify the test is red**

Run:

```bash
pnpm exec node node_modules/vitest/vitest.mjs run shared/deep-freeze.test.ts
```

Expected: FAIL because `deep-freeze.js` does not exist.

- [x] **Step 3: Replace the three local implementations with one pure helper**

Create `shared/deep-freeze.ts`:

```ts
export const deepFreeze = <Value>(value: Value): Value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  Object.values(value).forEach((child) => deepFreeze(child));
  return Object.freeze(value);
};
```

Replace each local declaration with an import from the shared module. Do not
add cycle support or change the treatment of functions, dates, or already
frozen values; preserving the current contract is the purpose of this step.

- [x] **Step 4: Verify imports and clone reduction**

Run:

```bash
pnpm exec node node_modules/vitest/vitest.mjs run shared/deep-freeze.test.ts electron/ipc/runtime-ipc-handlers.test.ts electron/runtime/artifact-manager.test.ts electron/runtime/test-runner.test.ts
pnpm quality:duplicates
```

Expected: focused tests PASS and jscpd no longer reports the three local
`deepFreeze` declarations as a clone.

- [x] **Step 5: Commit the targeted deduplication**

```bash
git add shared/deep-freeze.ts shared/deep-freeze.test.ts electron/ipc/runtime-ipc-handlers.ts electron/runtime/artifact-manager.ts electron/runtime/run-history.ts
git commit -m "refactor(shared): deduplicate recursive freezing"
```

### Task 5: Final Acceptance And Documentation

**Files:**
- Modify: `docs/benchmarks/suite-baseline.md`
- Modify: `docs/superpowers/plans/2026-09-02-runtime-and-entry-optimization.md`

- [x] **Step 1: Run enforcement and behavioral suites**

Run:

```bash
pnpm quality
pnpm exec node node_modules/vitest/vitest.mjs run --exclude electron/runtime/browser-smoke.test.ts --exclude electron/runtime/suite-benchmark.test.ts
pnpm test:browser-smoke
pnpm typecheck
pnpm build
git diff --check
```

Expected: every command exits 0.

- [x] **Step 2: Run informational audits and record conclusions**

Run:

```bash
pnpm quality:unused
pnpm quality:duplicates
pnpm exec node node_modules/vitest/vitest.mjs run electron/runtime/suite-benchmark.test.ts -t "100-Case" --testTimeout=120000
```

Treat Knip and jscpd nonzero exits as candidate reports. Record their findings.
Only classify the benchmark as environment-limited when it fails before any
test action with `listen EPERM` on `127.0.0.1`.

- [x] **Step 3: Update completion record and commit acceptance evidence**

Update the plan checklist and bundle benchmark values, then commit:

```bash
git add docs/benchmarks/suite-baseline.md docs/superpowers/plans/2026-09-02-runtime-and-entry-optimization.md
git commit -m "docs: record runtime and entry optimization results"
```

## Completion Record

- Browser-session coordination was extracted behind a direct contract test;
  the focused runtime suite and typecheck passed.
- Agent planning, retry, selector fallback, replanning, tracing and response
  assembly now execute through an injected orchestrator; its retry evidence
  contract and integration suite passed.
- The renderer desktop runtime now loads lazily. The initial `index` entry is
  539.27 kB / 167.33 kB gzip, down from 573.86 kB / 176.93 kB gzip; the
  adapter is a 35.67 kB / 10.34 kB gzip dynamic chunk.
- The three byte-equivalent `deepFreeze` declarations now share one tested
  implementation. Custom IPC and benchmark source loaders were updated for
  the new runtime dependency.
- Final gates passed: `pnpm quality`, 91 files / 1011 normal Vitest tests,
  browser smoke (3 tests), `pnpm typecheck`, `pnpm build`, and `git diff --check`.
- Knip reports existing unused-code candidates (including 2 dependencies,
  1 dev dependency, and public API exports). jscpd reports 138 existing
  clones at its configured zero threshold; it no longer reports the three
  replaced local `deepFreeze` declarations.
- The 100-Case benchmark is environment-limited: the sandbox rejects its
  loopback fixture before test actions with `listen EPERM` on `127.0.0.1`.
