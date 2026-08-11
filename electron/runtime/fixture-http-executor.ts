import type {
  FixtureAsset,
  FixtureHttpJsonValue,
  FixtureLifecycleEvidence,
  FixtureScriptTrustRecord,
  FixtureScriptLifecycle,
  ProjectEnvironment,
} from '../../shared/studio.js';
import { normalizeFixtureHttpDeclaration, normalizeFixtureHttpJsonValue } from '../../shared/studio.js';

const FIXTURE_HTTP_TIMEOUT_MS = 10_000;
const FIXTURE_HTTP_RESPONSE_BODY_LIMIT = 32_768;
const FIXTURE_HTTP_OUTPUT_VALUE_LIMIT = 8_192;

export interface FixtureLifecycleExecutionRequest {
  fixture: FixtureAsset;
  lifecycle: FixtureScriptLifecycle;
  environment: ProjectEnvironment;
  cancellationSignal?: AbortSignal;
  /** Main-process-only identity for a trusted script lifecycle. */
  projectId?: string;
  projectDirectory?: string;
  scriptTrustRecords?: FixtureScriptTrustRecord[];
}

export interface FixtureLifecycleExecutionResult {
  evidence: FixtureLifecycleEvidence;
  message: string;
  /** Main-process-only response values. Never persist or forward this object. */
  outputValues?: Readonly<Record<string, FixtureHttpJsonValue>>;
}

export interface FixtureLifecycleExecutor {
  execute(request: FixtureLifecycleExecutionRequest): Promise<FixtureLifecycleExecutionResult>;
  supports?(mode: 'http' | 'script'): boolean;
}

export interface FixtureHttpExecutorOptions {
  fetch?: typeof fetch;
}

/**
 * Executes only the small, non-secret HTTP fixture contract. This class does
 * not expose a way to add headers, credentials, cookie jars, absolute URLs, or
 * response-body persistence. A bounded response is parsed only when an exact
 * setup output mapping was declared, and the result stays in this process.
 */
export class FixtureHttpExecutor implements FixtureLifecycleExecutor {
  private readonly fetchImplementation: typeof fetch;

  constructor(options: FixtureHttpExecutorOptions = {}) {
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
  }

  supports(mode: 'http' | 'script'): boolean {
    return mode === 'http';
  }

  async execute(request: FixtureLifecycleExecutionRequest): Promise<FixtureLifecycleExecutionResult> {
    const declaration = request.lifecycle === 'setup' ? request.fixture.setup : request.fixture.cleanup;
    const http = declaration?.mode === 'http' ? normalizeFixtureHttpDeclaration(declaration.http) : undefined;
    if (!http) {
      return this.result(request, { method: 'POST', path: '/', expectedStatuses: [] }, 'neutral', undefined, 0, 'Fixture HTTP lifecycle is not configured.');
    }

    const target = resolveFixtureHttpTarget(request.environment, http.path);
    if (!target) {
      return this.result(request, http, 'failed', undefined, 0, 'Fixture HTTP target is not a valid same-origin environment API path.');
    }
    if (request.cancellationSignal?.aborted) {
      return this.result(request, http, 'neutral', undefined, 0, 'Fixture HTTP lifecycle was cancelled before the request started.');
    }

    const startedAt = Date.now();
    const controller = new AbortController();
    let timedOut = false;
    const abortFromRequest = () => controller.abort();
    request.cancellationSignal?.addEventListener('abort', abortFromRequest, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, FIXTURE_HTTP_TIMEOUT_MS);

    try {
      const response = await this.fetchImplementation(target.toString(), {
        method: http.method,
        ...(http.body === undefined ? {} : { body: JSON.stringify(http.body) }),
        credentials: 'omit',
        signal: controller.signal,
      });
      const durationMs = Date.now() - startedAt;
      if (http.expectedStatuses.includes(response.status)) {
        if (request.lifecycle === 'setup' && http.responseOutputs?.length) {
          const outputValues = await readFixtureHttpResponseOutputs(request.fixture, http.responseOutputs, response);
          if (!outputValues) {
            return this.result(
              request,
              http,
              'failed',
              response.status,
              durationMs,
              'Fixture HTTP response did not satisfy the declared output contract.',
            );
          }
          return {
            ...this.result(request, http, 'passed', response.status, durationMs, 'Fixture HTTP setup completed.'),
            outputValues,
          };
        }
        return this.result(request, http, 'passed', response.status, durationMs, `Fixture HTTP ${request.lifecycle} completed.`);
      }
      return this.result(request, http, 'failed', response.status, durationMs, 'Fixture HTTP response status did not match the declared expected statuses.');
    } catch {
      const durationMs = Date.now() - startedAt;
      if (request.cancellationSignal?.aborted) {
        return this.result(request, http, 'neutral', undefined, durationMs, 'Fixture HTTP lifecycle was cancelled.');
      }
      if (timedOut) {
        return this.result(request, http, 'failed', undefined, durationMs, 'Fixture HTTP request timed out.');
      }
      return this.result(request, http, 'failed', undefined, durationMs, 'Fixture HTTP request failed.');
    } finally {
      clearTimeout(timeout);
      request.cancellationSignal?.removeEventListener('abort', abortFromRequest);
    }
  }

