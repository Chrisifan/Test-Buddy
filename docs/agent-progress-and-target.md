# 自动化测试 Agent 进度与目标状态

## 1. 文档目的

这份文档用于记录 PlayTest Pro 从“自动化测试工作台”推进到“自动化测试 Agent”的当前进度、最终目标和后续落地边界。

它回答三个问题：

- 当前已经做到什么程度。
- 哪些能力只是结构化 stub，还不是真 Agent。
- 最终要做到什么程度才算接近可用的自动化测试 Agent。

## 2. 最终目标

PlayTest Pro 最终要实现一个面向 Web 应用的本地自动化测试 Agent。

用户可以通过三种方式发起测试：

- 自然语言：描述测试目标，例如“打开报表页，筛选近 30 天，并验证图表刷新”。
- 录制路径：录制真实用户操作，然后作为回放和对比依据。
- PRD/PDF：上传需求文档，由系统分析并生成测试路径。

Agent 最终要完成完整闭环：

```text
Intent -> Plan -> Execute -> Observe -> Verify -> Report -> Asset
```

含义：

- `Intent`：理解用户输入、录制路径或 PRD。
- `Plan`：拆解成测试步骤、断言和风险点。
- `Execute`：控制浏览器执行 navigate、click、input、wait、assert 等动作。
- `Observe`：采集截图、DOM、URL、标题、console、network、trace。
- `Verify`：判断文本、DOM、表格、图表、视觉状态是否满足预期。
- `Report`：生成运行结果、失败原因、证据链和修复建议。
- `Asset`：沉淀为测试用例、录制资产、PRD 覆盖记录和历史报告。

## 3. 当前整体完成度判断

截至当前实现，项目大致处于：

- 产品与 UI 工作台：约 70%。
- 测试资产管理：约 50%。
- 浏览器 runtime：约 45%。
- Agent contract 与事件链路：约 45%。
- 真正智能执行：约 25%。
- 结果分析与失败归因：约 20%。

综合看，当前已经不是纯 UI 原型，但还不是完整 Agent。

更准确地说：

> 当前已经具备 Agent 的外壳、数据模型、事件协议和最小浏览器执行雏形；正在从结构化 stub 过渡到真实 Executor。

## 4. 已经实现的能力

### 4.1 应用与工作台

已经具备：

- Electron 桌面壳。
- React 工作台 UI。
- 独立启动屏。
- 亮色、暗色、跟随系统主题设置。
- 设置弹窗。
- Midscene 配置引导。
- Agent 角色模型配置。
- 未配置 Midscene 时的功能门禁。
- 首页质量总览。
- 项目、分组、PRD、用例、运行记录、自然语言、流程编排、录制回放等页面。

### 4.2 项目与资产模型

已经具备：

- 项目一级管理。
- 分组作为项目内二级维度。
- 环境配置。
- 凭证引用。
- 测试用例。
- 录制资产。
- PRD 文档资产。
- 运行摘要 `RunSummary`。
- 运行详情 `RunDetail`。
- 录制资产与用例步骤绑定。
- 删除录制资产时解除用例引用。

### 4.3 启动屏与 Midscene 设置

已经具备：

- 首次加载显示独立启动屏。
- 启动屏支持 Midscene 快速配置。
- 启动屏支持跳过。
- 跳过或配置完成后，后续加载不再自动显示。
- 进入自然语言、流程编排、录制回放时，如果 Midscene 未配置，会打开设置弹窗并定位到 Midscene 栏目。

当前 Midscene 配置字段：

- `MIDSCENE_MODEL_BASE_URL`
- `MIDSCENE_MODEL_API_KEY`
- `MIDSCENE_MODEL_NAME`
- `MIDSCENE_MODEL_FAMILY`
- `MIDSCENE_PREFERRED_LANGUAGE`
- `MIDSCENE_REPLANNING_CYCLE_LIMIT`
- `MIDSCENE_OPENAI_HTTP_PROXY`
- 默认上下文

