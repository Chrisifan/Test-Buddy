# 样式系统与 shadcn/ui 规范

## 1. 当前技术选择

当前 UI 已经切换到：

- `Tailwind CSS v4`
- `@tailwindcss/vite`
- `shadcn/ui`
- `Radix UI`

实现目标：

- 用原子类快速落地页面布局
- 用 `shadcn/ui` 统一按钮、卡片、弹窗、输入组件的交互基线
- 减少大块手写 CSS 的维护成本
- 让页面结构和样式关系更直接

## 2. 视觉方向

当前视觉方向是：

- 工程可观测工作台，而不是营销官网或通用 SaaS 面板
- 中性、高密度的桌面工作区，以 `#0066ff` 建立品牌和关键操作锚点
- 保留 macOS Native Glass Rail，并在亮暗主题中保持可控的材质与对比
- 减少颜色噪音，让结构、执行状态、证据和下一步更容易扫描

全应用改造基线见 [UI/UX 审查（2026-08-17）](./ui-ux-audit-2026-08-17.md)。

## 3. 设计原则

- 总览展示质量信号和下一步；编辑、运行页承载密度而不堆叠容器
- 颜色少、层级清；除 RunState 外的图标与指标使用主色或中性色
- CTA 使用 `#0066ff` 的强对比，而非黑色品牌替代
- 使用 4px 控件、6px 内部面板、8px 主 Surface/弹窗；避免大圆角和同级 Surface 嵌套
- 动效服务运行和保存状态，不做循环装饰

## 4. 色彩策略

### 主色

- `#0066ff`

用于：

- 主按钮
- 激活态
- 焦点、进度和关键链接

深色日志区属于 Code Log，不是品牌主色使用场景。

### 背景与材质

- 亮色工作区、暗色工作区和 Surface 必须使用语义 token，不使用固定 `stone`/`slate` 工具色作为产品主题
- Native Glass Rail 由 Electron vibrancy 提供模糊，并由主题 token 提供 tint、border、highlight、shade 和 foreground
- Target-page Mock 与 Code Log 可以使用专用 token，但不能污染 Product Surface

### 文本

- 主文本、次文本和辅助文本必须分别使用语义 token，并在亮暗主题中通过对比检查
- 技术元数据可以使用等宽字体；一般正文、标签和操作使用 Geist

## 5. 组件样式策略

整体原则：

- 优先使用 `shadcn/ui` 原子组件组合页面
- 允许在 `className` 上做局部布局二次定制，但不得重新定义全局主题/材质契约
- 避免回退到“每页一套自定义组件皮肤”

### 5.1 App Shell

- 使用 Native Glass Rail、顶栏、工作区和 runtime bar 的固定桌面框架
- Rail 需要主题控制的玻璃覆层、边界与文字对比；不使用不受主题控制的纯透明背景
- 左侧为 Logo 和一级导航，设置位于 Rail 底部；顶栏保留资源搜索和上下文操作

### 5.2 Surface

- 使用 panel、subtle、active、evidence、stat、plain 等明确语义角色
- Surface 不嵌套视觉同级的 Surface；边界应对应真实信息层级
- hover 只提供可感知的状态反馈，不能移动布局或制造装饰噪音

### 5.3 Primary Button

- `#0066ff` 底、白字和对应图标
- hover 时只做轻微透明度变化

### 5.4 Secondary Button

- 中性背景或描边，使用语义 border 与 foreground
- hover 时使用克制的 surface/brand soft 状态

### 5.5 Inputs

- 主题 Surface 背景
- 4px 圆角和语义边框
- focus 使用 `#0066ff` ring

### 5.6 Status Pill

- 使用 RunState 词汇和统一的颜色、图标、动效与可访问文案
- 彩色只用于实际运行状态、风险或危险操作，不能作为资产类别装饰

## 6. Tailwind 使用约束

### 推荐做法

- 优先在 JSX 内用 Tailwind 原子类描述布局
- 对重复 UI 模式通过小组件复用，而不是回退到大段全局 CSS
- 只把真正属于全局基线的规则留在 `src/index.css`

### 避免做法

- 不要重新回到 `app.css / base.css / tokens.css` 这种大块页面样式堆积
- 不要为了一个页面临时写大量自定义类名
- 不要引入大面积渐变和高饱和配色

## 7. 全局样式边界

单一全局 token source 负责：

- `@import "tailwindcss"`
- 主题 token、body 背景与字体角色
- input / textarea / select 基础样式
- focus 可访问性基线
- scrollbar 基础规则

页面布局、栅格与局部间距尽量直接在组件中用 Tailwind 实现。不得通过第二份 final-cascade 全局样式覆盖同一 token 或组件契约。

## 8. 后续演进建议

当页面数量继续增加时，建议优先基于 `shadcn/ui` 继续抽出基础组件：

- `AppShell`
- `Surface`
- `SectionTitle`
- `PrimaryButton`
- `SecondaryButton`
- `RunState`
- `SettingsModal`

这样既能保持 Tailwind 的开发效率，也能避免 JSX 类名越来越长。
## 9. 字体

一般界面使用 Geist。运行 ID、命令、日志、时间戳及其他技术元数据可以使用等宽字体；不得把等宽字体用于普通正文、标签或按钮。
