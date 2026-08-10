# Regression Case V2 Foundation Design

**Date:** 2026-08-08
**Status:** Approved foundation slice

## 1. Purpose

TestBuddy 的核心长期资产不是一段可再次交给模型解释的提示词，而是一条可审阅、可重放、可演进的 Hybrid Case。它同时保留业务意图、用户确认的结构化动作以及显式断言。

当前自然语言 Agent 已经产生 `navigate`、`click`、`input`、`select`、`wait`、`assert` 和 `extract` 等结构化计划，但 `createTestCaseFromAgentRun()` 保存用例时把这些字段压回 `type + title + body`。因此现有用例可以继续被 Agent 理解，却不能证明稳定复跑时执行了与探索阶段相同的动作。

Regression Case V2 的第一阶段只修正资产契约和转换，不切换运行时。这样可以先用离线测试锁定无损保存、旧数据兼容和模型边界，再单独接入确定性 Runner。

## 2. Product Contract

Regression Case V2 遵循以下约束：

- 自然语言保留为业务意图和编辑说明，不再作为所有步骤的唯一执行协议。
- 只有字段完整的动作才能生成确定性 action；不得从旧 `body` 反向猜测 selector、URL、输入值或断言。
- 语义 HTML、ARIA 和公开 DOM 是定位基础，不要求被测应用添加 `data-testid`。
- locator fingerprint 记录当前可用 selector，并为后续 role、name、scope、公开属性和质量评估保留扩展位。
- 只有显式 assertion contract 才能声明无需模型；旧 `expected` 或自由文本断言仍需模型。
- 从 Agent Run 生成的结构化内容默认 `needsReview`。用户确认之前，运行时不能把它当作已批准资产执行。
- AI 恢复只能产生维护草稿，不得静默覆盖已确认 action、locator 或 assertion。
- 旧用例不迁移、不补全 V2 字段，继续走现有 AI/录制/人工路径。
- Agent Run 中所有 `input/select` 的原始值均不写入 Case。敏感或无法分类的值只保留无原值的审阅提示，不保留 `action.value`，也不把掩码字符串当成可执行输入。后续只有用户在 V2 编辑器中明确选取公开变量、fixture 输出或凭据引用后，才可形成确定性输入动作。

## 3. Foundation Data Model

`TestStepDraft` 保留现有 `id/type/title/body/recordingId`，新增可选 `execution`：

```ts
type TestStepReviewStatus = 'needsReview' | 'confirmed';
type TestStepActionRisk = 'low' | 'medium' | 'high' | 'unknown';
type TestStepModelRequirement = 'none' | 'required' | 'notApplicable';

interface TestLocatorFingerprint {
  selector: string;
  role?: string;
  name?: string;
  scope?: string;
  publicAttributes?: Record<string, string>;
  quality: 'acceptable' | 'fragile' | 'unknown';
}

type DeterministicTestAction =
  | { kind: 'navigate'; url: string }
  | { kind: 'click'; locator: TestLocatorFingerprint }
  | { kind: 'input'; locator: TestLocatorFingerprint; value: string }
  | { kind: 'select'; locator: TestLocatorFingerprint; value: string }
  | { kind: 'waitForSelector'; locator: TestLocatorFingerprint; timeoutMs?: number }
  | { kind: 'waitForTimeout'; timeoutMs: number }
  | { kind: 'scrollTo'; locator: TestLocatorFingerprint };

type ExplicitTestAssertion =
  | { id: string; version: 1; kind: 'urlContains' | 'titleContains' | 'pageContains'; expected: string }
  | { id: string; version: 1; kind: 'locatorVisible'; locator: TestLocatorFingerprint }
  | { id: string; version: 1; kind: 'locatorTextContains'; locator: TestLocatorFingerprint; expected: string };

interface TestStepExecutionDraft {
  schemaVersion: 2;
  intent: string;
  reviewStatus: TestStepReviewStatus;
  actionRisk: TestStepActionRisk;
  action?: DeterministicTestAction;
  assertion?: ExplicitTestAssertion;
  provenance?: {
    source: 'agentRun';
    runId: string;
    stepId: string;
  };
}
```

`TestCaseDraft` 同时增加可选 `sourceIntent`，用于保存触发探索的原始业务目标。`body` 继续供当前编辑器和旧 Runner 使用，直到 V2 编辑与执行链路完成切换。

`TestStepModelRequirement` 必须由步骤内容实时派生，不能持久化：

