# 阶段 D：追踪指标历史逻辑懒加载实施计划

> 文档状态：独立实施计划，尚未实施
>
> 编写日期：2026-09-08
>
> 代码基线：`main` 分支，`f98af97`；阶段 A、B、C 已完成
>
> 上游方案：[`settings-state-storage-sharding-plan.md`](settings-state-storage-sharding-plan.md)

## 1. 结论

阶段 D 首次实施只做“逻辑懒加载”：

1. `metricSnapshots` 不再进入启动 Bootstrap、`state:updated` 广播和 renderer 常驻状态。
2. 追踪档案的身份、状态、来源、标签、逻辑、时间线和结论继续作为摘要常驻，保证列表、筛选、系统分组和追踪生命周期不退化。
3. 个股追踪页或追踪复盘选中某只股票时，再通过独立 IPC 分页读取该股票的指标历史。
4. renderer 保存普通状态或追踪摘要时，主进程必须保留当前已提交的 `metricSnapshots`；禁止用空数组占位后继续整份覆盖。
5. 股票代码因公司行动发生迁移时，必须显式携带指标历史转移关系，不能靠字段相似度猜测。
6. 本地导出、用户数据恢复和 GitHub Gist 继续使用完整逻辑 `AppState`，指标历史不能因懒加载从备份中消失。
7. 本阶段不改 `state/manifest.json` 格式，不降低启动时的磁盘读取量，也不宣称降低主进程内存。

选择这个边界的原因是：当前阶段 A 已把单体文件拆分并解决局部写入、历史复用和恢复问题；阶段 D 的直接收益应先集中在 Bootstrap 序列化、跨进程复制和 renderer 常驻内存。再次升级物理格式会同时引入延迟校验、后台采集和损坏恢复语义，应该等真实指标证明必要后另立计划。

## 2. 当前实现基线

### 2.1 数据规模

2026-09-08 的调研样本中：

| 内容                         | 紧凑 JSON 大小 |
| ---------------------------- | -------------: |
| 全部 `stockTrackingProfiles` |   706,716 字节 |
| 其中 `metricSnapshots`       |   624,064 字节 |
| 其中 `entries`               |    30,540 字节 |
| 其中 `sources`               |    19,273 字节 |

指标历史约占追踪档案体积的 88.3%，是最适合单独按需传输的字段。`entries` 和 `sources` 目前规模较小，并且被追踪列表的搜索、来源筛选和最近记录直接使用，本阶段不拆。

### 2.2 当前生命周期

```text
StateStore.load()
  ↓ 读取 manifest 引用的全部分片并组装完整 AppState
主进程 state: AppState
  ├─ app:bootstrap → renderer 完整 AppState
  ├─ state:updated → renderer 完整 AppState
  ├─ StockTrackingMetricsRuntime 读取并合并 metricSnapshots
  ├─ AI read_stock_data 分页读取 metricSnapshots
  └─ 导出 / Gist 上传生成完整逻辑备份
```

renderer 的 `App.persist()` 当前把完整状态提交到 `state:save`。如果只是从 Bootstrap 删除 `metricSnapshots`，再用 `[]` 满足旧类型，下一次保存主题、列顺序或任意股票字段时就会把主进程中的历史覆盖为空。这是阶段 D 必须先解决的核心风险。

### 2.3 实际消费者

| 消费者                         | 是否需要完整指标历史 | 当前用途                                     |
| ------------------------------ | -------------------- | -------------------------------------------- |
| 自选表格、榜单、扫描和追踪列表 | 否                   | 追踪状态、来源、标签、更新时间、逻辑和时间线 |
| `StockTrackingEditor`          | 是                   | 指标卡片、量价趋势、量比趋势                 |
| `StockTrackingPanel`           | 是                   | 个股详情追踪页                               |
| `StockTrackingDialog`          | 仅当前选中股票       | 列表使用摘要，右侧详情使用历史               |
| `StockTrackingMetricsRuntime`  | 是                   | 主进程后台计算并按交易日合并                 |
| AI `research.tracking` 数据集  | 按页需要             | `read_stock_data` 返回用户请求的一页追踪数据 |
| 本地导出、恢复和 GitHub Gist   | 是                   | 保持完整逻辑备份和跨机器恢复                 |

