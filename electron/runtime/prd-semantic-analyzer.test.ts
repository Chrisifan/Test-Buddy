import { describe, expect, it, vi } from 'vitest';

import {
  createPrdDocumentAsset,
  defaultAgentModelConfig,
  defaultMidsceneConfig,
} from '../../shared/studio.js';
import {
  OpenAICompatiblePrdSemanticAnalyzer,
  PrdSemanticAnalysisRuntime,
} from './prd-semantic-analyzer.js';

function plannerModelConfig() {
  return {
    ...defaultAgentModelConfig,
    planner: {
      ...defaultAgentModelConfig.planner,
      provider: 'openaiCompatible' as const,
      modelBaseUrl: 'https://models.example.test/v1',
      modelApiKey: 'planner-secret',
      modelName: 'planner-large',
      modelFamily: 'openai',
      temperature: '0.2',
      enabled: true,
    },
  };
}

describe('PrdSemanticAnalysisRuntime', () => {
  it('refines only existing rule paths and preserves stable PRD references', async () => {
    const document = createPrdDocumentAsset({
      name: 'member-management.md',
      kind: 'markdown',
      size: 240,
      sourceText: `# 成员管理
- 管理员必须能新增成员，并在列表中展示邮箱与状态。
- 删除成员前必须二次确认，取消后不得改变列表。`,
    });
    const [firstPath, secondPath] = document.generatedPaths;
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: '成员管理覆盖新增权限与删除取消两个可追溯场景。',
                  paths: [
                    {
                      pathId: firstPath!.id,
                      title: '管理员新增成员并确认列表展示',
                      priority: 'P0',
                      groupName: '成员权限',
                      rationale: '由管理员新增成员和列表展示的原文要求细化。',
                      steps: [
                        { type: 'ai', title: '准备管理员身份', body: '以管理员身份进入成员管理页面。' },
                        { type: 'ai', title: '新增成员', body: '新增一个成员并保存。' },
                        { type: 'aiAssert', title: '确认列表展示', body: '断言新成员的邮箱和状态显示在列表中。' },
                      ],
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const runtime = new PrdSemanticAnalysisRuntime(
      new OpenAICompatiblePrdSemanticAnalyzer(fetchImpl),
    );

    const response = await runtime.analyze({
      document,
      midsceneConfig: defaultMidsceneConfig,
      agentModelConfig: plannerModelConfig(),
    });

    expect(response).toMatchObject({ source: 'model', modelName: 'planner-large' });
    expect(response.document.analysisMetadata).toMatchObject({
      source: 'model',
      modelName: 'planner-large',
    });
    expect(response.document.generatedPaths[0]).toMatchObject({
      id: firstPath!.id,
      sourceExcerpt: firstPath!.sourceExcerpt,
      title: '管理员新增成员并确认列表展示',
      steps: expect.arrayContaining([
        expect.objectContaining({ id: `semantic-${firstPath!.id}-1`, type: 'ai' }),
        expect.objectContaining({ id: `semantic-${firstPath!.id}-3`, type: 'aiAssert' }),
      ]),
    });
    expect(response.document.generatedPaths[1]).toEqual(secondPath);

    const requestBody = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(requestBody.messages[1].content).toContain(firstPath!.id);
    expect(requestBody.messages[1].content).toContain(firstPath!.sourceExcerpt);
  });

  it('keeps rule paths intact when the model references an unknown path', async () => {
    const document = createPrdDocumentAsset({
      name: 'order.md',
      kind: 'markdown',
      size: 160,
      sourceText: '# 订单管理\n- 用户必须填写收货地址后才能提交订单。',
    });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: '不应被采用的响应。',
                  paths: [
                    {
                      pathId: 'path-not-from-rule',
                      title: '编造路径',
                      priority: 'P0',
                      groupName: '未知',
                      rationale: '无来源。',
                      steps: [{ type: 'aiAssert', title: '断言', body: '无来源。' }],
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const runtime = new PrdSemanticAnalysisRuntime(
      new OpenAICompatiblePrdSemanticAnalyzer(fetchImpl),
    );

    const response = await runtime.analyze({
      document,
      midsceneConfig: defaultMidsceneConfig,
      agentModelConfig: plannerModelConfig(),
    });

    expect(response).toMatchObject({ source: 'rule', fallbackReason: 'invalidResponse' });
    expect(response.document.generatedPaths).toEqual(document.generatedPaths);
  });

  it('returns a labeled rule fallback without contacting a model when Planner is unconfigured', async () => {
    const document = createPrdDocumentAsset({
      name: 'order.md',
      kind: 'markdown',
      size: 160,
      sourceText: '# 订单管理\n- 用户必须填写收货地址后才能提交订单。',
    });
    const analyzer = { analyze: vi.fn() };
    const runtime = new PrdSemanticAnalysisRuntime(analyzer);

    const response = await runtime.analyze({
      document,
      midsceneConfig: defaultMidsceneConfig,
      agentModelConfig: defaultAgentModelConfig,
    });

    expect(response).toMatchObject({ source: 'rule', fallbackReason: 'modelNotConfigured' });
    expect(response.document.generatedPaths).toEqual(document.generatedPaths);
    expect(analyzer.analyze).not.toHaveBeenCalled();
  });
});
