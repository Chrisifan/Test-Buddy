# UI Foundation And Workbench Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved TestBuddy UI audit baseline: one semantic visual token source, readable light/dark Native Glass Rail, shared RunState language, and focused improvements to Overview, Run Records, Recording, and responsive workbench behavior.

**Architecture:** Preserve the existing React page and runtime contracts. Move visual ownership into a dedicated token stylesheet, keep `luminous-precision.css` for component/layout rules, and migrate shared status/surface primitives before page-specific styling. Use focused tests that inspect token contracts and render user-visible state labels.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Radix/shadcn primitives, Vitest, Testing Library, Electron/macOS vibrancy.

---

### Task 1: Establish the semantic token source and dark glass rail

**Files:**
- Create: `src/styles/design-tokens.css`
- Modify: `src/main.tsx`
- Modify: `src/index.css`
- Modify: `src/styles/luminous-precision.css`
- Modify: `src/design-system.test.ts`
- Modify: `src/styles/app-shell.test.ts`

- [ ] **Step 1: Write the failing token ownership and rail tests**

Add assertions that `src/styles/design-tokens.css` contains the light/dark primary, workspace, sidebar, radius, density, and motion tokens; `index.css` and `luminous-precision.css` contain no `:root`/`.dark` token blocks; and `.app-rail` consumes `var(--sidebar-background)`, has a theme border, and paints a pseudo-element overlay. Replace the current tests that require a transparent, borderless rail.

- [ ] **Step 2: Run the focused tests to verify the expected failure**

Run:

```bash
pnpm exec node node_modules/vitest/vitest.mjs run src/design-system.test.ts src/styles/app-shell.test.ts
```

Expected: FAIL because the dedicated token file and themed rail contract do not yet exist.

- [ ] **Step 3: Create the token stylesheet and make it authoritative**

Copy the current material/application/shell tokens into `src/styles/design-tokens.css`, merge the useful baseline values from `src/index.css`, and keep one `:root` plus one `.dark` block. Preserve `--primary: #0066ff` in both themes. Import it after `index.css` and before `luminous-precision.css` in `src/main.tsx`. Remove the duplicated `:root` and `.dark` declarations from both old stylesheets while leaving Tailwind `@theme` and base rules in `index.css`.

- [ ] **Step 4: Implement the themed glass overlay**

Change `.app-rail` in `src/styles/luminous-precision.css` to use `background: var(--sidebar-background)`, `border: 1px solid var(--sidebar-glass-border)`, and the existing blur. Add a non-interactive `::before` overlay using `var(--sidebar-glass-highlight)` and an `::after` edge using `var(--sidebar-glass-edge)`. Keep rail children above both layers. Remove the later `.dark .app-rail` override in `src/index.css` so cascade order cannot reintroduce a different dark rail.

- [ ] **Step 5: Run the focused tests and renderer build**

Run:

```bash
pnpm exec node node_modules/vitest/vitest.mjs run src/design-system.test.ts src/styles/app-shell.test.ts
pnpm build:renderer
```

Expected: focused tests pass and the renderer build exits 0.

### Task 2: Introduce the shared RunState component and technical typography roles

**Files:**
- Create: `src/components/RunState.tsx`
- Create: `src/components/RunState.test.tsx`
- Modify: `src/components/StatusPill.tsx`
- Modify: `src/App.tsx`
- Modify: `src/features/home/HomePage.tsx`
- Modify: `src/features/cases/TestCaseManagementPage.tsx`
- Modify: `src/features/natural-language/NaturalLanguagePage.tsx`
- Modify: `src/features/runs/RunRecordsPage.tsx`
- Modify: `src/features/workflow/WorkflowPage.tsx`
- Modify: `src/styles/luminous-precision.css`
- Modify: `src/index.css`

- [ ] **Step 1: Write the failing RunState behavior tests**

