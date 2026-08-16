import type { AgentModelAssignment, AgentPlanStepDraft, AgentRecoveryPlan, AgentReporterSummary, AgentRunResult, AgentStep } from './agent.js';

export type RunStatus = 'running' | 'passed' | 'failed' | 'blocked' | 'skipped' | 'cancelled' | 'error';
/**
 * Transitional status used only by live renderer and runner APIs that have
 * not yet completed the lifecycle migration. Persisted records use RunStatus.
 */
export type RunTone = RunStatus | 'neutral';
export type RunReasonCode =
  | 'assertionFailed'
  | 'actionFailed'
  | 'missingAssetVersion'
  | 'fixturePreflight'
  | 'credentialUnavailable'
  | 'dependencyFailed'
  | 'userCancelled'
  | 'unsupportedAction'
  | 'executorError'
  | 'legacyAmbiguousNeutral';

export interface RunReason {
  code: RunReasonCode;
  message: string;
}
export type ChatRole = 'system' | 'user' | 'assistant';
export type CommandMode = 'ai' | 'aiAssert' | 'aiQuery';
export type StepType = 'ai' | 'aiAssert' | 'aiQuery';
export type TestStepType = StepType | 'recordingReplay' | 'manual';
export type TestCaseRunBlocker = 'emptySteps' | 'emptyTitle' | 'emptyInstruction' | 'missingRecording';
export type TestStepRunBlocker = Exclude<TestCaseRunBlocker, 'emptySteps'>;
export type WorkflowKind = 'scenario' | 'assertion' | 'extraction';
export type TestCaseKind = WorkflowKind | 'recording';
export type BrowserEngine = 'chromium' | 'firefox' | 'webkit';
export type ViewportPreset = 'desktop' | 'laptop' | 'mobile';
export type TestCaseSource = 'manual' | 'naturalLanguage' | 'recording' | 'prd' | 'reporter';
export type EnvironmentKind = 'local' | 'staging' | 'productionMirror';
export type CredentialKind = 'password' | 'cookie' | 'token';
export type StorageStateAvailability = 'available' | 'expired' | 'unknown';
export type BrowserSessionStatus = 'idle' | 'starting' | 'ready' | 'navigating' | 'closed' | 'error';
export type PrdDocumentKind = 'pdf' | 'markdown' | 'text';
export type PrdAnalysisStatus = 'draft' | 'analyzed';
export type PrdAnalysisSource = 'rule' | 'model';
export type PrdAnalysisFallbackReason =
  | 'modelDisabled'
  | 'modelNotConfigured'
  | 'noRulePaths'
  | 'requestFailed'
  | 'invalidResponse'
  | 'desktopUnavailable';
export type RecordingSource = 'live' | 'imported';
export type RecordingStepKind = 'navigate' | 'click' | 'input' | 'wait' | 'assert' | 'snapshot';
export type ThemeMode = 'light' | 'dark' | 'system';
export type LocaleMode = 'zh-CN' | 'en-US' | 'system';
export type AgentModelRole = 'planner' | 'executor' | 'verifier' | 'reporter';
export type AgentModelProvider = 'reuseMidscene' | 'openaiCompatible';

export interface RunSummary {
  id: string;
  name: string;
  status: RunStatus;
  duration: string;
  summary: string;
  reason?: RunReason;
  projectId?: string;
  testCaseId?: string;
  documentId?: string;
  environmentId?: string;
  environmentName?: string;
  startedAt?: string;
}

export interface WorkflowStepDraft {
  id: string;
  type: StepType;
  title: string;
  body: string;
}

export interface WorkflowDraft {
  id: string;
  kind: WorkflowKind;
  name: string;
  category: string;
  lastEdited: string;
  url: string;
  notes: string;
  steps: WorkflowStepDraft[];
}

export type TestStepReviewStatus = 'needsReview' | 'confirmed';
export type TestStepActionRisk = 'low' | 'medium' | 'high' | 'unknown';
export type TestStepModelRequirement = 'none' | 'required' | 'notApplicable';
export type TestLocatorQuality = 'strong' | 'acceptable' | 'weak' | 'unresolved';

export interface TestLocatorFingerprint {
  selector: string;
  role?: string;
  name?: string;
  scope?: string;
  publicAttributes?: Record<string, string>;
  quality: TestLocatorQuality;
}

/** A persisted input value source. It never contains the resolved value. */
export interface CredentialTestInputBinding {
  kind: 'credential';
  credentialId: string;
  field: 'username' | 'secret';
}

/**
 * A reference to a declared setup output from one exact Fixture version. The
 * value is resolved only while that Case run is active in the main process.
 */
export interface FixtureOutputTestInputBinding {
  kind: 'fixtureOutput';
  fixtureId: string;
  fixtureVersion: number;
  outputName: string;
}

export type TestInputValueBinding = CredentialTestInputBinding | FixtureOutputTestInputBinding;

/**
 * A structured input target captured from a passed Agent Run. The Agent value
 * is intentionally absent; an editor must attach an approved value binding.
 */
export interface TestInputBindingTarget {
  kind: 'input' | 'select';
  locator: TestLocatorFingerprint;
}

export type DeterministicTestAction =
  | { kind: 'navigate'; url: string }
  | { kind: 'click'; locator: TestLocatorFingerprint }
  | { kind: 'input'; locator: TestLocatorFingerprint; binding: TestInputValueBinding }
  | { kind: 'select'; locator: TestLocatorFingerprint; binding: TestInputValueBinding }
  | { kind: 'waitForSelector'; locator: TestLocatorFingerprint; timeoutMs?: number }
  | { kind: 'waitForTimeout'; timeoutMs: number }
  | { kind: 'scrollTo'; locator: TestLocatorFingerprint };

export type ExplicitTestAssertion =
  | { id: string; version: 1; kind: 'urlContains' | 'titleContains' | 'pageContains'; expected: string }
  | { id: string; version: 1; kind: 'locatorVisible'; locator: TestLocatorFingerprint }
  | { id: string; version: 1; kind: 'locatorTextContains'; locator: TestLocatorFingerprint; expected: string };

export interface TestStepExecutionDraft {
  schemaVersion: 2;
  intent: string;
  reviewStatus: TestStepReviewStatus;
  actionRisk: TestStepActionRisk;
  action?: DeterministicTestAction;
  inputBindingTarget?: TestInputBindingTarget;
  assertion?: ExplicitTestAssertion;
  provenance?: {
    source: 'agentRun';
    runId: string;
    stepId: string;
  };
}

export interface TestStepDraft {
  id: string;
  type: TestStepType;
  title: string;
  body: string;
  recordingId?: string;
  execution?: TestStepExecutionDraft;
}

export interface VersionedTestAssetReference {
  id: string;
  version: number;
}

/** Immutable, redacted execution inputs retained with a completed Case run. */
export interface RunProvenance {
  schemaVersion: 1;
  projectId: string;
  projectRevision: string;
  source: 'projectDirectory' | 'legacyStudioStore';
  reproducibility: 'versioned' | 'legacy';
  testCase: VersionedTestAssetReference;
  /** Present only when this Case was executed as a member of a Suite. */
  suite?: {
    reference: VersionedTestAssetReference;
    parentRunId: string;
  };
  fixtures: VersionedTestAssetReference[];
  reusableFlows: VersionedTestAssetReference[];
  baselines: VersionedTestAssetReference[];
  environment: {
    id: string;
    name: string;
    baseUrl: string;
    storageStateRef?: string;
  };
  browserProfile: {
    engine: BrowserEngine;
    headless: boolean;
  };
  executor: {
    appVersion: string;
    runnerVersion: string;
  };
  model: {
    provider?: string;
    model?: string;
    endpointFingerprint?: string;
    hasKey: boolean;
  };
  createdAt: string;
}

/** Immutable, Suite-level execution identity without a fabricated Case. */
export interface SuiteRunProvenance extends Omit<RunProvenance, 'testCase' | 'suite'> {
  suite: {
    reference: VersionedTestAssetReference;
    parentRunId: string;
  };
}

export interface SuiteRunRecord {
  id: string;
  provenance: SuiteRunProvenance;
  startedAt: string;
  finishedAt?: string;
  status: RunStatus;
  reasonCode?: RunReasonCode;
  memberRunIds: string[];
  summary: Record<Exclude<RunStatus, 'running'>, number>;
}

export type SuiteFailurePolicy = 'continue' | 'failFast';

/**
 * An immutable Case reference inside a Suite. Dependencies use the exact
 * Case revision too, so an edited Case can never silently alter a Suite DAG.
 */
export interface SuiteCaseReference extends VersionedTestAssetReference {
  dependsOn: VersionedTestAssetReference[];
}

/** Persisted scheduling intent. The shared resolver does not run work yet. */
export interface SuiteExecutionPolicy {
  concurrency: number;
  failurePolicy: SuiteFailurePolicy;
  retryLimit: number;
}

/** A versioned collection of Cases for a single target environment. */
export interface SuiteAsset {
  schemaVersion: 1;
  id: string;
  version: number;
  name: string;
  description: string;
  tags: string[];
  environmentId: string;
  caseReferences: SuiteCaseReference[];
  execution: SuiteExecutionPolicy;
  createdAt: string;
  updatedAt: string;
}

export type SuiteResolutionIssueKind =
  | 'emptySuite'
  | 'missingEnvironment'
  | 'missingCase'
  | 'duplicateCaseVersion'
  | 'duplicateCaseReference'
  | 'staleCaseVersion'
  | 'missingDependency'
  | 'cyclicDependency';

export interface SuiteResolutionIssue {
  kind: SuiteResolutionIssueKind;
  reference?: VersionedTestAssetReference;
  message: string;
}

export interface ResolvedSuiteCase {
  reference: SuiteCaseReference;
  testCase: TestCaseDraft;
}

export interface SuiteCaseResolution {
  environment?: ProjectEnvironment;
  orderedCases: ResolvedSuiteCase[];
  issues: SuiteResolutionIssue[];
}

export interface SuiteCaseRunResult {
  testCaseId: string;
  testCaseVersion: number;
  status: Exclude<RunStatus, 'running'>;
  summary: string;
  reason?: RunReason;
  attempts: number;
  flaky: boolean;
  runId?: string;
}

export interface SuiteRunResult {
  suiteId: string;
  suiteVersion: number;
  environmentId: string;
  status: Exclude<RunStatus, 'running'>;
  reason?: RunReason;
  startedAt: string;
  endedAt: string;
  effectiveConcurrency: number;
  results: SuiteCaseRunResult[];
  issues: string[];
}

/** Creates a new mutable draft; saved changes must publish a new version. */
export function createEmptySuiteAsset(project: Pick<ProjectDraft, 'selectedEnvironmentId'>, seed: number): SuiteAsset {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: `suite-${Date.now()}-${seed}`,
    version: 1,
    name: `新的 Suite ${seed}`,
    description: '',
    tags: [],
    environmentId: project.selectedEnvironmentId,
    caseReferences: [],
    execution: {
      concurrency: 1,
      failurePolicy: 'continue',
      retryLimit: 0,
    },
    createdAt: now,
    updatedAt: now,
  };
}

/** Never resolves to a newer Suite version on behalf of a caller. */
export function findSuiteAsset(
  project: Pick<ProjectDraft, 'suites'>,
  reference: VersionedTestAssetReference,
): SuiteAsset | undefined {
  return project.suites.find((suite) => suite.id === reference.id && suite.version === reference.version);
}

export type FixtureValueType = 'string' | 'number' | 'boolean' | 'json';
export type FixtureExecutionMode = 'http' | 'ui' | 'script';
export type FixtureConcurrency = 'parallel' | 'exclusive';
export type FixtureHttpMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type FixtureHttpJsonValue =
  | string
  | number
  | boolean
  | null
  | FixtureHttpJsonValue[]
  | { [key: string]: FixtureHttpJsonValue };

/** A bounded top-level JSON pointer from an HTTP response to a declared output. */
export interface FixtureHttpResponseOutputMapping {
  outputName: string;
  jsonPointer: string;
}

/**
 * A deliberately small HTTP contract for data setup and cleanup. It never
 * carries headers, credentials, cookies, absolute URLs, or variable
 * interpolation. The runtime resolves `path` against the selected
 * environment only after validating it as a same-origin relative API path.
 */
export interface FixtureHttpDeclaration {
  method: FixtureHttpMethod;
  path: string;
  expectedStatuses: number[];
  body?: FixtureHttpJsonValue;
  /** Setup-only, declared response values. Values never become run evidence. */
  responseOutputs?: FixtureHttpResponseOutputMapping[];
}

/** Typed data admitted to or produced by a fixture lifecycle. */
export interface FixtureParameter {
  name: string;
  type: FixtureValueType;
  required: boolean;
  description?: string;
}

/**
 * A lifecycle declaration deliberately contains no resolved credentials or
 * script content. Script execution is permitted only after a later trust
 * check against this relative path and content hash.
 */
export interface FixtureLifecycleDeclaration {
  mode: FixtureExecutionMode;
  summary: string;
  http?: FixtureHttpDeclaration;
  script?: {
    relativePath: string;
    contentHash: string;
    requiredEnvironment: string[];
  };
}

/** A versioned, non-secret setup/cleanup asset owned by one project. */
export interface FixtureAsset {
  schemaVersion: 1;
  id: string;
  version: number;
  name: string;
  description: string;
  inputs: FixtureParameter[];
  outputs: FixtureParameter[];
  credentialIds: string[];
  environmentIds: string[];
  setup: FixtureLifecycleDeclaration;
  cleanup?: FixtureLifecycleDeclaration;
  concurrency: FixtureConcurrency;
  resourceLocks: string[];
  createdAt: string;
  updatedAt: string;
}

export type FixtureReferenceIssueKind = 'missing' | 'environmentMismatch';

export interface FixtureReferenceIssue {
  reference: VersionedTestAssetReference;
  kind: FixtureReferenceIssueKind;
  message: string;
}

export interface FixtureResolution {
  fixtures: FixtureAsset[];
  issues: FixtureReferenceIssue[];
}

export type FixtureRunBlockerKind = 'missingFixture' | 'environmentMismatch' | 'scriptTrustRequired' | 'executionUnavailable';

export interface FixtureRunBlocker {
  kind: FixtureRunBlockerKind;
  message: string;
}

export type FixtureScriptLifecycle = 'setup' | 'cleanup';

/**
 * A local approval for one immutable script declaration. It intentionally
 * lives only under studio-data and never becomes project asset content.
 */
export interface FixtureScriptTrustRecord {
  schemaVersion: 1;
  projectId: string;
  projectDirectory: string;
  fixtureId: string;
  fixtureVersion: number;
  lifecycle: FixtureScriptLifecycle;
  relativePath: string;
  contentHash: string;
  approvedAt: string;
}

/** Renderer-safe view of a local script approval. */
export interface FixtureScriptTrustStatus {
  fixtureId: string;
  fixtureVersion: number;
  lifecycle: FixtureScriptLifecycle;
  relativePath: string;
  contentHash: string;
  approvedAt: string;
}

export interface FixtureScriptTrustRequest {
  projectId: string;
  fixtureId: string;
  fixtureVersion: number;
  lifecycle: FixtureScriptLifecycle;
}

export interface FixtureScriptTrustContext {
  projectId?: string;
  projectDirectory?: string;
  records?: FixtureScriptTrustRecord[];
  /** Set only by a main-process runner with a registered script executor. */
  scriptExecutionEnabled?: boolean;
}

export interface TestCaseAssetReferences {
  fixtures: VersionedTestAssetReference[];
  reusableFlows: VersionedTestAssetReference[];
  baseline?: VersionedTestAssetReference;
}

export function createEmptyTestCaseAssetReferences(): TestCaseAssetReferences {
  return {
    fixtures: [],
    reusableFlows: [],
  };
}

/** Resolves exact fixture versions only; references never follow a latest version implicitly. */
export function resolveTestCaseFixtures(
  project: Pick<ProjectDraft, 'fixtures'>,
  references: VersionedTestAssetReference[],
  environmentId?: string,
): FixtureResolution {
  const fixturesByReference = new Map(
    project.fixtures.map((fixture) => [`${fixture.id}@${fixture.version}`, fixture]),
  );
  const fixtures: FixtureAsset[] = [];
  const issues: FixtureReferenceIssue[] = [];
  references.forEach((reference) => {
    const fixture = fixturesByReference.get(`${reference.id}@${reference.version}`);
    if (!fixture) {
      issues.push({
        reference,
        kind: 'missing',
        message: `未找到 fixture ${reference.id}@${reference.version}。`,
      });
      return;
    }
    if (environmentId && fixture.environmentIds.length && !fixture.environmentIds.includes(environmentId)) {
      issues.push({
        reference,
        kind: 'environmentMismatch',
        message: `fixture ${fixture.name}@${fixture.version} 不适用于当前环境。`,
      });
      return;
    }
    fixtures.push(fixture);
  });
  return { fixtures, issues };
}

/**
 * A dependency must resolve to its exact version, match the selected
 * environment, and declare only executable lifecycle requests before a
 * browser session can begin. Script lifecycle execution additionally requires
 * a matching local trust record and a main-process script executor.
 */
export function getTestCaseFixtureRunBlocker(
  project: Pick<ProjectDraft, 'fixtures'>,
  testCase: Pick<TestCaseDraft, 'assetReferences'>,
  environmentId: string,
  scriptTrust: FixtureScriptTrustContext = {},
): FixtureRunBlocker | undefined {
  const resolution = resolveTestCaseFixtures(project, testCase.assetReferences?.fixtures ?? [], environmentId);
  const issue = resolution.issues[0];
  if (issue) {
    return {
      kind: issue.kind === 'missing' ? 'missingFixture' : 'environmentMismatch',
      message: issue.message,
    };
  }
  const untrustedScript = resolution.fixtures
    .flatMap((fixture) => getFixtureScriptLifecycles(fixture).map((lifecycle) => ({ fixture, lifecycle })))
    .find(({ fixture, lifecycle }) => !isFixtureScriptTrusted(fixture, lifecycle, scriptTrust));
  if (untrustedScript) {
    return {
      kind: 'scriptTrustRequired',
      message: `fixture ${untrustedScript.fixture.name}@${untrustedScript.fixture.version} 的 ${untrustedScript.lifecycle === 'setup' ? '准备' : '清理'}脚本需要信任，当前不会执行。`,
    };
  }
  const invalidOutputConfiguration = resolution.fixtures.find((fixture) => !hasValidFixtureHttpOutputConfiguration(fixture));
  if (invalidOutputConfiguration) {
    return {
      kind: 'executionUnavailable',
      message: `fixture ${invalidOutputConfiguration.name}@${invalidOutputConfiguration.version} 的 HTTP 输出映射必须指向已声明的 setup 输出，当前不会执行。`,
    };
  }
  const unsupportedLifecycle = resolution.fixtures
    .flatMap((fixture) => [
      { fixture, lifecycle: 'setup' as const, declaration: fixture.setup },
      ...(fixture.cleanup ? [{ fixture, lifecycle: 'cleanup' as const, declaration: fixture.cleanup }] : []),
    ])
    .find(({ declaration }) => {
      if (declaration.mode === 'http') {
        return !normalizeFixtureHttpDeclaration(declaration.http);
      }
      return declaration.mode === 'script' ? !scriptTrust.scriptExecutionEnabled : true;
    });
  if (unsupportedLifecycle) {
    const { fixture, lifecycle, declaration } = unsupportedLifecycle;
    const lifecycleName = lifecycle === 'setup' ? '准备' : '清理';
    const message = declaration.mode === 'http'
      ? `fixture ${fixture.name}@${fixture.version} 的 ${lifecycleName} HTTP 请求配置不完整，当前不会执行。`
      : declaration.mode === 'script'
        ? `fixture ${fixture.name}@${fixture.version} 的 ${lifecycleName}脚本执行器不可用，当前不会执行。`
        : `fixture ${fixture.name}@${fixture.version} 的 ${lifecycleName}界面操作尚未配置受控执行器，当前不会执行。`;
    return { kind: 'executionUnavailable', message };
  }
  return undefined;
}

/** Returns a normalized safe HTTP declaration, or rejects the whole declaration. */
export function normalizeFixtureHttpDeclaration(value: unknown): FixtureHttpDeclaration | undefined {
  const rawHttp = asRecord(value);
  if (!rawHttp || !isFixtureHttpMethod(rawHttp.method)) {
    return undefined;
  }
  const path = normalizedNonEmptyString(rawHttp.path);
  const expectedStatuses = normalizeFixtureExpectedStatuses(rawHttp.expectedStatuses);
  const responseOutputs = rawHttp.responseOutputs === undefined
    ? undefined
    : normalizeFixtureHttpResponseOutputMappings(rawHttp.responseOutputs);
  if (!path || !isSafeFixtureHttpPath(path) || !expectedStatuses) {
    return undefined;
  }
  const body = rawHttp.body === undefined ? undefined : normalizeFixtureHttpJsonValue(rawHttp.body);
  if (
    (rawHttp.body !== undefined && body === undefined) ||
    (rawHttp.responseOutputs !== undefined && !responseOutputs) ||
    (body !== undefined && JSON.stringify(body).length > 8_192)
  ) {
    return undefined;
  }
  return {
    method: rawHttp.method,
    path,
    expectedStatuses,
    ...(body === undefined ? {} : { body }),
    ...(responseOutputs === undefined ? {} : { responseOutputs }),
  };
}

/**
 * Returns only string outputs that are both mapped by the setup HTTP contract
 * and bound to this exact Case. It is renderer-safe because it contains no
 * resolved response value.
 */
export function getTestCaseFixtureOutputBindingOptions(
  project: Pick<ProjectDraft, 'fixtures'>,
  testCase: Pick<TestCaseDraft, 'assetReferences' | 'environmentId'>,
): Array<{
  fixtureId: string;
  fixtureVersion: number;
  fixtureName: string;
  output: FixtureParameter;
}> {
  return resolveTestCaseFixtures(
    project,
    testCase.assetReferences?.fixtures ?? [],
    testCase.environmentId,
  ).fixtures.flatMap((fixture) => {
    const http = fixture.setup.mode === 'http' ? normalizeFixtureHttpDeclaration(fixture.setup.http) : undefined;
    const mappedNames = fixture.setup.mode === 'script'
      ? new Set(fixture.outputs.map((output) => output.name))
      : new Set(http?.responseOutputs?.map((mapping) => mapping.outputName) ?? []);
    return fixture.outputs
      .filter((output) => output.type === 'string' && mappedNames.has(output.name))
      .map((output) => ({
        fixtureId: fixture.id,
        fixtureVersion: fixture.version,
        fixtureName: fixture.name,
        output,
      }));
  });
}

/** A Fixture may expose HTTP response outputs only from its setup lifecycle. */
export function hasValidFixtureHttpOutputConfiguration(
  fixture: Pick<FixtureAsset, 'setup' | 'cleanup' | 'outputs'>,
): boolean {
  const setupHttp = fixture.setup.mode === 'http' ? normalizeFixtureHttpDeclaration(fixture.setup.http) : undefined;
  const setupMappings = setupHttp?.responseOutputs ?? [];
  if (setupMappings.some((mapping) => !fixture.outputs.some((output) => output.name === mapping.outputName))) {
    return false;
  }
  const cleanupHttp = fixture.cleanup?.mode === 'http' ? normalizeFixtureHttpDeclaration(fixture.cleanup.http) : undefined;
  return !(cleanupHttp?.responseOutputs?.length);
}

export function getFixtureScriptLifecycles(fixture: FixtureAsset): FixtureScriptLifecycle[] {
  return [
    ...(fixture.setup.mode === 'script' ? ['setup' as const] : []),
    ...(fixture.cleanup?.mode === 'script' ? ['cleanup' as const] : []),
  ];
}

