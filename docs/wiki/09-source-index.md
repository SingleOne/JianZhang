# 源码索引

[Wiki 首页](README.md) · [功能地图](02-feature-map.md) · [开发与发布](07-development-and-release.md)

本页按目录列出当前仓库源码。文件名可直接点击。

## 根目录

| 文件 | 职责 |
| --- | --- |
| [`package.json`](../../package.json) | 版本、依赖、开发/构建/打包脚本和 electron-builder 配置 |
| [`electron.vite.config.ts`](../../electron.vite.config.ts) | main、preload、renderer 三端构建入口 |
| [`tsconfig.json`](../../tsconfig.json) | TypeScript 严格模式和编译范围 |
| [`index.html`](../../index.html) | renderer HTML 入口 |
| [`README.md`](../../README.md) | 用户功能、安装和使用说明 |
| [`AGENTS.md`](../../AGENTS.md) | 项目协作、数量输入、收益配色和版本规则 |
| [`vitest.config.ts`](../../vitest.config.ts) | Vitest 测试范围和环境配置 |
| [`eslint.config.mjs`](../../eslint.config.mjs) | ESLint flat config、TypeScript 和 React Hooks 规则 |
| [`.prettierrc.json`](../../.prettierrc.json) / [`.editorconfig`](../../.editorconfig) | 格式化和编辑器基础约定 |
| [`.gitignore`](../../.gitignore) | 构建、打包和临时目录忽略规则 |

## Electron 主进程

| 文件 | 重点符号 | 职责 |
| --- | --- | --- |
| [`electron/main/index.ts`](../../electron/main/index.ts) | `app.whenReady`、`persistState`、`cleanupBeforeQuit` | Electron 生命周期、核心模块组装、依赖注入和可选模块注册 |
| [`electron/main/state-store.ts`](../../electron/main/state-store.ts) | `StateStore` | 状态规范化/迁移、原子保存、最近备份和损坏配置恢复 |
| [`electron/main/window-manager.ts`](../../electron/main/window-manager.ts) | `WindowManager` | 主窗口、任务栏、托盘菜单与悬浮窗口生命周期 |
| [`electron/main/ipc-handlers.ts`](../../electron/main/ipc-handlers.ts) | `registerIpcHandlers` | 核心 StockDesktopApi IPC 注册和清理 |
| [`electron/main/quote-runtime.ts`](../../electron/main/quote-runtime.ts) | `QuoteRuntime` | 批量报价刷新、板块绑定、提醒判断、盘口大单和窗口广播 |
| [`electron/main/trading-calendar-runtime.ts`](../../electron/main/trading-calendar-runtime.ts) | `TradingCalendarRuntime` | 交易日历启动检查和定时刷新 |
| [`electron/main/market.ts`](../../electron/main/market.ts) | `searchStocks`、`fetchQuotes`、`fetchKline`、`fetchFundsFlow`、`fetchSectorBinding` | 行情请求、主备节点切换、字段转换和请求日志接入 |
| [`electron/main/market-constants.ts`](../../electron/main/market-constants.ts) | `EASTMONEY_FIXED_PARAMS`、`EASTMONEY_FIELDS` | 行情 token、请求头、固定参数、字段列表和异动类型 |
| [`electron/main/quote-refresh-coordinator.ts`](../../electron/main/quote-refresh-coordinator.ts) | `QuoteRefreshCoordinator` | 合并重点/普通/手动刷新范围并保证主行情单队列执行 |
| [`electron/main/sector-market-cache.ts`](../../electron/main/sector-market-cache.ts) | `SectorMarketCache` | 板块绑定持久化、并发补取、失败冷却和 60 秒板块报价缓存 |
| [`electron/main/market-request-logger.ts`](../../electron/main/market-request-logger.ts) | `MarketRequestLogger` | 行情请求/报价轮次 JSONL 日志和启动时 7 天清理 |
| [`electron/main/dividend-financing-service.ts`](../../electron/main/dividend-financing-service.ts) | `DividendFinancingService` | 分红融资用户快照、首次缺失更新、变化报告和过期状态 |
| [`electron/main/fundamental-data-service.ts`](../../electron/main/fundamental-data-service.ts) | `FundamentalDataService` | 基本面用户快照、首次缺失更新、最近一次变化报告、过期状态和四阶段脚本调度 |
| [`electron/main/python-task-queue.ts`](../../electron/main/python-task-queue.ts) | `PythonTaskQueue` | 财务抓取脚本串行、Python/requests 环境检查和进程输出转发 |
| [`electron/main/order-book-hub.ts`](../../electron/main/order-book-hub.ts) | `OrderBookHub` | 统一盘口请求、进行中请求复用、短时缓存和串行错峰 |
| [`electron/main/funds-flow-hub.ts`](../../electron/main/funds-flow-hub.ts) | `FundsFlowHub` | 资金流请求合并、2 分钟/收盘缓存和串行队列 |
| [`electron/main/kline-hub.ts`](../../electron/main/kline-hub.ts) | `KlineHub` | 全周期 K 线请求合并、100 条实时 LRU 和全局串行队列 |
| [`electron/main/chip-distribution-cache.ts`](../../electron/main/chip-distribution-cache.ts) | `ChipDistributionCache` | 按股票读写最后一次筹码分布磁盘缓存 |
| [`electron/main/historical-kline-cache.ts`](../../electron/main/historical-kline-cache.ts) | `HistoricalKlineCache` | 日/周/月 K 持久化、150 条内存 LRU、长短范围合并、失效回退和 90 天清理 |
| [`electron/main/daily-market-scan-service.ts`](../../electron/main/daily-market-scan-service.ts) | `DailyMarketScanService` | 全市场收盘扫描编排、受控并发、进度与最新结果落盘 |
| [`electron/main/trading-calendar.ts`](../../electron/main/trading-calendar.ts) | `fetchSseTradingCalendar` | 解析上交所当年休市安排 |
| [`electron/main/tray-icons.ts`](../../electron/main/tray-icons.ts) | `createAppIcon` | 生成 Electron 托盘/窗口原生图标 |
| [`electron/preload/index.ts`](../../electron/preload/index.ts) | `api`、`subscribe` | 把类型化 `stockApi` 安全暴露给 renderer |

