import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  findSuiteAsset,
  findTestCaseVersion,
  hydrateStudioState,
  isAgentRunnableTestCase,
  isMidsceneConfigured,
  type BrowserSessionState,
  type ProjectEnvironment,
  type RunProvenance,
  type RunReason,
  type RunStatus,
  type RunTestCaseResponse,
  type SuiteRunMemberRecord,
  type SuiteRunProvenance,
  type SuiteRunRecord,
  type SuiteRunResult,
  type StudioState,
  type TestCaseDraft,
  type SuiteAsset,
  type VersionedTestAssetReference,
} from '../shared/studio.js';
import { nodePngImageAdapter } from './runtime/node-png-image-adapter.js';
import { appendRunToStudioState, appendSuiteRunToStudioState } from './runtime/run-history.js';
import { createRunProvenance, createSuiteRunProvenance, type RunProvenanceRuntimeMetadata } from './runtime/run-provenance.js';
import { ModelConfigResolver, type LazyModelConfigResolver } from './runtime/model-config-resolver.js';
import { ModelSecretStore } from './runtime/model-secret-store.js';
import { isRunCancelled } from './runtime/run-cancellation.js';
import { createControlledChromiumBrowserPool, type BrowserPoolLease } from './runtime/browser-pool.js';
import { createRuntimeBundle, isChromiumHeadlessVersionedSuite } from './runtime/runtime-bundle.js';
import { ProjectRepository, type ProjectSnapshot } from './projectRepository.js';
import { SuiteRunner } from './runtime/suite-runner.js';
import { StorageStateStore } from './runtime/storage-state-store.js';
import { StudioStore } from './studioStore.js';

const usage = `Usage:
  testbuddy run --data-dir <path> --project-id <id> (--case-id <id@version> [--case-id <id@version> ...] | --suite-id <id@version>) [--environment-id <id>] [--junit <path>] [--json <path>]

Options:
  --data-dir        TestBuddy data root containing studio-data/state.json
  --project-id      Stable project ID
  --case-id         Exact Case ID and version, formatted as <id@version>; repeat for multiple cases
  --suite-id        Exact Suite ID and version, formatted as <id@version>
  --environment-id  Override the environment saved on every selected case
  --junit           JUnit XML destination; defaults to studio-data/artifacts
  --json            Optional JSON report file; JSON is always written to stdout
  --help, -h        Show this help text`;

type ParsedCommand =
  | { kind: 'help' }
  | {
      kind: 'run';
      dataDir: string;
      projectId: string;
      caseReferences: VersionedTestAssetReference[];
      suiteReference?: VersionedTestAssetReference;
      environmentId?: string;
      junitPath?: string;
      jsonPath?: string;
    };

export interface CliCaseResult {
  projectId: string;
  testCaseId: string;
  environmentId: string;
  title: string;
  status: Exclude<RunStatus, 'running'>;
  runId?: string;
  duration?: string;
  summary: string;
  failureReason?: string;
  reason?: RunReason;
  artifacts: string[];
  attempts?: number;
  flaky?: boolean;
  provenance?: RunProvenance;
}

export interface CliSuiteRunInfo {
  id: string;
  version: number;
  /** Durable parent execution ID, distinct from the immutable Suite asset ID. */
  runId: string;
  status: Exclude<RunStatus, 'running'>;
  startedAt: string;
  finishedAt: string;
  effectiveConcurrency: number;
  issues: string[];
  summary: SuiteRunRecord['summary'];
  members: SuiteRunMemberRecord[];
  provenance: SuiteRunProvenance;
  reason?: RunReason;
}

export interface CliRunSummary {
  command: 'run';
  status: 'passed' | 'failed';
  dataDir: string;
  startedAt: string;
  endedAt: string;
  reports: {
    junit: string;
    json?: string;
  };
  results: CliCaseResult[];
  suite?: CliSuiteRunInfo;
}

class CliUsageError extends Error {}