export function isFixtureScriptTrusted(
  fixture: FixtureAsset,
  lifecycle: FixtureScriptLifecycle,
  context: FixtureScriptTrustContext = {},
): boolean {
  const declaration = lifecycle === 'setup' ? fixture.setup : fixture.cleanup;
  const script = declaration?.mode === 'script' ? declaration.script : undefined;
  if (!script || !context.projectId || !context.projectDirectory) {
    return false;
  }
  return (context.records ?? []).some((record) => (
    record.schemaVersion === 1 &&
    record.projectId === context.projectId &&
    record.projectDirectory === context.projectDirectory &&
    record.fixtureId === fixture.id &&
    record.fixtureVersion === fixture.version &&
    record.lifecycle === lifecycle &&
    record.relativePath === script.relativePath &&
    record.contentHash === script.contentHash
  ));
}

/** Returns the immutable revision assigned to the next editor save. */
export function nextTestCaseVersion(version: number): number {
  return normalizeTestCaseVersion(version) + 1;
}

export interface PrdPathReference {
  documentId: string;
  pathId: string;
}

/**
 * Stable, non-executable links back to the inputs that produced a Hybrid
 * Case. Source prose stays in its owning PRD, recording, or Agent Run.
 */
export type TestCaseProvenanceReference =
  | { kind: 'agentRun'; runId: string; stepIds: string[] }
  | { kind: 'recording'; recordingId: string; stepIds: string[] }
  | { kind: 'prdPath'; documentId: string; pathId: string }
  | { kind: 'prdDocument'; documentId: string };

/**
 * Non-executable business context for a Hybrid Case. It is deliberately kept
 * apart from editable notes and from the typed steps that may run a browser.
 */
export interface TestCaseIntent {
  schemaVersion: 1;
  businessGoal: string;
  preconditions: string[];
  successCriteria: string[];
}

export interface TestCaseDraft extends Omit<WorkflowDraft, 'kind' | 'steps'> {
  /** Legacy cases are upgraded to this value during hydration. */
  schemaVersion?: 2;
  /** Immutable asset revision. Legacy cases receive version 1 during hydration. */
  version?: number;
  /** Reserved, versioned references for future fixtures, reusable flows, and baselines. */
  assetReferences?: TestCaseAssetReferences;
  kind: TestCaseKind;
  groupId: string;
  environmentId: string;
  source: TestCaseSource;
  sourceIntent?: string;
  /** Structured business intent. Legacy cases may not have this contract yet. */
  intent?: TestCaseIntent;
  /** Canonical V2 source association; `prdPath` remains a legacy projection. */
  provenance?: TestCaseProvenanceReference[];
  prdPath?: PrdPathReference;
  steps: TestStepDraft[];
}

function findMatchingTestCaseVersions(
  project: Pick<ProjectDraft, 'testCases'>,
  reference: VersionedTestAssetReference,
): TestCaseDraft[] {
  return project.testCases.filter((testCase) => (
    testCase.id === reference.id && normalizeTestCaseVersion(testCase.version) === reference.version
  ));
}

/** Finds only the Case revision explicitly requested by the caller. */
export function findTestCaseVersion(
  project: Pick<ProjectDraft, 'testCases'>,
  reference: VersionedTestAssetReference,
): TestCaseDraft | undefined {
  const matches = findMatchingTestCaseVersions(project, reference);
  return matches.length === 1 ? matches[0] : undefined;
}

/** Returns one highest immutable Case revision for every Case ID. */
export function listLatestTestCaseVersions(
  project: Pick<ProjectDraft, 'testCases'>,
): TestCaseDraft[] {
  const latest = new Map<string, TestCaseDraft>();
  const seenVersions = new Set<string>();
  project.testCases.forEach((testCase) => {
    const version = normalizeTestCaseVersion(testCase.version);
    const key = versionedReferenceKey({ id: testCase.id, version });
    if (seenVersions.has(key)) {
      throw new Error(`Duplicate Case version ${key}.`);
    }
    seenVersions.add(key);
    const previous = latest.get(testCase.id);
    if (!previous || normalizeTestCaseVersion(testCase.version) > normalizeTestCaseVersion(previous.version)) {
      latest.set(testCase.id, testCase);
    }
  });
  return [...latest.values()];
}

/** Clones a published Case and assigns its next immutable revision. */
export function createNextTestCaseVersion(
  project: Pick<ProjectDraft, 'testCases'>,
  source: TestCaseDraft,
  patch: Omit<Partial<TestCaseDraft>, 'id' | 'version'>,
): TestCaseDraft {
  const sourceReference = { id: source.id, version: normalizeTestCaseVersion(source.version) };
  const canonicalSource = findTestCaseVersion(project, sourceReference);
  if (!canonicalSource) {
    throw new Error(`Case source ${versionedReferenceKey(sourceReference)} must match exactly one published Case version.`);
  }
  const highestVersion = project.testCases
    .filter((candidate) => candidate.id === canonicalSource.id)
    .reduce((highest, candidate) => Math.max(highest, normalizeTestCaseVersion(candidate.version)), 0);
  return {
    ...structuredClone(canonicalSource),
    ...structuredClone(patch),
    id: canonicalSource.id,
    version: highestVersion + 1,
  };
}

/**
 * Preserves every historical Case revision and appends at most one transformed
 * revision for each logical Case ID, always derived from that ID's latest
 * canonical published version.
 */
export function appendLatestTestCaseTransforms(
  project: Pick<ProjectDraft, 'testCases'>,
  transform: (testCase: TestCaseDraft) => TestCaseDraft | undefined,
): TestCaseDraft[] {
  const appended = listLatestTestCaseVersions(project).flatMap((testCase) => {
    const transformed = transform(testCase);
    if (!transformed) {
      return [];
    }
    const { id: _id, version: _version, ...patch } = transformed;
    return [createNextTestCaseVersion(project, testCase, patch)];
  });
  return [...project.testCases, ...appended];
}

export interface RecordingStepDraft {
  id: string;
  kind: RecordingStepKind;
  title: string;
  detail: string;
  pageUrl?: string;
  screenshotPath?: string;
  capturedAt?: string;
  selector?: string;
  value?: string;
}

