import type {
  RunDetail,
  RunArtifact,
  RunEventPayload,
  RunReason,
  RunStatus,
  RunStepLog,
  VersionedTestAssetReference,
  FixtureAsset,
  FixtureHttpJsonValue,
  FixtureLifecycleEvidence,
  RunTestCaseRequest,
  RunTestCaseResponse,
  RunRecordingRequest,
  RunRecordingResponse,
  RunWorkflowResponse,
  RecordingAsset,
  StepType,
  DeterministicFileReference,
  TestStepDraft,
} from '../../shared/studio.js';
import {
  getConfirmedDeterministicTestInputBinding,
  getConfirmedDeterministicTestStep,
  getConfirmedExplicitTestAssertion,
  getTestCaseFixtureRunBlocker,
  getTestCasePrdPath,
  normalizeFixtureHttpDeclaration,
  resolveTestCaseReusableFlows,
  resolveTestCaseFixtures,
} from '../../shared/studio.js';
import type { AgentPlanStepDraft, AgentRunResult } from '../../shared/agent.js';
import type {
  DeterministicInputBindingResolver,
  RunDeterministicStepRequest,
  RunDeterministicStepResponse,
} from '../studioRuntime.js';
import type {
  LazyModelConfigResolver,
  ResolvedAgentModelConfig,
  ResolvedMidsceneConfig,
  ResolvedRunWorkflowRequest,
} from './model-config-resolver.js';
import {
  awaitWithRunCancellation,
  createUserRunCancellation,
  isRunCancelled,
  throwIfRunCancelled,
} from './run-cancellation.js';
import { createTestCaseAgentRun } from '../../shared/agentStub.js';
import { ArtifactManager } from './artifact-manager.js';
import { BrowserRuntime } from './browser-runtime.js';
import type { FixtureLifecycleExecutor, FixtureLifecycleExecutionResult } from './fixture-http-executor.js';
import {
  isControlledDeterministicInteraction,
  validateDeterministicPersistenceSurfaces,
  validateDeterministicSteps,
  type DeterministicInteractionPreflightPolicyProvider,
} from './deterministic-step-contract.js';

interface RecordingReplayRunner {
  run(request: RunRecordingRequest): Promise<RunRecordingResponse>;
}

interface WorkflowSegmentRunner {
  runWorkflow(request: ResolvedRunWorkflowRequest): Promise<RunWorkflowResponse>;
}

interface MainRunTestCaseRequest extends Omit<RunTestCaseRequest, 'midsceneConfig' | 'agentModelConfig'> {
  midsceneConfig?: ResolvedMidsceneConfig;
  agentModelConfig?: ResolvedAgentModelConfig;
  modelConfigResolver?: LazyModelConfigResolver;
}

interface DeterministicStepRunner {
  runDeterministicStep(request: RunDeterministicStepRequest): Promise<RunDeterministicStepResponse>;
}

export class TestRunner {
  constructor(
    private readonly artifacts: ArtifactManager,
    private readonly browserRuntime: BrowserRuntime,
    private readonly emitRunEvent: (event: RunEventPayload) => void,
    private readonly recordingRunner?: RecordingReplayRunner,
    private readonly workflowRunner?: WorkflowSegmentRunner,
    private readonly deterministicRunner?: DeterministicStepRunner,
    private readonly fixtureExecutor?: FixtureLifecycleExecutor,
    private readonly interactionPreflightPolicy?: DeterministicInteractionPreflightPolicyProvider,
  ) {}

  async run(request: MainRunTestCaseRequest): Promise<RunTestCaseResponse> {
    const runId = request.runId ?? `run-${Date.now()}`;
    try {
      return await this.runWithCleanup({ ...request, runId });
    } finally {
      await this.browserRuntime.releaseControlledRouteMocks?.(runId);
    }
  }

