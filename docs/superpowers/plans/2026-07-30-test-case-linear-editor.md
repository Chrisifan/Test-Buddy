# Test Case Linear Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three-column flow canvas with a focused two-pane editor that creates, orders, validates, and edits serial test steps while showing real persistence status.

**Architecture:** `shared/studio.ts` remains the sole owner of pure step transformations and validation. `App.tsx` remains the owner of selected project state and persistence lifecycle, exposing targeted callbacks and save status to the page. `TestCaseManagementPage.tsx` owns only interaction state, renders the toolbar/list/inspector/settings dialog, and never duplicates the selected test case.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, shadcn/Radix UI, Vitest, React Testing Library, Electron/localStorage persistence.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `shared/studio.ts` | Pure five-type step factory, serial list transformations, and run-blocking validation. |
| `shared/studio.test.ts` | Model-level coverage for creation, insertion, movement, copy, deletion, and validation. |
| `src/App.tsx` | Latest-write-wins persistence status and application-owned case/step callbacks. |
| `src/App.test.tsx` | Selection synchronization, persistence lifecycle, retry, and runtime guard tests. |
| `src/components/ui/dropdown-menu.tsx` | Local shadcn wrapper for the Radix dropdown-menu primitive. |
| `src/features/cases/TestCaseManagementPage.tsx` | Focused toolbar, serial list, current-step inspector, settings dialog, and delete confirmation. |
| `src/features/cases/TestCaseManagementPage.test.tsx` | Page behavior and accessible control coverage. |
| `src/i18n/index.ts` | Chinese and English labels for the new controls, status, validation, and confirmations. |
| `src/index.css` | Scoped two-pane layout, insertion affordance, drag state, and inspector styling. |
| `package.json`, `pnpm-lock.yaml` | Production dependency for `@radix-ui/react-dropdown-menu`. |

### Task 1: Add Pure Serial-Step Operations And Validation

**Files:**

- Modify: `shared/studio.ts:6-70,1450-1523`
- Modify: `shared/studio.test.ts`

- [ ] **Step 1: Write failing model tests for all serial operations and validation.**

  Add a focused fixture with three steps and the following expectations to `shared/studio.test.ts`:

  ```ts
  import {
    copyTestStep,
    createTestStep,
    getTestCaseRunBlocker,
    insertTestStep,
    moveTestStep,
    removeTestStep,
  } from './studio.js';

  it('inserts, moves, copies, and removes serial test steps without mutating the input', () => {
    const original = createEmptyTestCase(1, 'group-1', 'env-1');
    const inserted = insertTestStep(original.steps, { id: 'step-inserted', type: 'manual', title: 'Check', body: 'Confirm manually.' }, 1);
    const moved = moveTestStep(inserted, 'step-inserted', 0);
    const copied = copyTestStep(moved, 'step-inserted', 'step-copy');

    expect(original.steps).not.toBe(inserted);
    expect(moved[0].id).toBe('step-inserted');
    expect(copied.slice(0, 2).map((step) => step.id)).toEqual(['step-inserted', 'step-copy']);
    expect(removeTestStep(copied, 'step-inserted').some((step) => step.id === 'step-inserted')).toBe(false);
  });

  it('returns a run blocker for blank instructions and unbound replay steps', () => {
    expect(getTestCaseRunBlocker({ ...createEmptyTestCase(1, 'group-1', 'env-1'), steps: [] }, [])).toBe('emptySteps');
    expect(getTestCaseRunBlocker({ ...createEmptyTestCase(1, 'group-1', 'env-1'), steps: [{ id: 'blank', type: 'ai', title: 'Action', body: '  ' }] }, [])).toBe('emptyInstruction');
    expect(getTestCaseRunBlocker({ ...createEmptyTestCase(1, 'group-1', 'env-1'), steps: [{ id: 'replay', type: 'recordingReplay', title: 'Replay', body: '', recordingId: 'missing' }] }, [])).toBe('missingRecording');
  });
  ```