## 3. 目标与非目标

### 3.1 目标

- Bootstrap 和 `state:updated` 不再携带全部 `metricSnapshots`。
- renderer 全局状态不再常驻全部指标历史。
- 只在打开具体追踪详情时读取对应股票的指标页。
- 未打开追踪详情时，背景指标采集不向 renderer 广播整段历史。
- 任意普通保存都不能删除、截断或回退指标历史。
- 全局 revision 冲突保护继续覆盖前台保存和后台指标采集。
- 公司行动引起的 `quoteId` 迁移完整保留对应指标历史。
- 本地导出、恢复、Gist 上传与旧备份解析继续包含完整历史。
- 浏览器演示入口保持可用，接口形状与桌面版一致。

### 3.2 非目标

- 不修改 manifest schema，也不把指标历史拆成新的物理文档。
- 不减少 `StateStore.load()` 在主进程启动时读取的文件或字节数。
- 不把交易账本、追踪时间线、来源历史改成懒加载。
- 不引入数据库、通用查询框架或第三方缓存库。
- 不改变指标计算、量价背离、技术形态和提醒语义。
- 不改变本地用户数据备份或 Gist 逻辑备份的 `formatVersion`。
- 不在没有运行测量的情况下继续实施物理懒加载。

## 4. 方案比较

| 方案                                         | 优点                           | 主要问题                                                     | 结论     |
| -------------------------------------------- | ------------------------------ | ------------------------------------------------------------ | -------- |
| Bootstrap 中把 `metricSnapshots` 替换成 `[]` | 改动最小                       | 任意后续整份保存都会清空历史；无法接受                       | 禁止     |
| 直接升级 manifest 并延迟读取指标文件         | 同时减少主进程启动 I/O 和内存  | 引入新物理迁移、延迟 hash 校验、后台采集和损坏恢复语义       | 暂缓     |
| 摘要状态 + 独立历史 IPC + 主进程合并保存     | 不改磁盘格式，可回滚，收益明确 | 需要新增 renderer 状态类型，并审计所有追踪档案写入和 ID 迁移 | 推荐实施 |

## 5. 类型与数据契约

### 5.1 完整逻辑类型继续保留

`StockTrackingProfile` 和 `AppState` 继续代表完整逻辑数据，用于：

- `StateStore` 内部状态；
- 指标采集运行时；
- 用户数据导出和恢复；
- GitHub Gist 明文备份；
- 共享 normalize 和旧备份兼容。

不能为了 Bootstrap 直接把 `StockTrackingProfile.metricSnapshots` 改成可选字段。可选字段会把“尚未加载”和“没有历史”混为一谈，并把大量空值判断扩散到完整数据链路。

### 5.2 新增 renderer 摘要类型

建议在 `src/shared/types.ts` 增加：

```ts
interface StockTrackingMetricHistorySummary {
  count: number
  firstTradingDate?: string
  lastTradingDate?: string
  updatedAt?: string
}

type StockTrackingProfileCore = Omit<StockTrackingProfile, 'metricSnapshots'>

type StockTrackingProfileSummary = StockTrackingProfileCore & {
  metricHistory: StockTrackingMetricHistorySummary
}

type StockTrackingProfileSummaries = Record<string, StockTrackingProfileSummary>

type ClientAppState = Omit<AppState, 'stockTrackingProfiles'> & {
  stockTrackingProfiles: StockTrackingProfileSummaries
}
```

`metricHistory.updatedAt` 取全部快照中最大的 `capturedAt`。当前指标合并只增加或更新快照，`count + updatedAt` 可作为 renderer 详情缓存的失效标识。不要把最新完整 snapshot 放进摘要，否则会重新引入指标字段的常驻复制，并形成两份数据来源。

同时收紧共享辅助函数的输入类型：只读取身份、状态、来源、标签或时间线的函数改为接收 `StockTrackingProfileCore` 或更小的 `Pick`；只有指标计算、指标合并、完整导出和完整 normalize 继续接收 `StockTrackingProfile`。例如 `synchronizeWatchlistGroupMemberships` 实际只读取 `status`，不应继续强制要求完整 profile。禁止用类型断言把 summary 冒充完整 profile。

### 5.3 指标历史分页

