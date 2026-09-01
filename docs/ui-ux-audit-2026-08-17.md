# TestBuddy 全应用 UI/UX 审查与改造基线

> 日期：2026-08-17
> 状态：已确认，作为后续 UI 改造的验收基线
> 产品定位：以 AI 命令层辅助的工程可观测工作台

## 结论

TestBuddy 已具备“桌面测试工作台”的信息架构：项目、测试资产、执行、证据与配置均有明确落点；它距离“现代化、科技化”的主要差距不在于缺少发光、渐变或更多卡片，而在于全局材质、状态语言、页面密度和主题系统没有形成一个可复用的契约。

本次确认的设计决策：

- 品牌主色在亮色与暗色主题中统一为 `#0066ff`，包括 Logo、主操作、选中、焦点、进度及关键链接。
- 产品主线是工程可观测工作台；自然语言与 MidScene 是贯穿资产、运行和证据的 AI 命令层，不单独主导整套信息架构。
- macOS 保留 Native Glass Rail；暗色主题必须由 CSS 主题 token 提供深色玻璃覆层、边界与文字对比，不能只依赖系统振动材质。
- 非状态性图标和指标收敛到主色/中性色。绿色、红色、琥珀色等只表达 RunState 或风险语义。
- 先建设共享基础，再优先调整总览、运行记录、录制回放，最后覆盖其余页面。
- Geist 用于一般界面；等宽字体只用于运行 ID、命令、日志、时间戳与其他技术元数据。

术语以根目录 [CONTEXT.md](../CONTEXT.md) 为准；两项长期设计决策见 [ADR-0001](./adr/0001-native-glass-rail-theme-contract.md) 与 [ADR-0002](./adr/0002-single-semantic-visual-token-source.md)。

## 审查范围与方法

- 真实 Electron 桌面端在亮色和暗色主题中检查工作台与设置；不执行会调用用户模型、浏览器目标或外部网络的操作。
- 审核完整页面树：总览、项目、需求文档、用例、套件、运行记录、自然语言测试、工作流、录制回放、首次启动、设置，以及存储错误分支。
- 结合共享组件、全局主题 token、Electron window 配置和页面布局源码检查主题、材质、层级、状态与窄窗行为。

真实桌面端复现到的关键事实：暗色工作区本身正确变暗，但 Native Glass Rail 呈现浅灰材质，Logo 与导航对比偏弱。根因不是浏览器预览误差：窗口使用透明背景和 `under-window` vibrancy，而 renderer 的 rail 在最终样式层中透明，未使用已定义的暗色侧栏 token。

## 全应用覆盖矩阵

| 区域 | 页面家族 | 当前形态 | 审查结论 | 后续重点 |
| --- | --- | --- | --- | --- |
| 首次启动 | Onboarding | 左侧能力视觉，右侧 MidScene 配置 | 旧深蓝、青绿装饰色与新品牌色并存 | 用 `#0066ff` 与语义 token 重做能力视觉；保持独立于 App Shell |
| App Shell | Shared | 224px Rail、顶栏、主工作区、runtime bar | P0：暗色 Native Glass Rail 失控；顶栏动作固定且语境不足 | 执行 ADR-0001；定义共享 RunState 入口 |
| 总览 | Overview | 6 项指标、3 个入口、基线、最近结果 | P1：均权卡片过多，类别色抢占品牌注意力 | 以质量信号、下一步动作、最近证据形成主次层级 |
| 项目 | Inventory | 指标、项目库存、配置弹窗 | P1：与其他资产库存页没有统一 family 契约 | 统一库存页筛选、行密度、选中态与详情动作 |
| 需求文档 | Editor | 文档库、源文档、生成路径三段布局 | P1：布局已有明确工作台形态，但需纳入 Editor family | 明确来源、覆盖、可写入路径与证据层级 |
| 用例 | Editor | 流程画布与固定 inspector rail | P1：结构正确，控件、状态和证据样式仍依赖局部规则 | 统一工具栏、步骤状态与 inspector 的 Surface 角色 |
| 套件 | Editor / Execution | 库存、编辑器、预检三列 | P1：与用例、工作流的多栏规则存在漂移 | 复用 Editor family，预检使用统一 RunState |
| 运行记录 | Execution | Run list、详情、Evidence Rail 三列 | P1：面板过密、同层嵌套多，注意力被容器分散 | 将结论、步骤、证据做成明确三层；保留 Evidence Rail |
| 自然语言测试 | Execution | 命令会话、浏览器舞台、规划器三列 | P1：运行状态与 runtime bar、工作流不一致 | 让 AI plan/execute/verify 映射到统一 RunState 与证据位置 |
| 工作流 | Editor / Execution | 时间线编辑、库和运行侧栏 | P1：状态组件与其他运行页分散 | 接入统一 RunState、Editor family 和操作密度规则 |
| 录制回放 | Editor / Execution | 浏览器画布、资产/时间线侧栏 | P1：浏览器 mock 使用硬编码白色/slate，暗色不一致 | 将 mock 与 Product Surface 分层；优先改造真实录制舞台 |
| 设置 | Configuration | 外观、MidScene、模型、runtime/network 弹窗 | P2：可达但有两组后写 CSS 规则 | 合并样式权威来源并验证亮暗高对比 |
| 存储错误 | Recovery | 独立全屏错误状态 | P2：应被纳入双主题与可恢复路径验收 | 使用标准 Surface、行动与 RunState 错误语义 |

