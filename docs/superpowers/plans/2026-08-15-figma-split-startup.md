# Figma Split Startup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the first-run TestBuddy startup page to match Figma frame `1:3`, using a responsive two-column brand-and-configuration layout with an application-specific test-flow animation.

**Architecture:** Keep `StartupPage` as the owner of localized startup state and MidScene form bindings. Add a colocated, presentational `StartupFlowVisual` for the decorative left-panel test execution sequence, then replace the final startup CSS cascade so it owns every startup layout property instead of inheriting the legacy onboarding rules from `src/index.css`.

**Tech Stack:** React 19, TypeScript, Vitest with Testing Library, Lucide React, Tailwind utility classes, CSS Grid, CSS keyframes.

---

### Task 1: Lock the Figma Startup Contract in Tests

**Files:**
- Modify: `src/features/startup/StartupPage.test.tsx:12-113`
- Modify: `src/i18n/index.ts:115-145`, `src/i18n/index.ts:363-393`, `src/i18n/index.ts:1403-1433`

- [ ] **Step 1: Write a failing structural test for the split startup screen**

  Add this test after the current brand-asset test:

  ```tsx
  it('renders the Figma split startup shell with a decorative test-flow visual', () => {
    render(
      <StartupPage
        brandLogo="/assets/testbuddy-hammer-bot.png"
        midsceneConfig={state.midsceneConfig}
        midsceneReady={false}
        onComplete={vi.fn()}
        onSkip={vi.fn()}
        onUpdateMidsceneConfig={vi.fn()}
      />,
    );

    expect(screen.getByTestId('startup-brand-panel')).toContainElement(
      screen.getByRole('img', { name: 'TestBuddy' }),
    );
    expect(screen.getByTestId('startup-flow-visual')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('startup-workspace')).toContainElement(screen.getByLabelText('启动步骤'));
    expect(screen.getByText('PRD 分析')).toBeInTheDocument();
    expect(screen.getByLabelText('MidScene 快速配置')).toBeInTheDocument();
  });
  ```

- [ ] **Step 2: Write a failing CSS layout-contract test**

  Replace the former top-header assertions with these layout requirements:

  ```tsx
  expect(startupStyles).toMatch(
    /\.startup-shell\s*\{[^}]*grid-template-columns:\s*minmax\(360px,\s*44%\)\s*minmax\(0,\s*1fr\);/,
  );
  expect(startupStyles).toMatch(/\.startup-workspace\s*\{[^}]*overflow:\s*auto;/);
  expect(mobileStartupStyles).toMatch(/\.startup-shell\s*\{[^}]*grid-template-columns:\s*1fr;/);
  expect(mobileStartupStyles).toMatch(/\.startup-flow-visual\s*\{[^}]*display:\s*none;/);
  ```

- [ ] **Step 3: Run the focused test to verify the new contract fails**

  Run:

  ```bash
  pnpm exec node node_modules/vitest/vitest.mjs run src/features/startup/StartupPage.test.tsx
  ```

  Expected: the new test cannot find `startup-brand-panel`, and the CSS contract does not find the split grid.

- [ ] **Step 4: Add localized copy for the new visual hierarchy**

  Extend the `TranslationKey` union and both locale dictionaries with exactly these keys:

  ```ts
  'startup.brand.welcome'
  'startup.brand.description'
  'startup.brand.metric.accuracy'
  'startup.brand.metric.setup'
  'startup.brand.metric.autonomous'
  'startup.capabilities.title'
  'startup.securityNote'
  ```

  Use Chinese values `欢迎来到测试的新未来`, `将需求、自然语言和真实操作转为可验证的自动化测试。`, `准确率`, `更快配置`, `持续运行`, `已启用的平台能力`, and `API Key 仅在本地加密存储。`; add semantically equivalent English values alongside the existing English startup strings.

- [ ] **Step 5: Commit the test and copy contract**

  ```bash
  git add src/features/startup/StartupPage.test.tsx src/i18n/index.ts
  git commit -m "test: define figma startup layout contract"
  ```

### Task 2: Recompose the Startup Page Around the Figma Layout

**Files:**
- Modify: `src/features/startup/StartupPage.tsx:1-179`
- Test: `src/features/startup/StartupPage.test.tsx:12-113`

- [ ] **Step 1: Add the presentational workflow visual before `StartupPage`**

  Import `Check`, `CirclePlay`, `MonitorSmartphone`, and `Route` from `lucide-react`, then add a static component with testable hooks:

  ```tsx
  function StartupFlowVisual() {
    return (
      <div aria-hidden="true" className="startup-flow-visual" data-testid="startup-flow-visual">
        <div className="startup-flow-browser"><MonitorSmartphone /><span /></div>
        <div className="startup-flow-route"><Route /><span className="startup-flow-pulse" /></div>
        <div className="startup-flow-node is-running"><CirclePlay /></div>
        <div className="startup-flow-node is-complete"><Check /></div>
      </div>
    );
  }
  ```

- [ ] **Step 2: Replace the shell markup with an explicit left brand panel and right workspace**

  Keep the existing `startupSteps`, feature array values, input bindings, `onComplete`, and `onSkip` callbacks. Restructure the return tree to this stable order:

  ```tsx
  <section aria-label={t('startup.aria.screen')} className="startup-shell">
    <aside className="startup-brand-panel" data-testid="startup-brand-panel">
      <div className="startup-brand">...</div>
      <div className="startup-brand-intro">...</div>
      <StartupFlowVisual />
      <dl className="startup-brand-metrics">...</dl>
    </aside>
    <main className="startup-workspace" data-testid="startup-workspace">
      <section className="startup-workspace-inner">
        <header className="startup-header">...</header>
        <section className="startup-capabilities" aria-label={t('startup.capabilities.title')}>...</section>
        <aside className="home-midscene-card">...</aside>
        <p className="startup-security-note">...</p>
      </section>
    </main>
  </section>
  ```

