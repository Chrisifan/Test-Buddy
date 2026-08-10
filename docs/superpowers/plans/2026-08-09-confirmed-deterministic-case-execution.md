# Confirmed Deterministic Case Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run confirmed V2 `navigate`, selector `click`, `wait`, and `scroll` case steps exactly once through a real Playwright page without planning or model execution.

**Architecture:** A shared pure helper converts an eligible persisted V2 execution draft into a preconstructed Agent plan step. TestRunner routes those steps to a dedicated StudioRuntime method, which requires `BrowserRuntime.hasRealPage()` and creates one child Agent Run from the existing browser preparation/evidence helpers. Existing Workflow and Recording paths remain intact.

**Tech Stack:** TypeScript, Vitest, Electron runtime, BrowserRuntime, shared studio contracts, pnpm quality scripts.

---

### Task 1: Lock Confirmed-Action Eligibility and Case Routing

**Files:**
- Modify: `shared/studio.test.ts`
- Modify: `shared/studio.ts`
- Modify: `electron/runtime/runtime-bundle.test.ts`
- Modify: `electron/runtime/runtime-bundle.ts`

- [ ] **Step 1: Write failing shared eligibility tests**

Add a confirmed V2 `ai` navigate step and assert that `getConfirmedDeterministicTestStep()` produces this plan-shaped object:

```ts
expect(getConfirmedDeterministicTestStep(step)).toEqual({
  action: 'navigate',
  title: '打开订单页',
  instruction: '打开订单页',
  url: 'https://example.test/orders',
});
```

Add cases for `click`, `waitForSelector`, `waitForTimeout`, and `scrollTo`. Assert `undefined` for `needsReview`, missing action, `input`, `select`, malformed locator, and a non-`ai` step. Add a mixed case containing one confirmed navigate and one legacy `ai` step, and assert `isAgentRunnableTestCase(case)` is `false`. Also assert a pure `ai` case with a confirmed `input` action is not Agent-runnable: the confirmed V2 state must block model fallback even though the action cannot run in this slice.

- [ ] **Step 2: Verify shared RED**

Run: `pnpm exec vitest run shared/studio.test.ts -t "confirmed deterministic|agent runnable"`

Expected: FAIL because the eligibility helper does not exist and all-AI routing still accepts a confirmed deterministic action.

- [ ] **Step 3: Implement the narrow shared converter**

Add these exports in `shared/studio.ts`:

```ts
export function getConfirmedDeterministicTestStep(
  step: TestStepDraft,
): AgentPlanStepDraft | undefined;

export function isConfirmedDeterministicTestStep(step: TestStepDraft): boolean;
```

Require `step.type === 'ai'`, `execution?.reviewStatus === 'confirmed'`, and one supported action. Copy only structured `url`, `locator.selector`, or `timeoutMs` into the returned plan step. Change `isAgentRunnableTestCase()` so it returns `false` when any `ai` step has `execution.reviewStatus === 'confirmed'`, including unsupported V2 actions; preserve `true` for legacy all-AI cases.

- [ ] **Step 4: Verify shared GREEN**

Run: `pnpm exec vitest run shared/studio.test.ts -t "confirmed deterministic|agent runnable"`

Expected: selected tests pass.

- [ ] **Step 5: Write runtime-bundle routing test and verify RED**

In `electron/runtime/runtime-bundle.test.ts`, create a case with a confirmed V2 navigate step. Spy on `bundle.testRunner.run` and `bundle.studioRuntime.runWorkflow`; call `bundle.runTestCase()` and assert TestRunner receives the case while Workflow does not. Keep the existing cancellation test unchanged.

Run: `pnpm exec vitest run electron/runtime/runtime-bundle.test.ts`

Expected: FAIL before the routing change because the all-AI fast path calls `runWorkflow`.

- [ ] **Step 6: Route only all-model cases through Workflow**

Keep `RuntimeBundle.runTestCase()` structure intact. Its existing `isAgentRunnableTestCase()` check must now delegate mixed and confirmed deterministic cases to `testRunner.run()`. Do not add a renderer or IPC entry point.

- [ ] **Step 7: Verify bundle GREEN**

Run: `pnpm exec vitest run electron/runtime/runtime-bundle.test.ts`

Expected: all tests pass.

### Task 2: Execute One Confirmed Action Through a Real Page

**Files:**
- Modify: `electron/runtime/browser-runtime.ts`
- Modify: `electron/runtime/browser-runtime.test.ts`
- Modify: `electron/studioRuntime.ts`
- Modify: `electron/studioRuntime.test.ts`

- [ ] **Step 1: Write failing real-page guard tests**

Add a BrowserRuntime test that starts without Playwright and asserts `hasRealPage()` is false. In `studioRuntime.test.ts`, supply an observer with `hasRealPage: () => false` plus spies for `navigate`, `click`, `waitForSelector`, and `scrollTo`; call the new deterministic runner with a confirmed navigate step and assert:

```ts
expect(response.agentRun.status).toBe('neutral');
expect(observer.navigate).not.toHaveBeenCalled();
expect(planner.createPlan).not.toHaveBeenCalled();
```

Add a real-page-shaped observer with `hasRealPage: () => true` and navigation result, then assert one passed child run contains a `navigate` plan step and BrowserRuntime evidence.

- [ ] **Step 2: Verify runtime RED**

Run: `pnpm exec vitest run electron/runtime/browser-runtime.test.ts electron/studioRuntime.test.ts -t "real page|deterministic step"`

