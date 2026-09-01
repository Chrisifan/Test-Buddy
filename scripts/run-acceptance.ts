import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { evaluateReleaseGate, type AcceptanceTarget, type ReleaseGateDecision } from '../shared/acceptance.js';
import {
  runLocalAcceptanceWithPublicAdapters,
  type DesktopSuiteExecutionBoundary,
  type LocalAcceptanceReport,
} from '../electron/runtime/acceptance-harness.js';
import {
  createLocalAcceptanceFixture,
  startLocalAcceptanceFixtureServer,
  type LocalAcceptanceFixtureServer,
} from '../electron/runtime/acceptance-fixtures.js';
import {
  createAcceptanceReportHash,
  type AcceptanceReport,
  type AcceptanceReportPayload,
  verifyAcceptanceReport,
} from './verify-acceptance-report.js';

type AcceptanceLane = 'localFixture' | 'staging' | 'model';

export interface RunAcceptanceDependencies {
  runLocalFixture?: (target: AcceptanceTarget) => Promise<LocalAcceptanceReport>;
}

export interface RunAcceptanceResult extends AcceptanceReport {
  files: { json: string; junit: string };
}

/** Executes the offline local lane, or fails closed before any external-lane work starts. */
export const runAcceptance = async (
  argv: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: RunAcceptanceDependencies = {},
): Promise<RunAcceptanceResult> => {
  const { lane, outputDir } = parseArguments(argv);
  if (lane !== 'localFixture') {
    assertExternalLaneAuthorized(lane, environment);
    throw new Error(`The ${lane} acceptance lane requires its protected CI executor and is not runnable from this process.`);
  }
  const target = localTarget();
  const evidenceDirectory = await createLocalAcceptanceRunDirectory(outputDir);
  const localReport = dependencies.runLocalFixture
    ? await dependencies.runLocalFixture(target)
    : await runDefaultLocalFixture(target, evidenceDirectory);
  const decision = requireLocalDecision(localReport);
  const payload: AcceptanceReportPayload = {
    schemaVersion: 1,
    lane,
    matrix: localReport.matrix,
    attempts: localReport.attempts,
    decision,
  };
  const report: AcceptanceReport = { ...payload, reportHash: createAcceptanceReportHash(payload) };
  const files = await writeReport(report, evidenceDirectory);
  await verifyAcceptanceReport(files.json);
  return { ...report, files };
};

const parseArguments = (argv: readonly string[]): { lane: AcceptanceLane; outputDir: string } => {
  let lane: AcceptanceLane | undefined;
  let outputDir = path.resolve('.acceptance', 'local');
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--lane') {
      const value = argv[++index];
      if (value === 'localFixture' || value === 'staging' || value === 'model') {
        lane = value;
        continue;
      }
      throw new Error('Acceptance lane must be localFixture, staging, or model.');
    }
    if (argument === '--output-dir') {
      const value = argv[++index];
      if (!value) {
        throw new Error('Acceptance output directory is required.');
      }
      outputDir = path.resolve(value);
      continue;
    }
    throw new Error(`Unknown acceptance option: ${argument ?? ''}`);
  }
  if (!lane) {
    throw new Error('Acceptance lane is required.');
  }
  return { lane, outputDir };
};

const assertExternalLaneAuthorized = (lane: Exclude<AcceptanceLane, 'localFixture'>, environment: Readonly<Record<string, string | undefined>>): void => {
  if (environment.TESTBUDDY_ACCEPTANCE_CONSENT !== '1') {
    throw new Error('External acceptance requires explicit consent.');
  }
  const allowedOrigin = environment.TESTBUDDY_ACCEPTANCE_ALLOWED_ORIGIN;
  if (!isExactHttpOrigin(allowedOrigin)) {
    throw new Error('External acceptance requires an exact http(s) origin allowlist.');
  }
  if (lane === 'model' && !environment.TESTBUDDY_ACCEPTANCE_MODEL_SECRET_REF?.trim()) {
    throw new Error('Model acceptance requires an available main-owned model secret reference.');
  }
};

const runDefaultLocalFixture = async (target: AcceptanceTarget, evidenceDirectory: string): Promise<LocalAcceptanceReport> => {
  return withLocalFixtureServer(startLocalAcceptanceFixtureServer, async (server) => {
    const fixture = createLocalAcceptanceFixture(server.url);
    const executeDesktopSuite = await loadDesktopSuiteBoundary();
    return runLocalAcceptanceWithPublicAdapters({
      rootDir: evidenceDirectory,
      target,
      fixture,
      repetitions: 10,
      executeDesktopSuite,
    });
  });
};

const loadDesktopSuiteBoundary = async (): Promise<DesktopSuiteExecutionBoundary> => {
  const modulePath = '../electron/ipc/runtime-ipc-handlers.js';
  const module = await import(modulePath) as { executeDesktopSuiteIntent?: DesktopSuiteExecutionBoundary };
  if (!module.executeDesktopSuiteIntent) {
    throw new Error('Desktop acceptance requires the public desktop-main Suite boundary.');
  }
  return module.executeDesktopSuiteIntent;
};

/** Keeps previous local acceptance evidence intact when the command is rerun. */
export const createLocalAcceptanceRunDirectory = async (outputDir: string): Promise<string> => {
  await fs.mkdir(outputDir, { recursive: true });
  return fs.mkdtemp(path.join(outputDir, 'runs-'));
};

/** Ensures the loopback fixture outlives all adapter browser activity. */
export const withLocalFixtureServer = async <T>(
  start: () => Promise<LocalAcceptanceFixtureServer>,
  execute: (server: LocalAcceptanceFixtureServer) => Promise<T>,
): Promise<T> => {
  const server = await start();
  try {
    return await execute(server);
  } finally {
    await server.close();
  }
};

const localTarget = (): AcceptanceTarget => {
  return {
    id: 'local-fixture',
    kind: 'localFixture',
    configFingerprint: createHash('sha256').update('testbuddy-local-fixture-v1', 'utf8').digest('hex'),
    requiredForRelease: true,
  };
};

const requireLocalDecision = (report: LocalAcceptanceReport): ReleaseGateDecision => {
  const decision = evaluateReleaseGate(report.matrix, report.attempts);
  if (decision.status !== 'readyForLocalReleaseClaim') {
    throw new Error('Local acceptance did not meet the release threshold.');
  }
  return decision;
};

const writeReport = async (report: AcceptanceReport, outputDir: string): Promise<{ json: string; junit: string }> => {
  await fs.mkdir(outputDir, { recursive: true });
  const json = path.join(outputDir, 'acceptance-report.json');
  const junit = path.join(outputDir, 'acceptance-report.junit.xml');
  await fs.writeFile(json, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.writeFile(junit, renderJUnit(report), 'utf8');
  return { json, junit };
};

const renderJUnit = (report: AcceptanceReport): string => {
  const tests = report.attempts.length * 20;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="TestBuddy Acceptance ${report.lane}" tests="${tests}" failures="0" errors="0" skipped="0">\n  <system-out>decision=${report.decision.status} reportHash=${report.reportHash}</system-out>\n</testsuite>\n`;
};

const isExactHttpOrigin = (value: string | undefined): boolean => {
  if (!value || /[?#@]/.test(value)) {
    return false;
  }
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
  } catch {
    return false;
  }
};

const main = async (): Promise<void> => {
  const result = await runAcceptance(process.argv.slice(2));
  process.stdout.write(`${result.files.json}\n`);
};

if (process.argv[1]?.endsWith('run-acceptance.js')) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