### 4.3.1 Agent 角色模型设置

已经具备 Agent 层模型配置入口，用于把 PlayTest Pro 从单一 Midscene 配置推进到多角色 Agent 配置。

当前 Agent 角色：

- `Planner`：拆解 PRD、自然语言目标和回放路径，生成测试计划。
- `Executor`：负责页面理解、语义定位、浏览器动作和等待策略。
- `Verifier`：处理复杂断言、图表表格判断和失败归因证据。
- `Reporter`：总结运行结果、失败原因、覆盖风险和修复建议。

当前每个角色支持：

- 默认复用 Midscene 模型。
- 切换到独立 OpenAI 兼容模型。
- 独立配置 Base URL、API Key、模型名称、模型族和 Temperature。
- 启用或暂停该角色配置。
- 随工作台状态持久化和旧状态迁移。
- 运行时解析为本次 Agent Run 的模型分配，不暴露 API Key，只记录是否已配置 Key。
- 自然语言和 Workflow 运行记录可展示各角色实际使用的模型。

当前边界：

- 自然语言和工作流请求已经携带 `agentModelConfig`，并写入 `AgentRunResult.modelAssignments`。
- Planner 已支持复用 Midscene 配置或使用独立 OpenAI-compatible 模型生成结构化计划。
- Planner 请求只在 Electron Main Process 发起，API Key 不会写入 `AgentRunResult`。
- 模型返回的动作、步骤数量和字段会经过白名单校验，非法响应会安全降级到规则规划。
- Planner 模型耗时、调用数和 token usage 会合并进入本次 Agent Run 指标。
- 模型计划会按顺序执行，每一步生成 browser action、observation、verification 和 artifact 证据。
- 任一步进入 `failed` 或 `neutral` 后停止，未执行步骤保留在计划中但不会伪造执行事件。
- Verifier 已支持复用 Midscene 或独立 OpenAI-compatible 模型处理规则断言覆盖不了的语义断言。
- Reporter 已支持复用 Midscene 或独立 OpenAI-compatible 模型，为失败/等待态运行生成结构化证据摘要、失败归因和修复建议。

### 4.4 Agent Contract

已经新增统一 Agent 协议：

- `AgentIntent`
- `AgentPlan`
- `AgentStep`
- `AgentObservation`
- `AgentVerification`
- `AgentRunEvent`
- `AgentRunResult`
- `AgentExecutionMetrics`
- `AgentTableObservation`
- `AgentChartObservation`
- `AgentSelectorFallbackAttempt`

当前自然语言测试已经开始走：

```text
ChatCommandRequest -> AgentIntent -> AgentPlan -> AgentRunEvent -> RunSummary / RunDetail
```

### 4.5 Browser Runtime

已经具备：

- 启动受控浏览器会话。
- 捕获截图。
- 导航到指定 URL。
- 明确 selector 的点击。
- 明确 selector 的输入。
- 录制事件采集。
- 录制路径回放雏形。
- Playwright 不可用时生成 stub 快照。

### 4.6 当前自然语言 Agent 最小执行能力

当前自然语言 Agent 已支持：

#### Navigate

用户输入明确 URL 时执行：

```text
打开 https://example.com/reports
```

行为：

- 启动或复用浏览器。
- 调用 `BrowserRuntime.navigate()`。
- 捕获页面快照。
- 生成 Agent observation。
- 写入运行记录。

#### Click

明确 selector 时执行：

```text
点击 #login-button
click .submit
```

行为：

- 调用 `BrowserRuntime.click()`。
- 捕获点击后页面状态。
- 生成 Agent observation。
- 写入运行记录。

语义点击已进入可替换执行链路：

```text
点击登录按钮
```

行为：

- 生成 `click` action。
- 不盲猜 selector。
- 配置完整且注入 `SemanticActionRuntime` 时，调用语义执行器并捕获执行后页面状态。
- 执行器未装配时标记为 `neutral` 等待态，不再误报成功。
- 执行失败时写入 `failureReason` 和 verification evidence。

