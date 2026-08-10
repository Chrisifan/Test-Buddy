# Confirmed Deterministic Case Execution Design

## 1. Objective

Execute only user-confirmed V2 deterministic steps from a saved test case without invoking the Planner, Midscene, Verifier, or Reporter. This first slice supports `navigate`, selector `click`, selector/timeout `wait`, and selector `scroll`.

The feature converts a confirmed persisted action into a preconstructed `AgentPlanStepDraft`, reuses the existing `BrowserRuntime` action and evidence path, and writes the resulting child Agent Run into the parent case run. It does not parse legacy text, create browser actions from free text, or make an incomplete/needs-review V2 draft executable.

## 2. Scope and Non-goals

In scope:

- A `TestStepDraft.execution` action runs only when `reviewStatus` is `confirmed`.
- The supported actions are `navigate`, `click`, `waitForSelector`, `waitForTimeout`, and `scrollTo`.
- Mixed cases retain source order across recording replay, confirmed deterministic steps, model-backed AI steps, and manual steps.
- A deterministic step requires a real Playwright page. BrowserRuntime stub/fallback sessions return `neutral` with no browser action and stop the remaining case steps.
- A deterministic failure stops execution. It does not retry, selector-fallback, replan, call a model, or generate recovery actions.
- Parent `RunDetail`, child Agent Runs, artifacts, cancellation, and unexecuted-step records remain on the existing TestRunner path.

Out of scope:

- Input/select execution, including variable, fixture, credential, or secret binding.
- Explicit V2 assertion execution, model-free query extraction, conditionals, loops, suites, fixtures, or project-directory persistence.
- V2 editor controls. This slice respects already-persisted `confirmed` drafts but does not add a UI to set the state.
- Browser behavior verification against a real business page.

## 3. Architecture

`shared/studio.ts` owns a pure eligibility and conversion boundary. It accepts only a confirmed V2 execution draft and produces a prebuilt plan step from structured fields. Unsupported kinds and malformed locators return no step.

`StudioRuntime.runDeterministicStep()` owns the execution boundary. It receives the prebuilt step and existing run context, verifies that BrowserRuntime exposes a real page before dispatch, executes exactly once through `prepareBrowserForAgent()`, converts the result with existing `toPlannedStepExecution()`, and builds a child Agent Run. The deterministic path bypasses Planner, Midscene, Verifier, Reporter, retry, selector fallback, and replanning.

`TestRunner` chooses this path before the legacy AI workflow branch. `RuntimeBundle` sends a case with any confirmed deterministic step to TestRunner rather than the all-AI Workflow fast path. Pure AI cases, exclusive recording cases, and manual cases retain their current routing.

```text
confirmed V2 action
  -> shared structured conversion
  -> TestRunner serial dispatch
  -> StudioRuntime deterministic child run
  -> BrowserRuntime real-page guard and one action
  -> Agent Run evidence
  -> parent RunDetail aggregation
```

## 4. Data and Status Rules

- `needsReview` drafts and absent execution drafts remain model-backed or neutral according to the existing step type.
- Any `ai` step with `execution.reviewStatus === 'confirmed'` is a V2-owned step and must not enter `testCaseToWorkflow()`. A white-listed action can execute; an unsupported or malformed confirmed action remains `neutral` with an explicit unsupported-action reason. It never falls back to Planner or free-text action parsing.
- The deterministic child Agent Run uses the existing source step type `ai`, with an action generated from the structured V2 draft. No new source type is necessary.
- A missing BrowserRuntime observer, observer without `hasRealPage()`, or `hasRealPage() === false` returns one neutral child run and must not call `navigate`, `click`, `wait`, or `scroll`.
- A completed action produces the existing action/observation/artifact evidence. Failure or neutral status prevents dispatch of later steps, which retain the existing unexecuted-neutral message.
- Cancellation remains `neutral` and uses the current cancellation payload. A cancellation never triggers a new action or retry.

## 5. Compatibility and Safety

- Persisted V1 and V2 case hydration remains unchanged.
- The all-AI Workflow fast path remains valid only when every AI-family step still requires a model.
- TestRunner continues to start the controlled session and own parent result aggregation; the deterministic child does not open a competing browser context.
- The real-page guard and the confirmed-V2 no-model boundary belong only to the deterministic path, so no unrelated legacy Agent behavior changes.
- Runner code must not promote a stub snapshot, a selector string, or an action request into a passing result without a real Playwright page.

## 6. Verification

- Pure shared tests cover eligibility, conversion, mixed-case routing, review status, and unsupported actions.
- StudioRuntime tests cover no Planner/Midscene/Verifier/Reporter calls, real-page success, failure stop, and stub neutral-without-dispatch.
- TestRunner tests cover serial mixed execution, evidence aggregation, cancellation, and no subsequent step after a deterministic non-pass.
- RuntimeBundle tests cover deterministic cases bypassing the Workflow fast path while legacy all-AI and exclusive recording routing stays unchanged.
- Run unit tests, type checking, build, and `git diff --check`; do not start the app, call models, or visit business pages.
