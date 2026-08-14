# 当前应用 Grill Me 审查与改造推进

**审查日期：** 2026-08-13
**Wave 0 本地验证：** 2026-08-14
**审查范围：** 当前未提交的 Suite Desktop Adapter 变更、既有 Electron/React/CLI 运行链、Project Asset Store、持久化、证据与测试门禁。
**审查方法：** 不以页面数量或单元测试数量作为完成度；逐项追问“资产是否不可变、运行是否精确、结果能否重放、失败是否可归因、秘密是否隔离、质量门禁是否可执行”。

## 结论

TestBuddy 已具备本地工作台、受控浏览器、确定性步骤、Fixture/Auth、Suite 调度和离线测试基础，但尚不能把自己称为可复现的长期回归平台。

最大问题不是功能缺少，而是三个核心契约没有同时成立：

```text
资产版本可寻址
    + 运行实际版本可记录
    + 历史运行可按原版本重放
```

当前 Fixture/Suite 已部分实现版本化；Case 版本只在单个可变对象上递增，历史内容没有存储；RunDetail 也没有完整资产清单或环境快照。因此页面编辑后，Suite 的旧 `caseId@version` 会被安全地阻断，却无法真正解析旧版本；“重新运行”又直接选取当前 Case。这能避免静默升级，但不能满足可复现回归的目标。

在修复这些底座前，不应继续把 Reusable Flows、维护队列、并发浏览器池或更多交互能力接到当前模型上。它们会放大版本与证据歧义。

## 已核实的基础能力

- Electron renderer/main/preload 分层；浏览器、凭据、文件系统和脚本信任均通过主进程控制。
- 明确 selector/URL 的已确认动作和显式断言可在真实 Playwright 页面运行；Fixture setup/cleanup、凭据和 storageState 有运行前门禁。
- Fixture 与 Suite 已拥有独立版本化资产、精确引用和 Project Asset Store 文件布局。
- Suite 调度已支持依赖、资源锁、重试、fail-fast、父级取消；桌面只持久化真实成员 Case RunDetail。
- Project Asset Store 对首次写入、外部变更、受控重载和 CAS 更新已有预览/确认边界。
- 直接离线质量入口已跑通：47 个测试文件、454 个测试通过；renderer/Electron TypeScript、Vite 构建、`git diff --check` 通过。
- 本地 Playwright Chromium smoke 已验证 localhost 确定性 Case、真实 PNG 证据与 Suite 取消；该测试不调用模型或业务页面。

这些结论只代表代码和离线验证，不代表真实模型、真实业务页面或发布制品验收。

## Grill Me 发现

### P0：Case “版本”不可重放，Suite 的精确 Case 选择没有资产闭环

**质询：** Suite 已保存 `caseId@version`，那么修改 Case 后运行旧 Suite 是否能取回旧 Case？
**回答：** 不能。当前项目只保存每个 Case ID 的一个对象；编辑时在原对象上增加 `version`，没有保留旧内容。Suite resolver 只按 Case ID 找到当前对象，再将版本不等视为 `staleCaseVersion`。这避免误跑最新版，但没有历史版本可执行。

**证据：**

- `src/App.tsx:687` 的 `updateSelectedTestCase()` 用 `map()` 替换同一 `testCase.id`，只递增 `version`。
- `shared/studio.ts:807` 的 `ProjectDraft.testCases` 只是一组当前 Case；不存在 version collection / revision history。
- `electron/projectAssetStore.ts:895` 仅写 `cases/<id>.json`，而 Fixture/Suite 分别写 `<id>@<version>.json`。
- `shared/studio.ts:832` 和 `shared/studio.test.ts:120` 对旧 Suite Case 引用给出 `staleCaseVersion`，没有历史 Case 解析路径。
- `src/App.tsx:2445` 的重新运行按 `run.testCaseId` 查当前 Case，不读取运行时版本。

