# Settings Density And Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the settings modal a compact configuration tool by removing redundant onboarding content and improving stored-key and label hierarchy without changing settings behavior.

**Architecture:** Keep the existing `SettingsModal` component and its configuration data flow intact. Remove only redundant presentation JSX and unused translation entries; scope density and label hierarchy CSS beneath `.settings-dialog-scroll` so shared form layouts remain untouched.

**Tech Stack:** React, TypeScript, Tailwind utility classes, CSS, Vitest, Testing Library, Lucide.

---

### Task 1: Specify The Reduced MidScene Surface

**Files:**
- Modify: `src/features/settings/SettingsModal.test.tsx:72-82`
- Test: `src/features/settings/SettingsModal.test.tsx`

- [ ] **Step 1: Replace the feature-card expectation with a failing absence test**

```tsx
it('omits the redundant MidScene onboarding content and numbered section labels', () => {
  renderSettingsModal({ initialSection: 'midscene' });

  expect(screen.queryByText('配置完成后可进入')).not.toBeInTheDocument();
  expect(screen.queryByText('自然语言测试')).not.toBeInTheDocument();
  expect(screen.queryByText('流程编排测试')).not.toBeInTheDocument();
  expect(screen.queryByText('录制回放')).not.toBeInTheDocument();
  expect(screen.queryByText('02 / 引擎')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run src/features/settings/SettingsModal.test.tsx`

Expected: FAIL because the current MidScene section still renders the feature cards and `02 / 引擎` eyebrow.

- [ ] **Step 3: Keep the existing connection behavior test unchanged**

```tsx
fireEvent.click(screen.getByRole('button', { name: '测试连接' }));

expect(onTestMidsceneConnection).toHaveBeenCalledWith(
  expect.objectContaining({ modelName: 'gpt-4o-mini' }),
);
```

This preserves coverage of the button action while the displayed idle icon changes.

### Task 2: Remove Redundant Presentation Content

**Files:**
- Modify: `src/features/settings/SettingsModal.tsx:12, 192-231, 502-715, 719-727, 887-894`
- Modify: `src/i18n/index.ts:75-110, 119, 134, 417-452, 461, 478, 1616-1651, 1660, 1677`
- Test: `src/features/settings/SettingsModal.test.tsx`

- [ ] **Step 1: Write the minimal component changes**

```tsx
import { BrainCircuit, ChevronDown, CircleCheck, CircleHelp, CircleX, LoaderCircle, Moon, MonitorCog, Palette, PlayCircle, PlugZap, Settings2, Sun, Waypoints, Wifi } from 'lucide-react';

<h2 className="text-lg font-semibold">{t('settings.midscene.title')}</h2>

<Button
  className="min-w-[116px] rounded-[4px]"
  disabled={!midsceneReady || isTestingMidsceneConnection}
  onClick={handleTestMidsceneConnection}
  type="button"
  variant="outline"
>
  {isTestingMidsceneConnection ? (
    <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
  ) : (
    <PlugZap aria-hidden="true" className="h-4 w-4" />
  )}
  {isTestingMidsceneConnection
    ? t('settings.midscene.connectionTesting')
    : t('settings.midscene.connectionTest')}
</Button>
```

Delete the four section-eyebrow wrappers, the MidScene feature-card JSX, and the now-unused `Bot`, `Workflow`, and `MousePointerClick` imports. Retain the heading title, form fields, connection result message, and all handlers. Change the stored-key status root to the normal control height without vertical padding:

```tsx
<div
  className="flex min-h-[var(--density-control-height)] flex-wrap items-center gap-2 rounded-[4px] border border-emerald-500/35 bg-emerald-500/10 px-3"
  role="status"
>
```

- [ ] **Step 2: Remove unreferenced translation keys**

Delete the `settings.appearance.section`, `settings.midscene.section`, `settings.agent.section`, and `settings.runtime.section` key declarations and both locale values. Delete the `settings.midscene.unlockedTitle`, `settings.midscene.feature.*`, and `settings.midscene.requiredHint` declarations and both locale values.

- [ ] **Step 3: Run the focused test to verify the implementation is green**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run src/features/settings/SettingsModal.test.tsx`

Expected: PASS with the absence assertions and existing connection-handler test both passing.

### Task 3: Scope Form Hierarchy To Settings

**Files:**
- Modify: `src/styles/luminous-precision.css:3508-3524`
- Test: `src/features/settings/SettingsModal.test.tsx`

- [ ] **Step 1: Add settings-only density and label rules**

```css
.settings-dialog-scroll .form-field {
  gap: 8px;
}

.settings-dialog-scroll .form-field > label,
.settings-dialog-scroll .form-field > div > label {
  color: var(--muted-foreground);
  font-size: var(--font-size-meta);
  font-weight: 600;
  line-height: 16px;
}
```

Use direct-child selectors so only field labels inside the settings dialog are affected. Do not edit `src/index.css` or the shared `.form-field` rule.

- [ ] **Step 2: Run the focused test suite again**

Run: `pnpm exec node node_modules/vitest/vitest.mjs run src/features/settings/SettingsModal.test.tsx src/App.test.tsx`

Expected: PASS with no affected application settings regressions.

### Task 4: Validate The Compiled And Visual Surface

**Files:**
- Verify: `src/features/settings/SettingsModal.tsx`
- Verify: `src/styles/luminous-precision.css`

- [ ] **Step 1: Run static and build validation**

Run: `pnpm typecheck`

Expected: PASS with no stale Lucide imports or i18n key references.

Run: `pnpm build`

Expected: PASS with a production renderer and Electron build.

- [ ] **Step 2: Run whitespace validation**

Run: `git diff --check`

Expected: exit code 0 and no trailing-whitespace or patch-format diagnostics.

- [ ] **Step 3: Inspect desktop and narrow settings layouts**

Launch the existing Electron development flow and inspect the MidScene settings page at a desktop viewport and a narrow viewport. Confirm the stored-key status row matches an input height at desktop, can wrap without clipping on narrow width, labels are visibly more muted and separated from values, onboarding cards and numeric eyebrows are absent, and the idle test button uses the plug-with-bolt icon.

### Scope And Integration

This repository is already a shared, heavily modified working directory. Do not create a worktree, reset unrelated files, or commit automatically. The change set is limited to the test, component, translations, settings CSS, and this plan document.