Create tests for `RunState` rendering all persisted statuses plus `neutral`, with the translated label, `data-run-state` attribute, status role, and an icon marked decorative. Add a test that `neutral` uses the pending label and that the component accepts an optional compact variant.

- [ ] **Step 2: Run the component test to verify it fails**

Run:

```bash
pnpm exec node node_modules/vitest/vitest.mjs run src/components/RunState.test.tsx
```

Expected: FAIL because `RunState` is not defined.

- [ ] **Step 3: Implement `RunState` and preserve the `StatusPill` API**

Define the `RunTone` mapping in `RunState.tsx` with Lucide icons and semantic classes (`passed`, `running`, `failed`, `blocked`, `skipped`, `cancelled`, `error`, `neutral`). Export `StatusPill` as a compatibility wrapper that renders `RunState`, so existing feature call sites do not change behavior while the shared component becomes the owner.

- [ ] **Step 4: Migrate global runtime status and page-specific custom pills**

Replace the Natural Language emerald-only session pill with `RunState` styling and update the App runtime bar, HomePage, TestCaseManagementPage, RunRecordsPage, and WorkflowPage to render `RunState` directly. Add CSS classes for state icon spacing, running motion, and reduced-motion behavior. Remove the global `.font-mono` font-family override and replace it with a `--font-mono` token that resolves to a real monospace stack; retain Geist for `font-sans`.

- [ ] **Step 5: Run component and affected page tests**

Run:

```bash
pnpm exec node node_modules/vitest/vitest.mjs run src/components/RunState.test.tsx src/features/home/HomePage.test.tsx src/features/runs/RunRecordsPage.test.tsx src/features/natural-language/NaturalLanguagePage.test.tsx src/features/workflow/WorkflowPage.test.tsx
```

Expected: all selected tests pass with no changed user-facing status labels.

### Task 3: Rebalance the Overview page around quality signals

**Files:**
- Modify: `src/features/home/HomePage.tsx`
- Modify: `src/features/home/HomePage.test.tsx`
- Modify: `src/styles/luminous-precision.css`
- Modify: `src/i18n/index.ts` to add the four scan-target labels if the existing message keys cannot be reused

- [ ] **Step 1: Write the failing hierarchy assertions**

Update the existing dashboard test to assert one `Quality Signal`/health summary, a primary next-action entry band, a recent-run region, and no more than four top-level metric tiles. Assert that all non-status summary glyphs use the brand-primary class rather than red/amber/emerald decoration.

- [ ] **Step 2: Run the home tests to verify the old hierarchy fails**

Run:

```bash
pnpm exec node node_modules/vitest/vitest.mjs run src/features/home/HomePage.test.tsx
```

Expected: FAIL because the current dashboard renders six equal metric cards and decorative category tones.

- [ ] **Step 3: Implement the Overview hierarchy**

Group the existing metrics into four scan targets: workspace assets, health signal, pass rate, and coverage. Keep the three pipeline entry actions and recent runs, but give the health signal and next action the strongest visual treatment. Use `var(--primary)`/neutral glyphs for asset categories; reserve failure/risk colors for the actual signal state.

- [ ] **Step 4: Replace equal-card styling with signal/entry styles**

In `luminous-precision.css`, reduce repeated border emphasis, keep panels at the existing 8px radius, give the health panel an active semantic edge, and make entry buttons visually actionable without card nesting. Preserve the empty-project flow and existing navigation handlers.

- [ ] **Step 5: Run the home tests and renderer build**

Run:

```bash
pnpm exec node node_modules/vitest/vitest.mjs run src/features/home/HomePage.test.tsx
pnpm build:renderer
```

Expected: all HomePage tests pass and the build exits 0.

### Task 4: Reduce Execution density and make Recording dark-safe

**Files:**
- Modify: `src/features/runs/RunRecordsPage.tsx`
- Modify: `src/features/runs/RunRecordsPage.test.tsx`
- Modify: `src/features/recording/RecordingPage.tsx`
- Modify: `src/features/recording/RecordingPage.test.tsx`
- Modify: `src/styles/luminous-precision.css`

