# 实施路线图

## 1. 当前阶段判断

当前项目已经完成了自动化测试 Agent 的外壳和一部分资产管理基础：

- Electron 桌面壳。
- React 工作台。
- 启动屏和 Midscene 配置引导。
- 项目、分组、环境、用例、录制、PRD、运行记录页面。
- 本地状态持久化。
- 浏览器 runtime 雏形。
- 录制事件和录制回放 runner 雏形。
- PRD 到路径/用例/录制草稿的基础链路。
- 自然语言 Agent 已进入 `Intent -> Plan -> Execute -> Observe -> Verify -> RunRecord` 的最小链路。
- 当前最小 Executor 已支持明确 URL 的 `navigate`、明确 selector 的 `click/input/select`、可等待 selector / 特定接口响应 / 图表稳定 / 数据就绪 / network idle / 固定 timeout 的条件化 `wait`、基础 `scroll`，以及基于 Observer 的宽泛 `extract` 与基于 Midscene `aiQuery` 的目标化 `extract`；直接提交的自然语言 `select`、条件 `wait`、`scroll` 与 `aiQuery` 也会分别解析执行意图并回显运行证据，不再依赖 Planner 先生成对应步骤。
- semantic click / input / assert 已具备可替换执行 contract，并能区分成功、失败和等待状态。
- Midscene `PlaywrightAgent` adapter 已绑定当前 BrowserRuntime Page，并在 Main Process 完成装配。
- Midscene 单动作耗时、模型调用量和 token usage 已进入 Agent Run 与运行记录，异常动作也会保留指标。
- Workflow 已转换为统一父级 Agent plan，顺序执行自然语言步骤并聚合事件、产物、指标和失败状态。
- 仅包含 `ai`、`aiAssert`、`aiQuery` 步骤的测试用例会复用统一 Workflow Agent Runtime，获得真实浏览器动作、验证、证据与报告；网页 fallback 和无法由专用执行器处理的步骤明确保持 `neutral`，不再模拟通过。
- 浏览器 fallback 的 Workflow 只生成等待态，不再模拟通过。
- Recording 已支持从录制页直接进入统一 Agent Run，真实回放节点并配对基线/实际截图证据；可比 PNG 截图会进行逐像素对比并生成差异图，差异会使回放失败，不可比截图保持 `neutral`。每条录制可配置 `0–100%` 的视觉差异阈值，默认 `0%` 保持严格比较；也可用截图相对坐标设置动态区域遮罩，遮罩像素不参与差异比例计算。
- Planner 已接入 OpenAI-compatible 模型调用，可生成经过白名单校验的结构化计划并顺序驱动现有执行链。
- 每个模型计划步骤都会生成独立 action、observation、verification 和 artifact 证据；`failed` 或 `neutral` 会停止后续步骤。
- Planner 配置缺失、请求失败或响应非法时会降级为规则规划并记录原因；执行器缺失或语义选择尚未接入时保持 `neutral`。
- 浏览器执行类步骤失败或进入等待态时已支持配置上限内的多轮 Planner 重规划，并记录实际重规划次数。
- 每次成功重规划都会保留旧计划截至失败步骤的完整执行证据，并以 `agent:plan-revised` 串联前后计划；恢复成功仍只按最终计划结果保持 `passed`。
- 重规划历史会保留动态等待、重试、selector fallback、观察、验证、浏览器状态、截图和报告产物；产物按路径跨轮次去重，Reporter 在失败或等待态运行中接收结构化重规划上下文。
- 带明确 selector/URL 的确定性浏览器步骤会在重规划前进行一次同计划重试，并记录重试事件与实际重试次数；明确 selector 的动作重试前会按 `selector visible -> network idle -> timeout` 的顺序做一次动态等待；断言失败不会自动重试。
- 明确 selector 的 `click/input/select` 在同计划重试失败后，会基于 Observer 的可交互元素做最多 3 个受控 selector fallback，并记录 fallback 事件与次数。
- 确定性浏览器步骤失败时已生成结构化 `failureCategory`，可区分 selector、timeout、navigation、network、assertion、runtime 和 unknown，并映射为 `recoveryStrategy`：selector 建议替换 selector，timeout/network 建议等待就绪，navigation 建议重规划导航，assertion 建议停止并报告，runtime 建议等待后重试，unknown 建议从当前状态重规划。分类和策略会写入重试事件、验证结果与 Planner 重规划上下文。
- `waitForReadiness` 策略已开始驱动恢复路径：timeout/network 类失败在同计划重试前，如果失败上下文明确涉及 table/list/grid/data/chart 等数据加载语义，会优先等待页面数据就绪；其余情况等待页面网络空闲，而不是只使用固定 500ms 等待。
- 图表稳定等待会在目标区域临时冻结 CSS/SVG 动画与过渡，并将 Canvas 的低分辨率像素签名纳入稳定判断；等待结束后自动移除冻结样式，避免影响后续交互。
- `replanNavigation` 策略已开始驱动恢复路径：导航失败不会盲目重试同一个坏 URL，而是直接把失败分类、策略和当前页面观察交给 Planner 重规划。
- `replaceSelector` 策略已开始驱动恢复路径：明确 selector 找不到时不会重复点击同一个坏 selector，而是直接进入受控 selector fallback；没有可靠候选时再交给 Planner 重规划。
- `replanFromCurrentState` 策略已开始驱动恢复路径：浏览器明确报告未知或不确定状态时，不会重复执行可能已产生副作用的动作，而是携带当前页面观察直接交给 Planner 生成后续计划；仍在加载、渲染等可识别的瞬时执行异常保持动态等待重试。
- Verifier 已支持从结构化表格观察中判断原生/明确标注的筛选状态、当前页、总页数、总条数、每页条数和 `tfoot` 聚合值；缺少对应 DOM 信号时断言保持失败，不会猜测通过。
- Observer 已将原生 `<table>` 与标准 ARIA `role="grid"` / `role="table"` 归一为同一表格观察 contract，因此现有行列、单元格、排序、筛选和分页断言可直接用于语义数据网格。
- 显式标注 `data-grid` / `data-table`、`data-column-header`、`data-row`、`data-cell` 与可选 `data-aggregate` 的自定义 `div` 网格也会归一到同一 contract；不依赖 class 名或整页布局猜测数据网格。
- 多表页面可在自然语言断言中用带引号的表格标题限定目标（例如 `断言表格「订单列表」行数为 2`）；标题严格匹配观察到的 caption，避免其他表格意外满足条件。
- 多图表页面可用带引号的标题限定目标（例如 `断言图表「成交趋势」图例包含 买入`）；标题严格匹配观察到的图表标题，避免其他图表意外满足条件。
- Verifier 已支持图表系列存在性断言（例如 `断言图表「成交趋势」系列包含 买入`）；系列名来自显式数据点或系列趋势，且与图表标题限定共同生效。
- Verifier 已支持指定图表数据点的标签和值关联断言（例如 `断言图表数据点 二月 为 180`），避免“标签存在、数值也存在但并非同一点”时误判通过。
- Verifier 已支持按系列、标签和值关联图表数据点（例如 `断言图表「成交趋势」系列 买入 数据点 二月 为 180`）；显式 `data-series` / `data-series-name` 与数据点必须同时匹配，避免同标签的不同系列互相误判。
- Verifier 已支持按指定系列验证趋势（例如 `断言图表「成交趋势」系列 买入 趋势上升`）；优先采用组件显式 `data-series-trend`，否则才从该系列至少两个显式数值点推导，系列间不会相互影响。
- Verifier 已支持从关联的可见 tooltip、显式 `data-point` / `data-chart-value` 数据点，以及显式或单系列单调数列趋势中生成图表证据；多个不同系列交错时仅接受显式 `data-trend`，不从混合数值猜测图表趋势。
- Verifier 已支持明确 CSS selector 的 DOM 存在、可见性、文本包含与单属性等值断言；无效 selector、未连接浏览器或隐藏元素都会留下失败证据，不会被当作语义断言默认通过。
- Verifier 已接入独立 OpenAI-compatible 模型路由，处理规则断言覆盖不了的复杂语义断言，并保留确定性断言优先级。
- Reporter 已接入独立 OpenAI-compatible 模型路由，可为失败/等待态运行生成证据摘要、失败归因和修复建议。
- Reporter Markdown 和 HTML 已持久化为运行 artifact；运行记录可通过受控 IPC 打开或导出应用管理目录内的本地报告，渲染进程不能借此访问任意本地路径。
- 运行记录已提供运行内证据链：可从 Agent 事件流定位同一节点的页面观察、验证依据、浏览器状态、截图预览和同步骤产物，并对受控本地产物执行打开或导出。
- 运行智能分析已按可见运行样本对结构化失败原因做保守聚类，并展示高频失败模式及样本数；仅归并空白和末尾标点差异，不猜测语义等价原因。
- 运行智能分析会在至少 4 条带时间戳样本时比较近期与早期窗口的失败率，展示上升、下降或稳定趋势；样本不足时明确显示而不推断风险走向。