## 问题清单

### P0：主题和系统级问题

| 编号 | 问题 | 证据 | 要求 |
| --- | --- | --- | --- |
| P0-1 | 暗色 Native Glass Rail 不受主题 token 控制，导致工作区深色而侧栏浅灰的断层 | [electron/window-options.ts](../electron/window-options.ts)、[luminous-precision.css](../src/styles/luminous-precision.css) 中透明 shell/rail 与 `.dark` 的未消费 `--sidebar-background` | 按 ADR-0001 增加明确玻璃覆层、亮边/暗边和文字对比；实机验收亮暗两主题 |
| P0-2 | 两份全局样式都定义同名 token 和组件覆盖，且后加载的 final cascade 可覆盖先前深色规则 | [main.tsx](../src/main.tsx)、[index.css](../src/index.css)、[luminous-precision.css](../src/styles/luminous-precision.css) | 按 ADR-0002 建立单一语义 token source；组件仅消费 token，不再依赖覆盖顺序 |

### P1：工作台体验问题

| 编号 | 问题 | 影响范围 | 改造要求 |
| --- | --- | --- | --- |
| P1-1 | 总览把 6 个指标和 3 个入口做成几乎等权的 Surface；类别色被当成装饰色 | 总览 | 只突出质量结论、待处理风险和下一步；非语义图标收敛为 `#0066ff`/中性 |
| P1-2 | 页面虽共用 PageShell/Surface，但 Overview、Inventory、Editor、Execution 没有正式布局契约，导致栏目、密度和 Surface 深度漂移 | 全部功能页 | 为四类页面规定 header、筛选/操作区、rail、滚动区、空态和窄窗替代入口 |
| P1-3 | queued/running/passed/failed/blocked 等运行状态在 runtime bar、自然语言页、工作流和运行记录中分别表达 | App Shell、运行记录、自然语言、工作流、套件、用例 | 建立一个 RunState 组件与 token 映射：统一图标、颜色、文案、动效、证据入口 |
| P1-4 | 运行记录同时包含列表、详情、比较、日志、产物、归因等多层 Surface，容器边界多于信息层级 | 运行记录 | 固定“运行结论 -> 步骤/诊断 -> 证据”的层级；内层避免重复 panel 外框 |
| P1-5 | 录制浏览器 mock 将 TestBuddy Product Surface 与被测页视觉混在一起，硬编码白、slate、浏览器点色 | 录制回放 | 明确 Product Surface、Target-page Mock、Code Log 边界；mock 自身要有 dark-safe 舞台容器 |

### P2：一致性和韧性问题

