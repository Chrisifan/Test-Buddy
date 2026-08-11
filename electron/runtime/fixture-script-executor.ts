import { createHash } from 'node:crypto';
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import type {
  FixtureAsset,
  FixtureHttpJsonValue,
  FixtureLifecycleEvidence,
  FixtureParameter,
} from '../../shared/studio.js';
import { isFixtureScriptTrusted, normalizeFixtureHttpJsonValue } from '../../shared/studio.js';
import type {
  FixtureLifecycleExecutionRequest,
  FixtureLifecycleExecutionResult,
  FixtureLifecycleExecutor,
} from './fixture-http-executor.js';

const FIXTURE_SCRIPT_TIMEOUT_MS = 10_000;
const FIXTURE_SCRIPT_FILE_LIMIT = 32_768;
const FIXTURE_SCRIPT_STDIO_LIMIT = 8_192;
const FIXTURE_SCRIPT_OUTPUT_LIMIT = 8_192;

export interface FixtureScriptExecutorOptions {
  executablePath?: string;
  spawn?: typeof nodeSpawn;
  fileSystem?: Pick<typeof fs, 'lstat' | 'readFile' | 'realpath'>;
  timeoutMs?: number;
}

/**
 * Runs only an explicitly trusted, self-contained script from the bound
 * project directory. Script stdout is a single bounded JSON result; no script
 * text, stdout, stderr, request context, or resolved outputs become evidence.
 */
export class FixtureScriptExecutor implements FixtureLifecycleExecutor {
  private readonly executablePath: string;
  private readonly spawnImplementation: typeof nodeSpawn;
  private readonly fileSystem: Pick<typeof fs, 'lstat' | 'readFile' | 'realpath'>;
  private readonly timeoutMs: number;

  constructor(options: FixtureScriptExecutorOptions = {}) {
    this.executablePath = options.executablePath ?? process.execPath;
    this.spawnImplementation = options.spawn ?? nodeSpawn;
    this.fileSystem = options.fileSystem ?? fs;
    this.timeoutMs = options.timeoutMs ?? FIXTURE_SCRIPT_TIMEOUT_MS;
  }

  supports(mode: 'http' | 'script'): boolean {
    return mode === 'script';
  }

  async execute(request: FixtureLifecycleExecutionRequest): Promise<FixtureLifecycleExecutionResult> {
    const declaration = request.lifecycle === 'setup' ? request.fixture.setup : request.fixture.cleanup;
    const script = declaration?.mode === 'script' ? declaration.script : undefined;
    if (!script) {
      return this.result(request, 'neutral', 0, 'Fixture script lifecycle is not configured.');
    }
    if (
      !request.projectId ||
      !request.projectDirectory ||
      !isFixtureScriptTrusted(request.fixture, request.lifecycle, {
        projectId: request.projectId,
        projectDirectory: request.projectDirectory,
        records: request.scriptTrustRecords,
      })
    ) {
      return this.result(request, 'neutral', 0, 'Fixture script trust is not available for this run.');
    }
    if (request.cancellationSignal?.aborted) {
      return this.result(request, 'neutral', 0, 'Fixture script lifecycle was cancelled before execution.');
    }

    const validated = await this.validateScript(request.projectDirectory, script.relativePath, script.contentHash);
    if (!validated) {
      return this.result(request, 'failed', 0, 'Fixture script file did not satisfy the trusted content contract.');
    }

    const startedAt = Date.now();
    try {
      const stdout = await this.runScript(validated.rootDirectory, validated.scriptPath, request);
      const outputValues = normalizeScriptFixtureOutputs(request.fixture.outputs, stdout);
      if (!outputValues) {
        return this.result(request, 'failed', Date.now() - startedAt, 'Fixture script result did not satisfy the declared output contract.');
      }
      return {
        ...this.result(request, 'passed', Date.now() - startedAt, `Fixture script ${request.lifecycle} completed.`),
        ...(Object.keys(outputValues).length ? { outputValues } : {}),
      };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      if (request.cancellationSignal?.aborted || error instanceof FixtureScriptCancelledError) {
        return this.result(request, 'neutral', durationMs, 'Fixture script lifecycle was cancelled.');
      }
      if (error instanceof FixtureScriptTimeoutError) {
        return this.result(request, 'failed', durationMs, 'Fixture script execution timed out.');
      }
      return this.result(request, 'failed', durationMs, 'Fixture script execution failed.');
    }
  }

