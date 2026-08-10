# Regression Case V2 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve reviewed, structured browser actions from a passed natural-language Agent Run without breaking legacy cases or switching the current runtime path.

**Architecture:** Extend the existing `TestStepDraft` with an optional, versioned execution draft while keeping `type/title/body` as the compatibility surface. Conversion and hydration remain pure shared-layer functions; model requirements are derived from current step structure instead of persisted. Deterministic runtime consumption is deliberately deferred until the editor can confirm V2 steps and BrowserRuntime can prove a real Playwright action occurred.

**Tech Stack:** TypeScript, Vitest, existing `shared/studio.ts` domain helpers, pnpm quality scripts.

---

### Task 1: Lock The V2 Conversion Contract

**Files:**
- Modify: `shared/studio.test.ts`
- Modify: `shared/studio.ts`

- [x] **Step 1: Extend the passed Agent Run test with structured expectations**

Add expectations to the existing `creates an editable natural-language test case from a passed Agent plan` test:

```ts
expect(testCase?.sourceIntent).toBe('使用测试账号提交订单并读取订单编号');
expect(testCase?.steps[0]?.execution).toMatchObject({
  schemaVersion: 2,
  intent: '进入订单页',
  reviewStatus: 'needsReview',
  actionRisk: 'low',
  action: { kind: 'navigate', url: 'https://app.example.test/orders' },
  provenance: { source: 'agentRun', runId: agentRun.runId },
});
expect(testCase?.steps[1]?.execution?.action).toBeUndefined();
expect(testCase?.steps[1]?.body).toBe('在 #email 中输入待确认的值');
expect(testCase?.steps[2]?.execution).toMatchObject({ actionRisk: 'high' });
```

- [x] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run shared/studio.test.ts -t "creates an editable natural-language test case"`

Expected: FAIL because `sourceIntent` and `execution` are absent.

- [x] **Step 3: Add the V2 shared types and minimal converter**

Add these public types next to `TestStepDraft` in `shared/studio.ts`:

```ts
export type TestStepReviewStatus = 'needsReview' | 'confirmed';
export type TestStepActionRisk = 'low' | 'medium' | 'high' | 'unknown';
export type TestStepModelRequirement = 'none' | 'required' | 'notApplicable';
export type TestLocatorQuality = 'acceptable' | 'fragile' | 'unknown';

export interface TestLocatorFingerprint {
  selector: string;
  role?: string;
  name?: string;
  scope?: string;
  publicAttributes?: Record<string, string>;
  quality: TestLocatorQuality;
}

export type DeterministicTestAction =
  | { kind: 'navigate'; url: string }
  | { kind: 'click'; locator: TestLocatorFingerprint }
  | { kind: 'input'; locator: TestLocatorFingerprint; value: string }
  | { kind: 'select'; locator: TestLocatorFingerprint; value: string }
  | { kind: 'waitForSelector'; locator: TestLocatorFingerprint; timeoutMs?: number }
  | { kind: 'waitForTimeout'; timeoutMs: number }
  | { kind: 'scrollTo'; locator: TestLocatorFingerprint };
```

Add `TestStepExecutionDraft`, `execution?: TestStepExecutionDraft`, and `sourceIntent?: string`. Implement pure helpers beside `createTestCaseFromAgentRun()`:

```ts
function toDeterministicTestAction(step: AgentStep): DeterministicTestAction | undefined;
function inferTestStepActionRisk(step: AgentStep): TestStepActionRisk;
function createTestStepFromAgentStep(step: AgentStep, id: string): TestStepDraft;
```

The converter must use structured Agent fields only. It must not parse `body` to recover missing action fields. Agent Run `input/select` values must not be persisted or converted to actions; a later editor step must explicitly bind a public variable, fixture output, or credential reference.

- [x] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm exec vitest run shared/studio.test.ts -t "creates an editable natural-language test case"`

Expected: PASS with one matching test and no failures.

### Task 2: Derive Model Requirements Without Persisted Flags

**Files:**
- Modify: `shared/studio.test.ts`
- Modify: `shared/studio.ts`

- [x] **Step 1: Add failing model-boundary tests**

Add focused tests that construct steps directly:

```ts
expect(getTestStepModelRequirement({
  id: 'navigate', type: 'ai', title: '打开', body: '打开页面',
  execution: {
    schemaVersion: 2,
    intent: '打开订单页',
    reviewStatus: 'confirmed',
    actionRisk: 'low',
    action: { kind: 'navigate', url: 'https://example.test/orders' },
  },
})).toBe('none');

expect(getTestStepModelRequirement({
  id: 'semantic', type: 'aiAssert', title: '检查', body: '订单已创建',
})).toBe('required');

expect(getTestStepModelRequirement({
  id: 'manual', type: 'manual', title: '人工检查', body: '确认视觉状态',
})).toBe('notApplicable');
```