  private async runWithCleanup(request: MainRunTestCaseRequest & { runId: string }): Promise<RunTestCaseResponse> {
    const runId = request.runId;
    const startedAt = new Date();
    let suppliedPolicy: Awaited<ReturnType<DeterministicInteractionPreflightPolicyProvider['resolve']>> = {};
    let knownSecrets: readonly string[] = [];
    let policyResolved = false;
    const resolvedUploadPaths = new Map<string, string>();
    const resolveInteractionPolicy = async (): Promise<boolean> => {
      if (policyResolved) {
        return true;
      }
      if (!this.interactionPreflightPolicy) {
        return false;
      }
      try {
        suppliedPolicy = await this.interactionPreflightPolicy.resolve({
          projectId: request.project.id,
          environmentId: request.environment.id,
          testCaseId: request.testCase.id,
        });
        knownSecrets = suppliedPolicy.knownSecrets ?? [];
        policyResolved = true;
        return true;
      } catch {
        return false;
      }
    };
    const resolvedSecretIssue = (steps: readonly TestStepDraft[]) =>
      validateDeterministicPersistenceSurfaces({
        steps,
        logs: [request.project.name, request.testCase.name, request.environment.name, request.environment.url],
      }, { knownSecrets })[0];
    const hasControlledInteraction = (steps: readonly TestStepDraft[]) =>
      steps.some((step) => isControlledDeterministicInteraction(step.execution?.action));
    const hasUnconfirmedControlledInteraction = (steps: readonly TestStepDraft[]) =>
      steps.some((step) =>
        step.execution?.reviewStatus === 'needsReview' &&
        isControlledDeterministicInteraction(step.execution.action),
      );
    const hasMalformedActionBlock = (steps: readonly TestStepDraft[]) =>
      steps.some((step) => step.preflightBlockReason === 'malformedAction');
    const resolveApprovedUploadReferences = async (steps: readonly TestStepDraft[]) => {
      if (!this.interactionPreflightPolicy?.resolveUpload) {
        return;
      }
      const references = steps.flatMap((step) => {
        const action = step.execution?.action;
        return action?.kind === 'upload' ? [action.fileRef] : [];
      });
      const selected = new Map<string, DeterministicFileReference & { byteCount: number }>();
      for (const reference of references) {
        const key = deterministicFileReferenceKey(reference);
        if (selected.has(key)) {
          continue;
        }
        try {
          const resolved = await this.interactionPreflightPolicy.resolveUpload({
            projectId: request.project.id,
            environmentId: request.environment.id,
            testCaseId: request.testCase.id,
            reference,
          });
          if (!Number.isSafeInteger(resolved.byteCount) || resolved.byteCount < 0 || !resolved.path) {
            continue;
          }
          resolvedUploadPaths.set(key, resolved.path);
          selected.set(key, { ...reference, byteCount: resolved.byteCount });
        } catch {
          // The validator fails closed with unapprovedUploadReference.
        }
      }
      if (selected.size) {
        const approved = new Map((suppliedPolicy.uploadReferences ?? []).map((reference) => [deterministicFileReferenceKey(reference), reference]));
        selected.forEach((reference, key) => approved.set(key, reference));
        suppliedPolicy = { ...suppliedPolicy, uploadReferences: [...approved.values()] };
      }
    };
    const initialControlledInteraction = hasControlledInteraction(request.testCase.steps);

    if (hasMalformedActionBlock(request.testCase.steps)) {
      return this.createMalformedActionBlockedResponse(request, runId, startedAt);
    }
    if (hasUnconfirmedControlledInteraction(request.testCase.steps)) {
      return this.createUnconfirmedActionBlockedResponse(request, runId, startedAt);
    }
    if (initialControlledInteraction) {
      if (!await resolveInteractionPolicy()) {
        return this.createInteractionPolicyUnavailableResponse(request, runId, startedAt);
      }
      if (resolvedSecretIssue(request.testCase.steps)) {
        return this.createResolvedSecretBlockedResponse(request, runId, startedAt);
      }
    }

    const flowResolution = resolveTestCaseReusableFlows(request.project, request.testCase);
    if (flowResolution.issues.length) {
      const issue = flowResolution.issues[0]!;
      const reasonCode: RunReason['code'] = issue.kind === 'missingFlow'
        ? 'missingAssetVersion'
        : 'unsupportedAction';
      const { title, logs } = this.emitRunStart(request, runId, startedAt);
      return this.createPreflightBlockedResponse(
        request,
        runId,
        title,
        startedAt,
        logs,
        `可复用流程前置条件未满足：${issue.message}`,
        [],
        reasonCode,
      );
    }
    const flowOriginByStepId = new Map<string, VersionedTestAssetReference>();
    const flowSteps = flowResolution.flows.flatMap((flow) => flow.steps.map((step) => {
      const id = `${flow.id}@${flow.version}/${step.id}`;
      flowOriginByStepId.set(id, { id: flow.id, version: flow.version });
      return { ...structuredClone(step), id };
    }));
    request = {
      ...request,
      testCase: {
        ...request.testCase,
        steps: [...flowSteps, ...request.testCase.steps],
      },
    };

    if (hasMalformedActionBlock(request.testCase.steps)) {
      return this.createMalformedActionBlockedResponse(request, runId, startedAt);
    }
    if (hasUnconfirmedControlledInteraction(request.testCase.steps)) {
      return this.createUnconfirmedActionBlockedResponse(request, runId, startedAt);
    }
    if (hasControlledInteraction(request.testCase.steps)) {
      // Every structured interaction is rejected before fixture setup or browser startup.
      if (!await resolveInteractionPolicy()) {
        return this.createInteractionPolicyUnavailableResponse(request, runId, startedAt);
      }
      if (resolvedSecretIssue(request.testCase.steps)) {
        return this.createResolvedSecretBlockedResponse(request, runId, startedAt);
      }
      await resolveApprovedUploadReferences(request.testCase.steps);
      const interactionIssue = validateDeterministicSteps(request.testCase.steps, {
        baseUrl: request.environment.url,
        allowedTabOrigins: [originFor(request.environment.url)].filter((origin): origin is string => Boolean(origin)),
        allowedNetworkHosts: [hostFor(request.environment.url)].filter((host): host is string => Boolean(host)),
        allowedNetworkMethods: ['GET'],
        ...suppliedPolicy,
      })[0];
      if (interactionIssue) {
        const { title, logs } = this.emitRunStart(request, runId, startedAt);
        return this.createPreflightBlockedResponse(
          request,
          runId,
          title,
          startedAt,
          logs,
          `deterministic interaction blocked: ${interactionIssue.reason}`,
          [],
          'unsupportedAction',
        );
      }
    }

    const { title, logs } = this.emitRunStart(request, runId, startedAt);
    const documentId = getTestCasePrdPath(request.testCase)?.documentId;

    const fixtureEvidence: FixtureLifecycleEvidence[] = [];
    const preparedFixtures: FixtureAsset[] = [];
    // Response values live only for this invocation and never enter detail/log/artifact state.
    const fixtureOutputValues = new Map<string, Readonly<Record<string, FixtureHttpJsonValue>>>();
    let fixturesCleanedUp = false;
    const appendFixtureLog = (result: FixtureLifecycleExecutionResult) => {
      fixtureEvidence.push(result.evidence);
      const status = result.evidence.httpStatus === undefined
        ? result.evidence.outcome
        : `${result.evidence.outcome} (${result.evidence.httpStatus})`;
      const target = result.evidence.mode === 'script'
        ? `script ${result.evidence.scriptPath ?? '[unconfigured]'}`
        : `${result.evidence.method ?? 'HTTP'} ${result.evidence.path ?? '/'}`;
      const line = `[${timeLabel(new Date())}] Fixture ${result.evidence.fixtureId}@${result.evidence.fixtureVersion} ${result.evidence.lifecycle} ${target}: ${status}`;
      logs.push(line);
      this.emitRunEvent({ runId, title, type: 'log', line });
    };
    const cleanupPreparedFixtures = async () => {
      if (fixturesCleanedUp || !this.fixtureExecutor) {
        return;
      }
      fixturesCleanedUp = true;
      for (const fixture of [...preparedFixtures].reverse()) {
        if (!fixture.cleanup) {
          continue;
        }
        appendFixtureLog(await this.executeFixtureLifecycle(fixture, 'cleanup', request));
      }
    };

    const fixtureBlocker = getTestCaseFixtureRunBlocker(
      request.project,
      request.testCase,
      request.environment.id,
      {
        projectId: request.project.id,
        projectDirectory: request.fixtureScriptTrustDirectory,
        records: request.fixtureScriptTrustRecords,
        scriptExecutionEnabled: Boolean(this.fixtureExecutor?.supports?.('script')),
      },
    );
    if (fixtureBlocker) {
      return this.createPreflightBlockedResponse(request, runId, title, startedAt, logs, `Fixture 前置条件未满足：${fixtureBlocker.message}`);
    }

    const resolvedFixtures = resolveTestCaseFixtures(
      request.project,
      request.testCase.assetReferences?.fixtures ?? [],
      request.environment.id,
    ).fixtures;
    if (resolvedFixtures.length && !this.fixtureExecutor) {
      return this.createPreflightBlockedResponse(
        request,
        runId,
        title,
        startedAt,
        logs,
        'Fixture 前置条件未满足：HTTP Fixture 受控执行器不可用，当前不会执行。',
      );
    }
    for (const fixture of resolvedFixtures) {
      const result = await this.executeFixtureLifecycle(fixture, 'setup', request, request.cancellationSignal);
      appendFixtureLog(result);
      if (result.evidence.outcome !== 'passed') {
        await cleanupPreparedFixtures();
        if (request.cancellationSignal?.aborted) {
          return this.createCancelledResponse(request, runId, title, startedAt, logs, [], fixtureEvidence);
        }
        return this.createPreflightBlockedResponse(
          request,
          runId,
          title,
          startedAt,
          logs,
          `Fixture 前置条件未满足：${result.message}`,
          fixtureEvidence,
        );
      }
      if (result.outputValues) {
        fixtureOutputValues.set(fixtureReferenceKey(fixture), result.outputValues);
      }
      preparedFixtures.push(fixture);
    }

    const fixtureOutputBindingIssue = getFixtureOutputBindingIssue(request.testCase.steps, resolvedFixtures, fixtureOutputValues);
    if (fixtureOutputBindingIssue) {
      await cleanupPreparedFixtures();
      if (request.cancellationSignal?.aborted) {
        return this.createCancelledResponse(request, runId, title, startedAt, logs, [], fixtureEvidence);
      }
      return this.createPreflightBlockedResponse(
        request,
        runId,
        title,
        startedAt,
        logs,
        `Fixture 前置条件未满足：${fixtureOutputBindingIssue}`,
        fixtureEvidence,
      );
    }
    const fixtureOutputBindingResolver: DeterministicInputBindingResolver = {
      resolve: async ({ projectId, binding }) => {
        if (projectId !== request.project.id || binding.kind !== 'fixtureOutput') {
          throw new Error('Fixture 输出绑定不属于当前受控运行。');
        }
        const value = fixtureOutputValues.get(`${binding.fixtureId}@${binding.fixtureVersion}`)?.[binding.outputName];
        if (typeof value !== 'string') {
          throw new Error('Fixture 输出未在当前运行中生成可用于输入的字符串值。');
        }
        return value;
      },
    };

    let artifact: RunArtifact;
    try {
      throwIfRunCancelled(request.cancellationSignal);
      const session = await awaitWithRunCancellation(
        this.browserRuntime.start({
          project: request.project,
          environment: request.environment,
          record: false,
        }),
        request.cancellationSignal,
      );
      if (session.status === 'error') {
        await cleanupPreparedFixtures();
        return this.createPreflightBlockedResponse(
          request,
          runId,
          title,
          startedAt,
          logs,
          `浏览器会话未启动：${session.message}`,
          fixtureEvidence,
          isCredentialUnavailable(session.message) ? 'credentialUnavailable' : 'fixturePreflight',
        );
      }
      const browserArtifact = await awaitWithRunCancellation(
        Promise.resolve(this.browserRuntime.captureRunScreenshot?.(runId, 'preStep')),
        request.cancellationSignal,
      );
      artifact = browserArtifact ?? await awaitWithRunCancellation(
        this.artifacts.createSnapshot(
          runId,
          'synthetic diagnostic',
          request.testCase.name,
          session.currentUrl || request.environment.url,
        ),
        request.cancellationSignal,
      );
    } catch (error) {
      if (!isRunCancelled(error)) {
        await cleanupPreparedFixtures();
        throw error;
      }
      await cleanupPreparedFixtures();
      return this.createCancelledResponse(request, runId, title, startedAt, logs, [], fixtureEvidence);
    }

    const artifacts = [artifact];
    let steps: RunStepLog[] = [];
    const agentRuns: AgentRunResult[] = [];
    const agentStepRuns: Array<AgentRunResult | undefined> = Array.from({ length: request.testCase.steps.length });

    let failureReason = '';
    let cancellation: RunDetail['cancellation'];
    const terminal: { status: Exclude<RunStatus, 'running'>; reason?: RunReason } = { status: 'passed' };
    const stop = (status: Exclude<RunStatus, 'running'>, reason: RunReason) => {
      terminal.status = status;
      terminal.reason = reason;
    };

    for (const [index, step] of request.testCase.steps.entries()) {
      if (request.cancellationSignal?.aborted) {
        cancellation = createUserCancellation();
        stop('cancelled', runReason('userCancelled', cancellation.message));
        appendUnexecutedSteps(steps, request, index, runId, artifact.path, cancellation.message, 'cancelled');
        break;
      }
      if (index > 0) {
        const preStepArtifact = await this.captureRealCheckpoint(runId, 'preStep');
        if (preStepArtifact) {
          artifact = preStepArtifact;
          artifacts.push(preStepArtifact);
        }
      }
      const replayStep = step.type === 'recordingReplay';

      if (replayStep) {
        const recording = findRecording(request, step.recordingId);
        if (!recording) {
          failureReason = `未找到录制资产：${step.recordingId ?? step.title}`;
          stop('blocked', runReason('unsupportedAction', failureReason));
          const failureArtifact = await this.captureRealCheckpoint(runId, 'failure');
          if (failureArtifact) {
            artifact = failureArtifact;
            artifacts.push(failureArtifact);
          }
          steps.push({
            id: `run-step-${runId}-${index}`,
            stepId: step.id,
            title: step.title,
            status: 'blocked',
            message: failureReason,
            screenshotPath: artifact.path,
          });
          appendUnexecutedSteps(steps, request, index + 1, runId, artifact.path, failureReason);
          break;
        }

        if (this.recordingRunner) {
          const replay = await this.recordingRunner.run({
            project: request.project,
            environment: request.environment,
            recording,
            testCaseId: request.testCase.id,
            ...(documentId
              ? { documentId }
              : recording.prdPath?.documentId
                ? { documentId: recording.prdPath.documentId }
                : {}),
            parentRunId: runId,
            ...(request.cancellationSignal ? { cancellationSignal: request.cancellationSignal } : {}),
          });
          if (isAgentRunResult(replay.agentRun)) {
            agentRuns.push(replay.agentRun);
            agentStepRuns[index] = replay.agentRun;
          }
          replay.detail.logs.forEach((message) => {
            const line = `[${timeLabel(new Date())}] ${message}`;
            logs.push(line);
            this.emitRunEvent({ runId, title, type: 'log', line });
          });
          artifacts.push(...replay.detail.artifacts);

          const replayOutcome = terminalOutcome(replay.detail.status, replay.detail.reason, replay.detail.cancellation, step);
          const screenshotPath = replay.detail.steps.at(-1)?.screenshotPath ?? artifact.path;
          const message = `步骤 ${index + 1} ${replay.detail.summary}`;
          steps.push({
            id: `run-step-${runId}-${index}`,
            stepId: step.id,
            title: step.title,
            status: replayOutcome.status,
            message,
            screenshotPath,
          });

          if (replayOutcome.status !== 'passed') {
            if (replay.detail.cancellation) {
              cancellation = replay.detail.cancellation;
            }
            failureReason = replay.detail.failureReason ?? replay.detail.summary;
            stop(replayOutcome.status, replayOutcome.reason);
            const failureArtifact = await this.captureRealCheckpoint(runId, 'failure');
            if (failureArtifact) {
              artifact = failureArtifact;
              artifacts.push(failureArtifact);
            }
            appendUnexecutedSteps(
              steps,
              request,
              index + 1,
              runId,
              screenshotPath,
              message,
              replayOutcome.status === 'cancelled' ? 'cancelled' : 'skipped',
            );
            break;
          }
          const postStepArtifact = await this.captureRealCheckpoint(runId, 'postStep');
          if (postStepArtifact) {
            artifact = postStepArtifact;
            artifacts.push(postStepArtifact);
          }
          continue;
        }

        let replayResults: Awaited<ReturnType<BrowserRuntime['replayRecordingSteps']>>;
        try {
          const replay = request.cancellationSignal
            ? this.browserRuntime.replayRecordingSteps(
                recording.steps,
                `${runId}-${index}`,
                request.cancellationSignal,
              )
            : this.browserRuntime.replayRecordingSteps(recording.steps, `${runId}-${index}`);
          replayResults = await awaitWithRunCancellation(replay, request.cancellationSignal);
        } catch (error) {
          if (!isRunCancelled(error)) {
            await cleanupPreparedFixtures();
            throw error;
          }
          cancellation = createUserCancellation();
          stop('cancelled', runReason('userCancelled', cancellation.message));
          steps.push({
            id: `run-step-${runId}-${index}`,
            stepId: step.id,
            title: step.title,
            status: 'cancelled',
            message: cancellation.message,
            screenshotPath: artifact.path,
          });
          appendUnexecutedSteps(steps, request, index + 1, runId, artifact.path, cancellation.message, 'cancelled');
          break;
        }
        replayResults.forEach((result, replayIndex) => {
          if (result.artifact) {
            artifacts.push(result.artifact);
          } else if (result.screenshotPath) {
            artifacts.push({
              id: `artifact-${runId}-${index}-${replayIndex}`,
              type: 'snapshot',
              label: `${recording.name} / ${result.step.title}`,
              path: result.screenshotPath,
            });
          }
          const line = `[${timeLabel(new Date())}] ${result.message}`;
          logs.push(line);
          this.emitRunEvent({ runId, title, type: 'log', line });
        });

        const failed = replayResults.find((result) => result.status === 'failed');
        if (failed) {
          failureReason = failed.message;
          stop('failed', runReason('actionFailed', failureReason));
          const failureArtifact = await this.captureRealCheckpoint(runId, 'failure');
          if (failureArtifact) {
            artifact = failureArtifact;
            artifacts.push(failureArtifact);
          }
        }

        const screenshotPath = replayResults.at(-1)?.screenshotPath ?? artifact.path;
        const message = failed
          ? `步骤 ${index + 1} 回放失败：${failed.message}`
          : `步骤 ${index + 1} 已真实回放 ${replayResults.length} 个录制节点。`;
        steps.push({
          id: `run-step-${runId}-${index}`,
          stepId: step.id,
          title: step.title,
          status: failed ? 'failed' : 'passed',
          message,
          screenshotPath,
        });

        if (failed) {
          appendUnexecutedSteps(steps, request, index + 1, runId, screenshotPath, failureReason);
          break;
        }
        const postStepArtifact = await this.captureRealCheckpoint(runId, 'postStep');
        if (postStepArtifact) {
          artifact = postStepArtifact;
          artifacts.push(postStepArtifact);
        }
        continue;
      }

      const deterministicAction = getConfirmedDeterministicTestStep(step);
      const deterministicInputBinding = getConfirmedDeterministicTestInputBinding(step);
      const deterministicAssertion = getConfirmedExplicitTestAssertion(step);
      const controlledInteraction = getConfirmedControlledInteraction(step);
      if (controlledInteraction) {
        try {
          const controlled = await awaitWithRunCancellation(
            this.browserRuntime.executeControlledDeterministicAction({
              runId,
              action: controlledInteraction,
              ...(this.interactionPreflightPolicy?.resolveUpload
                ? {
                    resolveUploadPath: async (reference) => {
                      const path = resolvedUploadPaths.get(deterministicFileReferenceKey(reference));
                      if (!path) {
                        throw new Error('The approved upload reference was not resolved for this run.');
                      }
                      return path;
                    },
                  }
                : {}),
              ...(request.cancellationSignal ? { cancellationSignal: request.cancellationSignal } : {}),
            }),
            request.cancellationSignal,
          );
          if (validateDeterministicPersistenceSurfaces({
            logs: [controlled.message],
            artifactLabels: controlled.artifacts.map((artifact) => artifact.label),
            maintenance: [controlled.artifacts],
          }, { knownSecrets }).length) {
            await cleanupPreparedFixtures();
            if (request.cancellationSignal?.aborted) {
              return this.createCancelledResponse(request, runId, title, startedAt, logs, artifacts, fixtureEvidence);
            }
            return this.createResolvedSecretBlockedResponse(request, runId, startedAt, fixtureEvidence);
          }
          artifacts.push(...controlled.artifacts);
          const line = `[${timeLabel(new Date())}] ${controlled.message}`;
          logs.push(line);
          this.emitRunEvent({ runId, title, type: 'log', line });
          steps.push({
            id: `run-step-${runId}-${index}`,
            stepId: step.id,
            title: step.title,
            status: 'passed',
            message: controlled.message,
            screenshotPath: artifact.path,
          });
          const postStepArtifact = await this.captureRealCheckpoint(runId, 'postStep');
          if (postStepArtifact) {
            artifact = postStepArtifact;
            artifacts.push(postStepArtifact);
          }
          continue;
        } catch (error) {
          if (isRunCancelled(error)) {
            cancellation = createUserCancellation();
            stop('cancelled', runReason('userCancelled', cancellation.message));
            steps.push({
              id: `run-step-${runId}-${index}`,
              stepId: step.id,
              title: step.title,
              status: 'cancelled',
              message: cancellation.message,
              screenshotPath: artifact.path,
            });
            appendUnexecutedSteps(steps, request, index + 1, runId, artifact.path, cancellation.message, 'cancelled');
            break;
          }
          failureReason = 'Approved controlled interaction failed.';
          stop('failed', runReason('actionFailed', failureReason));
          const failureArtifact = await this.captureRealCheckpoint(runId, 'failure');
          if (failureArtifact) {
            artifact = failureArtifact;
            artifacts.push(failureArtifact);
          }
          const line = `[${timeLabel(new Date())}] ${failureReason}`;
          logs.push(line);
          this.emitRunEvent({ runId, title, type: 'log', line });
          steps.push({
            id: `run-step-${runId}-${index}`,
            stepId: step.id,
            title: step.title,
            status: 'failed',
            message: failureReason,
            screenshotPath: artifact.path,
          });
          appendUnexecutedSteps(steps, request, index + 1, runId, artifact.path, failureReason);
          break;
        }
      }
      const deterministicStep = deterministicAction ?? (deterministicAssertion ? toDeterministicAssertionPlanStep(step) : undefined);
      if (deterministicStep) {
        if (!this.deterministicRunner) {
          const message = `步骤 ${index + 1} 已确认的结构化${deterministicAssertion ? '断言' : '动作'}等待确定性运行器接入。`;
          stop('blocked', runReason('unsupportedAction', message));
          const failureArtifact = await this.captureRealCheckpoint(runId, 'failure');
          if (failureArtifact) {
            artifact = failureArtifact;
            artifacts.push(failureArtifact);
          }
          const line = `[${timeLabel(new Date())}] ${message}`;
          logs.push(line);
          this.emitRunEvent({ runId, title, type: 'log', line });
          steps.push({
            id: `run-step-${runId}-${index}`,
            stepId: step.id,
            title: step.title,
            status: 'blocked',
            message,
            screenshotPath: artifact.path,
          });
          appendUnexecutedSteps(steps, request, index + 1, runId, artifact.path, message);
          break;
        }

        const deterministic = await this.deterministicRunner.runDeterministicStep({
          sourceStep: step,
          plannedStep: deterministicStep,
          ...(deterministicInputBinding ? { inputBinding: deterministicInputBinding } : {}),
          ...(deterministicInputBinding?.kind === 'fixtureOutput' ? { inputBindingResolver: fixtureOutputBindingResolver } : {}),
          ...(deterministicAssertion ? { assertion: deterministicAssertion } : {}),
          testCaseId: request.testCase.id,
          targetEnvironment: request.environment.name,
          runtimeProfile: request.runtimeProfile ?? {
            browser: request.environment.browser,
            baseUrl: request.environment.url,
            viewport: request.environment.viewport,
            locale: request.environment.locale,
            headless: request.environment.headless,
          },
          project: request.project,
          environment: request.environment,
          ...(documentId ? { documentId } : {}),
          parentRunId: runId,
          ...(request.browserSession ? { browserSession: request.browserSession } : {}),
          ...(request.cancellationSignal ? { cancellationSignal: request.cancellationSignal } : {}),
        });
        if (validateDeterministicPersistenceSurfaces({
          logs: deterministic.detail.logs,
          artifactLabels: deterministic.detail.artifacts.map((artifact) => artifact.label),
          maintenance: [deterministic.detail, deterministic.agentRun],
        }, { knownSecrets }).length) {
          await cleanupPreparedFixtures();
          if (request.cancellationSignal?.aborted) {
            return this.createCancelledResponse(request, runId, title, startedAt, logs, [], fixtureEvidence);
          }
          return this.createResolvedSecretBlockedResponse(request, runId, startedAt, fixtureEvidence);
        }
        if (isAgentRunResult(deterministic.agentRun)) {
          agentRuns.push(deterministic.agentRun);
          agentStepRuns[index] = deterministic.agentRun;
        }
        deterministic.detail.logs.forEach((message) => {
          const line = `[${timeLabel(new Date())}] ${message}`;
          logs.push(line);
          this.emitRunEvent({ runId, title, type: 'log', line });
        });
        artifacts.push(...deterministic.detail.artifacts);

        const deterministicOutcome = terminalOutcome(
          deterministic.detail.status,
          deterministic.detail.reason,
          deterministic.detail.cancellation,
          step,
        );
        const deterministicRunStep = deterministic.detail.steps[0];
        const screenshotPath = deterministicRunStep?.screenshotPath ?? artifact.path;
        const message = `步骤 ${index + 1} ${deterministicRunStep?.message ?? deterministic.detail.summary}`;
        steps.push({
          id: `run-step-${runId}-${index}`,
          stepId: step.id,
          title: step.title,
          status: deterministicOutcome.status,
          message,
          screenshotPath,
        });
        if (deterministicOutcome.status !== 'passed') {
          if (deterministic.detail.cancellation) {
            cancellation = deterministic.detail.cancellation;
          }
          failureReason = deterministic.detail.failureReason ?? deterministic.detail.summary;
          stop(deterministicOutcome.status, deterministicOutcome.reason);
          const failureArtifact = await this.captureRealCheckpoint(runId, 'failure');
          if (failureArtifact) {
            artifact = failureArtifact;
            artifacts.push(failureArtifact);
          }
          appendUnexecutedSteps(
            steps,
            request,
            index + 1,
            runId,
            screenshotPath,
            message,
            deterministicOutcome.status === 'cancelled' ? 'cancelled' : 'skipped',
          );
          break;
        }
        const postStepArtifact = await this.captureRealCheckpoint(runId, 'postStep');
        if (postStepArtifact) {
          artifact = postStepArtifact;
          artifacts.push(postStepArtifact);
        }
        continue;
      }

      if ((step.type === 'ai' || step.type === 'aiAssert') && step.execution?.reviewStatus === 'confirmed') {
        const message = `步骤 ${index + 1} 已确认的结构化${step.type === 'aiAssert' ? '断言' : '动作'}不在当前确定性执行范围内，未调用模型。`;
        stop('blocked', runReason('unsupportedAction', message));
        const failureArtifact = await this.captureRealCheckpoint(runId, 'failure');
        if (failureArtifact) {
          artifact = failureArtifact;
          artifacts.push(failureArtifact);
        }
        const line = `[${timeLabel(new Date())}] ${message}`;
        logs.push(line);
        this.emitRunEvent({ runId, title, type: 'log', line });
        steps.push({
          id: `run-step-${runId}-${index}`,
          stepId: step.id,
          title: step.title,
          status: 'blocked',
          message,
          screenshotPath: artifact.path,
        });
        appendUnexecutedSteps(steps, request, index + 1, runId, artifact.path, message);
        break;
      }

      if (this.workflowRunner && isAgentStep(step)) {
        const workflow = await this.workflowRunner.runWorkflow({
          workflow: {
            id: request.testCase.id,
            kind: request.testCase.kind === 'recording' ? 'scenario' : request.testCase.kind,
            name: request.testCase.name,
            category: request.testCase.category,
            lastEdited: request.testCase.lastEdited,
            url: request.testCase.url,
            notes: request.testCase.notes,
            steps: [step],
          },
          targetEnvironment: request.environment.name,
          runtimeProfile: request.runtimeProfile ?? {
            browser: request.environment.browser,
            baseUrl: request.environment.url,
            viewport: request.environment.viewport,
            locale: request.environment.locale,
            headless: request.environment.headless,
          },
          ...(request.midsceneConfig ? { midsceneConfig: request.midsceneConfig } : {}),
          ...(request.agentModelConfig ? { agentModelConfig: request.agentModelConfig } : {}),
          ...(request.modelConfigResolver ? { modelConfigResolver: request.modelConfigResolver } : {}),
          ...(request.browserSession ? { browserSession: request.browserSession } : {}),
          project: request.project,
          environment: request.environment,
          ...(documentId ? { documentId } : {}),
          parentRunId: runId,
          preserveCurrentPage: index > 0,
          ...(request.cancellationSignal ? { cancellationSignal: request.cancellationSignal } : {}),
        });
        if (isAgentRunResult(workflow.agentRun)) {
          agentRuns.push(workflow.agentRun);
          agentStepRuns[index] = workflow.agentRun;
        }
        workflow.detail.logs.forEach((message) => {
          const line = `[${timeLabel(new Date())}] ${message}`;
          logs.push(line);
          this.emitRunEvent({ runId, title, type: 'log', line });
        });
        artifacts.push(...workflow.detail.artifacts);

        const workflowOutcome = terminalOutcome(workflow.detail.status, workflow.detail.reason, workflow.detail.cancellation, step);
        const workflowStep = workflow.detail.steps[0];
        const screenshotPath = workflowStep?.screenshotPath ?? artifact.path;
        const message = `步骤 ${index + 1} ${workflowStep?.message ?? workflow.detail.summary}`;
        steps.push({
          id: `run-step-${runId}-${index}`,
          stepId: step.id,
          title: step.title,
          status: workflowOutcome.status,
          message,
          screenshotPath,
        });

        if (workflowOutcome.status !== 'passed') {
          if (workflow.detail.cancellation) {
            cancellation = workflow.detail.cancellation;
          }
          failureReason = workflow.detail.failureReason ?? workflow.detail.summary;
          stop(workflowOutcome.status, workflowOutcome.reason);
          const failureArtifact = await this.captureRealCheckpoint(runId, 'failure');
          if (failureArtifact) {
            artifact = failureArtifact;
            artifacts.push(failureArtifact);
          }
          appendUnexecutedSteps(
            steps,
            request,
            index + 1,
            runId,
            screenshotPath,
            message,
            workflowOutcome.status === 'cancelled' ? 'cancelled' : 'skipped',
          );
          break;
        }
        const postStepArtifact = await this.captureRealCheckpoint(runId, 'postStep');
        if (postStepArtifact) {
          artifact = postStepArtifact;
          artifacts.push(postStepArtifact);
        }
        continue;
      }

      const message =
        step.type === 'manual'
          ? `步骤 ${index + 1} 需要人工检查：${step.body}`
          : `步骤 ${index + 1} 等待 Agent Runtime 执行：${step.body}`;
      stop('blocked', runReason('unsupportedAction', message));
      const failureArtifact = await this.captureRealCheckpoint(runId, 'failure');
      if (failureArtifact) {
        artifact = failureArtifact;
        artifacts.push(failureArtifact);
      }
      const screenshotPath = artifact.path;

      const line = `[${timeLabel(new Date())}] ${message}`;
      logs.push(line);
      this.emitRunEvent({ runId, title, type: 'log', line });
      steps.push({
        id: `run-step-${runId}-${index}`,
        stepId: step.id,
        title: step.title,
        status: 'blocked',
        message,
        screenshotPath,
      });
      appendUnexecutedSteps(steps, request, index + 1, runId, screenshotPath, message);
      break;
    }

    await cleanupPreparedFixtures();
    const endedAt = new Date();
    const agentRun = agentRuns.length
      ? createTestCaseAgentRun({
          testCase: request.testCase,
          stepRuns: agentStepRuns,
          runId,
          projectId: request.project.id,
          environmentId: request.environment.id,
        })
      : undefined;
    const detail: RunDetail = {
      id: runId,
      projectId: request.project.id,
      testCaseId: request.testCase.id,
      ...(documentId ? { documentId } : {}),
      environmentId: request.environment.id,
      title,
      status: terminal.status,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      duration: `00:00:${String(Math.max(1, request.testCase.steps.length * 2)).padStart(2, '0')}`,
      summary: terminal.status === 'cancelled'
        ? cancellation?.message ?? terminal.reason?.message ?? '用户已取消运行。'
        : terminal.status === 'failed'
          ? `执行失败：${failureReason || terminal.reason?.message || '步骤执行失败。'}`
          : terminal.status === 'blocked'
            ? terminal.reason?.message ?? '当前步骤不具备可执行条件。'
            : terminal.status === 'error'
              ? terminal.reason?.message ?? '执行器发生未分类异常。'
              : terminal.status === 'skipped'
                ? terminal.reason?.message ?? '前序步骤未通过。'
                : `已完成 ${request.testCase.steps.length} 个步骤，生成 ${artifacts.length} 份截图/快照与步骤日志。`,
      logs,
      steps: steps.map((step) => {
        const reusableFlow = flowOriginByStepId.get(step.stepId);
        return reusableFlow ? { ...step, reusableFlow } : step;
      }),
      artifacts,
      ...(fixtureEvidence.length ? { fixtureLifecycles: fixtureEvidence } : {}),
      ...(agentRun ? { agentRun } : {}),
      ...(agentRuns.length ? { agentRuns } : {}),
      ...(terminal.reason ? { reason: terminal.reason } : {}),
      ...(terminal.status === 'failed' ? { failureReason } : {}),
      ...(cancellation ? { cancellation } : {}),
    };

    this.emitRunEvent({
      runId,
      title,
      type: 'complete',
      status: detail.status,
      duration: detail.duration,
      summary: detail.summary,
      detail,
    });

    return { runId, title, detail };
  }

