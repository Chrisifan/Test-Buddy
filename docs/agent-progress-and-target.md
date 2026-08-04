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
- 运行记录支持在 Agent 事件流中选择证据节点，并查看其页面观察、验证依据、浏览器状态、截图预览与同步骤产物；受应用管理的文件仍只通过受控 IPC 打开或导出。

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
- 仅包含这三类步骤的测试用例也会转换为 Workflow 并复用同一执行链；因此用例运行具备浏览器动作、验证、证据和报告，而不是单独模拟通过。
- 每个步骤的 browser action、observation、verification、artifact 和 usage 聚合到父级 `AgentRunResult`。
- 多步骤 metrics 会合并调用数、耗时、token 以及 `byIntent` / `byModel` 用量。
- 任一步进入 `failed` 或 `neutral` 后暂停后续执行；父运行保留对应状态，未执行步骤保持 `neutral`。
- 无法解析为当前可执行动作的步骤保持 `neutral`，不继承旧 stub 的默认通过状态。
- 浏览器 fallback 只生成 `neutral` 计划，不再产生假通过记录。
- 含人工步骤或尚未由专用执行器覆盖的测试用例也保持 `neutral`，直到获得真实执行证据。
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
- 仅包含一个 `recordingReplay` 步骤的测试用例会直接交给 RecordingRunner，复用真实回放、视觉比较、差异产物和 Recording Agent 证据；运行详情与 Agent intent 均关联原测试用例。
- 混合测试用例中的 `recordingReplay` 也会委托给 RecordingRunner；子运行日志和产物会折叠进入父用例，且 `failed` / `neutral` 结果会将后续步骤明确标记为未执行，避免绕过前置条件。
- 录制片段通过后，混合用例中的 `ai`、`aiAssert`、`aiQuery` 会以单步骤 Workflow 段在当前浏览器页面继续执行，不会跳回测试用例初始 URL；每段真实执行的日志与产物同样归入父用例。
- 父用例会持久化每个子段的 `AgentRunResult`，并生成单一父级 Agent Run，统一归档测试步骤计划、事件、产物和模型指标；运行记录在多段时默认显示“用例总览”，也可切换子段查看计划、页面观察、验证、模型指标和产物。
- 等待态人工步骤可在运行记录中填写检查说明后确认通过或失败；确认结果会更新步骤、父级 Agent 验证事件、运行摘要与持久化记录。人工确认可采集当前受控浏览器截图，也可从桌面端选择文件；选择的文件会由主进程复制至受控 artifacts 目录，渲染层仅接收托管后的引用。确认通过但仍有未执行步骤时，整例继续保持 `neutral`。
- 用例编辑器可将人工检查步骤转换为可编辑的 `aiAssert` 智能断言，保留原步骤标题和检查意图；转换仍走现有 Agent 执行、验证和运行记录链路，空指令不会被伪造成可执行步骤。
- 浏览器 fallback 只生成 `neutral` Recording Agent 计划，不模拟回放成功。
- 图表稳定等待会临时冻结目标区域的 CSS/SVG 动画和过渡，并采样 Canvas 像素摘要；完成或超时后会清理临时样式和标记。

尚未完成：

- 真实业务图表页上的稳定性验收。

