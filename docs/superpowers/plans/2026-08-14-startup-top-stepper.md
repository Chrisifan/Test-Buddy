# Startup Top Stepper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the startup progress indicator above the first-run configuration content and use the active TestBuddy hammer-bot asset in its brand header.

**Architecture:** `App` continues to resolve the light or dark logo from the active appearance setting and passes that URL to `StartupPage`. `StartupPage` renders a semantic startup header before the existing configuration content; the final stylesheet changes the startup shell from a side rail to header, content, and footer rows without changing startup state or callback behavior.

**Tech Stack:** React 19, TypeScript, Tailwind utility classes, CSS final cascade, Vitest, Testing Library, Vite.

---

### Task 1: Establish startup header regression coverage

**Files:**
- Modify: `src/features/startup/StartupPage.test.tsx`
- Test: `src/features/startup/StartupPage.test.tsx`

- [ ] **Step 1: Write the failing test**

Add a dedicated brand image URL and assert the startup screen renders it in the startup header while retaining the three localized step labels:

```tsx
it('renders the supplied TestBuddy brand asset above the startup steps', () => {
  const brandLogo = '/assets/testbuddy-hammer-bot.png';

  render(
    <StartupPage
      brandLogo={brandLogo}
      midsceneConfig={state.midsceneConfig}
      midsceneReady={false}
      onComplete={vi.fn()}
      onSkip={vi.fn()}
      onUpdateMidsceneConfig={vi.fn()}
    />,
  );

  expect(screen.getByRole('banner', { name: 'TestBuddy' })).toContainElement(
    screen.getByRole('img', { name: 'TestBuddy' }),
  );
  expect(screen.getByRole('img', { name: 'TestBuddy' })).toHaveAttribute('src', brandLogo);
  expect(screen.getByText('配置 MidScene')).toBeInTheDocument();
  expect(screen.getByText('进入工作台')).toBeInTheDocument();
  expect(screen.getByText('开始测试')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
pnpm exec vitest run src/features/startup/StartupPage.test.tsx
```

Expected: FAIL because `StartupPage` does not yet accept `brandLogo` or expose the banner and image roles.

- [ ] **Step 3: Implement the minimal component and call-site changes**

In `src/features/startup/StartupPage.tsx`, add a required `brandLogo: string` prop and replace the generic `Bot` mark with:

```tsx
<header aria-label="TestBuddy" className="startup-header" role="banner">
  <div className="startup-brand">
    <img alt="TestBuddy" className="startup-brand-logo" src={brandLogo} />
    <span>
      <strong>TestBuddy</strong>
      <small>AUTOMATION ENGINE</small>
    </span>
  </div>
  <section className="startup-step-list" aria-label={t('startup.aria.steps')}>
    {startupSteps.map(([index, title, status], itemIndex) => {
      const isDone = itemIndex === 0 && midsceneReady;
      const isActive = midsceneReady ? itemIndex === 1 : itemIndex === 0;
      return (
        <div className={`home-start-step ${isDone ? 'is-done' : ''} ${isActive ? 'is-active' : ''}`} key={title}>
          <span className="home-start-step-index">{isDone ? '✓' : index}</span>
          <span>
            <span className="home-start-step-title">{title}</span>
            <span className="home-start-step-status">{status}</span>
          </span>
        </div>
      );
    })}
  </section>
  <a className="startup-help-link" href="https://midscenejs.com" rel="noreferrer" target="_blank">View Docs</a>
</header>
```

Keep `Bot` imported because the feature-summary card still uses it. Move the existing `aria-label={t('startup.aria.steps')}` from the old outer section onto the horizontal step list. In `src/App.tsx`, pass the existing `brandLogo` value into `StartupPage`. Add `brandLogo="/assets/testbuddy-hammer-bot.png"` to each pre-existing `StartupPage` render in `StartupPage.test.tsx` so the required prop is supplied consistently.

- [ ] **Step 4: Run the focused test to verify it passes**

Run:

```bash
pnpm exec vitest run src/features/startup/StartupPage.test.tsx
```

Expected: PASS with all startup page tests green.

