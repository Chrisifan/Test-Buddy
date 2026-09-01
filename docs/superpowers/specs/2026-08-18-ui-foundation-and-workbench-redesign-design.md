# TestBuddy UI Foundation And Workbench Redesign

> 状态：已确认，基于 `docs/ui-ux-audit-2026-08-17.md` 的实施设计

## Goal

将 TestBuddy 从“多页功能集合”收敛为明暗主题一致的工程可观测工作台：保留 macOS 原生玻璃质感，以 `#0066ff` 作为统一品牌主色，用一致的 RunState、Surface 和页面家族规则承载资产、执行与证据。

## Design Summary

### 1. Shared visual foundation

建立一套语义 token，覆盖主题色、工作区、Surface、Native Glass Rail、文本、边界、焦点、状态、半径、密度、字体角色和动效。`src/index.css` 与 `src/styles/luminous-precision.css` 不再同时拥有相同契约；组件通过 token 使用视觉语言，页面只负责布局。

macOS 仍使用 Electron `under-window` vibrancy 提供模糊。renderer 负责在 `.app-rail` 上绘制主题化玻璃层：亮色使用浅色 tint，暗色使用深色 tint，并始终提供 edge、border、foreground 对比。Rail 不能依赖窗口背后的 OS 内容来决定可读性。

### 2. Shared state and typography

新增统一 `RunState` 视觉组件和语义映射，覆盖 `queued`、`running`、`passed`、`failed`、`blocked`、`skipped`、`cancelled`、`error`。映射包括图标、颜色、中文文案、动效和可访问名称。runtime bar、自然语言、工作流、套件、用例和运行记录均使用同一组件。

一般界面统一使用 Geist。只有运行 ID、命令、日志、时间戳和其他技术元数据使用等宽字体；不再由全局规则强制抹掉 `font-mono` 的语义。

### 3. Page families

- `Overview`：质量结论、少量指标、下一步动作、最近证据；不放长编辑器和长日志。
- `Inventory`：项目和资产列表，提供筛选、稳定选中态、上下文动作与详情入口。
- `Editor`：需求文档、用例、套件、工作流、录制；固定工具栏、主编辑区和必要 inspector，栏目内部滚动。
- `Execution`：运行记录、自然语言及运行中的工作流/套件/录制；结论优先，显性 RunState，Evidence Rail 可追溯。

每个页面继续复用已有 `PageShell`、`PageHeader`、`PageBody`、`Surface`；本轮不重写业务状态和运行协议，只收敛视觉层与布局契约。

### 4. Priority surfaces

1. App Shell、设置、空态、存储错误：解决 P0 主题断层和回归基线。
2. 总览：将均权指标改成质量信号、下一步与最近证据的层级结构；非状态图标收敛为主色/中性。
3. 运行记录：保留三列信息架构，但将“运行结论 -> 步骤/诊断 -> Evidence Rail”设为唯一阅读路径，减少同级 Surface 嵌套。
4. 录制回放：将 Target-page Mock 与 Product Surface 分层，修复暗色舞台和固定白/slate 色。
5. 其余页面：按 Inventory、Editor、Execution 家族补齐 header、滚动、空态、状态和窄窗规则。

### 5. Responsive and motion contract

在窄窗不直接隐藏规划器或 Evidence Rail。若空间不足，转换为 tabs、drawer 或可恢复的 rail 入口。动效只服务页面进入、运行状态、步骤推进、录制写入和保存反馈，并遵守 `prefers-reduced-motion`。

## Boundaries

- 不改变测试资产、运行、凭据、模型调用或 IPC 合同。
- 不把被测网站的视觉样式强行品牌化；Target-page Mock 允许独立 token，但必须有可读的舞台背景。
- Code Log 保持技术化视觉，不参与 Product Surface 品牌色判断。
- 不一次性重写所有页面的业务 JSX；先抽共享基础，再逐页迁移。

## Verification

- 单元/组件测试验证 token、RunState 映射、主题类名和关键空态。
- 生产构建验证两份样式加载后没有未定义变量或布局溢出。
- Electron 实机在 1440x960 与 1280x800 下验证亮色/暗色 App Shell、设置、总览、运行记录、录制回放、启动与错误状态。
- 验收截图必须确认 Logo、导航、按钮、Surface、文字和状态在两套主题中没有低对比、遮挡或唯一入口被隐藏。