export function parseCliArguments(argv: string[]): ParsedCommand {
  const argumentsWithoutScriptSeparator = argv[0] === '--' ? argv.slice(1) : argv;
  if (!argumentsWithoutScriptSeparator.length || argumentsWithoutScriptSeparator.includes('--help') || argumentsWithoutScriptSeparator.includes('-h')) {
    return { kind: 'help' };
  }
  if (argumentsWithoutScriptSeparator[0] !== 'run') {
    throw new CliUsageError(`未知命令：${argumentsWithoutScriptSeparator[0] ?? ''}`);
  }

  const values = new Map<string, string[]>();
  for (let index = 1; index < argumentsWithoutScriptSeparator.length; index += 1) {
    const option = argumentsWithoutScriptSeparator[index];
    if (!option?.startsWith('--')) {
      throw new CliUsageError(`无法识别参数：${option ?? ''}`);
    }
    if (!['--data-dir', '--project-id', '--case-id', '--suite-id', '--environment-id', '--junit', '--json'].includes(option)) {
      throw new CliUsageError(`未知选项：${option}`);
    }
    const value = argumentsWithoutScriptSeparator[index + 1];
    if (!value || value.startsWith('--')) {
      throw new CliUsageError(`选项 ${option} 缺少值。`);
    }
    values.set(option, [...(values.get(option) ?? []), value]);
    index += 1;
  }

  const singleValue = (option: string): string | undefined => {
    const entries = values.get(option) ?? [];
    if (entries.length > 1) {
      throw new CliUsageError(`选项 ${option} 只能提供一次。`);
    }
    return entries[0];
  };
  const dataDir = singleValue('--data-dir');
  const projectId = singleValue('--project-id');
  const caseReferences = [...new Map(
    (values.get('--case-id') ?? [])
      .map((value) => parseVersionedReference(value, '--case-id'))
      .map((reference) => [`${reference.id}@${reference.version}`, reference] as const),
  ).values()];
  const suiteId = singleValue('--suite-id');
  if (!dataDir || !projectId || (!caseReferences.length && !suiteId)) {
    throw new CliUsageError('run 命令必须提供 --data-dir、--project-id 和至少一个 --case-id 或 --suite-id。');
  }
  if (caseReferences.length && suiteId) {
    throw new CliUsageError('--case-id 与 --suite-id 不能同时使用。');
  }
  if (suiteId && singleValue('--environment-id')) {
    throw new CliUsageError('Suite 已固定目标环境，不能与 --environment-id 同时使用。');
  }

  return {
    kind: 'run',
    dataDir,
      projectId,
    caseReferences,
    ...(suiteId ? { suiteReference: parseVersionedReference(suiteId, '--suite-id') } : {}),
    ...(singleValue('--environment-id') ? { environmentId: singleValue('--environment-id') } : {}),
    ...(singleValue('--junit') ? { junitPath: singleValue('--junit') } : {}),
    ...(singleValue('--json') ? { jsonPath: singleValue('--json') } : {}),
  };
}

