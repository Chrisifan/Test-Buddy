import { describe, expect, it } from 'vitest';

import type { ProjectDraft, StudioState } from '../studio.js';
import { createStudioStateHydrator } from './hydration.js';

const hydrateStudioState = createStudioStateHydrator({
  normalizeProjectDraft: (project: ProjectDraft) => project,
  normalizeMaintenanceDrafts: () => [],
  testCaseToWorkflow: () => {
    throw new Error('This fixture does not hydrate a project.');
  },
});

describe('studio hydration boundary', () => {
  it('removes legacy plaintext model keys and normalizes legacy neutral runs', () => {
    const hydrated = hydrateStudioState({
      midsceneConfig: {
        modelBaseUrl: 'https://model.example.test',
        modelName: 'legacy-model',
        apiKey: 'plaintext-api-key',
        modelApiKey: 'legacy-model-api-key',
      },
      agentModelConfig: {
        planner: {
          apiKey: 'plaintext-planner-api-key',
          modelApiKey: 'legacy-planner-model-api-key',
        },
      },
      runDetails: [{
        id: 'run-legacy-neutral',
        projectId: 'project-user',
        testCaseId: 'case-user',
        environmentId: 'env-user',
        title: 'Legacy neutral run',
        status: 'neutral',
        startedAt: '2026-08-15T00:00:00.000Z',
        duration: '00:00:01',
        summary: 'The prior store did not classify this result.',
        logs: [],
        steps: [],
        artifacts: [],
      }],
    } as unknown as Partial<StudioState>);

    expect(hydrated.midsceneConfig).toMatchObject({
      modelBaseUrl: 'https://model.example.test',
      modelName: 'legacy-model',
    });
    expect(JSON.stringify(hydrated.midsceneConfig)).not.toContain('plaintext-api-key');
    expect(JSON.stringify(hydrated.midsceneConfig)).not.toContain('legacy-model-api-key');
    expect(JSON.stringify(hydrated.agentModelConfig)).not.toContain('plaintext-planner-api-key');
    expect(JSON.stringify(hydrated.agentModelConfig)).not.toContain('legacy-planner-model-api-key');
    expect(hydrated.runDetails).toEqual([expect.objectContaining({
      status: 'blocked',
      reason: expect.objectContaining({ code: 'legacyAmbiguousNeutral' }),
    })]);
  });
});