```ts
interface StockTrackingMetricSnapshotPage {
  quoteId: string
  total: number
  offset: number
  records: StockTrackingMetricSnapshot[]
  nextCursor: string | null
  history: StockTrackingMetricHistorySummary
}
```

规则：

- 默认每页 240 个交易日，最大 500。
- IPC 以最新数据优先分页，返回给图表前在 renderer 合并并按 `tradingDate` 升序排列。
- cursor 由主进程生成和解析，renderer 不自行计算磁盘位置。
- 请求不存在的档案返回明确的“追踪档案不存在”，不返回伪造的空历史。
- 档案存在但没有指标时返回 `total: 0` 和空 records。

### 5.4 保存请求

```ts
interface ClientStateSaveRequest {
  state: ClientAppState
  trackingHistoryTransfers?: Array<{
    fromQuoteId: string
    toQuoteId: string
  }>
}
```

主进程从当前完整状态重建待保存 `AppState`：

| renderer 摘要变化                       | 主进程指标历史处理                    |
| --------------------------------------- | ------------------------------------- |
| 同一 `quoteId` 的档案仍存在             | 保留当前完整档案的 `metricSnapshots`  |
| 新增一个从未存在的档案                  | 初始化为空数组                        |
| 摘要中移除档案                          | 视为显式删除完整档案                  |
| `trackingHistoryTransfers` 指定 ID 迁移 | 从来源 ID 转移到目标 ID，然后删除来源 |
| 来源不存在、目标冲突或重复转移          | 在写 manifest 前拒绝请求              |

唯一已知的 ID 迁移入口是 `App.applyCorporateAction()` 中证券转换导致的 `quoteId` 变化。该入口必须显式传递 transfer；不能根据名称、代码、更新时间或对象相似度推断。

`metricHistory` 是主进程生成的只读摘要。保存时只接受 profile core 字段，忽略 renderer 回传的 count、日期和 updatedAt，并根据最终保留或转移的真实 `metricSnapshots` 重新计算摘要，不能信任客户端元数据参与持久化。

## 6. 主进程设计

### 6.1 状态投影与重新水合

新增纯函数并集中测试：

```ts
toClientAppState(fullState: AppState): ClientAppState

hydrateClientAppState(
  request: ClientStateSaveRequest,
  currentFullState: AppState
): AppState
```

`toClientAppState` 只投影数据，不修改 full state。`hydrateClientAppState` 必须：

1. 先校验 renderer revision 与当前主进程 revision。
2. 应用显式历史转移。
3. 按 quoteId 合并剩余档案的指标历史，并丢弃 renderer 回传的历史摘要元数据。
4. 对完整结果运行现有 normalize。
5. 调用现有 `StateStore.save()`，继续使用 manifest 原子提交。
6. 返回新的 `ClientAppState`，并广播相同摘要状态。

不要在 preload 或 renderer 中做重新水合；只有主进程持有可信的当前完整历史。

### 6.2 Bootstrap 与广播

调整：

- `BootstrapResult.state`：`AppState` → `ClientAppState`。
- `StockDesktopApi.saveState`：接收 `ClientStateSaveRequest`，返回 `ClientAppState`。
- `onStateUpdated`：广播 `ClientAppState`。
- `electron/main/index.ts` 中主进程 `state` 继续保持完整 `AppState`。
- `WindowManager`、`QuoteRuntime`、交易日历、汇率和其他主进程运行时继续读取完整状态，不为阶段 D 改类型。

背景指标采集保存成功后，主进程只广播重新投影后的摘要。这样 metric history 更新仍会推动 revision 和 `metricHistory` 失效标识变化，但不会复制整个数组。

### 6.3 新增 IPC

建议增加：

```text
StockDesktopApi.getStockTrackingMetricSnapshots
  → stock-tracking:metrics:get
```

参数：`quoteId`、可选 cursor、可选 limit。主进程从完整内存状态读取并分页；本阶段不直接读取物理分片。

需要同步修改：

- `src/shared/types.ts`
- `electron/preload/index.ts`
- `electron/main/ipc-handlers.ts`
- `src/lib/api.ts`
- IPC 白名单与对应静态类型

### 6.4 revision 与并发