#### Input

明确 selector 时执行：

```text
在 #username 输入 chris
fill #password with 123456
```

行为：

- 调用 `BrowserRuntime.input()`。
- 底层优先 `fill`，失败后尝试 `selectOption`。
- 捕获输入后页面状态。
- 写入运行记录。

语义输入已进入可替换执行链路：

```text
在用户名输入 chris
```

行为：

- 生成 `input` action。
- 不盲猜 selector。
- 配置完整且注入 `SemanticActionRuntime` 时，调用语义执行器并捕获执行后页面状态。
- 执行器未装配时标记为 `neutral` 等待态。
- 执行失败时整次 Agent Run 标记为 `failed`。

### 4.7 Workflow 已进入统一 Agent Run 链路

当前 Workflow 不再通过定时器模拟执行成功。

已经支持：

- Workflow 步骤转换为父级 `AgentPlan`，来源标记为 `workflow`。
- 执行前打开或导航到 Workflow 自身的目标 URL。
- `ai`、`aiAssert`、`aiQuery` 步骤按顺序复用自然语言 Agent 执行链路。
- 每个步骤的 browser action、observation、verification、artifact 和 usage 聚合到父级 `AgentRunResult`。
- 多步骤 metrics 会合并调用数、耗时、token 以及 `byIntent` / `byModel` 用量。
- 任一步进入 `failed` 或 `neutral` 后暂停后续执行；父运行保留对应状态，未执行步骤保持 `neutral`。
- 无法解析为当前可执行动作的步骤保持 `neutral`，不继承旧 stub 的默认通过状态。
- 浏览器 fallback 只生成 `neutral` 计划，不再产生假通过记录。
- Workflow 结果直接写入 `RunDetail` 并进入运行记录页。

### 4.8 Recording 已进入统一 Agent Run 链路

当前录制资产可以直接从录制工作台运行，不再必须先转换成测试用例。

已经支持：

- 录制资产转换为来源为 `recording` 的 `AgentIntent` 和逐节点 `AgentPlan`。
- `navigate`、`click`、`input`、`wait`、`assert`、`snapshot` 节点映射为统一 Agent action。
- RecordingRunner 使用 `record: false` 启动浏览器，避免回放过程污染原录制资产。
- 真实调用 BrowserRuntime 顺序回放录制节点，失败后停止。
- 每个节点产生 browser action、observation、artifact 和失败事件。
- 录制步骤中的基线截图与回放后的实际截图成对进入运行产物；可读取且尺寸一致的 PNG 会逐像素比较并生成 `差异` artifact，像素变化会明确使运行失败。
- 录制页提供“运行回放”入口，结果直接写入运行记录并持久化。
- 新录制首个导航步骤和手动快照会绑定本次真实 BrowserSession，避免写入旧截图状态。
- 浏览器 fallback 只生成 `neutral` Recording Agent 计划，不模拟回放成功。

尚未完成：

- 动态区域遮罩和图表动画稳定策略。

因此当前截图读取失败、尺寸不一致或没有可比基线时，Recording Agent 明确标记为 `neutral`，不会伪造视觉通过；每条录制可设置 `0–100%` 容差阈值，默认 `0%`，但尚不包含动态区域遮罩。

## 5. 当前仍是 stub 或半成品的地方

### 5.1 Planner 已进入真实模型多步骤执行阶段

当前 Planner 已具备：

