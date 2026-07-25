# 工作流与数据模型设计

## 1. 设计目标

当前数据模型要服务自动化测试 Agent，而不仅是 workflow 编辑器。它要同时支持这些状态：

- 应用导航状态
- 启动引导状态
- Midscene / runtime 配置
- 项目、分组、环境、凭证引用
- 用例、录制、PRD、测试路径
- Agent intent、plan、event 和 result
- 运行记录、截图、trace 与即时对话

因此这里不再只讨论“workflow 定义”，而是讨论整个客户端的状态模型。

## 2. 当前核心模型

## 2.1 StudioState

当前应用核心状态：

- `selectedWorkflowId`
- `workflows`
- `recentRuns`
- `chatEntries`
- `runtimeProfile`
- `midsceneConfig`
- `startupGuide`
- `projects`
- `runDetails`
- `browserSession`

它的职责是保存：

- 客户端上次工作上下文
- 最近执行活动
- 基础执行配置

## 2.2 RuntimeProfile

字段：

- `browser`
- `baseUrl`
- `viewport`
- `locale`
- `headless`

作用：

- 统一承载浏览器运行配置
- 同时服务自然语言测试和流程执行
- 后续录制回放也复用

## 2.3 MidsceneConfig

字段：

- `modelBaseUrl`
- `modelApiKey`
- `modelName`
- `modelFamily`
- `preferredLanguage`
- `replanningCycleLimit`
- `openaiHttpProxy`
- `defaultContext`

作用：

- 作为进入 Agent 功能页的前置配置
- 作为所有执行请求的上游环境配置
- 支持 OpenAI 兼容模型、代理和模型族配置

## 2.3.1 StartupGuideState

字段：

- `completed`
- `completedAt`
- `mode`

作用：

- 控制独立启动屏是否显示。
- 首次加载显示启动屏。
- 用户跳过或完成 Midscene 配置后，后续加载不再自动显示。

## 2.4 WorkflowDraft

当前字段：

- `id`
- `kind`
- `name`
- `category`
- `lastEdited`
- `url`
- `notes`
- `steps`

### kind 设计

当前 workflow 被划分为三类：

- `scenario`
- `assertion`
- `extraction`

目的：

- 让首页与功能页能按类型组织资产
- 给未来模板、过滤器和执行器路由提供基础字段

## 2.5 WorkflowStepDraft

字段：

- `id`
- `type`
- `title`
- `body`

当前 `type`：

- `ai`
- `aiAssert`
- `aiQuery`

后续可扩展：

- `aiWaitFor`
- `aiTap`
- `aiInput`
- `sleep`
- `recordingReplay`

## 2.6 ChatEntry

字段：

- `id`
- `role`
- `text`

当前用于：

- 自然语言测试页的即时会话记录
- 设置失败、运行失败等系统消息承载

后续可扩展：

- 结构化结果
- 变量提取结果
- 截图或报告链接

## 2.7 RunSummary

字段：

- `id`
- `name`
- `status`
- `duration`
- `summary`

作用：

- 首页最近运行概览
- 后续运行历史列表

## 3. 页面与数据的关系

### 3.1 首页

读取：

- `midsceneConfig`
- `runtimeProfile`
- `recentRuns`

### 3.2 自然语言测试页

读取 / 写入：

- `chatEntries`
- `runtimeProfile`
- `midsceneConfig`

可能产出：

- 新的 `ChatEntry`
- 未来可转写到 `WorkflowDraft.steps`

### 3.3 流程编排页

读取 / 写入：

- `workflows`
- `selectedWorkflowId`
- `runtimeProfile`
- `midsceneConfig`
- `recentRuns`

### 3.4 录制回放页

当前还没有录制资产模型，但建议预留：

- `recordings`
- `selectedRecordingId`
- `recordingRuns`

## 4. 配置完整性规则

当前产品里，“是否允许进入功能页”依赖：

- `isMidsceneConfigured(midsceneConfig)`

最小规则：

- `modelBaseUrl.trim()` 非空
- `modelApiKey.trim()` 非空
- `modelName.trim()` 非空
- `modelFamily.trim()` 非空

这意味着配置字段已经不只是表单数据，而是页面访问控制的一部分。

## 4.1 Agent Contract

Agent 执行协议定义在 `shared/agent.ts`。

核心模型：

- `AgentIntent`
- `AgentPlan`
- `AgentStep`
- `AgentObservation`
- `AgentVerification`
- `AgentRunEvent`
- `AgentRunResult`

它们的作用：

- 将自然语言、workflow、recording、PRD 都统一为 Agent intent。
- 将执行计划统一为 Agent plan。
- 将浏览器动作、观察结果、断言结果统一为事件流。
- 让运行记录可以从 Agent result 生成。

后续迁移目标：

- 自然语言测试页调用 `AgentIntent`。
- 流程编排页将 workflow 转成 `AgentPlan`。
- 录制回放页将 recording 转成 `AgentPlan`。
- PRD 分析页将 generated path 转成 `AgentIntent` 或 `AgentPlan`。

## 5. 状态迁移与兼容性

当前已经有 `hydrateStudioState` 负责做：

- 缺省值补齐
- 旧状态兼容
- workflow 类型推断

这点很重要，因为客户端会持续演进，而本地状态不会每次都跟着重建。

后续建议继续沿用：

- 为 `StudioState` 引入 `schemaVersion`
- 对旧版本状态做迁移函数

## 6. 未来建议模型

当前模型足够支持工作台雏形，但 Agent MVP 需要优先补充：

### 6.1 AgentRunDetail

字段建议：

- `runId`
- `intent`
- `plan`
- `events`
- `observations`
- `verifications`
- `artifacts`
- `summary`
- `failureReason`

### 6.2 ArtifactIndex

字段建议：

- `id`
- `runId`
- `stepId`
- `type`
- `label`
- `path`
- `createdAt`
- `artifacts`
- `error`

### 6.3 ArtifactRef

字段建议：

- `type`
- `path`
- `label`

用于统一承载：

- screenshot
- report
- trace
- log file

## 7. 流程与对话的转化关系

当前产品已经支持：

- 从自然语言输入保存为流程步骤

后续建议继续增强：

- 选择某条对话结果并追加到已有 workflow
- 从录制回放片段生成 workflow steps
- 从 workflow 执行失败结果回填自然语言修复建议

## 8. 数据设计原则

- 配置与资产分开
- 页面状态与执行状态分开
- 录制资产与流程资产分开
- 所有未来新增字段都要考虑本地状态迁移