| 编号 | 问题 | 影响范围 | 改造要求 |
| --- | --- | --- | --- |
| P2-1 | 在 <=1120px 宽度直接隐藏自然语言规划器、运行记录 Evidence Rail 等高价值内容 | 多栏页面 | 不直接丢失内容；提供 tabs、drawer 或可回收 rail 入口，即使 Electron 当前最小宽度为 1200px |
| P2-2 | 启动引导仍有 `#063b9a` 等旧品牌蓝；深色中的浏览器 mock 和部分日志使用固定色 | 启动、录制、运行记录 | 用品牌/语义 token 替换 Product Surface 的硬编码色；保留 Target-page Mock 与 Code Log 必需的专用 token |
| P2-3 | 技术排版意图冲突：局部使用 `font-mono`/uppercase，而全局样式把字体和 letter-spacing 全部归零 | 全应用 | 等宽字体限于技术元数据；移除全局破坏性的字体/字距覆盖，改由角色 token 控制 |
| P2-4 | 动效主要是统一页面进入，运行中的真实反馈较少 | 全应用 | 动效只服务状态：状态切换、步骤推进、录制写入、保存完成；支持减少动态效果 |
| P2-5 | 设置弹窗、空态和错误分支虽已有组件基础，但缺少亮暗主题下的完整视觉回归覆盖 | 设置、恢复状态 | 加入实机主题截图与关键状态检查，避免主题改动只验证主路径 |

## 源码定位

| 主题 | 位置 | 审查依据 |
| --- | --- | --- |
| 原生玻璃 | `electron/window-options.ts:21-29` | macOS 主窗口同时使用透明背景与 `under-window` vibrancy。 |
| Rail 断层 | `src/styles/luminous-precision.css:180-185, 196-201, 255-295` | 暗色玻璃 token 存在，但 shell/rail 最终为透明背景，只保留 blur。 |
| token 权威来源 | `src/main.tsx:6-7` | `index.css` 与 `luminous-precision.css` 按顺序共同加载。 |
| 总览均权与装饰色 | `src/features/home/HomePage.tsx:99-120, 355-395` | 6 个指标和多种红/蓝/琥珀/翠绿色图标以同级 Surface 展示。 |
| 运行记录密度 | `src/features/runs/RunRecordsPage.tsx:600-710` | 三列工作台内仍叠加质量、指标、覆盖和明细 Surface。 |
| 录制/日志边界 | `src/features/recording/RecordingPage.tsx:190-258`; `src/features/runs/RunRecordsPage.tsx:1600-1608` | 录制 mock 与日志存在固定白/slate/gray 表现，需要与 Product Surface 分离。 |
| 运行状态漂移 | `src/features/natural-language/NaturalLanguagePage.tsx:134-142`; `src/features/workflow/WorkflowPage.tsx:344-375` | 自然语言页自定义 emerald pill，工作流使用 `StatusPill`。 |
| 窄窗信息丢失 | `src/styles/luminous-precision.css:3604-3619` | 规划器与 Evidence Rail 在 1120px 以下直接隐藏。 |
| 字体意图冲突 | `src/styles/luminous-precision.css:203-220`; `src/components/workbench.tsx` | 全局将 `font-mono` 映射为 Geist 并清空所有字距，但组件仍声明技术元数据样式。 |
| 旧品牌岛 | `src/styles/luminous-precision.css:2493-2764` | 启动引导使用 `#063b9a` 及青绿装饰色。 |

## 目标设计系统

### 色彩与材质

| 角色 | 规则 |
| --- | --- |
| Brand Primary | `#0066ff`；用于主操作、选中、焦点、进度、关键链接和 Logo 主色 |
| Neutral | 负责工作区、Surface、分割、文本层级；不把蓝色铺满背景 |
| Semantic State | 成功、失败、运行中、阻塞、取消、跳过只表达 RunState 或风险，不能作为任意资产类别的装饰 |
| Native Glass Rail | OS 提供模糊；CSS token 提供主题一致的 tint、highlight、shade、border 和 foreground |
| Product Surface | 必须完全从语义 token 取色，并通过亮暗主题对比检查 |
| Target-page Mock / Code Log | 可以有专用风格，但由明确 token 管理，不能反向污染 Product Surface |

### 页面家族契约