## Renderer 入口

| 文件 | 重点符号 | 职责 |
| --- | --- | --- |
| [`src/main.tsx`](../../src/main.tsx) | `windowMode` | 分流主窗口、任务栏和托盘悬浮模式 |
| [`src/App.tsx`](../../src/App.tsx) | `persist`、`addStock`、`updatePosition`、`updateTTrading` | 主窗口状态和用户操作编排 |
| [`src/styles.css`](../../src/styles.css) | `:root`、`.is-up/.is-down/.is-flat` | 设计变量、reset、应用框架和跨组件共享样式 |
| [`src/components/*.css`](../../src/components/) / [`src/styles/app-feedback.css`](../../src/styles/app-feedback.css) | 组件 class | 设置、主表、弹窗、做 T、详情、任务栏和反馈样式 |
| [`src/vite-env.d.ts`](../../src/vite-env.d.ts) | `Window.stockApi` | renderer 全局 API 类型声明 |

## 共享领域模型

| 文件 | 重点符号 | 职责 |
| --- | --- | --- |
| [`src/shared/types.ts`](../../src/shared/types.ts) | `AppState`、`StockQuote`、`TTradingAccount`、`TTradeRecord`、`StockDesktopApi` | 领域类型、分组/提醒/筹码结构、默认值、状态规范化和旧交易/列迁移 |
| [`src/shared/bollinger.ts`](../../src/shared/bollinger.ts) | `calculateBollingerBands` | 日/周/月图表与市场观察共用的 BOLL(20,2) 滚动计算 |
| [`src/shared/config.ts`](../../src/shared/config.ts) | `createConfigDocument`、`parseConfigDocument` | 配置格式版本、导入验证和兼容 |
| [`src/shared/market-hours.ts`](../../src/shared/market-hours.ts) | `isBeijingAutoRefreshTime` | 北京时间自动刷新窗口 |
| [`src/shared/trading-calendar.ts`](../../src/shared/trading-calendar.ts) | `countAStockTradingDays` | 内置休市范围和交易日计数 |
| [`src/shared/lru-cache.ts`](../../src/shared/lru-cache.ts) | `LruCache` | renderer 与主进程共享的有界最近最少使用缓存 |