  private async captureRealCheckpoint(
    runId: string,
    checkpoint: 'preStep' | 'postStep' | 'failure',
  ): Promise<RunArtifact | undefined> {
    if (!this.browserRuntime.hasRealPage?.()) {
      return undefined;
    }
    return (await this.browserRuntime.captureRunScreenshot?.(runId, checkpoint)) ?? undefined;
  }

  private createCancelledResponse(
    request: RunTestCaseRequest,
    runId: string,
    title: string,
    startedAt: Date,
    logs: string[],
    artifacts: RunArtifact[],
    fixtureLifecycles: FixtureLifecycleEvidence[] = [],
  ): RunTestCaseResponse {
    const cancellation = createUserCancellation();
    return this.createTerminalResponse(request, runId, title, startedAt, logs, {
      status: 'cancelled',
      reason: runReason('userCancelled', cancellation.message),
      artifacts,
      fixtureLifecycles,
      cancellation,
    });
  }

  private createPreflightBlockedResponse(
    request: RunTestCaseRequest,
    runId: string,
    title: string,
    startedAt: Date,
    logs: string[],
    message: string,
    fixtureLifecycles: FixtureLifecycleEvidence[] = [],
    reasonCode: RunReason['code'] = 'fixturePreflight',
  ): RunTestCaseResponse {
    return this.createTerminalResponse(request, runId, title, startedAt, logs, {
      status: 'blocked',
      reason: runReason(reasonCode, message),
      fixtureLifecycles,
    });
  }

