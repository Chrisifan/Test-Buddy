# TestBuddy 桌面端 UI 功能性审计

> 日期：2026-09-02
> 状态：已完成实机巡检，待确认修复取舍；未改动产品实现
> 审查对象：模型配置完成后的本地 Electron 工作台

## 结论

当前问题已经超出视觉微调的范围。两个主操作在可访问性树中存在、却在 `1200 x 760` 桌面窗口不可见：自然语言测试的命令输入器，以及设置靠近底部的配置与连接测试操作。这会直接阻断操作，应作为独立 P0 修复。

其余问题集中在三类：空数据被呈现为健康或就绪、空状态占据编辑工作台却没有下一步、同一工作台规则被 `src/index.css` 与 `src/styles/luminous-precision/` 两处共同覆盖。最后一类已造成高度与滚动回归，不能继续靠单页 CSS 补丁处理。

本文采用 [CONTEXT.md](../../CONTEXT.md) 中的术语：页面主体为 **Workbench**，右侧诊断列为 **Evidence Rail**，运行结果使用 **RunState**。此处的“空状态”是没有用户资产或运行样本的可操作状态，不等同于错误。

## 范围与方法

通过 Computer Use 在本地 Electron 的 `1200 x 760` 桌面窗口中，逐一访问了模型配置后可到达的所有一级目的地，并观察不产生资产、录制、执行、外部请求或配置写入的关键状态。

| 区域 | 已检查页面或状态 |
| --- | --- |
| 项目 | 项目总览、项目配置对话框 |
| 测试资产 | 总览、需求文档、用例、复用 Flows、Suites、工作流、录制回放 |
| 执行与证据 | 运行记录、自然语言测试的待机与已连接会话、维护复核 |
| 配置 | 通用、MidScene、Agent models、执行环境 |

每次交互后都刷新了可访问性树。因此“语义存在但屏幕不可见”被归类为功能性可见性缺陷。自然语言页曾短暂启动并结束浏览器会话以检查两种会话状态；没有创建或保存任何测试资产。

### 未覆盖项

- 没有输入真实目标网站地址，也没有运行用例、Suite、Workflow 或回放，避免对外部系统产生副作用。
- 当前项目为零文档、零用例、零录制、零运行样本；本轮完整覆盖零数据路径。长列表、失败证据、媒体截图和高密度数据仍需在后续视觉回归中补测。
- 本轮不是手机端评审；`1024 x 768` 仅被列为后续“不得静默丢失入口”的韧性检查。

## 发现清单

### P0：主操作或必要内容不可见

| ID | 发现与实机证据 | 影响 | 根因与代码证据 | 修复验收 |
| --- | --- | --- | --- | --- |
| P0-01 | **自然语言命令输入器不可见。** AX 树能发现 textarea、发送、`保存为步骤` 和会话动作；待机与在线状态下，滚动页面仍没有把它带入视口。 | 用户无法输入自然语言命令，首要价值不可用。 | [NaturalLanguagePage.tsx](../../src/features/natural-language/NaturalLanguagePage.tsx:134) 将 composer 放在聊天区之后；[index.css](../../src/index.css:2452) 为 `.nl-studio` 强设最小高度，通用 `.designer-split` 又保留 760px 最小高度（[index.css](../../src/index.css:506)）。最终样式同时设置 `height: 100%`（[workbench-views.css](../../src/styles/luminous-precision/workbench-views.css:440)），高度契约冲突。 | 在 `1200 x 760` 的待机与在线两态下，textarea、发送和保存步骤操作无需页面级滚动即可同时完整可见；仅聊天历史区域滚动。 |
| P0-02 | **设置底部内容被 footer 遮挡。** MidScene 的项目上下文和“测试连接”在 AX 树可见但不在可见工作区；Agent models 最后一行也被底部截断。 | 用户无法确认或使用配置动作，会误判设置不可用。 | 中间区位于 [SettingsModal.tsx](../../src/features/settings/SettingsModal.tsx:477)，模态固定为最大 640px（[SettingsModal.tsx](../../src/features/settings/SettingsModal.tsx:952)）；旧全局样式和最终设置层分别定义 scroll/footer（[index.css](../../src/index.css:2237)、[settings-responsive.css](../../src/styles/luminous-precision/settings-responsive.css:62)）。 | 四个设置分栏都能滚到最后一个控件，最后一行与 footer 保持至少 16px 间距；footer 完整且不覆盖表单。 |

### P1：状态不真实、层级错误或工作流被误导