- 使用 Agent 模型设置中的 Planner 角色配置。
- 默认复用 Midscene 模型，也可使用独立 OpenAI-compatible 模型。
- 将目标、环境、目标 URL 和当前页面上下文发送给模型。
- 解析最多 12 步的结构化计划。
- 支持 `navigate`、`click`、`input`、`wait`、`scroll`、`select`、`assert`、`observe`、`extract` 动作白名单。
- 按顺序将模型计划步骤交给现有 Browser/Midscene 执行链。
- 模型请求失败、配置不完整或响应非法时降级到现有规则规划，并在计划事件中记录原因。
- `navigate`、明确 selector 或语义 `click/input/select`、`wait`、`scroll`、`assert`、`observe` 和 `extract` 可以逐步产生真实执行证据；语义 `select` 使用 Midscene `aiAct` 描述“在下拉框选择选项”的任务，带明确 `target` 的 `extract` 使用 Midscene `aiQuery` 获取目标化结果，两者均复用报告与 usage 证据链。
- Planner 显式 `wait` 步骤已经支持条件化等待：指令表达图表稳定时等待图表签名稳定；指令表达数据、表格或列表就绪时等待数据签名就绪；带 `selector` 时等待目标可见；带明确 URL 或 `/api/...` 路径时等待特定接口响应；指令包含网络空闲、接口稳定、请求稳定时等待 `networkidle`；其他等待继续使用固定 timeout。
- 每一步都生成独立的 started、browser action、observation、verification 和 artifact 事件。
- 只有全部计划步骤通过时整次运行才为 `passed`；失败或执行器缺失动作会停止后续步骤。
- 不带 `target` 的 `extract` 会复用 Observer 快照，把页面文本、表格和图表信息作为步骤证据写入运行记录；带明确 `target` 且 Midscene 配置完整时调用 `aiQuery`，将返回的结构化结果 JSON 写入该步骤 evidence，模型未返回结果时明确标记失败。
- 浏览器执行类步骤失败或进入等待态时，会基于最新 URL、标题、Observer 摘要和可交互元素向 Planner 请求一次修正版计划。
- 带明确 selector/URL 的 `navigate`、`click`、`input`、`select` 以及确定性 `wait`、`scroll`、`observe` 步骤，会在请求 Planner 重规划前进行一次同计划重试。
- 明确 selector 的 `click`、`input`、`select` 首次失败后，会在同 selector 重试前按 `selector visible -> network idle -> timeout` 的顺序做一次动态等待；如果当前浏览器 runtime 不支持 selector readiness，会尝试 `networkidle`，再不支持才回退为 500ms 页面稳定等待。等待结果会写入 `agent:dynamic-wait` 事件和 `metrics.dynamicWaitAttempts`，selector 等待会额外记录目标 selector，network idle 等待会记录 `strategy: networkIdle`。
- 首次失败尝试会写入 `agent:step-retried` 结构化事件，实际重试次数写入 `metrics.retryAttempts`；断言和语义模型动作不会进入这条盲重试路径。
- 确定性浏览器步骤失败会生成结构化 `failureCategory`，当前覆盖 selector、timeout、navigation、network、assertion、runtime 和 unknown；该分类会映射为 `recoveryStrategy`，当前覆盖 replaceSelector、waitForReadiness、replanNavigation、stopAndReport、retryAfterWait 和 replanFromCurrentState。分类和策略会写入 retry attempt、验证结果和 Planner 重规划的 previousFailure。
- `waitForReadiness` 已开始直接驱动恢复路径：timeout/network 类失败在同计划重试前，若失败上下文明确涉及 table/list/grid/data/chart 等数据加载语义则优先等待页面数据就绪；其他情况等待页面网络空闲，减少数据仍在加载时的盲重试。
- `replanNavigation` 已开始直接驱动恢复路径：导航失败会跳过同 URL 重试，直接进入 Planner 重规划，避免把不可达地址重复执行两次。
- `replaceSelector` 已开始直接驱动恢复路径：明确 selector 找不到时跳过同 selector 重试，优先从 Observer 可交互元素中尝试受控 selector fallback；没有可靠候选时再进入 Planner 重规划。
- `replanFromCurrentState` 已开始直接驱动恢复路径：浏览器报告未知或不确定状态时跳过同计划重试，携带当前页面观察直接请求 Planner 从当前状态继续；页面仍在加载、渲染等可识别瞬时异常仍保持动态等待重试。
- 明确 selector 的 `click`、`input`、`select` 会从最新 `AgentObservation.interactiveElements` 中解析最多 3 个可解释候选；当失败策略是 `replaceSelector` 时按 `原 selector -> selector fallback -> Planner 重规划` 恢复，其他可重试失败仍保留动态等待和同计划重试。
- selector fallback 候选必须与原 selector、步骤标题、步骤指令或目标文案存在词元重合，并且动作类型要兼容；尝试结果会写入 `agent:selector-fallback` 事件和 `metrics.selectorFallbackAttempts`。
- 重规划成功后从修正版计划重新执行；Planner 层会读取 `replanningCycleLimit`，在配置上限内允许多轮重规划，并在 metrics 中记录 `replanningCycleLimit` 和实际 `replanningCycles`；达到上限或重规划失败时保留当前失败结果。
- 断言失败不会被自动重规划吞掉，仍交给 Verifier / Report 链路明确呈现。