- [ ] **Step 1: Write failing semantic hierarchy and mock-theme tests**

Add assertions that Run Records exposes one conclusion region, one step/diagnostic region, and one evidence region with explicit labels, and that the Recording preview uses semantic `target-mock-*` classes rather than `bg-slate-*`, `text-slate-*`, or fixed white action colors.

- [ ] **Step 2: Run focused tests to verify the current implementation fails**

Run:

```bash
pnpm exec node node_modules/vitest/vitest.mjs run src/features/runs/RunRecordsPage.test.tsx src/features/recording/RecordingPage.test.tsx
```

Expected: FAIL on the new semantic and class-contract assertions.

- [ ] **Step 3: Add execution hierarchy landmarks without changing run behavior**

Add accessible labels and class hooks around the existing run conclusion, selected step/diagnostics, and Evidence Rail. Collapse redundant visual framing by changing inner `Surface` variants to `plain`/`subtle` where the parent already supplies the boundary. Keep all rerun, export, manual evidence, and artifact actions unchanged.

- [ ] **Step 4: Tokenize the Recording target-page mock**

Replace hard-coded browser preview colors with `target-mock-*` classes and add light/dark definitions in `luminous-precision.css`: stage background, browser chrome, card, muted text, action surface, and pointer signal. Keep the mock visually independent from TestBuddy Product Surface while maintaining readable contrast.

- [ ] **Step 5: Run focused tests and build**

Run:

```bash
pnpm exec node node_modules/vitest/vitest.mjs run src/features/runs/RunRecordsPage.test.tsx src/features/recording/RecordingPage.test.tsx
pnpm build:renderer
```

Expected: affected tests pass and renderer build exits 0.

### Task 5: Preserve high-value rails at constrained widths and verify the package

**Files:**
- Modify: `src/styles/luminous-precision.css`
- Modify: `src/styles/app-shell.test.ts`
- Modify: `docs/ui-ux-audit-2026-08-17.md` only to check completed items

- [ ] **Step 1: Write the failing responsive contract test**

Add a stylesheet assertion that the `max-width: 1120px` block does not use `display: none` for `.nl-planner-panel` or `.run-evidence-rail` and declares `grid-column: 1 / -1` for both rails so they remain visible as full-width in-flow sections beneath the main columns.

- [ ] **Step 2: Run the shell test to verify the current hiding rule fails**

Run:

```bash
pnpm exec node node_modules/vitest/vitest.mjs run src/styles/app-shell.test.ts
```

Expected: FAIL because the current media query hides both high-value regions.

- [ ] **Step 3: Implement recoverable narrow-window behavior**

At widths below 1120px, keep the main workbench readable by setting `.nl-planner-panel` and `.run-evidence-rail` to `display: grid` and `grid-column: 1 / -1`, with compact padding and an internal max-height scroll region. Do not change Electron’s minimum window size; this protects future resizing and browser/mobile rendering without discarding evidence.

- [ ] **Step 4: Run the full verification set**

Run:

```bash
pnpm exec node node_modules/vitest/vitest.mjs run src/design-system.test.ts src/styles/app-shell.test.ts src/components/RunState.test.tsx src/features/home/HomePage.test.tsx src/features/runs/RunRecordsPage.test.tsx src/features/recording/RecordingPage.test.tsx
pnpm typecheck
pnpm build
git diff --check
```

Expected: selected tests, typecheck, renderer/electron build, and diff check exit 0. Existing unrelated failures in the broader worktree must be reported separately rather than hidden.

- [ ] **Step 5: Re-run the real Electron visual check**

Launch the packaged app, capture the App Shell and priority pages in both light and dark themes at 1440x960 and 1280x800, and verify Logo, rail contrast, primary actions, RunState, Recording mock, evidence placement, and no clipped text. Update the audit checklist only for verified items.