| ID | 发现与实机证据 | 影响 | 根因与代码证据 | 修复方向 |
| --- | --- | --- | --- | --- |
| P1-01 | **零样本运行记录被染成“通过”。** 同页同时出现绿色通过结论和“等待样本”，信息相互矛盾。 | 产生虚假的质量结论。 | `getHealthLabel(0, ...)` 正确返回等待样本（[RunRecordsPage.tsx](../../src/features/runs/RunRecordsPage.tsx:114)），但统计 Surface 在零失败、零运行时仍选 `passed` tone（[RunRecordsPage.tsx](../../src/features/runs/RunRecordsPage.tsx:771)）。 | 样本数为 0 时不出现 passed 颜色、文案或百分比；明确表达 `unavailable` / `waiting`。 |
| P1-02 | **录制页在会话 `idle` 时宣称“受控浏览器已就绪”。** 同时显示“录制目标交互 #1/#2/#3”，看似真实证据。 | 用户无法区分真实浏览器、模拟预览与录制状态。 | 页面显示实际浏览器状态（[RecordingPage.tsx](../../src/features/recording/RecordingPage.tsx:163)），却在无截图时无条件渲染 mock（[RecordingPage.tsx](../../src/features/recording/RecordingPage.tsx:218)）；译文无条件使用“已就绪”（[zh-CN.ts](../../src/i18n/locales/zh-CN.ts:614)）。 | idle 状态仅显示未连接操作提示；示例若保留，必须标为“示例预览”，不能有伪步骤或“已就绪”。 |
| P1-03 | **总览为零资产显示“覆盖指数 12”。** 当前项目为 0 文档、0 用例、0 录制，仍显示非零指数。 | 将无数据伪装成健康度。 | [HomePage.tsx](../../src/features/home/HomePage.tsx:64) 对得分使用 `Math.max(12, ...)`。 | 无可计算资产和运行样本时显示“尚无数据”与首个任务入口；产生真实数据后才计算指数。 |
| P1-04 | **项目配置是失衡的巨型对话框。** 基本信息后出现大块空白；右侧环境、分组、凭据和存储状态密集堆叠，阅读顺序混乱。用户提供的项目配置截图也复现此现象。 | 配置难发现，输入任务混在一起。 | 单个 [ProjectConfigurationDialog](../../src/features/project/ProjectManagementPage.tsx:322) 承载五类任务；`.project-config-columns` 固定为不对称两列（[index.css](../../src/index.css:1059)）。 | 以“项目详情 / 环境 / 凭据与存储 / 分组”分栏或顺序 section；初始视图只展示当前任务必需内容。 |
| P1-05 | **固定 runtime bar 与工作台最小高度挤占首屏。** 总览、文档、Workflow 等页把首要操作和空状态推离视口。 | 短桌面需要额外滚动，且与 P0-01 共享根因。 | App Shell 为固定 `64px / content / 40px` 三行（[App.tsx](../../src/App.tsx:3001)）；多个 Workbench 有 `min-height: min(720px/760px, ...)`（例如 [index.css](../../src/index.css:506)）。 | 只有一个内容滚动容器；Workbench 依据实际可用高度，不能以常量撑开 Shell。 |
| P1-06 | **空状态占据完整编辑工作台但没有闭环。** 文档页留下空资产列和空中心区，上传动作远在顶栏；Flows、Suites、Cases、Workflow、Maintenance 多为大边框短句或重复 CTA。 | 首次用户不知道创建什么、从哪里开始，视觉噪音很大。 | 文档空资产和空工作区独立渲染（[DocumentAnalysisPage.tsx](../../src/features/documents/DocumentAnalysisPage.tsx:258)）；维护空态只有一行文字（[MaintenanceQueuePage.tsx](../../src/features/maintenance/MaintenanceQueuePage.tsx:182)）。 | 零资产时用紧凑的单一主操作初始状态；只有选中资产后进入多栏 Workbench。 |
| P1-07 | **Workflow 空编辑体验被重复操作和不满足前置条件占满。** 主编辑区很大却只有淡提示；右 rail 有重复的新建入口；运行配置允许空 Base URL。 | 最短路径不清晰，可能配置无法运行的 Flow。 | 无流程时仍保留完整工作台（[WorkflowPage.tsx](../../src/features/workflow/WorkflowPage.tsx:340)）；运行配置总是渲染并可编辑 Base URL（[WorkflowPage.tsx](../../src/features/workflow/WorkflowPage.tsx:344)）。 | 无 Flow 时只呈现一个创建入口；运行前置条件在按钮附近解释，并优先继承项目环境 URL。 |
| P1-08 | **不可用的运行按钮仍像主操作。** Suites、Workflow 与部分 Case 操作在 disabled 时仅降低透明度，原因只藏在 title 或不存在。 | 用户会重复尝试，无法判断缺少资产、URL 还是正在执行。 | 基础 Button 的 disabled 仅为 `opacity-50`（[button.tsx](../../src/components/ui/button.tsx:8)）；Suite 运行仅由 `canRun` 禁用（[SuiteManagementPage.tsx](../../src/features/suites/SuiteManagementPage.tsx:378)）。 | disabled 主操作采用中性语义，并在邻近位置显示具体前置条件与修复入口。 |

