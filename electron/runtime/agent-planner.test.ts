import { describe, expect, it, vi } from 'vitest';

import { OpenAICompatibleAgentPlanner } from './agent-planner.js';

describe('OpenAICompatibleAgentPlanner', () => {
  it('requests a structured plan and records model usage', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: '登录验证计划',
                  summary: '登录后检查工作台标题。',
                  risks: ['测试账号可能失效'],
                  steps: [
                    {
                      action: 'input',
                      title: '填写用户名',
                      instruction: '在用户名输入框中输入测试账号',
                      target: '用户名输入框',
                      value: 'qa-user',
                      expected: '用户名已填写',
                    },
                    {
                      action: 'click',
                      title: '提交登录',
                      instruction: '点击登录按钮',
                      target: '登录按钮',
                      expected: '进入工作台',
                    },
                  ],
                }),
              },
            },
          ],
          usage: {
            prompt_tokens: 120,
            completion_tokens: 80,
            total_tokens: 200,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const planner = new OpenAICompatibleAgentPlanner(fetchImpl);

    const result = await planner.createPlan({
      config: {
        modelBaseUrl: 'https://models.example.test/v1/',
        modelApiKey: 'planner-secret',
        modelName: 'planner-large',
        modelFamily: 'openai',
        temperature: '0.2',
      },
      mode: 'ai',
      prompt: '使用测试账号登录并检查工作台标题',
      targetEnvironment: 'Staging',
      targetUrl: 'https://app.example.test',
      currentUrl: 'https://app.example.test/login',
      pageTitle: '登录',
      completedSteps: [
        {
          stepIndex: 1,
          action: 'input',
          title: '填写用户名',
          instruction: '在用户名输入框中输入测试账号',
          evidence: '用户名已填写',
          currentUrl: 'https://app.example.test/login',
        },
      ],
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://models.example.test/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer planner-secret',
          'Content-Type': 'application/json',
        }),
      }),
    );
    const requestBody = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(requestBody).toEqual(
      expect.objectContaining({
        model: 'planner-large',
        temperature: 0.2,
      }),
    );
    expect(JSON.parse(requestBody.messages[1].content)).toEqual(
      expect.objectContaining({
        completedSteps: [
          expect.objectContaining({
            stepIndex: 1,
            action: 'input',
            title: '填写用户名',
          }),
        ],
      }),
    );
    expect(requestBody.messages[0].content).toContain('只输出从当前状态继续所需的后续步骤');
    expect(result.plan.steps).toHaveLength(2);
    expect(result.plan.steps[0]).toEqual(
      expect.objectContaining({
        action: 'input',
        target: '用户名输入框',
        value: 'qa-user',
      }),
    );
    expect(result.modelName).toBe('planner-large');
    expect(result.metrics).toEqual(
      expect.objectContaining({
        calls: 1,
        promptTokens: 120,
        completionTokens: 80,
        totalTokens: 200,
        byModel: {
          'planner-large': {
            calls: 1,
            promptTokens: 120,
            completionTokens: 80,
            totalTokens: 200,
          },
        },
      }),
    );
  });

  it('rejects malformed model output instead of inventing executable steps', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '```json\n{"title":"空计划","steps":[]}\n```' } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const planner = new OpenAICompatibleAgentPlanner(fetchImpl);

    await expect(
      planner.createPlan({
        config: {
          modelBaseUrl: 'https://models.example.test/v1',
          modelApiKey: 'planner-secret',
          modelName: 'planner-large',
          modelFamily: 'openai',
          temperature: '0.2',
        },
        mode: 'ai',
        prompt: '执行登录测试',
        targetEnvironment: 'Staging',
        targetUrl: 'https://app.example.test',
      }),
    ).rejects.toThrow('Planner 返回的 steps 不能为空');
  });
});
