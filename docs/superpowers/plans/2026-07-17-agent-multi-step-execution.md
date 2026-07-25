# Agent Multi-Step Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute every currently supported step from a model-generated Planner plan in sequence, stop on non-passing evidence, and persist one truthful Agent Run.

**Architecture:** Keep browser execution in `StudioRuntime`, but move multi-step run assembly into a shared pure builder so event, artifact, status, and metrics behavior is independently testable. The runtime converts each executed step into a structured execution record; the builder combines those records with the original model plan without exposing credentials or inventing evidence for unexecuted steps.

**Tech Stack:** TypeScript, Electron Main Process, React shared contracts, Vitest, Playwright/Midscene runtime adapters.

---

### Task 1: Shared multi-step run builder

**Files:**
- Modify: `shared/agentStub.ts`
- Test: `shared/agent-contract.test.ts`

- [x] **Step 1: Write the failing aggregation test**

Add a test that calls the desired `createPlannedAgentRun` API with two completed step executions and verifies the full model plan, per-step events, final `passed` status, and merged screenshot/report artifacts.

```ts
const run = createPlannedAgentRun({
  mode: 'ai',
  prompt: '打开报表并检查标题',
  targetEnvironment: 'Staging',
  runtimeDescription: 'chromium / desktop',
  targetUrl: 'https://example.test',
  plannedPlan: {
    title: '报表检查',
    summary: '打开报表并检查标题。',
    risks: [],
    steps: [
      { action: 'navigate', title: '打开报表', instruction: '打开报表', url: 'https://example.test/reports' },
      { action: 'assert', title: '检查标题', instruction: '断言标题包含 Reports' },
    ],
  },
  planner: { source: 'model', modelName: 'planner-large' },
  executions: [
    { stepIndex: 0, status: 'passed', summary: '已打开报表。', evidence: 'URL matched.' },
    { stepIndex: 1, status: 'passed', summary: '标题断言通过。', evidence: 'Reports.' },
  ],
});

expect(run.status).toBe('passed');
expect(run.plan.steps.map((step) => step.title)).toContain('检查标题');
expect(run.events.filter((event) => event.type === 'agent:assertion-result')).toHaveLength(3);
```

- [x] **Step 2: Run the test and verify RED**

Run: `pnpm test shared/agent-contract.test.ts`

Expected: FAIL because `createPlannedAgentRun` is not exported.

- [x] **Step 3: Implement the pure builder**

Add `PlannedAgentStepExecution`, `PlannedAgentRunRequest`, and `createPlannedAgentRun`. Build one plan with context and final verification wrapper steps, emit structured events for each execution, preserve unexecuted planned steps, and derive the overall status as follows:

```ts
const status = executions.some((execution) => execution.status === 'failed')
  ? 'failed'
  : executions.length < plannedPlan.steps.length || executions.some((execution) => execution.status !== 'passed')
    ? 'neutral'
    : 'passed';
```

- [x] **Step 4: Run the test and verify GREEN**

Run: `pnpm test shared/agent-contract.test.ts`

Expected: PASS.

### Task 2: Sequential model-plan execution

**Files:**
- Modify: `electron/studioRuntime.ts`
- Test: `electron/studioRuntime.test.ts`

- [x] **Step 1: Write a failing sequential execution test**

Configure the injected Planner to return `navigate -> input -> click -> assert`. Use browser fakes that update current state and verify calls happen in order, all four planned steps have execution events, and the final run is `passed`.

```ts
expect(actionOrder).toEqual(['navigate:/login', 'input:#username:qa', 'click:#submit']);
expect(response.agentRun.status).toBe('passed');
expect(response.agentRun.events.filter((event) => event.type === 'agent:step-started')).toHaveLength(4);
```

- [x] **Step 2: Run the test and verify RED**

Run: `pnpm test electron/studioRuntime.test.ts -t "executes every supported Planner step in order"`

Expected: FAIL because only the first Planner step executes.

- [x] **Step 3: Implement sequential execution**

Add a model-plan branch that loops over `planningAttempt.result.plan.steps`, calls `prepareBrowserForAgent(request, step)`, converts the result to one truthful execution record, and stops when its status is not `passed`. Direct `navigate`, selector `click`, selector `input`, and successful `observe` steps may pass after their browser call returns; semantic actions and assertions use their runtime evaluation.

- [x] **Step 4: Run the test and verify GREEN**

Run: `pnpm test electron/studioRuntime.test.ts -t "executes every supported Planner step in order"`

Expected: PASS.

### Task 3: Stop and neutral behavior

**Files:**
- Modify: `electron/studioRuntime.ts`
- Test: `electron/studioRuntime.test.ts`

- [x] **Step 1: Write failing stop tests**

Add one test where a semantic assertion fails before a later click and one test where a `wait` step cannot execute. Verify the later action is not called; the first run is `failed`, and the unsupported-step run is `neutral`.

```ts
expect(laterClick).not.toHaveBeenCalled();
expect(failedRun.agentRun.status).toBe('failed');
expect(neutralRun.agentRun.status).toBe('neutral');
```

- [x] **Step 2: Run the tests and verify RED**

Run: `pnpm test electron/studioRuntime.test.ts -t "stops a Planner plan|keeps unsupported Planner steps neutral"`

Expected: FAIL until the loop derives status from evidence and stops.

- [x] **Step 3: Implement evidence-based stop rules**

Map unresolved `wait`, `scroll`, `select`, and `extract` steps to `neutral` with an explicit capability message. Map thrown browser/runtime errors to `failed`. Stop iteration on either state and let `createPlannedAgentRun` preserve remaining plan steps without execution events.

- [x] **Step 4: Run the tests and verify GREEN**

Run: `pnpm test electron/studioRuntime.test.ts`

Expected: PASS.

### Task 4: Documentation and full verification

**Files:**
- Modify: `docs/agent-progress-and-target.md`
- Modify: `docs/implementation-roadmap.md`

- [x] **Step 1: Update progress boundaries**

Document that supported Planner steps execute sequentially, non-passing steps stop the run, unsupported actions remain neutral, and dynamic replanning is still pending.

- [x] **Step 2: Verify all tests**

Run: `pnpm test`

Expected: all test files and tests pass.

- [x] **Step 3: Verify production builds**

Run: `pnpm build`

Expected: renderer and Electron TypeScript builds pass; the existing Vite chunk-size warning may remain.

- [x] **Step 4: Verify diff formatting**

Run: `git diff --check`

Expected: no output and exit code 0.
