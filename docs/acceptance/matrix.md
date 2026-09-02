# Acceptance Matrix

Acceptance evidence is classified by target lane. A green local lane is not evidence for a staging system or model provider.

| Lane | Owner | Execution boundary | Required evidence | Claim when absent |
| --- | --- | --- | --- | --- |
| `localFixture` | Repository CI | Test-owned local fixture only | 20 version-pinned desktop/CLI pairs across 10 stable attempts | Local release claim blocked |
| `staging` | Protected staging environment owner | Manual dispatch, explicit consent, exact origin allowlist | Same pair/stability record plus protected-environment conclusion | `stagingAcceptanceNotRun` |
| `model` | Protected model environment owner | Manual dispatch, explicit consent, main-owned secret resolution | Same pair/stability record plus model/runtime fingerprints | `modelAcceptanceNotRun` |

The matrix stores configuration fingerprints, Suite and Case references, project revisions, provenance hashes, manifest hashes, terminal summaries, retry/flaky flags, and an enumerated human conclusion. It never stores target URLs, credential references or values, raw prompts, storage state, artifact paths, or free-form incident text.

An external lane is a release requirement only when the submitted matrix marks it `requiredForRelease`. The evaluator preserves every configured but unrun lane as `notRun`; it does not infer a fallback to local fixtures.

## Desktop UI Repair Evidence

This renderer-only repair is recorded separately from the protected runtime lanes above. It does not authorize an external acceptance conclusion.

| Check | Result | Notes |
| --- | --- | --- |
| `pnpm lint` | Passed | Fresh run on `codex/desktop-ui-repair`. |
| `pnpm typecheck` | Passed | Renderer and Electron TypeScript projects both pass. |
| Main Vitest stage | Passed | 94 files and 1031 tests pass before the runtime benchmark stage. |
| `pnpm build` | Passed | Vite retains an existing 544.70 kB initial-chunk warning. |
| `pnpm test:browser-smoke` | Passed | 3/3 tests. |
| 100-Case runtime benchmark | Not accepted | The unchanged main baseline also fails the 128 MiB heap-growth gate, so this is a pre-existing runtime risk outside the renderer-only scope. |
| Duplicate scan | Not accepted | `pnpm quality:duplicates` reports 139 clones, mostly in untouched Electron/runtime boundaries, against a configured 0% threshold. |
| Final Computer Use matrix | Partially observed | The desktop renderer reloaded during the final inspection and the preview correctly gated model-dependent pages because it has no desktop secret. Re-run the remaining Workflow and Recording views in a configured desktop session before release. |