export interface VisualDiffMask {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RecordingCapturedEvent {
  id: string;
  kind: RecordingStepKind;
  title: string;
  detail: string;
  pageUrl: string;
  capturedAt: string;
  selector?: string;
  value?: string;
}

export interface RecordingAsset {
  id: string;
  name: string;
  summary: string;
  source: RecordingSource;
  groupId: string;
  environmentId: string;
  startUrl: string;
  comparisonGoal: string;
  visualDiffThreshold?: number;
  visualDiffMasks?: VisualDiffMask[];
  tags: string[];
  prdPath?: PrdPathReference;
  steps: RecordingStepDraft[];
  createdAt: string;
  updatedAt: string;
}

export interface GeneratedTestPath {
  id: string;
  title: string;
  priority: 'P0' | 'P1' | 'P2';
  groupName: string;
  rationale: string;
  sourceExcerpt?: string;
  steps: TestStepDraft[];
}

export interface PrdDocumentAsset {
  id: string;
  name: string;
  kind: PrdDocumentKind;
  size: number;
  uploadedAt: string;
  status: PrdAnalysisStatus;
  sourceText: string;
  summary: string;
  coverageAreas: string[];
  generatedPaths: GeneratedTestPath[];
  analysisMetadata?: PrdAnalysisMetadata;
}

export interface PrdAnalysisMetadata {
  source: PrdAnalysisSource;
  analyzedAt: string;
  modelName?: string;
  fallbackReason?: PrdAnalysisFallbackReason;
}

export interface ProjectGroup {
  id: string;
  name: string;
  description: string;
  createdAt: string;
}

export interface CredentialRef {
  id: string;
  label: string;
  kind: CredentialKind;
  username?: string;
  updatedAt: string;
  hasSecret: boolean;
}

/**
 * Renderer-safe metadata for one locally encrypted Playwright storageState.
 * The serialized cookies, origin storage, and local file path never enter a
 * project asset, StudioState, run report, or renderer response.
 */
export interface StorageStateRef {
  id: string;
  label: string;
  createdAt: string;
  updatedAt: string;
  availability: StorageStateAvailability;
  expiresAt?: string;
}

export interface ProjectEnvironment {
  id: string;
  name: string;
  kind: EnvironmentKind;
  url: string;
  entryPath: string;
  browser: BrowserEngine;
  viewport: ViewportPreset;
  locale: string;
  headless: boolean;
  credentialId?: string;
  /** Logical reference to a local encrypted browser authentication state. */
  storageStateId?: string;
}

export type PrdCoverageTarget = 'case' | 'recording';
export type PrdCoverageTriageDecisionStatus = 'deferred' | 'ignored';
export type PrdCoverageTriageStatus = 'pending' | PrdCoverageTriageDecisionStatus | 'resolved';

export interface PrdCoverageTriageDecision {
  documentId: string;
  pathId: string;
  target: PrdCoverageTarget;
  status: PrdCoverageTriageDecisionStatus;
  note: string;
  updatedAt: string;
}

export interface ProjectDraft {
  id: string;
  name: string;
  description: string;
  defaultUrl: string;
  selectedEnvironmentId: string;
  environments: ProjectEnvironment[];
  groups: ProjectGroup[];
  testCases: TestCaseDraft[];
  recordings: RecordingAsset[];
  documents: PrdDocumentAsset[];
  fixtures: FixtureAsset[];
  suites: SuiteAsset[];
  prdCoverageTriage: PrdCoverageTriageDecision[];
  credentialRefs: CredentialRef[];
  storageStateRefs: StorageStateRef[];
  createdAt: string;
  updatedAt: string;
}

/** Resolves a Suite without executing it, using only its exact Case revisions. */
export function resolveSuiteCases(
  project: Pick<ProjectDraft, 'environments' | 'testCases'>,
  suite: SuiteAsset,
): SuiteCaseResolution {
  const environment = project.environments.find((candidate) => candidate.id === suite.environmentId);
  const issues: SuiteResolutionIssue[] = [];
  if (!suite.caseReferences.length) {
    issues.push({
      kind: 'emptySuite',
      message: `Suite ${suite.name}@${suite.version} 未选择任何用例。`,
    });
  }
  if (!environment) {
    issues.push({
      kind: 'missingEnvironment',
      message: `Suite ${suite.name}@${suite.version} 引用了不存在的环境。`,
    });
  }

  const referenceKeys = new Set<string>();
  const duplicateReference = suite.caseReferences.find((reference) => {
    const key = versionedReferenceKey(reference);
    if (referenceKeys.has(key)) {
      return true;
    }
    referenceKeys.add(key);
    return false;
  });
  if (duplicateReference) {
    issues.push({
      kind: 'duplicateCaseReference',
      reference: duplicateReference,
      message: `Suite ${suite.name}@${suite.version} 重复引用了用例 ${duplicateReference.id}@${duplicateReference.version}。`,
    });
    return { ...(environment ? { environment } : {}), orderedCases: [], issues };
  }

  const referencesByKey = new Map(suite.caseReferences.map((reference) => [versionedReferenceKey(reference), reference]));
  const resolvedByKey = new Map<string, ResolvedSuiteCase>();
  suite.caseReferences.forEach((reference) => {
    const matchingCases = findMatchingTestCaseVersions(project, reference);
    if (matchingCases.length !== 1) {
      issues.push({
        kind: matchingCases.length ? 'duplicateCaseVersion' : 'missingCase',
        reference,
        message: matchingCases.length
          ? `Suite 引用的用例 ${reference.id}@${reference.version} 存在重复版本。`
          : `Suite 未找到用例 ${reference.id}@${reference.version}。`,
      });
      return;
    }
    const testCase = matchingCases[0]!;
    resolvedByKey.set(versionedReferenceKey(reference), { reference, testCase });
  });

  suite.caseReferences.forEach((reference) => {
    reference.dependsOn.forEach((dependency) => {
      if (!referencesByKey.has(versionedReferenceKey(dependency))) {
        issues.push({
          kind: 'missingDependency',
          reference,
          message: `Suite 用例 ${reference.id}@${reference.version} 的前置依赖不存在。`,
        });
      }
    });
  });

  if (issues.length) {
    return { ...(environment ? { environment } : {}), orderedCases: [], issues };
  }

  const remainingDependencies = new Map(
    suite.caseReferences.map((reference) => [
      versionedReferenceKey(reference),
      new Set(reference.dependsOn.map(versionedReferenceKey)),
    ]),
  );
  const orderedCases: ResolvedSuiteCase[] = [];
  const complete = new Set<string>();
  while (orderedCases.length < suite.caseReferences.length) {
    const nextReference = suite.caseReferences.find((reference) => {
      const key = versionedReferenceKey(reference);
      return !complete.has(key) && (remainingDependencies.get(key)?.size ?? 0) === 0;
    });
    if (!nextReference) {
      issues.push({
        kind: 'cyclicDependency',
        message: `Suite ${suite.name}@${suite.version} 存在循环依赖，当前不会执行。`,
      });
      return { ...(environment ? { environment } : {}), orderedCases: [], issues };
    }
    const nextKey = versionedReferenceKey(nextReference);
    const resolved = resolvedByKey.get(nextKey);
    if (!resolved) {
      issues.push({
        kind: 'missingCase',
        reference: nextReference,
        message: `Suite 未找到用例 ${nextReference.id}@${nextReference.version}。`,
      });
      return { ...(environment ? { environment } : {}), orderedCases: [], issues };
    }
    complete.add(nextKey);
    orderedCases.push(resolved);
    remainingDependencies.forEach((dependencies) => dependencies.delete(nextKey));
  }
  return { ...(environment ? { environment } : {}), orderedCases, issues };
}

/** @deprecated Use resolveSuiteCases; this compatibility wrapper has identical exact-version behavior. */
export function resolveSuiteTestCases(
  project: Pick<ProjectDraft, 'environments' | 'testCases'>,
  suite: SuiteAsset,
): SuiteCaseResolution {
  return resolveSuiteCases(project, suite);
}

/** A review-only request to materialize project assets in a user-selected directory. */
export interface ProjectAssetMigrationRequest {
  projectId: string;
  projectDirectory: string;
  /** Current editor state, used only for the reviewed snapshot request. */
  project?: ProjectDraft;
  /** Revision returned by the reviewed migration plan. */
  plannedRevision?: string;
}

export interface ProjectAssetMigrationPlan {
  projectId: string;
  projectDirectory: string;
  snapshotRevision: string;
  files: string[];
  status: 'ready' | 'requiresReview' | 'blocked' | 'alreadyMigrated';
  conflicts: string[];
  /** A deterministic guard over the legacy directory reviewed by the user. */
  sourceRevision?: string;
  /** Stable identifier for one reviewed legacy Case conversion. */
  migrationId?: string;
  targetSchemaVersion?: 2;
  /** Safe relative path recorded in a migrated v2 manifest. */
  backupDirectory?: string;
  issues?: ProjectAssetDiagnostic[];
}

/** A studio-data pointer to an explicitly reviewed project asset snapshot. */
export interface ProjectAssetBinding {
  projectId: string;
  projectDirectory: string;
  revision: string;
  boundAt: string;
}

export type ProjectAssetBindingState = 'inSync' | 'localChanges' | 'externalChanges' | 'unavailable';

export interface ProjectAssetDiagnostic {
  path: string;
  message: string;
}

export interface ProjectAssetBindingStatus {
  projectId: string;
  projectDirectory: string;
  state: ProjectAssetBindingState;
  issues: ProjectAssetDiagnostic[];
}

/** A request to preview or apply a reload from an already bound asset directory. */
export interface ProjectAssetReloadRequest {
  projectId: string;
  project: ProjectDraft;
  snapshotRevision?: string;
}

export interface ProjectAssetReloadPlan {
  projectId: string;
  projectDirectory: string;
  snapshotRevision?: string;
  status: 'ready' | 'requiresReview' | 'unavailable';
  issues: ProjectAssetDiagnostic[];
}

export interface ProjectAssetReloadResult {
  project: ProjectDraft;
  binding: ProjectAssetBinding;
}

/** A reviewed request to publish local project edits to an existing binding. */
export interface ProjectAssetUpdateRequest {
  projectId: string;
  /** Current editor state. It is compared to persisted studio-data before publish. */
  project: ProjectDraft;
  /** The binding revision observed when the plan was generated. */
  expectedRevision?: string;
  /** The target asset revision returned by the reviewed update plan. */
  plannedRevision?: string;
}

/**
 * A read-only compare-and-swap publish plan for an already bound project
 * directory. `publishedRevision` describes the current external snapshot;
 * `snapshotRevision` is the sanitized local snapshot that may be published.
 */
export interface ProjectAssetUpdatePlan {
  projectId: string;
  projectDirectory: string;
  publishedRevision?: string;
  snapshotRevision?: string;
  files: string[];
  status: 'ready' | 'requiresReview' | 'unavailable';
  issues: ProjectAssetDiagnostic[];
}

export interface RunArtifact {
  id: string;
  type: 'screenshot' | 'trace' | 'report' | 'snapshot' | 'attachment';
  label: string;
  path: string;
}

export interface RunStepLog {
  id: string;
  stepId: string;
  title: string;
  status: RunStatus;
  message: string;
  screenshotPath?: string;
}

/** Safe, value-free evidence for one Fixture lifecycle. */
export interface FixtureLifecycleEvidence {
  fixtureId: string;
  fixtureVersion: number;
  lifecycle: FixtureScriptLifecycle;
  /** Absent in legacy HTTP evidence written before lifecycle modes were added. */
  mode?: 'http' | 'script';
  method?: FixtureHttpMethod;
  path?: string;
  expectedStatuses?: number[];
  /** Relative path only; stdout, stderr, context, and output values are never recorded. */
  scriptPath?: string;
  outcome: 'passed' | 'failed' | 'neutral';
  httpStatus?: number;
  durationMs: number;
}

export interface ManualStepEvidence {
  stepId: string;
  status: 'passed' | 'failed';
  note: string;
  confirmedAt: string;
  screenshotPath?: string;
  attachments?: RunArtifact[];
}

export interface RunDetail {
  id: string;
  projectId: string;
  testCaseId: string;
  /** Exact Case revision for Suite member history; absent on legacy records. */
  testCaseVersion?: number;
  documentId?: string;
  environmentId: string;
  title: string;
  status: RunStatus;
  startedAt: string;
  endedAt?: string;
  duration: string;
  summary: string;
  reason?: RunReason;
  provenance?: RunProvenance;
  logs: string[];
  steps: RunStepLog[];
  artifacts: RunArtifact[];
  fixtureLifecycles?: FixtureLifecycleEvidence[];
  agentRun?: AgentRunResult;
  agentRuns?: AgentRunResult[];
  manualEvidence?: ManualStepEvidence[];
  failureReason?: string;
  cancellation?: RunCancellation;
}

/** A Suite scheduling result plus the Case-level evidence it produced. */
export interface SuiteRunDetail {
  suite: SuiteRunResult;
  caseDetails: RunDetail[];
}

export interface RunCancellation {
  source: 'user';
  reason: 'userCancelled';
  message: string;
  cancelledAt: string;
}

export type RunFailureStatus = Extract<RunStatus, 'failed' | 'error'>;
export type RunNonExecutedStatus = Extract<RunStatus, 'blocked' | 'skipped' | 'cancelled'>;
export type RunProblemStatus = RunFailureStatus | RunNonExecutedStatus;
export type RunCoverageRiskStatus = 'neverExecuted' | RunProblemStatus;

export interface RunCoverageRisk {
  testCaseId: string;
  groupId: string;
  environmentId: string;
  status: RunCoverageRiskStatus;
  latestRun?: RunSummary;
}

export interface RunCoverageRiskSummary {
  total: number;
  verified: number;
  risks: RunCoverageRisk[];
}

export type ProjectReportLocale = 'zh-CN' | 'en-US';

export interface ProjectRunReportProblemRun {
  id: string;
  testCaseName: string;
  environmentName: string;
  status: RunFailureStatus;
  startedAt?: string;
  duration: string;
  summary: string;
  failureReason?: string;
  artifactLabels: string[];
}

export interface ProjectRunReportNonExecutedRun {
  id: string;
  testCaseName: string;
  environmentName: string;
  status: RunNonExecutedStatus;
  startedAt?: string;
  duration: string;
  summary: string;
  reason?: RunReason;
  artifactLabels: string[];
}

export interface ProjectRunReportCoverageRisk {
  testCaseName: string;
  groupName: string;
  environmentName: string;
  status: RunCoverageRiskStatus;
  latestStatus?: RunProblemStatus;
}

export interface ProjectRunReport {
  generatedAt: string;
  projectName: string;
  runStats: Record<RunStatus, number>;
  coverageRisk: {
    total: number;
    verified: number;
    risks: ProjectRunReportCoverageRisk[];
  };
  prdCoverage: {
    paths: number;
    targets: Record<PrdCoverageTarget, Record<PrdCoverageTriageStatus, number>>;
  };
  problemRuns: ProjectRunReportProblemRun[];
  nonExecutedRuns: ProjectRunReportNonExecutedRun[];
}

export interface BrowserSessionState {
  id: string;
  status: BrowserSessionStatus;
  projectId?: string;
  environmentId?: string;
  currentUrl: string;
  pageTitle: string;
  screenshotPath?: string;
  message: string;
  updatedAt: string;
}

export interface ChatEntry {
  id: string;
  role: ChatRole;
  text: string;
}

export interface RuntimeProfile {
  browser: BrowserEngine;
  baseUrl: string;
  viewport: ViewportPreset;
  locale: string;
  headless: boolean;
}

/** Public metadata for a model key held exclusively by the main process. */
export interface ModelSecretRef {
  id: string;
  hasKey: boolean;
  updatedAt: string;
}

export interface MidsceneConfig {
  modelBaseUrl: string;
  modelSecret: ModelSecretRef;
  modelName: string;
  modelFamily: string;
  preferredLanguage: string;
  replanningCycleLimit: string;
  openaiHttpProxy: string;
  defaultContext: string;
}

export type MidsceneConnectionFailure = 'configuration' | 'http' | 'network' | 'response';

export interface MidsceneConnectionTestResult {
  status: 'passed' | 'failed';
  modelName: string;
  durationMs: number;
  httpStatus?: number;
  failure?: MidsceneConnectionFailure;
}

export interface AgentRoleModelConfig {
  provider: AgentModelProvider;
  modelBaseUrl: string;
  modelSecret: ModelSecretRef;
  modelName: string;
  modelFamily: string;
  temperature: string;
  enabled: boolean;
}

export type AgentModelConfig = Record<AgentModelRole, AgentRoleModelConfig>;

export interface AppearanceConfig {
  themeMode: ThemeMode;
  localeMode: LocaleMode;
}

export interface StartupGuideState {
  completed: boolean;
  completedAt?: string;
  mode?: 'configured' | 'skipped';
}

export interface StudioState {
  selectedProjectId: string;
  selectedGroupId: string;
  /** Exact immutable Case revision selected by current UI state. */
  selectedTestCaseReference?: VersionedTestAssetReference;
  /** Legacy selection input accepted only while hydrating old persisted state. */
  selectedTestCaseId?: string;
  selectedRecordingId: string;
  projects: ProjectDraft[];
  projectAssetBindings: ProjectAssetBinding[];
  runDetails: RunDetail[];
  suiteRunRecords: SuiteRunRecord[];
  recentRuns: RunSummary[];
  chatEntries: ChatEntry[];
  runtimeProfile: RuntimeProfile;
  midsceneConfig: MidsceneConfig;
  agentModelConfig: AgentModelConfig;
  appearance: AppearanceConfig;
  startupGuide: StartupGuideState;
  browserSession: BrowserSessionState;
  selectedWorkflowId?: string;
  workflows?: WorkflowDraft[];
}

export interface RuntimeInfo {
  platform: 'desktop' | 'browser';
  persistence: 'file' | 'localStorage';
  storagePath?: string;
}

export interface ChatCommandRequest {
  /** Internal-only signal used by workflow execution. It is never sent through renderer IPC. */
  cancellationSignal?: AbortSignal;
  mode: CommandMode;
  prompt: string;
  targetEnvironment: string;
  deepThink: boolean;
  deepLocate: boolean;
  runtimeProfile: RuntimeProfile;
  midsceneConfig?: MidsceneConfig;
  agentModelConfig?: AgentModelConfig;
  browserSession?: BrowserSessionState;
  project?: ProjectDraft;
  environment?: ProjectEnvironment;
  projectId?: string;
  groupId?: string;
  environmentId?: string;
  testCaseId?: string;
  documentId?: string;
}

export interface ChatCommandResponse {
  userEntry: ChatEntry;
  assistantEntry: ChatEntry;
  agentRun: AgentRunResult;
}

export interface RunWorkflowRequest {
  /** Generated by the desktop runtime so an active run can be cancelled safely. */
  runId?: string;
  /** Internal-only signal. It is never sent across IPC from the renderer. */
  cancellationSignal?: AbortSignal;
  workflow: WorkflowDraft;
  targetEnvironment: string;
  runtimeProfile: RuntimeProfile;
  parentRunId?: string;
  preserveCurrentPage?: boolean;
  project?: ProjectDraft;
  environment?: ProjectEnvironment;
  documentId?: string;
  midsceneConfig?: MidsceneConfig;
  agentModelConfig?: AgentModelConfig;
  browserSession?: BrowserSessionState;
}

/** Renderer-safe intent for running one exact immutable Case revision. */
export interface RunTestCaseIntent {
  runId?: string;
  projectId: string;
  testCase: VersionedTestAssetReference;
  expectedProjectRevision?: string;
}

/** Renderer-safe intent for running one exact immutable Suite revision. */
export interface RunSuiteIntent {
  runId?: string;
  projectId: string;
  suite: VersionedTestAssetReference;
  expectedProjectRevision?: string;
}

/** Explicit main-to-renderer transport for exact run-intent errors that Electron cannot serialize as Error properties. */
export interface RunIntentIpcErrorResponse {
  type: 'testBuddy.runtimeError';
  code: 'staleProjectRevision' | 'projectRevisionChanged' | 'missingAssetVersion';
  message: string;
}

/** Renderer-safe explanation of a historical asset that can no longer be resolved exactly. */
export interface HistoricalRerunMissingReference {
  id: string;
  version?: number;
}

/** Renderer-safe result of resolving a persisted run. It never transfers executable assets. */
export type HistoricalRerunPlan =
  | {
    status: 'ready';
    runId: string;
  }
  | {
    status: 'blocked';
    runId: string;
    reason: RunReason;
    missingReferences: HistoricalRerunMissingReference[];
  };

/** Main-owned exact rerun result. The renderer can only request it by historical run ID. */
export type HistoricalRerunExecutionResult =
  | {
    status: 'completed';
    response: RunTestCaseResponse;
  }
  | Extract<HistoricalRerunPlan, { status: 'blocked' }>;

export interface RunTestCaseRequest {
  /** Generated by the desktop runtime so an active run can be cancelled safely. */
  runId?: string;
  /** Observed bound Project snapshot revision. Omitted by legacy browser runs. */
  expectedProjectRevision?: string;
  /** Internal-only signal. It is never sent across IPC from the renderer. */
  cancellationSignal?: AbortSignal;
  /** Main-process-only local approvals. Renderer requests cannot supply these values. */
  fixtureScriptTrustRecords?: FixtureScriptTrustRecord[];
  /** Main-process-only identity of the bound asset directory. */
  fixtureScriptTrustDirectory?: string;
  project: ProjectDraft;
  testCase: TestCaseDraft;
  environment: ProjectEnvironment;
  runtimeProfile?: RuntimeProfile;
  midsceneConfig?: MidsceneConfig;
  agentModelConfig?: AgentModelConfig;
  browserSession?: BrowserSessionState;
}

export interface RunSuiteRequest {
  /** Generated by the desktop runtime so the Suite and current Case can be cancelled together. */
  runId?: string;
  /** Observed bound Project snapshot revision. Omitted by legacy browser runs. */
  expectedProjectRevision?: string;
  /** Internal-only signal. It is never sent across IPC from the renderer. */
  cancellationSignal?: AbortSignal;
  /** Main-process-only local approvals. Renderer requests cannot supply these values. */
  fixtureScriptTrustRecords?: FixtureScriptTrustRecord[];
  /** Main-process-only identity of the bound asset directory. */
  fixtureScriptTrustDirectory?: string;
  project: ProjectDraft;
  suite: VersionedTestAssetReference;
  runtimeProfile?: RuntimeProfile;
  midsceneConfig?: MidsceneConfig;
  agentModelConfig?: AgentModelConfig;
  browserSession?: BrowserSessionState;
}

export interface RunRecordingRequest {
  /** Generated by the desktop runtime so an active run can be cancelled safely. */
  runId?: string;
  /** Internal-only signal. It is never sent across IPC from the renderer. */
  cancellationSignal?: AbortSignal;
  project: ProjectDraft;
  recording: RecordingAsset;
  environment: ProjectEnvironment;
  testCaseId?: string;
  documentId?: string;
  parentRunId?: string;
}

export interface RunWorkflowResponse {
  runId: string;
  title: string;
  detail: RunDetail;
  agentRun: AgentRunResult;
}

export interface PrdSemanticAnalysisRequest {
  document: PrdDocumentAsset;
  midsceneConfig: MidsceneConfig;
  agentModelConfig: AgentModelConfig;
}

export interface PrdSemanticAnalysisResponse {
  document: PrdDocumentAsset;
  source: PrdAnalysisSource;
  modelName?: string;
  fallbackReason?: PrdAnalysisFallbackReason;
}

export interface RunTestCaseResponse {
  runId: string;
  title: string;
  detail: RunDetail;
}

export interface RunSuiteResponse {
  runId: string;
  title: string;
  detail: SuiteRunDetail;
}

export interface RunRecordingResponse {
  runId: string;
  title: string;
  detail: RunDetail;
  agentRun: AgentRunResult;
}

export interface SessionStartRequest {
  targetEnvironment: string;
  runtimeProfile: RuntimeProfile;
}

export interface BrowserSessionRequest {
  project: ProjectDraft;
  environment: ProjectEnvironment;
  record?: boolean;
}

export interface ProjectReportExportRequest {
  projectId: string;
  locale: ProjectReportLocale;
}

export interface BrowserNavigateRequest {
  url: string;
}

export interface BrowserClickRequest {
  selector: string;
}

export interface BrowserInputRequest {
  selector: string;
  value: string;
}

export interface BrowserWaitRequest {
  timeoutMs?: number;
}

export interface BrowserWaitForSelectorRequest {
  selector: string;
  timeoutMs?: number;
}

export interface BrowserWaitForResponseRequest {
  urlPattern: string;
  timeoutMs?: number;
}

export interface BrowserWaitForChartStableRequest {
  selector?: string;
  timeoutMs?: number;
  stableMs?: number;
}

export interface BrowserWaitForDataReadyRequest {
  selector?: string;
  timeoutMs?: number;
  stableMs?: number;
}

export interface BrowserWaitForNetworkIdleRequest {
  timeoutMs?: number;
}

export interface BrowserScrollRequest {
  selector?: string;
  x?: number;
  y?: number;
}

export interface BrowserSelectRequest {
  selector: string;
  value: string;
}

export interface SaveCredentialRequest {
  projectId: string;
  label: string;
  kind: CredentialKind;
  username?: string;
  secret: string;
}

/**
 * The main process opens and reads the selected file itself. Its serialized
 * authentication state must never be transferred through the renderer IPC.
 */
export interface ImportStorageStateRequest {
  projectId: string;
  label: string;
}

/** Captures the state from the current real BrowserSession in the main process. */
export interface CaptureStorageStateRequest {
  projectId: string;
  label: string;
  /** Replaces an existing local state while preserving its logical ID. */
  storageStateId?: string;
}

export interface RevokeStorageStateRequest {
  projectId: string;
  storageStateId: string;
}

export interface RunEventPayload {
  runId: string;
  title: string;
  type: 'status' | 'log' | 'complete';
  status?: RunTone;
  line?: string;
  summary?: string;
  duration?: string;
  detail?: RunDetail;
}

export interface DesktopApi {
  loadStudioState: () => Promise<StudioState | null>;
  saveStudioState: (state: StudioState) => Promise<void>;
  getRuntimeInfo: () => Promise<RuntimeInfo>;
  testMidsceneConnection: (config: MidsceneConfig) => Promise<MidsceneConnectionTestResult>;
  createProject: (project: ProjectDraft) => Promise<ProjectDraft>;
  updateProject: (project: ProjectDraft) => Promise<ProjectDraft>;
  analyzePrdDocument: (request: PrdSemanticAnalysisRequest) => Promise<PrdSemanticAnalysisResponse>;
  saveCredential: (request: SaveCredentialRequest) => Promise<CredentialRef>;
  importStorageState: (request: ImportStorageStateRequest) => Promise<StorageStateRef | null>;
  captureStorageState: (request: CaptureStorageStateRequest) => Promise<StorageStateRef>;
  revokeStorageState: (request: RevokeStorageStateRequest) => Promise<void>;
  selectProjectAssetDirectory: () => Promise<string | null>;
  planProjectAssetMigration: (request: ProjectAssetMigrationRequest) => Promise<ProjectAssetMigrationPlan>;
  writeProjectAssetSnapshot: (request: ProjectAssetMigrationRequest) => Promise<ProjectAssetBinding>;
  inspectProjectAssetBinding: (projectId: string) => Promise<ProjectAssetBindingStatus | null>;
  planProjectAssetReload: (request: ProjectAssetReloadRequest) => Promise<ProjectAssetReloadPlan>;
  reloadProjectAssetSnapshot: (request: ProjectAssetReloadRequest) => Promise<ProjectAssetReloadResult>;
  planProjectAssetUpdate: (request: ProjectAssetUpdateRequest) => Promise<ProjectAssetUpdatePlan>;
  updateProjectAssetSnapshot: (request: ProjectAssetUpdateRequest) => Promise<ProjectAssetBinding>;
  listFixtureScriptTrusts: (projectId: string) => Promise<FixtureScriptTrustStatus[]>;
  approveFixtureScriptTrust: (request: FixtureScriptTrustRequest) => Promise<FixtureScriptTrustStatus>;
  startBrowserSession: (request: BrowserSessionRequest) => Promise<BrowserSessionState>;
  navigateBrowserSession: (request: BrowserNavigateRequest) => Promise<BrowserSessionState>;
  captureBrowserSnapshot: () => Promise<BrowserSessionState>;
  runTestCase: (request: RunTestCaseIntent) => Promise<RunTestCaseResponse>;
  runSuite: (request: RunSuiteIntent) => Promise<RunSuiteResponse>;
  runRecording: (request: RunRecordingRequest) => Promise<RunRecordingResponse>;
  cancelRun: (runId: string) => Promise<boolean>;
  exportProjectReport: (request: ProjectReportExportRequest) => Promise<boolean>;
  loadRunDetail: (runId: string) => Promise<RunDetail | null>;
  planHistoricalRerun: (runId: string) => Promise<HistoricalRerunPlan>;
  runHistoricalRerun: (runId: string) => Promise<HistoricalRerunExecutionResult>;
  openArtifact: (artifactPath: string) => Promise<void>;
  exportArtifact: (artifactPath: string) => Promise<boolean>;
  attachManualEvidence: () => Promise<RunArtifact | null>;
  startSession: (request: SessionStartRequest) => Promise<ChatEntry>;
  endSession: () => Promise<ChatEntry>;
  sendChatCommand: (request: ChatCommandRequest) => Promise<ChatCommandResponse>;
  runWorkflow: (request: RunWorkflowRequest) => Promise<RunWorkflowResponse>;
  onRunEvent: (listener: (event: RunEventPayload) => void) => () => void;
  onRecordingEvent: (listener: (event: RecordingCapturedEvent) => void) => () => void;
}

export const defaultRuntimeProfile: RuntimeProfile = {
  browser: 'chromium',
  baseUrl: '',
  viewport: 'desktop',
  locale: 'zh-CN',
  headless: true,
};

export const defaultMidsceneConfig: MidsceneConfig = {
  modelBaseUrl: '',
  modelSecret: createEmptyModelSecretRef('midscene'),
  modelName: '',
  modelFamily: '',
  preferredLanguage: 'Chinese',
  replanningCycleLimit: '10',
  openaiHttpProxy: '',
  defaultContext: '',
};

const defaultAgentRoleModelConfig = (role: AgentModelRole): AgentRoleModelConfig => ({
  provider: 'reuseMidscene',
  modelBaseUrl: '',
  modelSecret: createEmptyModelSecretRef(`agent:${role}`),
  modelName: '',
  modelFamily: '',
  temperature: '0.2',
  enabled: true,
});

export const defaultAgentModelConfig: AgentModelConfig = {
  planner: defaultAgentRoleModelConfig('planner'),
  executor: defaultAgentRoleModelConfig('executor'),
  verifier: defaultAgentRoleModelConfig('verifier'),
  reporter: defaultAgentRoleModelConfig('reporter'),
};

export const defaultAppearanceConfig: AppearanceConfig = {
  themeMode: 'light',
  localeMode: 'zh-CN',
};

const agentModelRoleOrder: AgentModelRole[] = ['planner', 'executor', 'verifier', 'reporter'];

export function resolveAgentModelAssignments({
  agentModelConfig = defaultAgentModelConfig,
  midsceneConfig,
}: {
  agentModelConfig?: AgentModelConfig;
  midsceneConfig: MidsceneConfig;
}): AgentModelAssignment[] {
  return agentModelRoleOrder.map((role) => {
    const roleConfig = {
      ...defaultAgentModelConfig[role],
      ...(agentModelConfig[role] ?? {}),
    };

    if (roleConfig.provider === 'openaiCompatible') {
      return {
        role,
        provider: roleConfig.provider,
        source: 'agentRole',
        enabled: roleConfig.enabled,
        modelBaseUrl: roleConfig.modelBaseUrl,
        modelName: roleConfig.modelName,
        modelFamily: roleConfig.modelFamily,
        temperature: roleConfig.temperature,
        hasApiKey: roleConfig.modelSecret.hasKey,
      };
    }

    return {
      role,
      provider: roleConfig.provider,
      source: 'midscene',
      enabled: roleConfig.enabled,
      modelBaseUrl: midsceneConfig.modelBaseUrl,
      modelName: midsceneConfig.modelName,
      modelFamily: midsceneConfig.modelFamily,
      hasApiKey: midsceneConfig.modelSecret.hasKey,
    };
  });
}

export const defaultBrowserSession: BrowserSessionState = {
  id: 'session-idle',
  status: 'idle',
  currentUrl: '',
  pageTitle: '尚未启动浏览器',
  message: '选择项目环境后启动受控浏览器会话。',
  updatedAt: new Date(0).toISOString(),
};

export const initialRecentRuns: RunSummary[] = [
  {
    id: 'run-2401',
    name: 'Checkout smoke',
    status: 'running',
    duration: '00:03:17',
    summary: '执行到支付方式选择步骤，正在等待结算区域稳定。',
    projectId: 'project-demo',
    testCaseId: 'wf-001',
    environmentId: 'env-staging',
    environmentName: 'Staging',
  },
  {
    id: 'run-2398',
    name: 'Search regression',
    status: 'passed',
    duration: '00:01:42',
    summary: '搜索、筛选和结果断言全部通过。',
    projectId: 'project-demo',
    testCaseId: 'wf-002',
    environmentId: 'env-staging',
    environmentName: 'Staging',
  },
  {
    id: 'run-2397',
    name: 'Login happy path',
    status: 'failed',
    duration: '00:00:51',
    summary: '验证码遮罩导致登录按钮定位失败。',
    projectId: 'project-demo',
    testCaseId: 'wf-003',
    environmentId: 'env-staging',
    environmentName: 'Staging',
  },
];

export const initialWorkflows: WorkflowDraft[] = [
  {
    id: 'wf-001',
    kind: 'scenario',
    name: '购物车到支付',
    category: '核心链路',
    lastEdited: '2 小时前',
    url: 'https://demo-shop.local/checkout',
    notes: '用于验证从商品详情页到结算页的关键路径。',
    steps: [
      {
        id: 'step-001',
        type: 'ai',
        title: '搜索商品',
        body: '在搜索框输入 {{keyword}} 并提交，等待结果列表稳定。',
      },
      {
        id: 'step-002',
        type: 'aiAssert',
        title: '断言结果列表',
        body: '页面展示了与 {{keyword}} 相关的搜索结果。',
      },
      {
        id: 'step-003',
        type: 'aiQuery',
        title: '提取首个标题',
        body: '读取第一页第一个商品卡片标题，并保存到 firstCardTitle。',
      },
    ],
  },
  {
    id: 'wf-002',
    kind: 'assertion',
    name: '搜索页关键断言',
    category: '断言验证',
    lastEdited: '昨天',
    url: 'https://demo-shop.local/search',
    notes: '专门用于验证搜索页的排序、筛选和关键状态文案。',
    steps: [
      {
        id: 'step-004',
        type: 'aiAssert',
        title: '断言默认排序',
        body: '页面初始状态下，排序控件显示“综合排序”。',
      },
      {
        id: 'step-005',
        type: 'aiAssert',
        title: '断言结果数量',
        body: '结果区域展示了总数，并且首屏至少出现 1 个商品卡片。',
      },
    ],
  },
  {
    id: 'wf-003',
    kind: 'extraction',
    name: '商品卡片信息提取',
    category: '数据提取',
    lastEdited: '3 天前',
    url: 'https://demo-shop.local/search',
    notes: '从搜索结果页提取关键字段，供后续断言或回填流程使用。',
    steps: [
      {
        id: 'step-006',
        type: 'aiQuery',
        title: '提取首个商品标题',
        body: '读取第一页第一个商品卡片标题，并保存到 firstCardTitle。',
      },
      {
        id: 'step-007',
        type: 'aiQuery',
        title: '提取价格与库存',
        body: '提取首个商品的价格与库存文案，保存到 firstCardPrice 和 firstCardStock。',
      },
    ],
  },
];

export const initialChatTimeline: ChatEntry[] = [
  {
    id: 'chat-001',
    role: 'system',
    text: `浏览器会话已准备完成，当前目标页面为 ${defaultRuntimeProfile.baseUrl}。`,
  },
  {
    id: 'chat-002',
    role: 'user',
    text: '搜索 “wireless keyboard”，筛选价格低于 300，并打开第一个商品详情页。',
  },
  {
    id: 'chat-003',
    role: 'assistant',
    text: '已完成搜索、筛选和跳转。当前页面位于商品详情，库存提示为“有货”。',
  },
];

export const initialRunLog: string[] = [];

const builtInMockProjectId = 'project-demo';
const builtInMockChatEntryIds = new Set(['chat-001', 'chat-002', 'chat-003']);

export function workflowToTestCase(
  workflow: WorkflowDraft,
  groupId = 'group-core',
  environmentId = 'env-staging',
): TestCaseDraft {
  const businessGoal = workflow.name.trim() || '未命名测试用例';
  return {
    ...workflow,
    schemaVersion: 2,
    version: 1,
    assetReferences: createEmptyTestCaseAssetReferences(),
    groupId,
    environmentId,
    source: 'manual',
    intent: createTestCaseIntent(businessGoal),
    provenance: [],
    steps: workflow.steps.map((step) => ({ ...step })),
  };
}

export function testCaseToWorkflow(testCase: TestCaseDraft): WorkflowDraft {
  return {
    id: testCase.id,
    kind: testCase.kind === 'recording' ? 'scenario' : testCase.kind,
    name: testCase.name,
    category: testCase.category,
    lastEdited: testCase.lastEdited,
    url: testCase.url,
    notes: testCase.notes,
    steps: testCase.steps
      .filter((step): step is TestStepDraft & { type: StepType } =>
        step.type === 'ai' || step.type === 'aiAssert' || step.type === 'aiQuery',
      )
      .map((step) => ({
        id: step.id,
        type: step.type,
        title: step.title,
        body: step.body,
      })),
  };
}

export function getConfirmedDeterministicTestStep(step: TestStepDraft): AgentPlanStepDraft | undefined {
  if (step.type !== 'ai' || step.execution?.reviewStatus !== 'confirmed') {
    return undefined;
  }

  const action = step.execution.action;
  if (!action || typeof action !== 'object') {
    return undefined;
  }
  const title = step.title;
  const instruction = step.body;
  const locator = 'locator' in action ? action.locator : undefined;
  const selector = locator?.selector;
  const hasSelector = hasExecutableTestLocator(locator);
  const hasValidOptionalTimeout =
    !('timeoutMs' in action) || action.timeoutMs === undefined || (Number.isFinite(action.timeoutMs) && action.timeoutMs > 0);

  if (action.kind === 'navigate' && typeof action.url === 'string' && action.url.trim()) {
    return { action: 'navigate', title, instruction, url: action.url };
  }
  if (action.kind === 'click' && hasSelector) {
    return { action: 'click', title, instruction, selector };
  }
  if ((action.kind === 'input' || action.kind === 'select') && hasSelector && isTestInputValueBinding(action.binding)) {
    return { action: action.kind, title, instruction, selector };
  }
  if (action.kind === 'waitForSelector' && hasSelector && hasValidOptionalTimeout) {
    return {
      action: 'wait',
      title,
      instruction,
      selector,
      ...(action.timeoutMs === undefined ? {} : { timeoutMs: action.timeoutMs }),
    };
  }
  if (action.kind === 'waitForTimeout' && Number.isFinite(action.timeoutMs) && action.timeoutMs > 0) {
    return { action: 'wait', title, instruction, timeoutMs: action.timeoutMs };
  }
  if (action.kind === 'scrollTo' && hasSelector) {
    return { action: 'scroll', title, instruction, selector };
  }
  return undefined;
}

export function isConfirmedDeterministicTestStep(step: TestStepDraft): boolean {
  return getConfirmedDeterministicTestStep(step) !== undefined;
}

/** Returns only the reference; the resolved credential value stays in the main process. */
export function getConfirmedDeterministicTestInputBinding(
  step: TestStepDraft,
): TestInputValueBinding | undefined {
  const action = step.execution?.action;
  return step.execution?.reviewStatus === 'confirmed' &&
    (action?.kind === 'input' || action?.kind === 'select') &&
    isTestInputValueBinding(action.binding)
    ? action.binding
    : undefined;
}

export function getConfirmedExplicitTestAssertion(step: TestStepDraft): ExplicitTestAssertion | undefined {
  if (step.type !== 'aiAssert' || step.execution?.reviewStatus !== 'confirmed') {
    return undefined;
  }

  const assertion = step.execution.assertion;
  if (
    !assertion ||
    typeof assertion !== 'object' ||
    assertion.version !== 1 ||
    typeof assertion.id !== 'string' ||
    !assertion.id.trim()
  ) {
    return undefined;
  }

  if (
    (assertion.kind === 'urlContains' || assertion.kind === 'titleContains' || assertion.kind === 'pageContains') &&
    typeof assertion.expected === 'string' &&
    assertion.expected.trim()
  ) {
    return assertion;
  }

  if (
    assertion.kind === 'locatorVisible' &&
    hasExecutableTestLocator(assertion.locator)
  ) {
    return assertion;
  }
  if (
    assertion.kind === 'locatorTextContains' &&
    hasExecutableTestLocator(assertion.locator) &&
    typeof assertion.expected === 'string' &&
    assertion.expected.trim()
  ) {
    return assertion;
  }

  return undefined;
}

export function isAgentRunnableTestCase(testCase: TestCaseDraft): boolean {
  return (
    testCase.steps.length > 0 &&
    testCase.steps.every(
        (step) =>
        (step.type === 'ai' || step.type === 'aiAssert' || step.type === 'aiQuery') &&
        !((step.type === 'ai' || step.type === 'aiAssert') && step.execution?.reviewStatus === 'confirmed'),
    )
  );
}

export function getExclusiveRecordingReplayId(testCase: TestCaseDraft): string | undefined {
  const [step] = testCase.steps;
  return testCase.steps.length === 1 && step?.type === 'recordingReplay' ? step.recordingId : undefined;
}

export function createDemoProject(): ProjectDraft {
  const now = new Date().toISOString();
  return {
    id: 'project-demo',
    name: 'Demo Shop 自动化',
    description: '围绕图表、表格和交易链路验证的本地测试项目。',
    defaultUrl: 'https://demo-shop.local',
    selectedEnvironmentId: 'env-staging',
    createdAt: now,
    updatedAt: now,
    environments: [
      {
        id: 'env-staging',
        name: 'Staging',
        kind: 'staging',
        url: 'https://demo-shop.local',
        entryPath: '/dashboard',
        browser: 'chromium',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: true,
        credentialId: 'cred-demo-admin',
      },
      {
        id: 'env-local',
        name: 'Local Preview',
        kind: 'local',
        url: 'http://127.0.0.1:4173',
        entryPath: '/',
        browser: 'chromium',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: false,
      },
    ],
    groups: [
      {
        id: 'group-core',
        name: '核心链路',
        description: '登录、检索、筛选、图表和表格关键路径。',
        createdAt: now,
      },
      {
        id: 'group-reporting',
        name: '数据看板',
        description: '图表展示、表格排序、筛选和导出相关用例。',
        createdAt: now,
      },
    ],
    credentialRefs: [
      {
        id: 'cred-demo-admin',
        label: 'Staging 管理员',
        kind: 'password',
        username: 'qa@example.com',
        updatedAt: now,
        hasSecret: true,
      },
    ],
    storageStateRefs: [],
    recordings: [
      {
        id: 'recording-demo-dashboard',
        name: '数据看板筛选回放',
        summary: '覆盖时间范围切换、业务线筛选和图表刷新后的关键状态对比。',
        source: 'live',
        groupId: 'group-reporting',
        environmentId: 'env-staging',
        startUrl: 'https://demo-shop.local/dashboard',
        comparisonGoal: '回放后断言图表、指标卡片和明细表格都已刷新，并且没有空白区域。',
        tags: ['图表', '筛选', '回放基线'],
        createdAt: now,
        updatedAt: now,
        steps: [
          {
            id: 'recording-step-001',
            kind: 'navigate',
            title: '进入数据看板',
            detail: '打开 /dashboard 页面并等待图表骨架屏消失。',
          },
          {
            id: 'recording-step-002',
            kind: 'click',
            title: '切换时间范围',
            detail: '点击“近 30 天”筛选项，等待趋势图刷新。',
          },
          {
            id: 'recording-step-003',
            kind: 'click',
            title: '选择业务线',
            detail: '在业务线筛选中选择“企业服务”。',
          },
          {
            id: 'recording-step-004',
            kind: 'assert',
            title: '验证图表与表格',
            detail: '趋势图、指标卡片和表格都展示了企业服务相关数据。',
          },
        ],
      },
    ],
    documents: [],
    fixtures: [],
    suites: [],
    prdCoverageTriage: [],
    testCases: initialWorkflows.map((workflow) => workflowToTestCase(workflow)),
  };
}

export function createInitialStudioState(): StudioState {
  return {
    selectedProjectId: '',
    selectedGroupId: '',
    selectedTestCaseId: '',
    selectedRecordingId: '',
    projects: [],
    projectAssetBindings: [],
    runDetails: [],
    suiteRunRecords: [],
    recentRuns: [],
    chatEntries: [],
    runtimeProfile: structuredClone(defaultRuntimeProfile),
    midsceneConfig: structuredClone(defaultMidsceneConfig),
    agentModelConfig: structuredClone(defaultAgentModelConfig),
    appearance: structuredClone(defaultAppearanceConfig),
    startupGuide: {
      completed: false,
    },
    browserSession: {
      ...defaultBrowserSession,
      updatedAt: new Date().toISOString(),
    },
    selectedWorkflowId: '',
    workflows: [],
  };
}

/** Provides the legacy demo workspace exclusively for isolated UI and state fixtures. */
export function createDemoStudioState(): StudioState {
  const project = createDemoProject();
  const initialState = createInitialStudioState();

  return {
    ...initialState,
    selectedProjectId: project.id,
    selectedGroupId: project.groups[0]?.id ?? '',
    selectedTestCaseId: project.testCases[0]?.id ?? '',
    selectedRecordingId: project.recordings[0]?.id ?? '',
    projects: [project],
    recentRuns: structuredClone(initialRecentRuns),
    chatEntries: structuredClone(initialChatTimeline),
    selectedWorkflowId: project.testCases[0]?.id ?? '',
    workflows: project.testCases.map(testCaseToWorkflow),
  };
}

export function hydrateStudioState(
  rawState: Partial<StudioState> | null | undefined,
): StudioState {
  const initialState = createInitialStudioState();
  if (!rawState) {
    return initialState;
  }

  const migratedProjects = Array.isArray(rawState.projects)
    ? rawState.projects
        .filter((project) => project?.id !== builtInMockProjectId)
        .map(normalizeProjectDraft)
    : [];
  const projectAssetBindings = normalizeProjectAssetBindings(rawState.projectAssetBindings, migratedProjects);

  const selectedProjectId =
    rawState.selectedProjectId && migratedProjects.some((project) => project.id === rawState.selectedProjectId)
      ? rawState.selectedProjectId
      : migratedProjects[0]?.id ?? '';
  const selectedProject = migratedProjects.find((project) => project.id === selectedProjectId);
  const selectedGroupId =
    rawState.selectedGroupId && selectedProject?.groups.some((group) => group.id === rawState.selectedGroupId)
      ? rawState.selectedGroupId
      : selectedProject?.groups[0]?.id ?? '';
  const legacySelectedTestCaseId =
    rawState.selectedTestCaseId &&
    selectedProject?.testCases.some((testCase) => testCase.id === rawState.selectedTestCaseId)
      ? rawState.selectedTestCaseId
      : selectedProject?.testCases[0]?.id ?? '';
  const selectedTestCaseReference =
    rawState.selectedTestCaseReference && selectedProject && findTestCaseVersion(selectedProject, rawState.selectedTestCaseReference)
      ? rawState.selectedTestCaseReference
      : legacySelectedTestCaseId
        ? (() => {
            const latest = listLatestTestCaseVersions(selectedProject ?? { testCases: [] })
              .find((testCase) => testCase.id === legacySelectedTestCaseId);
            return latest ? { id: latest.id, version: normalizeTestCaseVersion(latest.version) } : undefined;
          })()
        : undefined;
  const selectedRecordingId =
    rawState.selectedRecordingId &&
    selectedProject?.recordings.some((recording) => recording.id === rawState.selectedRecordingId)
      ? rawState.selectedRecordingId
      : selectedProject?.recordings[0]?.id ?? '';
  const rawMidsceneConfig = (rawState.midsceneConfig ?? {}) as Partial<MidsceneConfig> & {
    endpoint?: string;
    workspaceName?: string;
    modelApiKey?: unknown;
  };
  const { modelApiKey: _legacyMidsceneApiKey, ...keyFreeMidsceneConfig } = rawMidsceneConfig;
  const hydratedMidsceneConfig = {
    ...initialState.midsceneConfig,
    ...keyFreeMidsceneConfig,
    modelBaseUrl: rawMidsceneConfig.modelBaseUrl ?? rawMidsceneConfig.endpoint ?? '',
    modelName: rawMidsceneConfig.modelName ?? rawMidsceneConfig.workspaceName ?? '',
  };
  const rawAgentModelConfig = (rawState.agentModelConfig ?? {}) as Partial<AgentModelConfig>;
  const hydratedAgentModelConfig = (Object.keys(initialState.agentModelConfig) as AgentModelRole[]).reduce(
    (nextConfig, role) => ({
      ...nextConfig,
      [role]: {
        ...initialState.agentModelConfig[role],
        ...withoutLegacyModelApiKey(rawAgentModelConfig[role]),
      },
    }),
    {} as AgentModelConfig,
  );
  const rawStartupGuide: Partial<StartupGuideState> = rawState.startupGuide ?? {};
  const runDetails = Array.isArray(rawState.runDetails)
    ? rawState.runDetails
      .filter((run) => run.projectId !== builtInMockProjectId)
      .map(migrateLegacyRunDetail)
    : initialState.runDetails;
  const suiteRunRecords = Array.isArray(rawState.suiteRunRecords)
    ? structuredClone(rawState.suiteRunRecords)
    : initialState.suiteRunRecords;
  const recentRuns = Array.isArray(rawState.recentRuns)
    ? rawState.recentRuns
      .filter((run) => run.projectId !== builtInMockProjectId)
      .map((run) => migrateLegacyRunSummary(run, findUnambiguousMatchingRunDetail(run, runDetails)))
    : initialState.recentRuns;

  return {
    selectedProjectId,
    selectedGroupId,
    ...(selectedTestCaseReference ? { selectedTestCaseReference } : {}),
    selectedRecordingId,
    projects: migratedProjects,
    projectAssetBindings,
    runDetails,
    suiteRunRecords,
    recentRuns,
    chatEntries: Array.isArray(rawState.chatEntries)
      ? rawState.chatEntries.filter((entry) => !builtInMockChatEntryIds.has(entry.id))
      : initialState.chatEntries,
    runtimeProfile: {
      ...initialState.runtimeProfile,
      ...(rawState.runtimeProfile ?? {}),
      baseUrl:
        rawState.runtimeProfile?.baseUrl === 'https://demo-shop.local'
          ? ''
          : rawState.runtimeProfile?.baseUrl ?? initialState.runtimeProfile.baseUrl,
    },
    midsceneConfig: hydratedMidsceneConfig,
    agentModelConfig: hydratedAgentModelConfig,
    appearance: {
      ...initialState.appearance,
      ...(rawState.appearance ?? {}),
    },
    startupGuide: {
      ...initialState.startupGuide,
      ...rawStartupGuide,
      completed: rawStartupGuide.completed ?? isMidsceneConfigured(hydratedMidsceneConfig),
    },
    // A Playwright page belongs to the Electron process and cannot outlive it.
    // Restoring its former status would display stale errors or a false-ready state.
    browserSession: initialState.browserSession,
    selectedWorkflowId: selectedTestCaseReference?.id ?? '',
    workflows: selectedProject?.testCases.map(testCaseToWorkflow) ?? initialState.workflows,
  };
}

function migrateLegacyRunDetail(run: RunDetail): RunDetail {
  if ((run as { status?: unknown }).status !== 'neutral') {
    return run;
  }

  return {
    ...run,
    ...classifyLegacyNeutralRun(run.cancellation),
  };
}

function migrateLegacyRunSummary(run: RunSummary, detail?: RunDetail): RunSummary {
  if ((run as { status?: unknown }).status !== 'neutral') {
    return run;
  }

  if (detail && isTerminalRunStatus(detail.status)) {
    return {
      ...run,
      status: detail.status,
      ...(detail.reason ? { reason: detail.reason } : {}),
    };
  }

  return {
    ...run,
    ...classifyLegacyNeutralRun(),
  };
}

function findUnambiguousMatchingRunDetail(summary: RunSummary, details: RunDetail[]): RunDetail | undefined {
  const sameId = details.filter((detail) => detail.id === summary.id);
  const hasProjectId = summary.projectId !== undefined;
  const hasTestCaseId = summary.testCaseId !== undefined;
  const hasEnvironmentId = summary.environmentId !== undefined;
  if (!hasProjectId && !hasTestCaseId && !hasEnvironmentId) {
    return sameId.length === 1 ? sameId[0] : undefined;
  }

  const matches = sameId.filter((detail) =>
    (!hasProjectId || detail.projectId === summary.projectId) &&
    (!hasTestCaseId || detail.testCaseId === summary.testCaseId) &&
    (!hasEnvironmentId || detail.environmentId === summary.environmentId),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function classifyLegacyNeutralRun(cancellationValue?: unknown): Pick<RunDetail, 'status' | 'reason'> {
  const cancellation = normalizeLegacyUserCancellation(cancellationValue);
  if (cancellation) {
    return {
      status: 'cancelled',
      reason: {
        code: 'userCancelled',
        message: cancellation.message,
      },
    };
  }

  return {
    status: 'blocked',
    reason: {
      code: 'legacyAmbiguousNeutral',
      message: 'Legacy neutral run could not be classified from structured evidence.',
    },
  };
}

function normalizeLegacyUserCancellation(value: unknown): RunCancellation | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const cancellation = value as Partial<RunCancellation>;
  return cancellation.source === 'user' &&
    cancellation.reason === 'userCancelled' &&
    typeof cancellation.message === 'string' &&
    cancellation.message.trim() &&
    typeof cancellation.cancelledAt === 'string'
    ? {
        source: 'user',
        reason: 'userCancelled',
        message: cancellation.message,
        cancelledAt: cancellation.cancelledAt,
      }
    : undefined;
}

/** Drops malformed or stale pointers without reading any external project directory. */
export function normalizeProjectAssetBindings(
  rawBindings: unknown,
  projects: Array<Pick<ProjectDraft, 'id'>>,
): ProjectAssetBinding[] {
  if (!Array.isArray(rawBindings)) {
    return [];
  }

  const projectIds = new Set(projects.map((project) => project.id));
  const seenProjectIds = new Set<string>();
  return rawBindings.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') {
      return [];
    }

    const binding = candidate as Partial<ProjectAssetBinding>;
    if (
      typeof binding.projectId !== 'string' ||
      !projectIds.has(binding.projectId) ||
      seenProjectIds.has(binding.projectId) ||
      typeof binding.projectDirectory !== 'string' ||
      !binding.projectDirectory.trim() ||
      typeof binding.revision !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(binding.revision) ||
      typeof binding.boundAt !== 'string' ||
      Number.isNaN(Date.parse(binding.boundAt))
    ) {
      return [];
    }

    seenProjectIds.add(binding.projectId);
    return [{
      projectId: binding.projectId,
      projectDirectory: binding.projectDirectory,
      revision: binding.revision,
      boundAt: binding.boundAt,
    }];
  });
}

