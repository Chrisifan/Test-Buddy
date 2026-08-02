import { describe, expect, it, vi } from 'vitest';

import { defaultMidsceneConfig } from '../../shared/studio.js';
import { testMidsceneConnection } from './midscene-connection.js';

const configuredModel = {
  ...defaultMidsceneConfig,
  modelBaseUrl: 'https://models.example.test/v1',
  modelApiKey: 'test-key',
  modelName: 'ui-agent-model',
  modelFamily: 'openai',
};

describe('testMidsceneConnection', () => {
  it('calls the OpenAI-compatible completion endpoint with a minimal probe', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200 }),
    );

    const result = await testMidsceneConnection(configuredModel, fetchImpl);

    expect(result).toMatchObject({ status: 'passed', modelName: 'ui-agent-model' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://models.example.test/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      }),
    );
    const request = fetchImpl.mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({ model: 'ui-agent-model', max_tokens: 8 });
  });

  it('returns a configuration failure without sending a request when fields are incomplete', async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    const result = await testMidsceneConnection({ ...configuredModel, modelApiKey: '' }, fetchImpl);

    expect(result).toMatchObject({ status: 'failed', failure: 'configuration' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('keeps HTTP and malformed-response failures distinguishable without returning provider details', async () => {
    const httpResult = await testMidsceneConnection(
      configuredModel,
      vi.fn<typeof fetch>().mockResolvedValue(new Response('invalid key', { status: 401 })),
    );
    const responseResult = await testMidsceneConnection(
      configuredModel,
      vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [] }), { status: 200 })),
    );

    expect(httpResult).toMatchObject({ status: 'failed', failure: 'http', httpStatus: 401 });
    expect(responseResult).toMatchObject({ status: 'failed', failure: 'response' });
    expect(JSON.stringify(httpResult)).not.toContain('invalid key');
  });
});