## 业务计算与 API

| 文件 | 重点符号 | 职责 |
| --- | --- | --- |
| [`src/lib/api.ts`](../../src/lib/api.ts) | `stockApi`、`demoApi` | 桌面 API 选择、浏览器演示行情和演示存储 |
| [`src/lib/daily-market-scan.ts`](../../src/lib/daily-market-scan.ts) | `createDailyMarketScanRow` | 20 日量价异动和反转信号计算 |
| [`src/lib/fundamentals.ts`](../../src/lib/fundamentals.ts) | `parseFundamentalSnapshot` | 基本面快照格式解析 |
| [`src/lib/dcf-analysis.ts`](../../src/lib/dcf-analysis.ts) | `createDcfAnalysis` | 普通企业简化 DCF、每股估值、现价差异和70%警戒线判断 |
| [`src/lib/fundamental-screening.ts`](../../src/lib/fundamental-screening.ts) | `evaluateFundamentalCompany`、`evaluateFundamentalQuality`、`evaluateFundamentalRisk`、`classifyFundamentalDividendCategory`、`summarizeFundamentalDividendWatchlist`、`createFundamentalPeerComparisonMap`、`createFundamentalChangeReport` | 三项透明硬筛选、六类固定质量标签、六类风险提示、基本面与分红融资互斥分类、主表概览、同行指标排名和默认规则快照变化 |
| [`src/lib/data-snapshot-status.ts`](../../src/lib/data-snapshot-status.ts) | `dividendFinancingStaleReason`、`fundamentalStaleReason` | 两类财务快照的过期判断和完整财年边界 |
| [`src/lib/demo-data.ts`](../../src/lib/demo-data.ts) | `DEMO_STOCKS`、`DEMO_SECTORS`、`DEMO_VALUES` | 浏览器预览固定演示数据 |
| [`src/lib/portfolio.ts`](../../src/lib/portfolio.ts) | `calculatePositionMetrics`、`calculatePortfolioSummary` | 持仓、可用数量、今日收益和组合汇总 |
| [`src/lib/portfolio-quality.ts`](../../src/lib/portfolio-quality.ts) | `calculatePortfolioQualitySummary` | 按持仓市值汇总价值标签、具体风险、行业集中度、未评估与未计价项目 |
| [`src/lib/t-trading.ts`](../../src/lib/t-trading.ts) | `calculateTradeFees`、`calculateTBatchMetrics`、`validateTBatchTrades` | 费用、正反 T、交易重放、持仓和结算计算 |
| [`src/lib/t-alerts.ts`](../../src/lib/t-alerts.ts) | `getTPlanRows`、`applyTAlertTriggersToAccounts`、`applyTFloatingProfitAlert` | 双五档计划、目标价、价格提醒和浮动盈亏提醒状态 |
| [`src/lib/trade-records.ts`](../../src/lib/trade-records.ts) | `getAccountTrades`、`getBatchTrades`、`upsertTradeRecord` | 统一交易流水的查询、排序、写入与批次关联 |
| [`src/lib/stock-alerts.ts`](../../src/lib/stock-alerts.ts) | `applyStockAlertTriggers` | 股价、当日涨幅和持仓收益率阈值提醒 |
| [`src/lib/order-book-alerts.ts`](../../src/lib/order-book-alerts.ts) | `detectFiveLevelLargeOrders` | 活动 T 仓买卖五档异常大单识别 |
| [`src/lib/chip-distribution.ts`](../../src/lib/chip-distribution.ts) | `findChipAutoRange`、`estimateChipHistoryLimit`、`calculateChipDistribution` | 累计换手 100% 自动范围、历史根数估算和筹码分布计算 |
| [`src/lib/format.ts`](../../src/lib/format.ts) | `formatPrice`、`formatProfit`、`formatAmount` | 展示格式化 |