- `ai` 步骤存在完整 deterministic action 时为 `none`。
- `aiAssert` 步骤存在合法 explicit assertion 时为 `none`。
- 旧 AI 步骤、字段不完整的动作、自由文本断言和 `aiQuery` 为 `required`。
- `manual` 与 `recordingReplay` 为 `notApplicable`。

## 4. Agent Run Conversion

转换只接受已通过且来源为 `naturalLanguage` 的运行。存在 `sourceStepType` 时继续过滤运行时准备和校验元步骤；旧运行没有该字段时保留完整 plan fallback。

| Agent step | V2 result | Model requirement |
| --- | --- | --- |
| `navigate` + URL | `action.kind = navigate` | none |
| `click` + selector | `action.kind = click` + locator | none |
| `input` + selector + value | 无原值审阅步骤，不生成 action | required |
| `select` + selector + value | 无原值审阅步骤，不生成 action | required |
| `wait` + selector | `action.kind = waitForSelector` | none |
| `wait` + positive timeout only | `action.kind = waitForTimeout` | none |
| `scroll` + selector | `action.kind = scrollTo` | none |
| target-only or incomplete action | retain intent only | required |
| semantic `assert` from current Planner | retain intent only | required |
| explicit supported assertion | assertion contract | none |
| `extract` | retain target/intention in body | required |

Selector quality is conservative. Selector 使用 `:nth-child`、`:nth-of-type` 或明显位置链时标记 `fragile`；基于公开 ID/attribute 的 selector 标记 `acceptable`；无法判断时标记 `unknown`。质量只用于审阅和维护提示，不自动放宽执行结果。

动作风险也是保守提示：导航、等待和滚动为 `low`；一般输入、选择和点击为 `medium`；意图中出现提交、删除、支付、审批、发送、购买及对应英文词时为 `high`；缺少可判断内容时为 `unknown`。风险不改变业务断言，也不授权自动恢复。

## 5. Hydration And Compatibility

Hydration 必须满足：

- 没有 `execution` 的旧步骤保持深度等价，不自动生成 V2 内容。
- 合法 V2 action、assertion、locator 和 provenance 被保留。
- 非法 schema、空 intent、畸形 action/assertion、空 locator 或非法 timeout 被丢弃；legacy `type/title/body` 仍保留。
- 不从 `body`、`title` 或旧 `expected` 猜测结构化执行内容。
- 未知的新字段不影响现有项目、录制、PRD 和运行历史 hydration。

在编辑器建立 V2 联动前，修改 `type/body` 可能使原 execution 过期。因此本阶段运行时继续忽略 execution；下一阶段编辑器必须在改变执行语义时清空确认状态或重建 execution。

## 6. Deterministic Runtime Boundary

下一阶段的接入点固定在 `electron/runtime/test-runner.ts`：录制回放分支之后、AI Workflow 分支之前。结构化动作不得塞进 `testCaseToWorkflow()`，也不得伪装成 `ai` 再进入 Planner。

预期链路：

```text
TestRunner deterministic branch
  -> StudioRuntime.runDeterministicStep
  -> prepareBrowserForAgent
  -> execute prebuilt action/assertion
  -> child AgentRunResult
  -> createTestCaseAgentRun
  -> existing RunDetail and artifacts
```

第一批只开放 navigate、selector click、固定或 selector wait、URL/title/text/selector 基础断言和截图观察。`input/select` 必须先在 V2 编辑器被用户替换为公开变量、fixture 输出或凭据引用；语义 target、目标化提取、语义断言、高级表格/图表、自动重规划和有副作用动作重试仍走模型或保持不可执行。

确定性执行前必须增加“真实 Playwright page 已执行”的能力证据。BrowserRuntime 的 stub 快照不能被记为通过。取消只阻止后续 dispatch；已经发出的 Playwright 副作用不得被自动重试或补偿。

## 7. Acceptance Criteria

- 已通过的自然语言运行保存原始 `sourceIntent`、每步 intent、完整 action 字段和来源。
- 不完整动作与自由文本断言不会被错误提升为确定性步骤。
- 自然语言 prompt、计划标题、说明、风险和步骤中出现的任何 Agent `input/select` 原值不会进入持久化 Case。
- 模型需求从当前结构派生，编辑后不会读取过期持久化标志。
- 旧项目 hydration 前后用例行为不变。
- 畸形 V2 数据不会让整个项目 hydration 失败。
- 当前 UI、Workflow Runner、Recording Runner 和手工步骤行为保持不变。
- focused tests、全量单测、TypeScript、构建和 `git diff --check` 全部通过后，才进入确定性执行阶段。