**影响：** Suite 的“精确版本运行”、Case 的“不可变版本”、Flow 升级影响分析和历史重放都不能成立。继续实现 Reusable Flows 只会让它引用一个不存在的 Case 历史层。

**改造：**

1. 将 Case 与其他长期资产统一为版本集合：`cases/<id>@<version>.json`，manifest 持有 `VersionedTestAssetReference[]`。
2. 为编辑建立“基于当前版本创建新版本”的草稿流，禁止原地覆盖；列表默认显示最新版本，但可选择任何版本。
3. 全部 resolver/CLI/desktop 只接受精确 Case reference；普通“运行当前 Case”先显式转换为最新 reference。
4. 建立旧 `cases/<id>.json` 的审阅式迁移：生成 v1，检测同 ID 冲突，保留原目录直到确认发布。
5. Suite 的旧 Case reference 应在迁移后可执行，而不是仅被标记陈旧。

**退出条件：** 在 v1 Case 被编辑并发布 v2 后，旧 Suite 仍能执行 v1；Case v1/v2 均可被 Project Asset Store 读写；desktop/CLI 用相同 reference 得到相同 Case asset。

### P0：运行记录没有可重放的资产与环境快照

**质询：** 一个两周前的失败 Run，能否说明它运行了哪个 Case/Fixture/Suite/Flow 版本、哪份环境配置和哪种浏览器 profile？
**回答：** RunDetail 只记录 `testCaseId`、`environmentId`、步骤/日志/artifact；没有 Case version、Fixture reference 集合、Suite parent reference、环境快照、runtime profile 或 Model 配置指纹。当前 run history 只能靠现在的项目状态解释旧运行。

**证据：**

- `shared/studio.ts:1058` 的 `RunDetail` 无资产版本清单和环境/运行配置快照。
- `electron/runtime/run-history.ts` / `electron/main.ts:596` 只追加运行详情与当前环境元数据。
- `src/App.tsx:2450` rerun 直接选择当前 Case 与当前环境。
- Suite 结果有 `suiteId/suiteVersion` 和成员 `testCaseVersion`，但成员 `RunDetail` 本身没有保存其 Case/Suite parent 归属与完整 resolved asset set。

**影响：** 失败分析、长期趋势、升级影响、审计与 rerun 都会随着当前资产变化而改变解释；运行报告也无法诚实说明其输入。

**改造：**

1. 新增 `RunProvenance`：Case reference、可选 Suite reference/parent run ID、ordered Fixture/Flow/Baseline references、环境逻辑 ID 与脱敏快照、browser/runtime profile、执行器/应用版本、模型配置仅保存 provider/model/endpoint 指纹与 `hasKey`，绝不保存 API Key。
2. 在 main-process adapter 创建 Run 前冻结 provenance；Runner 和所有后续 UI 只消费这份冻结数据。
3. “重新运行”默认使用 provenance 的精确 assets 与环境快照；缺失或已删除的依赖要明确显示不可重放，而非降级到当前资产。
4. 报告、Suite 结果和 CLI JSON/JUnit 统一引用 provenance，不再由当前 ProjectDraft 回填历史名称/版本。

**退出条件：** 编辑资产后，历史 Run 的资产面板与 rerun 计划保持不变；依赖不可用时有明确 `blocked` 原因；导出报告可说明实际版本而不泄露秘密。

### P0：终态 `neutral` 混合了取消、阻断、跳过、人工待办与内部错误

**质询：** “neutral” 是用户取消、Fixture 不可用、依赖失败、模型缺失、人工步骤、还是运行器异常？
**回答：** 都可能是。`RunTone` 只有 `running/passed/failed/neutral`；覆盖风险、Suite 聚合、JUnit、报告与 UI 都不得不把不同原因混合处理。

**证据：**

- `shared/studio.ts:3` 定义四种 `RunTone`。
- `TestRunner` 用 neutral 处理取消、Fixture preflight、手工步骤和未支持步骤。
- `shared/studio.ts:3285` 的 coverage risk 只区分 passed、failed、neutral、neverExecuted。
- 路线图也明确将六种终态列为未完成项。