- [ ] **Step 3: Preserve functional controls during the markup move**

  Retain the following unchanged behavior:

  ```tsx
  disabled={!midsceneReady}
  onClick={onComplete}
  onClick={onSkip}
  onChange={(event) => onUpdateMidsceneConfig({ modelBaseUrl: event.target.value })}
  onChange={(event) => onUpdateMidsceneConfig({ modelApiKey: event.target.value })}
  onChange={(event) => onUpdateMidsceneConfig({ modelName: event.target.value })}
  onChange={(event) => onUpdateMidsceneConfig({ modelFamily: event.target.value })}
  onChange={(event) => onUpdateMidsceneConfig({ defaultContext: event.target.value })}
  ```

- [ ] **Step 4: Run the focused test to verify the component contract passes**

  Run:

  ```bash
  pnpm exec node node_modules/vitest/vitest.mjs run src/features/startup/StartupPage.test.tsx
  ```

  Expected: all startup tests pass, including the new structural assertions and skip callback test.

- [ ] **Step 5: Commit the component structure**

  ```bash
  git add src/features/startup/StartupPage.tsx src/features/startup/StartupPage.test.tsx src/i18n/index.ts
  git commit -m "feat: rebuild startup page from figma"
  ```

### Task 3: Implement the Responsive Visual System and Test-Flow Motion

**Files:**
- Modify: `src/styles/luminous-precision.css:2486-2785`
- Test: `src/features/startup/StartupPage.test.tsx:84-113`

- [ ] **Step 1: Replace the current startup override block with the desktop split layout**

  Define the startup shell and independently scrolling right workspace using the Figma proportions:

  ```css
  .startup-shell {
    display: grid;
    height: 100vh;
    grid-template-columns: minmax(360px, 44%) minmax(0, 1fr);
    overflow: hidden;
    background: var(--card);
  }

  .startup-brand-panel {
    display: grid;
    min-height: 0;
    grid-template-rows: auto auto minmax(180px, 1fr) auto;
    gap: clamp(20px, 3vh, 40px);
    overflow: hidden;
    background: #06338d;
    color: #fff;
    padding: clamp(28px, 5vw, 72px);
  }

  .startup-workspace {
    min-width: 0;
    overflow: auto;
    background: var(--card);
    padding: clamp(28px, 6vw, 88px);
  }
  ```

- [ ] **Step 2: Style the right-side stepper, capability cards, and form surface**

  Make the header compact and horizontal, use a three-column capability grid, and give `.home-midscene-card` a bounded white surface with a header divider. Do not reuse the legacy `.home-empty-*` layout classes or set fixed heights on the configuration card.

- [ ] **Step 3: Implement contained animation with reduced-motion support**

  Add a single progress-pulse keyframe and opt it out under the existing reduced-motion media query:

  ```css
  @keyframes startup-flow-progress {
    0%, 20% { transform: translateX(-120%); opacity: 0; }
    35%, 75% { opacity: 1; }
    100% { transform: translateX(340%); opacity: 0; }
  }

  .startup-flow-pulse { animation: startup-flow-progress 2600ms ease-in-out infinite; }

  @media (prefers-reduced-motion: reduce) {
    .startup-flow-pulse { animation: none; }
  }
  ```

- [ ] **Step 4: Add breakpoint rules for tablet and phone**

  At `max-width: 980px`, use `grid-template-columns: 1fr`, make `.startup-brand-panel` a compact top section, and let `.startup-workspace` be a normal document block. At `max-width: 640px`, hide `.startup-flow-visual` and `.startup-brand-metrics`, stack `.startup-step-list` and `.startup-capabilities`, and retain all form controls without horizontal overflow.

- [ ] **Step 5: Run the focused test to verify the CSS contract passes**

  Run:

  ```bash
  pnpm exec node node_modules/vitest/vitest.mjs run src/features/startup/StartupPage.test.tsx
  ```

  Expected: all assertions pass, including the desktop split-grid and phone animation fallback checks.

- [ ] **Step 6: Commit the responsive stylesheet**

  ```bash
  git add src/styles/luminous-precision.css src/features/startup/StartupPage.test.tsx
  git commit -m "style: match figma split startup layout"
  ```

### Task 4: Verify Behavior and Visual Boundaries

**Files:**
- Verify: `src/features/startup/StartupPage.tsx`
- Verify: `src/styles/luminous-precision.css`
- Verify: `src/features/startup/StartupPage.test.tsx`

- [ ] **Step 1: Run the full automated suite**

  Run:

  ```bash
  pnpm test
  ```

  Expected: every Vitest file passes without startup regressions.

- [ ] **Step 2: Run static type checking**

  Run:

  ```bash
  pnpm typecheck
  ```

  Expected: no errors introduced by the startup changes. If the existing runtime request errors remain, report their exact paths separately from startup verification.

- [ ] **Step 3: Inspect the Figma-proportion desktop page**

  Use a `1280x1024` viewport and verify the left brand panel is visible, the flow visual stays within it, the right workspace contains the three steps, capability cards, form, and actions, and no elements overlap.

- [ ] **Step 4: Inspect constrained desktop and phone pages**

  Use `1280x720` and `375x812` viewports. Verify the right workspace scrolls at the short desktop height; on phone, verify the layout is one column, the decorative animation is hidden, and every field and action remains reachable.

- [ ] **Step 5: Run whitespace validation and record the final state**

  Run:

  ```bash
  git diff --check
  git status --short
  ```

  Expected: no whitespace errors. Report only the startup files changed by this work and leave unrelated working-tree changes untouched.
