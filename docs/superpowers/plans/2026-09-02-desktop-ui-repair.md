# Desktop UI Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore visibility of desktop controls, make zero-data and browser states truthful, and simplify the Workbench hierarchy without changing model-key, project, test, or runtime behavior.

**Architecture:** Repair layout ownership before redesigning individual pages. App Shell, modal shell, and each Workbench own one scroll boundary; pages consume shared RunState, empty-state, disabled-button, and Surface contracts instead of re-creating visual semantics. Keep Product Surfaces separate from Target-page Mocks and Code Logs as defined in [CONTEXT.md](../../../CONTEXT.md).

**Tech Stack:** Electron, React, TypeScript, Tailwind utilities, CSS custom properties, shadcn-style components, Vitest, Testing Library, Playwright/Computer Use visual verification.

---

## Delivery order

| Changeset | Scope | Why it is independent | Required gate |
| --- | --- | --- | --- |
| 1. P0 visibility hotfix | Natural Language composer and Settings scrolling | Restores inaccessible primary operations without visual redesign | `1200 x 760` real desktop verification |
| 2. Truthful state pass | Overview score, zero-run health, idle recording stage | Prevents a false quality or runtime claim | Focused feature tests plus visual zero-data checks |
| 3. Workbench hierarchy pass | Empty states, Workflow, project configuration, disabled actions | Establishes an operational first-use path | All zero-asset pages present exactly one primary next action |
| 4. Shared style consolidation | Tokens, Surface roles, typography, duplicate CSS ownership | Removes the mechanism creating cross-page layout regressions | Full test suite, CSS selector inventory, light/dark inspection |
| 5. Acceptance | Visual matrix, keyboard navigation, reduced motion | Verifies the result in the actual desktop context | All automated and manual gates pass |

No task may alter `saveModelSecret`, Electron IPC, credential persistence, project-asset storage, or execution logic. Changing visible text is permitted only when it reflects existing state truthfully.

## Task 1: Establish the visual baseline

**Files:**

- Create: `docs/ui-audits/2026-09-02-desktop-ui-baseline.md`
- Test: `pnpm lint`; `pnpm test`

- [ ] Record four non-mutating states at `1200 x 760`: Natural Language standby, Settings MidScene at its bottom, zero-sample Run records, and Recording browser `idle`.
- [ ] For each state, record page, theme, viewport, expected primary action, actual visibility, and screenshot path.
- [ ] Add the following exact pass predicates to the baseline document:

```text
Natural Language: textarea, send, and save-as-step controls are simultaneously visible.
Settings: the last form control can scroll above the footer by at least 16px.
Run records: zero samples has no passed color, passed label, or non-zero rate.
Recording: idle has no “browser ready”, fabricated interaction count, or recording-in-progress badge.
```

- [ ] Run `pnpm lint` and `pnpm test`; document any pre-existing failure instead of mixing it into UI work.
- [ ] Commit only the baseline: `docs: record desktop UI repair baseline`.

## Task 2: Ship the P0 geometry hotfix

**Files:**

- Modify: `src/App.tsx:3001-3050`
- Modify: `src/index.css:506-554, 2452-2513`
- Modify: `src/styles/luminous-precision/workbench-views.css:440-486`
- Modify: `src/features/natural-language/NaturalLanguagePage.tsx:134-227`
- Modify: `src/features/settings/SettingsModal.tsx:432-500, 933-956`
- Modify: `src/styles/luminous-precision/settings-responsive.css:3-91`
- Modify: `src/styles/luminous-precision/page-details.css:461-489`
- Test: `src/features/natural-language/NaturalLanguagePage.test.tsx`
- Test: `src/features/settings/SettingsModal.test.tsx`

- [ ] Add focused DOM tests that locate real primary controls by role and accessible name. The implementation must use the actual Chinese test fixture labels if that fixture defaults to `zh-CN`.