| 家族 | 适用页面 | 必须具备的结构 |
| --- | --- | --- |
| Overview | 总览 | 质量结论、少量可扫读指标、下一步操作、最近证据；不堆叠编辑器或长日志 |
| Inventory | 项目及资产列表 | 可筛选的列表/网格、稳定选中态、上下文动作、清晰详情入口 |
| Editor | 需求文档、用例、套件、工作流、录制 | 稳定工具栏、主编辑区、必要的 inspector/rail；只让具体栏目内部滚动 |
| Execution | 运行记录、自然语言、运行中的工作流/套件/录制 | 显性的 RunState、可定位的进度、结论优先、可追溯的 Evidence Rail |

### RunState

`queued`、`running`、`passed`、`failed`、`blocked`、`skipped`、`cancelled` 和 `error` 是跨页面的唯一执行状态词汇。每种状态必须定义：语义色、图标、中文文案、静态/动态反馈、可访问文本和应跳转的证据位置。失败不能只显示红色，必须同时给出可读原因和下一步。

## 分阶段改造计划

| 阶段 | 目标 | 交付物 | 完成门槛 |
| --- | --- | --- | --- |
| 0. 基线 | 锁定现状并防止回退 | 全页面/关键状态的亮暗实机截图清单、token 使用清单、视觉回归用例 | 能复现当前 P0 断层并记录修复后对比 |
| 1. 共享基础 | 消除主题与状态漂移 | 单一 token source、Native Glass Rail、RunState、字体角色、Surface 层级 | 亮暗主题 App Shell、设置、空态、存储错误均通过验收 |
| 2. 高频工作流 | 让“科技工作台”首先出现在关键操作中 | 重构总览、运行记录、录制回放 | 总览 1 屏可判断质量与下一步；运行记录结论/证据可快速扫读；录制舞台双主题一致 |
| 3. 全量覆盖 | 将家族契约应用到每一页 | 项目、文档、用例、套件、自然语言、工作流、启动引导 | 覆盖矩阵全部关闭，无页面专属主题补丁 |
| 4. 回归与微调 | 验证真实桌面体验 | 1440x960 与 1280x800 的亮暗截图、键盘焦点和 reduced-motion 检查 | 没有内容遮挡、未对比文本或隐藏的唯一证据入口 |

## 验收清单

### 双主题与品牌

- [ ] 真实 macOS Electron 中，亮色 Rail 保持轻玻璃材质，暗色 Rail 是可读的深色玻璃材质；二者均能识别 Logo、导航和当前项。
- [ ] `#0066ff` 是主操作、选中、焦点、进度和 Logo 的唯一品牌主色；不存在历史 `#0050CB` 或 `#063b9a` 的 Product Surface 用法。
- [ ] 主题切换覆盖 App Shell、启动、设置、空态、错误、编辑、运行和浏览器舞台。
- [ ] 不依靠同一色相的深浅堆叠建立整页层级；工作区、中性 Surface、品牌色和状态色保持各自职责。

### 信息与交互

- [ ] 所有页面归属一个页面家族，并满足该家族的 header、操作、滚动、rail 和空态契约。
- [ ] 任一 RunState 在所有出现位置有同一图标、名称、语义色和证据入口。
- [ ] Surface 不嵌套视觉同级的 Surface；容器数量不大于实际信息层级。
- [ ] 窄窗不隐藏唯一的规划、证据或操作入口。
- [ ] 图标按钮有可访问名称和 tooltip；文字、按钮和标签不会截断或相互遮挡。

### 动效与排版

- [ ] 运行中的状态反馈可见但克制；非执行 Surface 不使用循环装饰动效。
- [ ] 支持 `prefers-reduced-motion`。
- [ ] 技术元数据才使用等宽字体；正文、标签和普通操作统一 Geist。

## 关键实现入口

- [App Shell 与页面挂载](../src/App.tsx)
- [共享 Workbench primitives](../src/components/workbench.tsx)
- [Electron 透明窗口与 vibrancy](../electron/window-options.ts)
- [当前基础样式](../src/index.css)
- [当前最终样式覆盖层](../src/styles/luminous-precision.css)
- [现有 UI 设计规格](./ui-design.md)
- [工作台设计交接稿](./ui-designer-workbench-spec.md)

本审查只定义视觉与交互改造的优先级、词汇和验收条件。不会改变现有运行、资产、凭据或模型调用的产品安全边界。
