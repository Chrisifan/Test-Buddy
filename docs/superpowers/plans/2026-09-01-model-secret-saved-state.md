# Model Secret Saved State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace an empty-looking saved model-key input with an explicit secure-saved state that supports replacement and clearing without exposing the key.

**Architecture:** `ModelSecretInput` remains the sole UI boundary for MidScene and independent Agent keys. It will choose between an editable password input and a saved-state row from the existing `hasStoredKey` reference plus local replacement intent; the renderer will never receive the persisted key value.

**Tech Stack:** React 19, TypeScript, Lucide React, Vitest, Testing Library.

---

### Task 1: Specify Saved-State Interaction in Tests

**Files:**
- Modify: `src/features/settings/SettingsModal.test.tsx:224-244`

- [ ] **Step 1: Write the failing stored-state test**

  Add this test after the existing explicit-clear test:

  ```tsx
  it('shows an explicit stored state and reveals a fresh input only when replacing a Midscene key', () => {
    renderSettingsModal({
      initialSection: 'midscene',
      modelSecret: {
        id: 'midscene',
        hasKey: true,
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
    });

    expect(screen.getByRole('status')).toHaveTextContent('已安全保存');
    expect(screen.queryByLabelText('MIDSCENE_MODEL_API_KEY')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '替换密钥' }));
    expect(screen.getByLabelText('MIDSCENE_MODEL_API_KEY')).toHaveValue('');
    expect(screen.getByRole('button', { name: '保存密钥' })).toBeDisabled();
  });
  ```

- [ ] **Step 2: Run the test to verify it fails**

  Run: `pnpm exec node node_modules/vitest/vitest.mjs run src/features/settings/SettingsModal.test.tsx`

  Expected: FAIL because a stored key still renders `MIDSCENE_MODEL_API_KEY` as an empty password input and there is no `替换密钥` control.

### Task 2: Render the Explicit Saved State

**Files:**
- Modify: `src/i18n/index.ts:95-97,436-438,1634-1636`
- Modify: `src/features/settings/SettingsModal.tsx:170-244`
- Test: `src/features/settings/SettingsModal.test.tsx:224-244`

- [ ] **Step 1: Add the replacement translation key**

  Extend `TranslationKey` with `settings.modelSecret.replace`; add `替换密钥` to the Chinese dictionary and `Replace key` to the English dictionary.

- [ ] **Step 2: Implement the two view modes in `ModelSecretInput`**

  Introduce local replacement intent and derive the editable mode:

  ```tsx
  const [isReplacing, setIsReplacing] = useState(false);
  const isEditing = !hasStoredKey || isReplacing;
  ```

  In the saved mode, render a `role="status"` row containing `CircleCheck`,
  `t('settings.modelSecret.stored')`, a `variant="outline"` Replace button
  that calls `setIsReplacing(true)`, and the existing Clear button. In the
  editable mode, retain the existing password input and Save behavior. After a
  successful save, clear the DOM input, reset `hasPendingValue`, and call
  `setIsReplacing(false)`.

  Keep the saved key value out of React state and do not add a `value` prop to
  the password input.

- [ ] **Step 3: Run the focused test to verify it passes**

  Run: `pnpm exec node node_modules/vitest/vitest.mjs run src/features/settings/SettingsModal.test.tsx`

  Expected: PASS, including the new stored-state and replacement test.

### Task 3: Verify the Shared Call Sites and Build

**Files:**
- Modify: `src/features/settings/SettingsModal.tsx`
- Modify: `src/features/settings/SettingsModal.test.tsx`
- Modify: `src/i18n/index.ts`

- [ ] **Step 1: Run cross-component regression tests**

  Run:

  ```sh
  pnpm exec node node_modules/vitest/vitest.mjs run \
    src/features/settings/SettingsModal.test.tsx \
    src/App.test.tsx \
    src/features/startup/StartupPage.test.tsx
  ```

  Expected: PASS. This proves the MidScene and independent Agent call sites
  retain the write-only secret contract.

- [ ] **Step 2: Run static and build verification**

  Run:

  ```sh
  pnpm typecheck
  pnpm build
  git diff --check
  ```

  Expected: each command exits 0 with no TypeScript errors, build failures, or
  whitespace errors.

- [ ] **Step 3: Commit only the focused feature files when the worktree has no unrelated staged changes**

  ```sh
  git add src/features/settings/SettingsModal.tsx \
    src/features/settings/SettingsModal.test.tsx \
    src/i18n/index.ts \
    docs/superpowers/specs/2026-09-01-model-secret-saved-state-design.md \
    docs/superpowers/plans/2026-09-01-model-secret-saved-state.md
  git commit -m "fix: clarify saved model key state"
  ```

  Expected: commit contains only the listed focused feature files. Do not run
  this step in a shared dirty worktree unless the user explicitly requests a
  commit.