```tsx
expect(screen.getByRole('textbox', { name: /自然语言命令/i })).toBeVisible();
expect(screen.getByRole('button', { name: /发送/i })).toBeVisible();
expect(screen.getByRole('button', { name: /保存为步骤/i })).toBeVisible();
expect(screen.getByTestId('midscene-connection-test')).toBeInTheDocument();
```

- [ ] Make the content row in App Shell the only flexible shell row. Remove page-level `min-height: min(720px, ...)` and `min-height: min(760px, ...)` contracts from screen-bounded Workbenches. Use bounded tracks instead:

```css
.designer-split,
.nl-studio,
.workflow-studio,
.document-studio,
.case-workbench {
  min-height: 0;
  height: 100%;
}

.designer-panel-body {
  min-height: 0;
  overflow: auto;
}
```

- [ ] Make the Natural Language command panel use header, scrollable history, and auto-height composer rows. The composer is `shrink-0`; only the history may scroll.

```tsx
<aside className="nl-command-panel grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
  <div className="designer-panel-header">...</div>
  <div className="designer-panel-body overflow-y-auto">...</div>
  <div className="nl-command-composer shrink-0">...</div>
</aside>
```

- [ ] Make Settings an explicit header/body/footer layout. The middle row is bounded and scrollable; footer buttons stay in a `shrink-0` row and must not cover fields.

```tsx
<div className="settings-dialog-shell grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
  <DialogHeader className="settings-dialog-topbar">...</DialogHeader>
  <div className="min-h-0">...</div>
  <DialogFooter className="settings-dialog-footer">...</DialogFooter>
</div>
```

- [ ] Run `pnpm exec node node_modules/vitest/vitest.mjs run src/features/settings/SettingsModal.test.tsx src/features/natural-language/NaturalLanguagePage.test.tsx`.
- [ ] Verify the four Settings sections and Natural Language standby/connected states in Computer Use at `1200 x 760`, `1280 x 800`, and `1440 x 900`.
- [ ] Commit this isolated hotfix: `fix(ui): restore desktop control visibility`.

## Task 3: Make availability and browser state truthful

**Files:**

- Modify: `src/features/home/HomePage.tsx:64-79`
- Modify: `src/features/runs/RunRecordsPage.tsx:114-128, 499-553, 766-780, 893-908`
- Modify: `src/features/recording/RecordingPage.tsx:134-252`
- Modify: `src/i18n/locales/zh-CN.ts:596-621, 780-810`
- Modify: `src/i18n/locales/en-US.ts:596-621, 780-810`
- Test: `src/features/home/HomePage.test.tsx`
- Test: `src/features/runs/RunRecordsPage.test.tsx`
- Test: `src/features/recording/RecordingPage.test.tsx`

- [ ] Write failing tests for zero assets, zero runs, browser idle, browser ready, and browser error. Each test must assert the visible state and the absence of the conflicting state.

```tsx
expect(getCoverageIndex([], [])).toBeNull();
expect(screen.getByText(/等待样本/i)).toBeVisible();
expect(screen.queryByText(/^通过$/)).not.toBeInTheDocument();
expect(screen.getByText(/浏览器尚未启动/i)).toBeVisible();
expect(screen.queryByText(/受控浏览器已就绪/i)).not.toBeInTheDocument();
```

- [ ] Introduce a rendering-only availability distinction. Do not add `unavailable` to persisted `RunStatus`, because missing observations are not execution outcomes.

```ts
const getRunHealthTone = (total: number, failed: number, running: number): RunTone | 'neutral' => {
  if (!total) return 'neutral';
  if (failed) return 'failed';
  if (running) return 'running';
  return 'passed';
};
```

- [ ] Change `getCoverageIndex` to return `null` when no assets and no runs can support a score. Render a neutral “尚无数据” state with an action to the appropriate first asset page.
- [ ] Branch `RecordingPage` no-screenshot rendering by `browserSession.status`. Idle displays a start action and no fabricated interactions. A retained visual example must be localized, labelled “示例预览”, and `aria-hidden="true"` when decorative.
- [ ] Run the three focused test files and inspect zero-data Run records and idle Recording in Computer Use.
- [ ] Commit: `fix(ui): distinguish unavailable and live runtime states`.