export function renderJUnitReport(summary: CliRunSummary): string {
  const elapsedSeconds = Math.max(
    0,
    (new Date(summary.endedAt).getTime() - new Date(summary.startedAt).getTime()) / 1_000,
  );
  if (summary.suite) {
    const suite = summary.suite;
    const reportResults = suite.members.map((member) => toSuiteJUnitResult(summary.results, suite, member));
    const parentReason = suite.reason?.message ?? suite.issues.join('\n');
    if (suite.status === 'error' && !reportResults.some((result) => result.status === 'error')) {
      reportResults.push({
        projectId: suite.provenance.projectId,
        testCaseId: `suite-parent-${suite.runId}`,
        environmentId: suite.provenance.environment.id,
        title: `Suite ${suite.id}@${suite.version}`,
        status: 'error',
        summary: parentReason || 'Suite executor failed.',
        reason: suite.reason ?? { code: 'executorError', message: parentReason || 'Suite executor failed.' },
        artifacts: [],
      });
    }
    if ((suite.status === 'blocked' || suite.status === 'cancelled') &&
      !reportResults.some((result) => result.status === suite.status)) {
      const defaultReason = suite.status === 'blocked'
        ? { code: 'missingAssetVersion' as const, message: 'Suite could not start because its immutable assets were unavailable.' }
        : { code: 'userCancelled' as const, message: 'Suite was cancelled before any Case started.' };
      reportResults.push({
        projectId: suite.provenance.projectId,
        testCaseId: `suite-parent-${suite.runId}`,
        environmentId: suite.provenance.environment.id,
        title: `Suite ${suite.id}@${suite.version}`,
        status: suite.status,
        summary: parentReason || defaultReason.message,
        reason: suite.reason ?? defaultReason,
        artifacts: [],
      });
    }
    const counts = junitCounts(reportResults);
    const total = reportResults.length;
    const reasonAttributes = suite.reason
      ? ` reasonCode="${escapeXml(suite.reason.code)}" reason="${escapeXml(parentReason)}"`
      : '';
    const cases = renderJUnitCases(reportResults, '    ', true);
    const parentOutput = `    <system-out>${escapeXml([
      `status=${suite.status}`,
      parentReason,
    ].filter(Boolean).join('\n'))}</system-out>`;
    return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="TestBuddy CLI" tests="${total}" failures="${counts.failed}" errors="${counts.error}" skipped="${counts.skipped}" time="${elapsedSeconds.toFixed(3)}" timestamp="${escapeXml(summary.startedAt)}">
  <testsuite name="Suite ${escapeXml(suite.id)}@${suite.version}" parentRunId="${escapeXml(suite.runId)}" status="${suite.status}" tests="${total}" failures="${counts.failed}" errors="${counts.error}" skipped="${counts.skipped}" time="${durationBetween(suite.startedAt, suite.finishedAt).toFixed(3)}" timestamp="${escapeXml(suite.startedAt)}"${reasonAttributes}>
${cases}${cases ? '\n' : ''}${parentOutput}
  </testsuite>
</testsuites>
`;
  }

  const counts = junitCounts(summary.results);
  const cases = renderJUnitCases(summary.results, '  ', false);
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="TestBuddy CLI" tests="${summary.results.length}" failures="${counts.failed}" errors="${counts.error}" skipped="${counts.skipped}" time="${elapsedSeconds.toFixed(3)}" timestamp="${escapeXml(summary.startedAt)}">
${cases}
</testsuite>
`;
}

function toSuiteJUnitResult(
  results: readonly CliCaseResult[],
  suite: CliSuiteRunInfo,
  member: SuiteRunMemberRecord,
): CliCaseResult {
  const matching = results.find((result) =>
    result.testCaseId === member.testCaseId && result.provenance?.testCase.version === member.testCaseVersion,
  ) ?? results.find((result) => result.testCaseId === member.testCaseId);
  return {
    projectId: member.provenance.projectId,
    testCaseId: member.testCaseId,
    environmentId: member.provenance.environment.id,
    title: matching?.title ?? `${member.testCaseId}@${member.testCaseVersion}`,
    status: member.status,
    ...(matching?.runId ? { runId: matching.runId } : member.runId ? { runId: member.runId } : {}),
    ...(matching?.duration ? { duration: matching.duration } : {}),
    summary: member.summary,
    ...(member.reason ? { reason: member.reason } : {}),
    artifacts: matching?.artifacts ?? [],
    attempts: member.attempts,
    flaky: member.flaky,
    provenance: member.provenance,
  };
}

function renderJUnitCases(results: readonly CliCaseResult[], indent: string, includeSuiteMetadata: boolean): string {
  return results.map((result) => {
    const metadata = includeSuiteMetadata
      ? `${result.runId ? ` runId="${escapeXml(result.runId)}"` : ''} attempts="${result.attempts ?? 0}" flaky="${result.flaky ? 'true' : 'false'}"`
      : '';
    const testcase = `${indent}<testcase classname="${escapeXml(result.projectId)}" name="${escapeXml(result.title)}" time="${durationToSeconds(result.duration).toFixed(3)}"${metadata}>`;
    const reason = escapeXml(result.reason?.message ?? result.failureReason ?? result.summary);
    const output = `${indent}  <system-out>${escapeXml(result.summary)}</system-out>`;
    if (result.status === 'passed') {
      return `${testcase}\n${output}\n${indent}</testcase>`;
    }
    const outcome = result.status === 'failed'
      ? `${indent}  <failure message="${reason}">${reason}</failure>`
      : result.status === 'error'
        ? `${indent}  <error message="${reason}">${reason}</error>`
        : `${indent}  <skipped message="${reason}"/>`;
    return `${testcase}\n${outcome}\n${output}\n${indent}</testcase>`;
  }).join('\n');
}

function junitCounts(results: readonly Pick<CliCaseResult, 'status'>[]): { failed: number; error: number; skipped: number } {
  return {
    failed: results.filter((result) => result.status === 'failed').length,
    error: results.filter((result) => result.status === 'error').length,
    skipped: results.filter((result) => result.status === 'blocked' || result.status === 'skipped' || result.status === 'cancelled').length,
  };
}

function durationBetween(startedAt: string, finishedAt: string): number {
  return Math.max(0, (Date.parse(finishedAt) - Date.parse(startedAt)) / 1_000);
}

export async function executeCliCommand(command: Exclude<ParsedCommand, { kind: 'help' }>): Promise<CliRunSummary> {
  const dataDir = path.resolve(command.dataDir);
  const store = new StudioStore(dataDir);
  const rawState = await loadExistingState(store);
  const runtimeState = hydrateStudioState(rawState);
  let modelConfigResolver: ModelConfigResolver | undefined;
  const createLazyModelConfigResolver = (): LazyModelConfigResolver => {
    modelConfigResolver ??= new ModelConfigResolver(new ModelSecretStore(dataDir));
    return {
      resolveMidsceneConfig: () => modelConfigResolver!.resolveMidsceneConfig(runtimeState.midsceneConfig),
      resolveAgentProviderConfig: (role) => modelConfigResolver!.resolveAgentProviderConfig(role, {
        midsceneConfig: runtimeState.midsceneConfig,
        agentModelConfig: runtimeState.agentModelConfig,
      }),
    };
  };
  const deterministicInteractionPreflightPolicy = {
    resolve: async () => {
      modelConfigResolver ??= new ModelConfigResolver(new ModelSecretStore(dataDir));
      const resolved = await modelConfigResolver.resolve({
        midsceneConfig: runtimeState.midsceneConfig,
        agentModelConfig: runtimeState.agentModelConfig,
      });
      return {
        knownSecrets: [
          resolved.midsceneConfig.modelApiKey,
          ...Object.values(resolved.agentModelConfig).map((config) => config.modelApiKey),
        ].filter((secret) => secret.trim()),
      };
    },
  };
  const projectSnapshot = await loadProjectSnapshot(store, command.projectId);
  const project = projectSnapshot.project;
  const selections = command.caseReferences.map((reference) => selectTestCase(projectSnapshot, reference, command.environmentId));
  const suite = command.suiteReference ? selectSuite(projectSnapshot, command.suiteReference) : undefined;
  const startedAt = new Date();
  const storageStateStore = new StorageStateStore(dataDir);
  const runtime = createRuntimeBundle({
    rootDir: dataDir,
    visualDiffImageAdapter: nodePngImageAdapter,
    browserPool: createControlledChromiumBrowserPool({ storageStateResolver: storageStateStore }),
    deterministicInteractionPreflightPolicy,
  });
  const results: CliCaseResult[] = [];
  const attemptedSuiteResults = new Map<string, CliCaseResult>();
  const persistedSuiteChildRunIds = new Set<string>();
  let suiteInfo: CliSuiteRunInfo | undefined;
  const persistRun = createSerializedRunHistoryPersister(store, () => runtime.browserRuntime.getState());
  const persistSuiteRun = createSerializedSuiteRunHistoryPersister(store);
  const suiteParent = suite ? createCliSuiteParent(projectSnapshot, suite, runtimeState) : undefined;
  let currentSuiteParentRecord = suiteParent?.record;
  if (suiteParent) {
    await persistSuiteRun(suiteParent.record);
  }

  try {
    await runtime.ensureReady();
    const executeSelection = async (
      selection: {
        testCase: TestCaseDraft;
        environment: ProjectEnvironment;
        suite?: NonNullable<RunProvenance['suite']>;
      },
      workerLease?: BrowserPoolLease,
    ): Promise<CliCaseResult> => {
      const provenance = createCliRunProvenance(
        projectSnapshot,
        selection.testCase,
        selection.environment,
        runtimeState,
        selection.suite,
      );
      if (isAgentRunnableTestCase(selection.testCase) && !hasCliPlannerModelConfig(runtimeState)) {
        const summary = '该 Agent 用例需要已配置的 Midscene 模型，当前数据目录未包含可用模型配置。';
        return persistSyntheticCliCaseResult({
          projectId: project.id,
          testCaseId: selection.testCase.id,
          environmentId: selection.environment.id,
          title: selection.testCase.name,
          status: 'blocked',
          summary,
          failureReason: 'Midscene 模型未配置。',
          reason: { code: 'credentialUnavailable', message: summary },
          artifacts: [],
          provenance,
        }, selection.environment, persistRun);
      }
      try {
        const modelConfigResolver = isAgentRunnableTestCase(selection.testCase)
          ? createLazyModelConfigResolver()
          : undefined;
        const result = await runtime.runTestCase({
          projectSnapshot,
          testCase: selection.testCase,
          environment: selection.environment,
          runtimeProfile: {
            browser: selection.environment.browser,
            baseUrl: selection.environment.url,
            viewport: selection.environment.viewport,
            locale: selection.environment.locale,
            headless: selection.environment.headless,
          },
          ...(modelConfigResolver ? { modelConfigResolver } : {}),
          browserSession: runtimeState.browserSession,
          ...(workerLease ? { workerLease } : {}),
        });
        const persistedResult = normalizeTerminalRunResponse(withCliProvenance(result, provenance));
        await persistRun(persistedResult, selection.environment);
        return toCliCaseResult(persistedResult, selection.environment);
      } catch (error) {
        const message = messageFor(error);
        const summary = `执行异常：${message}`;
        return persistSyntheticCliCaseResult({
          projectId: project.id,
          testCaseId: selection.testCase.id,
          environmentId: selection.environment.id,
          title: selection.testCase.name,
          status: 'error',
          summary,
          failureReason: message,
          reason: { code: 'executorError', message: summary },
          artifacts: [],
          provenance,
        }, selection.environment, persistRun);
      }
    };

    if (suite && suiteParent) {
      const suiteMembership = suiteParent.provenance.suite;
      const poolQualified = Boolean(runtime.browserPool && isChromiumHeadlessVersionedSuite(
        project,
        projectSnapshot.reproducibility,
        suite,
      ));
      const suiteResult = await new SuiteRunner({
        execute: async ({ testCase, environment, workerLease }) => {
          const result = await executeSelection({ testCase, environment, suite: suiteMembership }, workerLease);
          attemptedSuiteResults.set(`${testCase.id}@${testCase.version ?? 1}`, result);
          if (result.runId) persistedSuiteChildRunIds.add(result.runId);
          currentSuiteParentRecord = updateRunningCliSuiteRunRecord(
            currentSuiteParentRecord ?? suiteParent.record,
            attemptedSuiteResults,
            persistedSuiteChildRunIds,
          );
          await persistSuiteRun(currentSuiteParentRecord);
          return {
            status: result.status,
            summary: result.summary,
            ...(result.reason ? { reason: result.reason } : {}),
            ...(result.runId ? { runId: result.runId } : {}),
          };
        },
      }, {
        maxConcurrency: poolQualified ? runtime.browserPool!.maxConcurrency : 1,
        ...(poolQualified ? { browserPool: runtime.browserPool } : {}),
      }).run(project, suite);
      for (const suiteCaseResult of suiteResult.results) {
        const testCase = findTestCaseVersion(project, {
          id: suiteCaseResult.testCaseId,
          version: suiteCaseResult.testCaseVersion,
        });
        if (!testCase) continue;
        const attempted = attemptedSuiteResults.get(`${suiteCaseResult.testCaseId}@${suiteCaseResult.testCaseVersion}`);
        const cliResult = attempted
          ? {
              ...attempted,
              summary: suiteCaseResult.summary,
              ...(suiteCaseResult.reason ? { reason: suiteCaseResult.reason } : {}),
              attempts: suiteCaseResult.attempts,
              flaky: suiteCaseResult.flaky,
            }
          : {
              projectId: project.id,
              testCaseId: testCase.id,
              environmentId: suite.environmentId,
              title: testCase.name,
              status: suiteCaseResult.status,
              summary: suiteCaseResult.summary,
              ...(suiteCaseResult.status === 'failed' || suiteCaseResult.status === 'error' ? { failureReason: suiteCaseResult.summary } : {}),
              ...(suiteCaseResult.reason ? { reason: suiteCaseResult.reason } : {}),
              artifacts: [],
              attempts: suiteCaseResult.attempts,
              flaky: suiteCaseResult.flaky,
              provenance: createCliRunProvenance(
                projectSnapshot,
                testCase,
                suiteEnvironment(projectSnapshot, suite, testCase),
                runtimeState,
                suiteMembership,
              ),
            };
        const persistedMember = attempted ? cliResult : await persistSyntheticCliCaseResult(
          cliResult,
          suiteEnvironment(projectSnapshot, suite, testCase),
          persistRun,
        );
        results.push(persistedMember);
        if (persistedMember.runId) persistedSuiteChildRunIds.add(persistedMember.runId);
      }
      const completedParent = createCliSuiteRunRecord(
        suiteParent.provenance,
        suiteResult,
        results,
        persistedSuiteChildRunIds,
      );
      currentSuiteParentRecord = completedParent;
      suiteInfo = toCliSuiteRunInfo(completedParent, suiteResult);
      await persistSuiteRun(completedParent);
    } else {
      for (const selection of selections) {
        results.push(await executeSelection(selection));
      }
    }
  } catch (error) {
    if (!suiteParent || !suite) {
      throw error;
    }
    appendMissingSuiteResults(results, attemptedSuiteResults);
    const terminalParent = terminalizeCliSuiteRunRecord(
      currentSuiteParentRecord ?? suiteParent.record,
      error,
      attemptedSuiteResults,
      persistedSuiteChildRunIds,
    );
    await persistSuiteRun(terminalParent);
    suiteInfo = terminalCliSuiteRunInfo(terminalParent, suite, messageFor(error));
  } finally {
    await runtime.close();
  }

  const endedAt = new Date();
  const reportDirectory = path.join(dataDir, 'studio-data', 'artifacts');
  const reportSuffix = startedAt.toISOString().replace(/[:.]/g, '-');
  const junitPath = resolveOutputPath(
    command.junitPath ?? path.join(reportDirectory, `testbuddy-${reportSuffix}.junit.xml`),
  );
  const summary: CliRunSummary = {
    command: 'run',
    status: hasCliFailures(results, suiteInfo) ? 'failed' : 'passed',
    dataDir,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    reports: { junit: junitPath },
    results,
    ...(suiteInfo ? { suite: suiteInfo } : {}),
  };
  await writeFile(junitPath, renderJUnitReport(summary));
  if (command.jsonPath) {
    const jsonPath = resolveOutputPath(command.jsonPath);
    summary.reports.json = jsonPath;
    await writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`);
  }
  return summary;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    const command = parseCliArguments(argv);
    if (command.kind === 'help') {
      process.stdout.write(`${usage}\n`);
      return 0;
    }
    const summary = await executeCliCommand(command);
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    return cliExitCode(summary);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: 'error', error: messageFor(error) })}\n`);
    return error instanceof CliUsageError ? 2 : 1;
  }
}