/**
 * Renderer saves carry the full editing state and can be queued behind an IPC
 * that records a new asset binding. Preserve existing bindings unless the
 * incoming state supplies a newer pointer for the same surviving project.
 */
export function mergeProjectAssetBindings(
  currentBindings: unknown,
  incomingBindings: unknown,
  projects: Array<Pick<ProjectDraft, 'id'>>,
): ProjectAssetBinding[] {
  const currentByProjectId = new Map(
    normalizeProjectAssetBindings(currentBindings, projects).map((binding) => [binding.projectId, binding]),
  );
  const incomingByProjectId = new Map(
    normalizeProjectAssetBindings(incomingBindings, projects).map((binding) => [binding.projectId, binding]),
  );

  return projects.flatMap((project) => {
    const currentBinding = currentByProjectId.get(project.id);
    const incomingBinding = incomingByProjectId.get(project.id);
    const binding = currentBinding && incomingBinding
      ? Date.parse(incomingBinding.boundAt) >= Date.parse(currentBinding.boundAt)
        ? incomingBinding
        : currentBinding
      : incomingBinding ?? currentBinding;
    return binding ? [binding] : [];
  });
}

export function isMidsceneConfigured(config: MidsceneConfig): boolean {
  return Boolean(
    config.modelBaseUrl.trim() &&
      config.modelSecret.hasKey &&
      config.modelName.trim() &&
      config.modelFamily.trim(),
  );
}

function createEmptyModelSecretRef(id: string): ModelSecretRef {
  return {
    id,
    hasKey: false,
    updatedAt: new Date(0).toISOString(),
  };
}

function withoutLegacyModelApiKey(config: Partial<AgentRoleModelConfig> | undefined): Partial<AgentRoleModelConfig> {
  if (!config) {
    return {};
  }
  const { modelApiKey: _legacyModelApiKey, ...keyFreeConfig } = config as Partial<AgentRoleModelConfig> & {
    modelApiKey?: unknown;
  };
  return keyFreeConfig;
}

function inferWorkflowKind(steps: WorkflowStepDraft[]): WorkflowKind {
  const scores = steps.reduce(
    (current, step) => {
      if (step.type === 'aiAssert') {
        current.assertion += 1;
      } else if (step.type === 'aiQuery') {
        current.extraction += 1;
      } else {
        current.scenario += 1;
      }
      return current;
    },
    {
      scenario: 0,
      assertion: 0,
      extraction: 0,
    },
  );

  if (scores.extraction >= scores.scenario && scores.extraction >= scores.assertion) {
    return 'extraction';
  }

  if (scores.assertion >= scores.scenario && scores.assertion >= scores.extraction) {
    return 'assertion';
  }

  return 'scenario';
}

function normalizeWorkflowDraft(rawWorkflow: WorkflowDraft): WorkflowDraft {
  return {
    ...rawWorkflow,
    kind: rawWorkflow.kind ?? inferWorkflowKind(rawWorkflow.steps),
    steps: Array.isArray(rawWorkflow.steps) ? rawWorkflow.steps : [],
  };
}

function normalizePrdPathReference(rawReference: unknown): PrdPathReference | undefined {
  if (!rawReference || typeof rawReference !== 'object') {
    return undefined;
  }

  const reference = rawReference as Partial<PrdPathReference>;
  const documentId = typeof reference.documentId === 'string' ? reference.documentId.trim() : '';
  const pathId = typeof reference.pathId === 'string' ? reference.pathId.trim() : '';
  return documentId && pathId ? { documentId, pathId } : undefined;
}

function normalizeProvenanceStepIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(value.flatMap((stepId) => {
    const normalized = normalizedNonEmptyString(stepId);
    return normalized ? [normalized] : [];
  })));
}

function normalizeTestCaseIntentEntries(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(value.flatMap((entry) => {
    const normalized = normalizedNonEmptyString(entry);
    return normalized ? [normalized] : [];
  })));
}

function normalizeTestCaseIntent(value: unknown): TestCaseIntent | undefined {
  const rawIntent = asRecord(value);
  if (!rawIntent || rawIntent.schemaVersion !== 1) {
    return undefined;
  }

  const businessGoal = normalizedNonEmptyString(rawIntent.businessGoal);
  if (!businessGoal) {
    return undefined;
  }

  return {
    schemaVersion: 1,
    businessGoal,
    preconditions: normalizeTestCaseIntentEntries(rawIntent.preconditions),
    successCriteria: normalizeTestCaseIntentEntries(rawIntent.successCriteria),
  };
}

export function createTestCaseIntent(
  businessGoal: string,
  options: Pick<TestCaseIntent, 'preconditions' | 'successCriteria'> = { preconditions: [], successCriteria: [] },
): TestCaseIntent {
  return {
    schemaVersion: 1,
    businessGoal: businessGoal.trim(),
    preconditions: normalizeTestCaseIntentEntries(options.preconditions),
    successCriteria: normalizeTestCaseIntentEntries(options.successCriteria),
  };
}

function normalizeTestCaseProvenance(value: unknown): TestCaseProvenanceReference[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const references: TestCaseProvenanceReference[] = [];
  const seen = new Set<string>();
  value.forEach((candidate) => {
    const raw = asRecord(candidate);
    if (!raw || typeof raw.kind !== 'string') {
      return;
    }

    if (raw.kind === 'agentRun') {
      const runId = normalizedNonEmptyString(raw.runId);
      if (!runId || seen.has(`agentRun:${runId}`)) {
        return;
      }
      seen.add(`agentRun:${runId}`);
      references.push({ kind: 'agentRun', runId, stepIds: normalizeProvenanceStepIds(raw.stepIds) });
      return;
    }

    if (raw.kind === 'recording') {
      const recordingId = normalizedNonEmptyString(raw.recordingId);
      if (!recordingId || seen.has(`recording:${recordingId}`)) {
        return;
      }
      seen.add(`recording:${recordingId}`);
      references.push({ kind: 'recording', recordingId, stepIds: normalizeProvenanceStepIds(raw.stepIds) });
      return;
    }

    if (raw.kind === 'prdPath') {
      const documentId = normalizedNonEmptyString(raw.documentId);
      const pathId = normalizedNonEmptyString(raw.pathId);
      const key = `prdPath:${documentId}:${pathId}`;
      if (!documentId || !pathId || seen.has(key)) {
        return;
      }
      seen.add(key);
      references.push({ kind: 'prdPath', documentId, pathId });
      return;
    }

    if (raw.kind === 'prdDocument') {
      const documentId = normalizedNonEmptyString(raw.documentId);
      if (!documentId || seen.has(`prdDocument:${documentId}`)) {
        return;
      }
      seen.add(`prdDocument:${documentId}`);
      references.push({ kind: 'prdDocument', documentId });
    }
  });
  return references;
}

function createLegacyTestCaseProvenance(
  source: TestCaseSource,
  prdPath: PrdPathReference | undefined,
  steps: TestStepDraft[],
  recordingsById: Map<string, RecordingAsset>,
): TestCaseProvenanceReference[] {
  const references: TestCaseProvenanceReference[] = prdPath
    ? [{ kind: 'prdPath', ...prdPath }]
    : [];
  if (source !== 'recording') {
    return references;
  }

  const recordingId = steps.find((step) => step.type === 'recordingReplay')?.recordingId;
  if (!recordingId) {
    return references;
  }
  const recording = recordingsById.get(recordingId);
  references.unshift({
    kind: 'recording',
    recordingId,
    stepIds: recording?.steps.map((step) => step.id) ?? [],
  });
  if (!prdPath && recording?.prdPath) {
    references.push({ kind: 'prdPath', ...recording.prdPath });
  }
  return references;
}

export function getTestCasePrdPath(testCase: Pick<TestCaseDraft, 'provenance' | 'prdPath'>): PrdPathReference | undefined {
  const reference = testCase.provenance?.find(
    (candidate): candidate is Extract<TestCaseProvenanceReference, { kind: 'prdPath' }> => candidate.kind === 'prdPath',
  );
  return reference
    ? { documentId: reference.documentId, pathId: reference.pathId }
    : testCase.prdPath;
}

export function getPrdCoverageTriageKey(
  documentId: string,
  pathId: string,
  target: PrdCoverageTarget,
): string {
  return `${documentId}::${pathId}::${target}`;
}

export function getPrdCoverageTriageStatus(
  covered: boolean,
  decision: Pick<PrdCoverageTriageDecision, 'status'> | undefined,
): PrdCoverageTriageStatus {
  if (covered) {
    return 'resolved';
  }
  return decision?.status ?? 'pending';
}