更详细的当前状态见：

- [自动化测试 Agent 进度与目标状态](./agent-progress-and-target.md)

接下来的路线不再围绕 UI 页面补全，而是围绕 Agent 闭环推进：

```text
Intent -> Plan -> Execute -> Observe -> Verify -> Report -> Asset
```

## 2. Milestone 0：Agent 目标与文档收敛

目标：

- 明确最终产品定位为自动化测试 Agent。
- 统一产品、架构、数据模型和 UI 设计文档。
- 避免继续以“测试管理客户端”作为实现目标。

交付：

- `automated-testing-agent-design.md`
- 更新后的产品需求文档。
- 更新后的系统架构文档。
- 更新后的实施路线图。

验收：

- 文档明确 Agent 能力闭环。
- 文档明确启动屏、Midscene 配置和门禁逻辑。
- 文档明确下一阶段优先打通自然语言 Agent 执行链路。

## 3. Milestone 1：Agent Runtime Contract

目标：

- 在 shared/electron 之间定义统一 Agent 执行协议。

交付：

- `AgentIntent`
- `AgentPlan`
- `AgentStep`
- `AgentObservation`
- `AgentVerification`
- `AgentRunEvent`
- `AgentRunResult`

验收：

- Renderer 可以用统一结构发起 Agent 执行。
- Main Process 可以用统一事件流回传计划、步骤、截图、判断和结果。
- 当前 `sendChatCommand` 和后续 `runWorkflow` 都能逐步迁移到该协议。