function selectSuite(projectSnapshot: ProjectSnapshot, reference: VersionedTestAssetReference): SuiteAsset {
  const suite = findSuiteAsset(projectSnapshot.project, reference);
  if (!suite) {
    throw new CliUsageError(`项目 ${projectSnapshot.project.id} 中未找到 Suite：${reference.id}@${reference.version}`);
  }
  return suite;
}

function selectTestCase(
  projectSnapshot: ProjectSnapshot,
  reference: VersionedTestAssetReference,
  environmentOverrideId?: string,
): { testCase: TestCaseDraft; environment: ProjectEnvironment } {
  const project = projectSnapshot.project;
  const testCase = findTestCaseVersion(project, reference);
  if (!testCase) {
    throw new CliUsageError(`项目 ${project.id} 中未找到 Case：${reference.id}@${reference.version}`);
  }
  const environmentId = environmentOverrideId ?? testCase.environmentId;
  const environment = project.environments.find((item) => item.id === environmentId);
  if (!environment) {
    throw new CliUsageError(`项目 ${project.id} 中未找到环境 ID：${environmentId}`);
  }
  return { testCase, environment };
}

function parseVersionedReference(value: string, option: string): VersionedTestAssetReference {
  const separator = value.lastIndexOf('@');
  const id = separator > 0 ? value.slice(0, separator).trim() : '';
  const version = separator > 0 ? Number(value.slice(separator + 1)) : Number.NaN;
  if (!id || !Number.isSafeInteger(version) || version < 1) {
    throw new CliUsageError(`${option} 必须使用 <id@version> 格式。`);
  }
  return { id, version };
}