- [ ] **Step 2: Run the focused model tests and confirm they fail because the new exports do not exist.**

  Run:

  ```bash
  pnpm test -- shared/studio.test.ts
  ```

  Expected: TypeScript or Vitest reports missing `createTestStep`, `insertTestStep`, `moveTestStep`, `copyTestStep`, `removeTestStep`, or `getTestCaseRunBlocker` exports.

- [ ] **Step 3: Implement immutable step helpers beside `createStep()` in `shared/studio.ts`.**

  Add the shared type and helpers below. Keep `createStep()` intact for workflow callers; `createTestStep()` extends it for the two test-case-only types.

  ```ts
  export type TestCaseRunBlocker = 'emptySteps' | 'emptyTitle' | 'emptyInstruction' | 'missingRecording';

  export function createTestStep(
    type: TestStepType,
    seed: number,
    recording?: Pick<RecordingAsset, 'id' | 'name' | 'steps'>,
  ): TestStepDraft {
    if (type === 'ai' || type === 'aiAssert' || type === 'aiQuery') {
      return createStep(type, seed);
    }

    return {
      id: `step-${Date.now()}-${seed}`,
      type,
      title: type === 'recordingReplay' ? '录制回放步骤' : '人工检查步骤',
      body: type === 'recordingReplay'
        ? recording
          ? `回放录制资产「${recording.name}」，共 ${recording.steps.length} 个节点。`
          : '选择一段录制资产并按顺序回放。'
        : '记录需要人工确认的状态。',
      ...(type === 'recordingReplay' && recording ? { recordingId: recording.id } : {}),
    };
  }

  export function insertTestStep(steps: TestStepDraft[], step: TestStepDraft, index: number): TestStepDraft[] {
    const insertionIndex = Math.max(0, Math.min(index, steps.length));
    return [...steps.slice(0, insertionIndex), step, ...steps.slice(insertionIndex)];
  }

  export function moveTestStep(steps: TestStepDraft[], stepId: string, index: number): TestStepDraft[] {
    const sourceIndex = steps.findIndex((step) => step.id === stepId);
    if (sourceIndex < 0) return steps;
    const nextSteps = [...steps];
    const [step] = nextSteps.splice(sourceIndex, 1);
    const requestedIndex = Math.max(0, Math.min(index, steps.length));
    const insertionIndex = sourceIndex < requestedIndex ? requestedIndex - 1 : requestedIndex;
    nextSteps.splice(insertionIndex, 0, step);
    return nextSteps;
  }

  export function copyTestStep(steps: TestStepDraft[], stepId: string, copyId: string): TestStepDraft[] {
    const sourceIndex = steps.findIndex((step) => step.id === stepId);
    if (sourceIndex < 0) return steps;
    const copy = { ...steps[sourceIndex], id: copyId };
    return insertTestStep(steps, copy, sourceIndex + 1);
  }

  export function removeTestStep(steps: TestStepDraft[], stepId: string): TestStepDraft[] {
    return steps.filter((step) => step.id !== stepId);
  }

  export function getTestCaseRunBlocker(
    testCase: TestCaseDraft,
    recordings: RecordingAsset[],
  ): TestCaseRunBlocker | undefined {
    if (!testCase.steps.length) return 'emptySteps';
    for (const step of testCase.steps) {
      if (!step.title.trim()) return 'emptyTitle';
      if (step.type === 'recordingReplay') {
        if (!step.recordingId || !recordings.some((recording) => recording.id === step.recordingId)) return 'missingRecording';
      } else if (!step.body.trim()) {
        return 'emptyInstruction';
      }
    }
    return undefined;
  }
  ```

- [ ] **Step 4: Expand tests for the remaining edge cases and verify the helper suite passes.**

  Add assertions for index clamping, moving a step forward and backward by insertion index, invalid move/copy/delete IDs, blank title, each valid five-type step, and a recording ID present in the passed `RecordingAsset[]`. Then run:

  ```bash
  pnpm test -- shared/studio.test.ts
  ```

  Expected: PASS.

