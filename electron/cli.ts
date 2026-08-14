import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  findSuiteAsset,
  findTestCaseVersion,
  hydrateStudioState,
  isAgentRunnableTestCase,
  isMidsceneConfigured,
  type ProjectEnvironment,
  type RunTestCaseResponse,
  type RunTone,
  type StudioState,
  type TestCaseDraft,
  type SuiteAsset,
  type VersionedTestAssetReference,
} from '../shared/studio.js';
import { nodePngImageAdapter } from './runtime/node-png-image-adapter.js';
import { appendRunToStudioState } from './runtime/run-history.js';
import { createRuntimeBundle } from './runtime/runtime-bundle.js';
import { ProjectRepository, type ProjectSnapshot } from './projectRepository.js';
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
  status: RunTone;
  runId?: string;
  duration?: string;
  summary: string;
  failureReason?: string;
  artifacts: string[];
  attempts?: number;
  flaky?: boolean;
}

export interface CliSuiteRunInfo {
  id: string;
  version: number;
  status: Exclude<RunTone, 'running'>;
  effectiveConcurrency: number;
  issues: string[];
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
  const suitePreflight: CliCaseResult[] = summary.suite?.issues.length
    ? [{
        projectId: 'suite',
        testCaseId: 'suite-preflight',
        environmentId: '',
        title: `Suite ${summary.suite.id}@${summary.suite.version} preflight`,
        status: 'neutral' as const,
        summary: summary.suite.issues.join('\n'),
        artifacts: [],
      } satisfies CliCaseResult]
    : [];
  const reportResults = [...summary.results, ...suitePreflight];
  const failures = reportResults.filter((result) => result.status === 'failed').length;
  const errors = reportResults.filter((result) => result.status === 'neutral').length;
  const elapsedSeconds = Math.max(
    0,
    (new Date(summary.endedAt).getTime() - new Date(summary.startedAt).getTime()) / 1_000,
  );
  const cases = reportResults
    .map((result) => {
      const testcase = `  <testcase classname="${escapeXml(result.projectId)}" name="${escapeXml(result.title)}" time="${durationToSeconds(result.duration).toFixed(3)}">`;
      const reason = escapeXml(result.failureReason ?? result.summary);
      const output = `    <system-out>${escapeXml(result.summary)}</system-out>`;
      if (result.status === 'passed') {
        return `${testcase}\n${output}\n  </testcase>`;
      }
      const outcome = result.status === 'failed'
        ? `    <failure message="${reason}">${reason}</failure>`
        : `    <error type="incomplete" message="${reason}">${reason}</error>`;
      return `${testcase}\n${outcome}\n${output}\n  </testcase>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="TestBuddy CLI" tests="${reportResults.length}" failures="${failures}" errors="${errors}" time="${elapsedSeconds.toFixed(3)}" timestamp="${escapeXml(summary.startedAt)}">
${cases}
</testsuite>
`;
}

export async function executeCliCommand(command: Exclude<ParsedCommand, { kind: 'help' }>): Promise<CliRunSummary> {
  const dataDir = path.resolve(command.dataDir);
  const store = new StudioStore(dataDir);
  const rawState = await loadExistingState(store);
  let state = hydrateStudioState(rawState);
  const projectSnapshot = await loadProjectSnapshot(store, command.projectId);
  const project = projectSnapshot.project;
  const selections = command.caseReferences.map((reference) => selectTestCase(projectSnapshot, reference, command.environmentId));
  const suite = command.suiteReference ? selectSuite(projectSnapshot, command.suiteReference) : undefined;
  const startedAt = new Date();
  const runtime = createRuntimeBundle({
    rootDir: dataDir,
    visualDiffImageAdapter: nodePngImageAdapter,
  });
  const results: CliCaseResult[] = [];
  let suiteInfo: CliSuiteRunInfo | undefined;

  try {
    await runtime.ensureReady();
    const executeSelection = async (selection: { testCase: TestCaseDraft; environment: ProjectEnvironment }): Promise<CliCaseResult> => {
      if (isAgentRunnableTestCase(selection.testCase) && !isMidsceneConfigured(state.midsceneConfig)) {
        return {
          projectId: project.id,
          testCaseId: selection.testCase.id,
          environmentId: selection.environment.id,
          title: selection.testCase.name,
          status: 'failed',
          summary: '该 Agent 用例需要已配置的 Midscene 模型，当前数据目录未包含可用模型配置。',
          failureReason: 'Midscene 模型未配置。',
          artifacts: [],
        };
      }
      try {
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
          midsceneConfig: state.midsceneConfig,
          agentModelConfig: state.agentModelConfig,
          browserSession: state.browserSession,
        });
        state = appendRunToStudioState(state, result, selection.environment, runtime.browserRuntime.getState());
        await store.save(state);
        return toCliCaseResult(result, selection.environment);
      } catch (error) {
        return {
          projectId: project.id,
          testCaseId: selection.testCase.id,
          environmentId: selection.environment.id,
          title: selection.testCase.name,
          status: 'failed',
          summary: `执行异常：${messageFor(error)}`,
          failureReason: messageFor(error),
          artifacts: [],
        };
      }
    };

    if (suite) {
      const suiteCases = suite.caseReferences
        .map((reference) => findTestCaseVersion(project, reference))
        .filter((testCase): testCase is TestCaseDraft => Boolean(testCase));
      const missingModelCases = suiteCases.filter((testCase) => isAgentRunnableTestCase(testCase) && !isMidsceneConfigured(state.midsceneConfig));
      if (missingModelCases.length) {
        suiteInfo = {
          id: suite.id,
          version: suite.version,
          status: 'failed',
          effectiveConcurrency: 1,
          issues: [],
        };
        missingModelCases.forEach((testCase) => {
          results.push({
            projectId: project.id,
            testCaseId: testCase.id,
            environmentId: suite.environmentId,
            title: testCase.name,
            status: 'failed',
            summary: '该 Agent 用例需要已配置的 Midscene 模型，当前数据目录未包含可用模型配置。',
            failureReason: 'Midscene 模型未配置。',
            artifacts: [],
            attempts: 1,
            flaky: false,
          });
        });
      } else {
        const suiteResponse = await runtime.runSuite({
          projectSnapshot,
          suite,
          environment: findEnvironment(projectSnapshot, suite.environmentId),
          runtimeProfile: state.runtimeProfile,
          midsceneConfig: state.midsceneConfig,
          agentModelConfig: state.agentModelConfig,
          browserSession: state.browserSession,
        });
        const suiteResult = suiteResponse.detail.suite;
        suiteInfo = {
          id: suiteResult.suiteId,
          version: suiteResult.suiteVersion,
          status: suiteResult.status,
          effectiveConcurrency: suiteResult.effectiveConcurrency,
          issues: suiteResult.issues,
        };
        for (const detail of suiteResponse.detail.caseDetails) {
          const environment = findEnvironment(projectSnapshot, detail.environmentId);
          state = appendRunToStudioState(state, { runId: detail.id, title: detail.title, detail }, environment, runtime.browserRuntime.getState());
        }
        if (suiteResponse.detail.caseDetails.length) {
          await store.save(state);
        }
        suiteResult.results.forEach((suiteCaseResult) => {
          const testCase = findTestCaseVersion(project, {
            id: suiteCaseResult.testCaseId,
            version: suiteCaseResult.testCaseVersion,
          });
          if (!testCase) return;
          const detail = suiteCaseResult.runId
            ? suiteResponse.detail.caseDetails.find((candidate) => candidate.id === suiteCaseResult.runId)
            : undefined;
          results.push(detail
            ? {
                ...toCliCaseResult({ runId: detail.id, title: detail.title, detail }, findEnvironment(projectSnapshot, detail.environmentId)),
                summary: suiteCaseResult.summary,
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
                ...(suiteCaseResult.status === 'failed' ? { failureReason: suiteCaseResult.summary } : {}),
                artifacts: [],
                attempts: suiteCaseResult.attempts,
                flaky: suiteCaseResult.flaky,
              });
        });
      }
    } else {
      for (const selection of selections) {
        results.push(await executeSelection(selection));
      }
    }
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
    status: suiteInfo
      ? suiteInfo.status === 'passed' ? 'passed' : 'failed'
      : results.every((result) => result.status === 'passed') ? 'passed' : 'failed',
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
    return summary.status === 'passed' ? 0 : 1;
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

function findEnvironment(projectSnapshot: ProjectSnapshot, environmentId: string): ProjectEnvironment {
  const environment = projectSnapshot.project.environments.find((candidate) => candidate.id === environmentId);
  if (!environment) {
    throw new CliUsageError(`项目 ${projectSnapshot.project.id} 中未找到环境 ID：${environmentId}`);
  }
  return environment;
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
  try {
    return await store.loadExisting();
  } catch (error) {
    throw new CliUsageError(messageFor(error));
  }
}

async function loadProjectSnapshot(store: StudioStore, projectId: string): Promise<ProjectSnapshot> {
  try {
    return await new ProjectRepository({ studioStore: store }).load(projectId);
  } catch (error) {
    throw new CliUsageError(messageFor(error));
  }
}

function toCliCaseResult(result: RunTestCaseResponse, environment: ProjectEnvironment): CliCaseResult {
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
    artifacts: result.detail.artifacts.map((artifact) => artifact.path),
  };
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
  return value
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
