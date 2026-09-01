import type {
  PrdAnalysisFallbackReason,
  PrdDocumentAsset,
  PrdSemanticAnalysisRequest,
  PrdSemanticAnalysisResponse,
  TestStepDraft,
} from '../../shared/studio.js';
import {
  defaultAgentModelConfig,
  isMidsceneConfigured,
  updatePrdDocumentAnalysis,
} from '../../shared/studio.js';
import type { AgentPlannerModelConfig } from './agent-planner.js';
import type { ResolvedAgentModelConfig, ResolvedMidsceneConfig } from './model-config-resolver.js';

type SemanticStepType = TestStepDraft['type'];

export type ResolvedPrdSemanticAnalysisRequest = Omit<PrdSemanticAnalysisRequest, 'midsceneConfig' | 'agentModelConfig'> & {
  /** Private resolved configuration supplied immediately before the Planner provider call. */
  plannerConfig?: AgentPlannerModelConfig;
  /** Compatibility path for static internally-resolved test configurations. */
  midsceneConfig?: ResolvedMidsceneConfig;
  agentModelConfig?: ResolvedAgentModelConfig;
};

interface PrdSemanticPathRefinement {
  pathId: string;
  title: string;
  priority: 'P0' | 'P1' | 'P2';
  groupName: string;
  rationale: string;
  steps: Array<Pick<TestStepDraft, 'type' | 'title' | 'body'>>;
}

export interface PrdSemanticAnalyzerRequest {
  config: AgentPlannerModelConfig;
  document: PrdDocumentAsset;
}

export interface PrdSemanticAnalyzerResult {
  summary: string;
  paths: PrdSemanticPathRefinement[];
  modelName: string;
}

export interface PrdSemanticAnalyzer {
  analyze(request: PrdSemanticAnalyzerRequest): Promise<PrdSemanticAnalyzerResult>;
}

class InvalidPrdSemanticResponseError extends Error {}

const semanticStepTypes = new Set<SemanticStepType>(['ai', 'aiAssert', 'aiQuery']);