### P2：一致性、密度与可维护性

| ID | 发现 | 影响 | 证据与修复方向 |
| --- | --- | --- | --- |
| P2-01 | Overview 将运行、环境、浏览器、runtime 做成近似可点选的分段控件；指标、信息块和嵌套边框同权。 | 扫读效率低，状态与输入控件难区分。 | 多类 Surface 同时带浅边框和背景（[workspace.css](../../src/styles/luminous-precision/workspace.css:118)）。保留少量质量结论和下一步，其余改为无边框 metadata 或 Evidence Rail。 |
| P2-02 | 淡蓝提示块、浅边框、muted label 被同时用作信息、空态、选中和输入背景。 | 视觉角色混淆，低对比文字增加可读性风险。 | `tech-panel`、`metric-tile`、`designer-info-block` 被同一规则框选（[workspace.css](../../src/styles/luminous-precision/workspace.css:118)）。建立更少、更明确的 Surface 角色并测亮暗对比。 |
| P2-03 | 左 rail 有 11 个目的地，固定 runtime bar 每页占高度；小号导航与 metadata 密集而低对比。 | 高频页面可用高度被非上下文信息消耗。 | App Shell 结构见 [App.tsx](../../src/App.tsx:2931)。runtime bar 应只在相关状态显示或可收起，并验证导航/metadata 的对比与键盘焦点。 |
| P2-04 | 样式权威来源不唯一。`main.tsx` 同时导入 [index.css](../../src/main.tsx:6) 与 [luminous-precision.css](../../src/main.tsx:7)，两者都定义 Workbench、Settings 与项目对话框规则。 | 修一页容易改坏另一页，是 P0 高度问题的共同诱因。 | 保留 tokens、reusable primitive、page-family 三层明确职责；删除或迁移旧覆盖，不依赖导入顺序。 |
| P2-05 | 技术排版不稳定：普通 label、tabs、说明与 runtime metadata 都混用超小全大写或等宽字。 | 中文和长术语可读性、国际化适配变差。 | Natural Language tabs 使用 11px uppercase（[NaturalLanguagePage.tsx](../../src/features/natural-language/NaturalLanguagePage.tsx:145)），后写 CSS 再重设（[index.css](../../src/index.css:2477)）。按文本角色统一 token。 |

## 根因归类

| 根因 | 关联问题 | 处理原则 |
| --- | --- | --- |
| 高度与滚动契约冲突 | P0-01、P0-02、P1-05 | App Shell、Modal、Workbench 各自只拥有一个滚动区；使用 `minmax(0, 1fr)` 与 `min-height: 0` 传递可用高度。 |
| RunState 与数据可用性混淆 | P1-01、P1-02、P1-03、P1-08 | `waiting` / `unavailable` 不是 passed 的一种；真实运行、示例预览与未连接状态须分开表达。 |
| 缺少空状态契约 | P1-06、P1-07 | Inventory 与 Editor 在零资产时进入初始状态；有选择后才使用多栏 Workbench。 |
| Surface 角色与样式所有权漂移 | P1-04、P2-01 至 P2-05 | 先收敛 CSS 来源与 primitive，再调整高频页面，不增加新的全局覆盖。 |

## 后续验收矩阵

亮、暗主题各执行一次，且通过 Computer Use 或自动截图实际观察，不只检查 DOM。

| 视口 | 必测场景 |
| --- | --- |
| `1200 x 760` | 两项 P0、项目配置、零样本运行记录、录制 idle、Workflow 空状态、文档空状态 |
| `1280 x 800` | 全部一级页面首屏、长设置分栏、三栏编辑器 |
| `1440 x 900` | 数据丰富时的 Editor / Execution 密度与 Evidence Rail |
| `1024 x 768` | 不能丢弃唯一证据或操作入口；可用 tabs/drawer，但禁止静默 `display: none` |

## 本轮不做的事情

- 不将示例预览替换成“假成功”或假运行样本。
- 不通过减少可访问性标签隐藏视觉问题。
- 不修改模型密钥保存链路、项目资产、运行数据或桌面运行时权限。
- 不以更多卡片、渐变或装饰色作为修复手段。

可执行的修复顺序见 [2026-09-02-desktop-ui-repair.md](../superpowers/plans/2026-09-02-desktop-ui-repair.md)。