- [ ] **Step 5: Commit the model layer.**

  ```bash
  git add shared/studio.ts shared/studio.test.ts
  git commit -m "feat: add serial test step operations"
  ```

### Task 2: Make App-Owned Case Actions And Persistence Observable

**Files:**

- Modify: `src/App.tsx:1-295,440-473,1300-1331,1600-1638,1812-1840`
- Modify: `src/App.test.tsx`

- [ ] **Step 1: Add failing application tests for cross-group selection and latest-write-wins persistence.**

  Mock `saveStudioState` before importing `App`, render a hydrated workspace, select a case in another group, and assert that the next saved `StudioState` contains both IDs. Use deferred promises to prove that an earlier rejected save cannot replace a later successful status.

  ```ts
  const saveStudioState = vi.fn<() => Promise<void>>();
  vi.mock('./lib/persistence', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./lib/persistence.js')>()),
    saveStudioState,
  }));

  it('keeps the newest persistence result when save promises resolve out of order', async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    saveStudioState.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    render(<App />);
    // Enter the workbench, make two case changes, then settle second before first.
    second.resolve();
    await screen.findByText('已保存');
    first.reject(new Error('stale write failed'));
    expect(screen.queryByText('保存失败')).not.toBeInTheDocument();
  });
  ```

- [ ] **Step 2: Run the focused application test and confirm it fails.**

  Run:

  ```bash
  pnpm test -- src/App.test.tsx
  ```

  Expected: FAIL because the page has no save-status output and `App` has no latest-write-wins save lifecycle.

- [ ] **Step 3: Add the save lifecycle in `App.tsx`.**

  Define `SaveStatus` and the timer/version refs beside existing refs. Replace the `void saveStudioState(payload)` call with a function that always persists the latest complete `StudioState` and ignores stale completions.

  ```ts
  type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
  type SaveMode = 'debounced' | 'immediate';

  const SAVE_DEBOUNCE_MS = 350;
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const latestStudioStateRef = useRef<StudioState | undefined>(undefined);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveVersionRef = useRef(0);
  const nextSaveModeRef = useRef<SaveMode>('debounced');

  function persistLatestStudioState(mode: SaveMode) {
    if (!latestStudioStateRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const version = ++saveVersionRef.current;
    const save = async () => {
      setSaveStatus('saving');
      try {
        await saveStudioState(latestStudioStateRef.current!);
        if (version !== saveVersionRef.current) return;
        setSaveStatus('saved');
        if (clearSavedTimerRef.current) clearTimeout(clearSavedTimerRef.current);
        clearSavedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 1600);
      } catch {
        if (version === saveVersionRef.current) setSaveStatus('error');
      }
    };
    if (mode === 'immediate') void save();
    else saveTimerRef.current = setTimeout(() => void save(), SAVE_DEBOUNCE_MS);
  }
  ```

  In the existing `StudioState` effect, set `latestStudioStateRef.current = payload`, read and reset `nextSaveModeRef.current`, and call `persistLatestStudioState(mode)`. On unmount clear both timers. Expose `onRetrySave={() => persistLatestStudioState('immediate')}`.

