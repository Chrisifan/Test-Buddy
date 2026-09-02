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
- A second full `pnpm test` run remained active beyond the bounded baseline window without emitting a terminal result. Its two verified Node workers were terminated so the UI repair work could proceed. Full-suite status remains **not verified** and is a required final acceptance gate.