  private async validateScript(
    projectDirectory: string,
    relativePath: string,
    expectedHash: string,
  ): Promise<{ rootDirectory: string; scriptPath: string } | undefined> {
    try {
      const rootDirectory = await this.fileSystem.realpath(projectDirectory);
      const requestedScriptPath = path.resolve(rootDirectory, relativePath);
      const relativeToRoot = path.relative(rootDirectory, requestedScriptPath);
      if (
        !relativeToRoot ||
        relativeToRoot.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativeToRoot) ||
        path.extname(requestedScriptPath) !== '.mjs'
      ) {
        return undefined;
      }
      const requestedStats = await this.fileSystem.lstat(requestedScriptPath);
      if (!requestedStats.isFile() || requestedStats.isSymbolicLink() || requestedStats.size > FIXTURE_SCRIPT_FILE_LIMIT) {
        return undefined;
      }
      const scriptPath = await this.fileSystem.realpath(requestedScriptPath);
      const canonicalRelativeToRoot = path.relative(rootDirectory, scriptPath);
      if (
        !canonicalRelativeToRoot ||
        canonicalRelativeToRoot.startsWith(`..${path.sep}`) ||
        path.isAbsolute(canonicalRelativeToRoot)
      ) {
        return undefined;
      }
      const content = await this.fileSystem.readFile(scriptPath);
      const bytes = Buffer.from(content);
      if (
        bytes.byteLength > FIXTURE_SCRIPT_FILE_LIMIT ||
        createHash('sha256').update(bytes).digest('hex') !== expectedHash.toLowerCase() ||
        !isSelfContainedFixtureScript(bytes.toString('utf8'))
      ) {
        return undefined;
      }
      return { rootDirectory, scriptPath };
    } catch {
      return undefined;
    }
  }

  private async runScript(
    projectDirectory: string,
    scriptPath: string,
    request: FixtureLifecycleExecutionRequest,
  ): Promise<unknown> {
    const child = this.spawnImplementation(this.executablePath, [scriptPath], {
      cwd: projectDirectory,
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        LANG: process.env.LANG ?? 'en_US.UTF-8',
        PATH: process.env.PATH ?? '',
      },
      stdio: 'pipe',
      windowsHide: true,
    });
    if (!child.stdin || !child.stdout || !child.stderr) {
      terminateChild(child);
      throw new Error('Fixture script process did not expose standard streams.');
    }

    let timedOut = false;
    let cancelled = false;
    let outputExceeded = false;
    const terminate = () => terminateChild(child);
    const onAbort = () => {
      cancelled = true;
      terminate();
    };
    request.cancellationSignal?.addEventListener('abort', onAbort, { once: true });
    if (request.cancellationSignal?.aborted) {
      onAbort();
    }
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, this.timeoutMs);
    try {
      const stdout = captureBoundedStream(child.stdout, FIXTURE_SCRIPT_STDIO_LIMIT, () => {
        outputExceeded = true;
        terminate();
      });
      const stderr = captureBoundedStream(child.stderr, FIXTURE_SCRIPT_STDIO_LIMIT, () => terminate());
      child.stdin.end(JSON.stringify({
        schemaVersion: 1,
        lifecycle: request.lifecycle,
        fixture: { id: request.fixture.id, version: request.fixture.version },
        environment: {
          id: request.environment.id,
          name: request.environment.name,
          kind: request.environment.kind,
          url: request.environment.url,
        },
      }));
      const [exitCode, stdoutBytes] = await Promise.all([waitForChildClose(child), stdout, stderr.then(() => undefined)]).then(
        ([code, output]) => [code, output] as const,
      );
      if (cancelled || request.cancellationSignal?.aborted) {
        throw new FixtureScriptCancelledError();
      }
      if (timedOut) {
        throw new FixtureScriptTimeoutError();
      }
      if (outputExceeded || exitCode !== 0 || !stdoutBytes) {
        throw new Error('Fixture script returned an invalid process result.');
      }
      return JSON.parse(stdoutBytes.toString('utf8'));
    } finally {
      clearTimeout(timeout);
      request.cancellationSignal?.removeEventListener('abort', onAbort);
    }
  }

  private result(
    request: FixtureLifecycleExecutionRequest,
    outcome: FixtureLifecycleEvidence['outcome'],
    durationMs: number,
    message: string,
  ): FixtureLifecycleExecutionResult {
    const declaration = request.lifecycle === 'setup' ? request.fixture.setup : request.fixture.cleanup;
    const scriptPath = declaration?.mode === 'script' ? declaration.script?.relativePath : undefined;
    return {
      evidence: {
        fixtureId: request.fixture.id,
        fixtureVersion: request.fixture.version,
        lifecycle: request.lifecycle,
        mode: 'script',
        ...(scriptPath ? { scriptPath } : {}),
        outcome,
        durationMs,
      },
      message,
    };
  }
}