- [ ] **Step 4: Replace page-specific inline callbacks with named case actions.**

  Import the helpers from Task 1 and add handlers that operate only on the current selected case. The selection handler must update both group and case IDs; every structural mutation uses immediate persistence.

  ```ts
  function handleSelectTestCase(testCaseId: string) {
    const testCase = selectedProject?.testCases.find((item) => item.id === testCaseId);
    if (!testCase) return;
    setSelectedGroupId(testCase.groupId);
    setSelectedTestCaseId(testCase.id);
  }

  function handleCreateStep(type: TestStepDraft['type'], index: number): string | undefined {
    if (!selectedProject || !selectedTestCase) return undefined;
    const recording = type === 'recordingReplay'
      ? findDefaultRecordingForCaseStep(selectedProject.recordings, selectedTestCase.groupId, selectedTestCase.environmentId)
      : undefined;
    const step = createTestStep(type, selectedTestCase.steps.length + 1, recording);
    updateSelectedTestCase((testCase) => ({ ...testCase, steps: insertTestStep(testCase.steps, step, index) }), 'immediate');
    return step.id;
  }

  function handleMoveStep(stepId: string, index: number) {
    updateSelectedTestCase((testCase) => ({ ...testCase, steps: moveTestStep(testCase.steps, stepId, index) }), 'immediate');
  }

  function handleCopyStep(stepId: string): string | undefined {
    if (!selectedTestCase?.steps.some((step) => step.id === stepId)) return undefined;
    const copyId = `step-${Date.now()}-${selectedTestCase.steps.length + 1}`;
    updateSelectedTestCase((testCase) => ({ ...testCase, steps: copyTestStep(testCase.steps, stepId, copyId) }), 'immediate');
    return copyId;
  }
  ```

  Extend `updateSelectedProject` and `updateSelectedTestCase` with an optional `SaveMode` argument that assigns `nextSaveModeRef.current` before their state setter. Add copy, delete, and case-settings update handlers in the same style. Before dispatching `runTestCase`, return early if `getTestCaseRunBlocker(selectedTestCase, selectedProject.recordings)` is truthy.

- [ ] **Step 5: Wire the new props into `TestCaseManagementPage` and verify App behavior.**

  Pass `onCreateStep`, `onMoveStep`, `onCopyStep`, `onDeleteStep`, `onSelectTestCase={handleSelectTestCase}`, `onRetrySave`, `saveStatus`, and the current run blocker. Remove the obsolete browser-session props from this page only; the recording and natural-language pages retain their browser session integration.

  Run:

  ```bash
  pnpm test -- src/App.test.tsx
  ```

  Expected: PASS, including stale-save, retry, cross-group selection, and invalid-run guard coverage.

- [ ] **Step 6: Commit the state and persistence boundary.**

  ```bash
  git add src/App.tsx src/App.test.tsx
  git commit -m "feat: expose case editor save lifecycle"
  ```

### Task 3: Add Menu Primitive And Localized Editor Vocabulary

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `src/components/ui/dropdown-menu.tsx`
- Modify: `src/i18n/index.ts:687-754,1410-1477`

- [ ] **Step 1: Install the Radix dropdown-menu production dependency.**

  Run:

  ```bash
  pnpm add @radix-ui/react-dropdown-menu
  ```

  Expected: `package.json` lists the dependency and `pnpm-lock.yaml` records its resolved package graph.

- [ ] **Step 2: Create the local shadcn-style wrapper.**

  Add `src/components/ui/dropdown-menu.tsx` with the repository's `cn()` convention and only the primitives this editor consumes.

  ```tsx
  import * as React from 'react';
  import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
  import { cn } from '@/lib/utils';

  const DropdownMenu = DropdownMenuPrimitive.Root;
  const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
  const DropdownMenuGroup = DropdownMenuPrimitive.Group;
  const DropdownMenuPortal = DropdownMenuPrimitive.Portal;

  function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
    return <DropdownMenuPrimitive.Label className={cn('px-2 py-1.5 text-xs font-semibold text-muted-foreground', className)} {...props} />;
  }

  function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
    return <DropdownMenuPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
  }

  function DropdownMenuContent({ className, sideOffset = 4, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
    return <DropdownMenuPrimitive.Portal><DropdownMenuPrimitive.Content sideOffset={sideOffset} className={cn('z-50 min-w-44 overflow-hidden rounded-[6px] border border-border bg-popover p-1 text-popover-foreground shadow-md', className)} {...props} /></DropdownMenuPrimitive.Portal>;
  }

  function DropdownMenuItem({ className, inset, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & { inset?: boolean }) {
    return <DropdownMenuPrimitive.Item className={cn('flex cursor-default select-none items-center gap-2 rounded-[4px] px-2 py-1.5 text-sm outline-none focus:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50', inset && 'pl-8', className)} {...props} />;
  }

  export { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuPortal, DropdownMenuSeparator, DropdownMenuTrigger };
  ```

  Do not import unused icon primitives; the wrapper should remain narrow and consistent with existing `dialog.tsx` and `select.tsx` wrappers.