规则降级目前能识别：

- 明确 URL。
- `点击 selector`。
- `在 selector 输入 value`。
- 简单语义点击或输入目标。

还没有做到：

- 跨步骤恢复策略。
- 更细粒度的恢复策略编排，例如让更多 recoveryStrategy 直接决定是否跳过同计划重试、是否优先等待数据就绪、是否进入 selector fallback 或 Planner 重规划。
- 根据 PRD 自动推断覆盖路径。
- 把 Reporter 结果导出为完整报告文件和跨运行分析。

### 5.2 Midscene 官方 SDK adapter 已装配，待真实模型验收

当前已经完成：

- `SemanticActionRuntime` 可替换接口。
- semantic click / input / assert 的请求和结果结构。
- Midscene 配置随命令进入 Main Process。
- `passed` / `failed` / `neutral` 三种结果进入 Agent verification 和运行记录。
- Runtime 异常转换为结构化失败，不会降级成假通过。
- Web fallback 保持等待态，不执行模型动作。
- 已安装 `@midscene/web 1.10.3`、`playwright 1.61.1` 和 `@playwright/test 1.61.1`。
- `BrowserRuntime` 向 Main Process adapter 提供当前 Playwright Page。
- Main Process 已创建 `MidsceneSemanticActionRuntime` 并注入 `StudioRuntime`。
- adapter 使用 `PlaywrightAgent.aiTap()`、新版 `aiInput(target, { value })` 和 `aiAssert()`。
- 模型配置通过 Agent 的 `modelConfig` 传递，不写入全局 `process.env`。
- 同一 Page 和模型配置会复用 Agent；Page 或配置变化时销毁旧实例。
- Midscene HTML 报告路径会进入 `AgentRunResult.artifacts`。
- 报告生成时同步产生 `agent:artifact-created` 事件。
- 运行记录的证据区域可直接打开本地 Midscene 报告。
- 每次语义动作会记录 wall time、模型耗时、模型调用数、prompt/completion/total token 和缓存输入 token。
- 同一 Page 复用 Agent 时，会用执行前后的累计指标计算单动作差值，避免后续运行重复累计历史用量。
- 语义动作异常时仍保留已产生的耗时和 usage，并以结构化 `failed` 结果进入运行记录。
- 运行记录的证据标题下会紧凑展示耗时、调用数、token、重规划上限、实际重规划次数、动态等待次数、重试次数和 selector fallback 次数。
- 运行摘要使用真实指标耗时；旧记录没有指标时回退到开始/结束时间。

还没有完成：

- 使用真实模型凭证和真实业务页面完成首条端到端验收。
- Midscene 语义动作自身仍只暴露配置的重规划上限；PlayTest Planner 层已经记录配置上限和实际重规划次数。
- 表格/图表结构化观察已经接入，真实专项断言仍待实现。

### 5.3 Verifier 已有规则断言和独立模型路由

当前 `AgentVerification` 已经有数据结构、事件、规则判断和独立 Verifier 模型入口。