## Task 4: Define the operational empty-state family

**Files:**

- Modify: `src/components/workbench.tsx:171-218`
- Modify: `src/features/documents/DocumentAnalysisPage.tsx:226-350`
- Modify: `src/features/workflow/WorkflowPage.tsx:130-377`
- Modify: `src/features/maintenance/MaintenanceQueuePage.tsx:1-184`
- Modify: `src/features/cases/TestCaseManagementPage.tsx`
- Modify: `src/features/flows/ReusableFlowsPage.tsx`
- Modify: `src/features/suites/SuiteManagementPage.tsx:77-85, 190-381`
- Modify: `src/styles/luminous-precision/workbench-views.css`
- Test: matching feature `*.test.tsx` files

- [ ] Add `OperationalEmptyState` beside `EvidenceCard`: title, one-sentence rationale, one primary action, and optional secondary action. It must be an unframed page section, never a card inside another card.

```tsx
type OperationalEmptyStateProps = {
  title: string;
  description: string;
  primaryAction: ReactNode;
  secondaryAction?: ReactNode;
};
```

- [ ] Write page tests that assert one first action and the absence of an empty inspector or duplicated CTA. For Documents, assert import is visible in the work area and the empty detail rail is not mounted.
- [ ] Render Documents, Flows, Cases, Suites, Workflow, and Maintenance as compact initial states while their asset count is zero. Preserve current stable multi-column layouts once a concrete asset is selected.
- [ ] For disabled Suite, Workflow, and Case run actions, show the missing prerequisite beside the control and provide a related navigation action. Keep the semantic `disabled` attribute.
- [ ] Run the modified feature tests and inspect all zero-asset pages without creating persistent assets.
- [ ] Commit: `refactor(ui): make empty workbenches operational`.

## Task 5: Recompose project configuration by user task

**Files:**

- Modify: `src/features/project/ProjectManagementPage.tsx:322-718`
- Modify: `src/index.css:1011-1125` or create `src/styles/luminous-precision/project-config.css`
- Modify: `src/styles/luminous-precision.css` if a new stylesheet is introduced
- Test: `src/features/project/ProjectManagementPage.test.tsx`

- [ ] First test that the dialog exposes four task destinations: project details, environments, credentials and storage, and groups. Use tabs if they are actual tabs; otherwise use the existing navigation semantics with `aria-current`.
- [ ] Extract existing JSX into local feature components: `ProjectDetailsSection`, `ProjectEnvironmentsSection`, `ProjectCredentialsAndStorageSection`, and `ProjectGroupsSection`. Do not change callback signatures, credential masking, import, capture, or revoke behavior.
- [ ] Make the active section a single max-width content column. Use task-local rows only for related fields; keep storage state with credentials and separate it from group management.

```css
.project-config-content {
  min-height: 0;
  overflow: auto;
}

.project-config-section {
  width: min(100%, 720px);
  margin-inline: auto;
}
```

- [ ] Run all project feature tests, then inspect every section at `1200 x 760` without saving credentials or importing/capturing storage state.
- [ ] Commit: `refactor(ui): organize project configuration by task`.

## Task 6: Consolidate visual roles and style ownership

**Files:**

- Modify: `src/styles/design-tokens.css`
- Modify: `src/styles/luminous-precision.css`
- Modify: selected `src/styles/luminous-precision/*.css`
- Modify: `src/index.css`
- Modify: `src/components/ui/button.tsx`
- Modify: `src/components/StatusPill.tsx`
- Test: `src/components/RunState.test.tsx`
- Test: `src/components/ui/button.test.tsx` (create)