- [ ] **Step 3: Add every editor string in both locale maps.**

  Add matching Chinese and English keys for `cases.action.settings`, `cases.action.addStep`, `cases.action.retrySave`, `cases.save.saving`, `cases.save.saved`, `cases.save.failed`, `cases.menu.insert`, `cases.menu.moveUp`, `cases.menu.moveDown`, `cases.menu.copy`, `cases.confirm.deleteTitle`, `cases.confirm.deleteDescription`, `cases.confirm.deleteAction`, `cases.empty.noStepsTitle`, `cases.empty.noStepsDescription`, `cases.validation.emptySteps`, `cases.validation.emptyTitle`, `cases.validation.emptyInstruction`, `cases.validation.missingRecording`, `cases.status.source`, `cases.source.manual`, `cases.source.naturalLanguage`, `cases.source.recording`, `cases.source.prd`, `cases.aria.insertBefore`, and `cases.aria.dragStep`.

  Use these concrete Chinese values:

  ```ts
  'cases.action.settings': '用例设置',
  'cases.action.addStep': '添加步骤',
  'cases.save.saving': '保存中',
  'cases.save.saved': '已保存',
  'cases.save.failed': '保存失败',
  'cases.menu.insert': '在此插入',
  'cases.menu.moveUp': '上移',
  'cases.menu.moveDown': '下移',
  'cases.menu.copy': '复制',
  'cases.confirm.deleteTitle': '删除测试步骤？',
  'cases.confirm.deleteDescription': '删除后该步骤无法恢复。',
  ```

  Add direct English equivalents in the `en-US` map; do not reuse Chinese persisted default step content as interface labels.

- [ ] **Step 4: Verify compilation after adding the dependency and locale keys.**

  Run:

  ```bash
  pnpm build:renderer
  ```

  Expected: PASS with no unresolved dropdown-menu module or i18n-key TypeScript errors.

- [ ] **Step 5: Commit the UI foundation.**

  ```bash
  git add package.json pnpm-lock.yaml src/components/ui/dropdown-menu.tsx src/i18n/index.ts
  git commit -m "feat: add case editor menus and labels"
  ```

### Task 4: Replace The Flow Canvas With The Focused Two-Pane Editor

**Files:**

- Modify: `src/features/cases/TestCaseManagementPage.tsx`
- Modify: `src/features/cases/TestCaseManagementPage.test.tsx`

- [ ] **Step 1: Replace existing canvas expectations with failing focused-editor tests.**

  Remove assertions for the left-side search, start/end terminals, and canvas node dropping. Add a stateful test wrapper that applies callback updates to a local test case and asserts the new contract.

  ```tsx
  it('selects the first step, appends a selected step, and focuses its title', async () => {
    render(<CasePageHarness initialCase={selectedTestCase} />);

    expect(screen.getByRole('button', { name: `步骤 1：${selectedTestCase.steps[0].title}` })).toHaveAttribute('data-selected', 'true');
    fireEvent.click(screen.getByRole('button', { name: '添加步骤' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '动作' }));

    const title = await screen.findByLabelText('步骤标题');
    expect(title).toHaveFocus();
  });

  it('uses the drag handle to move a step and exposes bounded menu actions', () => {
    render(<CasePageHarness initialCase={selectedTestCase} />);

    expect(screen.getByRole('button', { name: '上移' })).toBeDisabled();
    fireEvent.dragStart(screen.getByRole('button', { name: `拖拽步骤：${selectedTestCase.steps[1].title}` }));
    fireEvent.drop(screen.getByRole('button', { name: '在第 1 步前插入' }));
    expect(screen.getAllByRole('button', { name: /步骤 \d+：/ })[0]).toHaveTextContent(selectedTestCase.steps[1].title);
  });
  ```

- [ ] **Step 2: Run the focused page tests and confirm they fail against the old canvas.**

  Run:

  ```bash
  pnpm test -- src/features/cases/TestCaseManagementPage.test.tsx
  ```

  Expected: FAIL because the old page renders a left tree, terminals, five icon-only add buttons, and an inspector that mixes case configuration with step editing.