**影响：** 无法正确量化失败率、跳过率、环境/基础设施问题、取消或人工待办；Suite fail-fast 与 CI exit code 也缺少可靠语义。

**改造：**

1. 引入终态：`passed | failed | blocked | skipped | cancelled | error`，`running` 保持过渡态；flaky 独立记录。
2. 给每个非 passed 终态增加稳定 `reasonCode` 与可读 message，例如 `missingAssetVersion`、`fixturePreflight`、`dependencyFailed`、`userCancelled`、`unsupportedAction`、`executorError`。
3. 写迁移映射：旧 neutral 仅在证据足够时映射，否则保留 `blocked` + `legacyAmbiguousNeutral`，不伪造精确历史。
4. 同时迁移 Suite aggregation、RunRecords、coverage risk、ProjectReport、CLI JSON/JUnit 与筛选/翻译。

**退出条件：** 取消、前置阻断、依赖跳过、执行器异常、真实断言失败分别展示且能被报告/CLI 区分；旧 Run 不被误判为 failed 或 passed。

### P1：Project Asset Store 仍是可选快照，不是运行的权威资产源

**质询：** 用户绑定 project directory 后，desktop/CLI 是否从该目录解析要运行的资产？
**回答：** 不稳定。Project Asset Store 能快照、诊断、重载与 CAS 发布，但日常 App state、CLI data-dir 与 runtime request 都仍以 `studio-data/state.json` 中的 ProjectDraft 为中心。目录不是单一事实源。

**证据：**

- `electron/studioStore.ts:19` 把 `studio-data/state.json` 作为完整 StudioState 存储。
- `electron/cli.ts:25` 只接受 data-dir 并从该 state 加载项目。
- `electron/main.ts:144` 的资产操作也先从 StudioStore 读取项目；Runtime 接收 renderer 传来的 ProjectDraft。
- `ProjectAssetStore` 当前是显式快照/重载流程，而不是项目运行的标准读取入口。

**影响：** 外部 Git 修改、CLI、desktop、运行历史之间可能观察到不同资产；“项目目录可审阅版本资产”无法成为可交付契约。

**改造：**

1. 在 Case version history 落地后，定义 `ProjectRepository`：绑定项目优先从 project directory 加载经过校验的 snapshot；StudioStore 只保存 project binding、UI 偏好、运行历史、秘密引用与缓存。
2. Runtime/CLI 先通过 repository 获取一个 revision-pinned project snapshot，再创建 RunProvenance。
3. 对未绑定 legacy 项目保留 StudioStore fallback，并在 UI/CLI 明确标为 legacy/non-reproducible。
4. 绑定状态下禁止 renderer 自带 ProjectDraft 作为执行权威输入；main process 比对其 revision，拒绝陈旧编辑态。

**退出条件：** 同一已绑定项目从 desktop 与 CLI 获得同一 manifest revision；目录外修改在运行前被检测到；StudioState 不再复制长期资产内容。

### P1：模型 API Key 仍以明文进入 StudioState 和浏览器 fallback

**质询：** 凭据已加密，模型 API Key 是否也隔离？
**回答：** 否。`MidsceneConfig.modelApiKey` 与每个 Agent role 的 `modelApiKey` 是 StudioState 的普通字符串。StudioStore 将整个状态 JSON 写入磁盘；browser fallback 写入 localStorage。

**证据：**

- `shared/studio.ts:1174`、`shared/studio.ts:1195` 定义明文 key 字段。
- `shared/studio.ts:1218` 把这些配置放入 StudioState。
- `electron/studioStore.ts:61` 原样 JSON 写入 state.json；`src/lib/persistence.ts:36` 的 browser fallback 原样写入 localStorage。
- 业务 Credential 已通过 `electron/runtime/credential-store.ts:85` 使用 Electron safeStorage，说明项目已有可复用模式。

