import { describe, expect, it, vi } from 'vitest';

import * as studio from './studio.js';
import {
  copyTestStep,
  createDemoStudioState,
  deriveProjectRunReport,
  deriveRunCoverageRisk,
  createPrdDocumentAsset,
  createRecordingFromGeneratedPath,
  createTestStep,
  createTestCaseFromAgentRun,
  createTestCaseFromGeneratedPath,
  createTestCaseFromRecording,
  createEmptyProject,
  createInitialStudioState,
  createManualStepAutomationReplacement,
  createReporterFixDraft,
  getConfirmedDeterministicTestStep,
  getConfirmedExplicitTestAssertion,
  getExclusiveRecordingReplayId,
  isRecordingLinkedToGeneratedPath,
  isConfirmedDeterministicTestStep,
  isTestCaseLinkedToGeneratedPath,
  getTestCaseRunBlocker,
  getTestStepRunBlocker,
  hydrateStudioState,
  insertTestStep,
  isAgentRunnableTestCase,
  moveTestStep,
  removeTestStep,
  prunePrdCoverageTriage,
  updatePrdDocumentAnalysis,
} from './studio.js';
import { createStubAgentRun } from './agentStub.js';

describe('studio state hydration', () => {
  it('creates an editable natural-language test case from a passed Agent plan', () => {
    const agentRun = createStubAgentRun({
      mode: 'ai',
      prompt: '使用测试账号提交订单并读取订单编号',
      runtimeDescription: 'chromium / desktop / headless / https://app.example.test',
      targetEnvironment: 'staging',
      projectId: 'project-orders',
      targetUrl: 'https://app.example.test/orders',
      plannedPlan: {
        title: '提交订单并确认结果',
        summary: '填写测试数据，提交订单并确认结果。',
        risks: ['测试数据需要独立清理。'],
        steps: [
          { action: 'navigate', title: '进入订单页', instruction: '进入订单页', url: 'https://app.example.test/orders' },
          { action: 'input', title: '填写邮箱', instruction: '填写测试邮箱', selector: '#email', value: 'qa@example.test' },
          { action: 'click', title: '提交订单', instruction: '提交订单', selector: '#submit-order' },
          { action: 'assert', title: '确认订单状态', instruction: '验证页面显示订单已创建', expected: '页面显示订单已创建' },
          { action: 'extract', title: '读取订单编号', instruction: '读取订单编号', target: '订单编号' },
        ],
      },
    });

    const testCase = createTestCaseFromAgentRun({
      agentRun,
      groupId: 'group-orders',
      environmentId: 'env-staging',
      url: 'https://fallback.example.test',
      seed: 3,
    });

    expect(testCase).toEqual(
      expect.objectContaining({
        kind: 'scenario',
        source: 'naturalLanguage',
        groupId: 'group-orders',
        environmentId: 'env-staging',
        name: '提交订单并确认结果',
        url: 'https://app.example.test/orders',
        notes: expect.stringContaining('测试数据需要独立清理。'),
        steps: [
          expect.objectContaining({ type: 'ai', title: '进入订单页', body: '打开 https://app.example.test/orders' }),
          expect.objectContaining({ type: 'ai', title: '填写邮箱', body: '在 #email 中输入待确认的值' }),
          expect.objectContaining({ type: 'ai', title: '提交订单', body: '点击 #submit-order' }),
          expect.objectContaining({ type: 'aiAssert', title: '确认订单状态', body: '验证页面显示订单已创建' }),
          expect.objectContaining({ type: 'aiQuery', title: '读取订单编号', body: '提取 订单编号' }),
        ],
      }),
    );
    expect(testCase?.steps).toHaveLength(5);
    expect(testCase?.sourceIntent).toBe('使用测试账号提交订单并读取订单编号');
    expect(testCase?.steps[0]?.execution).toMatchObject({
      schemaVersion: 2,
      intent: '进入订单页',
      reviewStatus: 'needsReview',
      actionRisk: 'low',
      action: { kind: 'navigate', url: 'https://app.example.test/orders' },
      provenance: { source: 'agentRun', runId: agentRun.runId },
    });
    expect(testCase?.steps[1]?.execution).toMatchObject({
      intent: '输入待确认的值到 #email',
      reviewStatus: 'needsReview',
      actionRisk: 'medium',
    });
    expect(testCase?.steps[1]?.execution?.action).toBeUndefined();
    expect(testCase?.steps[2]?.execution).toMatchObject({
      actionRisk: 'high',
      action: {
        kind: 'click',
        locator: { selector: '#submit-order', quality: 'acceptable' },
      },
    });
    expect(testCase?.steps[3]?.execution).toMatchObject({
      intent: '验证页面显示订单已创建',
      reviewStatus: 'needsReview',
      actionRisk: 'low',
    });
    expect(testCase?.steps[3]?.execution?.action).toBeUndefined();
  });

  it('refuses to create a test case from a non-passing natural-language run', () => {
    const agentRun = createStubAgentRun({
      mode: 'ai',
      prompt: '提交订单',
      runtimeDescription: 'chromium / desktop / headless / https://app.example.test',
      targetEnvironment: 'staging',
      verificationStatus: 'failed',
    });

    expect(
      createTestCaseFromAgentRun({
        agentRun,
        groupId: 'group-orders',
        environmentId: 'env-staging',
        url: 'https://app.example.test',
        seed: 1,
      }),
    ).toBeUndefined();
  });

  it('does not persist sensitive natural-language inputs when creating a test case', () => {
    const password = 'hunter2';
    const token = 'token-value-123';
    const agentRun = createStubAgentRun({
      mode: 'ai',
      prompt: `使用密码 ${password} 和 API token ${token} 登录后台`,
      runtimeDescription: 'chromium / desktop / headless / https://app.example.test',
      targetEnvironment: 'staging',
      projectId: 'project-orders',
      targetUrl: 'https://app.example.test/orders',
      plannedPlan: {
        title: `使用密码 ${password} 登录`,
        summary: `在密码框输入 ${password}。`,
        risks: [`API token ${token} 需要保护。`],
        steps: [
          { action: 'input', title: '填写密码', instruction: `在密码框输入 ${password}`, selector: '#password', value: password },
          { action: 'select', title: '选择 API token', instruction: `选择 API token ${token}`, selector: '#api-token', value: token },
        ],
      },
    });

    const testCase = createTestCaseFromAgentRun({
      agentRun,
      groupId: 'group-orders',
      environmentId: 'env-staging',
      url: 'https://fallback.example.test',
      seed: 5,
    });
    const serialized = JSON.stringify(testCase);

    expect(serialized).not.toContain(password);
    expect(serialized).not.toContain(token);
    expect(testCase?.sourceIntent).toContain('[已隐藏]');
    expect(testCase?.steps.map((step) => step.body)).toEqual([
      '在 #password 中输入敏感值（已隐藏）',
      '在 #api-token 中选择敏感值（已隐藏）',
    ]);
    expect(testCase?.steps.map((step) => step.execution?.action)).toEqual([undefined, undefined]);
    expect(testCase?.steps.map((step) => studio.getTestStepModelRequirement(step))).toEqual(['required', 'required']);
  });

  it('redacts credential-bearing URLs from Agent runs before persisting test cases', () => {
    const unsafeUrl = 'https://user:password@example.test/orders?tab=open&access_token=token#access_token=fragment-token';
    const safeUrl = 'https://example.test/orders?tab=[已隐藏]&access_token=[已隐藏]';
    const agentRun = createStubAgentRun({
      mode: 'ai',
      prompt: `访问 ${unsafeUrl}`,
      runtimeDescription: 'chromium / desktop / headless / https://app.example.test',
      targetEnvironment: 'staging',
      projectId: 'project-orders',
      targetUrl: unsafeUrl,
      plannedPlan: {
        title: `打开 ${unsafeUrl}`,
        summary: `确认 ${unsafeUrl} 可访问。`,
        risks: [`不要泄漏 ${unsafeUrl}。`],
        steps: [
          { action: 'navigate', title: `进入 ${unsafeUrl}`, instruction: `打开 ${unsafeUrl}`, url: unsafeUrl },
        ],
      },
    });

    const testCase = createTestCaseFromAgentRun({
      agentRun,
      groupId: 'group-orders',
      environmentId: 'env-staging',
      url: 'https://fallback.example.test',
      seed: 8,
    });
    const serialized = JSON.stringify(testCase);

    expect(testCase?.url).toBe(safeUrl);
    expect(testCase?.sourceIntent).toContain(safeUrl);
    expect(testCase?.name).toContain(safeUrl);
    expect(testCase?.notes).toContain(safeUrl);
    expect(testCase?.steps[0]).toMatchObject({
      title: `进入 ${safeUrl}`,
      body: `打开 ${safeUrl}`,
      execution: {
        intent: `打开 ${safeUrl}`,
        action: { kind: 'navigate', url: safeUrl },
      },
    });
    ['user:', 'password', 'access_token=token', 'fragment-token', '#'].forEach((secret) => {
      expect(serialized).not.toContain(secret);
    });
  });

  it('removes every valid URL fragment before Agent-run data is persisted', () => {
    const oauthUrl = 'https://example.test/callback?tab=open#code=oauth-secret';
    const sessionUrl = 'https://example.test/orders?view=details#sid=x';
    const agentRun = createStubAgentRun({
      mode: 'ai',
      prompt: `检查 ${oauthUrl} 和 ${sessionUrl}`,
      runtimeDescription: 'chromium / desktop / headless / https://app.example.test',
      targetEnvironment: 'staging',
      projectId: 'project-orders',
      targetUrl: oauthUrl,
      plannedPlan: {
        title: `打开 ${oauthUrl}`,
        summary: `确认 ${sessionUrl} 可访问。`,
        risks: [`不要保留 ${oauthUrl} 或 ${sessionUrl}。`],
        steps: [
          { action: 'navigate', title: `进入 ${oauthUrl}`, instruction: `打开 ${oauthUrl}`, url: oauthUrl },
          { action: 'navigate', title: `进入 ${sessionUrl}`, instruction: `打开 ${sessionUrl}`, url: sessionUrl },
        ],
      },
    });

    const testCase = createTestCaseFromAgentRun({
      agentRun,
      groupId: 'group-orders',
      environmentId: 'env-staging',
      url: 'https://fallback.example.test',
      seed: 9,
    });
    const serialized = JSON.stringify(testCase);

    expect(testCase?.url).toBe('https://example.test/callback?tab=[已隐藏]');
    expect(testCase?.steps.map((step) => step.execution?.action)).toEqual([
      { kind: 'navigate', url: 'https://example.test/callback?tab=[已隐藏]' },
      { kind: 'navigate', url: 'https://example.test/orders?view=[已隐藏]' },
    ]);
    expect(serialized).not.toContain('#');
    expect(serialized).not.toContain('oauth-secret');
    expect(serialized).not.toContain('sid=x');
  });

  it('omits deterministic actions when their selectors contain redacted URLs', () => {
    const unsafeUrl = 'https://user:pw@example.test/path?token=x#code=y';
    const unsafeSelector = `a[href="${unsafeUrl}"]`;
    const agentRun = createStubAgentRun({
      mode: 'ai',
      prompt: `操作 ${unsafeUrl}`,
      runtimeDescription: 'chromium / desktop / headless / https://app.example.test',
      targetEnvironment: 'staging',
      projectId: 'project-orders',
      targetUrl: 'https://app.example.test/orders',
      plannedPlan: {
        title: `操作 ${unsafeUrl}`,
        summary: `操作 ${unsafeUrl}。`,
        risks: [],
        steps: [
          { action: 'click', title: `点击 ${unsafeUrl}`, instruction: `点击 ${unsafeUrl}`, selector: unsafeSelector },
          { action: 'wait', title: `等待 ${unsafeUrl}`, instruction: `等待 ${unsafeUrl}`, selector: unsafeSelector },
          { action: 'scroll', title: `滚动到 ${unsafeUrl}`, instruction: `滚动到 ${unsafeUrl}`, selector: unsafeSelector },
        ],
      },
    });

    const testCase = createTestCaseFromAgentRun({
      agentRun,
      groupId: 'group-orders',
      environmentId: 'env-staging',
      url: 'https://fallback.example.test',
      seed: 10,
    });
    const serialized = JSON.stringify(testCase);

    expect(testCase?.steps.map((step) => step.execution?.action)).toEqual([undefined, undefined, undefined]);
    expect(serialized).not.toContain(unsafeUrl);
    ['user:', 'pw', 'token=x', 'code=y', '#'].forEach((secret) => {
      expect(serialized).not.toContain(secret);
    });
  });

  it('redacts malformed URLs before they are persisted from Agent runs', () => {
    const unsafeUrl = 'https://user:pw@example.test:bad/path?access_token=raw&tab=open#code=raw2';
    const safeUrl = 'https://example.test:bad/path?access_token=[已隐藏]&tab=[已隐藏]';
    const agentRun = createStubAgentRun({
      mode: 'ai',
      prompt: `访问 ${unsafeUrl}`,
      runtimeDescription: 'chromium / desktop / headless / https://app.example.test',
      targetEnvironment: 'staging',
      projectId: 'project-orders',
      targetUrl: unsafeUrl,
      plannedPlan: {
        title: `打开 ${unsafeUrl}`,
        summary: `确认 ${unsafeUrl} 可访问。`,
        risks: [`不要泄漏 ${unsafeUrl}。`],
        steps: [
          { action: 'navigate', title: `进入 ${unsafeUrl}`, instruction: `打开 ${unsafeUrl}`, url: unsafeUrl },
        ],
      },
    });

    const testCase = createTestCaseFromAgentRun({
      agentRun,
      groupId: 'group-orders',
      environmentId: 'env-staging',
      url: 'https://fallback.example.test',
      seed: 11,
    });
    const serialized = JSON.stringify(testCase);

    expect(testCase?.url).toBe(safeUrl);
    expect(testCase?.sourceIntent).toContain(safeUrl);
    expect(testCase?.name).toContain(safeUrl);
    expect(testCase?.notes).toContain(safeUrl);
    expect(testCase?.steps[0]).toMatchObject({
      title: `进入 ${safeUrl}`,
      body: `打开 ${safeUrl}`,
      execution: {
        intent: `打开 ${safeUrl}`,
        action: { kind: 'navigate', url: safeUrl },
      },
    });
    ['user:', 'pw', 'access_token=raw', 'tab=open', 'code=raw2', '#'].forEach((secret) => {
      expect(serialized).not.toContain(secret);
    });
  });

  it('redacts complete URL query values that contain comma and semicolon separators', () => {
    const unsafeUrl = 'https://example.test/callback?token=raw,tail;more，中文；更多';
    const safeUrl = 'https://example.test/callback?token=[已隐藏]';
    const agentRun = createStubAgentRun({
      mode: 'ai',
      prompt: `访问 ${unsafeUrl}`,
      runtimeDescription: 'chromium / desktop / headless / https://app.example.test',
      targetEnvironment: 'staging',
      projectId: 'project-orders',
      targetUrl: unsafeUrl,
      plannedPlan: {
        title: `打开 ${unsafeUrl}`,
        summary: `确认 ${unsafeUrl} 可访问。`,
        risks: [`不要泄漏 ${unsafeUrl}。`],
        steps: [
          { action: 'navigate', title: `进入 ${unsafeUrl}`, instruction: `打开 ${unsafeUrl}`, url: unsafeUrl },
        ],
      },
    });

    const testCase = createTestCaseFromAgentRun({
      agentRun,
      groupId: 'group-orders',
      environmentId: 'env-staging',
      url: 'https://fallback.example.test',
      seed: 13,
    });
    const serialized = JSON.stringify(testCase);

    expect(testCase?.url).toBe(safeUrl);
    expect(testCase?.sourceIntent).toContain(safeUrl);
    expect(testCase?.steps[0]).toMatchObject({
      body: `打开 ${safeUrl}`,
      execution: { action: { kind: 'navigate', url: safeUrl } },
    });
    ['raw', 'tail', 'more', '中文', '更多'].forEach((secret) => {
      expect(serialized).not.toContain(secret);
    });
  });

  it('treats punctuation-adjacent URL query tails as one persisted URL fragment', () => {
    const unsafeUrl = 'https://example.test/callback?token=raw。tail';
    const safeUrl = 'https://example.test/callback?token=[已隐藏]';
    const agentRun = createStubAgentRun({
      mode: 'ai',
      prompt: `打开 ${unsafeUrl} 后继续`,
      runtimeDescription: 'chromium / desktop / headless / https://app.example.test',
      targetEnvironment: 'staging',
      projectId: 'project-orders',
      targetUrl: 'https://app.example.test/orders',
      plannedPlan: {
        title: `打开 ${unsafeUrl}`,
        summary: `确认 ${unsafeUrl} 后继续。`,
        risks: [],
        steps: [
          { action: 'navigate', title: `进入 ${unsafeUrl}`, instruction: `打开 ${unsafeUrl}`, url: unsafeUrl },
        ],
      },
    });

    const testCase = createTestCaseFromAgentRun({
      agentRun,
      groupId: 'group-orders',
      environmentId: 'env-staging',
      url: 'https://fallback.example.test',
      seed: 14,
    });
    const serialized = JSON.stringify(testCase);

    expect(testCase?.sourceIntent).toContain(safeUrl);
    expect(testCase?.notes).toContain(safeUrl);
    expect(testCase?.steps[0]).toMatchObject({
      title: `进入 ${safeUrl}`,
      body: `打开 ${safeUrl}`,
      execution: {
        intent: `打开 ${safeUrl}`,
        action: { kind: 'navigate', url: safeUrl },
      },
    });
    ['raw', 'tail'].forEach((secret) => {
      expect(serialized).not.toContain(secret);
    });
  });

  it('redacts prior input values from later selector and extraction text before persistence', () => {
    const secret = 'hunter2';
    const agentRun = createStubAgentRun({
      mode: 'ai',
      prompt: '填写订单并检查结果',
      runtimeDescription: 'chromium / desktop / headless / https://app.example.test',
      targetEnvironment: 'staging',
      projectId: 'project-orders',
      targetUrl: 'https://app.example.test/orders',
      plannedPlan: {
        title: '填写订单并检查结果',
        summary: '检查提交后的订单状态。',
        risks: [],
        steps: [
          { action: 'input', title: '输入订单值', instruction: '输入订单值', selector: '#password', value: secret },
          { action: 'click', title: `点击 ${secret}`, instruction: `点击 ${secret}`, selector: `a[data-value="${secret}"]` },
          { action: 'wait', title: `等待 ${secret}`, instruction: `等待 ${secret}`, selector: `[data-value="${secret}"]` },
          { action: 'scroll', title: `滚动到 ${secret}`, instruction: `滚动到 ${secret}`, selector: `[data-value="${secret}"]` },
          { action: 'extract', title: `提取 ${secret}`, instruction: `提取 ${secret}`, target: `订单 ${secret}` },
        ],
      },
    });

    const testCase = createTestCaseFromAgentRun({
      agentRun,
      groupId: 'group-orders',
      environmentId: 'env-staging',
      url: 'https://fallback.example.test',
      seed: 15,
    });
    const serialized = JSON.stringify(testCase);
    const laterSteps = testCase?.steps.slice(1) ?? [];

    expect(laterSteps.map((step) => step.execution?.action)).toEqual([undefined, undefined, undefined, undefined]);
    laterSteps.forEach((step) => {
      expect(step.title).not.toContain(secret);
      expect(step.body).not.toContain(secret);
      expect(step.execution?.intent).not.toContain(secret);
    });
    expect(serialized).not.toContain(secret);
  });

  it('redacts collected input values from URL paths across persisted Agent-run fields', () => {
    const secret = 'hunter2';
    const unsafeUrl = `https://example.test/orders/${secret}`;
    const safeUrl = 'https://example.test/orders/[已隐藏]';
    const agentRun = createStubAgentRun({
      mode: 'ai',
      prompt: `访问 ${unsafeUrl}`,
      runtimeDescription: 'chromium / desktop / headless / https://app.example.test',
      targetEnvironment: 'staging',
      projectId: 'project-orders',
      targetUrl: unsafeUrl,
      plannedPlan: {
        title: `打开 ${unsafeUrl}`,
        summary: `确认 ${unsafeUrl} 可访问。`,
        risks: [`不要泄漏 ${unsafeUrl}。`],
        steps: [
          { action: 'input', title: '输入订单值', instruction: '输入订单值', selector: '#password', value: secret },
          { action: 'navigate', title: `进入 ${unsafeUrl}`, instruction: `打开 ${unsafeUrl}`, url: unsafeUrl },
        ],
      },
    });

    const testCase = createTestCaseFromAgentRun({
      agentRun,
      groupId: 'group-orders',
      environmentId: 'env-staging',
      url: 'https://fallback.example.test',
      seed: 16,
    });
    const serialized = JSON.stringify(testCase);

    expect(testCase?.url).toBe(safeUrl);
    expect(testCase?.sourceIntent).toContain(safeUrl);
    expect(testCase?.name).toContain(safeUrl);
    expect(testCase?.notes).toContain(safeUrl);
    expect(testCase?.steps[1]).toMatchObject({
      title: `进入 ${safeUrl}`,
      body: `打开 ${safeUrl}`,
      execution: {
        intent: `打开 ${safeUrl}`,
        action: { kind: 'navigate', url: safeUrl },
      },
    });
    expect(serialized).not.toContain(secret);
  });

  it('redacts file URLs and omits selectors that embed them from persisted Agent runs', () => {
    const unsafeUrl = 'file:///tmp/page.html?token=raw#code=raw2';
    const safeUrl = 'file:///tmp/page.html?token=[已隐藏]';
    const agentRun = createStubAgentRun({
      mode: 'ai',
      prompt: `打开 ${unsafeUrl}`,
      runtimeDescription: 'chromium / desktop / headless / file:///tmp/page.html',
      targetEnvironment: 'staging',
      projectId: 'project-orders',
      targetUrl: unsafeUrl,
      plannedPlan: {
        title: `打开 ${unsafeUrl}`,
        summary: `确认 ${unsafeUrl} 可访问。`,
        risks: [],
        steps: [
          { action: 'navigate', title: `进入 ${unsafeUrl}`, instruction: `打开 ${unsafeUrl}`, url: unsafeUrl },
          { action: 'click', title: `点击 ${unsafeUrl}`, instruction: `点击 ${unsafeUrl}`, selector: `a[href="${unsafeUrl}"]` },
        ],
      },
    });

    const testCase = createTestCaseFromAgentRun({
      agentRun,
      groupId: 'group-orders',
      environmentId: 'env-staging',
      url: 'https://fallback.example.test',
      seed: 17,
    });
    const serialized = JSON.stringify(testCase);

    expect(testCase?.url).toBe(safeUrl);
    expect(testCase?.sourceIntent).toContain(safeUrl);
    expect(testCase?.steps[0]?.execution?.action).toEqual({ kind: 'navigate', url: safeUrl });
    expect(testCase?.steps[1]?.execution?.action).toBeUndefined();
    ['raw', 'raw2', '#'].forEach((secret) => {
      expect(serialized).not.toContain(secret);
    });
  });

  it('preserves only the safe about path while redacting opaque URL fragments', () => {
    const unsafeUrl = 'about:blank#token=raw';
    const safeUrl = 'about:blank';
    const agentRun = createStubAgentRun({
      mode: 'ai',
      prompt: `打开 ${unsafeUrl}`,
      runtimeDescription: 'chromium / desktop / headless / about:blank',
      targetEnvironment: 'staging',
      projectId: 'project-orders',
      targetUrl: unsafeUrl,
      plannedPlan: {
        title: `打开 ${unsafeUrl}`,
        summary: `确认 ${unsafeUrl} 可访问。`,
        risks: [],
        steps: [
          { action: 'navigate', title: `进入 ${unsafeUrl}`, instruction: `打开 ${unsafeUrl}`, url: unsafeUrl },
          { action: 'click', title: `点击 ${unsafeUrl}`, instruction: `点击 ${unsafeUrl}`, selector: `a[href="${unsafeUrl}"]` },
        ],
      },
    });

    const testCase = createTestCaseFromAgentRun({
      agentRun,
      groupId: 'group-orders',
      environmentId: 'env-staging',
      url: 'https://fallback.example.test',
      seed: 18,
    });
    const serialized = JSON.stringify(testCase);

    expect(testCase?.url).toBe(safeUrl);
    expect(testCase?.sourceIntent).toContain(safeUrl);
    expect(testCase?.steps[0]?.execution?.action).toEqual({ kind: 'navigate', url: safeUrl });
    expect(testCase?.steps[1]?.execution?.action).toBeUndefined();
    ['raw', '#'].forEach((secret) => {
      expect(serialized).not.toContain(secret);
    });
  });

  it('redacts data URL payloads and gates selectors that embed them', () => {
    const unsafeUrl = 'data:text/plain,private-value?token=query-secret#token=raw';
    const safeUrl = 'data:[已隐藏]';
    const agentRun = createStubAgentRun({
      mode: 'ai',
      prompt: `打开 ${unsafeUrl}`,
      runtimeDescription: 'chromium / desktop / headless / data:text/plain,fixture',
      targetEnvironment: 'staging',
      projectId: 'project-orders',
      targetUrl: unsafeUrl,
      plannedPlan: {
        title: `打开 ${unsafeUrl}`,
        summary: `确认 ${unsafeUrl} 可访问。`,
        risks: [],
        steps: [
          { action: 'navigate', title: `进入 ${unsafeUrl}`, instruction: `打开 ${unsafeUrl}`, url: unsafeUrl },
          { action: 'click', title: `点击 ${unsafeUrl}`, instruction: `点击 ${unsafeUrl}`, selector: `a[href="${unsafeUrl}"]` },
        ],
      },
    });

    const testCase = createTestCaseFromAgentRun({
      agentRun,
      groupId: 'group-orders',
      environmentId: 'env-staging',
      url: 'https://fallback.example.test',
      seed: 19,
    });
    const serialized = JSON.stringify(testCase);

    expect(testCase?.url).toBe(safeUrl);
    expect(testCase?.sourceIntent).toContain(safeUrl);
    expect(testCase?.steps[0]?.execution?.action).toEqual({ kind: 'navigate', url: safeUrl });
    expect(testCase?.steps[1]?.execution?.action).toBeUndefined();
    ['private-value', 'query-secret', 'raw', '#'].forEach((secret) => {
      expect(serialized).not.toContain(secret);
    });
  });

  it('redacts arbitrary opaque URL schemes in structured direct URL fields', () => {
    const unsafeUrl = 'custom:secret-value?token=raw#x';
    const safeUrl = 'custom:[已隐藏]';
    const agentRun = createStubAgentRun({
      mode: 'ai',
      prompt: `打开 ${unsafeUrl}`,
      runtimeDescription: 'chromium / desktop / headless / custom:fixture',
      targetEnvironment: 'staging',
      projectId: 'project-orders',
      targetUrl: unsafeUrl,
      plannedPlan: {
        title: `打开 ${unsafeUrl}`,
        summary: `确认 ${unsafeUrl} 可访问。`,
        risks: [`不要泄漏 ${unsafeUrl}。`],
        steps: [
          { action: 'navigate', title: `进入 ${unsafeUrl}`, instruction: `打开 ${unsafeUrl}`, url: unsafeUrl },
        ],
      },
    });

    const testCase = createTestCaseFromAgentRun({
      agentRun,
      groupId: 'group-orders',
      environmentId: 'env-staging',
      url: 'https://fallback.example.test',
      seed: 20,
    });
    const serialized = JSON.stringify(testCase);

    expect(testCase?.url).toBe(safeUrl);
    expect(testCase?.steps[0]?.execution?.action).toEqual({ kind: 'navigate', url: safeUrl });
    expect(testCase?.sourceIntent).toContain('custom:secret-value?token=[已隐藏]');
    ['token=raw', '#x'].forEach((secret) => {
      expect(serialized).not.toContain(secret);
    });
  });

  it('preserves CSS pseudo selectors while redacting supported URLs in quoted selector attributes', () => {
    const unsafeUrl = 'https://user:pw@example.test/orders?token=raw#code=raw2';
    const agentRun = createStubAgentRun({
      mode: 'ai',
      prompt: '检查订单筛选条件',
      runtimeDescription: 'chromium / desktop / headless / https://app.example.test',
      targetEnvironment: 'staging',
      projectId: 'project-orders',
      targetUrl: 'https://app.example.test/orders',
      plannedPlan: {
        title: '检查订单筛选条件',
        summary: '检查可交互元素。',
        risks: [],
        steps: [
          { action: 'click', title: '切换已选状态', instruction: '切换已选状态', selector: 'input:checked' },
          { action: 'wait', title: '等待第二项', instruction: '等待第二项', selector: '.item:nth-child(2)' },
          { action: 'click', title: '打开敏感链接', instruction: '打开敏感链接', selector: `a[href="${unsafeUrl}"]` },
        ],
      },
    });

    const testCase = createTestCaseFromAgentRun({
      agentRun,
      groupId: 'group-orders',
      environmentId: 'env-staging',
      url: 'https://fallback.example.test',
      seed: 21,
    });

    expect(testCase?.steps[0]?.execution?.action).toEqual({
      kind: 'click',
      locator: { selector: 'input:checked', quality: 'unresolved' },
    });
    expect(testCase?.steps[1]?.execution?.action).toEqual({
      kind: 'waitForSelector',
      locator: { selector: '.item:nth-child(2)', quality: 'weak' },
    });
    expect(testCase?.steps[2]?.execution?.action).toBeUndefined();
    expect(JSON.stringify(testCase)).not.toContain(unsafeUrl);
  });

  it('redacts every structured direct URL scheme without treating ordinary colon text as a URL', () => {
    const aboutUrl = 'about:blank#token=raw';
    const dataUrl = 'data:text/plain,private-value?token=raw';
    const opaqueUrl = 'custom:secret-value?token=raw#code=raw2';
    const fileUrl = 'file:///tmp/page.html?token=raw#code=raw2';
    const agentRun = createStubAgentRun({
      mode: 'ai',
      prompt: 'status:pending; token should be rotated',
      runtimeDescription: 'chromium / desktop / headless / https://app.example.test',
      targetEnvironment: 'staging',
      projectId: 'project-orders',
      targetUrl: opaqueUrl,
      plannedPlan: {
        title: '结构化 URL 边界',
        summary: '保留 status:pending。',
        risks: [],
        steps: [
          { action: 'navigate', title: '打开 about 页面', instruction: '打开 about 页面', url: aboutUrl },
          { action: 'navigate', title: '打开 data 页面', instruction: '打开 data 页面', url: dataUrl },
          { action: 'navigate', title: '打开自定义页面', instruction: '打开自定义页面', url: opaqueUrl },
          { action: 'navigate', title: '打开本地页面', instruction: '打开本地页面', url: fileUrl },
        ],
      },
    });

    const testCase = createTestCaseFromAgentRun({
      agentRun,
      groupId: 'group-orders',
      environmentId: 'env-staging',
      url: 'https://fallback.example.test',
      seed: 22,
    });

    expect(testCase?.sourceIntent).toBe('status:pending; token should be rotated');
    expect(testCase?.notes).toContain('status:pending');
    expect(testCase?.url).toBe('custom:[已隐藏]');
    expect(testCase?.steps.map((step) => step.execution?.action)).toEqual([
      { kind: 'navigate', url: 'about:blank' },
      { kind: 'navigate', url: 'data:[已隐藏]' },
      { kind: 'navigate', url: 'custom:[已隐藏]' },
      { kind: 'navigate', url: 'file:///tmp/page.html?token=[已隐藏]' },
    ]);
  });

  it('redacts explicit token values while preserving non-sensitive token prose', () => {
    const token = 'token-value-123';
    const agentRun = createStubAgentRun({
      mode: 'ai',
      prompt: `token should be rotated; token: ${token}`,
      runtimeDescription: 'chromium / desktop / headless / https://app.example.test',
      targetEnvironment: 'staging',
      projectId: 'project-orders',
      targetUrl: 'https://app.example.test/orders',
      plannedPlan: {
        title: 'token should be rotated',
        summary: `token: ${token}`,
        risks: [],
        steps: [{ action: 'assert', title: 'token should be rotated', instruction: `token: ${token}`, expected: '令牌策略已更新' }],
      },
    });

    const testCase = createTestCaseFromAgentRun({
      agentRun,
      groupId: 'group-orders',
      environmentId: 'env-staging',
      url: 'https://fallback.example.test',
      seed: 23,
    });

    expect(testCase?.sourceIntent).toBe('token should be rotated; token: [已隐藏]');
    expect(testCase?.name).toBe('token should be rotated');
    expect(testCase?.notes).toContain('token: [已隐藏]');
    expect(JSON.stringify(testCase)).not.toContain(token);
  });

  it('keeps ordinary sensitive-word prose while redacting explicit secret values', () => {
    const tokenProse = 'token should be rotated';
    const passwordProse = 'password must be updated';
    const password = 'hunter2';
    const bareSecret = `password ${password}`;
    const chineseExplicitSecret = `密码为 ${password}`;
    const agentRun = createStubAgentRun({
      mode: 'ai',
      prompt: `${tokenProse}; ${passwordProse}; password: ${password}`,
      runtimeDescription: 'chromium / desktop / headless / https://app.example.test',
      targetEnvironment: 'staging',
      projectId: 'project-orders',
      targetUrl: 'https://app.example.test/orders',
      plannedPlan: {
        title: tokenProse,
        summary: passwordProse,
        risks: [`password: ${password}`, bareSecret, chineseExplicitSecret],
        steps: [
          { action: 'assert', title: tokenProse, instruction: passwordProse, expected: '凭据轮换已安排' },
        ],
      },
    });

    const testCase = createTestCaseFromAgentRun({
      agentRun,
      groupId: 'group-orders',
      environmentId: 'env-staging',
      url: 'https://fallback.example.test',
      seed: 12,
    });
    const serialized = JSON.stringify(testCase);

    expect(testCase?.sourceIntent).toContain(tokenProse);
    expect(testCase?.sourceIntent).toContain(passwordProse);
    expect(testCase?.name).toBe(tokenProse);
    expect(testCase?.notes).toContain(passwordProse);
    expect(testCase?.notes).toContain('密码为 [已隐藏]');
    expect(testCase?.steps[0]).toMatchObject({
      title: tokenProse,
      body: passwordProse,
      execution: { intent: passwordProse },
    });
    expect(serialized).not.toContain(password);
  });

  it('treats common password field aliases as sensitive even without secret keywords in the prompt', () => {
    const password = 'hunter2';
    const token = 'short-token';
    const agentRun = createStubAgentRun({
      mode: 'ai',
      prompt: `登录并输入 ${password} 或 ${token}`,
      runtimeDescription: 'chromium / desktop / headless / https://app.example.test',
      targetEnvironment: 'staging',
      projectId: 'project-orders',
      targetUrl: 'https://app.example.test/orders',
      plannedPlan: {
        title: '登录后台',
        summary: `填入登录表单 ${password} 或 ${token}。`,
        risks: [],
        steps: [
          { action: 'input', title: '填写登录信息', instruction: '填入登录表单', selector: '#passwd', value: password },
          { action: 'input', title: '填写登录信息', instruction: '填入登录表单', selector: '#access_token', value: token },
        ],
      },
    });

    const testCase = createTestCaseFromAgentRun({
      agentRun,
      groupId: 'group-orders',
      environmentId: 'env-staging',
      url: 'https://fallback.example.test',
      seed: 6,
    });

    expect(JSON.stringify(testCase)).not.toContain(password);
    expect(JSON.stringify(testCase)).not.toContain(token);
    expect(testCase?.steps[0]?.body).toBe('在 #passwd 中输入敏感值（已隐藏）');
    expect(testCase?.steps[0]?.execution?.action).toBeUndefined();
    expect(testCase?.steps[1]?.body).toBe('在 #access_token 中输入敏感值（已隐藏）');
    expect(testCase?.steps[1]?.execution?.action).toBeUndefined();
  });

  it('redacts input values from filtered runtime-only Agent plan steps', () => {
    const password = 'runtime-secret';
    const agentRun = createStubAgentRun({
      mode: 'ai',
      prompt: `登录并输入 ${password}`,
      runtimeDescription: 'chromium / desktop / headless / https://app.example.test',
      targetEnvironment: 'staging',
      projectId: 'project-orders',
      targetUrl: 'https://app.example.test/orders',
      plannedPlan: {
        title: `登录 ${password}`,
        summary: `运行时输入 ${password}。`,
        risks: [],
        steps: [
          { action: 'navigate', title: '进入登录页', instruction: '进入登录页', url: 'https://app.example.test/login' },
        ],
      },
    });
    agentRun.plan.steps.forEach((step) => {
      delete step.sourceStepType;
    });
    agentRun.plan.steps.find((step) => step.title === '进入登录页')!.sourceStepType = 'ai';
    agentRun.plan.steps.push({
      id: 'runtime-password-input',
      action: 'input',
      title: '运行时凭据输入',
      instruction: '输入运行时凭据',
      selector: '#password',
      value: password,
    });

    const testCase = createTestCaseFromAgentRun({
      agentRun,
      groupId: 'group-orders',
      environmentId: 'env-staging',
      url: 'https://fallback.example.test',
      seed: 7,
    });

    expect(testCase?.steps).toHaveLength(1);
    expect(JSON.stringify(testCase)).not.toContain(password);
  });

  it('derives model requirements from structured steps and keeps incomplete Agent actions model-backed', () => {
    expect(studio.getTestStepModelRequirement({
      id: 'navigate',
      type: 'ai',
      title: '打开订单页',
      body: '打开订单页',
      execution: {
        schemaVersion: 2,
        intent: '进入订单页',
        reviewStatus: 'confirmed',
        actionRisk: 'low',
        action: { kind: 'navigate', url: 'https://example.test/orders' },
      },
    })).toBe('none');
    expect(studio.getTestStepModelRequirement({
      id: 'unreviewed-navigate',
      type: 'ai',
      title: '打开订单页',
      body: '打开订单页',
      execution: {
        schemaVersion: 2,
        intent: '进入订单页',
        reviewStatus: 'needsReview',
        actionRisk: 'low',
        action: { kind: 'navigate', url: 'https://example.test/orders' },
      },
    })).toBe('required');
    expect(studio.getTestStepModelRequirement({
      id: 'semantic-assert',
      type: 'aiAssert',
      title: '确认订单状态',
      body: '验证页面显示订单已创建',
    })).toBe('required');
    expect(studio.getTestStepModelRequirement({
      id: 'explicit-assert',
      type: 'aiAssert',
      title: '确认订单状态',
      body: '页面包含订单已创建',
      execution: {
        schemaVersion: 2,
        intent: '确认订单状态',
        reviewStatus: 'confirmed',
        actionRisk: 'low',
        assertion: { id: 'assert-order-created', version: 1, kind: 'pageContains', expected: '订单已创建' },
      },
    })).toBe('none');
    expect(studio.getTestStepModelRequirement({
      id: 'unreviewed-explicit-assert',
      type: 'aiAssert',
      title: '确认订单状态',
      body: '页面包含订单已创建',
      execution: {
        schemaVersion: 2,
        intent: '确认订单状态',
        reviewStatus: 'needsReview',
        actionRisk: 'low',
        assertion: { id: 'assert-order-created', version: 1, kind: 'pageContains', expected: '订单已创建' },
      },
    })).toBe('required');
    expect(studio.getTestStepModelRequirement({
      id: 'manual',
      type: 'manual',
      title: '人工确认',
      body: '确认视觉状态',
    })).toBe('notApplicable');

    const agentRun = createStubAgentRun({
      mode: 'ai',
      prompt: '提交订单',
      runtimeDescription: 'chromium / desktop / headless / https://app.example.test',
      targetEnvironment: 'staging',
      projectId: 'project-orders',
      targetUrl: 'https://app.example.test/orders',
      plannedPlan: {
        title: '提交订单',
        summary: '尝试点击语义目标。',
        risks: [],
        steps: [
          { action: 'click', title: '提交订单', instruction: '点击提交订单按钮', target: '提交订单按钮' },
          { action: 'input', title: '填写邮箱', instruction: '填写测试邮箱', value: 'qa@example.test' },
        ],
      },
    });
    const testCase = createTestCaseFromAgentRun({
      agentRun,
      groupId: 'group-orders',
      environmentId: 'env-staging',
      url: 'https://fallback.example.test',
      seed: 4,
    });

    expect(testCase?.steps.map((step) => step.execution?.action)).toEqual([undefined, undefined]);
    expect(testCase?.steps.map((step) => studio.getTestStepModelRequirement(step))).toEqual(['required', 'required']);
  });

  it('generates traceable test paths from concrete PRD requirements', () => {
    const document = createPrdDocumentAsset({
      name: 'member-management.md',
      kind: 'markdown',
      size: 240,
      sourceText: `# 成员管理
- 管理员必须能新增成员，并在列表中展示邮箱与状态。
- 系统默认按创建时间倒序排序，支持按状态筛选。
- 删除成员前必须二次确认，取消后不得改变列表。
- 普通成员不能看到删除入口。`,
    });

    expect(document.generatedPaths).toHaveLength(4);
    expect(document.generatedPaths.map((path) => path.sourceExcerpt)).toEqual([
      '成员管理 - 管理员必须能新增成员，并在列表中展示邮箱与状态。',
      '成员管理 - 系统默认按创建时间倒序排序，支持按状态筛选。',
      '成员管理 - 删除成员前必须二次确认，取消后不得改变列表。',
      '成员管理 - 普通成员不能看到删除入口。',
    ]);
    expect(document.generatedPaths.map((path) => path.priority)).toEqual(['P0', 'P1', 'P0', 'P0']);
    expect(document.generatedPaths[0]).toMatchObject({
      groupName: '账号权限',
      title: expect.stringContaining('成员管理：管理员必须能新增成员'),
      steps: [
        expect.objectContaining({ type: 'ai', title: '进入对应功能页面' }),
        expect.objectContaining({ type: 'ai', body: expect.stringContaining('管理员必须能新增成员') }),
        expect.objectContaining({ type: 'aiAssert', body: expect.stringContaining('展示邮箱与状态') }),
      ],
    });
  });

  it('deduplicates repeated PRD clauses and keeps the generic fallback for unstructured text', () => {
    const duplicateDocument = createPrdDocumentAsset({
      name: 'duplicate.md',
      kind: 'markdown',
      size: 160,
      sourceText: `# 订单管理
- 用户必须填写收货地址后才能提交订单。
- 用户必须填写收货地址后才能提交订单。`,
    });
    const inlineDocument = createPrdDocumentAsset({
      name: 'inline-requirements.md',
      kind: 'markdown',
      size: 120,
      sourceText: '# 订单列表\n系统支持按状态筛选；系统默认按创建时间倒序排序。',
    });
    const fallbackDocument = createPrdDocumentAsset({
      name: 'overview.txt',
      kind: 'text',
      size: 100,
      sourceText: '这份材料说明本次迭代的整体背景、范围和体验目标，供团队讨论使用。',
    });

    expect(duplicateDocument.generatedPaths).toHaveLength(1);
    expect(duplicateDocument.generatedPaths[0]?.sourceExcerpt).toBe('订单管理 - 用户必须填写收货地址后才能提交订单。');
    expect(inlineDocument.generatedPaths.map((path) => path.sourceExcerpt)).toEqual([
      '订单列表 - 系统支持按状态筛选',
      '订单列表 - 系统默认按创建时间倒序排序。',
    ]);
    expect(fallbackDocument.generatedPaths).toHaveLength(1);
    expect(fallbackDocument.generatedPaths[0]).toMatchObject({ groupName: 'PRD 主路径' });
    expect(fallbackDocument.generatedPaths[0]?.sourceExcerpt).toBeUndefined();
  });

  it('keeps stable PRD path references when assets are renamed or a document is re-analyzed', () => {
    const project = createEmptyProject(1);
    const document = createPrdDocumentAsset({
      name: 'member-management.md',
      kind: 'markdown',
      size: 120,
      sourceText: '# 成员管理\n- 管理员必须能新增成员，并在列表中展示邮箱与状态。',
    });
    const path = document.generatedPaths[0]!;
    const testCase = createTestCaseFromGeneratedPath({
      path,
      documentId: document.id,
      groupId: project.groups[0]!.id,
      environmentId: project.environments[0]!.id,
      url: project.defaultUrl,
      seed: 1,
    });
    const recording = createRecordingFromGeneratedPath({
      path,
      documentId: document.id,
      groupId: project.groups[0]!.id,
      environmentId: project.environments[0]!.id,
      startUrl: project.defaultUrl,
      seed: 1,
    });
    const reanalyzedDocument = updatePrdDocumentAnalysis({
      ...document,
      sourceText: '# 成员管理\n- 管理员 必须能新增成员，并在列表中展示邮箱与状态。',
    });
    const reanalyzedPath = reanalyzedDocument.generatedPaths[0]!;

    expect(testCase.prdPath).toEqual({ documentId: document.id, pathId: path.id });
    expect(recording.prdPath).toEqual({ documentId: document.id, pathId: path.id });
    expect(reanalyzedPath.id).toBe(path.id);
    expect(isTestCaseLinkedToGeneratedPath({ ...testCase, name: '已改名用例' }, document.id, reanalyzedPath)).toBe(true);
    expect(isRecordingLinkedToGeneratedPath({ ...recording, name: '已改名录制' }, document.id, reanalyzedPath)).toBe(true);
    expect(isTestCaseLinkedToGeneratedPath({ ...testCase, prdPath: undefined }, document.id, path)).toBe(true);
    expect(isRecordingLinkedToGeneratedPath({ ...recording, prdPath: undefined }, document.id, path)).toBe(true);
    expect(isTestCaseLinkedToGeneratedPath(testCase, 'doc-other', reanalyzedPath)).toBe(false);
    expect(isRecordingLinkedToGeneratedPath(recording, 'doc-other', reanalyzedPath)).toBe(false);
  });

  it('preserves PRD and recording business intent in V2 case drafts without promoting free text to actions', () => {
    const project = createEmptyProject(1);
    const document = createPrdDocumentAsset({
      name: 'orders.md',
      kind: 'markdown',
      size: 120,
      sourceText: '# 订单\n- 用户提交订单后必须展示成功提示。',
    });
    const path = document.generatedPaths[0]!;
    const prdCase = createTestCaseFromGeneratedPath({
      path,
      documentId: document.id,
      groupId: project.groups[0]!.id,
      environmentId: project.environments[0]!.id,
      url: project.defaultUrl,
      seed: 1,
    });
    const recording = createRecordingFromGeneratedPath({
      path,
      documentId: document.id,
      groupId: project.groups[0]!.id,
      environmentId: project.environments[0]!.id,
      startUrl: project.defaultUrl,
      seed: 1,
    });
    const recordingCase = createTestCaseFromRecording({ recording, seed: 2 });

    expect(prdCase).toMatchObject({
      schemaVersion: 2,
      source: 'prd',
      sourceIntent: path.sourceExcerpt,
      prdPath: { documentId: document.id, pathId: path.id },
    });
    expect(recordingCase).toMatchObject({
      schemaVersion: 2,
      source: 'recording',
      sourceIntent: recording.comparisonGoal,
    });
    expect(recordingCase.steps[1]).toMatchObject({ type: 'aiAssert', body: recording.comparisonGoal });
    expect(recordingCase.steps[1]?.execution).toBeUndefined();
  });

  it('starts with an empty workspace and removes the legacy demo workspace during hydration', () => {
    const initialState = createInitialStudioState();
    const hydrated = hydrateStudioState(createDemoStudioState());

    expect(initialState.projects).toEqual([]);
    expect(initialState.recentRuns).toEqual([]);
    expect(initialState.chatEntries).toEqual([]);
    expect(hydrated.projects).toEqual([]);
    expect(hydrated.recentRuns).toEqual([]);
    expect(hydrated.chatEntries).toEqual([]);
    expect(hydrated.selectedProjectId).toBe('');
  });

  it('keeps persisted user projects while removing only the legacy demo workspace', () => {
    const userProject = { ...createEmptyProject(1), id: 'project-user' };
    const legacyState = createDemoStudioState();
    const hydrated = hydrateStudioState({
      ...legacyState,
      projects: [legacyState.projects[0]!, userProject],
      selectedProjectId: 'project-demo',
    });

    expect(hydrated.projects.map((project) => project.id)).toEqual(['project-user']);
    expect(hydrated.selectedProjectId).toBe('project-user');
  });

  it('migrates legacy test cases to schema version 2 without changing their assets', () => {
    const project = createEmptyProject(1);
    const legacyCase = {
      id: 'case-legacy-schema',
      kind: 'scenario' as const,
      groupId: project.groups[0]!.id,
      environmentId: project.environments[0]!.id,
      source: 'prd' as const,
      prdPath: { documentId: 'doc-orders', pathId: 'path-checkout' },
      sourceIntent: '验证结算页关键状态',
      name: '结算页回归',
      category: '订单',
      lastEdited: '刚刚',
      url: project.defaultUrl,
      notes: '旧格式用例',
      steps: [{ id: 'step-legacy-schema', type: 'aiAssert' as const, title: '确认状态', body: '页面显示订单已创建' }],
    };

    const hydrated = hydrateStudioState({
      ...createInitialStudioState(),
      projects: [{ ...project, testCases: [legacyCase] }],
      selectedProjectId: project.id,
    });

    expect(hydrated.projects[0]?.testCases[0]).toMatchObject({
      schemaVersion: 2,
      id: legacyCase.id,
      source: 'prd',
      prdPath: legacyCase.prdPath,
      sourceIntent: legacyCase.sourceIntent,
      steps: legacyCase.steps,
    });
  });

  it('keeps legacy test steps unchanged and discards malformed V2 execution drafts during hydration', () => {
    const project = createEmptyProject(8);
    const legacyStep = {
      id: 'step-legacy',
      type: 'ai' as const,
      title: '旧自然语言步骤',
      body: '打开订单页并检查列表。',
    };
    const validV2Step = {
      id: 'step-v2-valid',
      type: 'ai' as const,
      title: '打开订单页',
      body: '打开订单页',
      execution: {
        schemaVersion: 2 as const,
        intent: '进入订单页',
        reviewStatus: 'needsReview' as const,
        actionRisk: 'low' as const,
        action: { kind: 'navigate' as const, url: 'https://example.test/orders' },
      },
    };
    const malformedV2Step = {
      id: 'step-v2-malformed',
      type: 'ai' as const,
      title: '保留旧文本',
      body: '保留旧文本',
      execution: {
        schemaVersion: 2,
        intent: '错误 URL 不能被执行',
        reviewStatus: 'needsReview',
        actionRisk: 'low',
        action: { kind: 'navigate', url: '' },
      },
    } as unknown as typeof validV2Step;
    const malformedAssertionStep = {
      id: 'step-v2-bad-assertion',
      type: 'aiAssert' as const,
      title: '保留断言文本',
      body: '保留断言文本',
      execution: {
        schemaVersion: 2,
        intent: '错误断言不能被执行',
        reviewStatus: 'needsReview',
        actionRisk: 'low',
        assertion: { id: 'bad-assertion', version: 1, kind: 'pageContains', expected: '' },
      },
    } as unknown as typeof validV2Step;
    const testCase = {
      id: 'case-v2-hydration',
      kind: 'scenario' as const,
      groupId: project.groups[0]!.id,
      environmentId: project.environments[0]!.id,
      source: 'manual' as const,
      name: '兼容性用例',
      category: '订单',
      lastEdited: '刚刚',
      url: project.defaultUrl,
      notes: '',
      sourceIntent: 42 as never,
      steps: [legacyStep, validV2Step, malformedV2Step, malformedAssertionStep],
    };

    const hydrated = hydrateStudioState({
      ...createInitialStudioState(),
      projects: [{ ...project, testCases: [testCase] },],
      selectedProjectId: project.id,
    });
    const steps = hydrated.projects[0]?.testCases[0]?.steps;

    expect(steps?.[0]).toEqual(legacyStep);
    expect(steps?.[1]?.execution?.action).toEqual({ kind: 'navigate', url: 'https://example.test/orders' });
    expect(steps?.[2]).toMatchObject({ id: 'step-v2-malformed', body: '保留旧文本' });
    expect(steps?.[2]?.execution).toBeUndefined();
    expect(steps?.[3]).toMatchObject({ id: 'step-v2-bad-assertion', body: '保留断言文本' });
    expect(steps?.[3]?.execution).toBeUndefined();
    expect(hydrated.projects[0]?.testCases[0]?.sourceIntent).toBeUndefined();
  });

  it('maps legacy locator-quality values into the four-level V2 contract during hydration', () => {
    const project = createEmptyProject(9);
    const execution = (id: string, selector: string, quality: string) => ({
      id,
      type: 'ai' as const,
      title: id,
      body: id,
      execution: {
        schemaVersion: 2,
        intent: id,
        reviewStatus: 'needsReview',
        actionRisk: 'low',
        action: { kind: 'click', locator: { selector, quality } },
      },
    });
    const hydrated = hydrateStudioState({
      ...createInitialStudioState(),
      projects: [{
        ...project,
        testCases: [{
          ...project.testCases[0]!,
          steps: [
            execution('legacy-fragile', '.row:nth-child(2)', 'fragile'),
            execution('legacy-unknown', '.submit', 'unknown'),
            execution('current-strong', '[aria-label="提交订单"]', 'strong'),
            execution('invalid-quality', '#submit', 'unsafe'),
          ] as never,
        }],
      }],
      selectedProjectId: project.id,
    });

    const steps = hydrated.projects[0]?.testCases[0]?.steps;
    expect(steps?.[0]?.execution?.action).toEqual({
      kind: 'click',
      locator: { selector: '.row:nth-child(2)', quality: 'weak' },
    });
    expect(steps?.[1]?.execution?.action).toEqual({
      kind: 'click',
      locator: { selector: '.submit', quality: 'unresolved' },
    });
    expect(steps?.[2]?.execution?.action).toEqual({
      kind: 'click',
      locator: { selector: '[aria-label="提交订单"]', quality: 'strong' },
    });
    expect(steps?.[3]).toMatchObject({ id: 'invalid-quality', body: 'invalid-quality' });
    expect(steps?.[3]?.execution).toBeUndefined();
  });

  it('discards non-object persisted test steps while keeping adjacent legacy and V2 steps', () => {
    const project = createEmptyProject(9);
    const legacyStep = {
      id: 'step-legacy',
      type: 'ai' as const,
      title: '旧自然语言步骤',
      body: '打开订单页并检查列表。',
    };
    const validV2Step = {
      id: 'step-v2-valid',
      type: 'ai' as const,
      title: '打开订单页',
      body: '打开订单页',
      execution: {
        schemaVersion: 2 as const,
        intent: '进入订单页',
        reviewStatus: 'needsReview' as const,
        actionRisk: 'low' as const,
        action: { kind: 'navigate' as const, url: 'https://example.test/orders' },
      },
    };
    const testCase = {
      id: 'case-invalid-step-hydration',
      kind: 'scenario' as const,
      groupId: project.groups[0]!.id,
      environmentId: project.environments[0]!.id,
      source: 'manual' as const,
      name: '兼容性用例',
      category: '订单',
      lastEdited: '刚刚',
      url: project.defaultUrl,
      notes: '',
      steps: [null, 'bad', 42, legacyStep, validV2Step],
    };

    const hydrated = hydrateStudioState({
      ...createInitialStudioState(),
      projects: [{ ...project, testCases: [testCase] as unknown as typeof project.testCases }],
      selectedProjectId: project.id,
    });
    const steps = hydrated.projects[0]?.testCases[0]?.steps;

    expect(steps).toHaveLength(2);
    expect(steps?.[0]).toEqual(legacyStep);
    expect(steps?.[1]?.execution?.action).toEqual({ kind: 'navigate', url: 'https://example.test/orders' });
  });

  it('prunes invalid PRD triage records while preserving valid local governance notes', () => {
    const project = createEmptyProject(1);
    const document = createPrdDocumentAsset({
      name: 'member-management.md', kind: 'markdown', size: 120,
      sourceText: '# 成员管理\n- 管理员必须能新增成员。',
    });
    const path = document.generatedPaths[0]!;
    const triage = prunePrdCoverageTriage([document], [
      { documentId: document.id, pathId: path.id, target: 'case', status: 'deferred', note: '等待接口稳定', updatedAt: '2026-08-04T00:00:00.000Z' },
      { documentId: document.id, pathId: path.id, target: 'recording', status: 'ignored', note: ' ', updatedAt: '2026-08-04T00:00:00.000Z' },
      { documentId: document.id, pathId: 'removed-path', target: 'case', status: 'ignored', note: '已移除', updatedAt: '2026-08-04T00:00:00.000Z' },
    ]);

    expect(triage).toEqual([
      expect.objectContaining({ documentId: document.id, pathId: path.id, target: 'case', status: 'deferred' }),
    ]);
    expect(prunePrdCoverageTriage([{ ...document, generatedPaths: [] }], triage)).toEqual([]);
    const hydrated = hydrateStudioState({
      ...createInitialStudioState(),
      projects: [{ ...project, documents: [document], prdCoverageTriage: [...triage, {
        documentId: document.id,
        pathId: 'stale-path',
        target: 'recording',
        status: 'ignored',
        note: '已删除',
        updatedAt: '2026-08-04T00:00:00.000Z',
      }] }],
      selectedProjectId: project.id,
    });
    expect(hydrated.projects[0]?.prdCoverageTriage).toEqual(triage);
    expect(project.prdCoverageTriage).toEqual([]);
  });

  it('derives cross-run risk from complete project history without allowing running records to replace a terminal result', () => {
    const demoProject = createDemoStudioState().projects[0]!;
    const unrunCase = { ...demoProject.testCases[0]!, id: 'case-never-executed', name: '从未执行用例' };
    const project = { ...demoProject, testCases: [...demoProject.testCases, unrunCase] };
    const [verifiedCase, waitingCase, failedCase] = project.testCases;
    const environmentId = project.environments[0]!.id;
    const makeRun = (id: string, testCaseId: string, status: 'passed' | 'failed' | 'neutral' | 'running', startedAt?: string) => ({
      id, name: id, status, duration: '00:00:01', summary: id, projectId: project.id, testCaseId, environmentId,
      ...(startedAt ? { startedAt } : {}),
    });
    const risk = deriveRunCoverageRisk(project, [
      makeRun('waiting-newest', waitingCase!.id, 'neutral'),
      makeRun('waiting-old', waitingCase!.id, 'failed'),
      makeRun('failed-terminal', failedCase!.id, 'failed', '2026-08-02T00:00:00.000Z'),
      makeRun('failed-running', failedCase!.id, 'running', '2026-08-03T00:00:00.000Z'),
      makeRun('verified-passed', verifiedCase!.id, 'passed', '2026-08-03T00:00:00.000Z'),
      makeRun('verified-old-failed', verifiedCase!.id, 'failed', '2026-08-02T00:00:00.000Z'),
    ]);

    expect(risk).toMatchObject({ total: project.testCases.length, verified: 1 });
    expect(risk.risks).toEqual(expect.arrayContaining([
      expect.objectContaining({ testCaseId: waitingCase!.id, status: 'neutral' }),
      expect.objectContaining({ testCaseId: failedCase!.id, status: 'failed', latestRun: expect.objectContaining({ id: 'failed-terminal' }) }),
      expect.objectContaining({ testCaseId: unrunCase.id, status: 'neverExecuted' }),
    ]));
  });

  it('derives a bounded, safe project report from full history and PRD coverage', () => {
    const project = createDemoStudioState().projects[0]!;
    const testCase = { ...project.testCases[0]!, id: 'case-report', name: '报告用例' };
    const document = createPrdDocumentAsset({
      name: 'report.md', kind: 'markdown', size: 120,
      sourceText: '# 成员管理\n- 管理员必须能新增成员，并在列表中展示邮箱与状态。',
    });
    const path = document.generatedPaths[0]!;
    const reportProject = {
      ...project,
      testCases: [testCase],
      documents: [document],
      prdCoverageTriage: [{
        documentId: document.id,
        pathId: path.id,
        target: 'recording' as const,
        status: 'deferred' as const,
        note: '等待录制环境',
        updatedAt: '2026-08-04T00:00:00.000Z',
      }],
    };
    const environmentId = reportProject.environments[0]!.id;
    const history = Array.from({ length: 22 }, (_, index) => ({
      id: `run-report-${index}`,
      name: `历史运行 ${index}`,
      status: index % 2 ? 'failed' as const : 'neutral' as const,
      duration: '00:00:01',
      summary: `摘要 ${index}`,
      projectId: reportProject.id,
      testCaseId: testCase.id,
      environmentId,
      startedAt: index === 21 ? undefined : `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    }));
    const report = deriveProjectRunReport(reportProject, history, [{
      id: 'run-report-20',
      projectId: reportProject.id,
      testCaseId: testCase.id,
      environmentId,
      title: '历史运行 20',
      status: 'neutral',
      startedAt: '2026-08-21T00:00:00.000Z',
      duration: '00:00:01',
      summary: '摘要 20',
      failureReason: '等待人工确认',
      logs: [],
      steps: [],
      artifacts: [{ id: 'artifact-safe', type: 'report', label: '失败报告', path: '/secret/local-path/report.html' }],
    }], '2026-08-04T00:00:00.000Z');

    expect(report).toMatchObject({
      projectName: reportProject.name,
      runStats: { failed: 11, neutral: 11 },
      prdCoverage: { paths: 1, targets: { recording: { deferred: 1 } } },
    });
    expect(report.problemRuns).toHaveLength(20);
    expect(report.problemRuns[0]).toMatchObject({ id: 'run-report-20', failureReason: '等待人工确认', artifactLabels: ['失败报告'] });
    expect(JSON.stringify(report)).not.toContain('/secret/local-path');
    expect(JSON.stringify(report)).not.toContain('credentialRefs');
  });

  it('resets persisted browser sessions because they cannot survive an app restart', () => {
    const project = createEmptyProject(1);
    const hydrated = hydrateStudioState({
      ...createInitialStudioState(),
      projects: [project],
      selectedProjectId: project.id,
      browserSession: {
        id: 'session-stale',
        status: 'error',
        projectId: project.id,
        environmentId: project.environments[0]!.id,
        currentUrl: project.defaultUrl,
        pageTitle: 'Stale browser',
        message: "浏览器启动失败：browserType.launch: Executable doesn't exist",
        updatedAt: '2026-08-02T00:00:00.000Z',
      },
    });

    expect(hydrated.browserSession).toMatchObject({
      id: 'session-idle',
      status: 'idle',
      currentUrl: '',
      pageTitle: '尚未启动浏览器',
      message: '选择项目环境后启动受控浏览器会话。',
    });
  });

  it('normalizes persisted visual diff masks and discards invalid regions', () => {
    const demoState = createDemoStudioState();
    const rawState = {
      ...demoState,
      projects: [{ ...demoState.projects[0]!, id: 'project-user' }],
      selectedProjectId: 'project-user',
    };
    const recording = rawState.projects[0]!.recordings[0]!;
    recording.visualDiffMasks = [
      { id: 'clock', label: '实时钟', x: 95, y: -2, width: 20, height: 30 },
      { id: 'invalid', label: '无效区域', x: Number.NaN, y: 0, width: 10, height: 10 },
      { id: 'empty', label: '空区域', x: 0, y: 0, width: 0, height: 10 },
    ];

    const hydrated = hydrateStudioState(rawState);

    expect(hydrated.projects[0]!.recordings[0]!.visualDiffMasks).toEqual([
      { id: 'clock', label: '实时钟', x: 95, y: 0, width: 5, height: 30 },
    ]);
  });

  it('identifies test cases that can run through the Agent workflow runtime', () => {
    const project = createEmptyProject(1);
    const baseCase = {
      id: 'case-agent',
      kind: 'scenario' as const,
      groupId: project.groups[0].id,
      environmentId: project.environments[0].id,
      source: 'manual' as const,
      name: 'Agent 用例',
      category: '核心链路',
      lastEdited: '刚刚',
      url: project.defaultUrl,
      notes: '',
    };

    expect(
      isAgentRunnableTestCase({
        ...baseCase,
        steps: [{ id: 'step-ai', type: 'ai', title: '点击登录', body: '点击登录按钮' }],
      }),
    ).toBe(true);
    expect(
      isAgentRunnableTestCase({
        ...baseCase,
        steps: [
          {
            id: 'step-confirmed-assertion',
            type: 'aiAssert',
            title: '确认订单已创建',
            body: '确认页面包含订单已创建',
            execution: {
              schemaVersion: 2,
              intent: '确认订单已创建',
              reviewStatus: 'confirmed',
              actionRisk: 'low',
              assertion: { id: 'assert-order-created', version: 1, kind: 'pageContains', expected: '订单已创建' },
            },
          },
        ],
      }),
    ).toBe(false);
    expect(
      isAgentRunnableTestCase({
        ...baseCase,
        steps: [{ id: 'step-manual', type: 'manual', title: '人工检查', body: '确认状态' }],
      }),
    ).toBe(false);
    expect(
      isAgentRunnableTestCase({
        ...baseCase,
        steps: [
          { id: 'step-legacy-ai', type: 'ai', title: '登录', body: '使用语义步骤登录' },
          {
            id: 'step-confirmed-click',
            type: 'ai',
            title: '提交订单',
            body: '点击提交订单',
            execution: {
              schemaVersion: 2,
              intent: '点击提交订单',
              reviewStatus: 'confirmed',
              actionRisk: 'medium',
              action: {
                kind: 'click',
                locator: { selector: '#submit-order', quality: 'acceptable' },
              },
            },
          },
        ],
      }),
    ).toBe(false);
    expect(
      isAgentRunnableTestCase({
        ...baseCase,
        steps: [
          {
            id: 'step-confirmed-input',
            type: 'ai',
            title: '填写邮箱',
            body: '填写测试邮箱',
            execution: {
              schemaVersion: 2,
              intent: '填写测试邮箱',
              reviewStatus: 'confirmed',
              actionRisk: 'medium',
              action: {
                kind: 'input',
                locator: { selector: '#email', quality: 'acceptable' },
                value: 'qa@example.test',
              },
            },
          },
        ],
      }),
    ).toBe(false);
    expect(
      isAgentRunnableTestCase({
        ...baseCase,
        steps: [
          {
            id: 'step-confirmed-select',
            type: 'ai',
            title: '选择区域',
            body: '选择测试区域',
            execution: {
              schemaVersion: 2,
              intent: '选择测试区域',
              reviewStatus: 'confirmed',
              actionRisk: 'medium',
              action: {
                kind: 'select',
                locator: { selector: '#region', quality: 'acceptable' },
                value: 'shanghai',
              },
            },
          },
        ],
      }),
    ).toBe(false);
    expect(
      isAgentRunnableTestCase({
        ...baseCase,
        steps: [
          {
            id: 'step-needs-review-input',
            type: 'ai',
            title: '填写邮箱',
            body: '填写测试邮箱',
            execution: {
              schemaVersion: 2,
              intent: '填写测试邮箱',
              reviewStatus: 'needsReview',
              actionRisk: 'medium',
              action: {
                kind: 'input',
                locator: { selector: '#email', quality: 'acceptable' },
                value: 'qa@example.test',
              },
            },
          },
        ],
      }),
    ).toBe(true);
    [{ kind: 'unknown' }, 'unknown'].forEach((action) => {
      expect(
        isAgentRunnableTestCase({
          ...baseCase,
          steps: [
            {
              id: 'step-confirmed-malformed-action',
              type: 'ai',
              title: '确认的畸形步骤',
              body: '不应通过 Agent Workflow 执行',
              execution: {
                schemaVersion: 2,
                intent: '确认的畸形步骤',
                reviewStatus: 'confirmed',
                actionRisk: 'unknown',
                action: action as never,
              },
            },
          ],
        }),
      ).toBe(false);
    });
  });

  it('projects confirmed deterministic actions into structured Agent plan steps', () => {
    const confirmedAction = (action: NonNullable<studio.TestStepDraft['execution']>['action']) => ({
      id: `step-${action!.kind}`,
      type: 'ai' as const,
      title: `${action!.kind} 标题`,
      body: `${action!.kind} 说明`,
      execution: {
        schemaVersion: 2 as const,
        intent: `${action!.kind} 意图`,
        reviewStatus: 'confirmed' as const,
        actionRisk: 'low' as const,
        action: action!,
      },
    });

    expect(
      getConfirmedDeterministicTestStep(confirmedAction({ kind: 'navigate', url: 'https://example.test/orders' })),
    ).toEqual({
      action: 'navigate',
      title: 'navigate 标题',
      instruction: 'navigate 说明',
      url: 'https://example.test/orders',
    });
    expect(
      getConfirmedDeterministicTestStep(
        confirmedAction({ kind: 'click', locator: { selector: '#submit-order', quality: 'acceptable' } }),
      ),
    ).toEqual({
      action: 'click',
      title: 'click 标题',
      instruction: 'click 说明',
      selector: '#submit-order',
    });
    expect(
      getConfirmedDeterministicTestStep(
        confirmedAction({
          kind: 'waitForSelector',
          locator: { selector: '[data-ready]', quality: 'acceptable' },
          timeoutMs: 2_000,
        }),
      ),
    ).toEqual({
      action: 'wait',
      title: 'waitForSelector 标题',
      instruction: 'waitForSelector 说明',
      selector: '[data-ready]',
      timeoutMs: 2_000,
    });
    expect(
      getConfirmedDeterministicTestStep(confirmedAction({ kind: 'waitForTimeout', timeoutMs: 800 })),
    ).toEqual({
      action: 'wait',
      title: 'waitForTimeout 标题',
      instruction: 'waitForTimeout 说明',
      timeoutMs: 800,
    });
    expect(
      getConfirmedDeterministicTestStep(
        confirmedAction({ kind: 'scrollTo', locator: { selector: '#summary', quality: 'acceptable' } }),
      ),
    ).toEqual({
      action: 'scroll',
      title: 'scrollTo 标题',
      instruction: 'scrollTo 说明',
      selector: '#summary',
    });
    expect(
      getConfirmedDeterministicTestStep(
        confirmedAction({ kind: 'click', locator: { selector: '.submit', quality: 'unresolved' } }),
      ),
    ).toBeUndefined();
  });

  it('accepts only confirmed and complete V2 explicit assertions', () => {
    const confirmedAssertion = (assertion: NonNullable<studio.TestStepDraft['execution']>['assertion']) => ({
      id: `step-${assertion!.kind}`,
      type: 'aiAssert' as const,
      title: `${assertion!.kind} 标题`,
      body: `${assertion!.kind} 说明`,
      execution: {
        schemaVersion: 2 as const,
        intent: `${assertion!.kind} 意图`,
        reviewStatus: 'confirmed' as const,
        actionRisk: 'low' as const,
        assertion: assertion!,
      },
    });

    expect(
      getConfirmedExplicitTestAssertion(
        confirmedAssertion({ id: 'assert-page', version: 1, kind: 'pageContains', expected: '订单已创建' }),
      ),
    ).toEqual({ id: 'assert-page', version: 1, kind: 'pageContains', expected: '订单已创建' });
    expect(
      getConfirmedExplicitTestAssertion(
        confirmedAssertion({
          id: 'assert-visible',
          version: 1,
          kind: 'locatorVisible',
          locator: { selector: '#orders', quality: 'acceptable' },
        }),
      ),
    ).toEqual({
      id: 'assert-visible',
      version: 1,
      kind: 'locatorVisible',
      locator: { selector: '#orders', quality: 'acceptable' },
    });
    expect(
      getConfirmedExplicitTestAssertion({
        ...confirmedAssertion({ id: 'assert-page', version: 1, kind: 'pageContains', expected: '订单已创建' }),
        execution: {
          ...confirmedAssertion({ id: 'assert-page', version: 1, kind: 'pageContains', expected: '订单已创建' }).execution,
          reviewStatus: 'needsReview',
        },
      }),
    ).toBeUndefined();
    expect(
      getConfirmedExplicitTestAssertion(
        confirmedAssertion({
          id: 'assert-unresolved',
          version: 1,
          kind: 'locatorVisible',
          locator: { selector: '.submit', quality: 'unresolved' },
        }),
      ),
    ).toBeUndefined();
    const malformedAssertion = {
      ...confirmedAssertion({ id: 'assert-page', version: 1, kind: 'pageContains', expected: '订单已创建' }),
      execution: {
        ...confirmedAssertion({ id: 'assert-page', version: 1, kind: 'pageContains', expected: '订单已创建' }).execution,
        assertion: { id: 42, version: 1, kind: 'pageContains', expected: 42 } as never,
      },
    };
    expect(() => getConfirmedExplicitTestAssertion(malformedAssertion)).not.toThrow();
    expect(getConfirmedExplicitTestAssertion(malformedAssertion)).toBeUndefined();
    expect(
      getConfirmedExplicitTestAssertion({
        ...confirmedAssertion({ id: 'assert-page', version: 1, kind: 'pageContains', expected: '订单已创建' }),
        type: 'ai',
      }),
    ).toBeUndefined();
    expect(
      getConfirmedExplicitTestAssertion({
        ...confirmedAssertion({ id: 'assert-page', version: 1, kind: 'pageContains', expected: '订单已创建' }),
        execution: {
          ...confirmedAssertion({ id: 'assert-page', version: 1, kind: 'pageContains', expected: '订单已创建' }).execution,
          assertion: { id: 'assert-invalid', version: 1, kind: 'locatorTextContains', expected: '已创建' } as never,
        },
      }),
    ).toBeUndefined();
  });

  it('rejects unconfirmed, unsupported, malformed, and non-AI deterministic steps', () => {
    const confirmedClick = {
      id: 'step-click',
      type: 'ai' as const,
      title: '提交订单',
      body: '点击提交订单',
      execution: {
        schemaVersion: 2 as const,
        intent: '点击提交订单',
        reviewStatus: 'confirmed' as const,
        actionRisk: 'medium' as const,
        action: { kind: 'click' as const, locator: { selector: '#submit-order', quality: 'acceptable' as const } },
      },
    };
    const rejectedSteps = [
      {
        ...confirmedClick,
        execution: { ...confirmedClick.execution, reviewStatus: 'needsReview' as const },
      },
      {
        ...confirmedClick,
        execution: {
          ...confirmedClick.execution,
          action: { kind: 'input' as const, locator: { selector: '#email', quality: 'acceptable' as const }, value: 'qa@example.test' },
        },
      },
      {
        ...confirmedClick,
        execution: {
          ...confirmedClick.execution,
          action: { kind: 'select' as const, locator: { selector: '#region', quality: 'acceptable' as const }, value: 'shanghai' },
        },
      },
      {
        ...confirmedClick,
        type: 'aiAssert' as const,
      },
      {
        ...confirmedClick,
        execution: {
          ...confirmedClick.execution,
          action: { kind: 'click' as const, locator: { selector: ' ', quality: 'acceptable' as const } },
        },
      },
    ];

    rejectedSteps.forEach((step) => {
      expect(getConfirmedDeterministicTestStep(step)).toBeUndefined();
      expect(isConfirmedDeterministicTestStep(step)).toBe(false);
    });

    const malformedActionSteps: studio.TestStepDraft[] = [
      {
        ...confirmedClick,
        execution: { ...confirmedClick.execution, action: undefined },
      },
      {
        ...confirmedClick,
        execution: {
          ...confirmedClick.execution,
          action: { kind: 'navigate', url: ' ' },
        },
      },
      {
        ...confirmedClick,
        execution: {
          ...confirmedClick.execution,
          action: { kind: 'waitForTimeout', timeoutMs: 0 },
        },
      },
      {
        ...confirmedClick,
        execution: {
          ...confirmedClick.execution,
          action: { kind: 'unknown' } as never,
        },
      },
      {
        ...confirmedClick,
        execution: {
          ...confirmedClick.execution,
          action: 'unknown' as never,
        },
      },
    ];

    malformedActionSteps.forEach((step) => {
      expect(() => getConfirmedDeterministicTestStep(step)).not.toThrow();
      expect(getConfirmedDeterministicTestStep(step)).toBeUndefined();
      expect(isConfirmedDeterministicTestStep(step)).toBe(false);
    });
  });

  it('recognizes test cases that consist of exactly one recording replay', () => {
    const project = createEmptyProject(1);
    const baseCase = {
      id: 'case-recording',
      kind: 'recording' as const,
      groupId: project.groups[0].id,
      environmentId: project.environments[0].id,
      source: 'recording' as const,
      name: '录制回放用例',
      category: '核心链路',
      lastEdited: '刚刚',
      url: project.defaultUrl,
      notes: '',
    };

    expect(
      getExclusiveRecordingReplayId({
        ...baseCase,
        steps: [{ id: 'replay', type: 'recordingReplay', title: '回放', body: '回放录制', recordingId: 'recording-1' }],
      }),
    ).toBe('recording-1');
    expect(
      getExclusiveRecordingReplayId({
        ...baseCase,
        steps: [
          { id: 'replay', type: 'recordingReplay', title: '回放', body: '回放录制', recordingId: 'recording-1' },
          { id: 'manual', type: 'manual', title: '确认', body: '人工确认' },
        ],
      }),
    ).toBeUndefined();
  });

  it('inserts, moves, copies, and removes serial test steps without mutating the source list', () => {
    const steps = [
      { id: 'step-1', type: 'ai' as const, title: '第一步', body: '执行第一步' },
      { id: 'step-2', type: 'aiAssert' as const, title: '第二步', body: '断言第二步' },
      { id: 'step-3', type: 'manual' as const, title: '第三步', body: '人工确认第三步' },
    ];
    const inserted = insertTestStep(steps, { id: 'step-inserted', type: 'aiQuery', title: '插入步骤', body: '提取数据' }, 1);

    expect(steps.map((step) => step.id)).toEqual(['step-1', 'step-2', 'step-3']);
    expect(inserted.map((step) => step.id)).toEqual(['step-1', 'step-inserted', 'step-2', 'step-3']);
    expect(moveTestStep(steps, 'step-1', 3).map((step) => step.id)).toEqual(['step-2', 'step-3', 'step-1']);
    expect(moveTestStep(steps, 'step-3', 0).map((step) => step.id)).toEqual(['step-3', 'step-1', 'step-2']);

    const copied = copyTestStep(steps, 'step-2', 'step-copy');
    expect(copied.map((step) => step.id)).toEqual(['step-1', 'step-2', 'step-copy', 'step-3']);
    expect(copied[2]).toMatchObject({ ...steps[1], id: 'step-copy' });
    expect(removeTestStep(copied, 'step-2').map((step) => step.id)).toEqual(['step-1', 'step-copy', 'step-3']);
    expect(moveTestStep(steps, 'missing', 0)).toBe(steps);
    expect(copyTestStep(steps, 'missing', 'step-copy')).toBe(steps);
  });

  it('creates all test step types and reports only run-blocking configuration errors', () => {
    const state = createDemoStudioState();
    const project = state.projects[0]!;
    const baseCase = project.testCases[0]!;
    const recording = project.recordings[0]!;

    expect(createTestStep('ai', 1).type).toBe('ai');
    expect(createTestStep('aiAssert', 2).type).toBe('aiAssert');
    expect(createTestStep('aiQuery', 3).type).toBe('aiQuery');
    expect(createTestStep('manual', 4)).toMatchObject({ type: 'manual', title: '人工检查步骤' });
    expect(createTestStep('recordingReplay', 5, recording)).toMatchObject({
      type: 'recordingReplay',
      recordingId: recording.id,
    });

    expect(getTestCaseRunBlocker({ ...baseCase, steps: [] }, project.recordings)).toBe('emptySteps');
    expect(getTestCaseRunBlocker({ ...baseCase, steps: [{ id: 'blank-title', type: 'ai', title: '  ', body: '执行操作' }] }, project.recordings)).toBe('emptyTitle');
    expect(getTestCaseRunBlocker({ ...baseCase, steps: [{ id: 'blank-body', type: 'manual', title: '人工检查', body: '  ' }] }, project.recordings)).toBe('emptyInstruction');
    expect(getTestCaseRunBlocker({ ...baseCase, steps: [{ id: 'missing-recording', type: 'recordingReplay', title: '回放', body: '回放录制', recordingId: 'missing' }] }, project.recordings)).toBe('missingRecording');
    expect(getTestCaseRunBlocker({ ...baseCase, steps: [createTestStep('recordingReplay', 6, recording)] }, project.recordings)).toBeUndefined();
    expect(getTestStepRunBlocker({ id: 'blank-title', type: 'ai', title: ' ', body: '执行操作' }, project.recordings)).toBe('emptyTitle');
    expect(getTestStepRunBlocker({ id: 'valid', type: 'manual', title: '人工检查', body: '确认状态' }, project.recordings)).toBeUndefined();
  });

  it('converts a manual check into an executable AI assertion without mutating its source step', () => {
    const manualStep = {
      id: 'manual-check',
      type: 'manual' as const,
      title: '确认订单状态',
      body: '订单状态显示为已支付',
    };

    const replacement = createManualStepAutomationReplacement(manualStep);

    expect(replacement).toEqual({
      id: 'manual-check',
      type: 'aiAssert',
      title: '确认订单状态',
      body: '验证：订单状态显示为已支付',
      recordingId: undefined,
    });
    expect(manualStep).toEqual({
      id: 'manual-check',
      type: 'manual',
      title: '确认订单状态',
      body: '订单状态显示为已支付',
    });
  });

  it('creates a review-only recovery draft without turning Reporter text into browser actions', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T08:00:00.000Z'));
    const source = createDemoStudioState().projects[0]!.testCases[0]!;

    const draft = createReporterFixDraft(
      source,
      {
        failureAnalysis: '页面数据尚未稳定。',
        suggestedFixes: ['增加数据就绪等待', '增加数据就绪等待 ', '检查 /api/orders 响应'],
        recoveryPlan: {
          failedStepId: source.steps[0]!.id,
          strategy: 'waitForDataReady',
          reason: '页面数据尚未稳定。',
        },
      },
      4,
    );

    expect(draft).toMatchObject({
      id: 'case-reporter-1785571200000-4',
      source: 'reporter',
      name: `${source.name} · 修复草稿`,
      notes: expect.stringContaining('页面数据尚未稳定。'),
    });
    expect(draft?.steps.map((step) => step.id)).not.toContain(source.steps[0]?.id);
    expect(draft?.steps).toHaveLength(source.steps.length + 1);
    expect(draft?.steps[0]).toEqual(expect.objectContaining({
      type: 'ai',
      title: '受控恢复：等待数据就绪',
      body: expect.stringContaining('不要点击、输入、选择或导航'),
    }));
    expect(draft?.steps.map((step) => step.body).join('\n')).not.toContain('检查 /api/orders 响应');
    expect(draft?.notes).toContain('检查 /api/orders 响应');
    expect(source.source).not.toBe('reporter');

    const draftWithoutSuggestedFixes = createReporterFixDraft(
      source,
      {
        failureAnalysis: '等待元素可见。',
        suggestedFixes: [],
        recoveryPlan: {
          failedStepId: source.steps[0]!.id,
          strategy: 'waitForSelector',
          selector: '#orders-ready',
          reason: '等待元素可见。',
        },
      },
      5,
    );
    expect(draftWithoutSuggestedFixes?.steps[0]).toEqual(expect.objectContaining({
      title: '受控恢复：等待元素就绪',
      body: expect.stringContaining('#orders-ready'),
    }));

    expect(createReporterFixDraft(source, { failureAnalysis: '无恢复计划', suggestedFixes: ['增加等待'] }, 6)).toBeUndefined();
    vi.useRealTimers();
  });
});
