import { describe, expect, it } from 'vitest';

import {
  defaultAgentModelConfig,
  defaultMidsceneConfig,
  resolveAgentModelAssignments,
  type AgentModelConfig,
} from './studio.js';

describe('agent model assignment resolver', () => {
  it('defaults every agent role to the configured MidScene model without exposing the API key', () => {
    const assignments = resolveAgentModelAssignments({
      midsceneConfig: {
        ...defaultMidsceneConfig,
        modelBaseUrl: 'https://models.example.test/v1',
        modelApiKey: 'secret-key',
        modelName: 'ui-vlm',
        modelFamily: 'openai',
      },
      agentModelConfig: defaultAgentModelConfig,
    });

    expect(assignments.map((assignment) => assignment.role)).toEqual([
      'planner',
      'executor',
      'verifier',
      'reporter',
    ]);
    expect(assignments).toContainEqual(
      expect.objectContaining({
        role: 'planner',
        provider: 'reuseMidscene',
        source: 'midscene',
        modelBaseUrl: 'https://models.example.test/v1',
        modelName: 'ui-vlm',
        modelFamily: 'openai',
        hasApiKey: true,
      }),
    );
    expect(JSON.stringify(assignments)).not.toContain('secret-key');
  });

  it('uses an independent role model when that role opts out of MidScene reuse', () => {
    const agentModelConfig: AgentModelConfig = {
      ...defaultAgentModelConfig,
      planner: {
        ...defaultAgentModelConfig.planner,
        provider: 'openaiCompatible',
        modelBaseUrl: 'https://planner.example.test/v1',
        modelApiKey: 'planner-secret',
        modelName: 'planner-large',
        modelFamily: 'openai',
        temperature: '0.1',
      },
    };

    const assignments = resolveAgentModelAssignments({
      midsceneConfig: {
        ...defaultMidsceneConfig,
        modelName: 'midscene-vlm',
      },
      agentModelConfig,
    });

    expect(assignments.find((assignment) => assignment.role === 'planner')).toEqual(
      expect.objectContaining({
        provider: 'openaiCompatible',
        source: 'agentRole',
        modelBaseUrl: 'https://planner.example.test/v1',
        modelName: 'planner-large',
        modelFamily: 'openai',
        temperature: '0.1',
        hasApiKey: true,
      }),
    );
    expect(assignments.find((assignment) => assignment.role === 'executor')?.modelName).toBe('midscene-vlm');
    expect(JSON.stringify(assignments)).not.toContain('planner-secret');
  });

  it('preserves disabled role state so runtime can skip optional Agent phases later', () => {
    const assignments = resolveAgentModelAssignments({
      midsceneConfig: defaultMidsceneConfig,
      agentModelConfig: {
        ...defaultAgentModelConfig,
        reporter: {
          ...defaultAgentModelConfig.reporter,
          enabled: false,
        },
      },
    });

    expect(assignments.find((assignment) => assignment.role === 'reporter')).toEqual(
      expect.objectContaining({
        role: 'reporter',
        enabled: false,
      }),
    );
  });
});