**影响：** 本机磁盘备份、日志采集、浏览器开发工具或误导出的状态均可能暴露模型密钥；这与“项目资产不含秘密”相比是更广的持久化风险。

**改造：**

1. 将模型密钥迁入 main-process `SecretStore`，统一采用 safeStorage；StudioState 与 renderer 仅持有 secret reference 与 `hasKey`。
2. 所有 IPC run request 移除 API Key 字段。main process 根据选定 provider/config reference 解析一次，并只传入内存执行器。
3. 明确 browser fallback 的安全能力：不支持保存 key，或使用会话级未持久化 key；不能继续写 localStorage。
4. 迁移旧 state：检测明文 key、导入 SecretStore 后从 state 清除；迁移失败不删除原状态，并要求用户重新输入。

**退出条件：** 搜索 StudioState/project assets/run details/report/renderer payload 均不存在 API Key；desktop 仍可完成模型连接与运行；migration 有测试。

### P1：证据对象和生命周期不符合“真实可审阅”目标

**质询：** 确定性 Case 的“运行起始快照”是否真是浏览器截图？产物何时清理？
**回答：** BrowserRuntime 能捕获真实 full-page PNG，但 TestRunner 的起始证据使用 ArtifactManager 生成的 SVG 占位卡；artifact 目录无分类保留策略或受引用保护机制。

**证据：**

- `electron/runtime/test-runner.ts:225` 调用 `ArtifactManager.createSnapshot()`。
- `electron/runtime/artifact-manager.ts:53` 生成包含标题和 URL 的 SVG，而不是 page screenshot。
- `electron/runtime/browser-runtime.ts:222` 与 `:741` 确实能从真实 page 生成 full-page screenshot，但 TestRunner 没有把它作为其确定性步骤的标准证据。
- ArtifactManager 只有单文件 `removeArtifact()`，没有 retention planner、引用检查、类别策略或清理审计。

**影响：** UI 可能宣称“截图/快照”却不能验证页面状态；运行历史积累无控制，或未来清理会误删仍被 Run/baseline/draft 引用的产物。

**改造：**

1. 建立 `ArtifactManifest`：类型、生成时间、大小、content hash、Run owner、保留分类、引用计数/保护原因；保留路径仍只由 main process 管理。
2. 在每个关键确定性步骤和失败点捕获真实 Playwright screenshot；无真实 page 时明确标记 synthetic diagnostic，而不是 screenshot。
3. 新增 retention planner：按类型/时间/大小计算候选，排除 Run、baseline、维护草稿和导出锁定引用；用户审阅后执行、记录删除清单。
4. 报告只使用可验证 evidence metadata，不能把占位产物表述为页面截图。

**退出条件：** 失败 Case 能打开真实失败时页面证据；清理预览不会选中受保护产物；断链 artifact 在报告中明确不可用。

### P1：Suite 调度能力与实际浏览器容量、报告模型不匹配

**质询：** Suite 宣称有限并发、资源锁、重试，那么用户能运行多少 Case、看到什么 Suite 运行记录？
**回答：** 调度器具备并发策略，但 desktop/CLI 被单 BrowserRuntime 强制为 1；没有隔离 browser pool，也没有持久化的 Suite parent RunDetail/完整 JSON/JUnit 报告。当前 UI 仅回显成员 Case。

**证据：**

- `electron/runtime/suite-runner.ts:62` 接受 maxConcurrency，但 desktop adapter 固定为 1。
- 路线图已明确隔离浏览器池、10–100 Case 验收和完整 Suite 报告未完成。
- `shared/studio.ts:1081` 的 SuiteRunDetail 是内存 aggregate；main 仅持久化 Case details。

**影响：** “Suite 已完成”容易被误解为可规模化回归；无法以一个稳定 parent run 追踪一次 Suite 的成员、配置、取消、汇总与导出。

**改造：**