因此当前截图读取失败、尺寸不一致、没有可比基线，或动态区域遮罩覆盖全部截图时，Recording Agent 明确标记为 `neutral`，不会伪造视觉通过；每条录制可设置 `0–100%` 容差阈值与按截图百分比坐标配置的动态区域遮罩。遮罩像素不进入差异比例分母，也不会在差异图中标红。

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
- 自然语言页直接提交的 `aiQuery` 会识别“提取/读取/查询/获取”后的目标并直接调用语义 `extract`，无需先由 Planner 生成步骤；返回 evidence 会同时写入 Agent Run 并回显到会话。目标化提取缺少 Midscene 配置时保持 `neutral`，不会把普通 Observer 快照伪造为目标值。
- 自然语言页直接提交“在 `#status` 中选择 success”一类命令，会解析明确 selector 与选项值并调用 Browser Runtime `select`；选择后的页面快照、观察和运行证据与 Planner `select` 步骤复用同一链路。未带 selector 的语义选择仍需要 Midscene。
- 自然语言页直接提交“等待 `#orders-table` 数据加载完成 2 秒”“等待网络空闲”或“滚动到 `#filters`”时，会复用条件化等待和滚动执行器；等待时长可以出现在 selector 或数据就绪描述之后，避免自然语序导致默认等待时长被误用。
- Planner 显式 `wait` 步骤已经支持条件化等待：指令表达图表稳定时等待图表签名稳定；指令表达数据、表格或列表就绪时等待数据签名就绪；带 `selector` 时等待目标可见；带明确 URL 或 `/api/...` 路径时等待特定接口响应；指令包含网络空闲、接口稳定、请求稳定时等待 `networkidle`；其他等待继续使用固定 timeout。
- 每一步都生成独立的 started、browser action、observation、verification 和 artifact 事件。
- 只有全部计划步骤通过时整次运行才为 `passed`；失败或执行器缺失动作会停止后续步骤。
- 不带 `target` 的 `extract` 会复用 Observer 快照，把页面文本、表格和图表信息作为步骤证据写入运行记录；带明确 `target` 且 Midscene 配置完整时调用 `aiQuery`，将返回的结构化结果 JSON 写入该步骤 evidence，模型未返回结果时明确标记失败。
- 浏览器执行类步骤失败或进入等待态时，会基于最新 URL、标题、Observer 摘要和可交互元素向 Planner 请求一次修正版计划。
- 带明确 selector/URL 的 `navigate`、`click`、`input`、`select` 以及确定性 `wait`、`scroll`、`observe` 步骤，会在请求 Planner 重规划前进行一次同计划重试。
- 明确 selector 的 `click`、`input`、`select` 首次失败后，会在同 selector 重试前按 `selector visible -> network idle -> timeout` 的顺序做一次动态等待；如果当前浏览器 runtime 不支持 selector readiness，会尝试 `networkidle`，再不支持才回退为 500ms 页面稳定等待。等待结果会写入 `agent:dynamic-wait` 事件和 `metrics.dynamicWaitAttempts`，selector 等待会额外记录目标 selector，network idle 等待会记录 `strategy: networkIdle`。
- 首次失败尝试会写入 `agent:step-retried` 结构化事件，实际重试次数写入 `metrics.retryAttempts`；断言和语义模型动作不会进入这条盲重试路径。
- 确定性浏览器步骤失败会生成结构化 `failureCategory`，当前覆盖 selector、timeout、navigation、network、assertion、runtime 和 unknown；该分类会映射为 `recoveryStrategy`，当前覆盖 replaceSelector、waitForReadiness、replanNavigation、stopAndReport、retryAfterWait 和 replanFromCurrentState。分类和策略会写入 retry attempt、验证结果和 Planner 重规划的 previousFailure。
- `waitForReadiness` 已开始直接驱动恢复路径：网络失败且计划步骤明确给出 URL 或 `/api/...` 路径时，先等待该接口的下一次成功响应；没有稳定接口信息时，timeout/network 类失败若上下文明确涉及 table/list/grid/data/chart 等数据加载语义则优先等待页面数据就绪，其他情况等待页面网络空闲，减少数据仍在加载时的盲重试。动态等待无论成功或失败都会保留实际 strategy、超时、selector 或接口模式；就绪等待失败时会跳过原操作重试和 selector fallback，直接交给 Planner 基于当前页面状态重规划。
- `retryAfterWait` 已开始直接驱动恢复路径：滚动、观察等可安全重试的确定性运行时异常会先等待页面网络空闲，浏览器不支持该能力时才回退为短暂稳定等待；导航异常仍保守地走 `replanNavigation`，不重复访问可能不可达的地址。
- `replanNavigation` 已开始直接驱动恢复路径：导航失败会跳过同 URL 重试，直接进入 Planner 重规划，避免把不可达地址重复执行两次。
- `replaceSelector` 已开始直接驱动恢复路径：明确 selector 找不到时跳过同 selector 重试，优先从 Observer 可交互元素中尝试受控 selector fallback；没有可靠候选时再进入 Planner 重规划。
- `replanFromCurrentState` 已开始直接驱动恢复路径：浏览器报告未知或不确定状态时跳过同计划重试，携带当前页面观察直接请求 Planner 从当前状态继续；页面仍在加载、渲染等可识别瞬时异常仍保持动态等待重试。
- 明确 selector 的 `click`、`input`、`select` 会从最新 `AgentObservation.interactiveElements` 中解析最多 3 个可解释候选；当失败策略是 `replaceSelector` 时按 `原 selector -> selector fallback -> Planner 重规划` 恢复，其他可重试失败仍保留动态等待和同计划重试。
- selector fallback 候选必须与原 selector、步骤标题、步骤指令或目标文案存在词元重合，并且动作类型要兼容；尝试结果会写入 `agent:selector-fallback` 事件和 `metrics.selectorFallbackAttempts`。
- 重规划成功后从修正版计划重新执行；Planner 层会读取 `replanningCycleLimit`，在配置上限内允许多轮重规划，并在 metrics 中记录 `replanningCycleLimit` 和实际 `replanningCycles`；达到上限或重规划失败时保留当前失败结果。
- 每次成功重规划都会保留旧计划截至失败步骤的完整执行证据，并生成结构化 `agent:plan-revised` 事件关联前后计划、触发步骤、失败分类和恢复策略；恢复成功仍只按最终计划结果保持 `passed`。
- 重规划请求会跨所有恢复轮次累积携带已通过步骤的动作、证据和对应页面 URL，Planner 只生成当前状态之后的后续步骤；执行器会剔除与任一已完成步骤完全相同的有副作用动作，`agent:plan-revised` 会记录累计保留的前置步骤数，避免已完成的输入或点击在后续修订中被重复执行。
- 重规划历史覆盖动态等待、重试、selector fallback、观察、验证、浏览器状态、截图和报告产物；截图和报告按路径跨轮次去重，选择重规划事件可查看同一步骤的关联证据，Reporter 在失败或等待态运行中接收结构化重规划上下文。
- 真实 Playwright 会话已改为 BrowserContext。自然语言 Agent、Workflow 与录制回放在运行开始时启用 tracing，运行结束时将 Trace `.zip` 归档到 `studio-data/artifacts`；Trace 会同步追加为 `AgentRunResult` 和运行记录 artifact，并产生 `agent:artifact-created` 事件。stub 或浏览器启动失败时不生成伪造 Trace。
- 断言失败不会被自动重规划吞掉，仍交给 Verifier / Report 链路明确呈现。