- 背景指标采集仍通过完整 `StateStore.save()` 递增全局 revision。
- renderer 使用旧 revision 保存摘要时，继续收到现有冲突错误并重新 Bootstrap。
- 指标页请求本身只读，不要求 renderer revision。
- 指标页响应携带 `metricHistory`；若响应到达时客户端摘要的 `count + updatedAt` 已变化，则丢弃旧响应并重新请求第一页。
- 不新增独立的“指标 revision”持久化字段，避免出现两套提交版本。

## 7. Renderer 设计

### 7.1 全局状态

`App.tsx` 的全局 `state` 改为 `ClientAppState`。除追踪指标历史外，其余计算和组件继续使用现有字段。

以下消费者只需要摘要，无需额外请求：

- 自选表格的追踪状态；
- 收盘扫描、分红融资和基本面榜单的追踪标签；
- 追踪复盘左侧列表、搜索、排序、来源筛选和最近记录；
- 系统“追踪”分组同步；
- 开始、停止和重新追踪的核心档案编辑。

### 7.2 指标历史 Hook

新增类似：

```ts
useStockTrackingMetricSnapshots({
  quoteId,
  enabled,
  historySummary
})
```

状态至少包含：

- `idle`
- `loading`
- `ready`
- `loadingMore`
- `error`

行为：

1. `enabled=false` 时不请求。
2. quoteId 或 `count + updatedAt` 变化时失效。
3. 同一组件生命周期内复用已加载页。
4. 快速切换股票时用请求序号或 `AbortController` 忽略旧响应。
5. 首屏读取最近 240 个交易日。
6. 有 `nextCursor` 时显示“加载更早数据”，不自动拉取全部历史。
7. 卸载详情后允许释放数组；不建立无限增长的全局缓存。

错误态不能伪装成“暂无数据”。加载失败显示重试入口；“没有指标历史”只对应成功响应且 `total === 0`。

### 7.3 组件调整

`StockTrackingEditor` 改为分别接收：

```ts
profile: StockTrackingProfileSummary
metricSnapshots: StockTrackingMetricSnapshot[]
metricHistoryState: ...
```

编辑标签、逻辑和时间线时只提交 `StockTrackingProfileCore`，不再通过对象展开携带指标数组或可写的历史摘要。`startStockTracking`、`stopStockTracking`、标签与时间线辅助函数需要拆出 core 版本或把参数收窄；指标 merge 辅助函数继续只服务完整 profile。

`StockTrackingPanel`：

- 只有个股追踪 Tab 实际挂载且 profile 存在时启用历史请求。
- 指标区显示加载、失败、空数据和加载更早状态。
- 日 K 与实时量比仍沿用现有行情 Hook，不与持久化指标历史混为一体。

`StockTrackingDialog`：

- 左侧列表只用摘要。
- 右侧选中档案后请求该股票指标历史。
- 切换筛选或排序不重新拉取所有股票历史。
- 只对当前选中股票保留加载结果。

所有新增提示、加载和错误文字继续遵守界面文字不得低于 `12px` 的项目规则。

## 8. 主进程后台与 AI

### 8.1 指标采集运行时

本阶段 `StockTrackingMetricsRuntime` 继续读取主进程完整 `AppState`，现有计算与 merge 逻辑不变。唯一输出变化是：

- 保存仍提交完整状态；
- `sendStateUpdated` 改为广播 `toClientAppState(nextState)`；
- renderer 通过摘要中的 `metricHistory` 发现当前详情缓存需要刷新。

这样不会同时改写指标算法和数据加载架构。

### 8.2 AI `research.tracking`

AI 工具运行在主进程，当前已经按照请求对 `sources`、`entries` 和 `metricSnapshots` 分页。本阶段保持返回协议不变，但把实现从直接依赖 renderer 状态的假设明确为读取主进程完整状态。

需要增加回归用例，确认：

- renderer Bootstrap 没有指标数组时，AI 仍能读取完整指标页；
- AI cursor/limit 语义不变；
- AI 工具不会把完整历史提前注入 renderer。

## 9. 导入、导出与 Gist 边界

### 9.1 导出与上传

以下路径继续调用 `StateStore.exportCommittedState()`，因此必须包含完整 `metricSnapshots`：

- 本地“导出用户数据”；
- GitHub Gist 上传；
- 恢复前物理快照。