- [ ] **Step 5: Commit the focused behavior change**

```bash
git add src/App.tsx src/features/startup/StartupPage.tsx src/features/startup/StartupPage.test.tsx
git commit -m "fix: restore startup top stepper and brand"
```

### Task 2: Replace the side rail with a responsive top stepper

**Files:**
- Modify: `src/styles/luminous-precision.css:2487-2730`
- Test: `src/features/startup/StartupPage.test.tsx`

- [ ] **Step 1: Add a narrow-screen structural assertion**

Add a test that verifies the startup header appears before the configuration region in DOM order:

```tsx
it('places the startup header before MidScene configuration content', () => {
  const { container } = render(
    <StartupPage
      brandLogo="/assets/testbuddy-hammer-bot.png"
      midsceneConfig={state.midsceneConfig}
      midsceneReady={false}
      onComplete={vi.fn()}
      onSkip={vi.fn()}
      onUpdateMidsceneConfig={vi.fn()}
    />,
  );

  const header = screen.getByRole('banner', { name: 'TestBuddy' });
  const configuration = screen.getByLabelText('MidScene 快速配置');

  expect(header.compareDocumentPosition(configuration) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  expect(container.querySelector('.startup-header .startup-step-list')).toBeTruthy();
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
pnpm exec vitest run src/features/startup/StartupPage.test.tsx
```

Expected: FAIL because the current component still nests the step list outside the new header.

- [ ] **Step 3: Implement the final-cascade layout rules**

Replace the `.startup-shell` through startup footer overrides with a single-column grid:

```css
.startup-shell {
  display: grid;
  height: 100vh;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: 72px minmax(0, 1fr) 32px;
  overflow: hidden;
}

.startup-main { display: contents; }

.startup-header {
  grid-row: 1;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 24px;
  border-bottom: 1px solid var(--panel-border);
  background: var(--card);
  padding: 0 clamp(16px, 3vw, 36px);
}

.startup-main .home-start-panel {
  grid-column: 1;
  grid-row: 2;
  overflow: auto;
}

.startup-shell .home-empty-status {
  grid-column: 1;
  grid-row: 3;
}
```

Style `.startup-step-list` as a three-column horizontal grid, retain the existing active/done indicators, and change each connector to a horizontal line. Give `.startup-brand-logo` stable dimensions with `object-fit: contain`. On `max-width: 760px`, let the shell scroll, make the header a wrapping grid, keep the step list ahead of the form, and hide only the status footer as the existing compact behavior does.

- [ ] **Step 4: Run the focused test to verify it passes**

Run:

```bash
pnpm exec vitest run src/features/startup/StartupPage.test.tsx
```

Expected: PASS with the new DOM-order assertion and all pre-existing startup behavior tests green.

- [ ] **Step 5: Commit the layout change**

```bash
git add src/styles/luminous-precision.css src/features/startup/StartupPage.tsx src/features/startup/StartupPage.test.tsx
git commit -m "fix: place startup steps in top header"
```

### Task 3: Verify compiled behavior and visual output

**Files:**
- Verify: `src/App.tsx`
- Verify: `src/features/startup/StartupPage.tsx`
- Verify: `src/styles/luminous-precision.css`

- [ ] **Step 1: Run static and behavioral verification**

Run:

```bash
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Expected: every command exits with status 0.

- [ ] **Step 2: Inspect the startup screen in a browser**

Run:

```bash
pnpm dev:web
```

At desktop width, verify the header spans the full page width and shows the themed hammer-bot logo followed by the three horizontal progress items. At 375px width, verify the header and progress items remain before the form, text fits without horizontal overflow, and the form remains usable.

- [ ] **Step 3: Check the dark theme asset**

Set the appearance to dark mode in the app. Verify the startup header image resolves to `testbuddy-hammer-bot-dark.png`, matching the workbench navigation branding.

- [ ] **Step 4: Commit any verification-only corrections**

If visual inspection reveals a defect, add a narrowly scoped regression test before correcting it, run the focused test red-green, then commit only the corresponding test and source change. If there is no defect, make no additional commit.