  private result(
    request: FixtureLifecycleExecutionRequest,
    http: { method: FixtureLifecycleEvidence['method']; path: string; expectedStatuses: number[] },
    outcome: FixtureLifecycleEvidence['outcome'],
    httpStatus: number | undefined,
    durationMs: number,
    message: string,
  ): FixtureLifecycleExecutionResult {
    return {
      evidence: {
        fixtureId: request.fixture.id,
        fixtureVersion: request.fixture.version,
        lifecycle: request.lifecycle,
        mode: 'http',
        method: http.method,
        path: http.path,
        expectedStatuses: http.expectedStatuses,
        outcome,
        ...(httpStatus === undefined ? {} : { httpStatus }),
        durationMs,
      },
      message,
    };
  }
}

/** Extracts declared top-level response values without retaining the source body. */
export function extractFixtureHttpResponseOutputs(
  fixture: Pick<FixtureAsset, 'outputs'>,
  mappings: NonNullable<ReturnType<typeof normalizeFixtureHttpDeclaration>>['responseOutputs'],
  responseBody: unknown,
): Record<string, FixtureHttpJsonValue> | undefined {
  if (!mappings?.length || !responseBody || typeof responseBody !== 'object' || Array.isArray(responseBody)) {
    return undefined;
  }
  const record = responseBody as Record<string, unknown>;
  const outputValues: Record<string, FixtureHttpJsonValue> = {};
  for (const mapping of mappings) {
    const output = fixture.outputs.find((candidate) => candidate.name === mapping.outputName);
    const value = record[mapping.jsonPointer.slice(1)];
    if (!output || value === undefined || !isCompatibleFixtureOutputValue(value, output.type)) {
      return undefined;
    }
    outputValues[output.name] = value as FixtureHttpJsonValue;
  }
  return outputValues;
}

async function readFixtureHttpResponseOutputs(
  fixture: FixtureAsset,
  mappings: NonNullable<ReturnType<typeof normalizeFixtureHttpDeclaration>>['responseOutputs'],
  response: Response,
): Promise<Record<string, FixtureHttpJsonValue> | undefined> {
  const contentLength = response.headers.get('content-length');
  if (contentLength && (!/^\d+$/u.test(contentLength) || Number(contentLength) > FIXTURE_HTTP_RESPONSE_BODY_LIMIT)) {
    return undefined;
  }
  try {
    const bodyText = await response.text();
    if (!bodyText || new TextEncoder().encode(bodyText).byteLength > FIXTURE_HTTP_RESPONSE_BODY_LIMIT) {
      return undefined;
    }
    return extractFixtureHttpResponseOutputs(fixture, mappings, JSON.parse(bodyText));
  } catch {
    return undefined;
  }
}

function isCompatibleFixtureOutputValue(value: unknown, type: FixtureAsset['outputs'][number]['type']): boolean {
  if (type === 'string') {
    return typeof value === 'string' && new TextEncoder().encode(value).byteLength <= FIXTURE_HTTP_OUTPUT_VALUE_LIMIT;
  }
  if (type === 'number') {
    return typeof value === 'number' && Number.isFinite(value);
  }
  if (type === 'boolean') {
    return typeof value === 'boolean';
  }
  const normalized = normalizeFixtureHttpJsonValue(value);
  return normalized !== undefined && JSON.stringify(normalized).length <= FIXTURE_HTTP_OUTPUT_VALUE_LIMIT;
}

export function resolveFixtureHttpTarget(environment: Pick<ProjectEnvironment, 'url'>, path: string): URL | undefined {
  try {
    const root = new URL(environment.url);
    if (root.protocol !== 'http:' && root.protocol !== 'https:') {
      return undefined;
    }
    const target = new URL(path, root.origin);
    return target.origin === root.origin && target.pathname === path && !target.search && !target.hash ? target : undefined;
  } catch {
    return undefined;
  }
}
