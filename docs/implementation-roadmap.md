# 实施路线图

## 1. 当前阶段判断

TestBuddy 已经从 UI 原型进入“具备本地执行与结果治理基础，但长期回归资产契约尚未收敛”的阶段。

### 1.1 当前代码基线

已经具备：

- Electron/React 本地工作台、启动屏、设置和 Midscene/角色模型配置。
- 项目、分组、环境、用例、录制、PRD、运行记录和 artifact 基础。
- 自然语言 Agent 的 `Intent -> Plan -> Execute -> Observe -> Verify -> Report` 链路。
- BrowserRuntime、Workflow、Recording 和 TestRunner 基础。
- 明确 URL/selector 的确定性动作、条件等待、有限重试、定位 fallback 和 Planner 重规划。
- 已确认 V2 `navigate`、selector `click`、selector/超时 `wait` 和 selector `scroll` 已通过独立确定性链路执行：它们要求真实 Playwright 页面，绕过 Planner、Midscene、Verifier、Reporter、重试、selector fallback 和重规划；stub 会话、取消、未支持动作和失败步骤均保持 `neutral` 或 `failed`，不会伪造通过或继续派发后续步骤。
- `stopAndReport` 已阻止断言失败被重试或重规划吞掉，包括语义动作中的业务断言失败。
- 表格/图表证据完整度约束：局部或未知证据不推断全量结论。
- 已通过的自然语言 Agent Run 可生成独立、可编辑用例，并保留发起时的项目、分组和环境；生成后仍需用户审阅并主动运行。
- Planner、Verifier、Reporter、取消协议、运行内证据链、受控报告和恢复草稿基础。
- CLI 可复用现有 TestRunner/RecordingRunner/StudioRuntime/BrowserRuntime，输出 JSON/JUnit 并归档 artifact。
- PRD 覆盖矩阵、本地 triage、跨运行覆盖风险和项目级离线报告基础。

这些能力为后续路线提供实现基础，但不代表以下目标已经完成：

- 当前用例还不是完整 Hybrid Case V2。
- 长期资产仍未按 project directory 拆分。
- `neutral` 仍混合表达多种无法继续/未执行情形。
- CLI 批量入口不等于 10–100 case Suite 调度和资源锁已完成。
- Workflow/Recording 的统一运行链不等于固定版本公共流程已完成。
- 恢复草稿基础不等于完整维护队列、安全和保留策略已完成。

### 1.2 完成状态标记

路线图中的状态统一按以下边界解读：

- **代码已实现**：能力已进入共享模型和桌面/CLI 调用链。
- **离线验证已完成**：单元测试、类型检查、构建或差异检查覆盖了该工程边界；不代表模型和业务页面质量。
- **真实验收已完成**：在明确浏览器、页面、数据、模型和产物条件下完成可复现验收。

截至 2026-08-10，离线质量门禁仍由 `pnpm check` 统一执行；测试数量随持续开发变化，应以最新命令输出为准。该门禁不代表真实模型或业务页面验收。

### 1.3 当前目标

路线不再以补齐页面或继续扩大“每次都由 Agent 决策”的能力为主，而是围绕：

```text
自然语言探索
-> 用户确认
-> Hybrid Case
-> Project Assets
-> Shared Runner
-> 长期回归
-> 维护草稿
```

## 2. 总体依赖与推进规则

正式优先顺序固定为：

1. Regression Case V2。
2. Project Asset Store。
3. Fixtures / Auth。
4. Suite Runner。
5. Reusable Flows。
6. Maintenance / Safety。
7. Interaction Breadth。
8. Real Acceptance。

依赖规则：

- 后序阶段可以做技术预研，但不能用临时格式绕过前序 contract。
- 每阶段先兼容读取现有数据，再写入新格式。
- 自然语言、录制和 PRD 都写入同一 Hybrid Case 草稿模型。
- Desktop 与 CLI 不能发展第二套 Runner 或状态语义。
- AI 只能生成探索/恢复/判断结果和维护草稿，不能自动改 project asset。
- 断言失败和高风险动作边界是所有阶段的共同门禁。

## 3. Phase 1：Regression Case V2

**当前状态：V2 基础契约、编辑器人工确认、首批确定性动作与显式断言执行已实现并完成离线验证，完整 Hybrid Case contract 未完成。**

