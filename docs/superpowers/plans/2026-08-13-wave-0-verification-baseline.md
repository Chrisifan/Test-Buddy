# Wave 0 Verification Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `pnpm check` deterministic, add CI, and verify typed Electron IPC plus a real local BrowserRuntime path without a model provider or external business system.

**Architecture:** Package scripts call installed entry modules through `pnpm exec node`, so they do not rely on an ambient root `.bin` link. A small runtime-IPC registrar is extracted from Electron main and receives safe main-process dependencies in tests. A test-owned localhost page drives a confirmed deterministic Case through `RuntimeBundle` and verifies a real PNG artifact; a second fixture run checks Suite cancellation.

**Tech Stack:** pnpm 10, TypeScript, Vitest 4, Electron IPC, Playwright Chromium, GitHub Actions.

---

## Guardrails

- Use `pnpm`; do not introduce npm/yarn commands.
- Do not stage current unstaged Suite Desktop Adapter work. Stage only paths named by a completed task.
- `pnpm check` must remain offline after `pnpm install`; browser download is an explicit `pnpm exec node node_modules/playwright/cli.js install chromium chromium-headless-shell` prerequisite for the smoke command.
- Wave 0 does not change Case versioning, terminal status semantics, secrets, Flow, retention, or browser pools.

## File Map

- `package.json`: stable test, typecheck, build, check and browser-smoke scripts.
- `.github/workflows/verify.yml`: frozen pnpm install, deterministic gate, managed Chromium and browser smoke.
- `electron/ipc/runtime-ipc-handlers.ts`: injected typed registration for existing run/artifact IPC channels.
- `electron/ipc/runtime-ipc-handlers.test.ts`: in-memory registrar smoke tests.
- `electron/preload-contract.test.ts`: mocked Electron preload channel contract test.
- `electron/main.ts`: composes the new registrar using current privileged services.
- `electron/preload.cts`: imports channel constants rather than duplicating runtime strings.
- `electron/runtime/browser-smoke.test.ts`: localhost fixture with actual Chromium evidence and cancellation paths.
- `electron/runtime/browser-runtime.ts`, `electron/runtime/test-runner.ts`: minimal real-page evidence hook.
- `docs/2026-08-13-grill-me-application-renovation-plan.md`, `docs/agent-progress-and-target.md`: fresh measured Wave 0 evidence only.

## Task 1: Stabilize Package Scripts

**Files:** Modify `package.json`.

- [x] **Step 1: Capture the red baseline.**

Run `pnpm check`.

Expected: exit code 1 with `sh: vitest: command not found`. Do not repair `node_modules`; the test proves scripts rely on an absent root link.

- [x] **Step 2: Update noninteractive scripts.**

Replace these script values in `package.json`:

```json
{
  "test": "pnpm exec node node_modules/vitest/vitest.mjs run",
  "typecheck": "pnpm exec node node_modules/typescript/bin/tsc --noEmit && pnpm exec node node_modules/typescript/bin/tsc -p tsconfig.electron.json",
  "build:renderer": "pnpm exec node node_modules/vite/bin/vite.js build",
  "build:electron": "pnpm exec node node_modules/typescript/bin/tsc -p tsconfig.electron.json",
  "build": "pnpm build:renderer && pnpm build:electron",
  "check": "pnpm test && pnpm typecheck && pnpm build && git diff --check"
}
```

Leave development/watch and CLI commands unchanged.

- [x] **Step 3: Verify green package commands.**

Run these commands individually:

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm check
```

Expected: every command exits 0. Record the fresh test count only after `pnpm check` is green.

- [x] **Step 4: Commit the package-gate repair.**

```bash
git add package.json
git diff --cached --check
git commit -m "build: make pnpm quality gate deterministic"
```

Expected: only `package.json` is committed.

## Task 2: Extract Testable Runtime IPC Registration

**Files:** Create `electron/ipc/runtime-ipc-handlers.ts`, `electron/ipc/runtime-ipc-handlers.test.ts`, `electron/preload-contract.test.ts`; modify `electron/main.ts`, `electron/preload.cts`.

- [x] **Step 1: Add a failing injected-IPC test.**

In `electron/ipc/runtime-ipc-handlers.test.ts`, use an in-memory `Map<string, Listener>` registrar. Import a not-yet-existing `registerRuntimeIpcHandlers` and assert an unmanaged path never reaches the shell dependency:

```ts
it('rejects unmanaged artifacts before invoking the opener', async () => {
  const handlers = new Map<string, (event: unknown, request?: unknown) => Promise<unknown>>();
  const openPath = vi.fn();
  registerRuntimeIpcHandlers({ handle: (name, listener) => handlers.set(name, listener) }, {
    loadState: async () => createInitialStudioState(),
    saveState: vi.fn(),
    getRuntimeBundle: () => ({ artifactManager: { isManagedArtifactPath: () => false } }) as unknown as RuntimeBundle,
    getFixtureScriptTrustContext: async () => ({ records: [] }),
    openPath,
    showSaveDialog: vi.fn(),
    getDownloadsPath: () => '/tmp',
  });
  await expect(handlers.get(RUNTIME_IPC_CHANNELS.openArtifact)!({}, '/tmp/outside.png')).rejects.toThrow('只能打开应用生成的证据文件。');
  expect(openPath).not.toHaveBeenCalled();
});
```

Add two tests: Case runs receive Fixture trust only from `getFixtureScriptTrustContext`, and `cancelRun('suite-1')` calls the shared bundle cancellation API.

- [x] **Step 2: Run red.**

Run `pnpm exec node node_modules/vitest/vitest.mjs run electron/ipc/runtime-ipc-handlers.test.ts`.

Expected: FAIL because `runtime-ipc-handlers` does not exist.

- [x] **Step 3: Implement the registrar.**

Create `electron/ipc/runtime-ipc-handlers.ts` exporting:

```ts
export const RUNTIME_IPC_CHANNELS = {
  getInfo: 'runtime:get-info', runTestCase: 'runtime:run-test-case', runSuite: 'runtime:run-suite',
  cancelRun: 'runtime:cancel-run', loadRunDetail: 'runtime:load-run-detail', openArtifact: 'runtime:open-artifact',
  exportArtifact: 'runtime:export-artifact', attachManualEvidence: 'runtime:attach-manual-evidence',
} as const;