- [ ] Inventory duplicate layout selectors before deleting any rule: `rg -n "\.designer-split|\.designer-panel-body|\.settings-dialog|\.project-config|\.metric-tile" src/index.css src/styles/luminous-precision`.
- [ ] For each result, designate exactly one owner: token definition, reusable primitive, page-family layout, or page-specific exception. Rules without an owner are moved or removed.
- [ ] Keep only `plain`, `subtle`, `active`, `evidence`, `stat`, and `empty` Surface roles. An informational Surface must not resemble an input, and a state color must never be decorative.

```css
:root {
  --surface-plain: var(--card);
  --surface-subtle: var(--surface-container-low);
  --surface-evidence: color-mix(in srgb, var(--primary) 6%, var(--card));
  --surface-active: color-mix(in srgb, var(--primary) 8%, var(--card));
}
```

- [ ] Give disabled primary controls a dedicated neutral presentation instead of global opacity only, while preserving native disabled semantics and an accessible name.

```tsx
disabled: 'border-border bg-muted text-muted-foreground shadow-none opacity-100',
```

- [ ] Move page-family layout rules out of `src/index.css` into the matching luminous-precision file or delete them when superseded. `index.css` retains Tailwind setup, reset/base, and transition primitives only. Migrate one page family at a time and run its tests after each migration.
- [ ] Run `pnpm lint`, `pnpm test`, and `pnpm quality:duplicates`.
- [ ] Commit: `refactor(ui): consolidate workbench visual contracts`.

## Task 7: Complete desktop visual and accessibility acceptance

**Files:**

- Modify: `docs/acceptance/matrix.md`
- Modify: `docs/ui-audits/2026-09-02-desktop-ui-baseline.md`
- Test: `pnpm lint`; `pnpm test`; `pnpm test:browser-smoke`; Computer Use visual matrix

- [ ] Run `pnpm lint`, `pnpm test`, and `pnpm test:browser-smoke`. Any unrelated pre-existing failure is documented as release risk rather than waived.
- [ ] At `1200 x 760`, `1280 x 800`, `1440 x 900`, and `1024 x 768`, inspect all accessible pages in light and dark themes. Confirm no overlap, clipping, hidden sole action, unreadable label, or disabled primary control resembling an enabled action.
- [ ] Keyboard-check Settings, Natural Language, Workflow, Project configuration, and each empty-state primary action: visible focus, correct tab order, dialog escape/close, and announced selected setting section.
- [ ] Update the baseline with before/after evidence and acceptance results.
- [ ] Commit: `docs: verify desktop UI repair acceptance`.

## Audit coverage mapping

| Audit finding | Plan task |
| --- | --- |
| P0-01 Natural Language composer hidden | Task 2 |
| P0-02 Settings content clipped | Task 2 |
| P1-01 zero-run passed state | Task 3 |
| P1-02 idle recording claimed ready | Task 3 |
| P1-03 fabricated coverage index | Task 3 |
| P1-04 project dialog imbalance | Task 5 |
| P1-05 shell/footer height pressure | Task 2 and Task 6 |
| P1-06 empty workbenches | Task 4 |
| P1-07 Workflow empty path/prerequisites | Task 4 |
| P1-08 disabled control ambiguity | Task 4 and Task 6 |
| P2-01 to P2-05 density, visual roles, navigation, CSS ownership, typography | Task 6 and Task 7 |

## Confirmed product decisions

Confirmed on 2026-09-02:

1. P0 visibility work ships as an isolated hotfix before redesign.
2. Zero-asset pages use operational, minimal onboarding rather than template-driven setup.
3. Recording `idle` removes the browser mock; a future example is allowed only when explicitly labelled as non-evidence and tied to a concrete action.
4. `1200 x 760`, `1280 x 800`, and `1440 x 900` are mandatory desktop gates; `1024 x 768` is a no-hidden-action resilience gate.

## Plan self-review

- Every P0, P1, and P2 finding in the accompanying audit maps to a task and explicit acceptance condition.
- The plan excludes secret persistence, project storage, and execution behavior from scope.
- P0 geometry is verified and committed before CSS consolidation, preventing the broader refactor from masking inaccessible primary controls.