Also create a passed Agent Run containing a target-only click or an input without a selector and assert that no deterministic action is generated.

- [x] **Step 2: Run the focused tests and verify RED**

Run: `pnpm exec vitest run shared/studio.test.ts -t "model requirement|incomplete Agent actions"`

Expected: FAIL because `getTestStepModelRequirement` does not exist and incomplete action behavior is not locked.

- [x] **Step 3: Implement the pure derivation helper**

Export this function from `shared/studio.ts`:

```ts
export function getTestStepModelRequirement(step: TestStepDraft): TestStepModelRequirement {
  if (step.type === 'manual' || step.type === 'recordingReplay') return 'notApplicable';
  if (step.type === 'ai' && step.execution?.action) return 'none';
  if (step.type === 'aiAssert' && step.execution?.assertion) return 'none';
  return 'required';
}
```

Do not persist the result and do not treat legacy `expected` text as an explicit assertion.

- [x] **Step 4: Run the focused tests and verify GREEN**

Run: `pnpm exec vitest run shared/studio.test.ts -t "model requirement|incomplete Agent actions"`

Expected: all selected tests PASS.

### Task 3: Normalize Persisted V2 Data Safely

**Files:**
- Modify: `shared/studio.test.ts`
- Modify: `shared/studio.ts`

- [x] **Step 1: Add old-state and malformed-V2 hydration tests**

Create one legacy case with no `execution` and assert its hydrated steps equal the input. Create another case with one valid V2 navigate action and one malformed action such as `{ kind: 'navigate', url: '' }`; assert the valid draft survives while the malformed `execution` is removed and the legacy body remains.

```ts
expect(hydratedLegacy.projects[0]?.testCases[0]?.steps).toEqual(legacySteps);
expect(hydratedV2.projects[0]?.testCases[0]?.steps[0]?.execution?.action).toEqual({
  kind: 'navigate',
  url: 'https://example.test/orders',
});
expect(hydratedV2.projects[0]?.testCases[0]?.steps[1]).toMatchObject({
  body: '保留旧文本',
  execution: undefined,
});
```

- [x] **Step 2: Run hydration tests and verify RED**

Run: `pnpm exec vitest run shared/studio.test.ts -t "V2 execution drafts|legacy test steps"`

Expected: FAIL because persisted execution is not validated.

- [x] **Step 3: Add narrow normalizers**

Add pure helpers before `normalizeProjectDraft()`:

```ts
function normalizeTestLocatorFingerprint(value: unknown): TestLocatorFingerprint | undefined;
function normalizeDeterministicTestAction(value: unknown): DeterministicTestAction | undefined;
function normalizeExplicitTestAssertion(value: unknown): ExplicitTestAssertion | undefined;
function normalizeTestStepExecution(value: unknown): TestStepExecutionDraft | undefined;
function normalizeTestStepDraft(step: TestStepDraft): TestStepDraft;
```

Change project hydration to `testCase.steps.map(normalizeTestStepDraft)`. A bad V2 field must be discarded locally; it must never remove the surrounding legacy step or project.

- [x] **Step 4: Run hydration tests and verify GREEN**

Run: `pnpm exec vitest run shared/studio.test.ts -t "V2 execution drafts|legacy test steps"`

Expected: all selected tests PASS.

### Task 4: Verify Compatibility And Record The Next Runtime Slice

**Files:**
- Modify: `docs/implementation-roadmap.md`
- Modify: `docs/agent-progress-and-target.md`
- Verify: `shared/studio.test.ts`
- Verify: repository quality gates

- [x] **Step 1: Run the complete shared studio test file**

Run: `pnpm exec vitest run shared/studio.test.ts`

Expected: all tests in `shared/studio.test.ts` PASS.

- [x] **Step 2: Run the full offline quality gate**

Run: `pnpm check`

Expected: Vitest has zero failures, `tsc --noEmit` exits 0, renderer and Electron builds exit 0, and `git diff --check` reports no whitespace errors.

- [x] **Step 3: Update progress markers using verified evidence**

Mark only the V2 foundation as implemented and offline-verified. Keep deterministic runtime execution, V2 editor confirmation, project directory migration, fixtures/auth, Suite Runner, reusable flows, maintenance/security, complex Web interactions and real business acceptance as planned.

- [x] **Step 4: Review the implementation boundary**

Confirm from the diff that this slice does not:

- launch the desktop app or a business page;
- call Planner, Verifier, Reporter, Midscene, or any model;
- parse legacy free text into browser actions;
- change the current runtime route;
- create Suite, fixture, credential, project-directory, Git, account, RBAC, cloud, or CI-hosting features.

**Completed security regression:** every Agent Run `input/select` value is removed from `sourceIntent`, case text and V2 execution. The persisted step remains review-required and cannot replay a placeholder as user input; this prevents password, token, OTP and unknown field aliases from depending on heuristic detection.