export interface RuntimeIpcRegistrar {
  handle(channel: string, listener: (event: unknown, request?: unknown) => Promise<unknown>): void;
}
```

Define injected dependencies for `loadState`, `saveState`, `getRuntimeBundle`, `getFixtureScriptTrustContext`, `openPath`, `showSaveDialog`, and `getDownloadsPath`. Move only the eight matching existing handlers from `electron/main.ts`. Preserve request/response shapes and use `appendRunToStudioState` for actual Case details. Validate managed artifacts before opening/exporting, and throw `打开证据文件失败：${error}` on a nonempty opener error.

- [x] **Step 4: Compose it from main.**

In `registerIpcHandlers()` call:

```ts
registerRuntimeIpcHandlers(ipcMain, {
  loadState: () => getStoreOrThrow().load(),
  saveState: (state) => getStoreOrThrow().save(state),
  getRuntimeBundle: getRuntimeBundleOrThrow,
  getFixtureScriptTrustContext,
  openPath: (artifactPath) => shell.openPath(artifactPath),
  showSaveDialog: (options) => dialog.showSaveDialog(options),
  getDownloadsPath: () => app.getPath('downloads'),
});
```

Remove only duplicate moved handlers. Leave project-asset, session, recording and workflow handlers in `main.ts`.

- [x] **Step 5: Add a failing preload contract test.**

In `electron/preload-contract.test.ts`, mock `electron`, import `./preload.cts`, capture the bridge object, then assert:

```ts
await (exposed.runSuite as (value: unknown) => Promise<unknown>)({ suite: 'one' });
expect(invoke).toHaveBeenCalledWith(RUNTIME_IPC_CHANNELS.runSuite, { suite: 'one' });
```

Assert the same for Case run, cancellation, detail load, open/export artifact, and manual evidence.

- [x] **Step 6: Make preload consume the same channel values.**

If CJS preload cannot directly load the ESM registrar, create `electron/ipc/runtime-ipc-channels.cts` and import it from preload and registrar. Otherwise import the ESM constants. Remove duplicate runtime channel literals from `preload.cts` without changing `DesktopApi`.

- [x] **Step 7: Verify green IPC contracts.**

Run:

```bash
pnpm exec node node_modules/vitest/vitest.mjs run electron/ipc/runtime-ipc-handlers.test.ts electron/preload-contract.test.ts
pnpm typecheck
```

Expected: both tests and both TypeScript projects pass.

- [x] **Step 8: Commit IPC smoke coverage.**

```bash
git add electron/ipc/runtime-ipc-handlers.ts electron/ipc/runtime-ipc-handlers.test.ts electron/preload-contract.test.ts electron/main.ts electron/preload.cts
git diff --cached --check
git commit -m "test: add typed runtime ipc smoke boundary"
```

Expected: stage only paths listed here; do not add pre-existing Suite adapter edits.

## Task 3: Add a Real BrowserRuntime Fixture Smoke

**Files:** Create `electron/runtime/browser-smoke.test.ts`; modify `package.json`, `electron/runtime/browser-runtime.ts`, `electron/runtime/test-runner.ts`, and directly affected runtime tests.

- [x] **Step 1: Write a failing localhost real-browser test.**

Use `node:http` `createServer`, bind `127.0.0.1:0`, and serve:

```html
<title>Fixture</title><main><button id="continue">Continue</button><p id="status">ready</p></main>
```

Build a temporary project and a confirmed deterministic Case that navigates, clicks `#continue`, then asserts `ready`. Call `createRuntimeBundle({ rootDir })` and `runTestCase()`. Assert `passed`, an artifact with `type: 'screenshot'`, positive file size, and bytes 1-4 equal PNG magic `504e47`. Add a Suite test that aborts after Case one begins and asserts current cancellation visibility plus no second browser start.

