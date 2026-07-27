# Planner Replanning Evidence History Design

## Context

`StudioRuntime.sendChatCommand()` currently clears the accumulated planned-step executions after Planner replanning succeeds. The revised plan can finish successfully, but the resulting `AgentRunResult` then omits the observations, verification results, dynamic waits, retries, selector fallback attempts, screenshots, and reports that caused the plan to change. Metrics still report a replanning cycle, so the run record and Reporter cannot explain that metric with evidence.

## Goals

- Preserve an ordered, structured history for every completed replanning cycle.
- Keep the final revised plan as `AgentRunResult.plan` and keep its step indexes independent from abandoned plans.
- Let Run Records and Reporter explain which failure triggered each revision and which evidence supported it.
- Retain screenshots and report artifacts produced before replanning without duplicating paths.
- Keep a recovered run `passed` when every step in the final plan passes.

## Non-Goals

- Do not change when Planner may replan or how `replanningCycleLimit` is enforced.
- Do not make an earlier recoverable failure determine the final run status.
- Do not invoke Reporter for runs that already finish as `passed`.
- Do not redesign Run Records; the existing event selection and evidence panel should consume the new event and linked step evidence.
- Do not persist a separate top-level plan-history collection in `AgentRunResult` when the ordered event stream already provides that public contract.

## Chosen Approach

Use a dedicated internal replanning-history record and expose each successful revision through a structured `agent:plan-revised` event.

This keeps final-plan executions compatible with the existing `stepIndex` mapping. Treating abandoned executions as final-plan executions would require cycle-aware indexes throughout the run assembler and consumers. Folding revision data into retry events would also blur the distinction between retrying one deterministic action and asking Planner to produce a new plan.

## Data Contracts

### Internal assembly record

Add `PlannedAgentReplanningRecord` beside `PlannedAgentStepExecution` in `shared/agentStub.ts`:

```ts
interface PlannedAgentReplanningRecord {
  cycle: number;
  previousPlan: AgentPlanDraft;
  revisedPlan: AgentPlanDraft;
  executions: PlannedAgentStepExecution[];
  failedStepIndex: number;
}
```

`executions` contains the completed evidence from the outgoing plan up to and including the non-passing step. `failedStepIndex` identifies the revision trigger without requiring consumers to infer it. `PlannedAgentRunRequest` receives these records through an optional `replanningHistory` array so existing callers remain compatible.

### Public event payload

Add `agent:plan-revised` to `AgentRunEventType` and add an optional structured payload to `AgentRunEvent`:

```ts
interface AgentPlanRevision {
  cycle: number;
  previousPlanTitle: string;
  revisedPlanTitle: string;
  triggerStepId: string;
  triggerStepTitle: string;
  triggerStatus: AgentRunStatus;
  failureReason?: string;
  failureCategory?: AgentFailureCategory;
  recoveryStrategy?: AgentRecoveryStrategy;
}
```

The revision event also uses `stepId: triggerStepId`. This lets the existing Run Records evidence lookup associate the selected revision with the historical observation, verification, browser snapshot, and artifact events for the trigger step.

## Runtime Data Flow

1. `StudioRuntime` starts with an empty `replanningHistory` array.
2. When a non-passing execution produces a revised plan, the runtime records the outgoing plan, all executions accumulated in that cycle, the failed step index, and the revised plan before clearing the working execution array.
3. The runtime continues executing the revised plan with indexes starting from zero, preserving existing retry, selector fallback, and replanning-limit behavior.
4. `createPlannedAgentRun()` receives the final plan, final executions, and ordered replanning history.
5. `AgentRunResult.plan` remains the final plan. Status, final summary, and failure reason are calculated only from final-plan executions.

## Event Ordering And Identity

The run assembler emits events in actual execution order:

1. `agent:plan-created` for the initial plan.
2. The first outgoing plan's execution evidence, including waits, retries, selector fallback, browser action, observation, artifacts, verification, and failure.
3. `agent:plan-revised` for cycle 1.
4. The next outgoing plan's evidence followed by its revision event, repeated for further cycles.
5. The final plan's execution evidence.
6. Final verification and `agent:run-finished`.

Historical step IDs include the cycle and original step index, for example `agent-run-...-replan-1-step-2`. Final-plan step IDs retain the existing `agent-run-...-step-planned-2` form. Event, observation, verification, and artifact IDs derive from those step IDs so multiple cycles cannot collide.

The plan attached to `agent:plan-created` is the initial plan, while `AgentRunResult.plan` is the final plan. Each revision event provides the ordered bridge between them.

## Artifacts And Reporter

Historical and final executions share one artifact-path set during assembly. A screenshot or report path is added to `AgentRunResult.artifacts` once, even when multiple events reference the same browser snapshot. Historical observations still retain their `screenshotPath`, so selecting their event resolves the evidence even when the artifact was already registered.

When Reporter is invoked for a final `failed` or `neutral` run, its serialized event input includes `planRevision` in addition to the existing observation, verification, and artifact fields. Recovered `passed` runs keep the history in Run Records but do not add a new Reporter call.

## Error And Status Semantics

- A successful revision event has status `neutral`: the triggering verification remains `failed` or `neutral`, while the revision itself is recovery context rather than a test verdict.
- If the final revised plan passes, the run status is `passed` and no earlier failure is promoted to `AgentRunResult.failureReason`.
- If replanning reaches its limit, Planner returns no revision, or the final plan fails, the current execution remains in the final execution list and determines the final status as it does today.
- Missing or invalid historical indexes are ignored defensively during assembly; they must not prevent final-plan evidence from being returned.
- Artifact paths remain deduplicated across all cycles.

## Testing Strategy

Follow test-driven development with these regression cases:

1. A runtime test starts with a failing selector or navigation plan, replans successfully, and verifies that the final run is `passed` while the first failure, observation, screenshot, and `agent:plan-revised` event remain present.
2. A run-assembler test verifies chronological ordering, cycle-specific IDs, structured revision payloads, and artifact-path deduplication.
3. A multi-cycle runtime test verifies that every cycle is preserved once and that `metrics.replanningCycles` remains unchanged.
4. A final-failure test verifies that only the unrecovered final execution determines `failureReason`, while earlier failures remain evidence history.
5. A Reporter test verifies that serialized model input includes the structured revision payload for a non-passing run.
6. Existing focused suites, the complete test suite, the production build, and `git diff --check` must pass.

## Acceptance Criteria

- No execution evidence is discarded solely because Planner produced a revised plan.
- Every successful replanning cycle has one structured `agent:plan-revised` event.
- Selecting the revision or its trigger step in Run Records exposes the linked historical evidence.
- Recovered runs remain `passed`; unrecovered final failures retain existing status behavior.
- Reporter can explain plan changes from structured events when it is invoked.
- Screenshots and reports from abandoned plans remain available without duplicate artifact paths.