  private createInteractionPolicyUnavailableResponse(
    request: RunTestCaseRequest,
    runId: string,
    startedAt: Date,
  ): RunTestCaseResponse {
    return this.createSafeInteractionBlockedResponse(
      request,
      runId,
      startedAt,
      'deterministic interaction blocked: preflightPolicyUnavailable',
    );
  }

  private createResolvedSecretBlockedResponse(
    request: RunTestCaseRequest,
    runId: string,
    startedAt: Date,
    fixtureLifecycles: FixtureLifecycleEvidence[] = [],
  ): RunTestCaseResponse {
    return this.createSafeInteractionBlockedResponse(
      request,
      runId,
      startedAt,
      'deterministic interaction blocked: resolvedSecret',
      fixtureLifecycles,
    );
  }

  private createMalformedActionBlockedResponse(
    request: RunTestCaseRequest,
    runId: string,
    startedAt: Date,
  ): RunTestCaseResponse {
    return this.createSafeInteractionBlockedResponse(
      request,
      runId,
      startedAt,
      'deterministic interaction blocked: malformedAction',
    );
  }

  private createUnconfirmedActionBlockedResponse(
    request: RunTestCaseRequest,
    runId: string,
    startedAt: Date,
  ): RunTestCaseResponse {
    return this.createSafeInteractionBlockedResponse(
      request,
      runId,
      startedAt,
      'deterministic interaction blocked: unconfirmedAction',
    );
  }