async function loadExistingState(store: StudioStore): Promise<StudioState> {
  return store.loadExisting();
}

function hasCliPlannerModelConfig(state: StudioState): boolean {
  const planner = state.agentModelConfig.planner;
  if (!planner.enabled) {
    return false;
  }
  if (planner.provider === 'openaiCompatible') {
    return Boolean(
      planner.modelBaseUrl.trim() &&
      planner.modelName.trim() &&
      planner.modelSecret.hasKey,
    );
  }
  return isMidsceneConfigured(state.midsceneConfig);
}

async function loadProjectSnapshot(store: StudioStore, projectId: string): Promise<ProjectSnapshot> {
  return new ProjectRepository({ studioStore: store }).load(projectId);
}

function createSerializedRunHistoryPersister(
  store: Pick<StudioStore, 'loadExisting' | 'save'>,
  getBrowserSession: () => BrowserSessionState,
): (result: RunTestCaseResponse, environment: ProjectEnvironment) => Promise<void> {
  let pending = Promise.resolve();
  return async (result, environment) => {
    const persistence = pending.then(async () => {
      const latestState = hydrateStudioState(await store.loadExisting());
      await store.save(appendRunToStudioState(latestState, result, environment, getBrowserSession()));
    });
    pending = persistence.catch(() => undefined);
    return persistence;
  };
}