## 主界面组件

| 文件 | 职责 |
| --- | --- |
| [`src/components/AppTitlebar.tsx`](../../src/components/AppTitlebar.tsx) | 品牌标题栏和简易交易状态 |
| [`src/components/SearchBar.tsx`](../../src/components/SearchBar.tsx) | 股票代码/名称搜索和添加 |
| [`src/components/SettingsMenu.tsx`](../../src/components/SettingsMenu.tsx) | 行情、做 T、系统与数据设置 |
| [`src/components/FundamentalScreeningDialog.tsx`](../../src/components/FundamentalScreeningDialog.tsx) | 基本面筛选条件、质量与风险高级筛选、候选公司、五年财务证据和自选联动 |
| [`src/components/DailyMarketScanDialog.tsx`](../../src/components/DailyMarketScanDialog.tsx) | 收盘扫描汇总、信号分类、进度、分页和自选联动 |
| [`src/components/PortfolioQualityDialog.tsx`](../../src/components/PortfolioQualityDialog.tsx) | 全部持仓价值类型、具体风险、行业结构、组合筛选、未计价说明和主表定位 |
| [`src/components/WatchlistTable.tsx`](../../src/components/WatchlistTable.tsx) | 自选主表、排序、列、异动、展开详情和操作入口 |
| [`src/components/watchlist-table/WatchlistRow.tsx`](../../src/components/watchlist-table/WatchlistRow.tsx) | 单股行指标、单元格、提醒、操作和展开详情 |
| [`src/components/watchlist-table/WatchlistFilters.tsx`](../../src/components/watchlist-table/WatchlistFilters.tsx) | 表内搜索、分组/板块筛选和分组管理入口 |
| [`src/components/watchlist-table/FundamentalWatchlistOverview.tsx`](../../src/components/watchlist-table/FundamentalWatchlistOverview.tsx) | 当前列表价值组合、基本面状态、待核构成、风险公司、组合筛选与标签数排序 |
| [`src/components/watchlist-table/columns.ts`](../../src/components/watchlist-table/columns.ts) | 列定义、排序值和渲染模型 |
| [`src/components/watchlist-table/useDragReorder.ts`](../../src/components/watchlist-table/useDragReorder.ts) | 行拖拽重排 hook |
| [`src/components/PositionEditor.tsx`](../../src/components/PositionEditor.tsx) | 持仓编辑、版本快照、统一交易流水分页和行内编辑/删除 |
| [`src/components/WatchlistGroupDialog.tsx`](../../src/components/WatchlistGroupDialog.tsx) | 自定义分组增删改和股票批量归属 |
| [`src/components/TableFilterDropdown.tsx`](../../src/components/TableFilterDropdown.tsx) | 现代化主表分组/板块筛选下拉框 |
| [`src/components/StockAlertDialog.tsx`](../../src/components/StockAlertDialog.tsx) | 单股多条件阈值提醒配置 |
| [`src/components/ConfirmDialog.tsx`](../../src/components/ConfirmDialog.tsx) | 全局应用内确认弹窗 Provider 和 Promise API |

## 行情组件

| 文件 | 职责 |
| --- | --- |
| [`src/components/ExpandedStockDetails.tsx`](../../src/components/ExpandedStockDetails.tsx) | 详情标签、K 线缓存、刷新和概览，以及分红融资、基本面质量与风险证据详情 |
| [`src/components/CandlestickChart.tsx`](../../src/components/CandlestickChart.tsx) | 分时、五日、板块分时和成交量 |
| [`src/components/PeriodKlineChart.tsx`](../../src/components/PeriodKlineChart.tsx) | 日/周/月蜡烛图、BOLL 三轨线/指标栏和增量补历史 |
| [`src/components/ChipDistributionPanel.tsx`](../../src/components/ChipDistributionPanel.tsx) | 日 K 筹码分布统计、图形和缓存保存 |
| [`src/components/OrderBookPanel.tsx`](../../src/components/OrderBookPanel.tsx) | 买卖五档盘口 |
| [`src/components/FundsFlowPanel.tsx`](../../src/components/FundsFlowPanel.tsx) | 资金流刷新触发、renderer 最近结果、摘要和表格 |
| [`src/components/FundsFlowChart.tsx`](../../src/components/FundsFlowChart.tsx) | 主力资金净额曲线 |
| [`src/components/SectorIndexPanel.tsx`](../../src/components/SectorIndexPanel.tsx) | 所属行业板块概览和分时 |