- [x] **Step 2: Run red before Chromium exists.**

Run `pnpm exec node node_modules/vitest/vitest.mjs run electron/runtime/browser-smoke.test.ts`.

Expected: FAIL with a clear `pnpm exec playwright install chromium` prerequisite. It must not pass through BrowserRuntime's synthetic stub path.

- [x] **Step 3: Add script and explicitly install the browser.**

Add `"test:browser-smoke": "pnpm exec node node_modules/vitest/vitest.mjs run electron/runtime/browser-smoke.test.ts"` to `package.json`, then run `pnpm exec playwright install chromium`.

Expected: Chromium installs. Do not make `pnpm check` download a browser.

- [x] **Step 4: Correct ordinary deterministic evidence.**

Add this public main-process-only method to `BrowserRuntime`:

```ts
async captureRunScreenshot(runId: string): Promise<RunArtifact | null> {
  if (!this.page) return null;
  const artifactPath = await this.captureScreenshotPath(runId);
  await this.page.screenshot({ path: artifactPath, fullPage: true });
  return { type: 'screenshot', label: '运行页面截图', path: artifactPath };
}
```

In `TestRunner`, use it after a real successful browser start. If it returns null, retain `ArtifactManager.createSnapshot()` but label it `synthetic diagnostic`; do not call it a screenshot. Keep cancellation cleanup unchanged.

- [x] **Step 5: Verify smoke and runtime regressions.**

Run:

```bash
pnpm test:browser-smoke
pnpm exec node node_modules/vitest/vitest.mjs run electron/runtime/browser-runtime.test.ts electron/runtime/test-runner.test.ts electron/runtime/suite-runner.test.ts electron/runtime/runtime-bundle.test.ts
```

Expected: smoke uses the local fixture and reads a real PNG; focused regression suite passes.

- [x] **Step 6: Commit browser smoke.**

```bash
git add package.json electron/runtime/browser-smoke.test.ts electron/runtime/browser-runtime.ts electron/runtime/test-runner.ts electron/runtime/browser-runtime.test.ts electron/runtime/test-runner.test.ts
git diff --cached --check
git commit -m "test: add local browser runtime smoke coverage"
```

## Task 4: Add CI and Record Evidence

**Files:** Create `.github/workflows/verify.yml`; modify `docs/2026-08-13-grill-me-application-renovation-plan.md`, `docs/agent-progress-and-target.md`.

- [x] **Step 1: Create GitHub Actions workflow.**

Create `.github/workflows/verify.yml`:

```yaml
name: verify
on:
  pull_request:
  push:
    branches: [main]
jobs:
  quality:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - uses: pnpm/action-setup@v4
        with: { version: 10.11.0, run_install: false }
      - run: pnpm install --frozen-lockfile
      - run: pnpm check
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm test:browser-smoke
```

The workflow must not define model keys, credentials, staging URLs, deployments, or private artifact uploads.

- [x] **Step 2: Verify workflow-referenced commands locally.**

Run:

```bash
pnpm check
pnpm test:browser-smoke
git diff --check
```

Expected: all exit 0. Manually compare the workflow command strings with `package.json`; do not claim hosted CI green until GitHub reports it.

- [x] **Step 3: Update documentation with measured evidence.**

In the Grill Me plan, mark Wave 0 complete only after Step 2 and state: package-local `pnpm check` passed; the workflow uses frozen install plus managed Chromium; smoke uses a localhost confirmed Case, real PNG and Suite cancellation, with no model/business site. Include fresh test count/date. In `agent-progress-and-target.md`, mark local quality verification complete but retain external model/business acceptance as unperformed.

- [x] **Step 4: Final verification and commits.**

Run:

```bash
pnpm check
pnpm test:browser-smoke
git diff --check
git status --short
```

Expected: commands exit 0 and diff check is silent. Inspect status to ensure no pre-existing Suite files are staged. Commit in two focused commits:

```bash
git add .github/workflows/verify.yml
git diff --cached --check
git commit -m "ci: verify pnpm quality and browser smoke"
git add docs/2026-08-13-grill-me-application-renovation-plan.md docs/agent-progress-and-target.md
git diff --cached --check
git commit -m "docs: record wave zero verification baseline"
```

## Completion Checklist

- [x] `pnpm check` passes without root `.bin` dependency.
- [x] CI freezes installation, runs quality checks and explicit Chromium smoke.
- [x] Registered runtime IPC and preload use matching typed channel names.
- [x] Unmanaged renderer paths cannot reach the system artifact opener.
- [x] Local Chromium executes a confirmed Case against localhost and produces PNG evidence.
- [x] Suite cancellation is exercised without model keys or external pages.
- [x] Documentation reflects fresh evidence and not a claim of external acceptance.