function isSelfContainedFixtureScript(source: string): boolean {
  return !/(?:^|[^.$\w])(?:import|require)\b/u.test(source);
}

function captureBoundedStream(
  stream: NodeJS.ReadableStream,
  limit: number,
  onLimit: () => void,
): Promise<Buffer | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let exceeded = false;
    stream.on('data', (chunk: Buffer | string) => {
      if (exceeded) {
        return;
      }
      const bytes = Buffer.from(chunk);
      size += bytes.byteLength;
      if (size > limit) {
        exceeded = true;
        onLimit();
        return;
      }
      chunks.push(bytes);
    });
    stream.once('error', reject);
    stream.once('end', () => resolve(exceeded ? undefined : Buffer.concat(chunks)));
  });
}

function waitForChildClose(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code));
  });
}

function terminateChild(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode) {
    return;
  }
  child.kill('SIGTERM');
  const forceTimer = setTimeout(() => {
    if (child.exitCode === null && !child.signalCode) {
      child.kill('SIGKILL');
    }
  }, 250);
  forceTimer.unref();
}

function normalizeScriptFixtureOutputs(
  parameters: FixtureParameter[],
  value: unknown,
): Record<string, FixtureHttpJsonValue> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const result = value as Record<string, unknown>;
  if (
    result.status !== 'passed' ||
    Object.keys(result).some((key) => key !== 'status' && key !== 'outputs') ||
    (result.outputs !== undefined && (!result.outputs || typeof result.outputs !== 'object' || Array.isArray(result.outputs)))
  ) {
    return undefined;
  }
  const outputs = (result.outputs ?? {}) as Record<string, unknown>;
  if (Object.keys(outputs).some((key) => !parameters.some((parameter) => parameter.name === key) || isSensitiveOutputName(key))) {
    return undefined;
  }
  const normalized: Record<string, FixtureHttpJsonValue> = {};
  for (const parameter of parameters) {
    const output = outputs[parameter.name];
    if (output === undefined) {
      if (parameter.required) {
        return undefined;
      }
      continue;
    }
    const valueForType = normalizeFixtureOutputValue(output, parameter.type);
    if (valueForType === undefined) {
      return undefined;
    }
    normalized[parameter.name] = valueForType;
  }
  return normalized;
}

function normalizeFixtureOutputValue(
  value: unknown,
  type: FixtureParameter['type'],
): FixtureHttpJsonValue | undefined {
  if (type === 'string') {
    return typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= FIXTURE_SCRIPT_OUTPUT_LIMIT ? value : undefined;
  }
  if (type === 'number') {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }
  if (type === 'boolean') {
    return typeof value === 'boolean' ? value : undefined;
  }
  const normalized = normalizeFixtureHttpJsonValue(value);
  return normalized !== undefined && Buffer.byteLength(JSON.stringify(normalized), 'utf8') <= FIXTURE_SCRIPT_OUTPUT_LIMIT
    ? normalized
    : undefined;
}

function isSensitiveOutputName(value: string): boolean {
  return /(?:api[-_]?key|authorization|cookie|credential|pass(?:word)?|secret|token)/iu.test(value);
}

class FixtureScriptCancelledError extends Error {}
class FixtureScriptTimeoutError extends Error {}