## 做 T 组件

| 文件 | 职责 |
| --- | --- |
| [`src/components/TTradingDrawer.tsx`](../../src/components/TTradingDrawer.tsx) | 做 T 交易、费用、双五档、提醒、结算和历史 |
| [`src/components/TPlanTable.tsx`](../../src/components/TPlanTable.tsx) | 买入/卖出共用五档表 |
| [`src/components/TAlertBadges.tsx`](../../src/components/TAlertBadges.tsx) | 主表和任务栏提醒标识 |
| [`src/components/TFloatingProfitAlertBadge.tsx`](../../src/components/TFloatingProfitAlertBadge.tsx) | T仓浮盈/浮亏金额提醒标识 |
| [`src/components/FiveLevelAlertBadges.tsx`](../../src/components/FiveLevelAlertBadges.tsx) | 活动 T 仓五档异常大单标识 |

## 桌面辅助窗口组件

| 文件 | 职责 |
| --- | --- |
| [`src/components/TaskbarTicker.tsx`](../../src/components/TaskbarTicker.tsx) | Windows 任务栏透明行情条 |
| [`src/components/TrayHoverSummary.tsx`](../../src/components/TrayHoverSummary.tsx) | 托盘悬停收益和 T 仓摘要 |

## 可选模块

| 目录/文件 | 职责 |
| --- | --- |
| [`src/modules/market-insight`](../../src/modules/market-insight/) | 确定性指标、客观事件、公告/要闻、快照和独立调度/存储 |
| [`src/modules/ai`](../../src/modules/ai/) | Provider、加密凭证、会话、`@股票` 上下文、短期行情/长期价值分析和独立 IPC/UI |
| [`src/modules/ai/main/conversations/context-builder.ts`](../../src/modules/ai/main/conversations/context-builder.ts) | 最近消息与多股票快照组装，加入筹码分布缓存 |
| [`src/modules/ai/main/analysis/long-term-context.ts`](../../src/modules/ai/main/analysis/long-term-context.ts) | 组合五年财务、简化 DCF、分红融资、PE/PB历史/行业分位及长期价格强弱，生成长期价值快照指纹 |
| [`src/modules/ai/main/analysis/long-term-interpretation.ts`](../../src/modules/ai/main/analysis/long-term-interpretation.ts) | 校验企业质量、财务安全、当前价格和双结论固定结构 |
| [`src/modules/ai/prompts/long-term-value.ts`](../../src/modules/ai/prompts/long-term-value.ts) | 隔离经营质量、估值与价格时机，并约束 DCF 判读和70%警戒规则的长期价值提示词 |
| [`src/modules/ai/renderer/AiAssistantDrawer.tsx`](../../src/modules/ai/renderer/AiAssistantDrawer.tsx) | 会话管理、流式聊天和 `@自选股` 选择 |
| [`src/modules/market-insight/renderer/InvestmentValueMetrics.tsx`](../../src/modules/market-insight/renderer/InvestmentValueMetrics.tsx) | 市场观察中的 PE/PB历史/行业分位、总市值、流通市值、财务时点和金融行业适用性展示 |
| [`electron/main/valuation-history-service.ts`](../../electron/main/valuation-history-service.ts) | 按股票获取并缓存近五年日度 PE TTM/PB历史序列 |
| [`src/lib/valuation-analysis.ts`](../../src/lib/valuation-analysis.ts) | 计算历史估值分位并组合快照日同行分位 |
| [`src/modules/ai-t-advice`](../../src/modules/ai-t-advice/) | 结构化做 T 参考、确定性事件、校验、应用预览和独立历史 |