本轮已经完成的基础能力：

- `TestCaseDraft.sourceIntent` 保留自然语言探索、PRD 路径或录制对比目标的原始业务意图；PRD 与录制的自由文本仍只作为待审阅说明，不会提升为确定性浏览器动作。
- `TestStepDraft.execution` 以 schema version `2` 保存待审阅的结构化 action、定位 fingerprint、风险级别和 Agent Run 来源。
- `navigate`、明确 selector 的 `click`、明确 selector 或超时的 `wait`、selector `scroll` 可以在保存时保留为候选确定性动作；Agent Run 的 `input/select` 原值不写入资产，必须在后续编辑器中通过变量、fixture 输出或凭据引用确认后才能执行。
- 语义断言、自由文本断言和 `aiQuery` 仍由派生规则标记为需要模型；显式 assertion contract 才能成为无模型断言。
- hydration 保留旧步骤不变，局部丢弃畸形 V2 execution，不丢 legacy 文本、用例或项目。
- Target locator quality 已收敛为 `strong/acceptable/weak/unresolved`；hydration 会把早期的 `fragile/unknown` 映射为 `weak/unresolved`。`unresolved` 定位不得被人工确认进入确定性执行，必须先替换为可审阅目标。
- 所有 Agent Run 的 `input/select` 原值均不会写进 Case；相关步骤保存为无原值的审阅提示，不携带 action value。这样不依赖字段别名猜测敏感性，密码、token、OTP 和未知秘密字段都不会因漏检落盘。
- 已确认的 `navigate`、selector `click`、selector/超时 `wait`、selector `scroll` 会从 `RuntimeBundle -> TestRunner -> StudioRuntime` 进入无模型确定性执行路径。混合用例保持源步骤顺序；任一确定性步骤为 `failed` 或 `neutral` 时，后续步骤记录为未执行的 `neutral`。
- 确定性执行只在 `BrowserRuntime.hasRealPage()` 为真时派发一次既有浏览器动作。没有真实页面、缺失能力、取消或确认但未支持的 V2 action 不会退回到 Workflow/Planner，也不会调用 Midscene、Verifier、Reporter、重试、fallback 或重规划。
- 持久化脱敏区分结构化 `url` 字段与普通文本：结构化 URL 覆盖任意合法 scheme；普通文本只扫描 `http(s)`、`ftp`、`file`、`about`、`data`；CSS 选择器保留伪选择器，仅检查带引号属性值中的明确 URL，并在发生脱敏时移除候选确定性 action。
- 编辑器仅为可离线执行的 V2 `ai` action 展示人工确认或撤销入口；`input/select` 等未支持动作保持审阅态。确认状态以步骤元数据持久化，编辑步骤标题、指令或类型会自动回退为待确认，避免结构化动作与可见意图脱节。
- 合法且已确认的 V2 `aiAssert` 显式断言也可在编辑器确认或撤销，并在同一无模型执行链路中读取真实页面 URL、标题、文本或公开 DOM。断言失败立即停止后续步骤；没有真实页面、取消、畸形断言或未支持结构均为 `neutral`，不会回退到 Workflow、Planner、Verifier 或 Reporter。每条显式断言证据保留 assertion ID、version、kind 和当次计划中的 expected/evidence，后续编辑 Case 不会改写历史运行的断言归属。

尚未在本阶段完成：`input/select` 安全绑定、录制/PRD 到完整 Hybrid Case contract 的统一转换、完整 assertion evidence contract 和六种终态迁移。Case 顶层 schema version `2` 已由 hydration 兼容升级，所有当前官方创建入口也会直接写入该版本。

### 3.1 目标

把现有用例收敛为 Hybrid Case：

- 业务意图。
- 用户确认的结构化动作与目标。
- 上下文定位指纹和定位质量。
- 显式版本化断言。
- fixture、公共流程和 baseline 的版本引用位。
- 自然语言 Run、录制节点和 PRD 原文来源。

### 3.2 交付

- Case V2 schema 与版本迁移器。
- Assertion ID/version/evidence contract。
- Target fingerprint：语义 HTML、ARIA、公开 DOM 和上下文信号。
- 定位质量 `strong/acceptable/weak/unresolved`。
- 自然语言 Run 保存为 V2 草稿的确认界面。
- 录制和 PRD 适配到同一草稿 contract。
- 运行终态模型：`passed/failed/blocked/skipped/cancelled/error`。
- 独立 flaky 标记及原因。
- 旧 `neutral` 的确定性迁移/映射规则。

