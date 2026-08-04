import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  hydrateStudioState,
  isAgentRunnableTestCase,
  isMidsceneConfigured,
  type ProjectDraft,
  type ProjectEnvironment,
  type RunTestCaseResponse,
  type RunTone,
  type StudioState,
  type TestCaseDraft,
} from '../shared/studio.js';
import { nodePngImageAdapter } from './runtime/node-png-image-adapter.js';
import { appendRunToStudioState } from './runtime/run-history.js';
import { createRuntimeBundle } from './runtime/runtime-bundle.js';
import { StudioStore } from './studioStore.js';

const usage = `Usage:
  testbuddy run --data-dir <path> --project-id <id> --case-id <id> [--case-id <id> ...] [--environment-id <id>] [--junit <path>] [--json <path>]

Options:
  --data-dir        TestBuddy data root containing studio-data/state.json
  --project-id      Stable project ID
  --case-id         Stable test case ID; repeat for multiple cases
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
      caseIds: string[];
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
    if (!['--data-dir', '--project-id', '--case-id', '--environment-id', '--junit', '--json'].includes(option)) {
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
  const caseIds = [...new Set(values.get('--case-id') ?? [])];
  if (!dataDir || !projectId || !caseIds.length) {
    throw new CliUsageError('run 命令必须提供 --data-dir、--project-id 和至少一个 --case-id。');
  }

  return {
    kind: 'run',
    dataDir,
    projectId,
    caseIds,
    ...(singleValue('--environment-id') ? { environmentId: singleValue('--environment-id') } : {}),
    ...(singleValue('--junit') ? { junitPath: singleValue('--junit') } : {}),
    ...(singleValue('--json') ? { jsonPath: singleValue('--json') } : {}),
  };
}

export function renderJUnitReport(summary: CliRunSummary): string {
  const failures = summary.results.filter((result) => result.status === 'failed').length;
  const errors = summary.results.filter((result) => result.status === 'neutral').length;
  const elapsedSeconds = Math.max(
    0,
    (new Date(summary.endedAt).getTime() - new Date(summary.startedAt).getTime()) / 1_000,
  );
  const cases = summary.results
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
<testsuite name="TestBuddy CLI" tests="${summary.results.length}" failures="${failures}" errors="${errors}" time="${elapsedSeconds.toFixed(3)}" timestamp="${escapeXml(summary.startedAt)}">
${cases}
</testsuite>
`;
}

export async function executeCliCommand(command: Exclude<ParsedCommand, { kind: 'help' }>): Promise<CliRunSummary> {
  const dataDir = path.resolve(command.dataDir);
  const store = new StudioStore(dataDir);
  const rawState = await loadExistingState(store);
  let state = hydrateStudioState(rawState);
  const project = findProject(state, command.projectId);
  const selections = command.caseIds.map((caseId) => selectTestCase(project, caseId, command.environmentId));
  const startedAt = new Date();
  const runtime = createRuntimeBundle({
    rootDir: dataDir,
    visualDiffImageAdapter: nodePngImageAdapter,
  });
  const results: CliCaseResult[] = [];

  try {
    await runtime.ensureReady();
    for (const selection of selections) {
      if (isAgentRunnableTestCase(selection.testCase) && !isMidsceneConfigured(state.midsceneConfig)) {
        results.push({
          projectId: project.id,
          testCaseId: selection.testCase.id,
          environmentId: selection.environment.id,
          title: selection.testCase.name,
          status: 'failed',
          summary: '该 Agent 用例需要已配置的 Midscene 模型，当前数据目录未包含可用模型配置。',
          failureReason: 'Midscene 模型未配置。',
          artifacts: [],
        });
        continue;
      }

      try {
        const result = await runtime.runTestCase({
          project,
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
        results.push(toCliCaseResult(result, selection.environment));
      } catch (error) {
        results.push({
          projectId: project.id,
          testCaseId: selection.testCase.id,
          environmentId: selection.environment.id,
          title: selection.testCase.name,
          status: 'failed',
          summary: `执行异常：${messageFor(error)}`,
          failureReason: messageFor(error),
          artifacts: [],
        });
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
    status: results.every((result) => result.status === 'passed') ? 'passed' : 'failed',
    dataDir,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    reports: { junit: junitPath },
    results,
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

function findProject(state: StudioState, projectId: string): ProjectDraft {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) {
    throw new CliUsageError(`未找到项目 ID：${projectId}`);
  }
  return project;
}

function selectTestCase(
  project: ProjectDraft,
  testCaseId: string,
  environmentOverrideId?: string,
): { testCase: TestCaseDraft; environment: ProjectEnvironment } {
  const testCase = project.testCases.find((item) => item.id === testCaseId);
  if (!testCase) {
    throw new CliUsageError(`项目 ${project.id} 中未找到用例 ID：${testCaseId}`);
  }
  const environmentId = environmentOverrideId ?? testCase.environmentId;
  const environment = project.environments.find((item) => item.id === environmentId);
  if (!environment) {
    throw new CliUsageError(`项目 ${project.id} 中未找到环境 ID：${environmentId}`);
  }
  return { testCase, environment };
}

async function loadExistingState(store: StudioStore): Promise<StudioState> {
  try {
    return await store.loadExisting();
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