已经支持：

- URL 断言。
- 标题断言。
- 文本断言。
- 表格基础断言。
- 图表基础断言。
- 规则断言无法解析的复杂语义断言会路由到 Verifier 角色模型。

当前支持的自然语言格式：

```text
断言 url 包含 /dashboard
断言标题包含 Dashboard
断言页面包含 登录成功
断言表格包含 成交量
断言表格行数为 2
断言表格列数为 3
断言表格第1行第2列为 120
断言表格列 状态 包含 成功
断言表格列 成交量 合计为 200
断言表格按 成交量 降序
断言图表包含 买入
断言图表数量为 2
断言图表已渲染
断言图表标题为 成交趋势
断言图表图例包含 买入
```

行为：

- URL 断言基于当前浏览器 `currentUrl` 判断。
- 标题断言基于当前浏览器 `pageTitle` 判断。
- 页面文本断言会读取真实页面 `innerText`，无真实页面时使用会话快照信息作为降级文本。
- 表格断言基于 `AgentObservation.tables` 中的标题、行列数、表头和样例行做基础 contains 判断。
- 表格行数/列数断言基于 `AgentObservation.tables` 做严格数值比较。
- 表格单元格断言基于 `AgentObservation.tables.sampleRows` 做严格相等比较，当前以观察到的样例行为准。
- 表格列包含断言基于表头定位列，并在 `AgentObservation.tables.sampleRows` 中查找目标值。
- 表格列合计断言基于表头定位列，并对 `AgentObservation.tables.sampleRows` 中可解析的数值单元格求和。
- 表格排序断言优先基于 `AgentObservation.tables.sortStates` 做列名与方向严格匹配；没有排序状态时，会基于表头和样例行推断升序/降序。
- 图表断言基于 `AgentObservation.charts` 中的标题、类型、尺寸和图例做基础 contains 判断。
- 图表数量断言基于 `AgentObservation.charts.length` 做严格数值比较。
- 图表渲染断言基于 `AgentObservation.charts.rendered` 做可见尺寸状态判断。
- 图表标题断言基于 `AgentObservation.charts.title` 做严格相等比较。
- 图表图例断言基于 `AgentObservation.charts.legends` 做列表包含判断。
- 复杂语义断言会携带 URL、标题、DOM 摘要、文本摘要、表格和图表观察结果进入 Verifier 模型。
- Verifier 模型必须返回 `passed`、`failed` 或 `neutral` 结构化结果；证据不足时保持 `neutral`，不会默认通过。
- Verifier 模型 usage 会合并进入 Agent Run metrics，并且 API Key 不写入运行记录。
- 断言失败时 `AgentRunResult.status` 会标记为 `failed`，并写入 `failureReason`。

还没有真实支持：

- DOM 断言。
- 表格筛选、分页和聚合值断言。
- 图表 tooltip、数据点和可解释的视觉趋势专项断言。
- 视觉对比。

### 5.4 Reporter 已有独立模型路由

当前 Reporter 已经具备：

- 使用 Agent 模型设置中的 Reporter 角色配置。
- 默认复用 Midscene 模型，也可使用独立 OpenAI-compatible 模型。
- 仅在 Agent Run 为 `failed` 或 `neutral` 时触发，不影响通过用例。
- 输入脱敏后的 Agent Run 计划、事件、断言、观察和 artifact 信息。
- 输出结构化 `summary`、`evidenceSummary`、`failureAnalysis` 和 `suggestedFixes`。
- Reporter usage 会合并进入 Agent Run metrics。
- 运行记录会新增 `Reporter 失败分析` 的 report artifact，并写入 `studio-data/artifacts/<runId>-reporter.md`。
- 同步生成 `Reporter HTML 报告` artifact，并写入 `studio-data/artifacts/<runId>-reporter.html`。
- 运行记录中的报告使用主进程受控 IPC 打开或导出：只有 `studio-data/artifacts` 下的应用管理产物可调用系统打开或复制到用户选择的位置，渲染进程不再直接构造任意 `file://` 报告链接。
- Reporter 调用失败时保留原 Agent Run，不阻断主执行链路。