### 3.3 AI 与风险门禁

- 已确认 Case 默认不经过 Planner 重新解释。
- 定位候选仍不可靠时才允许 AI 恢复。
- AI 恢复只影响本次 Run，并生成草稿。
- 断言失败停止，不重试或改写断言。
- 高风险动作不能改变对象、范围、输入、账号、租户、环境或业务语义。

### 3.4 验收

- 一个自然语言探索可以经用户确认保存为 V2 Case。
- Case 重新运行时使用确认的动作和断言版本。
- 不提供 `data-testid` 的语义页面可以形成高质量定位。
- `neutral` 样本可明确迁移到 blocked/skipped/cancelled/error/failed。
- AI 恢复成功不会修改原 Case 文件。
- 断言和高风险动作的语义保护有离线测试。

### 3.5 下阶段门禁

Project Asset Store 开始写入前，V2 schema、版本引用和迁移规则必须稳定；否则资产拆分只会把旧歧义分散到更多文件。

## 4. Phase 2：Project Asset Store

**当前状态：已有独立 Project Asset Store 基础，可生成迁移计划并向空的、经审阅的目录原子写入 `project.json`、Case、Recording 和 PRD 文档资产；它尚未接管现有 `studio-data/state.json`，完整资产分类和审阅式迁移 UI 仍未完成。**

### 4.1 目标

将长期资产保存到用户选择的 project directory，将运行时数据保留在 `studio-data`。

### 4.2 交付

```text
<project-directory>/
  project.json
  cases/
  suites/
  fixtures/
  reusable-flows/
  baselines/

studio-data/
  runs/
  artifacts/
  credentials/
  cache/
```

- Project Asset Store：schema 校验、原子写入、稳定 ID 和版本引用。
- `ProjectAssetStore` 目前只提供独立迁移计划、首次写入和读取验证：目录非空时不覆盖，录制步骤中的 screenshot/artifact path 会在写入前剥离，运行数据仍留在 `studio-data`。后续接入必须经过用户确认，不能在普通状态保存时自动迁移。
- Studio Data Store：run/artifact/credential/cache 生命周期。
- 旧 `state.json` 到 project directory 的审阅式迁移。
- 引用完整性、冲突和损坏诊断。
- 外部文件变化检测和重新加载。
- 外部 Git 友好的普通文本/资产文件；不内置 Git 操作。

### 4.3 安全边界

- Project directory 不写 API Key、storageState、cookie、截图、trace 或下载。
- `studio-data` 恢复结果不能直接覆盖 project asset。
- 迁移失败保留原状态，不做部分切换。
- Renderer 只能通过受控 IPC 访问已授权根目录。

### 4.4 验收

- Case/Suite/fixture/flow/baseline 可独立读取、校验和写入。
- run/artifact/credential/cache 不进入 project directory。
- 用户可用外部 Git 查看可读 diff，但 TestBuddy 不要求目录是 Git repository。
- 旧项目迁移有预览、失败回滚和引用校验。

### 4.5 下阶段门禁

Fixtures/Auth 必须基于稳定逻辑引用和双存储边界实现，不能把秘密或运行状态重新塞回 Case 文件。

## 5. Phase 3：Fixtures / Auth

**当前状态：环境和凭证引用已有基础，typed fixture、storageState 生命周期和脚本信任未完成。**

### 5.1 目标

为回归用例提供可复用、可诊断、可清理的数据准备与认证能力。

### 5.2 交付

- Typed fixture input/output。
- Versioned setup/cleanup。
- HTTP、UI、trusted-script 三种执行方式。
- 默认优先 HTTP setup/cleanup。
- setup 部分成功、Case 失败或取消后的 cleanup 尽力执行。
- Playwright `storageState` 创建、引用、刷新和失效诊断。
- Script trust：project identity + relative path + content hash。
- 账号、租户、环境和 fixture 的资源声明。

### 5.3 状态规则

- fixture 前置条件不满足、认证过期、脚本未信任 -> `blocked`。
- fixture/runtime 文件损坏或执行器异常 -> `error`。
- 被测业务断言不满足 -> `failed`。
- cleanup 结果单独记录，不覆盖原 Case 终态。