不能从 `ClientAppState` 生成外部备份。

### 9.2 用户数据恢复

`UserDataBackupService` 和 Gist 下载仍在主进程保存完整待导入 `AppState`。renderer 只需要预览股票数、文件数和 Key 数，不需要接收指标历史。

实施时应把导入预览状态投影为 `ClientAppState`，但 `importId` 对应的主进程待导入文档保持完整。用户确认后继续由 `saveImported()` 写入全部历史并重启。

### 9.3 旧配置导入

当前独立旧配置导入由 renderer 收到完整状态后调用普通 persist。阶段 D 不能再走这个路径，否则会把完整类型重新暴露给 renderer。

建议把旧配置也改成主进程 prepare/apply：

1. 主进程解析并保存完整待导入状态。
2. renderer 只接收 `ClientAppState` 预览与 `importId`。
3. 用户确认后主进程调用 `StateStore.saveImported()`。
4. 是否重启保持当前产品语义，不因协议调整擅自改变。

### 9.4 格式兼容

- `jianzhang-user-data-backup` 继续为 format v1。
- Gist 加密信封继续读取 v1/v2，新上传仍为 v2。
- 本地 manifest 保持当前 format v1。
- 不新增磁盘迁移代码，也不修改现有 `TODO(state-manifest-migration)` 的删除条件。

## 10. 分步实施与提交边界

### D-A：安全投影与重新水合

- 定义 `ClientAppState`、追踪摘要、历史摘要和保存请求类型。
- 实现 `toClientAppState` 与 `hydrateClientAppState` 纯函数。
- 覆盖相同 ID 保留、新建为空、删除、显式转移和 revision 冲突测试。
- 此步不切换 Bootstrap，避免半完成状态进入 renderer。

建议提交：`refactor: 定义追踪历史懒加载状态契约`

### D-B：只读历史 IPC

- 增加指标历史分页类型和主进程 handler。
- 补 preload、桌面 API 和 browser demo API。
- 实现尚未接入界面的 renderer 历史 Hook，并单独覆盖分页、失效和过期响应测试。
- Bootstrap 和现有保存协议暂时不变；新增 API 先保持向后兼容，确保该提交可独立通过静态检查。

建议提交：`feat: 增加追踪指标历史按需读取`

### D-C：Bootstrap、保存与界面原子切换

- Bootstrap、`state:updated` 和 `saveState` 全部切换到摘要状态。
- 主进程保存前重新水合完整指标历史。
- `App.persist` 改为发送 `ClientStateSaveRequest`。
- 公司行动证券转换传递 `trackingHistoryTransfers`。
- 背景指标采集广播摘要，不广播完整历史。
- `StockTrackingEditor` 把 profile summary 与 snapshots 分离。
- 个股追踪 Tab 和追踪复盘右侧详情使用历史 Hook。
- 加入加载、重试、空数据和“加载更早数据”。
- 列表筛选、排序和编辑操作保持摘要路径。
- 导入预览改为摘要，主进程 prepared import 继续保留完整状态。

这一阶段必须作为同一个提交完成，不能只切 Bootstrap、只切保存端或把界面适配留到下一个提交；提交完成时项目必须重新通过 TypeScript 和 ESLint。

建议提交：`refactor: 从应用状态广播移除追踪指标历史`

### D-D：备份、AI 与文档收口

- 验证导出、Gist、AI 工具仍读取完整主进程状态。
- 补齐用户数据恢复、旧配置导入、browser demo 和公司行动迁移的回归用例。
- 清理仅为过渡保留的旧 IPC 类型或适配器。
- 更新 Wiki、上游总方案和本计划状态。

建议提交：`refactor: 收口追踪历史懒加载数据边界`

文档如需独立提交：`docs: 更新追踪历史懒加载说明`

## 11. 测试设计

按照项目规则，实施后默认只做静态检查；以下用例需要补齐代码，但是否实际运行由用户另行授权。

### 11.1 投影与保存

- full state 投影后完全不含 `metricSnapshots`。
- 摘要的 count、首末交易日和 updatedAt 正确。
- 修改主题、列顺序、提醒或持仓后，所有指标历史逐项不变。
- 编辑追踪标签、逻辑和时间线后，同股票指标历史不变。
- 新建追踪档案得到空历史。
- 删除档案会删除该档案及历史。
- 公司行动迁移 quoteId 后，历史完整转移且来源 ID 不残留。
- 缺失、冲突或重复 transfer 在保存前失败。
- 背景指标更新造成 renderer revision 过期时继续拒绝覆盖。