function createSerializedSuiteRunHistoryPersister(
  store: Pick<StudioStore, 'loadExisting' | 'save'>,
): (record: SuiteRunRecord) => Promise<void> {
  return async (record) => {
    const latestState = hydrateStudioState(await store.loadExisting());
    await store.save(appendSuiteRunToStudioState(latestState, record));
  };
}

function createCliSuiteRunRecord(
  provenance: SuiteRunProvenance,
  result: SuiteRunResult,
  results: readonly CliCaseResult[],
  persistedChildRunIds: ReadonlySet<string>,
): SuiteRunRecord {
  const summary: SuiteRunRecord['summary'] = {
    passed: 0,
    failed: 0,
    blocked: 0,
    skipped: 0,
    cancelled: 0,
    error: 0,
  };
  result.results.forEach((member) => {
    summary[member.status] += 1;
  });
  const members = result.results.map((member): SuiteRunMemberRecord => {
    const matching = results.find((candidate) =>
      candidate.testCaseId === member.testCaseId && candidate.provenance?.testCase.version === member.testCaseVersion,
    ) ?? results.find((candidate) => candidate.testCaseId === member.testCaseId);
    if (!matching?.provenance) {
      throw new Error(`CLI Suite member ${member.testCaseId}@${member.testCaseVersion} is missing frozen provenance.`);
    }
    return {
      testCaseId: member.testCaseId,
      testCaseVersion: member.testCaseVersion,
      status: member.status,
      summary: member.summary,
      ...(member.reason ? { reason: structuredClone(member.reason) } : {}),
      attempts: member.attempts,
      flaky: member.flaky,
      ...(member.runId && persistedChildRunIds.has(member.runId) ? { runId: member.runId } : {}),
      provenance: structuredClone(matching.provenance),
    };
  });
  return {
    id: provenance.suite.parentRunId,
    provenance,
    startedAt: result.startedAt,
    finishedAt: result.endedAt,
    status: result.status,
    ...(result.reason ? { reasonCode: result.reason.code } : {}),
    memberRunIds: [...persistedChildRunIds],
    members,
    summary,
  };
}

function createCliSuiteParent(
  snapshot: ProjectSnapshot,
  suite: SuiteAsset,
  state: StudioState,
): { provenance: SuiteRunProvenance; record: SuiteRunRecord } {
  const parentRunId = createCliSuiteRunId();
  const environment = suiteRunEnvironment(snapshot, suite);
  const provenance = createCliSuiteRunProvenance(snapshot, suite, environment, state, parentRunId);
  return {
    provenance,
    record: {
      id: parentRunId,
      provenance,
      startedAt: provenance.createdAt,
      status: 'running',
      memberRunIds: [],
      members: [],
      summary: emptyCliSuiteSummary(),
    },
  };
}

function toCliSuiteRunInfo(record: SuiteRunRecord, result: SuiteRunResult): CliSuiteRunInfo {
  if (!record.finishedAt || record.status === 'running') {
    throw new Error('CLI Suite summary requires a terminal parent record.');
  }
  return {
    id: result.suiteId,
    version: result.suiteVersion,
    runId: record.id,
    status: record.status,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    effectiveConcurrency: result.effectiveConcurrency,
    issues: [...result.issues],
    summary: structuredClone(record.summary),
    members: structuredClone(record.members ?? []),
    provenance: record.provenance,
    ...(result.reason ? { reason: structuredClone(result.reason) } : {}),
  };
}

function emptyCliSuiteSummary(): SuiteRunRecord['summary'] {
  return {
    passed: 0,
    failed: 0,
    blocked: 0,
    skipped: 0,
    cancelled: 0,
    error: 0,
  };
}

function updateRunningCliSuiteRunRecord(
  record: SuiteRunRecord,
  attemptedResults: ReadonlyMap<string, CliCaseResult>,
  persistedChildRunIds: ReadonlySet<string>,
): SuiteRunRecord {
  const members = cliSuiteMembersFromResults(attemptedResults.values(), persistedChildRunIds);
  return {
    ...record,
    status: 'running',
    memberRunIds: [...persistedChildRunIds],
    members,
    summary: cliSuiteSummaryFromMembers(members),
  };
}