### 5.4 验收

- HTTP fixture 可把 typed output 传给 Case 并在结束后 cleanup。
- 未信任或 hash 变化的脚本不会执行。
- storageState 不进入 project directory 或报告。
- setup、Case 和 cleanup 的证据可以分别诊断。

### 5.5 下阶段门禁

Suite Runner 只有在 fixture 依赖、认证和资源声明可解析后才能正确并发；否则先保持串行。

## 6. Phase 4：Suite Runner

**当前状态：桌面/CLI 复用执行组件并支持批量 case 参数，但尚未形成完整 Suite 调度。**

### 6.1 目标

在本地稳定运行 10–100 case Suite，并保证桌面端和 CLI 使用同一调度、状态和报告口径。

### 6.2 交付

- Suite asset：用例选择、标签、顺序依赖和环境。
- Shared Runner：Desktop/CLI 单一入口。
- 本地有限并发。
- account/tenant/environment/fixture 等资源锁。
- fail-fast、continue、retry 和 cancel 策略。
- 六种终态聚合和独立 flaky。
- 无后台 daemon 的一次性 Runner 生命周期。
- JSON/JUnit/桌面视图适配同一 RunResult。

### 6.3 验收

- 同一 20 case Suite 在桌面和 CLI 选择相同 Case、解析相同资产版本。
- 资源锁不会并发占用同一共享资源。
- 取消能停止等待、浏览器动作和模型请求，并保留已完成证据。
- 重试后通过显示 `passed + flaky`，不伪装为干净通过。
- Runner 结束后没有后台调度进程。

### 6.4 下阶段门禁

Reusable Flow 必须通过 Runner 的版本解析和依赖图执行，不能成为 Workflow 专属旁路。

## 7. Phase 5：Reusable Flows

**当前状态：Workflow/Recording 可进入统一 Run，但固定版本和影响分析未完成。**

### 7.1 目标

复用登录、导航和数据准备等公共步骤，同时避免“改一处、静默改变所有用例”。

### 7.2 交付

- `flowId@version` 不可变版本。
- Case 固定版本引用。
- 新版本创建和旧版本保留。
- Case/Suite/fixture/baseline 反向引用索引。
- 升级前影响分析和可审阅 diff。
- 用户确认后的原子批量升级。

### 7.3 验收

- 修改公共流程只创建新版本，不改变旧 Run 可复现性。
- 能列出所有受影响 Case 和 Suite。
- 仍被引用的旧版本不能静默删除。
- Desktop/CLI 在 Run 中记录实际 flow 版本。

### 7.4 下阶段门禁

Maintenance/Safety 需要稳定版本和反向引用，才能生成可信维护草稿和保留策略。

## 8. Phase 6：Maintenance / Safety

**当前状态：恢复草稿、报告脱敏、受控 artifact、PRD triage 和取消已有基础，尚未形成统一维护队列。**

### 8.1 目标

把页面变化和运行风险转成可审阅草稿，同时保护资产、秘密和本地数据生命周期。

### 8.2 交付

- 统一维护队列。
- 定位质量下降、AI 恢复、断言变化、baseline 差异、fixture/auth、flow 升级和 flaky 条目。
- 原版本/候选版本 diff 和影响分析。
- 接受后创建新版本，拒绝后不改资产。
- API Key、password、token、cookie、Authorization 和自定义敏感字段脱敏。
- 模型最小证据输入。
- runs/screenshots/traces/downloads/diffs/reports/cache 分类保留策略。
- 固定、baseline 或维护草稿引用的产物保护。

### 8.3 验收

- 页面定位变化后生成草稿并保留原 Case。
- Reporter 自由文本不能直接转成可执行动作。
- 高风险恢复不能改变业务对象或断言。
- 导出报告和模型输入不包含已声明秘密。
- 清理 artifact 不删除 project asset、credential 或仍被引用的证据。

### 8.4 下阶段门禁

Interaction Breadth 扩大副作用和 artifact 类型，必须复用现有信任、脱敏、状态和保留策略。

## 9. Phase 7：Interaction Breadth

**当前状态：基本 navigate/click/input/select/wait/scroll/assert 和部分 network/trace 已存在，目标交互面未完整覆盖。**

