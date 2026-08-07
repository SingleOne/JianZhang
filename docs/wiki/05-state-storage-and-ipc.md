# 状态、存储与 IPC

[Wiki 首页](README.md) · [系统架构](01-architecture.md) · [持仓与做 T](04-position-and-t-trading.md)

## `AppState`

当前持久化根结构定义在 `src/shared/types.ts`：

```ts
interface AppState {
  watchlist: WatchStock[]
  watchlistGroups: WatchlistGroup[]
  settings: AppSettings
  columnOrder: WatchlistColumnId[]
  columnOrderVersion?: number
  tTradingAccounts: TTradingAccounts
}
```

包含：

- 自选顺序、任务栏选择、重点关注。
- 自定义分组及股票的多分组归属。
- 持仓和持仓快照。
- 自定义股价提醒规则与触发状态。
- 刷新、指数、筹码分布开关、做 T、浮动盈亏提醒默认值、系统、交易日历设置。
- 表格列顺序及迁移版本。
- 全部做 T 活动批次、历史元数据和唯一交易流水。

不包含：

- 最新行情。
- 行情、周期 K 线和盘口缓存。
- 筹码分布磁盘缓存和三个可选模块的设置、缓存及历史。
- 当前展开股票。
- 弹窗、加载和错误提示状态。

## 本地存储

桌面版路径：

```text
<Electron userData>\settings.json
```

当前已安装应用通常对应：

```text
%APPDATA%\jianzhang-stock-desktop\settings.json
```

状态文件由 `electron/main/state-store.ts` 的 `StateStore` 统一管理。除正式文件外，同目录还可能包含：

| 文件 | 作用 |
| --- | --- |
| `settings.last-good.json` | 最近一次完整保存的可用备份 |
| `settings.pre-unified-trades.json` | 统一交易流水迁移前的一次性原始备份 |
| `settings.invalid-<时间>.json` | 配置损坏时保留的原文件副本 |

### 加载

`StateStore.load()` 读取 JSON 后依次执行：

1. `normalizeWatchlist`
2. `normalizeWatchlistGroups`
3. `normalizeAppSettings`
4. `migrateWatchlistColumnOrder`
5. `normalizeTTradingAccounts`

列版本落后或交易账户规范化结果变化时，会立即把迁移后的状态写回。若检测到旧 `baseTrades` / `batch.trades`，写回前先把原始完整配置备份为 `settings.pre-unified-trades.json`；已有备份不会被覆盖。

只有 `settings.json` 不存在时才复制 `DEFAULT_STATE` 并保存。文件读取、JSON 解析或迁移失败时：

1. 把原文件保留为 `settings.invalid-<时间>.json`。
2. 尝试加载并规范化 `settings.last-good.json`。
3. 恢复成功后重写正式文件，并在主界面显示一次启动警告。
4. 没有可用备份时抛出明确错误，主进程显示错误框后停止启动，不会用默认自选覆盖用户文件。

### 保存

主进程 `persistState` 调用 `StateStore.save()` 保存完整 `state`。保存先写同路径 `.tmp` 临时文件，再原子重命名替换目标文件；正式文件成功后同步更新 `settings.last-good.json`。常规保存入口是 IPC `state:save`：

1. 接收渲染层的完整 `AppState`。
2. 再次 normalize。
3. 比较新旧状态中会触发主进程副作用的字段。
4. 更新内存并写入文件。
5. 广播 `state:updated`。
6. 更新托盘菜单和任务栏窗口。

可能触发的额外动作：

| 变化 | 副作用 |
| --- | --- |
| 刷新秒数 | 重排统一行情调度器的重点/普通到期时间 |
| 大盘指数选择 | 向统一调度器提交全量报价刷新 |
| 开机启动 | `app.setLoginItemSettings` |
| 自选集合或重点状态 | 交易时段内提交合并刷新；新增股票后台补取板块绑定 |
| 任务栏相关设置 | 重新计算窗口显示和位置 |

## 状态规范化和迁移

`src/shared/types.ts` 中的 normalize/migrate 是当前兼容核心：

| 函数 | 作用 |
| --- | --- |
| `normalizeWatchlist` | 持仓股票强制重点关注、补异动开关、过滤无效快照 |
| `normalizeWatchlistGroups` | 去除无 ID、无名称或重复 ID 的自定义分组 |
| `normalizeMarketIndexIds` | 过滤并按内置顺序返回指数 |
| `normalizeActiveTTradingBatch` | 兼容旧双五档、价格/浮动盈亏提醒开关和反 T 语义 |
| `normalizeTTradingAccounts` | 把旧活动/历史批次流水和 `baseTrades` 按 ID 合并到唯一 `tradeRecords`，再移除旧字段并规范化活动批次 |
| `normalizeWatchlistColumnOrder` | 去重、补缺失列、保证操作列在末尾 |
| `migrateWatchlistColumnOrder` | 按版本插入今日收益、板块、成交等新列，并过滤已经移除的列 |
| `normalizeAppSettings` | 兼容旧刷新字段、限制秒数/位置、补费用、浮动盈亏提醒默认值和日历 |
| `normalizeTradingCalendarSettings` | 校验日期、去重、排序并保证内置覆盖年份 |