还没有完成：

- 跨 artifact 的证据链导航入口。
- 跨运行失败聚类、趋势分析和覆盖风险总结。
- 把 Reporter 建议转成可执行重试策略或用例修复草稿。

### 5.5 Observer 已有轻量观察快照

当前 Observer 能捕获：

- 当前 URL。
- 页面标题。
- 截图路径。
- 页面文本摘要。
- 关键可交互元素摘要。
- console error / warning。
- network failed request。
- 表格标题、行列数、表头和样例行。
- 表格排序列与排序方向。
- 图表标题、类型、尺寸和图例。

当前这些数据会进入 `AgentObservation`：

- `textSummary`
- `domSummary`
- `interactiveElements`
- `consoleMessages`
- `networkHints`
- `tables`
- `charts`

还需要补：

- 更完整的 DOM 结构摘要。
- trace。
- 图表数据点、tooltip 和视觉状态读取。
- 表格筛选、分页等行为状态读取。

### 5.5 Report 已能展示 Agent 证据

当前运行记录可以保存 Agent Run 的摘要、步骤和结构化证据。

已经支持：

- 运行详情保存原始 `AgentRunResult`。
- 展示 Agent events。
- 展示 observation。
- 展示 verification。
- 展示 screenshot / snapshot / trace / report artifact 列表。
- 展示 console 和 network 异常信号。
- 展示表格和图表结构化观察摘要。
- 展示失败原因。
- 展示 Agent 执行耗时、模型调用量、token 用量、重规划配置、实际重规划次数、动态等待次数、重试次数和 selector fallback 次数。

还需要补：

- 更完整的失败证据链。
- trace 链接。
- 失败原因归因。
- 复跑入口。
- 按项目、分组、用例、环境过滤和对比。

## 6. 最终要实现到什么程度

### 6.1 MVP Agent

MVP Agent 要达到：

- 用户能输入自然语言测试目标。
- Agent 能启动浏览器。
- Agent 能执行明确动作。
- Agent 能基于页面状态做基础断言。
- 每一步有结构化日志。
- 每次执行有截图。
- 失败时能定位到具体步骤。
- 结果能进入运行记录。
- 成功路径能保存为用例。

MVP 支持的动作：

- navigate
- click
- input
- wait
- assert url
- assert title
- assert text
- screenshot observation

### 6.2 可试用 Agent

可试用版本要达到：

- 支持 Midscene 语义定位。
- 支持“点击登录按钮”这类语义点击。
- 支持“在用户名输入 chris”这类语义输入。
- 支持表格基础断言。
- 支持图表存在性、标题、图例、tooltip 或数据区域断言。
- 支持 PRD 生成测试路径。
- 支持录制路径回放和对比。
- 运行记录能查看截图和失败原因。

### 6.3 产品化 Agent

产品化版本要达到：

- 多步骤 Agent planning。
- 动态页面等待策略。
- selector fallback。
- 失败后有限重试和重新定位。
- DOM + vision 双通道判断。
- 图表和表格专项 verifier。
- PRD 覆盖矩阵。
- 报告导出。
- CI/命令行执行预留。
- 凭证安全存储。
- 运行产物文件化管理。

## 7. 与最终目标的差距

### 已经接近的部分