## 4. Milestone 2：自然语言 Agent 最小闭环

目标：

- 让自然语言测试成为第一个真正可用的 Agent 入口。

功能：

- 用户输入自然语言测试目标。
- 系统生成基础计划。
- 启动受控浏览器。
- 执行 navigate / click / input / assert。
- 当前已支持明确 URL、明确 selector 点击、明确 selector 输入，以及 URL/标题/页面文本包含断言。
- 采集截图和日志。
- 输出通过或失败。
- 写入运行记录。

验收：

- 用户可以在一个真实 Web 页面完成一次自然语言测试。
- 失败时能看到失败步骤和截图。
- 成功步骤可以保存为用例步骤。

## 5. Milestone 3：Observer / Verifier 强化

目标：

- 让 Agent 不只是执行动作，还能判断结果。

功能：

- DOM 摘要采集。
- 页面文本摘要、关键交互元素、console 和失败请求的轻量观察快照。
- 页面截图采集。
- 文本断言。
- 表格断言。
- 图表展示状态断言。
- 失败原因归因。

验收：

- 对图表和表格型页面能输出明确判断。
- 失败报告包含证据。

## 6. Milestone 4：录制回放 Agent 化

目标：

- 让录制回放成为 Agent 的路径采集与复跑能力。

功能：

- 录制 navigate / click / input / wait / snapshot。
- 生成可编辑录制资产。
- 回放录制资产。
- 对关键节点截图对比。
- 将录制资产转为测试用例。
- 直接运行录制资产并生成 Recording Agent Run。
- 基线截图与实际截图证据配对。

验收：

- 用户可以录制一条业务路径并回放。
- 回放失败时能定位失败节点。
- 录制资产删除后引用关系能安全处理。

## 7. Milestone 5：PRD Agent Planner

目标：

- 让 PRD/PDF 不只是上传材料，而是测试路径生成输入。

功能：