1. 在 RunProvenance 之后定义独立 `SuiteRunRecord`，作为 parent history 而不是伪造 Case RunDetail。
2. 先实现稳定的串行 parent/child 报告、JUnit/JSON 和取消语义；再以浏览器隔离、storageState/fixture/credential/resource lock 为池租约设计前提，逐步放开受控并发。
3. 将 10、20、100 Case 验收拆成明确 benchmark：启动/清理、并发度、失败重试、资源锁、取消、内存/磁盘增长与报告完整性。

**退出条件：** 一次 Suite 有可检索 parent record，成员 Case 的精确资产与终态可追溯；并发没有与认证状态/Fixture 资源冲突；真实 20 Case 样本通过。

### P2：质量门禁不可复现，缺少 CI 与分层端到端验收

**质询：** “pnpm check 通过”能否在干净环境稳定执行？有没有发布前自动验证 Electron IPC 与真实页面？
**回答：** 当前 `pnpm check` 在根目录找不到 `vitest` 可执行链接而失败；直接用 `pnpm exec node node_modules/...` 可运行 443 个测试、类型检查、构建和 diff check。仓库没有 CI 配置，也没有 Playwright/Electron 端到端套件或真实业务/模型验收矩阵。

**证据：**

- 本次执行 `pnpm check` 失败：`sh: vitest: command not found`。
- 等价直接入口通过：45 test files / 443 tests，renderer/Electron typecheck、Vite build、diff check。
- package scripts 以 `pnpm test -> vitest run` 为链路；没有 CI 文件，Vitest 仅配置 `jsdom`。

**影响：** 本地或 CI 不能用一个支持命令可信验证；组件测试无法证明 preload/IPC、主进程存储、真实 BrowserRuntime 和页面证据路径没有回归。

**改造：**

1. 修复根可执行链接/安装契约，并使 `pnpm check` 在干净 clone、CI 和开发机使用同一命令成功。
2. 添加 CI：锁文件冻结安装、check、构建产物、最小 Electron smoke；缓存不影响正确性。
3. 建立三层验证：纯函数/组件、main+preload IPC 集成、真实 Playwright local fixture page。模型与业务页面采用显式受控 acceptance job，不伪装成单元测试。
4. 为未提交大范围工作建立变更门禁：schema/运行/资产改造必须添加 migration、idempotence 和 cancellation 回归测试。

**退出条件：** 干净环境的 `pnpm check` 成功；每个 PR 有 CI 状态；至少覆盖启动、资产加载、Case run、Suite cancel、artifact 打开与 SecretStore 隔离的 Electron smoke。

### P2：核心编排和状态模块过大，风险集中在难以审查的文件中

**质询：** 能否在不通读数千行文件的情况下验证一次状态/运行语义变化？
**回答：** 目前很难。`shared/studio.ts` 约 4,987 行，`src/App.tsx` 约 2,907 行，`electron/studioRuntime.ts` 约 4,183 行；它们同时承载 schema、hydration、派生报告、页面状态、运行分派和交互逻辑。

**影响：** 版本/终态迁移会牵涉大面积隐式耦合，审查和回归测试容易漏掉消费者；未来 Flow/Maintenance 功能会进一步膨胀。

**改造：**

1. 先按即将引入的稳定边界拆分：`asset-contracts`、`run-contracts`、`state-hydration`、`asset-resolvers`、`report-derivation`。
2. 将 App 的 project update、run lifecycle、navigation/selection 拆为 reducer/hook，并把纯转换移出组件。
3. StudioRuntime 的 plan/execute/observe/report 协议保持接口，按 deterministic / agent / recording adapters 拆开；禁止在一次迁移中做无关 UI 重构。

**退出条件：** 上述关键契约可独立导入/测试；Case version 与 RunProvenance 改造不要求在 App 或 StudioRuntime 多处复制相同规则。

## 重新排序后的推进波次

### Wave 0：冻结扩展，建立可验证基线

**目的：** 不让新功能继续建立在不可重放的数据上。