- 工作台壳层。
- 项目/分组/资产管理。
- Midscene 配置和门禁。
- Agent 角色模型配置和持久化。
- 浏览器会话管理。
- Agent contract。
- Agent run 到运行记录的写入。
- Agent Run 角色模型分配解析和运行记录展示。
- OpenAI-compatible Planner 真实调用、结构化计划校验、多步骤顺序执行与规则降级证据。
- 最小 navigate/click/input executor。
- semantic click/input/assert 可替换执行 contract 与等待/失败状态。
- 最小 URL/标题/页面文本 verifier。
- 轻量 Observer：文本摘要、交互元素、console 和失败请求。
- 轻量业务结构观察：表格表头/样例行、图表标题/类型/尺寸/图例。
- 基础表格/图表 contains verifier。
- 表格行数/列数和图表数量 verifier。
- 表格样例单元格、排序状态、图表标题和图表图例 verifier。
- 运行记录 Agent 证据展示：events、observation、verification、artifact、表格/图表摘要。
- Midscene 单动作耗时与 usage 差值归档，包括失败动作证据。
- Workflow 到统一 Agent plan、事件、指标和运行记录的聚合链路。
- Recording 直接回放、基线/实际截图证据配对与运行记录链路。

### 仍然距离较远的部分

- 真实模型与业务页面的稳定性验收。
- Planner 跨步骤恢复策略，以及 Verifier / Reporter 独立模型路由。
- 分步骤成本分析。
- 更完整的 verifier。
- 失败归因。
- PRD LLM 分析。
- 图表和表格高级断言。
- 运行报告体系。
- 稳定性工程。

### 已完成的无密钥业务页基线

已使用本地 `platform-spot-trade` Demo 页面验证：

- Vite + Vue 3 + Module Federation 页面可由真实浏览器加载。
- 页面下拉控件可定位并展开，5 个选项可读取。
- 选择“选项 3”后，页面状态文本更新为“您选择了: 选项 3”。
- 图表占位区域与业务组件告警区域可被 Observer 读取。

该基线只证明浏览器执行与页面观察条件成立，不代表真实 Midscene 模型已经验收。

## 8. 下一步推进顺序

建议继续按以下顺序推进：

1. Midscene 真实环境验收与证据归档。
   - 使用已配置模型完成 semantic click / input / assert 首条真实路径。
   - 核验模型错误、耗时、usage、报告和截图证据是否完整且与供应商账单口径一致。

2. Agent 动态重规划与角色模型路由。
   - 已完成 selector readiness 动态等待、特定接口响应等待、图表稳定判断、数据就绪判断、失败分类、恢复策略建议、`waitForReadiness` 策略驱动数据就绪或网络空闲等待、`replanNavigation` 与 `replanFromCurrentState` 策略驱动重规划、`replaceSelector` 策略驱动 selector fallback、500ms 回退等待、Planner 条件化 wait、单次确定性重试、受控 selector fallback、语义 `select` 和配置上限内多轮 Planner 重规划，后续让更多恢复策略直接驱动路径选择。
   - Verifier 使用独立模型做复杂语义断言和失败归因。
   - Reporter 使用独立模型生成结构化报告和修复建议。
   - Executor 继续默认复用 Midscene，也允许切换独立执行模型策略。

3. 表格与图表专项 Verifier。
   - 表格筛选状态、分页状态和聚合值断言。
   - 图表 tooltip、数据区域和视觉趋势断言。
   - 将结构化观察转换为可判定的 verification evidence。

4. 录制回放视觉比较。
   - 像素差异与 diff 图片。
   - 动态区域遮罩和阈值。
   - 图表动画稳定策略。

5. PRD Planner 接入。
   - 文档摘要。
   - 测试路径生成。
   - 覆盖点映射。

## 9. 当前验收状态

当前最近一次验证：

```text
pnpm test
pnpm build
git diff --check
```

当前测试覆盖数量：

```text
18 files / 89 tests passed
```

注意：

- 构建存在 Vite chunk size warning。
- 该 warning 暂不影响功能。
- 后续可通过 route-level dynamic import 或 manualChunks 优化。

## 10. 当前开发原则

继续推进时遵守：

- 不再只做 UI。
- 每个新功能都必须进入 Agent 闭环。
- 能真实执行的动作才真实执行。
- 不确定 selector 的语义动作不硬猜，交给 Midscene。
- 所有执行过程必须结构化记录。
- 失败必须可诊断。
- 生成的测试资产必须可编辑。
