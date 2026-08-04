# 功能地图

[Wiki 首页](README.md) · [系统架构](01-architecture.md) · [界面与组件](06-ui-components.md)

本页按用户可见功能反查代码。查问题时先找到功能入口，再沿“组件 → 业务函数 → IPC → 主进程数据源”向下追。

## 功能到代码

| 功能 | 界面入口 | 核心逻辑 | 主进程/数据 |
| --- | --- | --- | --- |
| 搜索并添加自选 | `SearchBar.tsx`、`App.tsx` | `stockApi.searchStocks`、`App.addStock` | `market.ts#searchStocks` |
| 分红融资回报分析 | `DividendFinancingRankingDialog.tsx`、`WatchlistRow.tsx`、`ExpandedStockDetails.tsx` | 净回报/规模/连续性/评分筛选，评分拆解，年度分红和融资时间线，快照变化报告，对数散点选股，自选联动 | `DividendFinancingService` + schema v2 内置/用户快照 + `createDividendFinancingChangeReport` |
| 删除、拖拽、置顶、排序、调整列 | `WatchlistTable.tsx` | `normalizeWatchlistColumnOrder`、`migrateWatchlistColumnOrder` | `state:save` |
| 自定义分组与板块组合筛选 | `WatchlistTable.tsx`、`WatchlistGroupDialog.tsx`、`TableFilterDropdown.tsx` | `WatchlistGroup`、`WatchStock.groupIds` | 分组随 `AppState` 保存；板块筛选使用实时报价 |
| 重点关注 | `WatchlistTable.tsx` | 有持仓时自动锁定重点；`App.togglePriority` | `QuoteRefreshCoordinator` 统一调度重点/普通范围 |
| 大盘指数卡片 | `App.tsx`、`SettingsMenu.tsx` | `MARKET_INDEX_OPTIONS`、`getMarketIndexStocks` | 和普通报价一起刷新 |
| 最新价、涨跌、成交等主表行情 | `WatchlistTable.tsx` | `StockQuote`、格式化函数 | `fetchQuotes` |
| 持仓编辑和快照对比 | `PositionEditor.tsx` | `StockPosition`、`StockPositionSnapshot` | 随 `AppState` 保存 |
| 持仓天数 | `WatchlistTable.tsx` | `getPositionHoldingDays` | 内置/在线交易日历 |
| 今日收益和持仓收益 | `App.tsx`、`WatchlistTable.tsx` | `calculatePositionMetrics`、`calculatePortfolioSummary` | 报价 + 持仓 + 当日交易 |
| 分时、五日、日/周/月 K | `ExpandedStockDetails.tsx` | `CandlestickChart`、`PeriodKlineChart` | `fetchKline` |
| 日 K 筹码分布 | `ChipDistributionPanel.tsx`、`PeriodKlineChart.tsx` | `calculateChipDistribution`、100% 累计换手范围 | 日 K 数据 + `HistoricalKlineCache` + `ChipDistributionCache` |
| 五档盘口 | `OrderBookPanel.tsx` | 买卖盘显示与定时刷新 | `fetchOrderBook` |
| 资金流向 | `FundsFlowPanel.tsx`、`FundsFlowChart.tsx` | 当日累计净额展示 | `fetchFundsFlow` |
| 所属行业板块 | `SectorIndexPanel.tsx` | 板块概览和分时、60 秒刷新 | `SectorMarketCache` + 统一报价调度 |
| 盘口异动提示 | `WatchlistTable.tsx` | 当日提示和近 5 日弹层 | `market.ts` 雷达缓存与抓取 |
| 股价/涨幅/持仓收益率提醒 | `StockAlertDialog.tsx`、`WatchlistTable.tsx` | `applyStockAlertTriggers` | 行情刷新后判断、系统通知 |
| 活动 T 仓五档大单提示 | `FiveLevelAlertBadges.tsx` | `detectFiveLevelLargeOrders` | `OrderBookHub` 轮询活动 T 股票 |
| 正 T / 反 T 账本 | `TTradingDrawer.tsx` | `t-trading.ts` | 随 `AppState` 保存 |
| 统一交易流水、行内编辑和删除 | `PositionEditor.tsx` | `trade-records.ts`、交易重放校验 | `TTradingAccount.tradeRecords` |
| 买卖双五档计划 | `TTradingDrawer.tsx`、`TPlanTable.tsx` | `getTPlanRows`、计划重排/重置 | 当前活动批次 |
| T 价格提醒 | `TAlertBadges.tsx` | `t-alerts.ts` 状态机 | 行情刷新后在主进程判断 |
| T仓浮动盈亏提醒 | `TFloatingProfitAlertBadge.tsx`、交易管理 | `applyTFloatingProfitAlert` | 达到 ±金额阈值后系统通知并同步窗口 |
| 任务栏行情条 | `TaskbarTicker.tsx` | 订阅报价、状态和布局 | 主进程定位透明窗口 |
| 托盘悬浮摘要 | `TrayHoverSummary.tsx` | 今日收益和 T 仓摘要 | 主进程控制悬停窗口 |
| 设置 | `SettingsMenu.tsx` | 行情、做 T、系统与数据三页 | `state:save` |
| 配置导入导出 | `App.tsx` | `shared/config.ts` | 原生文件对话框 |
| 交易日历 | `SettingsMenu.tsx` | `countAStockTradingDays` | `fetchSseTradingCalendar` |
| 市场观察 | `MarketInsightPanel.tsx` | 确定性指标、公告/要闻、客观事件 | 独立 `market-insight` 模块 |
| AI 对话与 `@股票` | `AiAssistantDrawer.tsx` | 最近消息上下文、按股票快照引用 | 独立 `ai` 模块和存储 |
| AI 行情解读与做 T 参考 | `AiAnalysisPanel.tsx`、`TAdvicePanel.tsx` | Provider、结构化校验、应用预览 | `ai` / `ai-t-advice` 模块 |
| 浏览器演示模式 | 全部 React 组件 | `src/lib/api.ts` | 演示数据 + `localStorage` |