- [ ] **Step 3: Replace page props and the top-level layout.**

  Remove `BrowserSessionState`, `ProjectGroup`, browser-session callbacks, and `onAppendStep` from this page's props. Accept only project, selected case, run state, save state, validation state, and targeted case actions.

  ```tsx
  type TestCaseManagementPageProps = {
    project?: ProjectDraft;
    selectedTestCase?: TestCaseDraft;
    selectedTestCaseId: string;
    isRunning: boolean;
    runStatus: RunTone;
    saveStatus: 'idle' | 'saving' | 'saved' | 'error';
    runBlocker?: TestCaseRunBlocker;
    onSelectTestCase: (testCaseId: string) => void;
    onCreateTestCase: () => void;
    onCreateStep: (type: TestStepDraft['type'], index: number) => string | undefined;
    onMoveStep: (stepId: string, index: number) => void;
    onCopyStep: (stepId: string) => string | undefined;
    onDeleteStep: (stepId: string) => void;
    onRetrySave: () => void;
    onRunTestCase: () => void;
    onUpdateTestCase: (updater: (testCase: TestCaseDraft) => TestCaseDraft, mode?: 'debounced' | 'immediate') => void;
  };
  ```

  Render `PageHeader` with a grouped case selector, source/run/save Tags, settings button, add-step menu, and run button. When `saveStatus === 'error'`, keep the failure Tag non-interactive and show a separate retry icon button with an accessible label and tooltip that invokes `onRetrySave`; all other save state indicators remain non-button Tags. Use `DropdownMenuLabel` and `DropdownMenuSeparator` to group selectable cases by their project group. When no project is selected, preserve the existing no-project `EvidenceCard`. When a project has no case, show a single create-case empty state.

- [ ] **Step 4: Implement selection, creation, insertion, and handle-only dragging.**

  Keep `selectedStepId`, `draggedStepId`, `deleteStepId`, `isSettingsOpen`, and `focusStepId` as local state. Use the following selection effect so a case always opens on its first available step and a deleted selection resolves safely.

  ```tsx
  useEffect(() => {
    const steps = selectedTestCase?.steps ?? [];
    if (!steps.length) {
      setSelectedStepId(undefined);
      return;
    }
    setSelectedStepId((current) => steps.some((step) => step.id === current) ? current : steps[0].id);
  }, [selectedTestCase?.id, selectedTestCase?.steps]);
  ```

  Make each insertion zone a button with `aria-label={t('cases.aria.insertBefore', { index: index + 1 })}`. The top button uses `index = selectedTestCase.steps.length`; every menu item calls `onCreateStep(type, insertionIndex)`, stores its returned ID in both `selectedStepId` and `focusStepId`, and scrolls the row into view. Only the `GripVertical` button receives `draggable`, `onDragStart`, and `onDragEnd`; list rows never receive `draggable`.

- [ ] **Step 5: Implement row menu, step inspector, settings dialog, and delete confirmation.**

  `SerialStepRow` must render a dropdown menu with immediate `onMoveStep` calls, a `onCopyStep` call that selects and focuses the duplicate, and a delete entry that sets `deleteStepId`. Disable up/down at list boundaries.

  `StepInspector` keeps title, type, instruction, and recording binding. It calls `onUpdateTestCase(..., 'debounced')` for title/body input and `onUpdateTestCase(..., 'immediate')` for type and recording selection. Pass a `titleInputRef` and focus it whenever `focusStepId === step.id`, then clear `focusStepId`.

  `CaseSettingsDialog` uses the existing `Dialog` primitives and contains name, URL, group, environment, and notes. Changing group uses `onUpdateTestCase(..., 'immediate')`; other text fields use debounced saves. The controlled delete `Dialog` has cancel and destructive confirm actions; confirming removes the step and selects the original next index, otherwise the preceding index.