  private createSafeInteractionBlockedResponse(
    request: RunTestCaseRequest,
    runId: string,
    startedAt: Date,
    message: string,
    fixtureLifecycles: FixtureLifecycleEvidence[] = [],
  ): RunTestCaseResponse {
    const title = 'Controlled interaction blocked';
    const detail: RunDetail = {
      id: runId,
      projectId: request.project.id,
      testCaseId: request.testCase.id,
      environmentId: request.environment.id,
      title,
      status: 'blocked',
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      duration: '00:00:00',
      summary: message,
      logs: [`[${timeLabel(new Date())}] ${message}`],
      steps: [],
      artifacts: [],
      reason: runReason('unsupportedAction', message),
      ...(fixtureLifecycles.length ? { fixtureLifecycles } : {}),
    };
    this.emitRunEvent({
      runId,
      title,
      type: 'complete',
      status: detail.status,
      duration: detail.duration,
      summary: detail.summary,
      detail,
    });
    return { runId, title, detail };
  }

  private emitRunStart(
    request: RunTestCaseRequest,
    runId: string,
    startedAt: Date,
  ): { title: string; logs: string[] } {
    const title = request.testCase.name;
    const logs = [
      `[${timeLabel(startedAt)}] Run queued: ${request.project.name} / ${request.testCase.name}`,
      `[${timeLabel(startedAt)}] Environment: ${request.environment.name} -> ${request.environment.url}`,
    ];
    this.emitRunEvent({
      runId,
      title,
      type: 'status',
      status: 'running',
      summary: `正在执行 ${request.testCase.steps.length} 个步骤。`,
    });
    logs.forEach((line) => this.emitRunEvent({ runId, title, type: 'log', line }));
    return { title, logs };
  }