## 自选股

### 数据结构

`WatchStock` 保存：

- 股票代码、名称、东方财富 `quoteId`、市场标签。
- 是否显示在任务栏。
- 是否重点关注。
- 是否抓取异动。
- 当前持仓和持仓快照。
- 自定义股价提醒规则。
- 所属自定义分组 ID；一只股票可以进入多个分组。

### 调用链

```text
SearchBar
  → stockApi.searchStocks
  → IPC stocks:search
  → market.searchStocks
  → App.addStock
  → App.persist
  → IPC state:save
```

### 排序和列顺序

- 手动顺序就是 `AppState.watchlist` 数组顺序。
- 临时列头排序只存在于 `WatchlistTable` 组件状态，不持久化。
- 拖拽或置顶会修改 `watchlist` 并保存。
- 可调整列顺序保存在 `AppState.columnOrder`。
- 自定义分组与板块筛选只影响当前主表展示，不改变自选顺序、行情刷新范围或持仓数据；两个条件按“且”组合。
- 自定义分组保存在 `AppState.watchlistGroups`，板块筛选来自 `StockQuote.sector`，不会额外写入状态。
- 新增主表列时必须升级 `WATCHLIST_COLUMN_ORDER_VERSION` 并补迁移，不能直接重置用户顺序。
- “排序”“设置”是左侧固定区，删除按钮在末列；`operation` 始终被 normalize 到最后。

## 持仓与收益

持仓入口在主表每行的铅笔按钮。

`PositionEditor` 支持：

- 数量、成本、建仓日期。
- 是否显示异动。
- 保存多个持仓版本快照并对比当前市值、收益和收益差。
- 查看同一账户的全部底仓与做 T 流水，并在表格中行内编辑或删除。

自 4.15.0 起，`TTradingAccount.tradeRecords` 是全部成交的唯一数据源。批次只保存方向、开仓快照、五档计划和结算元数据；各模块通过 `getAccountTrades` / `getBatchTrades` 查询需要的流水。

收益统一由 `src/lib/portfolio.ts` 计算：

- 今日收益会结合昨收、当前市值、当日买卖、费用和当日建仓状态。
- 持仓收益按当前价格与持仓成本计算。
- 组合汇总按成本基数加权，而不是简单平均单只股票收益率。
- 当日买入数量会从可用数量中扣除，体现 A 股 T+1 可卖限制。

详细口径见[持仓与做 T](04-position-and-t-trading.md)。

## 行情详情

点击主表股票行后，`ExpandedStockDetails` 展开以下标签；可选模块被构建剔除时，对应标签不会出现：

1. 分时
2. 资金流向
3. 市场观察
4. AI 分析
5. AI 做 T 参考
6. 五日、日 K、周 K、月 K
7. 板块