export function prunePrdCoverageTriage(
  documents: PrdDocumentAsset[],
  rawTriage: unknown,
): PrdCoverageTriageDecision[] {
  if (!Array.isArray(rawTriage)) {
    return [];
  }

  const validPathsByDocument = new Map(
    documents.map((document) => [document.id, new Set(document.generatedPaths.map((path) => path.id))]),
  );
  const deduplicated = new Map<string, PrdCoverageTriageDecision>();
  rawTriage.forEach((rawDecision) => {
    if (!rawDecision || typeof rawDecision !== 'object') {
      return;
    }
    const decision = rawDecision as Partial<PrdCoverageTriageDecision>;
    const documentId = typeof decision.documentId === 'string' ? decision.documentId.trim() : '';
    const pathId = typeof decision.pathId === 'string' ? decision.pathId.trim() : '';
    const target = decision.target === 'case' || decision.target === 'recording' ? decision.target : undefined;
    const status = decision.status === 'deferred' || decision.status === 'ignored' ? decision.status : undefined;
    const note = typeof decision.note === 'string' ? decision.note.trim() : '';
    const updatedAt = typeof decision.updatedAt === 'string' ? decision.updatedAt.trim() : '';
    if (!documentId || !pathId || !target || !status || !note || !updatedAt || !validPathsByDocument.get(documentId)?.has(pathId)) {
      return;
    }

    const normalized = { documentId, pathId, target, status, note, updatedAt };
    const key = getPrdCoverageTriageKey(documentId, pathId, target);
    const prior = deduplicated.get(key);
    if (!prior || normalized.updatedAt >= prior.updatedAt) {
      deduplicated.set(key, normalized);
    }
  });
  return Array.from(deduplicated.values());
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function normalizedNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeTestCaseVersion(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : 1;
}

function normalizeVersionedTestAssetReference(value: unknown): VersionedTestAssetReference | undefined {
  const rawReference = asRecord(value);
  const id = normalizedNonEmptyString(rawReference?.id);
  const version = rawReference?.version;
  if (!id || typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
    return undefined;
  }
  return { id, version };
}

function versionedReferenceKey(reference: Pick<VersionedTestAssetReference, 'id' | 'version'>): string {
  return `${reference.id}@${reference.version}`;
}

function normalizeTestInputValueBinding(value: unknown): TestInputValueBinding | undefined {
  const rawBinding = asRecord(value);
  if (!rawBinding) {
    return undefined;
  }
  if (rawBinding.kind === 'credential') {
    const credentialId = normalizedNonEmptyString(rawBinding.credentialId);
    return credentialId && (rawBinding.field === 'username' || rawBinding.field === 'secret')
      ? { kind: 'credential', credentialId, field: rawBinding.field }
      : undefined;
  }
  if (rawBinding.kind === 'fixtureOutput') {
    const fixtureId = normalizedNonEmptyString(rawBinding.fixtureId);
    const outputName = normalizedNonEmptyString(rawBinding.outputName);
    const fixtureVersion = rawBinding.fixtureVersion;
    return fixtureId &&
      outputName &&
      /^[A-Za-z_][A-Za-z0-9_-]*$/.test(outputName) &&
      typeof fixtureVersion === 'number' &&
      Number.isSafeInteger(fixtureVersion) &&
      fixtureVersion > 0
      ? { kind: 'fixtureOutput', fixtureId, fixtureVersion, outputName }
      : undefined;
  }
  return undefined;
}

function isTestInputValueBinding(value: unknown): value is TestInputValueBinding {
  return Boolean(normalizeTestInputValueBinding(value));
}

function normalizeTestInputBindingTarget(value: unknown): TestInputBindingTarget | undefined {
  const rawTarget = asRecord(value);
  const locator = normalizeTestLocatorFingerprint(rawTarget?.locator);
  if (!rawTarget || !locator || (rawTarget.kind !== 'input' && rawTarget.kind !== 'select')) {
    return undefined;
  }
  return { kind: rawTarget.kind, locator };
}

function normalizeVersionedTestAssetReferences(value: unknown): VersionedTestAssetReference[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const references = new Map<string, VersionedTestAssetReference>();
  value.forEach((rawReference) => {
    const reference = normalizeVersionedTestAssetReference(rawReference);
    if (reference && !references.has(reference.id)) {
      references.set(reference.id, reference);
    }
  });
  return Array.from(references.values());
}

function normalizeTestCaseAssetReferences(value: unknown): TestCaseAssetReferences {
  const rawReferences = asRecord(value);
  const baseline = normalizeVersionedTestAssetReference(rawReferences?.baseline);
  return {
    fixtures: normalizeVersionedTestAssetReferences(rawReferences?.fixtures),
    reusableFlows: normalizeVersionedTestAssetReferences(rawReferences?.reusableFlows),
    ...(baseline ? { baseline } : {}),
  };
}

function normalizeFixtureParameter(value: unknown): FixtureParameter | undefined {
  const rawParameter = asRecord(value);
  const name = normalizedNonEmptyString(rawParameter?.name);
  if (
    !rawParameter ||
    !name ||
    !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name) ||
    (rawParameter.type !== 'string' && rawParameter.type !== 'number' && rawParameter.type !== 'boolean' && rawParameter.type !== 'json') ||
    typeof rawParameter.required !== 'boolean'
  ) {
    return undefined;
  }
  const description = normalizedNonEmptyString(rawParameter.description);
  return { name, type: rawParameter.type, required: rawParameter.required, ...(description ? { description } : {}) };
}

function normalizeFixtureLifecycle(value: unknown): FixtureLifecycleDeclaration | undefined {
  const rawLifecycle = asRecord(value);
  const summary = normalizedNonEmptyString(rawLifecycle?.summary);
  if (!rawLifecycle || !summary || (rawLifecycle.mode !== 'http' && rawLifecycle.mode !== 'ui' && rawLifecycle.mode !== 'script')) {
    return undefined;
  }
  if (rawLifecycle.mode === 'http') {
    if (rawLifecycle.http === undefined) {
      return { mode: 'http', summary };
    }
    const http = normalizeFixtureHttpDeclaration(rawLifecycle.http);
    return http ? { mode: 'http', summary, http } : { mode: 'http', summary };
  }
  if (rawLifecycle.mode === 'ui') {
    return { mode: 'ui', summary };
  }
  const rawScript = asRecord(rawLifecycle.script);
  const relativePath = normalizedNonEmptyString(rawScript?.relativePath);
  const contentHash = normalizedNonEmptyString(rawScript?.contentHash);
  if (
    !relativePath ||
    relativePath.startsWith('/') ||
    relativePath.split(/[\\/]/u).includes('..') ||
    !contentHash ||
    !/^[a-f0-9]{64}$/i.test(contentHash) ||
    !Array.isArray(rawScript?.requiredEnvironment)
  ) {
    return undefined;
  }
  const requiredEnvironment = normalizeUniqueStrings(rawScript.requiredEnvironment);
  return { mode: 'script', summary, script: { relativePath, contentHash, requiredEnvironment } };
}

function isFixtureHttpMethod(value: unknown): value is FixtureHttpMethod {
  return value === 'POST' || value === 'PUT' || value === 'PATCH' || value === 'DELETE';
}

function normalizeFixtureExpectedStatuses(value: unknown): number[] | undefined {
  if (!Array.isArray(value) || !value.length || value.length > 8) {
    return undefined;
  }
  const statuses = Array.from(new Set(value));
  return statuses.length === value.length && statuses.every((status) => (
    typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
  ))
    ? statuses
    : undefined;
}

function normalizeFixtureHttpResponseOutputMappings(value: unknown): FixtureHttpResponseOutputMapping[] | undefined {
  if (!Array.isArray(value) || !value.length || value.length > 20) {
    return undefined;
  }
  const mappings = value.map((rawMapping) => {
    const mapping = asRecord(rawMapping);
    const outputName = normalizedNonEmptyString(mapping?.outputName);
    const jsonPointer = normalizedNonEmptyString(mapping?.jsonPointer);
    if (
      !outputName ||
      !jsonPointer ||
      !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(outputName) ||
      !/^\/[A-Za-z_][A-Za-z0-9_-]*$/u.test(jsonPointer) ||
      isSensitiveFixtureHttpKey(outputName) ||
      isSensitiveFixtureHttpKey(jsonPointer.slice(1))
    ) {
      return undefined;
    }
    return { outputName, jsonPointer };
  });
  if (mappings.some((mapping): mapping is undefined => mapping === undefined)) {
    return undefined;
  }
  const normalized = mappings as FixtureHttpResponseOutputMapping[];
  return new Set(normalized.map((mapping) => mapping.outputName)).size === normalized.length &&
    new Set(normalized.map((mapping) => mapping.jsonPointer)).size === normalized.length
    ? normalized
    : undefined;
}

function isSafeFixtureHttpPath(value: string): boolean {
  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    value.includes('?') ||
    value.includes('#') ||
    value.split('/').includes('..')
  ) {
    return false;
  }
  try {
    const normalized = new URL(value, 'https://fixture.invalid');
    return normalized.origin === 'https://fixture.invalid' && normalized.pathname === value;
  } catch {
    return false;
  }
}

export function normalizeFixtureHttpJsonValue(value: unknown, depth = 0): FixtureHttpJsonValue | undefined {
  if (depth > 8 || value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value === null || typeof value === 'string' || typeof value === 'boolean' ? value : undefined;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) {
      return undefined;
    }
    const entries = value.map((item) => normalizeFixtureHttpJsonValue(item, depth + 1));
    if (entries.some((item) => item === undefined)) {
      return undefined;
    }
    return entries as FixtureHttpJsonValue[];
  }
  const record = asRecord(value);
  if (!record || Object.keys(record).length > 100) {
    return undefined;
  }
  const entries: Record<string, FixtureHttpJsonValue> = {};
  for (const [key, item] of Object.entries(record)) {
    if (!key || key.length > 100 || isSensitiveFixtureHttpKey(key)) {
      return undefined;
    }
    const normalized = normalizeFixtureHttpJsonValue(item, depth + 1);
    if (normalized === undefined) {
      return undefined;
    }
    entries[key] = normalized;
  }
  try {
    return JSON.stringify(entries).length <= 8_192 ? entries : undefined;
  } catch {
    return undefined;
  }
}

function isSensitiveFixtureHttpKey(value: string): boolean {
  return /(?:api[-_]?key|authorization|cookie|credential|pass(?:word)?|secret|token)/iu.test(value);
}

function normalizeFixtureAsset(
  value: unknown,
  environmentIds: Set<string>,
  credentialIds: Set<string>,
): FixtureAsset | undefined {
  const rawFixture = asRecord(value);
  const id = normalizedNonEmptyString(rawFixture?.id);
  const name = normalizedNonEmptyString(rawFixture?.name);
  const setup = normalizeFixtureLifecycle(rawFixture?.setup);
  if (!rawFixture || rawFixture.schemaVersion !== 1 || !id || !name || !setup || rawFixture.version === undefined) {
    return undefined;
  }
  const version = normalizeTestCaseVersion(rawFixture.version);
  if (version !== rawFixture.version) {
    return undefined;
  }
  const cleanup = rawFixture.cleanup === undefined ? undefined : normalizeFixtureLifecycle(rawFixture.cleanup);
  if (rawFixture.cleanup !== undefined && !cleanup) {
    return undefined;
  }
  const inputs = Array.isArray(rawFixture.inputs)
    ? rawFixture.inputs.map(normalizeFixtureParameter).filter((parameter): parameter is FixtureParameter => Boolean(parameter))
    : [];
  const outputs = Array.isArray(rawFixture.outputs)
    ? rawFixture.outputs.map(normalizeFixtureParameter).filter((parameter): parameter is FixtureParameter => Boolean(parameter))
    : [];
  if (inputs.length !== (Array.isArray(rawFixture.inputs) ? rawFixture.inputs.length : 0) || outputs.length !== (Array.isArray(rawFixture.outputs) ? rawFixture.outputs.length : 0)) {
    return undefined;
  }
  const createdAt = normalizedNonEmptyString(rawFixture.createdAt);
  const updatedAt = normalizedNonEmptyString(rawFixture.updatedAt);
  if (!createdAt || !updatedAt || Number.isNaN(Date.parse(createdAt)) || Number.isNaN(Date.parse(updatedAt))) {
    return undefined;
  }
  const inputNames = new Set(inputs.map((parameter) => parameter.name));
  const outputNames = new Set(outputs.map((parameter) => parameter.name));
  if (inputNames.size !== inputs.length || outputNames.size !== outputs.length) {
    return undefined;
  }
  const description = typeof rawFixture.description === 'string' ? rawFixture.description.trim() : '';
  const fixtureEnvironmentIds = normalizeUniqueStrings(rawFixture.environmentIds).filter((environmentId) => environmentIds.has(environmentId));
  const fixtureCredentialIds = normalizeUniqueStrings(rawFixture.credentialIds).filter((credentialId) => credentialIds.has(credentialId));
  const resourceLocks = normalizeUniqueStrings(rawFixture.resourceLocks);
  if (fixtureEnvironmentIds.length !== normalizeUniqueStrings(rawFixture.environmentIds).length || fixtureCredentialIds.length !== normalizeUniqueStrings(rawFixture.credentialIds).length) {
    return undefined;
  }
  if (rawFixture.concurrency !== 'parallel' && rawFixture.concurrency !== 'exclusive') {
    return undefined;
  }
  return {
    schemaVersion: 1,
    id,
    version,
    name,
    description,
    inputs,
    outputs,
    credentialIds: fixtureCredentialIds,
    environmentIds: fixtureEnvironmentIds,
    setup,
    ...(cleanup ? { cleanup } : {}),
    concurrency: rawFixture.concurrency,
    resourceLocks,
    createdAt,
    updatedAt,
  };
}

function normalizeSuiteCaseReference(value: unknown): SuiteCaseReference | undefined {
  const rawReference = asRecord(value);
  const reference = normalizeVersionedTestAssetReference(rawReference);
  if (!rawReference || !reference || !Array.isArray(rawReference.dependsOn)) {
    return undefined;
  }
  const dependsOn = rawReference.dependsOn.map(normalizeVersionedTestAssetReference);
  if (dependsOn.some((dependency) => !dependency)) {
    return undefined;
  }
  const normalizedDependencies = dependsOn as VersionedTestAssetReference[];
  const dependencyKeys = normalizedDependencies.map(versionedReferenceKey);
  if (new Set(dependencyKeys).size !== dependencyKeys.length) {
    return undefined;
  }
  return { ...reference, dependsOn: normalizedDependencies };
}

function normalizeSuiteAsset(value: unknown): SuiteAsset | undefined {
  const rawSuite = asRecord(value);
  const id = normalizedNonEmptyString(rawSuite?.id);
  const name = normalizedNonEmptyString(rawSuite?.name);
  const environmentId = normalizedNonEmptyString(rawSuite?.environmentId);
  const createdAt = normalizedNonEmptyString(rawSuite?.createdAt);
  const updatedAt = normalizedNonEmptyString(rawSuite?.updatedAt);
  const execution = asRecord(rawSuite?.execution);
  if (
    !rawSuite ||
    rawSuite.schemaVersion !== 1 ||
    !id ||
    !name ||
    !environmentId ||
    !createdAt ||
    !updatedAt ||
    Number.isNaN(Date.parse(createdAt)) ||
    Number.isNaN(Date.parse(updatedAt)) ||
    !Array.isArray(rawSuite.caseReferences) ||
    !Array.isArray(rawSuite.tags) ||
    !execution ||
    rawSuite.version === undefined
  ) {
    return undefined;
  }
  const version = normalizeTestCaseVersion(rawSuite.version);
  if (version !== rawSuite.version) {
    return undefined;
  }
  const caseReferences = rawSuite.caseReferences.map(normalizeSuiteCaseReference);
  if (caseReferences.some((reference) => !reference)) {
    return undefined;
  }
  const normalizedReferences = caseReferences as SuiteCaseReference[];
  const referenceKeys = normalizedReferences.map(versionedReferenceKey);
  if (new Set(referenceKeys).size !== referenceKeys.length) {
    return undefined;
  }
  const tags = rawSuite.tags.map(normalizedNonEmptyString);
  if (tags.some((tag) => !tag)) {
    return undefined;
  }
  const normalizedTags = tags as string[];
  if (new Set(normalizedTags).size !== normalizedTags.length) {
    return undefined;
  }
  const concurrency = execution.concurrency;
  const failurePolicy = execution.failurePolicy;
  const retryLimit = execution.retryLimit;
  if (
    typeof concurrency !== 'number' ||
    !Number.isSafeInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 10 ||
    (failurePolicy !== 'continue' && failurePolicy !== 'failFast') ||
    typeof retryLimit !== 'number' ||
    !Number.isSafeInteger(retryLimit) ||
    retryLimit < 0 ||
    retryLimit > 3
  ) {
    return undefined;
  }
  return {
    schemaVersion: 1,
    id,
    version,
    name,
    description: typeof rawSuite.description === 'string' ? rawSuite.description.trim() : '',
    tags: normalizedTags,
    environmentId,
    caseReferences: normalizedReferences,
    execution: {
      concurrency,
      failurePolicy,
      retryLimit,
    },
    createdAt,
    updatedAt,
  };
}

function normalizeUniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(value.map(normalizedNonEmptyString).filter((item): item is string => Boolean(item))));
}

function normalizeTestLocatorFingerprint(value: unknown): TestLocatorFingerprint | undefined {
  const rawLocator = asRecord(value);
  const selector = normalizedNonEmptyString(rawLocator?.selector);
  if (!rawLocator || !selector) {
    return undefined;
  }
  const quality = normalizeTestLocatorQuality(rawLocator.quality);
  if (!quality) {
    return undefined;
  }
  const rawAttributes = asRecord(rawLocator.publicAttributes);
  const publicAttributes = rawAttributes
    ? Object.entries(rawAttributes).reduce<Record<string, string>>((attributes, [rawName, rawValue]) => {
        const name = rawName.trim();
        const attributeValue = normalizedNonEmptyString(rawValue);
        if (name && attributeValue) {
          attributes[name] = attributeValue;
        }
        return attributes;
      }, {})
    : undefined;
  const role = normalizedNonEmptyString(rawLocator.role);
  const name = normalizedNonEmptyString(rawLocator.name);
  const scope = normalizedNonEmptyString(rawLocator.scope);

  return {
    selector,
    ...(role ? { role } : {}),
    ...(name ? { name } : {}),
    ...(scope ? { scope } : {}),
    ...(publicAttributes && Object.keys(publicAttributes).length ? { publicAttributes } : {}),
    quality,
  };
}

function normalizeTestLocatorQuality(value: unknown): TestLocatorQuality | undefined {
  if (value === 'strong' || value === 'acceptable' || value === 'weak' || value === 'unresolved') {
    return value;
  }

  // V2 early drafts used these names before the four-level locator contract was finalized.
  if (value === 'fragile') {
    return 'weak';
  }
  if (value === 'unknown') {
    return 'unresolved';
  }
  return undefined;
}

function hasExecutableTestLocator(locator: unknown): locator is TestLocatorFingerprint {
  if (!locator || typeof locator !== 'object') {
    return false;
  }
  const candidate = locator as Partial<TestLocatorFingerprint>;
  return (
    typeof candidate.selector === 'string' &&
    Boolean(candidate.selector.trim()) &&
    (candidate.quality === 'strong' || candidate.quality === 'acceptable' || candidate.quality === 'weak')
  );
}

