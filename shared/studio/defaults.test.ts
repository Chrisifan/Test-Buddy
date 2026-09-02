import { describe, expect, it } from 'vitest';

import {
  createInitialStudioState,
  defaultAgentModelConfig,
  defaultMidsceneConfig,
} from './defaults.js';

describe('studio defaults', () => {
  it('creates fresh mutable state while keeping model secrets as reference-only metadata', () => {
    const first = createInitialStudioState();
    const second = createInitialStudioState();

    expect(first.midsceneConfig.modelSecret).toEqual(defaultMidsceneConfig.modelSecret);
    expect(first.agentModelConfig).toEqual(defaultAgentModelConfig);
    expect(JSON.stringify(first)).not.toContain('apiKey');
    expect(JSON.stringify(first)).not.toContain('modelApiKey');
    expect(first.runtimeProfile).not.toBe(second.runtimeProfile);
    expect(first.midsceneConfig).not.toBe(second.midsceneConfig);
    expect(first.midsceneConfig.modelSecret).not.toBe(second.midsceneConfig.modelSecret);
    expect(first.agentModelConfig).not.toBe(second.agentModelConfig);
    expect(first.browserSession).not.toBe(second.browserSession);
    expect(first.projects).not.toBe(second.projects);
  });
});
