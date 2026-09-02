# Desktop UI Repair Baseline

> Captured: 2026-09-02
> Environment: local Electron workbench, model configuration complete
> Baseline viewport: `1200 x 760`
> Evidence source: live Computer Use inspection; the detailed page coverage is recorded in [the functional audit](2026-09-02-desktop-ui-functional-audit.md).

## Baseline states

| State | Expected primary interaction | Observed baseline | Screenshot record | Repair predicate |
| --- | --- | --- | --- | --- |
| Natural Language, standby and connected session | Command textarea, send, and save-as-step controls remain visible above the fold. | AX exposes all controls, but the browser viewport did not show the command composer at this height. | Computer Use inspection; no repo screenshot persisted. | Textarea, send, and save-as-step are simultaneously visible; only chat history scrolls. |
| Settings, MidScene and Agent models | The last form control and connection test can be reached without being covered by the footer. | AX exposes the lower controls, but the modal body clips them behind the footer. | Computer Use inspection; no repo screenshot persisted. | Last form control scrolls at least 16px above the footer; every setting section reaches its final control. |
| Run records with zero samples | A neutral waiting state explains that no conclusion exists yet. | Green passed presentation and waiting-sample copy are displayed together. | Computer Use inspection. | No passed color, passed label, or non-zero rate when sample count is zero. |
| Recording with browser `idle` | A start action communicates that no browser evidence exists. | The state reports idle while the stage claims the controlled browser is ready and lists mock interactions. | Computer Use inspection. | Idle has no ready claim, fabricated interaction count, or recording-in-progress badge. |

## Required verification matrix

| Viewport | States required for repair acceptance |
| --- | --- |
| `1200 x 760` | All baseline states above; project configuration; Workflow and documents zero-asset states. |
| `1280 x 800` | All first-page views; all Settings sections; three-column workbenches. |
| `1440 x 900` | Populated Editor and Execution density plus Evidence Rail. |
| `1024 x 768` | No hidden sole action, sole evidence, or essential configuration field. |

## Automated baseline

- `pnpm lint`: passed before implementation.
- Initial `pnpm test`: failed because Vitest discovered `.worktrees/optimize-codebase` and mixed its React installation with the root renderer. This was reproduced with explicit Natural Language and Settings test paths.
- A dedicated regression test now requires `vitest.config.ts` to exclude `.worktrees/**`; after that change, the regression test plus Natural Language and Settings focused suites passed.
- A second full `pnpm test` run remained active beyond the bounded baseline window without emitting a terminal result. Its two verified Node workers were terminated so the UI repair work could proceed.

## Repair verification

| Area | Evidence | Result |
| --- | --- | --- |
| Natural Language and Settings geometry | Focused DOM assertions locate the composer actions and the last Settings control; live Computer Use inspection covered the repaired states before the desktop surface reloaded. | Passed |
| Zero-data quality states | Home, Run Records, and Recording tests assert neutral/no-evidence states. Run Records additionally asserts that a zero-test-case project cannot render a cross-run passing conclusion. | Passed |
| Empty workbenches and disabled actions | Documents, Cases, Flows, Suites, Workflow, and Maintenance focused tests cover the single next action and adjacent run blockers. | Passed |
| Project configuration | Project feature suite and Computer Use inspection cover the four task tabs, one active tabpanel, and native-disabled credential actions. | Passed |
| Renderer and Electron typing | `pnpm typecheck` | Passed |
| Lint | `pnpm lint` | Passed |
| Renderer and Electron build | `pnpm build` | Passed; Vite reports the existing 544.70 kB initial JavaScript chunk warning. |
| Browser smoke | `pnpm test:browser-smoke` | Passed, 3/3 tests. |
| Main test suite | First Vitest stage of `pnpm test` | Passed, 94 files and 1031 tests. |
| 100-Case runtime benchmark | The unchanged `main` baseline and this repair branch both exceed the 128 MiB heap-growth limit. Baseline: 135,046,024 B. Repair branch: 275,230,400 B. | Existing runtime release risk; excluded from this renderer-only repair scope. |
| Duplicate scan | `pnpm quality:duplicates` reports 139 clones: 2.51% duplicated lines and 2.72% duplicated tokens. The configured 0% threshold returns non-zero. | Existing quality baseline, primarily in untouched Electron/runtime boundaries; no high-risk runtime extraction was included in this UI repair. |

## Remaining visual verification

The local preview does not contain a desktop-only model secret, so gated destinations correctly open Settings instead of exposing their pages. During the final Electron Computer Use pass, the desktop renderer reloaded and stopped publishing an accessibility tree. Continuing to send UI input after that state change would not be reliable evidence.

The final visual matrix remains partially complete. A manually started desktop session with its normal model configuration should re-check Workflow and Recording at `1200 x 760`, `1280 x 800`, `1440 x 900`, and `1024 x 768`, in light and dark themes, before a release claim is made. No secret, project asset, storage state, or runtime execution was changed during this audit.
