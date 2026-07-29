# Planner Replanning Evidence History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve every abandoned Planner cycle as ordered, selectable run evidence without changing the final revised plan's status semantics.

**Architecture:** `StudioRuntime` captures outgoing cycles in `PlannedAgentReplanningRecord[]`. `createPlannedAgentRun()` uses one event-emission path for historical and final executions, exposes each successful revision as `agent:plan-revised`, and derives status only from the final plan. Run Records resolves evidence through historical step IDs, while Reporter serializes structured revision data when invoked for a non-passing run.

**Tech Stack:** TypeScript 5.9, Electron, React 19, Vitest 4, Testing Library.

---

## File Map

- `shared/agent.ts`: public revision payload and event type.
- `shared/agentStub.ts`: internal history records and chronological event assembly.
- `shared/agentStub.test.ts`: assembler status, ordering, identity, and artifact tests.
- `electron/studioRuntime.ts`: outgoing-cycle capture.
- `electron/studioRuntime.test.ts`: recovered and multi-cycle runtime regressions.
- `src/features/runs/RunRecordsPage.tsx`: step-linked historical evidence lookup.
- `src/features/runs/RunRecordsPage.test.tsx`: revision-selection UI regression.
- `electron/runtime/agent-reporter.ts`: structured event serialization.
- `electron/runtime/agent-reporter.test.ts`: Reporter request regression.
- `docs/implementation-roadmap.md` and `docs/agent-progress-and-target.md`: capability and regression declarations.

### Task 1: Public Contract And Run Assembler

**Files:**
- Create: `shared/agentStub.test.ts`
- Modify: `shared/agent.ts:217-246`
- Modify: `shared/agentStub.ts:82-130,420-686`

- [ ] **Step 1: Write the failing assembler test**

Create `shared/agentStub.test.ts` with a recovered run containing one historical navigation failure:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createPlannedAgentRun } from './agentStub.js';