新增持久化字段时，不能只改 interface；至少要补默认值和 normalize。

## 配置导入导出

配置文档定义在 `src/shared/config.ts`：

```text
JianzhangConfigDocument
├─ format = "jianzhang-config"
├─ formatVersion = 2
├─ applicationVersion
├─ exportedAt
├─ state
└─ source?
```

当前导入接受格式版本 1 和 2。

### 导出

1. React 把当前 `AppState` 传给 `config:export`。
2. 主进程显示保存对话框。
3. `createConfigDocument` 加入应用版本和导出时间。
4. 写入用户选择的 JSON 文件。

### 导入

1. 主进程显示打开对话框。
2. `parseConfigDocument` 验证格式、版本、自选和设置基本结构。
3. 运行共享 normalize/migrate。
4. 返回给 React，但暂不覆盖现有状态。
5. React 显示确认提示。
6. 用户确认后再走普通 `state:save`。

`scripts/convert-stock-helper-config.mjs` 可将“股票基金助手”的旧配置转换成见涨格式 1，再由当前导入逻辑完成后续迁移。

## 浏览器演示存储

没有 Electron preload 时：

```ts
stockApi = demoApi
```

演示状态保存在：

```text
localStorage["jianzhang-demo-state-v1"]
```

浏览器导入导出使用文件输入框和下载链接，不使用 Electron 对话框。

## 核心外的本地存储

以下数据不会进入 `AppState`，也不会随核心配置导出：

| 路径（相对 `userData`） | 内容 |
| --- | --- |
| `market-cache/klines/*.json` | 按股票和周期保存的日/周/月 K 线 |
| `market-cache/chip-distributions.json` | 每只股票最后一次筹码分布结果 |
| `modules/market-insight/` | 指标/事件快照、公告与要闻缓存、模块设置 |
| `modules/ai/` | Provider 设置、加密凭证、对话 JSONL、股票快照、最近 AI 解读 |
| `modules/ai-t-advice/` | 做 T 参考设置和历史 JSONL |
| `dividend-financing/` | 运行时获取的 `ranking.json`、`previous-ranking.json`、`change-report.json`、Markdown 报告和诊断 JSON |
| `fundamentals/` | 运行时获取的五年基本面 `snapshot.json`、覆盖率诊断 `diagnostics.json` 和最近一次默认规则筛选变化 `change-report.json` |
| `company-reports/*.json` | 按股票保存近十年巨潮定期报告目录和官方 PDF 链接，24 小时有效；不保存 PDF 文件 |
| `daily-market-scan/` | 最近一次全市场收盘扫描结果 `latest.json` |

AI API Key 由主进程使用 Electron `safeStorage` 加密；renderer 只能读取是否配置和脱敏尾号。Codex 账号凭证由随应用运行的官方 App Server 在模块运行目录管理，核心状态和配置导出均不接触明文。

## IPC 请求

类型契约统一定义在 `StockDesktopApi`。

| preload 方法 | IPC channel | 主进程处理 |
| --- | --- | --- |
| `getBootstrap` | `app:bootstrap` | 返回状态、内存报价和数据源 |
| `getTaskbarLayout` | `taskbar:layout:get` | 返回任务栏高度 |
| `searchStocks` | `stocks:search` | 股票联想 |
| `getDividendFinancingSnapshot` | `dividend-financing:get` | 返回进程内缓存的 schema v2 用户快照；本地不存在时返回 `null` |
| `getDividendFinancingState` | `dividend-financing:state:get` | 返回缺失、排队、更新中、有效、过期或失败状态 |
| `getDividendFinancingChangeReport` | `dividend-financing:changes:get` | 返回最近一次手动更新前后的新入榜、移出、排名、比例、分红与融资变化 |
| `runDividendFinancingUpdate` | `dividend-financing:update` | 调用随应用附带的 Python 脚本，保存更新前快照并生成变化报告 |
| `getFundamentalSnapshot` | `fundamentals:get` | 返回进程内缓存的 schema v1/v2/v3/v4/v5 用户快照；本地不存在时返回 `null` |
| `getFundamentalState` | `fundamentals:state:get` | 返回基本面快照状态、报告期、生成时间和过期原因 |
| `getFundamentalChangeReport` | `fundamentals:changes:get` | 返回最近两次快照按默认规则比较的新入选、移出、待核、数据完整性、覆盖和企业口径变化；首次快照返回 `null` |
| `runFundamentalUpdate` | `fundamentals:update` | 调用四阶段 Python 脚本，更新五年财务、行业资产负债分位、净负债、快照日 PE/PB行业分位、总市值和流通市值 |
| `getCompanyReports` | `company-reports:get` | 按股票读取有效缓存或查询巨潮近十年年报、半年报、一季报和三季报目录；可强制更新 |
| `openCompanyReport` | `company-reports:open` | 校验巨潮资讯 HTTPS 链接后用系统浏览器打开原始 PDF |
| `getValuationHistory` | `valuation-history:get` | 按股票返回近五年 PE TTM/PB正值序列，主进程按日缓存供市场观察和长期 AI 计算历史分位 |
| `refreshQuotes` | `quotes:refresh` | 向统一调度器提交手动全量刷新 |
| `getKline` | `kline:get` | 通过 `KlineHub` 获取分时/五日/周期 K，同参数合并并串行请求 |
| `getDailyMarketScanResult` | `daily-market-scan:get` | 返回最近一次落盘的收盘扫描结果；没有结果时返回 `null` |
| `getDailyMarketScanState` | `daily-market-scan:state:get` | 返回扫描阶段、进度和错误状态 |
| `runDailyMarketScan` | `daily-market-scan:run` | 启动全市场报价过滤、日 K 批处理和本地信号计算 |
| `saveChipDistributionCache` | `chip-distribution:cache:save` | 保存股票最后一次筹码分布计算结果 |
| `getOrderBook` | `order-book:get` | 从主进程 `OrderBookHub` 获取五档盘口、缓存状态和刷新错误 |
| `getFundsFlow` | `funds-flow:get` | 通过 `FundsFlowHub` 获取当日资金流 |
| `getSectorIndex` | `sector-index:get` | 所属板块详情 |
| `refreshTradingCalendar` | `trading-calendar:refresh` | 在线刷新当年休市日 |
| `saveState` | `state:save` | 规范化并持久化状态 |
| `exportConfig` | `config:export` | 保存 JSON |
| `importConfig` | `config:import` | 读取并解析 JSON |
| `hideWindow` | `app:hide` | 隐藏主窗口 |
| `quitApp` | `app:quit` | 清理并退出 |

