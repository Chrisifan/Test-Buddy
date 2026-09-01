# Release Gate

## Deterministic Threshold

A completed lane has exactly ten numbered attempts. Every attempt contains exactly twenty distinct Case version pairs. Each desktop/CLI pair must have matching passed terminal status, provenance hash, and sorted artifact-manifest hashes.

The lane also requires zero `failed`, `blocked`, `error`, `cancelled`, and `skipped` terminal members; zero retries; no flaky marker; and the enumerated human conclusion `accepted`. Any mismatch, incomplete run, or missing evidence hash prevents a passing lane result.

## Claims

`readyForLocalReleaseClaim` means the CI-owned local fixture lane met the deterministic threshold and no external lane is marked release-required. It is not a staging or model acceptance claim.

`readyForReleaseClaim` additionally requires every explicitly release-required staging/model lane to meet the same threshold. Missing work is reported as `stagingAcceptanceNotRun` or `modelAcceptanceNotRun`, never as pass/fail by implication.

## Evidence Handling

The required local CI job runs `pnpm acceptance:local` only after Chromium smoke coverage. That command may bind only the repository-owned loopback fixture and must produce a hash-verified report before the job can pass. Each run keeps its JSON/JUnit evidence in a new `.acceptance/local/runs-*` directory; `pnpm acceptance:verify` validates the newest complete retained pair without replacing older evidence.

External lanes are manual-only and use the `acceptance-staging` or `acceptance-model` protected GitHub Environment. A dispatch must supply `RUN_EXTERNAL_ACCEPTANCE`, while the environment supplies an exact `TESTBUDDY_ACCEPTANCE_ALLOWED_ORIGIN` and `TESTBUDDY_ACCEPTANCE_CONSENT=1`. The model lane additionally requires a non-empty `TESTBUDDY_ACCEPTANCE_MODEL_SECRET_REF`; this is a reference owned by the protected main-process executor, never a model key.

The workflow validates those preconditions but deliberately fails closed until a protected external executor writes a redacted, hash-verified report. A successful dispatch is not an acceptance result, and no staging/model conclusion may be recorded from it alone. Reports, when an executor is added, are retained only as redacted JSON/JUnit evidence; browser profiles, storage state, raw prompts, application artifacts, endpoint values, and secret values are never uploaded.

## Decision Record

| Field | Value |
| --- | --- |
| Commit SHA | `not claimed` |
| Matrix hash | `not claimed` |
| Project revision | `not claimed` |
| Browser/runtime fingerprint | `not claimed` |
| Model fingerprint | `not claimed` |
| 20-pair result | `not claimed` |
| 10-attempt stability result | `not claimed` |
| Manifest evidence retention | `not claimed` |
| Known flaky count | `not claimed` |
| Staging conclusion | `notRun` |
| Model conclusion | `notRun` |
| Protected environment approval | `not claimed` |
| Consent and exact-origin preflight | `not claimed` |
| Report hash verification | `not claimed` |
| Release owner conclusion | `not claimed` |

The record is populated only from a redacted, hash-verified report and a deliberate release-owner conclusion. A failed acceptance investigation creates a maintenance draft; it never writes directly to a Case or Suite asset.