规则降级目前能识别：

- 明确 URL。
- `点击 selector`。
- `在 selector 输入 value`。
- 简单语义点击或输入目标。

还没有做到：

- 更细粒度的恢复策略编排，例如让更多 recoveryStrategy 直接决定是否跳过同计划重试、是否优先等待数据就绪、是否进入 selector fallback 或 Planner 重规划。
- 以真实模型验收复杂跨段落条件的语义分析质量，并让覆盖矩阵支持更完整的跨文档缺口治理，例如筛选、批量处理和缺口分派。
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
- MidScene 设置页可对当前填写但尚未保存的模型配置发送一次最小 completion 探针，验证 OpenAI-compatible 服务地址、鉴权和模型响应；探针在 Main Process 中执行，结果仅返回状态、耗时和安全分类，不回显密钥或供应商响应正文，也不创建运行记录。
- 每次语义动作会记录 wall time、模型耗时、模型调用数、prompt/completion/total token 和缓存输入 token。
- 同一 Page 复用 Agent 时，会用执行前后的累计指标计算单动作差值，避免后续运行重复累计历史用量。
- 语义动作异常时仍保留已产生的耗时和 usage，并以结构化 `failed` 结果进入运行记录。
- Planner、重规划、语义动作和 Reporter 的单次模型指标会关联到各自 Agent 事件；运行记录的事件流和证据详情可直接查看该事件的调用量、token 与模型耗时，不再只能读取运行总计。
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
断言 DOM #summary 存在
断言 DOM #summary 文本包含 登录成功
断言 DOM #save 可见
断言 DOM #active-tab 属性 aria-selected 为 true
断言表格包含 成交量
断言表格行数为 2
断言表格「订单列表」行数为 2
断言表格列数为 3
断言表格第1行第2列为 120
断言表格列 状态 包含 成功
断言表格列 成交量 合计为 200
断言表格按 成交量 降序
断言表格筛选 状态 为 成功
断言表格当前页为 2
断言表格总页数为 4
断言表格总条数为 36
断言表格每页 10 条
断言表格聚合 成交量 为 200
断言图表包含 买入
断言图表数量为 2
断言图表已渲染
断言图表标题为 成交趋势
断言图表图例包含 买入
断言图表「成交趋势」图例包含 买入
断言图表提示包含 二月
断言图表数据区域包含 180
断言图表「成交趋势」系列包含 买入
断言图表数据点 二月 为 180
断言图表「成交趋势」系列 买入 数据点 二月 为 180
断言图表「成交趋势」系列 买入 趋势上升
断言图表趋势上升
```

行为：

- URL 断言基于当前浏览器 `currentUrl` 判断。
- 标题断言基于当前浏览器 `pageTitle` 判断。
- 页面文本断言会读取真实页面 `innerText`，无真实页面时使用会话快照信息作为降级文本。
- DOM selector 断言会检查明确 CSS selector 的存在性、可见性、元素文本或指定属性等值；可见性会排除 `hidden`、`aria-hidden`、`display: none`、`visibility: hidden` 和完全透明元素。属性检查仅读取断言请求的一个属性，可用于 `value`、`checked`、`disabled`、ARIA 和 `data-*` 状态。
- 表格断言基于 `AgentObservation.tables` 中的标题、行列数、表头和样例行做基础 contains 判断。
- 多表页面可将表格标题写为 `表格「标题」`、`table "Title"` 或 `table 'Title'` 来限定断言目标；该标题与观察到的 caption 严格匹配，未指定时保留对全部表格的原有判断。
- 表格观察同时支持原生 `<table>` 与标准 ARIA `role="grid"` / `role="table"`；ARIA 网格使用 `columnheader`、`row`、`gridcell` / `rowheader` / `cell` 归一为表头和样例行。
- 自定义 `div` 网格可通过 `data-grid` / `data-table` 根节点及 `data-column-header`、`data-row`、`data-cell`、`data-aggregate` 钩子进入相同的表格观察与断言链路。
- 表格行数/列数断言基于 `AgentObservation.tables` 做严格数值比较。
- 表格单元格断言基于 `AgentObservation.tables.sampleRows` 做严格相等比较，当前以观察到的样例行为准。
- 表格列包含断言基于表头定位列，并在 `AgentObservation.tables.sampleRows` 中查找目标值。
- 表格列合计断言基于表头定位列，并对 `AgentObservation.tables.sampleRows` 中可解析的数值单元格求和。
- 表格排序断言优先基于 `AgentObservation.tables.sortStates` 做列名与方向严格匹配；没有排序状态时，会基于表头和样例行推断升序/降序。
- 表格筛选断言基于表格范围内具有 `data-filter` 的控件状态；筛选名称和当前值必须严格匹配。
- 表格分页断言基于 `data-current-page`、`data-total-pages`、`data-total-items`、`data-page-size`、`aria-rowcount` 或明确分页导航的当前页/页数文本；AG Grid、MUI、Ant Design、Element Plus 已知分页根节点中的非末页范围文本（例如 `1 to 10 of 36`）也会被严格归一为当前页、每页条数、总条数和总页数。末页不足一页的范围只保留可确定的总条数，不把剩余条数猜作 page size。没有可识别元数据时不会推断状态。
- 表格聚合值断言基于 `tfoot` 中按表头或 `data-aggregate` 标记采集的值；它与仅对样例行求和的列合计断言保持区分。
- 图表断言基于 `AgentObservation.charts` 中的标题、类型、尺寸和图例做基础 contains 判断。
- 多图表页面可将图表标题写为 `图表「标题」`、`chart "Title"` 或 `chart 'Title'` 来限定断言目标；标题与观察到的图表标题严格匹配，未指定时保留对全部图表的原有判断。
- 图表数量断言基于 `AgentObservation.charts.length` 做严格数值比较。
- 图表渲染断言基于 `AgentObservation.charts.rendered` 做可见尺寸状态判断。
- 图表标题断言基于 `AgentObservation.charts.title` 做严格相等比较。
- 图表图例断言基于 `AgentObservation.charts.legends` 做列表包含判断。
- 图表提示断言基于图表内部、`aria-describedby` 关联或以图表标识显式关联的可见 tooltip；对于当前页面只观察到一个图表时，也可采集唯一可见的 ECharts、Recharts、Highcharts 或 ApexCharts tooltip。隐藏、关闭或无法可靠归属的提示不会作为证据。
- 图表数据区域断言基于显式 `data-point` / `data-chart-value` 数值点的系列、标签和值做严格包含判断。
- 图表系列存在断言会严格匹配显式数据点或系列趋势中的系列名；可与带引号的图表标题组合，避免其他图表的同名系列误判通过。
- 图表数据点断言会同时匹配同一个显式数据点的标签和值；例如“二月为 180”不会因为另一数据点值为 `180` 而通过。
- 图表系列数据点断言会同时匹配 `data-series` / `data-series-name`、标签和值；例如“买入系列二月为 180”不会因为卖出系列二月为 `180` 而通过。数据系列可与图表标题一起限定。
- 图表系列趋势断言优先读取指定系列的 `data-series-trend`，否则才根据该系列至少两个显式数值点的顺序判断上升、下降、平稳或混合；证据不足时不会通过。显式标记会覆盖数据点推导结果，系列趋势会同时写入运行记录的图表证据。
- 图表趋势断言优先使用 `data-trend`；未标注时仅在单系列（或没有系列信息）的至少两个结构化数值点单调上升、单调下降、完全持平或混合时给出对应趋势。多个不同系列的交错数值不会自动推导趋势。
- 复杂语义断言会携带 URL、标题、DOM 摘要、文本摘要、表格和图表观察结果进入 Verifier 模型。
- Verifier 模型必须返回 `passed`、`failed` 或 `neutral` 结构化结果；证据不足时保持 `neutral`，不会默认通过。
- Verifier 模型 usage 会合并进入 Agent Run metrics，并且 API Key 不写入运行记录。
- 断言失败时 `AgentRunResult.status` 会标记为 `failed`，并写入 `failureReason`。

还没有真实支持：

- 从 Canvas/SVG 像素或无法可靠关联的第三方图表组件读取 tooltip、数据点和视觉趋势。
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
- 运行记录可沿同一事件步骤查看关联观察、验证、浏览器状态、截图预览及 artifact，并对关联报告执行打开或导出。
- Reporter 的结构化摘要、失败归因和建议会随 Agent Run 持久化；运行记录可从仍存在的原用例显式创建独立修复草稿。恢复计划不解析 Reporter 自由文本，而是仅根据已记录的失败分类、恢复策略和动态等待证据确定性生成；允许的草稿步骤只有等待接口响应、等待 selector、等待数据就绪、等待网络空闲或观察。草稿会复制原用例、重建步骤 ID，并在原失败步骤之前插入一条受控 `ai` 等待/观察步骤；自由文本建议只保留在草稿说明，不能转成点击、输入、选择或导航动作。用户必须在编辑器审阅并主动运行，原用例不会被改写。
- 运行智能分析会在当前筛选范围内按失败原因聚类并展示最多 3 个高频模式；仅归并空白和末尾标点差异，避免把不同故障原因猜测为同类。
- 运行智能分析会在至少 4 条具有有效开始时间的样本中对比早期和近期失败率；相差不足 15 个百分点显示稳定，样本不足时不输出趋势结论。

还没有完成：

- 将更多真实页面证据扩展为可验证的受控恢复目标；不把 Reporter 自由文本转成可执行重试策略。

### 5.5 Observer 已有轻量观察快照

当前 Observer 能捕获：

- 当前 URL。
- 页面标题。
- 明确 selector 的 DOM 存在性、可见性、文本摘要与指定属性值（按断言请求即时采集）。
- 截图路径。
- 页面文本摘要。
- 关键可交互元素摘要。
- console error / warning。
- network failed request。
- 表格标题、行列数、表头和样例行。
- 表格排序列与排序方向。
- 表格范围内 `data-filter` 控件的筛选状态、ARIA/data 属性或分页导航给出的分页状态，以及 `tfoot` 聚合值。
- 图表标题、类型、尺寸和图例；同时识别 ECharts、Recharts、Highcharts、ApexCharts 的公开图表根节点并避免子 Canvas/SVG 重复计数。
- 图表关联的可见 tooltip、单图页面唯一可归属的库 tooltip、显式数据点和由显式数值点得到的趋势。

当前这些数据会进入 `AgentObservation`：

- `textSummary`
- `domSummary`
- `interactiveElements`
- `consoleMessages`
- `networkHints`
- `tables`
- `charts`

真实 Playwright 运行还会额外归档 Context Trace：它不作为 Observer 字段混入页面摘要，而是使用受控 `trace` artifact 关联到对应 Agent Run、运行记录和事件流，供既有打开与导出能力处理。

还需要补：

- 更完整的 DOM 结构摘要。
- Canvas/SVG 内部数据、多个图表之间无法可靠归属的第三方 tooltip 和像素级视觉趋势读取。
- 仅依赖框架私有 class 名、且未提供原生、ARIA 或 `data-*` 结构钩子的第三方数据网格读取。

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
- 从历史运行记录按原用例和原环境复跑；原资产被删除时入口不会显示，运行中不会创建并发复跑。
- 可按项目、分组、用例、环境和状态筛选运行记录；选中运行会自动与同一项目、同一用例、同一环境的最近历史运行对比结果、步骤状态、产物数量和耗时，避免不同测试目标的样本互相干扰。

还需要补：

- 更完整的失败证据链。
- 失败原因归因。

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
- 真实 Playwright Trace 的受控归档、事件关联和运行记录 artifact 展示。
- Midscene 单动作耗时与 usage 差值归档，包括失败动作证据。
- Workflow 到统一 Agent plan、事件、指标和运行记录的聚合链路。
- Recording 直接回放、基线/实际截图证据配对与运行记录链路。

### 仍然距离较远的部分

- 真实模型与业务页面的稳定性验收。
- Verifier / Reporter 独立模型路由的真实模型验收。
- 更完整的 verifier。
- 失败归因。
- PRD 模型语义复核在真实复杂文档上的质量验收，以及覆盖矩阵驱动的批量缺口治理。
- 图表和表格高级断言。
- 运行报告体系。
- 稳定性工程。

### 已完成的工程化执行入口

- `pnpm build:electron && pnpm cli -- run --data-dir <数据根目录> --project-id <项目ID> --case-id <用例ID>` 可以在不启动 Electron 窗口的情况下执行已保存的项目资产。
- CLI 只接受稳定 ID；可重复 `--case-id` 批量执行，并可选用 `--environment-id` 统一覆盖选中用例的环境。
- CLI 与桌面端共用 TestRunner、RecordingRunner、StudioRuntime、BrowserRuntime 和 artifact 归档；执行结果会写回 `studio-data/state.json`，录制视觉比较继续生成差异图。
- CLI 标准输出 JSON，并默认将 JUnit XML 写入 `studio-data/artifacts`；`--junit` 与 `--json` 可指定报告落盘位置。
- 无 Midscene 配置时，录制回放仍可执行；需要模型的 Agent 用例会输出明确失败并以非零退出码结束，不会降级为伪通过。

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
   - 已完成 selector readiness 动态等待、特定接口响应等待、图表稳定判断、数据就绪判断、失败分类、恢复策略建议、`waitForReadiness` 策略驱动数据就绪或网络空闲等待、`replanNavigation` 与 `replanFromCurrentState` 策略驱动重规划、`replaceSelector` 策略驱动 selector fallback、500ms 回退等待、Planner 条件化 wait、单次确定性动作重试、受控 selector fallback、语义 `select`、携带已完成前缀的跨步骤连续重规划、配置上限内多轮 Planner 重规划和跨轮次证据历史，后续让更多恢复策略直接驱动路径选择。
   - Verifier 使用独立模型做复杂语义断言和失败归因。
   - Reporter 使用独立模型生成结构化报告和修复建议。
   - Executor 继续默认复用 Midscene，也允许切换独立执行模型策略。

3. 表格与图表专项 Verifier。
   - 扩展无结构钩子的第三方数据网格读取，以及更多跨框架筛选、分页和聚合值信号。
   - 扩展 Canvas/SVG 与第三方图表库的结构化数据区域和视觉趋势读取；当前仅采集可可靠归属的 tooltip，不从像素或未标注文本猜测数据点。
   - 将结构化观察转换为可判定的 verification evidence。

4. 录制回放视觉比较。
   - 像素差异与 diff 图片。
   - 已完成动态区域遮罩和阈值。
   - 已完成图表动画稳定策略，待真实业务图表页验收。

5. PRD Planner 接入。
   - 已完成文档摘要、规则化需求提取和测试路径生成。
   - Markdown 标题、列表与正文中的可验收条款会被去重并最多生成 8 条路径；每条路径保留原文摘录、覆盖域、保守优先级和可编辑的“进入、执行、断言”步骤。
   - 已完成路径写入正式用例或录制草稿，并以 `documentId + pathId` 显示稳定覆盖状态；资产改名、同名条款或重新分析未变更条款不会误判覆盖，历史资产保留名称回退兼容。PRD 来源会随执行进入 Agent Run、RunDetail 和运行列表。
   - 已接入 Planner 角色模型进行受限语义复核：模型仅能细化规则已抽取的候选路径，保留原文摘录与稳定 `pathId`；模型未配置、停用、请求失败或返回越界路径时自动保留规则结果并在文档页显示降级原因。
- 已提供项目级 PRD 覆盖矩阵，汇总全部文档路径与对应的用例、录制状态，优先使用 `documentId + pathId`，同时保留历史资产兼容匹配；未覆盖路径可直接写入用例或录制草稿，也可跨文档一次性写入全部缺口用例或录制草稿，并按缺用例、缺录制、完全未覆盖和治理状态筛选。
- 矩阵内已提供本地缺口治理：以 `documentId + pathId + target` 记录用例/录制的延后或忽略决定，必须填写说明和更新时间；资产覆盖生成后显示已解决但不删除说明，文档或路径失效时会清理决策。应用没有登录或成员体系，因此不做分派、通知或外部协作同步。
- 待以真实模型/复杂 PRD 验收跨段落条件关联质量；成员分派仅在未来具备成员体系后再评估。

## 9. 当前验收状态

当前最近一次验证：

```text
pnpm test
pnpm build
git diff --check
```

当前测试覆盖数量：

```text
37 files / 259 tests passed
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