function normalizeOptionalTimeout(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function normalizeDeterministicTestAction(value: unknown): DeterministicTestAction | undefined {
  const rawAction = asRecord(value);
  if (!rawAction || typeof rawAction.kind !== 'string') {
    return undefined;
  }
  const locator = normalizeTestLocatorFingerprint(rawAction.locator);
  const timeoutMs = normalizeOptionalTimeout(rawAction.timeoutMs);

  if (rawAction.kind === 'navigate') {
    const url = normalizedNonEmptyString(rawAction.url);
    return url ? { kind: 'navigate', url } : undefined;
  }
  if (rawAction.kind === 'click') {
    return locator ? { kind: 'click', locator } : undefined;
  }
  if (rawAction.kind === 'input' || rawAction.kind === 'select') {
    const binding = normalizeTestInputValueBinding(rawAction.binding);
    return locator && binding
      ? { kind: rawAction.kind, locator, binding }
      : undefined;
  }
  if (rawAction.kind === 'waitForSelector') {
    return locator
      ? { kind: 'waitForSelector', locator, ...(timeoutMs ? { timeoutMs } : {}) }
      : undefined;
  }
  if (rawAction.kind === 'waitForTimeout') {
    return timeoutMs ? { kind: 'waitForTimeout', timeoutMs } : undefined;
  }
  if (rawAction.kind === 'scrollTo') {
    return locator ? { kind: 'scrollTo', locator } : undefined;
  }
  return undefined;
}

function normalizeExplicitTestAssertion(value: unknown): ExplicitTestAssertion | undefined {
  const rawAssertion = asRecord(value);
  const id = normalizedNonEmptyString(rawAssertion?.id);
  if (!rawAssertion || !id || rawAssertion.version !== 1 || typeof rawAssertion.kind !== 'string') {
    return undefined;
  }
  const expected = normalizedNonEmptyString(rawAssertion.expected);
  const locator = normalizeTestLocatorFingerprint(rawAssertion.locator);
  if (rawAssertion.kind === 'urlContains' || rawAssertion.kind === 'titleContains' || rawAssertion.kind === 'pageContains') {
    return expected ? { id, version: 1, kind: rawAssertion.kind, expected } : undefined;
  }
  if (rawAssertion.kind === 'locatorVisible') {
    return locator ? { id, version: 1, kind: 'locatorVisible', locator } : undefined;
  }
  if (rawAssertion.kind === 'locatorTextContains') {
    return locator && expected ? { id, version: 1, kind: 'locatorTextContains', locator, expected } : undefined;
  }
  return undefined;
}

function normalizeTestStepExecution(value: unknown): TestStepExecutionDraft | undefined {
  const rawExecution = asRecord(value);
  const intent = normalizedNonEmptyString(rawExecution?.intent);
  if (
    !rawExecution ||
    rawExecution.schemaVersion !== 2 ||
    !intent ||
    (rawExecution.reviewStatus !== 'needsReview' && rawExecution.reviewStatus !== 'confirmed') ||
    (rawExecution.actionRisk !== 'low' && rawExecution.actionRisk !== 'medium' && rawExecution.actionRisk !== 'high' && rawExecution.actionRisk !== 'unknown')
  ) {
    return undefined;
  }

  const hasAction = Object.prototype.hasOwnProperty.call(rawExecution, 'action');
  const hasAssertion = Object.prototype.hasOwnProperty.call(rawExecution, 'assertion');
  const action = hasAction ? normalizeDeterministicTestAction(rawExecution.action) : undefined;
  const assertion = hasAssertion ? normalizeExplicitTestAssertion(rawExecution.assertion) : undefined;
  if ((hasAction && !action) || (hasAssertion && !assertion)) {
    return undefined;
  }

  const rawProvenance = asRecord(rawExecution.provenance);
  const source = rawProvenance?.source === 'agentRun' ? 'agentRun' : undefined;
  const runId = normalizedNonEmptyString(rawProvenance?.runId);
  const stepId = normalizedNonEmptyString(rawProvenance?.stepId);
  const inputBindingTarget = normalizeTestInputBindingTarget(rawExecution.inputBindingTarget);

  return {
    schemaVersion: 2,
    intent,
    reviewStatus: rawExecution.reviewStatus,
    actionRisk: rawExecution.actionRisk,
    ...(action ? { action } : {}),
    ...(inputBindingTarget ? { inputBindingTarget } : {}),
    ...(assertion ? { assertion } : {}),
    ...(source && runId && stepId ? { provenance: { source, runId, stepId } } : {}),
  };
}

function normalizeTestStepDraft(step: unknown): TestStepDraft | undefined {
  const rawStep = asRecord(step);
  if (!rawStep) {
    return undefined;
  }
  const execution = normalizeTestStepExecution(rawStep.execution);
  const { execution: _execution, ...legacyStep } = rawStep;
  return {
    ...legacyStep,
    ...(execution ? { execution } : {}),
  } as TestStepDraft;
}

function normalizeStorageStateRef(value: unknown): StorageStateRef | undefined {
  const rawRef = asRecord(value);
  const id = normalizedNonEmptyString(rawRef?.id);
  const label = normalizedNonEmptyString(rawRef?.label);
  const createdAt = normalizedNonEmptyString(rawRef?.createdAt);
  const updatedAt = normalizedNonEmptyString(rawRef?.updatedAt);
  if (
    !id ||
    !label ||
    !createdAt ||
    !updatedAt ||
    Number.isNaN(Date.parse(createdAt)) ||
    Number.isNaN(Date.parse(updatedAt)) ||
    (rawRef?.availability !== 'available' && rawRef?.availability !== 'expired' && rawRef?.availability !== 'unknown')
  ) {
    return undefined;
  }
  const expiresAt = normalizedNonEmptyString(rawRef.expiresAt);
  if (expiresAt && Number.isNaN(Date.parse(expiresAt))) {
    return undefined;
  }
  return {
    id,
    label,
    createdAt,
    updatedAt,
    availability: rawRef.availability,
    ...(expiresAt ? { expiresAt } : {}),
  };
}

function normalizeProjectDraft(rawProject: ProjectDraft): ProjectDraft {
  const fallback = createEmptyProject(1);
  const storageStateRefs = Array.isArray(rawProject.storageStateRefs)
    ? Array.from(new Map(
      rawProject.storageStateRefs
        .map(normalizeStorageStateRef)
        .filter((reference): reference is StorageStateRef => Boolean(reference))
        .map((reference) => [reference.id, reference]),
    ).values())
    : [];
  const knownStorageStateIds = new Set(storageStateRefs.map((reference) => reference.id));
  const rawEnvironments = Array.isArray(rawProject.environments) && rawProject.environments.length
    ? rawProject.environments
    : fallback.environments;
  const environments = rawEnvironments.map((environment) => {
    const { storageStateId: rawStorageStateId, ...environmentWithoutStorageState } = environment;
    const storageStateId = normalizedNonEmptyString(rawStorageStateId);
    return {
      ...environmentWithoutStorageState,
      ...(storageStateId && knownStorageStateIds.has(storageStateId) ? { storageStateId } : {}),
    };
  });
  const groups = Array.isArray(rawProject.groups) && rawProject.groups.length
    ? rawProject.groups
    : fallback.groups;
  const environmentId = rawProject.selectedEnvironmentId || environments[0]?.id || '';
  const recordings = Array.isArray(rawProject.recordings)
    ? rawProject.recordings.map((recording) => ({
        ...recording,
        groupId: recording.groupId || groups[0]?.id || '',
        environmentId: recording.environmentId || environmentId,
        startUrl: recording.startUrl || rawProject.defaultUrl || fallback.defaultUrl,
        comparisonGoal:
          recording.comparisonGoal || '回放录制路径后，断言页面状态与基线一致。',
        visualDiffThreshold:
          typeof recording.visualDiffThreshold === 'number' && Number.isFinite(recording.visualDiffThreshold)
            ? Math.min(1, Math.max(0, recording.visualDiffThreshold))
            : 0,
        visualDiffMasks: normalizeVisualDiffMasks(recording.visualDiffMasks),
        tags: Array.isArray(recording.tags) ? recording.tags : [],
        prdPath: normalizePrdPathReference(recording.prdPath),
        steps: Array.isArray(recording.steps)
          ? recording.steps.map((step) => ({
              ...step,
              pageUrl: step.pageUrl,
              screenshotPath: step.screenshotPath,
              capturedAt: step.capturedAt,
              selector: step.selector,
              value: step.value,
            }))
          : [],
      }))
    : [];
  const documents = Array.isArray(rawProject.documents)
    ? rawProject.documents.map(normalizePrdDocument)
    : [];
  const credentialRefs = Array.isArray(rawProject.credentialRefs) ? rawProject.credentialRefs : [];
  const fixtures = Array.isArray(rawProject.fixtures)
    ? rawProject.fixtures
        .map((fixture) => normalizeFixtureAsset(
          fixture,
          new Set(environments.map((environment) => environment.id)),
          new Set(credentialRefs.map((credential) => credential.id)),
        ))
        .filter((fixture): fixture is FixtureAsset => Boolean(fixture))
    : [];
  const suites = Array.isArray(rawProject.suites)
    ? rawProject.suites
        .map(normalizeSuiteAsset)
        .filter((suite): suite is SuiteAsset => Boolean(suite))
    : [];
  const recordingsById = new Map(recordings.map((recording) => [recording.id, recording]));

  return {
    ...fallback,
    ...rawProject,
    selectedEnvironmentId: environmentId,
    environments,
    groups,
    credentialRefs,
    storageStateRefs,
    recordings,
    documents,
    fixtures,
    suites,
    prdCoverageTriage: prunePrdCoverageTriage(documents, rawProject.prdCoverageTriage),
    testCases: Array.isArray(rawProject.testCases)
      ? rawProject.testCases.map((testCase) => {
          const {
            sourceIntent: rawSourceIntent,
            intent: rawIntent,
            provenance: rawProvenance,
            schemaVersion: _schemaVersion,
            version: rawVersion,
            assetReferences: rawAssetReferences,
            ...legacyTestCase
          } = testCase;
          const sourceIntent = normalizedNonEmptyString(rawSourceIntent);
          const intent = normalizeTestCaseIntent(rawIntent);
          const prdPath = normalizePrdPathReference(testCase.prdPath);
          const steps = Array.isArray(testCase.steps)
            ? testCase.steps
                .map(normalizeTestStepDraft)
                .filter((step): step is TestStepDraft => Boolean(step))
            : [];
          const source = testCase.source || 'manual';
          const normalizedProvenance = normalizeTestCaseProvenance(rawProvenance);
          const provenance = normalizedProvenance.length
            ? normalizedProvenance
            : createLegacyTestCaseProvenance(source, prdPath, steps, recordingsById);
          return {
            ...legacyTestCase,
            schemaVersion: 2,
            version: normalizeTestCaseVersion(rawVersion),
            assetReferences: normalizeTestCaseAssetReferences(rawAssetReferences),
            groupId: testCase.groupId || groups[0]?.id || '',
            environmentId: testCase.environmentId || environmentId,
            source,
            ...(sourceIntent ? { sourceIntent } : {}),
            ...(intent ? { intent } : {}),
            ...(provenance.length ? { provenance } : {}),
            ...(prdPath ? { prdPath } : {}),
            steps,
          };
        })
      : fallback.testCases,
  };
}

function isNewerTerminalRun(
  candidate: { run: RunSummary; index: number },
  current: { run: RunSummary; index: number } | undefined,
): boolean {
  if (!current) {
    return true;
  }
  const candidateTime = candidate.run.startedAt ? Date.parse(candidate.run.startedAt) : Number.NaN;
  const currentTime = current.run.startedAt ? Date.parse(current.run.startedAt) : Number.NaN;
  if (Number.isFinite(candidateTime) && Number.isFinite(currentTime)) {
    return candidateTime > currentTime;
  }

  // Older state did not always have timestamps. Its persisted history order is
  // the only safe ordering signal, so never infer recency from IDs or titles.
  return candidate.index < current.index;
}

/**
 * Calculates project-level verification risk from the complete run history.
 * It is intentionally derived, so filters and UI selection cannot change it.
 */
export function deriveRunCoverageRisk(
  project: ProjectDraft,
  runHistory: RunSummary[],
): RunCoverageRiskSummary {
  const latestTerminalByScope = new Map<string, {
    run: RunSummary & { status: Exclude<RunStatus, 'running'> };
    index: number;
  }>();
  runHistory.forEach((run, index) => {
    if (run.projectId !== project.id || !run.testCaseId || !run.environmentId || !isTerminalRunStatus(run.status)) {
      return;
    }
    const key = `${run.testCaseId}::${run.environmentId}`;
    const current = latestTerminalByScope.get(key);
    const candidate = { run: run as RunSummary & { status: Exclude<RunStatus, 'running'> }, index };
    if (isNewerTerminalRun(candidate, current)) {
      latestTerminalByScope.set(key, candidate);
    }
  });

  let verified = 0;
  const risks: RunCoverageRisk[] = [];
  project.testCases.forEach((testCase) => {
    const latest = latestTerminalByScope.get(`${testCase.id}::${testCase.environmentId}`)?.run;
    if (latest?.status === 'passed') {
      verified += 1;
      return;
    }
    risks.push({
      testCaseId: testCase.id,
      groupId: testCase.groupId,
      environmentId: testCase.environmentId,
      status: latest ? latest.status : 'neverExecuted',
      ...(latest ? { latestRun: latest } : {}),
    });
  });

  return {
    total: project.testCases.length,
    verified,
    risks,
  };
}

/**
 * Creates a portable management report without exposing model configuration,
 * credentials, browser snapshots, artifact paths, or raw page evidence.
 */
export function deriveProjectRunReport(
  project: ProjectDraft,
  runHistory: RunSummary[],
  runDetails: RunDetail[],
  generatedAt = new Date().toISOString(),
): ProjectRunReport {
  const projectRuns = runHistory
    .map((run, index) => ({ run, index }))
    .filter(({ run }) => run.projectId === project.id);
  const runStats: Record<RunStatus, number> = {
    running: 0,
    passed: 0,
    failed: 0,
    blocked: 0,
    skipped: 0,
    cancelled: 0,
    error: 0,
  };
  projectRuns.forEach(({ run }) => {
    if (isRunStatus(run.status)) {
      runStats[run.status] += 1;
    }
  });

  const projectRunDetails = runDetails.filter((detail) => detail.projectId === project.id);
  const testCaseNames = new Map(project.testCases.map((testCase) => [testCase.id, testCase.name]));
  const environmentNames = new Map(project.environments.map((environment) => [environment.id, environment.name]));
  const groupNames = new Map(project.groups.map((group) => [group.id, group.name]));
  const problemRuns = projectRuns
    .filter(
      (entry): entry is { run: RunSummary & { status: RunFailureStatus }; index: number } =>
        isRunFailureStatus(entry.run.status),
    )
    .sort((left, right) => compareRunHistoryEntriesNewest(left, right))
    .slice(0, 20)
    .map(({ run }) => {
      const detail = findUnambiguousMatchingRunDetail(run, projectRunDetails);
      const artifactLabels = Array.from(new Set([
        ...(detail?.artifacts ?? []).map((artifact) => artifact.label),
        ...(detail?.agentRun?.artifacts ?? []).map((artifact) => artifact.label),
        ...(detail?.agentRuns ?? []).flatMap((agentRun) => agentRun.artifacts.map((artifact) => artifact.label)),
      ].filter(Boolean)));
      return {
        id: run.id,
        testCaseName: run.name,
        environmentName: detail?.provenance?.environment.name ?? run.environmentName ?? '',
        status: run.status,
        ...(run.startedAt ? { startedAt: run.startedAt } : {}),
        duration: run.duration,
        summary: run.summary,
        ...(detail?.failureReason ? { failureReason: detail.failureReason } : {}),
        artifactLabels,
      };
    });
  const nonExecutedRuns = projectRuns
    .filter(
      (entry): entry is { run: RunSummary & { status: RunNonExecutedStatus }; index: number } =>
        isRunNonExecutedStatus(entry.run.status),
    )
    .sort((left, right) => compareRunHistoryEntriesNewest(left, right))
    .slice(0, 20)
    .map(({ run }) => {
      const detail = findUnambiguousMatchingRunDetail(run, projectRunDetails);
      const artifactLabels = Array.from(new Set([
        ...(detail?.artifacts ?? []).map((artifact) => artifact.label),
        ...(detail?.agentRun?.artifacts ?? []).map((artifact) => artifact.label),
        ...(detail?.agentRuns ?? []).flatMap((agentRun) => agentRun.artifacts.map((artifact) => artifact.label)),
      ].filter(Boolean)));
      const reason = detail?.reason ?? run.reason;
      return {
        id: run.id,
        testCaseName: run.name,
        environmentName: detail?.provenance?.environment.name ?? run.environmentName ?? '',
        status: run.status,
        ...(run.startedAt ? { startedAt: run.startedAt } : {}),
        duration: run.duration,
        summary: run.summary,
        ...(reason ? { reason } : {}),
        artifactLabels,
      };
    });

  const targets: Record<PrdCoverageTarget, Record<PrdCoverageTriageStatus, number>> = {
    case: { pending: 0, deferred: 0, ignored: 0, resolved: 0 },
    recording: { pending: 0, deferred: 0, ignored: 0, resolved: 0 },
  };
  project.documents.forEach((document) => {
    document.generatedPaths.forEach((path) => {
      const caseCovered = project.testCases.some((testCase) => isTestCaseLinkedToGeneratedPath(testCase, document.id, path));
      const recordingCovered = project.recordings.some((recording) => isRecordingLinkedToGeneratedPath(recording, document.id, path));
      const caseDecision = project.prdCoverageTriage.find(
        (decision) => decision.documentId === document.id && decision.pathId === path.id && decision.target === 'case',
      );
      const recordingDecision = project.prdCoverageTriage.find(
        (decision) => decision.documentId === document.id && decision.pathId === path.id && decision.target === 'recording',
      );
      targets.case[getPrdCoverageTriageStatus(caseCovered, caseDecision)] += 1;
      targets.recording[getPrdCoverageTriageStatus(recordingCovered, recordingDecision)] += 1;
    });
  });
  const coverageRisk = deriveRunCoverageRisk(project, runHistory);

  return {
    generatedAt,
    projectName: project.name,
    runStats,
    coverageRisk: {
      total: coverageRisk.total,
      verified: coverageRisk.verified,
      risks: coverageRisk.risks.map((risk) => ({
        testCaseName: testCaseNames.get(risk.testCaseId) ?? risk.testCaseId,
        groupName: groupNames.get(risk.groupId) ?? risk.groupId,
        environmentName: environmentNames.get(risk.environmentId) ?? risk.environmentId,
        status: risk.status,
        ...(risk.latestRun && isRunProblemStatus(risk.latestRun.status)
          ? { latestStatus: risk.latestRun.status }
          : {}),
      })),
    },
    prdCoverage: {
      paths: project.documents.reduce((total, document) => total + document.generatedPaths.length, 0),
      targets,
    },
    problemRuns,
    nonExecutedRuns,
  };
}

function isRunStatus(value: unknown): value is RunStatus {
  return value === 'running' ||
    value === 'passed' ||
    value === 'failed' ||
    value === 'blocked' ||
    value === 'skipped' ||
    value === 'cancelled' ||
    value === 'error';
}

function isTerminalRunStatus(value: unknown): value is Exclude<RunStatus, 'running'> {
  return value === 'passed' ||
    value === 'failed' ||
    value === 'blocked' ||
    value === 'skipped' ||
    value === 'cancelled' ||
    value === 'error';
}

function isRunProblemStatus(value: unknown): value is RunProblemStatus {
  return value === 'failed' ||
    value === 'blocked' ||
    value === 'skipped' ||
    value === 'cancelled' ||
    value === 'error';
}

function isRunFailureStatus(value: unknown): value is RunFailureStatus {
  return value === 'failed' || value === 'error';
}

function isRunNonExecutedStatus(value: unknown): value is RunNonExecutedStatus {
  return value === 'blocked' || value === 'skipped' || value === 'cancelled';
}

function compareRunHistoryEntriesNewest(
  left: { run: RunSummary; index: number },
  right: { run: RunSummary; index: number },
): number {
  const leftTime = left.run.startedAt ? Date.parse(left.run.startedAt) : Number.NaN;
  const rightTime = right.run.startedAt ? Date.parse(right.run.startedAt) : Number.NaN;
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
    return rightTime - leftTime;
  }
  return left.index - right.index;
}

function normalizeVisualDiffMasks(rawMasks: unknown): VisualDiffMask[] {
  if (!Array.isArray(rawMasks)) {
    return [];
  }

  return rawMasks.flatMap((rawMask, index) => {
    if (!rawMask || typeof rawMask !== 'object') {
      return [];
    }

    const mask = rawMask as Partial<VisualDiffMask>;
    const values = [mask.x, mask.y, mask.width, mask.height];
    if (!values.every((value) => typeof value === 'number' && Number.isFinite(value))) {
      return [];
    }

    const x = Math.min(100, Math.max(0, mask.x!));
    const y = Math.min(100, Math.max(0, mask.y!));
    const width = Math.min(100 - x, Math.max(0, mask.width!));
    const height = Math.min(100 - y, Math.max(0, mask.height!));
    if (!width || !height) {
      return [];
    }

    return [{
      id: typeof mask.id === 'string' && mask.id ? mask.id : `visual-mask-${index + 1}`,
      label: typeof mask.label === 'string' && mask.label.trim() ? mask.label.trim() : `动态区域 ${index + 1}`,
      x,
      y,
      width,
      height,
    }];
  });
}

export function createEmptyWorkflow(
  nextId: number,
  kind: WorkflowKind = 'scenario',
): WorkflowDraft {
  return {
    id: `wf-${String(nextId).padStart(3, '0')}`,
    kind,
    name: `新的流程 ${nextId}`,
    category:
      kind === 'scenario' ? '端到端' : kind === 'assertion' ? '断言验证' : '数据提取',
    lastEdited: '刚刚',
    url: 'https://demo-app.local',
    notes: '在这里补充流程意图、上下文和环境要求。',
    steps: [createStep(kind === 'scenario' ? 'ai' : kind === 'assertion' ? 'aiAssert' : 'aiQuery', nextId)],
  };
}

export function createEmptyProject(nextId: number): ProjectDraft {
  const now = new Date().toISOString();
  const environmentId = `env-${Date.now()}`;
  return {
    id: `project-${Date.now()}`,
    name: `新的测试项目 ${nextId}`,
    description: '用于管理一个 Web 应用的测试环境、分组、用例和运行记录。',
    defaultUrl: 'https://your-app.example.com',
    selectedEnvironmentId: environmentId,
    createdAt: now,
    updatedAt: now,
    credentialRefs: [],
    storageStateRefs: [],
    recordings: [],
    documents: [],
    fixtures: [],
    suites: [],
    prdCoverageTriage: [],
    environments: [
      {
        id: environmentId,
        name: 'Staging',
        kind: 'staging',
        url: 'https://your-app.example.com',
        entryPath: '/',
        browser: 'chromium',
        viewport: 'desktop',
        locale: 'zh-CN',
        headless: true,
      },
    ],
    groups: [
      {
        id: `group-${Date.now()}`,
        name: '默认分组',
        description: '承接第一批自然语言、录制和手工编排用例。',
        createdAt: now,
      },
    ],
    testCases: [],
  };
}

export function createPrdDocumentAsset({
  name,
  kind,
  size,
  sourceText,
}: {
  name: string;
  kind: PrdDocumentKind;
  size: number;
  sourceText: string;
}): PrdDocumentAsset {
  const id = `doc-${Date.now()}`;
  const analysis = analyzePrdText(sourceText, name, id);
  return {
    id,
    name,
    kind,
    size,
    uploadedAt: new Date().toISOString(),
    status: analysis.generatedPaths.length ? 'analyzed' : 'draft',
    sourceText,
    summary: analysis.summary,
    coverageAreas: analysis.coverageAreas,
    generatedPaths: analysis.generatedPaths,
    analysisMetadata: {
      source: 'rule',
      analyzedAt: new Date().toISOString(),
    },
  };
}

export function updatePrdDocumentAnalysis(document: PrdDocumentAsset): PrdDocumentAsset {
  const analysis = analyzePrdText(document.sourceText, document.name, document.id);
  return {
    ...document,
    status: analysis.generatedPaths.length ? 'analyzed' : 'draft',
    summary: analysis.summary,
    coverageAreas: analysis.coverageAreas,
    generatedPaths: analysis.generatedPaths,
    analysisMetadata: {
      source: 'rule',
      analyzedAt: new Date().toISOString(),
    },
  };
}

export function createTestCaseFromGeneratedPath({
  path,
  documentId,
  groupId,
  environmentId,
  url,
  seed,
}: {
  path: GeneratedTestPath;
  documentId: string;
  groupId: string;
  environmentId: string;
  url: string;
  seed: number;
}): TestCaseDraft {
  const sourceIntent = path.sourceExcerpt?.trim() || path.rationale.trim() || path.title;
  const successCriteria = path.steps
    .filter((step) => step.type === 'aiAssert')
    .map((step) => step.body);
  return {
    schemaVersion: 2,
    version: 1,
    assetReferences: createEmptyTestCaseAssetReferences(),
    id: `case-prd-${Date.now()}-${seed}`,
    kind: 'scenario',
    groupId,
    environmentId,
    source: 'prd',
    sourceIntent,
    intent: createTestCaseIntent(path.sourceExcerpt?.trim() || path.title.trim() || 'PRD 测试路径', {
      preconditions: [],
      successCriteria,
    }),
    provenance: [{ kind: 'prdPath', documentId, pathId: path.id }],
    prdPath: {
      documentId,
      pathId: path.id,
    },
    name: path.title,
    category: path.groupName,
    lastEdited: '刚刚',
    url,
    notes: `${path.priority} · ${path.rationale}`,
    steps: path.steps.map((step, index) => ({
      ...step,
      id: `step-prd-${Date.now()}-${seed}-${index}`,
    })),
  };
}

function testStepTypeForAgentAction(action: AgentStep['action']): StepType {
  if (action === 'assert') {
    return 'aiAssert';
  }
  if (action === 'extract') {
    return 'aiQuery';
  }
  return 'ai';
}