### 9.1 目标

在不破坏确定性、安全和证据契约的前提下补齐常见 Web UI 交互。

### 9.2 交付顺序

1. iframe。
2. tab / popup。
3. upload / download。
4. hover。
5. drag and drop。
6. clipboard。
7. network request/response assertions。
8. explicit network mocks。
9. Firefox/WebKit 实验性适配。

Chromium 始终是稳定支持基线。Firefox/WebKit 的结果带实验性标记，不阻塞 Chromium 完成定义。

### 9.3 验收

- 每类交互有结构化 action、observation、artifact 和失败分类。
- download 可等待、校验、归档并应用保留策略。
- mock 必须显式声明、显示启用范围并写入 Run。
- iframe/tab 目标进入上下文定位指纹。
- clipboard 和 upload 的敏感内容经过脱敏策略。

### 9.4 下阶段门禁

真实验收只覆盖已具备明确 contract、离线测试和安全边界的交互，不把现场热修当成正式能力。

## 10. Phase 8：Real Acceptance

**当前状态：有无密钥本地页面基线和离线门禁，真实模型/业务页面的系统验收尚未完成。**

### 10.1 目标

用真实页面、真实模型配置和可复现 Suite 证明产品完成定义，而不是只证明 mock 和单元测试通过。

### 10.2 验收矩阵

- Chromium 稳定页面与动态业务页面。
- 自然语言探索到 Hybrid Case。
- 确定性回归、AI 恢复和复杂 AI 判断。
- typed fixture、storageState 和 cleanup。
- 20 case Suite 的 Desktop/CLI 一致性。
- 公共流程版本升级和影响分析。
- 页面变化到维护草稿。
- iframe/tab/upload/download/hover/drag/clipboard/network。
- Firefox/WebKit 实验性结果单独记录。

每条真实验收记录：

- 页面/环境和数据条件。
- Case、assertion、fixture、flow、baseline 版本。
- 浏览器与模型配置摘要，不记录秘密。
- 输入步骤和期望。
- Run ID、截图、trace、报告和失败证据。
- 干净通过、重试通过和 flaky 区分。

### 10.3 产品完成门禁

- 新用户 15 分钟内完成首个 Hybrid Case。
- 同一 20 case Suite 在桌面与 CLI 的选取、调度、终态和报告口径一致。
- 稳定页面在等价条件下连续 10 轮，干净通过率不低于 95%。
- 页面变化形成维护草稿，原资产、断言和业务语义不被自动改写。

## 11. 跨阶段风险与应对

### 风险 1：继续以 Agent 自主性代替回归稳定性

应对：

- V2 Case 固定动作、目标和断言。
- AI 只在探索、受控恢复和复杂判断出现。
- AI 介入全部记录，不能静默写资产。

### 风险 2：先做 Suite UI，后补资产和调度语义

应对：

- 严格按 V2 -> Asset Store -> Fixtures/Auth -> Runner 推进。
- Desktop/CLI 都只调用 Shared Runner。

### 风险 3：用 `neutral` 掩盖不可执行原因

应对：

- 在 V2 阶段拆分 blocked/skipped/cancelled/error/failed。
- flaky 与终态独立。

### 风险 4：公共流程和 AI 恢复造成批量语义漂移

应对：

- 固定版本引用。
- 变更前影响分析。
- 只生成草稿，用户确认后创建新版本。

### 风险 5：扩大交互范围后泄露秘密或残留数据

应对：

- Fixtures/Auth 和 Maintenance/Safety 先于 Interaction Breadth。
- upload/download/clipboard/mock 复用脱敏、信任和保留 contract。

## 12. 非目标

路线图不包含多人/RBAC、云同步、分布式执行、内置 Git、完整 API 测试、移动端、性能测试、验证码绕过或跨桌面应用自动化。

## 13. 阶段完成定义

一个阶段只有同时满足以下条件才可标记完成：

- 目标 contract 明确并与前序阶段兼容。
- 桌面/CLI 或资产消费者没有旁路实现。
- 状态、错误和证据可诊断。
- AI 和高风险动作边界有自动化验证。
- 迁移保留旧数据，失败可回滚。
- 文档同步更新。
- 需要真实页面/模型的能力完成独立真实验收，不用离线测试代替。