  private createTerminalResponse(
    request: RunTestCaseRequest,
    runId: string,
    title: string,
    startedAt: Date,
    logs: string[],
    outcome: {
      status: Exclude<RunStatus, 'running'>;
      reason: RunReason;
      artifacts?: RunArtifact[];
      fixtureLifecycles?: FixtureLifecycleEvidence[];
      cancellation?: RunDetail['cancellation'];
    },
  ): RunTestCaseResponse {
    const message = outcome.reason.message;
    const documentId = getTestCasePrdPath(request.testCase)?.documentId;
    const detail: RunDetail = {
      id: runId,
      projectId: request.project.id,
      testCaseId: request.testCase.id,
      ...(documentId ? { documentId } : {}),
      environmentId: request.environment.id,
      title,
      status: outcome.status,
      startedAt: startedAt.toISOString(),
      endedAt: outcome.cancellation?.cancelledAt ?? new Date().toISOString(),
      duration: '00:00:00',
      summary: message,
      logs: [...logs, `[${timeLabel(new Date())}] ${message}`],
      steps: request.testCase.steps.map((step, index) => ({
        id: `run-step-${runId}-${index}`,
        stepId: step.id,
        title: step.title,
        status: outcome.status,
        message,
      })),
      artifacts: outcome.artifacts ?? [],
      reason: outcome.reason,
      ...(outcome.fixtureLifecycles?.length ? { fixtureLifecycles: outcome.fixtureLifecycles } : {}),
      ...(outcome.cancellation ? { cancellation: outcome.cancellation } : {}),
    };
    this.emitRunEvent({
      runId,
      title,
      type: 'complete',
      status: detail.status,
      duration: detail.duration,
      summary: detail.summary,
      detail,
    });
    return { runId, title, detail };
  }