Expected: FAIL because `hasRealPage()` and `runDeterministicStep()` do not exist.

- [ ] **Step 3: Add a non-invasive BrowserRuntime capability signal**

Add `hasRealPage(): boolean` to BrowserRuntime and optional `hasRealPage?(): boolean` to StudioRuntime's BrowserObserver interface. Return `Boolean(this.page)`. Do not expose `page`, change start behavior, or alter the normal AI fallback route.

- [ ] **Step 4: Add the dedicated deterministic child runner**

Add `RunDeterministicStepRequest` and `RunDeterministicStepResponse` in `electron/studioRuntime.ts`. The request includes an already-converted `AgentPlanStepDraft`, source `TestStepDraft`, environment/runtime/project context, parent/run IDs, and cancellation signal.

Implement `StudioRuntime.runDeterministicStep()` to:

1. start/finish its existing trace scope;
2. return a neutral child Agent Run before dispatch when `hasRealPage?.()` is not true;
3. invoke `prepareBrowserForAgent(request, plannedStep)` exactly once when the real-page guard passes;
4. turn the result into a single `PlannedAgentStepExecution` with `toPlannedStepExecution()`;
5. create a plan/result with `createPlannedAgentRun()` and no Planner/Verifier/Reporter/retry/fallback/replanning calls;
6. convert the child result into a one-step `RunDetail`, retain returned artifacts, and map cancellation using current `markAgentRunCancelled()` rules.

Use the existing `createChatCommandResponse` only when its UI chat entries are needed; this runner returns runtime evidence directly and must not add chat messages.

- [ ] **Step 5: Verify runtime GREEN**

Run: `pnpm exec vitest run electron/runtime/browser-runtime.test.ts electron/studioRuntime.test.ts -t "real page|deterministic step"`

Expected: selected tests pass, including no-stub-pass and no-model-call assertions.

### Task 3: Preserve Serial Parent-Run Semantics

**Files:**
- Modify: `electron/runtime/test-runner.ts`
- Modify: `electron/runtime/test-runner.test.ts`
- Modify: `shared/agentStub.ts`
- Modify: `shared/agent-contract.test.ts`

- [ ] **Step 1: Write failing TestRunner orchestration tests**

Extend the TestRunner test double with `runDeterministicStep()`. Add a case ordered as confirmed navigate, recording replay, legacy `ai`, and manual. Assert that the deterministic runner, replay runner, and workflow runner are called in that order and the parent detail contains each child Agent Run/artifact. Add a deterministic child `failed` result and assert no subsequent runner is called and later steps are neutral.

- [ ] **Step 2: Verify TestRunner RED**

Run: `pnpm exec vitest run electron/runtime/test-runner.test.ts -t "deterministic"`

Expected: FAIL because TestRunner has no deterministic runner dependency or branch.

- [ ] **Step 3: Add the deterministic branch before Workflow**

Define a structural `DeterministicStepRunner` with `runDeterministicStep()`. Before `isAgentStep(step)`, use `getConfirmedDeterministicTestStep(step)` to dispatch supported confirmed steps. Reuse the recording/workflow branch logic for child Agent Run collection, logs, artifacts, cancellation, RunStepLog creation, and non-pass stop behavior. A confirmed V2 action that is unsupported or malformed must create a neutral step with an explicit reason and stop the case; it must not dispatch BrowserRuntime or fall through to the model-backed Workflow path.

- [ ] **Step 4: Preserve parent evidence mapping**

Update `createTestCaseAgentRun()` only as needed to preserve the selected child action when it has source type `ai`. Do not persist raw `input/select` values and do not invent a new source step type. Add an agent-contract test that the deterministic child action and browser evidence appear under the correct parent `stepId`.

- [ ] **Step 5: Verify TestRunner GREEN**

Run: `pnpm exec vitest run electron/runtime/test-runner.test.ts shared/agent-contract.test.ts -t "deterministic"`

Expected: selected tests pass; existing recording/AI/manual behavior remains covered by the full file run.

### Task 4: Verify Compatibility and Document the Completed Slice

**Files:**
- Modify: `docs/implementation-roadmap.md`
- Modify: `docs/agent-progress-and-target.md`
- Verify: `shared/studio.test.ts`
- Verify: `electron/runtime/browser-runtime.test.ts`
- Verify: `electron/studioRuntime.test.ts`
- Verify: `electron/runtime/test-runner.test.ts`
- Verify: `electron/runtime/runtime-bundle.test.ts`

- [ ] **Step 1: Run affected test files**

Run:

```bash
pnpm exec vitest run shared/studio.test.ts electron/runtime/browser-runtime.test.ts electron/studioRuntime.test.ts electron/runtime/test-runner.test.ts electron/runtime/runtime-bundle.test.ts shared/agent-contract.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 2: Run full offline quality gate**

Run: `pnpm check`

Expected: zero Vitest failures, type check exits 0, renderer/Electron builds exit 0, and `git diff --check` has no output.

- [ ] **Step 3: Update progress markers from evidence**

Mark only confirmed V2 navigation, click, wait, and scroll execution as code implemented and offline verified. Keep input/select bindings, explicit assertions, V2 editor confirmation UI, project assets, fixtures/auth, suites, complex interactions, and real business-page acceptance as planned.

- [ ] **Step 4: Review the final diff boundary**

Confirm from the diff that this slice does not start the application, call a model, access a business page, add a renderer/IPC command, execute unconfirmed V2 drafts, or permit stub sessions to pass deterministic actions.