- [ ] **Step 6: Add assertions for every confirmed interaction and verify the page suite.**

  Cover default selection after case switch, five add types, append versus insertion index, focus after create/copy, current-step-only inspector, settings fields, replay binding warning, drag cancellation, drag-to-insertion ordering, bounded up/down menu items, delete cancel/confirm selection, empty state, save retry, invalid-run disabling, and English labels.

  Run:

  ```bash
  pnpm test -- src/features/cases/TestCaseManagementPage.test.tsx
  ```

  Expected: PASS.

- [ ] **Step 7: Commit the editor behavior.**

  ```bash
  git add src/features/cases/TestCaseManagementPage.tsx src/features/cases/TestCaseManagementPage.test.tsx
  git commit -m "feat: rebuild test case serial editor"
  ```

### Task 5: Scope Styles To The New Editor And Run End-To-End Regression Checks

**Files:**

- Modify: `src/index.css:1484-1738,2273-2365`
- Modify: `src/features/cases/TestCaseManagementPage.test.tsx` only if a visual-state selector needs an accessible assertion

- [ ] **Step 1: Remove canvas-specific styling and add scoped two-pane layout rules.**

  Delete rules for `.case-workbench > .designer-panel:first-child`, `.case-canvas-scroll` grid backgrounds, `.case-flow-terminal`, `.case-flow-line`, `.case-flow-node*`, and `.case-browser-session`. Replace them with a two-column grid and unframed list styling.

  ```css
  .case-workbench {
    display: grid;
    min-height: 0;
    grid-template-columns: minmax(0, 1fr) minmax(20rem, 22.5rem);
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--card);
  }

  .case-step-list {
    min-width: 0;
    overflow-y: auto;
    padding: 0.75rem 1.25rem 0.75rem 1rem;
  }

  .case-step-row[data-selected='true'] {
    border-color: color-mix(in oklch, var(--primary) 60%, var(--border));
    box-shadow: inset 3px 0 var(--primary);
  }

  .case-insertion-zone {
    height: 0.5rem;
    width: 100%;
    opacity: 0;
  }

  .case-insertion-zone:hover,
  .case-insertion-zone[data-drop-target='true'] {
    height: 2rem;
    opacity: 1;
  }
  ```

  The styles must use current color tokens, never hard-code a background color, and keep rounded corners at 6px or less for the work surface.

- [ ] **Step 2: Run the focused suites, entire suite, and production build.**

  Run:

  ```bash
  pnpm test -- shared/studio.test.ts src/App.test.tsx src/features/cases/TestCaseManagementPage.test.tsx
  pnpm test
  pnpm build
  git diff --check
  ```

  Expected: every command exits with status 0.

- [ ] **Step 3: Perform desktop visual regression at the actual minimum size.**

  Start the desktop app and verify at 1200x760 in light and dark theme, then repeat the core check in English:

  ```bash
  pnpm dev
  ```

  Verify that the left case tree, grid background, terminals, and browser-session drawer are gone; the list and inspector scroll independently; the central list does not sit under its scrollbar; Tags are not styled as buttons; long labels truncate without overlap; the title input gains focus after creation; delete confirmation and settings dialog trap focus; and every menu action remains reachable.

- [ ] **Step 4: Commit the layout and verification changes.**

  ```bash
  git add src/index.css src/features/cases/TestCaseManagementPage.test.tsx
  git commit -m "style: polish serial case editor layout"
  ```

## Final Verification Checklist

- [ ] `TestCaseDraft.steps` remains the only step-order source and existing persisted test cases load without migration.
- [ ] The toolbar selects all project cases by group and synchronizes application group selection.
- [ ] All five step types can be appended or inserted at any valid list position.
- [ ] Create and copy select the new step and focus the title field.
- [ ] Dragging begins only from the handle and runs use the resulting list order.
- [ ] The right panel contains only the current step; case fields live in the settings dialog.
- [ ] A failed persistence request preserves local edits and exposes retry; stale failures cannot replace a newer success.
- [ ] Empty or invalid steps visibly explain why the run action is disabled.
- [ ] Light/dark and Chinese/English views remain readable at 1200x760.