function completionEndpoint(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (!normalized) {
    throw new Error('PRD 模型 Base URL 不能为空');
  }
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`;
}

function requiredString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new InvalidPrdSemanticResponseError(`PRD 模型返回的 ${label} 无效`);
  }

  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new InvalidPrdSemanticResponseError(`PRD 模型返回的 ${label} 超出长度限制`);
  }
  return normalized;
}

function parsePathStep(value: unknown, pathIndex: number, stepIndex: number): PrdSemanticPathRefinement['steps'][number] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidPrdSemanticResponseError(`PRD 模型返回的 paths[${pathIndex}].steps[${stepIndex}] 无效`);
  }

  const record = value as Record<string, unknown>;
  const type = requiredString(record.type, `paths[${pathIndex}].steps[${stepIndex}].type`, 24) as SemanticStepType;
  if (!semanticStepTypes.has(type)) {
    throw new InvalidPrdSemanticResponseError(`PRD 模型返回了不支持的步骤类型：${type}`);
  }

  return {
    type,
    title: requiredString(record.title, `paths[${pathIndex}].steps[${stepIndex}].title`, 100),
    body: requiredString(record.body, `paths[${pathIndex}].steps[${stepIndex}].body`, 600),
  };
}

function parsePathRefinement(value: unknown, index: number): PrdSemanticPathRefinement {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidPrdSemanticResponseError(`PRD 模型返回的第 ${index + 1} 条路径无效`);
  }

  const record = value as Record<string, unknown>;
  const priority = requiredString(record.priority, `paths[${index}].priority`, 4);
  if (priority !== 'P0' && priority !== 'P1' && priority !== 'P2') {
    throw new InvalidPrdSemanticResponseError(`PRD 模型返回的 paths[${index}].priority 无效`);
  }
  if (!Array.isArray(record.steps) || record.steps.length === 0 || record.steps.length > 6) {
    throw new InvalidPrdSemanticResponseError(`PRD 模型返回的 paths[${index}].steps 数量无效`);
  }

  return {
    pathId: requiredString(record.pathId, `paths[${index}].pathId`, 100),
    title: requiredString(record.title, `paths[${index}].title`, 120),
    priority,
    groupName: requiredString(record.groupName, `paths[${index}].groupName`, 60),
    rationale: requiredString(record.rationale, `paths[${index}].rationale`, 400),
    steps: record.steps.map((step, stepIndex) => parsePathStep(step, index, stepIndex)),
  };
}

function parseSemanticPayload(content: string): Omit<PrdSemanticAnalyzerResult, 'modelName'> {
  const normalized = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  let raw: unknown;
  try {
    raw = JSON.parse(normalized);
  } catch {
    throw new InvalidPrdSemanticResponseError('PRD 模型未返回合法 JSON');
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new InvalidPrdSemanticResponseError('PRD 模型返回的分析结构无效');
  }
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.paths) || record.paths.length === 0 || record.paths.length > 8) {
    throw new InvalidPrdSemanticResponseError('PRD 模型返回的 paths 数量无效');
  }

  return {
    summary: requiredString(record.summary, 'summary', 320),
    paths: record.paths.map(parsePathRefinement),
  };
}

function semanticAnalyzerSystemPrompt(): string {
  return [
    '你是 Web 自动化测试的 PRD 语义分析器。只返回 JSON，不要 Markdown。',
    '只可细化输入 candidates 中的现有路径。每个 paths[].pathId 必须精确等于某个候选路径 ID；不得新增、删除或合并候选路径，也不得改写原文摘录。',
    '输出结构：{"summary":string,"paths":[{"pathId":string,"title":string,"priority":"P0"|"P1"|"P2","groupName":string,"rationale":string,"steps":[{"type":"ai"|"aiAssert"|"aiQuery","title":string,"body":string}]}]}。',
    '每条路径 1 至 6 步。步骤要能转成测试用例：先准备/进入，再执行，最后断言或提取；没有文档依据时不要编造页面、数据或预期。',
    'summary 仅总结输入 PRD 和候选路径已覆盖的测试意图。',
  ].join('\n');
}

function modelInput(document: PrdDocumentAsset) {
  return {
    documentName: document.name,
    sourceText: document.sourceText.slice(0, 30_000),
    sourceTextTruncated: document.sourceText.length > 30_000,
    candidates: document.generatedPaths.map((path) => ({
      pathId: path.id,
      title: path.title,
      priority: path.priority,
      groupName: path.groupName,
      rationale: path.rationale,
      sourceExcerpt: path.sourceExcerpt ?? '',
      steps: path.steps.map((step) => ({
        type: step.type,
        title: step.title,
        body: step.body,
      })),
    })),
  };
}

export class OpenAICompatiblePrdSemanticAnalyzer implements PrdSemanticAnalyzer {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async analyze(request: PrdSemanticAnalyzerRequest): Promise<PrdSemanticAnalyzerResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let response: Response;

    try {
      const temperature = Number.parseFloat(request.config.temperature);
      response = await this.fetchImpl(completionEndpoint(request.config.modelBaseUrl), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${request.config.modelApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: request.config.modelName,
          temperature: Number.isFinite(temperature) ? temperature : 0.2,
          messages: [
            { role: 'system', content: semanticAnalyzerSystemPrompt() },
            { role: 'user', content: JSON.stringify(modelInput(request.document)) },
          ],
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`PRD 模型请求失败（HTTP ${response.status}）：${detail || response.statusText}`);
    }

    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new InvalidPrdSemanticResponseError('PRD 模型响应缺少 choices[0].message.content');
    }

    return {
      ...parseSemanticPayload(content),
      modelName: request.config.modelName,
    };
  }
}

function resolveSemanticModelConfig({
  plannerConfig,
  midsceneConfig,
  agentModelConfig,
}: ResolvedPrdSemanticAnalysisRequest): {
  config?: AgentPlannerModelConfig;
  fallbackReason?: PrdAnalysisFallbackReason;
} {
  if (plannerConfig) {
    return { config: plannerConfig };
  }
  if (!midsceneConfig || !agentModelConfig) {
    return { fallbackReason: 'modelNotConfigured' as const };
  }

  const planner = {
    ...defaultAgentModelConfig.planner,
    ...(agentModelConfig.planner ?? {}),
  };
  if (!planner.enabled) {
    return { fallbackReason: 'modelDisabled' };
  }

  const config = planner.provider === 'openaiCompatible'
    ? planner
    : {
        modelBaseUrl: midsceneConfig.modelBaseUrl,
        modelApiKey: midsceneConfig.modelApiKey,
        modelName: midsceneConfig.modelName,
        modelFamily: midsceneConfig.modelFamily,
        temperature: '0.2',
      };
  const isConfigured = planner.provider === 'openaiCompatible'
    ? Boolean(config.modelBaseUrl.trim() && config.modelApiKey.trim() && config.modelName.trim())
    : isMidsceneConfigured(midsceneConfig);

  if (!isConfigured) {
    return { fallbackReason: 'modelNotConfigured' };
  }

  return { config };
}

function mergeModelRefinements(
  document: PrdDocumentAsset,
  result: PrdSemanticAnalyzerResult,
): PrdDocumentAsset {
  const baselineIds = new Set(document.generatedPaths.map((path) => path.id));
  const refinements = new Map<string, PrdSemanticPathRefinement>();
  for (const refinement of result.paths) {
    if (!baselineIds.has(refinement.pathId) || refinements.has(refinement.pathId)) {
      throw new InvalidPrdSemanticResponseError('PRD 模型引用了无效或重复的候选路径');
    }
    refinements.set(refinement.pathId, refinement);
  }

  const generatedPaths = document.generatedPaths.map((path) => {
    const refinement = refinements.get(path.id);
    if (!refinement) {
      return path;
    }

    return {
      ...path,
      title: refinement.title,
      priority: refinement.priority,
      groupName: refinement.groupName,
      rationale: refinement.rationale,
      steps: refinement.steps.map((step, index) => ({
        ...step,
        id: `semantic-${path.id}-${index + 1}`,
      })),
    };
  });

  return {
    ...document,
    status: generatedPaths.length ? 'analyzed' : 'draft',
    summary: result.summary,
    coverageAreas: Array.from(new Set(generatedPaths.map((path) => path.groupName))),
    generatedPaths,
    analysisMetadata: {
      source: 'model',
      modelName: result.modelName,
      analyzedAt: new Date().toISOString(),
    },
  };
}

function fallbackResponse(
  document: PrdDocumentAsset,
  fallbackReason: PrdAnalysisFallbackReason,
): PrdSemanticAnalysisResponse {
  return {
    document: {
      ...document,
      analysisMetadata: {
        source: 'rule',
        analyzedAt: new Date().toISOString(),
        fallbackReason,
      },
    },
    source: 'rule',
    fallbackReason,
  };
}

export class PrdSemanticAnalysisRuntime {
  constructor(private readonly analyzer: PrdSemanticAnalyzer = new OpenAICompatiblePrdSemanticAnalyzer()) {}

  async analyze(request: ResolvedPrdSemanticAnalysisRequest): Promise<PrdSemanticAnalysisResponse> {
    const baseline = updatePrdDocumentAnalysis(request.document);
    if (!baseline.generatedPaths.length) {
      return fallbackResponse(baseline, 'noRulePaths');
    }

    const resolved = resolveSemanticModelConfig(request);
    if (!resolved.config || resolved.fallbackReason) {
      return fallbackResponse(baseline, resolved.fallbackReason ?? 'modelNotConfigured');
    }

    try {
      const result = await this.analyzer.analyze({
        config: resolved.config,
        document: baseline,
      });
      return {
        document: mergeModelRefinements(baseline, result),
        source: 'model',
        modelName: result.modelName,
      };
    } catch (error) {
      return fallbackResponse(
        baseline,
        error instanceof InvalidPrdSemanticResponseError ? 'invalidResponse' : 'requestFailed',
      );
    }
  }
}