describe('createPlannedAgentRun replanning history', () => {
  it('keeps abandoned failure evidence while the recovered run passes', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const initialPlan = {
      title: '打开工作台', summary: '使用原地址。', risks: [],
      steps: [{ action: 'navigate' as const, title: '进入工作台', instruction: '打开旧地址', url: 'https://broken.test' }],
    };
    const revisedPlan = {
      title: '打开工作台修正版', summary: '使用可用地址。', risks: [],
      steps: [{ action: 'navigate' as const, title: '进入工作台', instruction: '打开新地址', url: 'https://example.test' }],
    };
    const run = createPlannedAgentRun({
      mode: 'ai', prompt: '打开工作台', runtimeDescription: 'chromium / desktop',
      targetEnvironment: 'staging', plannedPlan: revisedPlan,
      planner: { source: 'model', modelName: 'planner-large' },
      replanningHistory: [{
        cycle: 1, previousPlan: initialPlan, revisedPlan, failedStepIndex: 0,
        executions: [{
          stepIndex: 0, status: 'failed', summary: '旧地址不可达',
          evidence: 'net::ERR_NAME_NOT_RESOLVED', failureReason: '导航失败',
          failureCategory: 'navigation', recoveryStrategy: 'replanNavigation',
          browserSession: {
            status: 'ready', currentUrl: 'https://start.test', pageTitle: 'Start',
            screenshotPath: '/tmp/replan.png',
          },
          observation: { domSummary: '仍停留在起始页' },
          reportArtifactPath: '/tmp/replan-report.html',
        }],
      }],
      executions: [{ stepIndex: 0, status: 'passed', summary: '已打开工作台', evidence: 'URL 已更新' }],
    });
    const revision = run.events.find((event) => event.type === 'agent:plan-revised');

    expect(run.status).toBe('passed');
    expect(run.plan.title).toBe('打开工作台修正版');
    expect(revision).toEqual(expect.objectContaining({
      status: 'neutral', stepId: expect.stringContaining('replan-1-step-1'),
      planRevision: expect.objectContaining({
        cycle: 1, previousPlanTitle: '打开工作台', revisedPlanTitle: '打开工作台修正版',
        failureCategory: 'navigation', recoveryStrategy: 'replanNavigation',
      }),
    }));
    expect(run.events.findIndex((event) => event.type === 'agent:step-failed'))
      .toBeLessThan(run.events.findIndex((event) => event.type === 'agent:plan-revised'));
    expect(run.artifacts.filter((artifact) => artifact.path === '/tmp/replan.png')).toHaveLength(1);
    expect(run.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/tmp/replan-report.html' }),
    ]));
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm test -- shared/agentStub.test.ts`

Expected: TypeScript/Vitest failure because `replanningHistory` and `agent:plan-revised` do not exist.

- [ ] **Step 3: Add exact data contracts**

In `shared/agent.ts`, add:

```ts
export interface AgentPlanRevision {
  cycle: number;
  previousPlanTitle: string;
  revisedPlanTitle: string;
  triggerStepId: string;
  triggerStepTitle: string;
  triggerStatus: AgentRunStatus;
  failureReason?: string;
  failureCategory?: AgentFailureCategory;
  recoveryStrategy?: AgentRecoveryStrategy;
}
```

Add `'agent:plan-revised'` to `AgentRunEventType` and `planRevision?: AgentPlanRevision` to `AgentRunEvent`.

In `shared/agentStub.ts`, add:

```ts
export interface PlannedAgentReplanningRecord {
  cycle: number;
  previousPlan: AgentPlanDraft;
  revisedPlan: AgentPlanDraft;
  executions: PlannedAgentStepExecution[];
  failedStepIndex: number;
}
```

Add `replanningHistory?: PlannedAgentReplanningRecord[]` to `PlannedAgentRunRequest`.

- [ ] **Step 4: Reuse one execution-event emitter**

Extract the existing per-execution body into a local `appendExecutionEvents` function. Its inputs are `steps`, `executions`, and an `idNamespace`; all generated event, observation, verification, and artifact IDs include that namespace. The function continues to close over one shared `artifactPaths` set.

```ts
const appendExecutionEvents = (
  steps: AgentStep[],
  executions: PlannedAgentStepExecution[],
  idNamespace: string,
) => {
  executions.forEach((execution) => {
    const step = steps[execution.stepIndex];
    if (!step) return;
    const idPrefix = `${runId}-${idNamespace}-step-${execution.stepIndex + 1}`;
    // The existing lines 508-652 move into this block. Replace every former
    // `${runId}-event-step-${execution.stepIndex}` / observation / verification /
    // artifact ID prefix with `idPrefix`; retain every payload and message.
  });
};
```

This is a mechanical extraction of the existing dynamic-wait, retry, selector-fallback, browser-action, observation, artifact, verification, and step-failed blocks. It does not introduce additional module-level helpers or change event content.

- [ ] **Step 5: Assemble history before final executions**

Build cycle-specific steps as `${runId}-replan-${cycle}-step-${index + 1}`. Emit each cycle's executions, then emit exactly one revision event:

```ts
for (const record of request.replanningHistory ?? []) {
  const historicalSteps: AgentStep[] = record.previousPlan.steps.map((step, index) => ({
    ...step,
    id: `${runId}-replan-${record.cycle}-step-${index + 1}`,
    sourceStepType: modeToSourceStepType(request.mode),
  }));
  appendExecutionEvents(historicalSteps, record.executions, `replan-${record.cycle}`);
  const trigger = record.executions.find((item) => item.stepIndex === record.failedStepIndex);
  const triggerStep = historicalSteps[record.failedStepIndex];
  if (!trigger || !triggerStep) continue;
  events.push({
    id: `${runId}-event-plan-revised-${record.cycle}`,
    runId,
    type: 'agent:plan-revised',
    message: `第 ${record.cycle} 次重规划：${record.previousPlan.title} -> ${record.revisedPlan.title}`,
    status: 'neutral',
    stepId: triggerStep.id,
    planRevision: {
      cycle: record.cycle,
      previousPlanTitle: record.previousPlan.title,
      revisedPlanTitle: record.revisedPlan.title,
      triggerStepId: triggerStep.id,
      triggerStepTitle: triggerStep.title,
      triggerStatus: trigger.status,
      ...(trigger.failureReason ? { failureReason: trigger.failureReason } : {}),
      ...(trigger.failureCategory ? { failureCategory: trigger.failureCategory } : {}),
      ...(trigger.recoveryStrategy ? { recoveryStrategy: trigger.recoveryStrategy } : {}),
    },
    createdAt: now,
  });
}
appendExecutionEvents(plannedSteps, request.executions, 'final');
```

Attach the initial plan to `agent:plan-created`, keep `AgentRunResult.plan` as the final plan, and keep status/failure calculations based only on `request.executions`.

- [ ] **Step 6: Run the focused test and verify GREEN**

Run: `pnpm test -- shared/agentStub.test.ts`

Expected: one passing test.

### Task 2: Runtime Capture And Status Precedence

**Files:**
- Modify: `electron/studioRuntime.ts:1867-1950`
- Modify: `electron/studioRuntime.test.ts:1080-1515`
- Modify: `shared/agentStub.test.ts`

- [ ] **Step 1: Extend the recovered-navigation test**

Give the failed state `screenshotPath: '/tmp/navigation-failed.png'`, then assert:

```ts
const revision = response.agentRun.events.find((event) => event.type === 'agent:plan-revised');
const historicalFailure = response.agentRun.events.find(
  (event) => event.type === 'agent:step-failed' && event.stepId === revision?.stepId,
);
const historicalObservation = response.agentRun.events.find(
  (event) => event.type === 'agent:observation-created' && event.stepId === revision?.stepId,
);
expect(response.agentRun.status).toBe('passed');
expect(revision?.planRevision).toEqual(expect.objectContaining({
  cycle: 1, failureCategory: 'navigation', recoveryStrategy: 'replanNavigation',
}));
expect(historicalFailure?.message).toContain('ERR_NAME_NOT_RESOLVED');
expect(historicalObservation?.observation?.screenshotPath).toBe('/tmp/navigation-failed.png');
```

- [ ] **Step 2: Run the navigation test and verify RED**

Run: `pnpm test -- electron/studioRuntime.test.ts -t "skips same-plan retry for replan-navigation failures"`

Expected: FAIL because Runtime does not pass replanning history.

- [ ] **Step 3: Capture the outgoing cycle**

Initialize `const replanningHistory: PlannedAgentReplanningRecord[] = [];`. In the successful-revision branch, push the current failure before resetting:

```ts
const previousPlan = plannedPlan;
executions.push(execution);
replanningCycles += 1;
const nextPlan = {
  ...revisedPlan.plan,
  risks: [
    ...revisedPlan.plan.risks,
    `已在步骤「${step.title}」${execution.status === 'failed' ? '失败' : '未完成'}后触发第 ${replanningCycles} 次重规划。`,
  ],
};
replanningHistory.push({
  cycle: replanningCycles,
  previousPlan,
  revisedPlan: nextPlan,
  executions: [...executions],
  failedStepIndex: stepIndex,
});
plannedPlan = nextPlan;
executions.length = 0;
```

Pass `replanningHistory` to `createPlannedAgentRun()` when non-empty.

- [ ] **Step 4: Verify recovered and multi-cycle behavior**

Run: `pnpm test -- electron/studioRuntime.test.ts -t "replan"`

Add to the existing multi-cycle test:

```ts
const revisions = response.agentRun.events.filter((event) => event.type === 'agent:plan-revised');
expect(revisions.map((event) => event.planRevision?.cycle)).toEqual([1, 2]);
expect(new Set(revisions.map((event) => event.stepId)).size).toBe(2);
expect(response.agentRun.events.filter((event) => event.type === 'agent:step-failed')).toHaveLength(2);
expect(response.agentRun.metrics?.replanningCycles).toBe(2);
expect(response.agentRun.status).toBe('passed');
```

Expected: all matching tests pass.

- [ ] **Step 5: Test final-failure precedence**

Add a second assembler test with historical `failureReason: '旧失败'` and final `failureReason: '最终失败'`:

```ts
expect(run.status).toBe('failed');
expect(run.failureReason).toBe('最终失败');
expect(run.events.some((event) => event.message.includes('旧失败'))).toBe(true);
```

Run: `pnpm test -- shared/agentStub.test.ts electron/studioRuntime.test.ts`

Expected: both files pass.

### Task 3: Run Records Linked Evidence

**Files:**
- Modify: `src/features/runs/RunRecordsPage.tsx:117-140,180-205,635-665`
- Modify: `src/features/runs/RunRecordsPage.test.tsx`

- [ ] **Step 1: Write the failing UI regression**

Extend the Agent run fixture with observation, verification, screenshot artifact, and revision events sharing `stepId: 'historical-step'`. Select the revision and assert that the existing evidence trail shows the linked details:

```ts
fireEvent.click(screen.getByRole('button', {
  name: 'Inspect evidence for agent:plan-revised',
}));
expect(screen.getByText('仍停留在起始页')).toBeInTheDocument();
expect(screen.getByText('Navigation failed: net::ERR_NAME_NOT_RESOLVED')).toBeInTheDocument();
expect(screen.getByText('https://example.test/start')).toBeInTheDocument();
expect(screen.getByRole('img', { name: 'Evidence screenshot preview' }))
  .toHaveAttribute('src', 'file:///tmp/navigation-failed.png');
```

Use the fixture's actual active-locale accessibility labels.

- [ ] **Step 2: Run the UI test and verify RED**

Run: `pnpm test -- src/features/runs/RunRecordsPage.test.tsx`

Expected: FAIL because the revision event has no direct observation, verification, or browser snapshot.

- [ ] **Step 3: Resolve events sharing the selected step ID**

Add:

```ts
function getLinkedEvidence(events: AgentRunEvent[], selected: AgentRunEvent) {
  const related = selected.stepId
    ? events.filter((event) => event.stepId === selected.stepId)
    : [selected];
  return {
    observation: selected.observation ?? related.find((event) => event.observation)?.observation,
    verification: selected.verification ?? related.find((event) => event.verification)?.verification,
    browserSession: selected.browserSession ?? related.find((event) => event.browserSession)?.browserSession,
  };
}
```

Use these linked values in the existing trail blocks and use `linkedEvidence.browserSession?.screenshotPath` before artifact fallback for the preview. Keep `getLinkedArtifacts()` path behavior unchanged.

- [ ] **Step 4: Run the UI test and verify GREEN**

Run: `pnpm test -- src/features/runs/RunRecordsPage.test.tsx`

Expected: PASS.

### Task 4: Reporter Serialization

**Files:**
- Modify: `electron/runtime/agent-reporter.test.ts:6-105`
- Modify: `electron/runtime/agent-reporter.ts:115-134`

- [ ] **Step 1: Write the failing Reporter assertion**

Insert a revision event into the successful Reporter test's run:

```ts
run.events.splice(1, 0, {
  id: `${run.runId}-event-plan-revised-1`,
  runId: run.runId,
  type: 'agent:plan-revised',
  message: '第 1 次重规划',
  status: 'neutral',
  stepId: 'historical-step',
  planRevision: {
    cycle: 1,
    previousPlanTitle: '旧计划',
    revisedPlanTitle: '新计划',
    triggerStepId: 'historical-step',
    triggerStepTitle: '进入工作台',
    triggerStatus: 'failed',
    failureCategory: 'navigation',
    recoveryStrategy: 'replanNavigation',
  },
  createdAt: '2026-07-27T00:00:00.000Z',
});
```

Parse the fetch request body and assert:

```ts
const reporterInput = JSON.parse(requestBody.messages[1].content);
expect(reporterInput.events).toEqual(expect.arrayContaining([
  expect.objectContaining({
    type: 'agent:plan-revised',
    planRevision: expect.objectContaining({ cycle: 1, recoveryStrategy: 'replanNavigation' }),
  }),
]));
```

- [ ] **Step 2: Run the Reporter test and verify RED**

Run: `pnpm test -- electron/runtime/agent-reporter.test.ts`

Expected: FAIL because the event projection omits `planRevision`.

- [ ] **Step 3: Serialize the structured payload**

Add `planRevision: event.planRevision` to the existing event projection:

```ts
events: request.run.events.map((event) => ({
  type: event.type,
  status: event.status,
  message: event.message,
  stepId: event.stepId,
  planRevision: event.planRevision,
  verification: event.verification,
  observation: event.observation,
  artifact: event.artifact,
})),
```

- [ ] **Step 4: Run the Reporter test and verify GREEN**

Run: `pnpm test -- electron/runtime/agent-reporter.test.ts`

Expected: PASS.

### Task 5: Documentation And Full Verification

**Files:**
- Modify: `docs/implementation-roadmap.md:24-38,224-230`
- Modify: `docs/agent-progress-and-target.md:311-340,618-628`

- [ ] **Step 1: Declare capability and regression scope**

Add these statements in the matching current-capability sections:

```md
- Planner 重规划会保留旧计划截至失败步骤的完整执行证据，并通过 `agent:plan-revised` 串联前后计划；恢复成功仍按最终计划结果保持 `passed`。
- 重规划历史覆盖动态等待、重试、selector fallback、观察、验证、浏览器状态、截图和报告产物；产物按路径跨轮次去重，Reporter 在失败/等待态运行中接收结构化重规划上下文。
```

Update next-step wording so evidence-history preservation is complete while real business-page validation remains pending.

- [ ] **Step 2: Run focused tests**

Run:

```bash
pnpm test -- shared/agentStub.test.ts electron/studioRuntime.test.ts electron/runtime/agent-reporter.test.ts src/features/runs/RunRecordsPage.test.tsx
```

Expected: all selected files pass.

- [ ] **Step 3: Run the full suite**

Run: `pnpm test`

Expected: all test files and tests pass.

- [ ] **Step 4: Run the production build**

Run: `pnpm build`

Expected: renderer and Electron builds pass; the existing Vite bundle-size warning may remain.

- [ ] **Step 5: Check patch integrity**

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 6: Review the final scope**

Run: `git status --short`, then review diffs for every file in the File Map. Existing uncommitted recording, visual-diff, browser-stability, and Run Records changes must remain intact. Do not stage or commit overlapping pre-existing changes automatically.