- PDF 文本抽取。
- LLM/Midscene 参与需求分析。
- 生成功能点、验收标准、测试路径、优先级。
- 生成用例或录制草稿。
- 标记覆盖状态。

验收：

- 用户上传一份 PRD 后能得到可编辑测试路径。
- 测试路径能转成正式用例。
- 运行记录能关联 PRD 来源。

## 8. Milestone 6：报告与结果分析

目标：

- 让运行记录成为可复盘的测试报告中心。

功能：

- RunDetail 详情页。
- 步骤截图。
- Trace / artifact 链接。
- 失败原因摘要。
- 复跑入口。
- 按项目、分组、用例、环境过滤。
- 展示真实运行耗时、模型调用数、token 用量与重规划配置。
- 展示实际动态等待次数、重试次数和 selector fallback 次数。

验收：

- 每次 Agent 执行都有可查看、可复盘、可复跑的结果。

## 9. Milestone 7：工程化与稳定性

目标：

- 从可用原型走向可长期使用的本地工具。

功能：

- 资产文件拆分。
- 凭证安全存储。
- 执行超时和重试策略。
- selector fallback 扩展策略。
- 日志分级。
- 可配置模型供应商。
- CI 导出或命令行执行预留。

验收：

- 复杂页面失败率可控。
- 运行产物不会污染主状态文件。
- 用户可以长期维护项目资产。

## 10. 当前最高优先级

下一步按这个顺序推进：

1. 用真实模型和业务页面验收 Planner 多步骤执行与 semantic click、semantic input、semantic assert，核验耗时、usage、报告与失败证据。
2. 在已完成的动态等待、特定接口响应等待、图表稳定判断、数据就绪判断、失败分类、恢复策略建议、`waitForReadiness`、`replanNavigation` 和 `replaceSelector` 策略驱动、条件化 wait、单次确定性动作重试、受控 selector fallback 和配置上限内多轮重规划基础上，继续让更多恢复策略直接驱动路径选择。
3. 以真实业务页面验收语义 `select` 与目标化 `extract`：核验原生/自定义下拉框表现，以及 `aiQuery` 返回值、报告、usage 和失败证据。
4. 在已完成运行内证据链导航、重规划历史关联、受控本地报告打开与导出的基础上，以真实业务页面验收报告、截图、trace 与步骤事件的关联完整性。
5. 在已完成图表动画稳定策略的基础上，以真实图表页面验收 CSS、SVG 与 Canvas 动画的稳定判定、耗时和失败证据。

## 11. 风险与应对

### 风险 1：继续只做 UI，核心执行迟迟不通

应对：

- 每个新页面需求都必须说明它服务 Agent 闭环的哪个环节。
- 优先打通自然语言执行闭环。

### 风险 2：Agent、Workflow、Recording 三套执行逻辑分裂

应对：

- 用统一 Agent Runtime contract 收敛。
- Workflow 与 Recording 已使用统一 Agent Run；仅包含一个 `recordingReplay` 步骤的测试用例已收敛到同一 RecordingRunner，并保留测试用例关联、视觉对比和回放证据。混合用例中的录制步骤会委托给 RecordingRunner，后续 `ai`、`aiAssert`、`aiQuery` 会在当前页面继续复用 Workflow Runtime；子段日志、产物与 Agent Run 都会折叠进父用例运行。父用例会生成单一 Agent Run，规范化全部测试步骤、子段事件、产物与模型指标；运行记录默认展示用例总览，也可切换查看子段。失败或等待态会阻断后续步骤。

### 风险 3：Midscene 接入后调试困难

应对：

- 所有模型输入输出、计划、动作、观察和断言都结构化记录。
- 失败时保存截图和原始错误。

### 风险 4：图表和表格页面稳定性不足

应对：

- 表格专项断言优先采用表格范围内的结构化 DOM 信号，避免从整页文本推断筛选、分页或聚合状态。
- 图表先做存在性、标题、图例、tooltip 和数据区域断言。
- 后续再做更复杂视觉对比。

## 12. 完成定义

一个阶段可以被视为完成，至少满足：

- 有明确用户入口。
- 有真实 runtime 或可替换的 contract。
- 有结构化事件。
- 有运行记录。
- 有错误反馈。
- 有测试覆盖。
- 有文档同步更新。