function terminalizeCliSuiteRunRecord(
  record: SuiteRunRecord,
  error: unknown,
  attemptedResults: ReadonlyMap<string, CliCaseResult>,
  persistedChildRunIds: ReadonlySet<string>,
): SuiteRunRecord {
  const cancelled = isRunCancelled(error);
  const members = cliSuiteMembersFromResults(attemptedResults.values(), persistedChildRunIds);
  return {
    ...record,
    status: cancelled ? 'cancelled' : 'error',
    reasonCode: cancelled ? 'userCancelled' : 'executorError',
    finishedAt: new Date().toISOString(),
    memberRunIds: [...persistedChildRunIds],
    members,
    summary: cliSuiteSummaryFromMembers(members),
  };
}

function cliSuiteMembersFromResults(
  results: Iterable<CliCaseResult>,
  persistedChildRunIds: ReadonlySet<string>,
): SuiteRunMemberRecord[] {
  return Array.from(results, (result) => {
    if (!result.provenance) {
      throw new Error(`CLI Suite child ${result.testCaseId} is missing frozen provenance.`);
    }
    return {
      testCaseId: result.testCaseId,
      testCaseVersion: result.provenance.testCase.version,
      status: result.status,
      summary: result.summary,
      ...(result.reason ? { reason: structuredClone(result.reason) } : {}),
      attempts: result.attempts ?? 1,
      flaky: result.flaky ?? false,
      ...(result.runId && persistedChildRunIds.has(result.runId) ? { runId: result.runId } : {}),
      provenance: structuredClone(result.provenance),
    };
  });
}

function cliSuiteSummaryFromMembers(
  members: readonly SuiteRunMemberRecord[],
): SuiteRunRecord['summary'] {
  return members.reduce((summary, member) => ({
    ...summary,
    [member.status]: summary[member.status] + 1,
  }), emptyCliSuiteSummary());
}

function appendMissingSuiteResults(
  results: CliCaseResult[],
  attemptedResults: ReadonlyMap<string, CliCaseResult>,
): void {
  attemptedResults.forEach((candidate) => {
    const version = candidate.provenance?.testCase.version;
    const alreadyReported = results.some((result) =>
      (candidate.runId && result.runId === candidate.runId) ||
      (result.testCaseId === candidate.testCaseId && result.provenance?.testCase.version === version),
    );
    if (!alreadyReported) {
      results.push(candidate);
    }
  });
}

function terminalCliSuiteRunInfo(
  record: SuiteRunRecord,
  suite: SuiteAsset,
  message: string,
): CliSuiteRunInfo {
  if (!record.finishedAt || record.status === 'running') {
    throw new Error('CLI Suite rejection requires a terminal parent record.');
  }
  const reason = {
    code: record.reasonCode ?? 'executorError',
    message,
  } satisfies RunReason;
  return {
    id: suite.id,
    version: suite.version,
    runId: record.id,
    status: record.status,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    effectiveConcurrency: 0,
    issues: [message],
    summary: structuredClone(record.summary),
    members: structuredClone(record.members ?? []),
    provenance: record.provenance,
    reason,
  };
}

function toCliCaseResult(result: RunTestCaseResponse, environment: ProjectEnvironment): CliCaseResult {
  if (result.detail.status === 'running' || !result.detail.provenance) {
    throw new Error('CLI run result must be terminal and carry frozen provenance.');
  }
  const reason = result.detail.reason ?? (result.detail.status === 'passed'
    ? undefined
    : fallbackCliRunReason(result.detail.status, result.detail.summary, result.detail.failureReason));
  return {
    projectId: result.detail.projectId,
    testCaseId: result.detail.testCaseId,
    environmentId: environment.id,
    title: result.detail.title,
    status: result.detail.status,
    runId: result.runId,
    duration: result.detail.duration,
    summary: result.detail.summary,
    ...(result.detail.failureReason ? { failureReason: result.detail.failureReason } : {}),
    ...(reason ? { reason } : {}),
    artifacts: result.detail.artifacts.map((artifact) => artifact.path),
    provenance: result.detail.provenance,
  };
}

function normalizeTerminalRunResponse(result: RunTestCaseResponse): RunTestCaseResponse {
  if (result.detail.status === 'running' || result.detail.status === 'passed' || result.detail.reason) {
    return result;
  }
  return {
    ...result,
    detail: {
      ...result.detail,
      reason: fallbackCliRunReason(result.detail.status, result.detail.summary, result.detail.failureReason),
    },
  };
}

async function persistSyntheticCliCaseResult(
  result: CliCaseResult,
  environment: ProjectEnvironment,
  persistRun: (result: RunTestCaseResponse, environment: ProjectEnvironment) => Promise<void>,
): Promise<CliCaseResult> {
  if (!result.provenance) {
    throw new Error('CLI terminal Case result must carry frozen provenance before persistence.');
  }
  const provenance = result.provenance;
  const runId = result.runId ?? `cli-run-${randomUUID()}`;
  const reason = result.reason ?? (result.status === 'passed'
    ? undefined
    : fallbackCliRunReason(result.status, result.summary, result.failureReason));
  const now = new Date().toISOString();
  const persistedResult = {
    ...result,
    runId,
    ...(reason ? { reason } : {}),
  };
  await persistRun({
    runId,
    title: persistedResult.title,
    detail: {
      id: runId,
      projectId: persistedResult.projectId,
      testCaseId: persistedResult.testCaseId,
      testCaseVersion: provenance.testCase.version,
      environmentId: persistedResult.environmentId,
      title: persistedResult.title,
      status: persistedResult.status,
      startedAt: now,
      endedAt: now,
      duration: '00:00:00',
      summary: persistedResult.summary,
      ...(persistedResult.failureReason ? { failureReason: persistedResult.failureReason } : {}),
      ...(reason ? { reason } : {}),
      provenance: structuredClone(provenance),
      logs: [],
      steps: [],
      artifacts: [],
    },
  }, environment);
  return persistedResult;
}