- 暂停 Reusable Flows V1 实现、维护队列、并发 browser pool 和新增交互类型。
- 修复 `pnpm check`；加入 CI 和最小 Electron smoke。
- 把已知质量验证与真实验收分开记录；不以单元测试通过声明真实浏览器/模型通过。

**本地实施状态（2026-08-14）：** 已完成。`pnpm check` 在无根 `.bin` 的布局下通过（47 files / 454 tests）；独立 Chromium smoke 通过（1 file / 2 tests），覆盖 localhost confirmed Case、真实 PNG 和 Suite 取消；运行时/IPC 聚焦回归为 6 files / 60 tests。`.github/workflows/verify.yml` 已使用冻结安装和受管 Chromium + Headless Shell。GitHub 托管工作流尚未触发，不能将配置存在表述为 CI 已绿。

**完成判定：** 本地基线已满足；首次推送后需取得托管 CI 绿。已知风险仍限于真实模型、真实业务页面和发布制品验收。

### Wave 1：Case 历史版本与项目资产权威化

**目的：** 让所有长期引用真正指向可读取的不可变资产。

- 设计 Case version collection、manifest v2 和旧目录审阅迁移。
- ProjectRepository 解析绑定目录，并生成 revision-pinned snapshot。
- Desktop/CLI/Runtime 统一从 exact Case reference 运行；Suite resolver 支持历史 Case。
- 增加不可变编辑/发布 UI，保留兼容 legacy current-case 模式。

**完成判定：** v1/v2 Case 并存并分别可运行；Suite v1 仍能执行 Case v1；desktop/CLI 对同一 project revision 一致。

### Wave 2：终态、运行 provenance 与真实 rerun

**目的：** 让每次运行有稳定、可解释、可重放的身份。

- 迁移六种终态、reasonCode、独立 flaky；更新覆盖风险/JUnit/报告。
- 主进程冻结 RunProvenance、环境脱敏快照与资产 reference 集；RunDetail/SuiteRunRecord 保存它。
- rerun 只从 provenance 生成计划，缺失版本显示 blocked。

**完成判定：** 取消、阻断、跳过、错误与失败可区分；编辑后旧 Run 的说明不变；rerun 不会静默使用新版。

### Wave 3：秘密与证据治理

**目的：** 让运行输入和输出都可安全保存、审阅和清理。

- Model API Key 迁入 SecretStore，移除 StudioState/localStorage 明文。
- ArtifactManifest、真实步骤截图、synthetic diagnostic 标签、retention planner 和保护引用。
- 为 SecretStore migration、artifact 清理和脱敏报告建立测试。

**完成判定：** state/project/report/renderer 无 key；失败 Run 有可验证页面证据；清理不破坏引用。

### Wave 4：恢复 Phase 5 Reusable Flows

**目的：** 在真实版本链上实现固定 Flow 和影响分析。

- 采用已确认的 `docs/superpowers/specs/2026-08-13-reusable-flows-v1-design.md`，但将其中“Case 当前 revision”假设替换为 Wave 1 的不可变 Case 版本集合。
- Flow 影响分析涵盖精确 Case versions、Suite references 和 frozen RunProvenance；批量升级只创建新的 Case versions 与显式 Suite upgrade proposals。

**完成判定：** Flow v1/v2、Case v1/v2、Suite v1/v2 和历史 Run 均可按各自固定引用解释和执行。

### Wave 5：Suite parent record 与受控规模化

**目的：** 将现有调度器变成可运营的 Suite Run 能力。

- 独立 SuiteRunRecord、完整 JSON/JUnit、串行真实验收。
- 在资源/认证隔离验证后加入 browser pool 与有限并发。
- 完成 10/20/100 Case 基准和取消/清理/存储增长验收。

**完成判定：** Suite 是可追溯的产品对象，而不只是多个 Case Run 的临时 UI 聚合。

### Wave 6：Maintenance/Safety 与 Interaction Breadth

**目的：** 在可靠证据和影响图基础上生成维护草稿，并安全扩大交互面。