const explicitSensitiveTestDataPattern = /((?:(?:\b(?:password|passwd|passcode|passphrase|pwd|pin|secret|token|cookie|authorization|bearer|api[-_ ]?key)\b)\s*(?:[:=]|with)\s*|(?:密码|口令|密钥|令牌|凭证)\s*(?:[:=]|是|为)\s*))([^\s,，;；。]+)/giu;
const bareSensitiveTestDataPattern = /((?:(?:\b(?:password|passwd|passcode|passphrase|pwd|pin|secret|token|cookie|authorization|bearer|api[-_ ]?key)\b)|(?:密码|口令|密钥|令牌|凭证))\s+)([^\s,，;；。]+)/giu;
const sensitiveTestDataSignalPattern = /(?:pass(?:word|wd|code|phrase)?|pwd|pin|secret|token|cookie|authorization|bearer|api[-_ ]?key|密码|口令|密钥|令牌|凭证)/iu;
const secretLikeValuePattern = /^(?:sk-[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|Bearer\s+\S+|[A-Za-z0-9+/_=-]{32,})$/u;
const bareSecretValueSignalPattern = /(?:\d|[_+\/=.-])/u;
const persistedTextUrlPattern = /\b(?:https?|ftp|file|about|data):[^\s'"\]\)>]+/giu;
const urlSchemePattern = /^([a-z][a-z0-9+.-]*):(.*)$/iu;
const hierarchicalUrlPattern = /^[a-z][a-z0-9+.-]*:\/\//iu;
const quotedSelectorAttributeValuePattern = /(\[[^\]\r\n=]+?=\s*)(["'])([^"'\r\n]*)(\2)/gu;

function isLikelyBareSecretValue(value: string): boolean {
  return secretLikeValuePattern.test(value) || bareSecretValueSignalPattern.test(value);
}

function redactPersistedUrlQuery(query: string): string {
  return query
    .split('&')
    .filter(Boolean)
    .map((parameter) => `${parameter.split('=', 1)[0]}=[已隐藏]`)
    .join('&');
}

function redactPersistedUrlSyntax(value: string): string {
  const fragmentIndex = value.indexOf('#');
  const withoutFragment = fragmentIndex >= 0 ? value.slice(0, fragmentIndex) : value;
  const queryIndex = withoutFragment.indexOf('?');
  const baseUrl = queryIndex >= 0 ? withoutFragment.slice(0, queryIndex) : withoutFragment;
  const query = queryIndex >= 0 ? withoutFragment.slice(queryIndex + 1) : '';
  const schemeIndex = baseUrl.indexOf('://');
  if (schemeIndex < 0) {
    return queryIndex >= 0 ? `${baseUrl}?${redactPersistedUrlQuery(query)}` : baseUrl;
  }
  const authorityStart = schemeIndex + 3;
  const pathIndex = baseUrl.indexOf('/', authorityStart);
  const authorityEnd = pathIndex >= 0 ? pathIndex : baseUrl.length;
  const userInfoIndex = baseUrl.lastIndexOf('@', authorityEnd - 1);
  const redactedBaseUrl = userInfoIndex >= authorityStart
    ? `${baseUrl.slice(0, authorityStart)}${baseUrl.slice(userInfoIndex + 1)}`
    : baseUrl;
  return queryIndex >= 0 ? `${redactedBaseUrl}?${redactPersistedUrlQuery(query)}` : redactedBaseUrl;
}

function redactPersistedTestUrl(value: string): string {
  const schemeMatch = urlSchemePattern.exec(value);
  if (!schemeMatch) {
    return value;
  }
  const [, scheme, opaquePath] = schemeMatch;
  if (!hierarchicalUrlPattern.test(value)) {
    if (scheme.toLocaleLowerCase() === 'about') {
      return `${scheme}:${opaquePath.split(/[?#]/, 1)[0]}`;
    }
    return `${scheme}:[已隐藏]`;
  }
  try {
    const parsedUrl = new URL(value);
    const query = redactPersistedUrlQuery(parsedUrl.search.slice(1));
    return `${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.pathname}${query ? `?${query}` : ''}`;
  } catch {
    return redactPersistedUrlSyntax(value);
  }
}

function redactPersistedTestUrls(value: string): string {
  return value.replace(persistedTextUrlPattern, redactPersistedTestUrl);
}

function redactPersistedKnownInputValues(value: string, unreviewedInputValues: readonly string[]): string {
  return Array.from(new Set(unreviewedInputValues))
    .filter(Boolean)
    .reduce((text, inputValue) => text.split(inputValue).join('[已隐藏]'), value);
}

function redactPersistedSensitiveTestText(value: string, unreviewedInputValues: readonly string[]): string {
  return redactPersistedKnownInputValues(value, unreviewedInputValues)
    .replace(explicitSensitiveTestDataPattern, '$1[已隐藏]')
    .replace(bareSensitiveTestDataPattern, (match, prefix: string, candidate: string) =>
      isLikelyBareSecretValue(candidate) ? `${prefix}[已隐藏]` : match,
    );
}

function redactPersistedTestText(value: string, unreviewedInputValues: readonly string[] = []): string {
  return redactPersistedSensitiveTestText(redactPersistedTestUrls(value), unreviewedInputValues);
}

function redactPersistedDirectTestUrl(value: string, unreviewedInputValues: readonly string[] = []): string {
  return redactPersistedSensitiveTestText(redactPersistedTestUrl(value), unreviewedInputValues);
}

function redactPersistedTestSelector(selector: string, unreviewedInputValues: readonly string[]): string {
  const inputsRedacted = redactPersistedKnownInputValues(selector, unreviewedInputValues);
  return inputsRedacted.replace(
    quotedSelectorAttributeValuePattern,
    (match, prefix: string, quote: string, attributeValue: string) => {
      const redactedValue = redactPersistedTestText(attributeValue);
      return redactedValue === attributeValue ? match : `${prefix}${quote}${redactedValue}${quote}`;
    },
  );
}

function hasUnreviewedAgentInputValue(step: AgentStep): boolean {
  return (step.action === 'input' || step.action === 'select') && typeof step.value === 'string';
}

function hasSensitiveTestInput(step: AgentStep): boolean {
  if (!hasUnreviewedAgentInputValue(step)) {
    return false;
  }
  const context = `${step.title}\n${step.instruction}\n${step.selector ?? ''}`;
  return sensitiveTestDataSignalPattern.test(context) || Boolean(step.value && secretLikeValuePattern.test(step.value));
}

function testStepBodyForAgentPlanStep(step: AgentStep, unreviewedInputValues: readonly string[]): string {
  let body: string;
  if (step.action === 'navigate' && step.url) {
    body = `打开 ${step.url}`;
  } else if (step.action === 'click' && step.selector) {
    body = `点击 ${step.selector}`;
  } else if (step.action === 'input' && step.selector && step.value !== undefined) {
    body = `在 ${step.selector} 中输入${hasSensitiveTestInput(step) ? '敏感值（已隐藏）' : '待确认的值'}`;
  } else if (step.action === 'select' && step.selector && step.value !== undefined) {
    body = `在 ${step.selector} 中选择${hasSensitiveTestInput(step) ? '敏感值（已隐藏）' : '待确认的值'}`;
  } else if (step.action === 'wait' && step.selector) {
    body = `等待 ${step.selector} 可见${step.timeoutMs ? ` ${Math.max(1, Math.ceil(step.timeoutMs / 1_000))} 秒` : ''}`;
  } else if (step.action === 'scroll' && step.selector) {
    body = `滚动到 ${step.selector}`;
  } else if (step.action === 'extract' && step.target) {
    body = `提取 ${step.target}`;
  } else if (step.action === 'assert' && step.expected) {
    body = step.instruction.trim() || `验证 ${step.expected}`;
  } else {
    body = step.instruction.trim();
  }
  return redactPersistedTestText(body, unreviewedInputValues);
}

function createTestLocatorFingerprint(selector: string): TestLocatorFingerprint {
  const normalizedSelector = selector.trim();
  const isPositionalSelector = normalizedSelector.includes(':nth-child(') || normalizedSelector.includes(':nth-of-type(');
  const hasStrongSemanticSignal = /\[(?:data-(?:test(?:id)?|qa)|aria-label|role)\b/i.test(normalizedSelector);
  const hasPublicSignal = normalizedSelector.startsWith('#') || normalizedSelector.includes('[data-') || normalizedSelector.includes('[name=');
  return {
    selector: normalizedSelector,
    quality: isPositionalSelector
      ? 'weak'
      : hasStrongSemanticSignal
        ? 'strong'
        : hasPublicSignal
          ? 'acceptable'
          : 'unresolved',
  };
}

function toPositiveTimeout(timeoutMs: number | undefined): number | undefined {
  return typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : undefined;
}

function toDeterministicTestAction(
  step: AgentStep,
  unreviewedInputValues: readonly string[],
): DeterministicTestAction | undefined {
  const selector = step.selector?.trim();
  const redactedSelector = selector ? redactPersistedTestSelector(selector, unreviewedInputValues) : undefined;
  const selectorCanBePersisted = selector === redactedSelector;
  const url = step.url?.trim();
  const timeoutMs = toPositiveTimeout(step.timeoutMs);

  if (step.action === 'navigate' && url) {
    return { kind: 'navigate', url: redactPersistedDirectTestUrl(url, unreviewedInputValues) };
  }
  if (step.action === 'click' && selector && selectorCanBePersisted) {
    return { kind: 'click', locator: createTestLocatorFingerprint(selector) };
  }
  if (step.action === 'wait' && selector && selectorCanBePersisted) {
    return {
      kind: 'waitForSelector',
      locator: createTestLocatorFingerprint(selector),
      ...(timeoutMs ? { timeoutMs } : {}),
    };
  }
  if (step.action === 'wait' && timeoutMs) {
    return { kind: 'waitForTimeout', timeoutMs };
  }
  if (step.action === 'scroll' && selector && selectorCanBePersisted) {
    return { kind: 'scrollTo', locator: createTestLocatorFingerprint(selector) };
  }
  return undefined;
}

function toInputBindingTarget(
  step: AgentStep,
  unreviewedInputValues: readonly string[],
): TestInputBindingTarget | undefined {
  if (step.action !== 'input' && step.action !== 'select') {
    return undefined;
  }
  const selector = step.selector?.trim();
  const redactedSelector = selector ? redactPersistedTestSelector(selector, unreviewedInputValues) : undefined;
  return selector && selector === redactedSelector
    ? { kind: step.action, locator: createTestLocatorFingerprint(selector) }
    : undefined;
}

function inferTestStepActionRisk(step: AgentStep): TestStepActionRisk {
  const intent = `${step.title} ${step.instruction}`.toLocaleLowerCase();
  if (/(提交|删除|支付|审批|发送|购买|submit|delete|pay|approve|send|purchase)/u.test(intent)) {
    return 'high';
  }
  if (step.action === 'click' || step.action === 'input' || step.action === 'select') {
    return 'medium';
  }
  return 'low';
}

function createTestStepFromAgentStep({
  step,
  id,
  runId,
  unreviewedInputValues,
}: {
  step: AgentStep;
  id: string;
  runId: string;
  unreviewedInputValues: readonly string[];
}): TestStepDraft {
  const inputValueDescription = hasSensitiveTestInput(step) ? '敏感值（已隐藏）' : '待确认的值';
  const rawIntent = hasUnreviewedAgentInputValue(step)
    ? `${step.action === 'select' ? '选择' : '输入'}${inputValueDescription}${step.selector?.trim() ? `到 ${step.selector.trim()}` : ''}`
    : step.instruction.trim() || step.title.trim() || step.action;
  const intent = redactPersistedTestText(rawIntent, unreviewedInputValues);
  const action = toDeterministicTestAction(step, unreviewedInputValues);
  const inputBindingTarget = toInputBindingTarget(step, unreviewedInputValues);
  return {
    id,
    type: testStepTypeForAgentAction(step.action),
    title: redactPersistedTestText(step.title.trim(), unreviewedInputValues) || '未命名步骤',
    body: testStepBodyForAgentPlanStep(step, unreviewedInputValues) || redactPersistedTestText(step.title.trim(), unreviewedInputValues),
    execution: {
      schemaVersion: 2,
      intent,
      reviewStatus: 'needsReview',
      actionRisk: inferTestStepActionRisk(step),
      ...(action ? { action } : {}),
      ...(inputBindingTarget ? { inputBindingTarget } : {}),
      provenance: {
        source: 'agentRun',
        runId,
        stepId: step.id,
      },
    },
  };
}

export function getTestStepModelRequirement(step: TestStepDraft): TestStepModelRequirement {
  if (step.type === 'manual' || step.type === 'recordingReplay') {
    return 'notApplicable';
  }
  if (getConfirmedDeterministicTestStep(step)) {
    return 'none';
  }
  if (getConfirmedExplicitTestAssertion(step)) {
    return 'none';
  }
  return 'required';
}

/**
 * Converts only a verified natural-language run into an editable test case.
 * Runtime-only preparation and verification meta steps have no source step
 * type and are excluded when the run carries source-step metadata. Legacy
 * runs retain their complete recorded plan for backward compatibility.
 */
export function createTestCaseFromAgentRun({
  agentRun,
  groupId,
  environmentId,
  url,
  seed,
}: {
  agentRun: AgentRunResult;
  groupId: string;
  environmentId: string;
  url: string;
  seed: number;
}): TestCaseDraft | undefined {
  if (agentRun.intent.source !== 'naturalLanguage' || agentRun.status !== 'passed') {
    return undefined;
  }

  const sourceSteps = agentRun.plan.steps.filter((step) => Boolean(step.sourceStepType));
  const planSteps = sourceSteps.length ? sourceSteps : agentRun.plan.steps;
  if (!planSteps.length) {
    return undefined;
  }

  const unreviewedInputValues = agentRun.plan.steps.flatMap((step) =>
    hasUnreviewedAgentInputValue(step) && typeof step.value === 'string' ? [step.value] : [],
  );
  const createdAt = Date.now();
  const sourceIntent = redactPersistedTestText(agentRun.intent.prompt.trim(), unreviewedInputValues);
  const name = redactPersistedTestText(agentRun.plan.title.trim(), unreviewedInputValues) || `自然语言测试 ${seed}`;
  return {
    schemaVersion: 2,
    version: 1,
    assetReferences: createEmptyTestCaseAssetReferences(),
    id: `case-nl-${createdAt}-${seed}`,
    kind: 'scenario',
    groupId,
    environmentId,
    source: 'naturalLanguage',
    sourceIntent,
    intent: createTestCaseIntent(sourceIntent || name),
    provenance: [
      { kind: 'agentRun', runId: agentRun.runId, stepIds: planSteps.map((step) => step.id) },
      ...(agentRun.intent.documentId ? [{ kind: 'prdDocument' as const, documentId: agentRun.intent.documentId }] : []),
    ],
    name,
    category: '自然语言',
    lastEdited: '刚刚',
    url: redactPersistedDirectTestUrl(agentRun.intent.targetUrl?.trim() || url, unreviewedInputValues),
    notes: [
      '由已通过的自然语言 Agent 运行生成，请在执行前审阅步骤和目标环境。',
      redactPersistedTestText(agentRun.plan.summary.trim(), unreviewedInputValues),
      ...(agentRun.plan.risks.length ? [`已记录风险：${redactPersistedTestText(agentRun.plan.risks.join('；'), unreviewedInputValues)}`] : []),
    ]
      .filter(Boolean)
      .join('\n'),
    steps: planSteps.map((step, index) =>
      createTestStepFromAgentStep({
        step,
        id: `step-nl-${createdAt}-${seed}-${index + 1}`,
        runId: agentRun.runId,
        unreviewedInputValues,
      }),
    ),
  };
}

export function createRecordingFromGeneratedPath({
  path,
  documentId,
  groupId,
  environmentId,
  startUrl,
  seed,
}: {
  path: GeneratedTestPath;
  documentId: string;
  groupId: string;
  environmentId: string;
  startUrl: string;
  seed: number;
}): RecordingAsset {
  const now = new Date().toISOString();
  return {
    id: `recording-prd-${Date.now()}-${seed}`,
    name: `${path.title} 回放草稿`,
    summary: `由 PRD 路径生成：${path.rationale}`,
    source: 'imported',
    groupId,
    environmentId,
    startUrl,
    comparisonGoal: `回放完成后验证：${path.rationale}`,
    tags: ['PRD', path.priority, path.groupName],
    prdPath: {
      documentId,
      pathId: path.id,
    },
    createdAt: now,
    updatedAt: now,
    steps: path.steps.map((step, index) => ({
      id: `recording-prd-step-${Date.now()}-${seed}-${index}`,
      kind: step.type === 'aiAssert' ? 'assert' : step.type === 'aiQuery' ? 'snapshot' : 'click',
      title: step.title,
      detail: step.body,
    })),
  };
}

export function createEmptyGroup(seed: number): ProjectGroup {
  return {
    id: `group-${Date.now()}-${seed}`,
    name: `业务分组 ${seed}`,
    description: '按模块、页面或核心流程组织测试用例。',
    createdAt: new Date().toISOString(),
  };
}

export function createRecordingStep(
  seed: number,
  kind: RecordingStepKind = 'click',
): RecordingStepDraft {
  const titleMap: Record<RecordingStepKind, string> = {
    navigate: '页面跳转',
    click: '点击控件',
    input: '输入内容',
    wait: '等待页面稳定',
    assert: '核对结果状态',
    snapshot: '捕获页面快照',
  };

  const detailMap: Record<RecordingStepKind, string> = {
    navigate: '打开目标页面并等待首屏内容可见。',
    click: '点击一个关键控件，观察页面状态变化。',
    input: '在输入区域填写有效值并提交。',
    wait: '等待异步请求、图表刷新或表格稳定。',
    assert: '检查当前页面状态是否与录制基线一致。',
    snapshot: '在关键节点捕获快照，供后续回放对比使用。',
  };

  return {
    id: `recording-step-${Date.now()}-${seed}`,
    kind,
    title: titleMap[kind],
    detail: detailMap[kind],
  };
}

export function createEmptyRecordingAsset({
  seed,
  source,
  groupId,
  environmentId,
  startUrl,
}: {
  seed: number;
  source: RecordingSource;
  groupId: string;
  environmentId: string;
  startUrl: string;
}): RecordingAsset {
  const now = new Date().toISOString();
  return {
    id: `recording-${Date.now()}-${seed}`,
    name: source === 'imported' ? `导入回放片段 ${seed}` : `录制片段 ${seed}`,
    summary:
      source === 'imported'
        ? '由外部回放资产导入，可在这里补充上下文、筛选条件和预期结果。'
        : '由项目内录制生成的回放草稿，用于承接真实操作路径与基线对比。',
    source,
    groupId,
    environmentId,
    startUrl,
    comparisonGoal: '回放结束后，断言页面视觉状态、图表数据或表格结果与预期一致。',
    tags: source === 'imported' ? ['导入资产', '待校准'] : ['录制资产', '待回放'],
    createdAt: now,
    updatedAt: now,
    steps:
      source === 'live'
        ? []
        : [
            createRecordingStep(seed, 'navigate'),
            createRecordingStep(seed + 1, 'click'),
            createRecordingStep(seed + 2, 'assert'),
          ],
  };
}

function formatRecordingReplayBody(recording: RecordingAsset): string {
  const kindLabel: Record<RecordingStepKind, string> = {
    navigate: '跳转',
    click: '点击',
    input: '输入',
    wait: '等待',
    assert: '核对',
    snapshot: '快照',
  };

  return [
    `按录制片段「${recording.name}」的时间线执行回放，并对比关键节点结果。`,
    `起始页面：${recording.startUrl}`,
    `对比目标：${recording.comparisonGoal}`,
    '',
    ...recording.steps.map(
      (step, index) =>
        `${index + 1}. [${kindLabel[step.kind]}] ${step.title} - ${step.detail}${step.pageUrl ? ` (URL: ${step.pageUrl})` : ''}${step.screenshotPath ? ` [截图已记录]` : ''}`,
    ),
  ].join('\n');
}

export function createTestCaseFromRecording({
  recording,
  seed,
}: {
  recording: RecordingAsset;
  seed: number;
}): TestCaseDraft {
  const businessGoal = recording.comparisonGoal.trim() || recording.summary.trim() || recording.name;
  return {
    schemaVersion: 2,
    version: 1,
    assetReferences: createEmptyTestCaseAssetReferences(),
    id: `case-recording-${Date.now()}-${seed}`,
    kind: 'recording',
    groupId: recording.groupId,
    environmentId: recording.environmentId,
    source: 'recording',
    sourceIntent: businessGoal,
    intent: createTestCaseIntent(businessGoal, {
      preconditions: [],
      successCriteria: recording.comparisonGoal.trim() ? [recording.comparisonGoal] : [],
    }),
    provenance: [
      { kind: 'recording', recordingId: recording.id, stepIds: recording.steps.map((step) => step.id) },
      ...(recording.prdPath ? [{ kind: 'prdPath' as const, ...recording.prdPath }] : []),
    ],
    name: `${recording.name} 回放校验`,
    category: '录制回放',
    lastEdited: '刚刚',
    url: recording.startUrl,
    notes: recording.summary,
    steps: [
      {
        id: `step-recording-${Date.now()}-${seed}-replay`,
        type: 'recordingReplay',
        title: '回放录制片段',
        body: formatRecordingReplayBody(recording),
        recordingId: recording.id,
      },
      {
        id: `step-recording-${Date.now()}-${seed}-assert`,
        type: 'aiAssert',
        title: '断言回放结果',
        body: recording.comparisonGoal,
      },
    ],
  };
}

export function findDefaultRecordingForCaseStep(
  recordings: RecordingAsset[],
  groupId: string,
  environmentId: string,
): RecordingAsset | undefined {
  return (
    recordings.find((recording) => recording.groupId === groupId && recording.environmentId === environmentId) ??
    recordings.find((recording) => recording.environmentId === environmentId) ??
    recordings.find((recording) => recording.groupId === groupId) ??
    recordings[0]
  );
}

export function detachRecordingFromTestCases(
  testCases: TestCaseDraft[],
  recordingId: string,
): { testCases: TestCaseDraft[]; affectedSteps: number } {
  let affectedSteps = 0;
  const nextTestCases = testCases.map((testCase) => ({
    ...testCase,
    steps: testCase.steps.map((step) => {
      if (step.type !== 'recordingReplay' || step.recordingId !== recordingId) {
        return step;
      }

      affectedSteps += 1;
      return {
        ...step,
        recordingId: undefined,
        body: '原绑定录制资产已删除，请重新选择录制资产后再执行回放。',
      };
    }),
  }));

  return { testCases: nextTestCases, affectedSteps };
}

export function createEmptyTestCase(
  seed: number,
  groupId: string,
  environmentId: string,
): TestCaseDraft {
  const name = `新的测试用例 ${seed}`;
  return {
    schemaVersion: 2,
    version: 1,
    assetReferences: createEmptyTestCaseAssetReferences(),
    id: `case-${Date.now()}-${seed}`,
    kind: 'scenario',
    groupId,
    environmentId,
    source: 'manual',
    intent: createTestCaseIntent(name),
    provenance: [],
    name,
    category: '核心链路',
    lastEdited: '刚刚',
    url: 'https://your-app.example.com',
    notes: '描述这个用例覆盖的业务意图、前置条件和关键断言。',
    steps: [createStep('ai', seed)],
  };
}

export function createStep(type: StepType, seed: number): WorkflowStepDraft {
  const titleMap: Record<StepType, string> = {
    ai: '自然语言动作',
    aiAssert: '自然语言断言',
    aiQuery: '自然语言提取',
  };

  return {
    id: `step-${Date.now()}-${seed}`,
    type,
    title: titleMap[type],
    body:
      type === 'ai'
        ? '描述页面动作，例如：点击主 CTA 并等待下一屏稳定。'
        : type === 'aiAssert'
          ? '描述你希望成立的页面状态。'
          : '描述你希望从页面提取的信息。',
  };
}

export function createTestStep(
  type: TestStepType,
  seed: number,
  recording?: Pick<RecordingAsset, 'id' | 'name' | 'steps'>,
): TestStepDraft {
  if (type === 'ai' || type === 'aiAssert' || type === 'aiQuery') {
    return createStep(type, seed);
  }

  return {
    id: `step-${Date.now()}-${seed}`,
    type,
    title: type === 'recordingReplay' ? '录制回放步骤' : '人工检查步骤',
    body:
      type === 'recordingReplay'
        ? recording
          ? `回放录制资产「${recording.name}」，共 ${recording.steps.length} 个节点。`
          : '选择一段录制资产并按顺序回放。'
        : '记录需要人工确认的状态。',
    ...(type === 'recordingReplay' && recording ? { recordingId: recording.id } : {}),
  };
}

export function createManualStepAutomationReplacement(step: TestStepDraft): TestStepDraft {
  if (step.type !== 'manual') {
    return step;
  }

  const instruction = step.body.trim();
  const body = !instruction
    ? ''
    : /^(?:验证|断言|确认|检查)/.test(instruction) || /^(?:verify|assert|confirm|check)\b/i.test(instruction)
      ? instruction
      : `验证：${instruction}`;

  return {
    ...step,
    type: 'aiAssert',
    body,
    recordingId: undefined,
  };
}

export function createReporterFixDraft(
  source: TestCaseDraft,
  reporter: Pick<AgentReporterSummary, 'failureAnalysis' | 'suggestedFixes' | 'recoveryPlan'>,
  seed: number,
): TestCaseDraft | undefined {
  const recoveryPlan = reporter.recoveryPlan;
  const failedStepIndex = recoveryPlan
    ? source.steps.findIndex((step) => step.id === recoveryPlan.failedStepId)
    : -1;
  if (!recoveryPlan || failedStepIndex < 0) {
    return undefined;
  }

  const seenFixes = new Set<string>();
  const suggestedFixes = reporter.suggestedFixes.flatMap((fix) => {
    const trimmed = fix.trim();
    const key = trimmed.replace(/\s+/g, ' ').toLocaleLowerCase();
    if (!trimmed || seenFixes.has(key)) {
      return [];
    }

    seenFixes.add(key);
    return [trimmed];
  }).slice(0, 5);
  const draftId = `case-reporter-${Date.now()}-${seed}`;
  const recoveryStep = createReporterRecoveryDraftStep(recoveryPlan, draftId);
  const notes = [
    source.notes.trim(),
    `基于 Reporter 失败归因：${reporter.failureAnalysis.trim()}`,
    `受控恢复来源：${formatReporterRecoveryPlan(recoveryPlan)}`,
    suggestedFixes.length
      ? `Reporter 原始建议（仅供人工审阅，不会自动转为浏览器动作）：\n${suggestedFixes.map((fix) => `- ${fix}`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n\n');

  const copiedSteps = source.steps.map((step, index) => ({
    ...step,
    id: `${draftId}-source-${index + 1}`,
  }));

  return {
    ...source,
    id: draftId,
    source: 'reporter',
    intent: source.intent ?? createTestCaseIntent(source.name.trim() || '测试修复草稿'),
    name: `${source.name} · 修复草稿`,
    lastEdited: '刚刚',
    notes,
    steps: insertTestStep(copiedSteps, recoveryStep, failedStepIndex),
  };
}

export function canCreateReporterFixDraft(
  source: TestCaseDraft | undefined,
  reporter: Pick<AgentReporterSummary, 'recoveryPlan'> | undefined,
): boolean {
  return Boolean(
    source
    && reporter?.recoveryPlan
    && source.steps.some((step) => step.id === reporter.recoveryPlan?.failedStepId),
  );
}

function createReporterRecoveryDraftStep(
  plan: AgentRecoveryPlan,
  draftId: string,
): TestStepDraft {
  const actionGuard = '不要点击、输入、选择或导航。';
  const content: Record<AgentRecoveryPlan['strategy'], { title: string; body: string }> = {
    waitForResponse: {
      title: '受控恢复：等待接口响应',
      body: `等待接口响应匹配「${plan.urlPattern}」后，再观察页面状态。${actionGuard}`,
    },
    waitForSelector: {
      title: '受控恢复：等待元素就绪',
      body: `等待 selector「${plan.selector}」可见且稳定后，再观察页面状态。${actionGuard}`,
    },
    waitForDataReady: {
      title: '受控恢复：等待数据就绪',
      body: `等待页面数据就绪后，再观察页面状态。${actionGuard}`,
    },
    waitForNetworkIdle: {
      title: '受控恢复：等待网络空闲',
      body: `等待页面网络空闲后，再观察页面状态。${actionGuard}`,
    },
    observe: {
      title: '受控恢复：观察页面状态',
      body: `观察当前页面状态并记录证据。${actionGuard}`,
    },
  };
  const recovery = content[plan.strategy];
  return {
    id: `${draftId}-recovery-${plan.failedStepId}`,
    type: 'ai',
    title: recovery.title,
    body: recovery.body,
  };
}

export function formatReporterRecoveryPlan(plan: AgentRecoveryPlan): string {
  const target = plan.urlPattern
    ? `接口 ${plan.urlPattern}`
    : plan.selector
      ? `selector ${plan.selector}`
      : '无可靠页面目标';
  return `${plan.strategy}（${target}）：${plan.reason}`;
}

export function insertTestStep(steps: TestStepDraft[], step: TestStepDraft, index: number): TestStepDraft[] {
  const insertionIndex = Math.max(0, Math.min(index, steps.length));
  return [...steps.slice(0, insertionIndex), step, ...steps.slice(insertionIndex)];
}

export function moveTestStep(steps: TestStepDraft[], stepId: string, index: number): TestStepDraft[] {
  const sourceIndex = steps.findIndex((step) => step.id === stepId);
  if (sourceIndex < 0) {
    return steps;
  }

  const nextSteps = [...steps];
  const [step] = nextSteps.splice(sourceIndex, 1);
  const requestedIndex = Math.max(0, Math.min(index, steps.length));
  const insertionIndex = sourceIndex < requestedIndex ? requestedIndex - 1 : requestedIndex;
  nextSteps.splice(insertionIndex, 0, step);
  return nextSteps;
}

export function copyTestStep(steps: TestStepDraft[], stepId: string, copyId: string): TestStepDraft[] {
  const sourceIndex = steps.findIndex((step) => step.id === stepId);
  if (sourceIndex < 0) {
    return steps;
  }

  return insertTestStep(steps, { ...steps[sourceIndex], id: copyId }, sourceIndex + 1);
}

export function removeTestStep(steps: TestStepDraft[], stepId: string): TestStepDraft[] {
  return steps.filter((step) => step.id !== stepId);
}

export function getTestCaseRunBlocker(
  testCase: TestCaseDraft,
  recordings: RecordingAsset[],
): TestCaseRunBlocker | undefined {
  if (!testCase.steps.length) {
    return 'emptySteps';
  }

  for (const step of testCase.steps) {
    const blocker = getTestStepRunBlocker(step, recordings);
    if (blocker) {
      return blocker;
    }
  }

  return undefined;
}

export function getTestStepRunBlocker(
  step: TestStepDraft,
  recordings: RecordingAsset[],
): TestStepRunBlocker | undefined {
  if (!step.title.trim()) {
    return 'emptyTitle';
  }

  if (step.type === 'recordingReplay') {
    return !step.recordingId || !recordings.some((recording) => recording.id === step.recordingId)
      ? 'missingRecording'
      : undefined;
  }

  return step.body.trim() ? undefined : 'emptyInstruction';
}

export function isTestCaseLinkedToGeneratedPath(
  testCase: TestCaseDraft,
  documentId: string,
  path: GeneratedTestPath,
): boolean {
  const prdPath = getTestCasePrdPath(testCase);
  if (prdPath) {
    return prdPath.documentId === documentId && prdPath.pathId === path.id;
  }

  return testCase.source === 'prd' && testCase.name === path.title;
}

export function isRecordingLinkedToGeneratedPath(
  recording: RecordingAsset,
  documentId: string,
  path: GeneratedTestPath,
): boolean {
  if (recording.prdPath) {
    return recording.prdPath.documentId === documentId && recording.prdPath.pathId === path.id;
  }

  return recording.tags.includes('PRD') && recording.name === `${path.title} 回放草稿`;
}

function normalizePrdDocument(rawDocument: PrdDocumentAsset): PrdDocumentAsset {
  return {
    ...rawDocument,
    status: rawDocument.status ?? 'draft',
    sourceText: rawDocument.sourceText ?? '',
    summary: rawDocument.summary ?? '尚未分析',
    coverageAreas: Array.isArray(rawDocument.coverageAreas) ? rawDocument.coverageAreas : [],
    generatedPaths: Array.isArray(rawDocument.generatedPaths)
      ? rawDocument.generatedPaths.map((path) => ({
          ...path,
          sourceExcerpt: typeof path.sourceExcerpt === 'string' ? path.sourceExcerpt : undefined,
        }))
      : [],
    analysisMetadata: rawDocument.analysisMetadata
      ? {
          source: rawDocument.analysisMetadata.source === 'model' ? 'model' : 'rule',
          analyzedAt: rawDocument.analysisMetadata.analyzedAt ?? rawDocument.uploadedAt,
          ...(typeof rawDocument.analysisMetadata.modelName === 'string' && rawDocument.analysisMetadata.modelName.trim()
            ? { modelName: rawDocument.analysisMetadata.modelName.trim() }
            : {}),
          ...(rawDocument.analysisMetadata.fallbackReason
            ? { fallbackReason: rawDocument.analysisMetadata.fallbackReason }
            : {}),
        }
      : {
          source: 'rule',
          analyzedAt: rawDocument.uploadedAt,
        },
  };
}

interface PrdRequirementClause {
  content: string;
  sourceExcerpt: string;
  section?: string;
}

const PRD_REQUIREMENT_LIMIT = 8;
const PRD_REQUIREMENT_SIGNAL = /支持|必须|应当|需要|默认|仅|不得|不能|禁止|校验|验证|展示|导出|新增|创建|编辑|修改|删除|保存|提交|筛选|过滤|查询|搜索|排序|分页|登录|退出|审批|审核|驳回|流转|上传|下载|选择|切换|允许|拒绝|返回|提示|显示|隐藏|点击|输入|打开|关闭|跳转|加载|刷新|can|must|should|shall|default|only|cannot|validate|display|show|export|create|edit|delete|save|submit|filter|search|sort|paginate|login|approve|upload|download|select|allow|deny|redirect|load|refresh/i;

function normalizePrdRequirement(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[\s`*_#>~，,。.!！？；;：:（）()\[\]{}「」『』“”"']/g, '');
}

function stripMarkdownPrefix(value: string): string {
  return value
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+[.)、]\s+/, '')
    .replace(/^>\s?/, '')
    .replace(/\*\*/g, '')
    .trim();
}

function splitPrdLine(value: string): string[] {
  return value
    .split(/(?<=[。！？；])\s*|(?<=[.!?;])\s+(?=[A-Z])/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toPrdSourceExcerpt(section: string | undefined, content: string): string {
  return section ? `${section} - ${content}` : content;
}

function extractPrdRequirementClauses(text: string): PrdRequirementClause[] {
  const seen = new Set<string>();
  const clauses: PrdRequirementClause[] = [];
  let section: string | undefined;

  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      section = stripMarkdownPrefix(headingMatch[1]!);
      continue;
    }

    const content = stripMarkdownPrefix(line);
    if (!content) {
      continue;
    }

    if (/^[^。！？!?；;]{2,40}[：:]$/.test(content)) {
      section = content.slice(0, -1).trim();
      continue;
    }

    for (const sentence of splitPrdLine(content)) {
      const candidate = sentence.replace(/^[\-–—]\s*/, '').replace(/[；;]\s*$/, '').trim();
      if (candidate.length < 6 || !PRD_REQUIREMENT_SIGNAL.test(candidate)) {
        continue;
      }

      const sourceExcerpt = toPrdSourceExcerpt(section, candidate);
      const key = normalizePrdRequirement(sourceExcerpt);
      if (!key || seen.has(key)) {
        continue;
      }

      seen.add(key);
      clauses.push({
        content: candidate,
        sourceExcerpt,
        section,
      });

      if (clauses.length >= PRD_REQUIREMENT_LIMIT) {
        return clauses;
      }
    }
  }

  return clauses;
}

function classifyPrdRequirementGroup(requirement: string, section?: string): string {
  const text = `${section ?? ''} ${requirement}`.toLocaleLowerCase();
  const has = (keywords: string[]) => keywords.some((keyword) => text.includes(keyword.toLocaleLowerCase()));

  if (has(['登录', '账号', '密码', '权限', '角色', '管理员', '普通成员', 'login', 'auth', 'permission', 'role', 'admin'])) {
    return '账号权限';
  }
  if (has(['图表', '趋势', '看板', 'dashboard', 'chart', '报表'])) {
    return '图表看板';
  }
  if (has(['表格', '列表', '排序', '分页', 'table', 'grid', 'sort', 'paginate'])) {
    return '表格列表';
  }
  if (has(['筛选', '过滤', '查询', '搜索', 'filter', 'search'])) {
    return '查询筛选';
  }
  if (has(['导出', '下载', 'excel', 'csv', 'download', 'export'])) {
    return '导出下载';
  }
  if (has(['审批', '审核', '流转', '驳回', 'approve', 'review', 'workflow'])) {
    return '流程状态';
  }
  if (has(['新增', '创建', '编辑', '修改', '删除', '保存', '提交', 'create', 'edit', 'delete', 'save', 'submit'])) {
    return '数据维护';
  }
  if (has(['告警', '异常', '错误', '提示', '校验', 'validation', 'alert', 'warning', 'error'])) {
    return '异常校验';
  }
  return section || 'PRD 需求';
}

function inferPrdRequirementPriority(requirement: string): GeneratedTestPath['priority'] {
  const text = requirement.toLocaleLowerCase();
  if (['必须', '不得', '不能', '禁止', '仅', '权限', '登录', '安全', '审批', 'must', 'shall', 'only', 'cannot', 'permission', 'security', 'approval'].some((keyword) => text.includes(keyword))) {
    return 'P0';
  }
  if (['异常', '错误', '失败', '无效', '边界', '取消', '空状态', '校验', 'error', 'invalid', 'edge', 'empty', 'cancel', 'validation'].some((keyword) => text.includes(keyword))) {
    return 'P2';
  }
  return 'P1';
}

function shortenPrdRequirement(requirement: string, maxLength = 36): string {
  const compact = requirement.replace(/\s+/g, ' ').trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength).trimEnd()}...` : compact;
}

function createRequirementTestPath(clause: PrdRequirementClause, index: number): Omit<GeneratedTestPath, 'id'> {
  const scope = clause.section || clause.content;
  return {
    title: clause.section
      ? `${clause.section}：${shortenPrdRequirement(clause.content)}`
      : shortenPrdRequirement(clause.content),
    priority: inferPrdRequirementPriority(clause.content),
    groupName: classifyPrdRequirementGroup(clause.content, clause.section),
    rationale: `根据 PRD 原文“${clause.sourceExcerpt}”生成，可在写入用例前补充页面入口和测试数据。`,
    sourceExcerpt: clause.sourceExcerpt,
    steps: [
      {
        id: `draft-requirement-${index}-open`,
        type: 'ai',
        title: '进入对应功能页面',
        body: `进入“${scope}”相关页面，准备需求所需的角色、数据和前置状态。`,
      },
      {
        id: `draft-requirement-${index}-action`,
        type: 'ai',
        title: '执行需求操作',
        body: `按 PRD 要求执行：${clause.content}`,
      },
      {
        id: `draft-requirement-${index}-assert`,
        type: 'aiAssert',
        title: '断言需求结果',
        body: `断言页面结果满足 PRD 原文：${clause.content}`,
      },
    ],
  };
}

function createStablePrdPathId(documentId: string, path: Omit<GeneratedTestPath, 'id'>): string {
  const source = `${documentId}:${normalizePrdRequirement(path.sourceExcerpt ?? path.title)}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `path-${(hash >>> 0).toString(36)}`;
}

function analyzePrdText(sourceText: string, documentName: string, documentId: string) {
  const text = sourceText.trim();
  if (!text || text.length < 20) {
    return {
      summary: '文档内容不足。请粘贴 PRD 关键需求，或上传可读取的文本/Markdown 文件。',
      coverageAreas: [],
      generatedPaths: [],
    };
  }

  const lower = text.toLowerCase();
  const has = (keywords: string[]) => keywords.some((keyword) => lower.includes(keyword.toLowerCase()));
  const generatedPaths: GeneratedTestPath[] = [];
  const coverageAreas: string[] = [];
  const addPath = (path: Omit<GeneratedTestPath, 'id'>) => {
    generatedPaths.push({
      ...path,
      id: createStablePrdPathId(documentId, path),
    });
    coverageAreas.push(path.groupName);
  };

  const requirementClauses = extractPrdRequirementClauses(text);
  for (const [index, clause] of requirementClauses.entries()) {
    addPath(createRequirementTestPath(clause, index + 1));
  }

  if (generatedPaths.length) {
    return {
      summary: `已从 PRD 提取 ${generatedPaths.length} 条可追溯需求，并生成对应测试路径，覆盖 ${Array.from(new Set(coverageAreas)).join('、')}。`,
      coverageAreas: Array.from(new Set(coverageAreas)),
      generatedPaths,
    };
  }

  if (has(['登录', '账号', '密码', '权限', 'login', 'auth'])) {
    addPath({
      title: '登录与权限前置校验',
      priority: 'P0',
      groupName: '账号权限',
      rationale: 'PRD 涉及账号、登录或权限，自动生成进入业务页面前的前置链路。',
      steps: [
        {
          id: 'draft-login-open',
          type: 'ai',
          title: '打开登录入口',
          body: '打开应用登录页，输入项目环境配置中的测试账号和密码并提交。',
        },
        {
          id: 'draft-login-assert',
          type: 'aiAssert',
          title: '验证登录成功',
          body: '断言页面进入工作台或目标业务页面，并且没有出现登录错误提示。',
        },
      ],
    });
  }

  if (has(['图表', '趋势', '看板', 'dashboard', 'chart', '报表'])) {
    addPath({
      title: '图表看板核心展示校验',
      priority: 'P0',
      groupName: '图表看板',
      rationale: '目标系统以图表展示为主，需要校验图表加载、筛选联动和关键指标。',
      steps: [
        {
          id: 'draft-chart-open',
          type: 'ai',
          title: '进入图表页面',
          body: '打开 PRD 描述的图表或看板页面，等待主要图表区域稳定。',
        },
        {
          id: 'draft-chart-assert',
          type: 'aiAssert',
          title: '断言图表可见',
          body: '断言页面至少展示一个主要图表，坐标轴、图例或指标卡片不是空状态。',
        },
        {
          id: 'draft-chart-query',
          type: 'aiQuery',
          title: '提取关键指标',
          body: '提取首屏核心指标名称和当前数值，保存为 chartMetricSnapshot。',
        },
      ],
    });
  }

  if (has(['表格', '列表', '排序', '分页', 'table', 'grid'])) {
    addPath({
      title: '表格列表筛选与排序校验',
      priority: 'P0',
      groupName: '表格列表',
      rationale: 'PRD 涉及表格/列表操作，需要覆盖数据加载、排序、分页和空状态。',
      steps: [
        {
          id: 'draft-table-open',
          type: 'ai',
          title: '进入列表页面',
          body: '打开目标列表或表格页面，等待表格数据加载完成。',
        },
        {
          id: 'draft-table-assert',
          type: 'aiAssert',
          title: '断言表格结构',
          body: '断言表格存在表头和至少一行数据，或在无数据时展示明确空状态。',
        },
        {
          id: 'draft-table-sort',
          type: 'ai',
          title: '触发排序或分页',
          body: '点击一个可排序列或分页控件，等待表格内容刷新。',
        },
      ],
    });
  }

  if (has(['筛选', '过滤', '查询', '搜索', 'filter', 'search'])) {
    addPath({
      title: '搜索筛选条件联动校验',
      priority: 'P1',
      groupName: '查询筛选',
      rationale: 'PRD 提到查询/筛选能力，需要验证条件输入、结果刷新和清空条件。',
      steps: [
        {
          id: 'draft-filter-input',
          type: 'ai',
          title: '输入筛选条件',
          body: '在筛选区域输入一个有效查询条件并提交搜索。',
        },
        {
          id: 'draft-filter-assert',
          type: 'aiAssert',
          title: '断言筛选生效',
          body: '断言结果区域刷新，并且列表或图表内容与筛选条件相关。',
        },
        {
          id: 'draft-filter-reset',
          type: 'ai',
          title: '清空筛选条件',
          body: '点击重置或清空条件，等待页面恢复默认查询状态。',
        },
      ],
    });
  }

  if (has(['导出', '下载', 'excel', 'csv', 'download', 'export'])) {
    addPath({
      title: '数据导出入口校验',
      priority: 'P1',
      groupName: '导出下载',
      rationale: 'PRD 涉及导出/下载，需要确认按钮状态、权限和触发反馈。',
      steps: [
        {
          id: 'draft-export-open',
          type: 'ai',
          title: '定位导出入口',
          body: '在当前列表或报表页面找到导出、下载或 Excel 按钮。',
        },
        {
          id: 'draft-export-assert',
          type: 'aiAssert',
          title: '断言导出可用',
          body: '断言导出入口可点击，或在无权限时展示明确禁用/提示状态。',
        },
      ],
    });
  }

  if (has(['新增', '创建', '编辑', '修改', '删除', '保存', '提交', 'create', 'edit', 'delete', 'save', 'submit'])) {
    addPath({
      title: '数据维护增删改校验',
      priority: 'P1',
      groupName: '数据维护',
      rationale: 'PRD 涉及新增、编辑、删除或保存提交，需要覆盖表单输入、校验反馈和数据变更结果。',
      steps: [
        {
          id: 'draft-crud-open',
          type: 'ai',
          title: '进入维护页面',
          body: '打开 PRD 对应的数据维护页面，等待表单、列表或操作按钮可用。',
        },
        {
          id: 'draft-crud-action',
          type: 'ai',
          title: '执行数据变更',
          body: '按 PRD 描述完成新增、编辑、删除或保存提交操作，并观察页面反馈。',
        },
        {
          id: 'draft-crud-assert',
          type: 'aiAssert',
          title: '断言变更结果',
          body: '断言页面出现成功提示，列表或详情数据与刚才的操作结果一致。',
        },
      ],
    });
  }

  if (has(['审批', '审核', '流转', '状态', '驳回', 'approve', 'review', 'workflow', 'status'])) {
    addPath({
      title: '流程状态流转校验',
      priority: 'P1',
      groupName: '流程状态',
      rationale: 'PRD 涉及审批或状态流转，需要验证角色动作、状态变化和异常分支。',
      steps: [
        {
          id: 'draft-status-open',
          type: 'ai',
          title: '进入流程详情',
          body: '打开一个满足前置条件的流程或审批详情页面。',
        },
        {
          id: 'draft-status-action',
          type: 'ai',
          title: '执行流转动作',
          body: '点击审批、驳回、提交或流转按钮，填写必要意见并提交。',
        },
        {
          id: 'draft-status-assert',
          type: 'aiAssert',
          title: '验证状态变化',
          body: '断言流程状态、操作按钮和提示信息符合 PRD 对该节点的预期。',
        },
      ],
    });
  }

  if (has(['告警', '异常', '错误', '提示', '校验', 'alert', 'warning', 'error', 'validation'])) {
    addPath({
      title: '异常提示与校验校验',
      priority: 'P2',
      groupName: '异常校验',
      rationale: 'PRD 提到异常、告警或输入校验，需要覆盖无效输入、边界状态和提示文案。',
      steps: [
        {
          id: 'draft-validation-input',
          type: 'ai',
          title: '构造异常输入',
          body: '在目标页面输入无效、缺失或边界条件数据并触发提交或查询。',
        },
        {
          id: 'draft-validation-assert',
          type: 'aiAssert',
          title: '断言错误提示',
          body: '断言页面展示明确错误提示、告警或禁用状态，且不会产生错误数据。',
        },
      ],
    });
  }

  if (!generatedPaths.length) {
    addPath({
      title: `${documentName.replace(/\.[^.]+$/, '')} 需求主路径`,
      priority: 'P1',
      groupName: 'PRD 主路径',
      rationale: '未识别到特定控件关键词，先生成覆盖页面进入、主操作和结果断言的通用路径。',
      steps: [
        {
          id: 'draft-generic-open',
          type: 'ai',
          title: '进入需求页面',
          body: '打开 PRD 对应的业务页面，等待页面主要内容稳定。',
        },
        {
          id: 'draft-generic-action',
          type: 'ai',
          title: '执行主操作',
          body: '按照 PRD 描述完成该页面的主要用户操作。',
        },
        {
          id: 'draft-generic-assert',
          type: 'aiAssert',
          title: '验证操作结果',
          body: '断言页面展示符合 PRD 预期的成功状态、数据变化或提示文案。',
        },
      ],
    });
  }

  return {
    summary: `已从文档中生成 ${generatedPaths.length} 条测试路径，覆盖 ${Array.from(new Set(coverageAreas)).join('、')}。`,
    coverageAreas: Array.from(new Set(coverageAreas)),
    generatedPaths,
  };
}