分时页同时展示五档盘口。日/周/月 K 在主图叠加本地计算的 BOLL(20,2) 上轨、中轨和下轨，下方指标栏显示十字光标所在周期的三轨价格并提供持久化开关。日 K 可通过设置开关显示筹码分布，计算范围从当前可视 K 线最右端向前累计换手率到 100%。首批日 K 不足时根据现有平均换手率估算目标根数并直接补取；普通历史 K 线缩放到左端时仍按倍数补取更早数据。

详细链路见[行情数据链路](03-market-data.md)。

## 盘口异动

当前支持的信号定义位于 `electron/main/market-constants.ts` 的 `RADAR_LABELS`，包括：

- 涨跌停封板/开板。
- 大买盘、大卖盘、大笔买卖。
- 火箭发射、快速反弹、高台跳水、加速下跌。
- 竞价涨跌、相对 5 日线高低开、缺口。
- 60 日新高/新低和大幅涨跌。

主表只在“今日有异动”时显示提示；点击后查看近 5 日归一化信号。同一天同一信号类型只保留时间较新的记录。

## 自定义提醒

每只股票可以配置多条规则，指标支持股价、当日涨幅和持仓收益率，比较方向支持“达到或高于”和“达到或低于”。主进程在报价合并后判断：

- 条件由不满足变为满足时，规则进入 `triggered` 并弹出一次系统通知。
- 条件重新不满足时自动恢复 `armed`，以后再次越过阈值可重新提醒。
- 已选入任务栏的股票会按上穿/下穿方向显示提醒颜色。

五档大单提示与上述规则不同：只针对存在活动 T 批次的重点股票轮询盘口；当买盘或卖盘某一档数量大于同侧其余四档之和时显示对应档位徽标。

## 做 T

每只股票拥有独立 `TTradingAccount`：

- 最多一个活动批次。
- 多个已结算历史批次。
- 一份包含底仓与所有 T 批次成交的统一 `tradeRecords`。

活动批次可为正 T 或反 T，保存、编辑或删除交易后都会重放校验并更新账本和股票持仓。T 仓归零后进入结算，最终收益可按券商持仓成本校准。

价格提醒在 Electron 主进程执行，因此主窗口隐藏后仍然有效。触发股票会临时进入任务栏窗口。

详细流程见[持仓与做 T](04-position-and-t-trading.md)。

## 设置

`SettingsMenu` 分为三个标签：

| 标签 | 内容 |
| --- | --- |
| 行情 | 重点/普通刷新间隔、大盘指数选择 |
| 做 T | 佣金和各项费用、买入/卖出五档默认涨跌幅与数量 |
| 系统与数据 | 任务栏开关和位置、开机启动、关闭驻留、交易日历、配置导入导出 |

设置在界面修改后立即调用 `App.persist`。主进程会根据变化选择是否重排统一行情调度、提交全量刷新、更新开机启动或同步窗口。

筹码分布开关位于日 K 图表标题区，不在设置弹窗中；其值仍写入 `AppSettings.showChipDistribution`，因此切换股票或重启应用后会保留。

## 任务栏和托盘

任务栏展示股票集合是：

```text
用户勾选 showInTaskbar 的股票
∪
当前存在 triggered T 提醒的股票
```

托盘右键菜单展示同一集合，并附最新价、涨跌幅和带正负号的今日收益。鼠标悬停托盘 1 秒后显示今日收益合计，以及每只股票的今日收益、持仓市值、持仓收益、正/反 T 剩余数量、均价和浮动收益。

## 按修改场景查找

### 新增一列

1. `src/shared/types.ts`：列 ID、默认顺序、版本和迁移。
2. `watchlist-table/columns.ts`：列元信息和排序值；`WatchlistRow.tsx`：单元格。
3. `WatchlistTable.css`：宽度、固定列和响应布局。
4. 如数据缺失，再扩展 `StockQuote` 和行情接口。

### 新增详情标签页

1. `ExpandedStockDetails.tsx`：标签、懒加载、缓存和错误态。
2. `src/shared/types.ts`：数据类型和 `StockDesktopApi`。
3. `electron/main/ipc-handlers.ts`：IPC。
4. `electron/preload/index.ts`：桥接。
5. `electron/main/market.ts`：真实数据。
6. `src/lib/api.ts`：浏览器演示数据。

### 新增持久化设置

1. `AppSettings` 和默认值。
2. `normalizeAppSettings`。
3. `SettingsMenu`。
4. `App.updateSettings`。
5. `state:save` 中需要响应设置变化的主进程副作用。