  private async executeFixtureLifecycle(
    fixture: FixtureAsset,
    lifecycle: 'setup' | 'cleanup',
    request: RunTestCaseRequest,
    cancellationSignal?: AbortSignal,
  ): Promise<FixtureLifecycleExecutionResult> {
    const declaration = lifecycle === 'setup' ? fixture.setup : fixture.cleanup;
    if (!this.fixtureExecutor || !declaration) {
      return {
        evidence: {
          fixtureId: fixture.id,
          fixtureVersion: fixture.version,
          lifecycle,
          ...(declaration?.mode === 'script'
            ? { mode: 'script' as const, scriptPath: declaration.script?.relativePath }
            : {
                mode: 'http' as const,
                method: declaration?.mode === 'http' ? declaration.http?.method ?? 'POST' : 'POST',
                path: declaration?.mode === 'http' ? declaration.http?.path ?? '/' : '/',
                expectedStatuses: declaration?.mode === 'http' ? declaration.http?.expectedStatuses ?? [] : [],
              }),
          outcome: 'neutral',
          durationMs: 0,
        },
        message: 'Fixture lifecycle is not executable.',
      };
    }
    try {
      return await this.fixtureExecutor.execute({
        fixture,
        lifecycle,
        environment: request.environment,
        projectId: request.project.id,
        projectDirectory: request.fixtureScriptTrustDirectory,
        scriptTrustRecords: request.fixtureScriptTrustRecords,
        ...(cancellationSignal ? { cancellationSignal } : {}),
      });
    } catch {
      return {
        evidence: {
          fixtureId: fixture.id,
          fixtureVersion: fixture.version,
          lifecycle,
          ...(declaration.mode === 'script'
            ? { mode: 'script' as const, scriptPath: declaration.script?.relativePath }
            : {
                mode: 'http' as const,
                method: declaration.http?.method ?? 'POST',
                path: declaration.http?.path ?? '/',
                expectedStatuses: declaration.http?.expectedStatuses ?? [],
              }),
          outcome: 'failed',
          durationMs: 0,
        },
        message: `Fixture ${declaration.mode === 'script' ? 'script' : 'HTTP'} lifecycle failed.`,
      };
    }
  }
}

