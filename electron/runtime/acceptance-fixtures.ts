import {
  createEmptyProject,
  createEmptySuiteAsset,
  createEmptyTestCase,
  type ProjectDraft,
  type ProjectEnvironment,
  type SuiteAsset,
} from '../../shared/studio.js';
import { calculateProjectAssetRevision } from '../projectAssetStore.js';

export interface LocalAcceptanceFixture {
  project: ProjectDraft;
  environment: ProjectEnvironment;
  suite: SuiteAsset;
  revision: string;
}

export interface LocalAcceptanceFixtureServer {
  url: string;
  close: () => Promise<void>;
}

/** Starts the only HTTP server used by local acceptance; it is bound to loopback. */
export async function startLocalAcceptanceFixtureServer(): Promise<LocalAcceptanceFixtureServer> {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>TestBuddy local acceptance fixture</title><main>ready</main>');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('Local acceptance fixture did not bind to loopback TCP.');
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

/** Builds the repository-owned, model-free fixture used for local acceptance only. */
export function createLocalAcceptanceFixture(baseUrl: string): LocalAcceptanceFixture {
  const project = createEmptyProject(20);
  const environment: ProjectEnvironment = {
    ...project.environments[0]!,
    id: 'env-acceptance-local',
    name: 'Acceptance local fixture',
    kind: 'local',
    url: baseUrl,
    entryPath: '/',
    browser: 'chromium',
    headless: true,
  };
  const testCases = Array.from({ length: 20 }, (_, index) => ({
    ...createEmptyTestCase(index + 1, project.groups[0]!.id, environment.id),
    id: `acceptance-case-${String(index + 1).padStart(2, '0')}`,
    version: 1,
    name: `Acceptance fixture ${String(index + 1).padStart(2, '0')}`,
    url: baseUrl,
    steps: [],
  }));
  const suite: SuiteAsset = {
    ...createEmptySuiteAsset({ selectedEnvironmentId: environment.id }, 20),
    id: 'acceptance-suite-local',
    version: 1,
    name: 'Local acceptance fixture suite',
    environmentId: environment.id,
    caseReferences: testCases.map((testCase) => ({ id: testCase.id, version: 1, dependsOn: [] })),
    execution: { concurrency: 1, failurePolicy: 'continue', retryLimit: 0 },
  };
  const immutableProject: ProjectDraft = {
    ...project,
    id: 'project-acceptance-local',
    name: 'Local acceptance fixture',
    defaultUrl: baseUrl,
    selectedEnvironmentId: environment.id,
    environments: [environment],
    testCases,
    suites: [suite],
  };

  return { project: immutableProject, environment, suite, revision: calculateProjectAssetRevision(immutableProject) };
}
import http from 'node:http';
