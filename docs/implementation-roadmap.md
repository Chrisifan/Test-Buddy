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
- 当前最小 Executor 已支持明确 URL 的 `navigate`、明确 selector 的 `click/input/select`、可等待 selector / 特定接口响应 / 图表稳定 / 数据就绪 / network idle / 固定 timeout 的条件化 `wait`、基础 `scroll`，以及基于 Observer 的宽泛 `extract` 与基于 Midscene `aiQuery` 的目标化 `extract`。
- semantic click / input / assert 已具备可替换执行 contract，并能区分成功、失败和等待状态。
- Midscene `PlaywrightAgent` adapter 已绑定当前 BrowserRuntime Page，并在 Main Process 完成装配。
- Midscene 单动作耗时、模型调用量和 token usage 已进入 Agent Run 与运行记录，异常动作也会保留指标。
- Workflow 已转换为统一父级 Agent plan，顺序执行自然语言步骤并聚合事件、产物、指标和失败状态。
- 浏览器 fallback 的 Workflow 只生成等待态，不再模拟通过。
- Recording 已支持从录制页直接进入统一 Agent Run，真实回放节点并配对基线/实际截图证据；可比 PNG 截图会进行逐像素对比并生成差异图，差异会使回放失败，不可比截图保持 `neutral`。每条录制可配置 `0–100%` 的视觉差异阈值，默认 `0%` 保持严格比较。
- Planner 已接入 OpenAI-compatible 模型调用，可生成经过白名单校验的结构化计划并顺序驱动现有执行链。
- 每个模型计划步骤都会生成独立 action、observation、verification 和 artifact 证据；`failed` 或 `neutral` 会停止后续步骤。
- Planner 配置缺失、请求失败或响应非法时会降级为规则规划并记录原因；执行器缺失或语义选择尚未接入时保持 `neutral`。
- 浏览器执行类步骤失败或进入等待态时已支持配置上限内的多轮 Planner 重规划，并记录实际重规划次数。
- 带明确 selector/URL 的确定性浏览器步骤会在重规划前进行一次同计划重试，并记录重试事件与实际重试次数；明确 selector 的动作重试前会按 `selector visible -> network idle -> timeout` 的顺序做一次动态等待；断言失败不会自动重试。
- 明确 selector 的 `click/input/select` 在同计划重试失败后，会基于 Observer 的可交互元素做最多 3 个受控 selector fallback，并记录 fallback 事件与次数。
- 确定性浏览器步骤失败时已生成结构化 `failureCategory`，可区分 selector、timeout、navigation、network、assertion、runtime 和 unknown，并映射为 `recoveryStrategy`：selector 建议替换 selector，timeout/network 建议等待就绪，navigation 建议重规划导航，assertion 建议停止并报告，runtime 建议等待后重试，unknown 建议从当前状态重规划。分类和策略会写入重试事件、验证结果与 Planner 重规划上下文。
- `waitForReadiness` 策略已开始驱动恢复路径：timeout/network 类失败在同计划重试前，如果失败上下文明确涉及 table/list/grid/data/chart 等数据加载语义，会优先等待页面数据就绪；其余情况等待页面网络空闲，而不是只使用固定 500ms 等待。
- `replanNavigation` 策略已开始驱动恢复路径：导航失败不会盲目重试同一个坏 URL，而是直接把失败分类、策略和当前页面观察交给 Planner 重规划。
- `replaceSelector` 策略已开始驱动恢复路径：明确 selector 找不到时不会重复点击同一个坏 selector，而是直接进入受控 selector fallback；没有可靠候选时再交给 Planner 重规划。
- `replanFromCurrentState` 策略已开始驱动恢复路径：浏览器明确报告未知或不确定状态时，不会重复执行可能已产生副作用的动作，而是携带当前页面观察直接交给 Planner 生成后续计划；仍在加载、渲染等可识别的瞬时执行异常保持动态等待重试。
- Verifier 已接入独立 OpenAI-compatible 模型路由，处理规则断言覆盖不了的复杂语义断言，并保留确定性断言优先级。
- Reporter 已接入独立 OpenAI-compatible 模型路由，可为失败/等待态运行生成证据摘要、失败归因和修复建议。
- Reporter Markdown 和 HTML 已持久化为运行 artifact；运行记录可通过受控 IPC 打开或导出应用管理目录内的本地报告，渲染进程不能借此访问任意本地路径。跨证据链导航仍待补齐。

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
4. 在已完成受控本地报告打开与导出的基础上，补齐跨证据链导航入口。
5. 在已完成严格像素视觉 diff 和每录制差异阈值的基础上，补充动态区域遮罩和图表动画稳定策略。

## 11. 风险与应对

### 风险 1：继续只做 UI，核心执行迟迟不通

应对：

- 每个新页面需求都必须说明它服务 Agent 闭环的哪个环节。
- 优先打通自然语言执行闭环。

### 风险 2：Agent、Workflow、Recording 三套执行逻辑分裂

应对：

- 用统一 Agent Runtime contract 收敛。
- Workflow 与 Recording 已使用统一 Agent Run；测试用例中的 recordingReplay 后续收敛到同一 RecordingRunner。

### 风险 3：Midscene 接入后调试困难

应对：

- 所有模型输入输出、计划、动作、观察和断言都结构化记录。
- 失败时保存截图和原始错误。

### 风险 4：图表和表格页面稳定性不足

应对：

- 优先实现表格文本/行列断言。
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