- 统一维护队列只创建草稿；每项带原资产版本、候选 diff、影响范围、证据和接受/拒绝审计。
- 扩展 iframe/tab/upload/download/hover/drag/clipboard/network/mock，所有新副作用经过 SecretStore、ArtifactManifest、终态和 retention contract。

**完成判定：** 页面变化不会自动写资产，复杂交互不会绕过现有安全/审计边界。

### Wave 7：真实验收与发布门禁

**目的：** 用真实页面与模型证明而非推测产品完成度。

- 维护公开 local fixture、受控业务 staging、真实模型三类验收矩阵。
- 固定浏览器/环境/测试数据/模型版本，记录 20 Case desktop/CLI 一致性与 10 轮稳定性。
- 报告失败根因、证据、资产 revision、重试/flaky 与人工结论；不将验收临时修复写回资产。

**完成判定：** 满足明确通过阈值，并能以被冻结的 RunProvenance 复现任一验收记录。

## 近期禁止事项

- 不把 Workflow 或 Recording 直接改名为 Reusable Flow。
- 不为 Flow/Suite 增加“最新版自动升级”或按 ID 的隐式解析。
- 不把旧 Case version 缺失降级为运行当前 Case。
- 不继续扩展 `neutral` 的含义或用它掩盖 executor error。
- 不在 StudioState、localStorage、RunDetail、artifact metadata、项目资产或模型 prompt 中保存 API Key/秘密明文。
- 不把 SVG 占位卡表述为真实页面 screenshot。
- 不在没有 browser isolation、资源锁验收和 parent report 前承诺 10–100 Case 并行执行。

## 首个实施切片

开始 Wave 0 时，只做两件事：

1. 修复干净环境 `pnpm check` 并加入 CI 的 check job。
2. 写一份 Case version collection 的设计与迁移规格，明确 manifest 变更、legacy 读取、版本选择、ProjectRepository 和 Suite compatibility。

第二项获得设计确认前，不改动 Case/Run schema。这样可避免在当前已存在的未提交 Suite adapter 变更上叠加不可逆迁移。

## 本次审查证据

- `pnpm check` 本次失败于 `sh: vitest: command not found`；不切换包管理器。
- 等价 `pnpm exec node node_modules/...` 质量链已通过：45 个测试文件、443 个测试、renderer/Electron TypeScript、Vite 构建与 `git diff --check`。
- 仓库未发现 CI 配置；Vitest 为 jsdom 配置，未发现 Playwright/Electron E2E 测试套件。
- 本次审查没有修改应用代码或现有路线图；该文档是新增的改造排序依据。

## Wave 0 实施验证（2026-08-14）

- `pnpm check`：47 个测试文件、454 个测试通过；renderer/Electron TypeScript、Vite 构建与 `git diff --check` 均通过。默认离线门禁明确排除 browser smoke，不下载浏览器。
- `pnpm test:browser-smoke`：1 个测试文件、2 个测试通过。测试仅绑定 test-owned `127.0.0.1` fixture，确认 deterministic navigate/click/assert 产生真实 PNG，并确认 Suite 父级取消后不启动第二个浏览器会话。
- 受管 Playwright 1.61.1 Chromium、Chromium Headless Shell 与 FFmpeg 已在本地安装并由 CLI 识别；测试没有使用模型 Key、业务页面、staging URL 或私有上传。
- `electron/ipc/runtime-ipc-handlers.test.ts` 与 `electron/preload-contract.test.ts` 验证运行 IPC/preload 通道、受控 fixture trust、Suite cancel 及受管 artifact 打开边界；与 BrowserRuntime/TestRunner/SuiteRunner/RuntimeBundle 聚焦回归共计 6 files / 60 tests。
- GitHub Actions workflow 已配置为 `pnpm install --frozen-lockfile`、`pnpm check`、受管 Chromium + Headless Shell 与 `pnpm test:browser-smoke`。首次 GitHub 运行尚未发生，因此没有托管 CI 成功的声明。
