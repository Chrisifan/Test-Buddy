# PlayTest Pro 自动化测试 Agent 设计文档

这套文档用于规划一个基于 `Electron + React + Tailwind CSS + Playwright + MidScene` 的本地自动化测试 Agent。

最终目标不是做一个脚本编辑器或普通测试管理系统，而是做一个能理解测试目标、操作浏览器、观察页面、判断结果并沉淀测试资产的 Agent 工作台。

核心输入方式：

- 自然语言测试目标
- 用户操作录制路径
- PRD/PDF 需求文档

核心输出：

- 测试计划
- 测试用例
- 录制回放资产
- 执行记录
- 截图、trace、日志和失败归因报告

## 文档导航

- [自动化测试 Agent 目标设计](./automated-testing-agent-design.md)
- [自动化测试 Agent 进度与目标状态](./agent-progress-and-target.md)
- [产品需求与范围](./product-requirements.md)
- [系统架构设计](./system-architecture.md)
- [工作流与数据模型设计](./workflow-data-model.md)
- [UI 设计](./ui-design.md)
- [样式系统与 Tailwind 规范](./style-system.md)
- [实施路线图](./implementation-roadmap.md)

## 建议阅读顺序

1. 先读“自动化测试 Agent 目标设计”，明确最终产品形态和 Agent 闭环。
2. 再读“自动化测试 Agent 进度与目标状态”，确认当前已经实现到哪里。
3. 再读“产品需求与范围”，理解当前阶段的产品边界。
4. 接着读“系统架构设计”，确认 Renderer、Main Process、Agent Runtime 的职责边界。
5. 再读“工作流与数据模型设计”，确认本地状态、测试资产、运行记录和配置模型。
6. 最后结合“实施路线图”推进后续实现。

## 当前产品假设

- 应用形态是本地桌面客户端，不是网页控制台。
- 一期核心是个人使用与本地 Agent 闭环，不优先做多人协作和云端同步。
- 自动化目标以 Web UI 为主，浏览器控制采用 Playwright。
- Midscene 负责自然语言理解、页面语义动作和视觉/定位增强能力。
- 配置、测试资产、运行记录和产物都优先保存在本地。

## 当前实现对齐点

- 已经有启动屏、工作台壳层、项目/分组/用例/录制/PRD/运行记录页面。
- 已经有 Midscene 配置、设置拦截和首次启动引导。
- 已经有 Electron 本地状态持久化、浏览器 runtime、录制事件和测试 runner 雏形。
- 已经有录制回放资产与用例绑定的基础能力。
- 下一步重点是把自然语言执行链路升级为真正的 Agent Runtime。
