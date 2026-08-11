import type { FixtureLifecycleExecutor, FixtureLifecycleExecutionRequest, FixtureLifecycleExecutionResult } from './fixture-http-executor.js';

/** Routes a lifecycle to the only registered executor for its declared mode. */
export class DefaultFixtureLifecycleExecutor implements FixtureLifecycleExecutor {
  constructor(
    private readonly httpExecutor: FixtureLifecycleExecutor,
    private readonly scriptExecutor: FixtureLifecycleExecutor,
  ) {}

  supports(mode: 'http' | 'script'): boolean {
    return mode === 'http'
      ? this.httpExecutor.supports?.(mode) ?? true
      : this.scriptExecutor.supports?.(mode) ?? true;
  }

  async execute(request: FixtureLifecycleExecutionRequest): Promise<FixtureLifecycleExecutionResult> {
    const declaration = request.lifecycle === 'setup' ? request.fixture.setup : request.fixture.cleanup;
    if (declaration?.mode === 'http') {
      return this.httpExecutor.execute(request);
    }
    if (declaration?.mode === 'script') {
      return this.scriptExecutor.execute(request);
    }
    return {
      evidence: {
        fixtureId: request.fixture.id,
        fixtureVersion: request.fixture.version,
        lifecycle: request.lifecycle,
        mode: 'http',
        method: 'POST',
        path: '/',
        expectedStatuses: [],
        outcome: 'neutral',
        durationMs: 0,
      },
      message: 'Fixture lifecycle is not executable.',
    };
  }
}