### 11.2 IPC 与界面状态

- Bootstrap 和 `state:updated` 序列化结果不含 `metricSnapshots`。
- 指标页默认、最大 limit、cursor 和排序正确。
- 档案不存在与历史为空是两种不同结果。
- 打开追踪 Tab 才请求；关闭或未选中不请求。
- 快速切换股票不会展示旧请求结果。
- 历史摘要变化后当前详情重新加载。
- 加载失败显示重试，不显示“暂无数据”。
- 加载更早页合并后无重复且保持交易日升序。

### 11.3 备份、恢复与 AI

- 本地导出和 Gist 明文逻辑备份仍包含全部指标历史。
- 本地用户数据恢复后按需 IPC 能读回全部历史。
- 旧配置导入不会经过摘要保存而丢失历史。
- Gist v1/v2 恢复后历史一致。
- AI `research.tracking` 在 renderer 未加载详情时仍能分页读取历史。
- 恢复失败回滚后，指标历史与恢复前逐项一致。

## 12. 静态检查与运行验证

每个实现提交默认执行：

```powershell
npx tsc --noEmit --pretty false
npm run lint
npx prettier --check <本阶段变更文件>
git diff --check
```

默认不执行：

- 单元测试和集成测试；
- Electron 启动或界面验证；
- `npm run build:unpacked`；
- 正式构建、打包或版本号修改。

如果用户明确授权运行验证，再记录：

| 指标                        | 测量方式                                           |
| --------------------------- | -------------------------------------------------- |
| Bootstrap JSON 字节数       | 主进程序列化前统计，不记录正文                     |
| `state:updated` 平均字节数  | 固定操作序列下统计 payload 大小                    |
| 首次打开追踪详情耗时        | 从 IPC 发起到当前股票首屏指标渲染                  |
| 切换股票与加载更早数据耗时  | 分别记录冷请求和同组件生命周期内的复用             |
| renderer heap               | 同一数据、同一窗口和同一操作路径下做前后对比       |
| 主进程启动 I/O 和主进程内存 | 只作为观察项；本阶段预期不会因逻辑懒加载而显著下降 |

验收不能只看文件大小。至少需要确认 Bootstrap 中不再出现指标数组，以及任意非指标保存后磁盘中的完整指标历史仍然一致。

## 13. 发布、回滚与后续门槛

### 13.1 发布与回滚

- 本阶段不改变磁盘 manifest 和外部备份格式，因此代码回滚到阶段 C 不需要数据降级迁移。
- 不加入“同时广播完整和摘要两套状态”的长期兼容逻辑。
- 切换提交前必须保证 Bootstrap、广播、保存和冲突恢复同时使用 `ClientAppState`。
- 正式打包时再按项目版本规则决定版本号；实施计划本身不改版本。

### 13.2 完成标准

满足以下条件才算阶段 D 完成：

1. Bootstrap 和状态广播不含 `metricSnapshots`。
2. renderer 常驻状态类型无法构造或提交指标数组。
3. 两个追踪详情入口都能按需加载、翻页、重试和正确失效。
4. 普通保存、追踪编辑、后台采集和公司行动迁移均不丢历史。
5. 导出、恢复、Gist 和 AI 继续使用完整历史。
6. 相关静态检查通过，实际未执行的测试和运行验证被明确报告。

### 13.3 物理懒加载的独立启动条件

只有在阶段 D 完成并经过用户授权的运行测量后，同时满足以下任一条件，才为“主进程物理懒加载”另立方案：

- `StateStore.load()` 的追踪分片读取或 JSON 解析成为可复现的启动主要瓶颈；
- 主进程常驻指标历史造成可观且持续增长的内存压力；
- 后台采集加载全部停止追踪档案产生可测量的额外成本。

后续物理方案必须单独解决 manifest v2 迁移、指标文档独立引用、延迟 hash 校验、损坏时整体恢复或局部恢复的边界，以及后台采集缓存策略。本计划不预先实现这些机制。