## IPC 事件

主进程通过 `sendToWindows` 同时发送给主窗口、任务栏窗口和托盘悬浮窗口。

| preload 订阅 | 事件 channel | 数据 |
| --- | --- | --- |
| `onQuotesUpdated` | `quotes:updated` | `StockQuote[]` |
| `onDailyMarketScanProgress` | `daily-market-scan:progress` | `DailyMarketScanState` |
| `onStateUpdated` | `state:updated` | `AppState` |
| `onTaskbarLayout` | `taskbar:layout` | `TaskbarLayout` |
| `onSelectStock` | `stock:selected` | `quoteId` |
| `onDataError` | `data:error` | 错误文本 |
| `onDividendFinancingUpdateProgress` | `dividend-financing:update-progress` | Python 脚本当前日志或完成/失败状态 |
| `onDividendFinancingStateUpdated` | `dividend-financing:state-updated` | 分红融资榜快照状态变化 |
| `onFundamentalUpdateProgress` | `fundamentals:update-progress` | 基本面四阶段脚本当前日志或完成/失败状态 |
| `onFundamentalStateUpdated` | `fundamentals:state-updated` | 基本面快照状态变化 |

`stock:selected` 用于从托盘菜单点选股票后，让主窗口定位/展开对应股票。

## 主窗口保存流程

```mermaid
sequenceDiagram
    participant C as React 组件
    participant A as App.persist
    participant P as preload
    participant E as Electron
    participant F as settings.json

    C->>A: nextState
    A->>A: 乐观 setState
    A->>P: saveState(nextState)
    P->>E: state:save
    E->>E: StateStore.normalize + compare
    E->>F: StateStore.save（临时文件原子替换 + 最近备份）
    E-->>P: normalized AppState
    E-->>C: state:updated
    P-->>A: normalized AppState
```

## 敏感数据边界

核心 `AppState` 会：

- 明文写入 `settings.json`。
- 随配置完整导出。
- 广播给三个渲染窗口。

因此 AI API Key 和账号凭证没有放进 `AppState` / `AppSettings`。当前实现遵循：

1. 仅在 Electron 主进程读写秘密。
2. 使用独立、不可导出的模块存储。
3. Windows 下用 Electron `safeStorage` 加密 API Key 后再落盘。
4. 渲染层只拿“是否已配置、提供商、脱敏尾号/账号状态”等非敏感信息。
5. IPC 只提供设置、清除、登录/退出和测试连接动作，不提供读取明文接口。

详见 [AI 与市场观察模块](08-ai-extension-points.md)。

## 新增 IPC 的固定步骤

1. 在 `src/shared/types.ts` 添加输入、输出类型。
2. 扩展 `StockDesktopApi`。
3. 在 `electron/preload/index.ts` 添加 `invoke` 或订阅桥接。
4. 在 `electron/main/ipc-handlers.ts` 扩展依赖并注册 handler；广播来源若属于行情或窗口职责，则修改对应 Runtime/Manager。
5. 在 `src/lib/api.ts` 给 `demoApi` 补等价实现。
6. 在 React 中调用。
7. 如果结果持久化，再补默认值、normalize 和配置兼容。

`market-insight`、`ai`、`ai-t-advice` 的 IPC 不扩展 `StockDesktopApi`；应分别修改模块自己的共享类型、注册函数、preload bridge、renderer API 和浏览器降级入口。
