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

- 黑白极简
- 客户端感而不是营销官网感
- 强调结构清晰和留白
- 减少颜色噪音，让交互重点更明确

## 3. 设计原则

- 首页轻，功能页重
- 颜色少，层级清
- CTA 强对比
- 卡片统一圆角、边框、轻阴影
- 不做复杂装饰性动效

## 4. 色彩策略

### 主色

- `#111111`

用于：

- 主按钮
- 激活态
- 深色日志区

### 背景

- `stone-100` 级浅灰背景
- `white` 作为主卡片背景
- `stone-50` 作为弱层级面板背景

### 文本

- 主文本：黑色
- 次文本：`black/55` 到 `black/65`
- 辅助标签：`black/40` 到 `black/45`

## 5. 组件样式策略

整体原则：

- 优先使用 `shadcn/ui` 原子组件组合页面
- 允许在 `className` 上做黑白极简方向的二次定制
- 避免回退到“每页一套自定义组件皮肤”

### 5.1 Navbar

- 白底
- 细边框
- 大圆角
- 轻阴影
- 左侧 logo，右侧 icon-only 设置按钮
- 下方用 pill navigation 切换页面

### 5.2 Page Card

- 统一大圆角
- 白底 + 边框
- hover 轻微上浮

### 5.3 Primary Button

- 黑底白字
- hover 时只做轻微透明度变化

### 5.4 Secondary Button

- 白底
- 细边框
- hover 时浅灰背景

### 5.5 Inputs

- 白底
- 统一圆角
- 细边框
- focus 用浅黑色 outline

### 5.6 Status Pill

- 当前仍可统一用黑白高对比风格
- 尽量不用过多彩色标签

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

`src/index.css` 只负责：

- `@import "tailwindcss"`
- body 背景
- 字体族
- input / textarea / select 基础样式
- focus 可访问性基线
- scrollbar 基础规则

页面布局、卡片、按钮、栅格、间距尽量直接在组件中用 Tailwind 实现。

## 8. 后续演进建议

当页面数量继续增加时，建议优先基于 `shadcn/ui` 继续抽出基础组件：

- `AppShell`
- `PageCard`
- `SectionTitle`
- `PrimaryButton`
- `SecondaryButton`
- `StatusPill`
- `SettingsModal`

这样既能保持 Tailwind 的开发效率，也能避免 JSX 类名越来越长。
## 7. 字体

全应用使用 `--font-sans` 作为唯一字体族。标签、状态、技术元数据和标题保持各自的字号、字重与字距层级，但不再切换等宽或衬线字体。
