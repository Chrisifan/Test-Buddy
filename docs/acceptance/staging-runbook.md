# Protected Staging And Model Acceptance Runbook

## Scope

Use this procedure only for a named staging or model lane that a release matrix marks as required. The repository local-fixture lane is separate and never substitutes for either external lane.

The current `protected external acceptance` workflow is intentionally a manual authorization preflight. It validates protected-environment configuration and then fails closed because this repository does not yet include an external executor. It does not contact a staging origin, model provider, or production service. Do not treat a manually dispatched workflow as acceptance evidence.

## Protected Environment Setup

Create the GitHub Environments `acceptance-staging` and `acceptance-model`. Require the environment owner's review before a job can receive secrets. Restrict deployment branches to the reviewed release commit and configure a single concurrency slot per lane.

Store only these secret names in the corresponding protected environment:

| Secret | Staging | Model | Requirement |
| --- | --- | --- | --- |
| `TESTBUDDY_ACCEPTANCE_CONSENT` | `1` | `1` | Exact literal required by the runner. |
| `TESTBUDDY_ACCEPTANCE_ALLOWED_ORIGIN` | required | required | One exact `http` or `https` origin, with no path, query, fragment, or user info. |
| `TESTBUDDY_ACCEPTANCE_MODEL_SECRET_REF` | optional | required | Non-empty reference resolved only by a future protected main-process executor; never a key value. |

Do not place a credential, endpoint URL, browser profile, storage state, raw prompt, or test-data export in repository variables, workflow inputs, issue text, or reports. The environment's allowlisted origin and secret reference must never be printed by a workflow step.

## Manual Dispatch

1. Confirm the release matrix marks the selected `staging` or `model` lane as required and that the exact commit SHA is approved for execution.
2. Reset test data using the target owner's documented, isolated reset procedure. Do not use production data or modify Case/Suite assets as part of reset or diagnosis.
3. Pin the browser/runtime revision; for the model lane also record the approved model fingerprint without recording a key, prompt, or provider response.
4. From GitHub Actions, dispatch `protected external acceptance`, select exactly one lane, and type `RUN_EXTERNAL_ACCEPTANCE` as the consent input. The protected environment review is the final authorization boundary.
5. Expect the current workflow to fail closed after preflight. Its result establishes neither a pass nor a failure for the external lane; retain `stagingAcceptanceNotRun` or `modelAcceptanceNotRun` in the release decision.

## Executor And Evidence Requirements

An external executor may be enabled only in a separately reviewed change. It must resolve the protected model secret reference in the main process, run against only the exact allowlisted origin, and write redacted JSON/JUnit reports that pass `verify-acceptance-report`.

Before a release claim, verify ten numbered attempts containing twenty distinct version-pinned desktop/CLI pairs each. Every pair must have matching passed status, provenance hash, and sorted manifest hashes; there must be no retry, flaky marker, failed, blocked, error, cancelled, or skipped terminal member. Record the report hash, matrix hash, project revision, browser/runtime fingerprint, model fingerprint where applicable, evidence retention decision, and a deliberate human conclusion in the release gate template.

Retain only redacted acceptance reports for the approved retention period of the protected environment. Never upload browser user data, storage state, raw prompts, endpoint values, secrets, screenshots beyond the redacted manifest policy, or application artifacts by default.

## Incident Handling

Stop the lane if target scope, consent, allowlist, browser/runtime pin, model reference, report validation, or evidence handling is uncertain. Mark the lane `notRun`, `incomplete`, or failed according to the validated report; do not infer a passing result from a local build or preflight.

Create a Maintenance draft for investigation and attach only redacted references permitted by the evidence policy. A failed acceptance investigation never writes directly to a Case or Suite asset, and no endpoint, credential, raw prompt, storage state, or user data belongs in the incident record.
