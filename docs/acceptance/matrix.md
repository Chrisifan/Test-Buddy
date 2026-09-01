# Acceptance Matrix

Acceptance evidence is classified by target lane. A green local lane is not evidence for a staging system or model provider.

| Lane | Owner | Execution boundary | Required evidence | Claim when absent |
| --- | --- | --- | --- | --- |
| `localFixture` | Repository CI | Test-owned local fixture only | 20 version-pinned desktop/CLI pairs across 10 stable attempts | Local release claim blocked |
| `staging` | Protected staging environment owner | Manual dispatch, explicit consent, exact origin allowlist | Same pair/stability record plus protected-environment conclusion | `stagingAcceptanceNotRun` |
| `model` | Protected model environment owner | Manual dispatch, explicit consent, main-owned secret resolution | Same pair/stability record plus model/runtime fingerprints | `modelAcceptanceNotRun` |

The matrix stores configuration fingerprints, Suite and Case references, project revisions, provenance hashes, manifest hashes, terminal summaries, retry/flaky flags, and an enumerated human conclusion. It never stores target URLs, credential references or values, raw prompts, storage state, artifact paths, or free-form incident text.

An external lane is a release requirement only when the submitted matrix marks it `requiredForRelease`. The evaluator preserves every configured but unrun lane as `notRun`; it does not infer a fallback to local fixtures.