## 脚本和历史文档

| 文件 | 职责 |
| --- | --- |
| [`scripts/convert-stock-helper-config.mjs`](../../scripts/convert-stock-helper-config.mjs) | 转换“股票基金助手”配置 |
| [`scripts/generate-icon.mjs`](../../scripts/generate-icon.mjs) | 生成打包图标 |
| [`scripts/generate_dividend_financing_report.py`](../../scripts/generate_dividend_financing_report.py) | 生成 A 股分红融资比研究报告 |
| [`scripts/generate_fundamental_snapshot.py`](../../scripts/generate_fundamental_snapshot.py) | 分四阶段生成五年财务、行业负债分位、净负债及快照日 PE/PB同行分位 |
| [`docs/plan/non-ai-market-insight-implementation-plan.md`](../plan/non-ai-market-insight-implementation-plan.md) | 非 AI 指标、要闻与智能盯盘的历史实施计划 |
| [`docs/plan/ai-module-implementation-plan.md`](../plan/ai-module-implementation-plan.md) | AI 基础模块和独立做 T 参考的历史实施计划 |
| [`docs/wiki/08-ai-extension-points.md`](08-ai-extension-points.md) | 当前市场观察、AI 对话/分析和 AI 做 T 参考模块说明 |
| [`docs/plan/t-trading-alert-implementation-plan.md`](../plan/t-trading-alert-implementation-plan.md) | 双五档提醒的历史设计记录 |

## 测试

| 文件 | 覆盖范围 |
| --- | --- |
| `src/shared/types.test.ts` | 状态规范化、列顺序和历史交易迁移 |
| `electron/main/state-store.test.ts` | 新建、正常读取、迁移、损坏恢复和写入失败 |
| `src/lib/portfolio.test.ts` / `portfolio-quality.test.ts` / `t-trading.test.ts` / `alerts.test.ts` | 持仓收益、质量市值分布、做 T、费用和提醒边界 |
| `src/shared/lru-cache.test.ts` / `electron/main/kline-hub.test.ts` / `historical-kline-cache.test.ts` | LRU 淘汰、K 线请求合并、回退和磁盘清理 |
| `src/components/watchlist-table/columns.test.ts` / `src/lib/format.test.ts` | 表格列模型和统一数值格式化 |

## 高频符号反查

| 要找的逻辑 | 搜索符号 |
| --- | --- |
| 主进程一次完整行情刷新 | `QuoteRuntime.executeRefresh`、`QuoteRefreshCoordinator` |
| 保存并广播整个应用状态 | `state:save`、`StateStore.save`、`sendToWindows` |
| 分时/K 线入口 | `getKline`、`KlineHub`、`fetchKline`、`HistoricalKlineCache` |
| 当前持仓和今日收益 | `calculatePositionMetrics` |
| 账户全部交易 / 某个批次交易 | `getAccountTrades` / `getBatchTrades` |
| 组合收益 | `calculatePortfolioSummary` |
| 持仓质量与风险市值分布 | `calculatePortfolioQualitySummary` |
| 做 T 剩余数量、均价和收益 | `calculateTBatchMetrics` |
| 做 T 交易合法性 | `validateTBatchTrades` |
| 双五档表数据 | `getTPlanRows` |
| 后台触发 T 提醒 | `applyTAlertTriggersToAccounts` |
| 后台触发自定义股价提醒 | `applyStockAlertTriggers` |
| 五档异常大单判断 | `detectFiveLevelLargeOrders` |
| 筹码分布范围和计算 | `findChipAutoRange`、`estimateChipHistoryLimit`、`calculateChipDistribution` |
| AI `@股票` 快照组装 | `getConversationContexts`、`compactMarketSnapshot`、`toProviderMessages` |
| 旧配置兼容 | `parseConfigDocument`、全部 `normalize*` / `migrate*` |