const createUserCancellation = (): NonNullable<RunDetail['cancellation']> => {
  return createUserRunCancellation();
};

const appendUnexecutedSteps = (
  steps: RunStepLog[],
  request: RunTestCaseRequest,
  firstIndex: number,
  runId: string,
  screenshotPath: string,
  reason: string,
  status: Extract<Exclude<RunStatus, 'running'>, 'skipped' | 'cancelled'> = 'skipped',
): void => {
  request.testCase.steps.slice(firstIndex).forEach((step, offset) => {
    steps.push({
      id: `run-step-${runId}-${firstIndex + offset}`,
      stepId: step.id,
      title: step.title,
      status,
      message: `前序步骤未形成可继续执行的结论：${reason}`,
      screenshotPath,
    });
  });
};

const getFixtureOutputBindingIssue = (
  steps: TestStepDraft[],
  fixtures: FixtureAsset[],
  outputValues: ReadonlyMap<string, Readonly<Record<string, FixtureHttpJsonValue>>>,
): string | undefined => {
  for (const step of steps) {
    const binding = getConfirmedDeterministicTestInputBinding(step);
    if (binding?.kind !== 'fixtureOutput') {
      continue;
    }
    const fixture = fixtures.find((candidate) => (
      candidate.id === binding.fixtureId && candidate.version === binding.fixtureVersion
    ));
    if (!fixture) {
      return `步骤“${step.title}”引用的 fixture ${binding.fixtureId}@${binding.fixtureVersion} 未绑定到当前用例。`;
    }
    const output = fixture.outputs.find((candidate) => candidate.name === binding.outputName);
    if (output?.type !== 'string') {
      return `步骤“${step.title}”引用的 fixture 输出 ${binding.outputName} 未声明为可输入的字符串。`;
    }
    const setupHttp = fixture.setup.mode === 'http' ? normalizeFixtureHttpDeclaration(fixture.setup.http) : undefined;
    if (
      fixture.setup.mode !== 'script' &&
      !setupHttp?.responseOutputs?.some((mapping) => mapping.outputName === binding.outputName)
    ) {
      return `步骤“${step.title}”引用的 fixture 输出 ${binding.outputName} 没有受控 setup 响应映射。`;
    }
    const value = outputValues.get(fixtureReferenceKey(fixture))?.[binding.outputName];
    if (typeof value !== 'string') {
      return `步骤“${step.title}”引用的 fixture 输出 ${binding.outputName} 未在当前准备请求中生成。`;
    }
  }
  return undefined;
};

const fixtureReferenceKey = (fixture: Pick<FixtureAsset, 'id' | 'version'>): string => {
  return `${fixture.id}@${fixture.version}`;
};

const isAgentStep = (step: TestStepDraft): step is TestStepDraft & { type: StepType } => {
  return step.type === 'ai' || step.type === 'aiAssert' || step.type === 'aiQuery';
};

const getConfirmedControlledInteraction = (step: TestStepDraft) => {
  const action = step.execution?.action;
  return step.type === 'ai' && step.execution?.reviewStatus === 'confirmed' && isControlledDeterministicInteraction(action)
    ? action
    : undefined;
};

const isAgentRunResult = (value: unknown): value is AgentRunResult => {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'runId' in value &&
      'intent' in value &&
      'plan' in value &&
      'events' in value,
  );
};

type TerminalOutcome =
  | { status: 'passed' }
  | { status: Exclude<RunStatus, 'running' | 'passed'>; reason: RunReason };

const terminalOutcome = (
  status: RunStatus,
  existingReason: RunReason | undefined,
  cancellation: RunDetail['cancellation'],
  step: TestStepDraft,
): TerminalOutcome => {
  if (cancellation) {
    return { status: 'cancelled', reason: runReason('userCancelled', cancellation.message) };
  }
  if (status === 'passed') {
    return { status };
  }
  if (status === 'failed') {
    return {
      status,
      reason: existingReason ?? runReason(step.type === 'aiAssert' ? 'assertionFailed' : 'actionFailed', '步骤执行失败。'),
    };
  }
  if (status === 'blocked') {
    return { status, reason: existingReason ?? runReason('unsupportedAction', '步骤当前不可执行。') };
  }
  if (status === 'skipped') {
    return { status, reason: existingReason ?? runReason('dependencyFailed', '前序步骤未通过。') };
  }
  if (status === 'cancelled') {
    return { status, reason: existingReason ?? runReason('userCancelled', '用户已取消运行。') };
  }
  return { status: 'error', reason: existingReason ?? runReason('executorError', '执行器未产生终态结果。') };
};

const runReason = (code: RunReason['code'], message: string): RunReason => {
  return { code, message };
};

const isCredentialUnavailable = (message: string): boolean => {
  return /认证|凭据|credential|storage state/i.test(message);
};

const originFor = (value: string): string | undefined => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : undefined;
  } catch {
    return undefined;
  }
};

const hostFor = (value: string): string | undefined => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.hostname : undefined;
  } catch {
    return undefined;
  }
};

const deterministicFileReferenceKey = (reference: DeterministicFileReference): string => {
  return reference.kind === 'fixture'
    ? `fixture:${reference.id}@${reference.version}`
    : `attachment:${reference.id}`;
};

const toDeterministicAssertionPlanStep = (step: TestStepDraft): AgentPlanStepDraft => {
  const assertion = step.execution?.assertion;
  const expected =
    assertion?.kind === 'locatorVisible'
      ? assertion.locator.selector
      : assertion && 'expected' in assertion
        ? assertion.expected
        : undefined;

  return {
    action: 'assert',
    title: step.title,
    instruction: step.body,
    ...(expected ? { expected } : {}),
  };
};

const findRecording = (request: RunTestCaseRequest, recordingId?: string): RecordingAsset | undefined => {
  if (recordingId) {
    return request.project.recordings.find((recording) => recording.id === recordingId);
  }

  return request.project.recordings.find(
    (recording) =>
      recording.groupId === request.testCase.groupId &&
      recording.environmentId === request.testCase.environmentId,
  );
};

const timeLabel = (date: Date): string => {
  return `${date.getHours().toString().padStart(2, '0')}:${date
    .getMinutes()
    .toString()
    .padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
};