function fallbackCliRunReason(
  status: Exclude<RunStatus, 'running' | 'passed'>,
  summary: string,
  failureReason?: string,
): RunReason {
  const message = summary || failureReason || `CLI runtime reported ${status} without a structured reason.`;
  switch (status) {
    case 'failed':
      return { code: 'actionFailed', message };
    case 'blocked':
      return { code: 'unsupportedAction', message };
    case 'skipped':
      return { code: 'dependencyFailed', message };
    case 'cancelled':
      return { code: 'userCancelled', message };
    case 'error':
      return { code: 'executorError', message };
  }
}

export function cliExitCode(summary: CliRunSummary): number {
  return hasCliFailures(summary.results, summary.suite) ? 1 : 0;
}

function hasCliFailures(
  results: readonly Pick<CliCaseResult, 'status'>[],
  suite?: Pick<CliSuiteRunInfo, 'status'>,
): boolean {
  return results.some((result) => result.status === 'failed' || result.status === 'error') ||
    suite?.status === 'failed' || suite?.status === 'error';
}

function withCliProvenance(result: RunTestCaseResponse, provenance: RunProvenance): RunTestCaseResponse {
  return {
    ...result,
    detail: {
      ...result.detail,
      provenance: structuredClone(provenance),
    },
  };
}

function createCliRunProvenance(
  snapshot: ProjectSnapshot,
  testCase: TestCaseDraft,
  environment: ProjectEnvironment,
  state: StudioState,
  suiteMembership?: NonNullable<RunProvenance['suite']>,
): RunProvenance {
  const provenance = createRunProvenance(
    snapshot,
    { ...testCase, version: testCase.version ?? 1 },
    environment,
    createCliRuntimeMetadata(environment, state),
  );
  if (!suiteMembership) {
    return provenance;
  }
  return Object.freeze({
    ...provenance,
    suite: Object.freeze({
      reference: Object.freeze({ ...suiteMembership.reference }),
      parentRunId: suiteMembership.parentRunId,
    }),
  });
}

function createCliSuiteRunProvenance(
  snapshot: ProjectSnapshot,
  suite: SuiteAsset,
  environment: ProjectEnvironment,
  state: StudioState,
  parentRunId: string,
): SuiteRunProvenance {
  return createSuiteRunProvenance(
    snapshot,
    suite,
    environment,
    createCliRuntimeMetadata(environment, state),
    parentRunId,
  );
}

function createCliRuntimeMetadata(
  environment: ProjectEnvironment,
  state: StudioState,
): RunProvenanceRuntimeMetadata {
  return {
    browserProfile: { engine: environment.browser, headless: environment.headless },
    executor: { appVersion: 'test-buddy-cli', runnerVersion: 'runtime-bundle-v1' },
    model: {
      provider: 'midscene',
      name: state.midsceneConfig.modelName,
      endpoint: state.midsceneConfig.modelBaseUrl,
      hasKey: state.midsceneConfig.modelSecret.hasKey,
    },
    createdAt: new Date().toISOString(),
  };
}

function createCliSuiteRunId(): string {
  return `cli-suite-run-${randomUUID()}`;
}

function suiteRunEnvironment(snapshot: ProjectSnapshot, suite: SuiteAsset): ProjectEnvironment {
  const environment = snapshot.project.environments.find((candidate) => candidate.id === suite.environmentId);
  if (!environment) {
    throw new CliUsageError(`Suite ${suite.id}@${suite.version} has no exact environment.`);
  }
  return environment;
}

function suiteEnvironment(
  snapshot: ProjectSnapshot,
  suite: SuiteAsset,
  testCase: TestCaseDraft,
): ProjectEnvironment {
  return snapshot.project.environments.find((environment) => environment.id === suite.environmentId)
    ?? snapshot.project.environments.find((environment) => environment.id === testCase.environmentId)
    ?? (() => { throw new Error(`Suite ${suite.id}@${suite.version} has no exact environment.`); })();
}

function resolveOutputPath(candidatePath: string): string {
  return path.resolve(candidatePath);
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

function durationToSeconds(duration: string | undefined): number {
  if (!duration || !/^\d{2}:\d{2}:\d{2}$/.test(duration)) {
    return 0;
  }
  const [hours, minutes, seconds] = duration.split(':').map(Number);
  return hours * 3_600 + minutes * 60 + seconds;
}

function escapeXml(value: string): string {
  return Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0)!;
      return codePoint === 0x9
        || codePoint === 0xA
        || codePoint === 0xD
        || (codePoint >= 0x20 && codePoint <= 0xD7FF)
        || (codePoint >= 0xE000 && codePoint <= 0xFFFD)
        || (codePoint >= 0x10000 && codePoint <= 0x10FFFF);
    })
    .join('')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const invokedPath = process.argv[1];
if (invokedPath && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
