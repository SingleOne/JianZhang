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
| [`.gitignore`](../../.gitignore) | 构建、打包和临时目录忽略规则 |

## Electron 主进程

| 文件 | 重点符号 | 职责 |
| --- | --- | --- |
| [`electron/main/index.ts`](../../electron/main/index.ts) | `loadState`、`refreshStocks`、`registerIpc`、`createWindow` | 生命周期、窗口、托盘、状态/旧交易迁移、定时刷新、提醒、模块注册和 IPC |
| [`electron/main/market.ts`](../../electron/main/market.ts) | `searchStocks`、`fetchQuotes`、`fetchKline`、`fetchFundsFlow`、`fetchSectorIndex` | 东方财富全部行情访问和转换 |
| [`electron/main/order-book-hub.ts`](../../electron/main/order-book-hub.ts) | `OrderBookHub` | 统一盘口请求、进行中请求复用、短时缓存和串行错峰 |
| [`electron/main/chip-distribution-cache.ts`](../../electron/main/chip-distribution-cache.ts) | `ChipDistributionCache` | 按股票读写最后一次筹码分布磁盘缓存 |
| [`electron/main/trading-calendar.ts`](../../electron/main/trading-calendar.ts) | `fetchSseTradingCalendar` | 解析上交所当年休市安排 |
| [`electron/main/tray-icons.ts`](../../electron/main/tray-icons.ts) | `createAppIcon` | 生成 Electron 托盘/窗口原生图标 |
| [`electron/preload/index.ts`](../../electron/preload/index.ts) | `api`、`subscribe` | 把类型化 `stockApi` 安全暴露给 renderer |

## Renderer 入口

| 文件 | 重点符号 | 职责 |
| --- | --- | --- |
| [`src/main.tsx`](../../src/main.tsx) | `windowMode` | 分流主窗口、任务栏和托盘悬浮模式 |
| [`src/App.tsx`](../../src/App.tsx) | `persist`、`addStock`、`updatePosition`、`updateTTrading` | 主窗口状态和用户操作编排 |
| [`src/styles.css`](../../src/styles.css) | `:root`、`.is-up/.is-down/.is-flat` | 全局设计变量、全部组件和三种窗口样式 |
| [`src/vite-env.d.ts`](../../src/vite-env.d.ts) | `Window.stockApi` | renderer 全局 API 类型声明 |

## 共享领域模型

| 文件 | 重点符号 | 职责 |
| --- | --- | --- |
| [`src/shared/types.ts`](../../src/shared/types.ts) | `AppState`、`StockQuote`、`TTradingAccount`、`TTradeRecord`、`StockDesktopApi` | 领域类型、分组/提醒/筹码结构、默认值、状态规范化和旧交易/列迁移 |
| [`src/shared/config.ts`](../../src/shared/config.ts) | `createConfigDocument`、`parseConfigDocument` | 配置格式版本、导入验证和兼容 |
| [`src/shared/market-hours.ts`](../../src/shared/market-hours.ts) | `isBeijingAutoRefreshTime` | 北京时间自动刷新窗口 |
| [`src/shared/trading-calendar.ts`](../../src/shared/trading-calendar.ts) | `countAStockTradingDays` | 内置休市范围和交易日计数 |

## 业务计算与 API

| 文件 | 重点符号 | 职责 |
| --- | --- | --- |
| [`src/lib/api.ts`](../../src/lib/api.ts) | `stockApi`、`demoApi` | 桌面 API 选择、浏览器演示行情和演示存储 |
| [`src/lib/portfolio.ts`](../../src/lib/portfolio.ts) | `calculatePositionMetrics`、`calculatePortfolioSummary` | 持仓、可用数量、今日收益和组合汇总 |
| [`src/lib/t-trading.ts`](../../src/lib/t-trading.ts) | `calculateTradeFees`、`calculateTBatchMetrics`、`validateTBatchTrades` | 费用、正反 T、交易重放、持仓和结算计算 |
| [`src/lib/t-alerts.ts`](../../src/lib/t-alerts.ts) | `getTPlanRows`、`applyTAlertTriggersToAccounts` | 双五档计划、目标价和提醒状态 |
| [`src/lib/trade-records.ts`](../../src/lib/trade-records.ts) | `getAccountTrades`、`getBatchTrades`、`upsertTradeRecord` | 统一交易流水的查询、排序、写入与批次关联 |
| [`src/lib/stock-alerts.ts`](../../src/lib/stock-alerts.ts) | `applyStockAlertTriggers` | 股价、当日涨幅和持仓收益率阈值提醒 |
| [`src/lib/order-book-alerts.ts`](../../src/lib/order-book-alerts.ts) | `detectFiveLevelLargeOrders` | 活动 T 仓买卖五档异常大单识别 |
| [`src/lib/chip-distribution.ts`](../../src/lib/chip-distribution.ts) | `findChipAutoRange`、`calculateChipDistribution` | 累计换手 100% 自动范围和筹码分布计算 |
| [`src/lib/format.ts`](../../src/lib/format.ts) | `formatPrice`、`formatProfit`、`formatAmount` | 展示格式化 |

## 主界面组件

| 文件 | 职责 |
| --- | --- |
| [`src/components/AppTitlebar.tsx`](../../src/components/AppTitlebar.tsx) | 品牌标题栏和简易交易状态 |
| [`src/components/SearchBar.tsx`](../../src/components/SearchBar.tsx) | 股票代码/名称搜索和添加 |
| [`src/components/SettingsMenu.tsx`](../../src/components/SettingsMenu.tsx) | 行情、做 T、系统与数据设置 |
| [`src/components/WatchlistTable.tsx`](../../src/components/WatchlistTable.tsx) | 自选主表、排序、列、异动、展开详情和操作入口 |
| [`src/components/PositionEditor.tsx`](../../src/components/PositionEditor.tsx) | 持仓编辑、版本快照、统一交易流水分页和行内编辑/删除 |
| [`src/components/WatchlistGroupDialog.tsx`](../../src/components/WatchlistGroupDialog.tsx) | 自定义分组增删改和股票批量归属 |
| [`src/components/TableFilterDropdown.tsx`](../../src/components/TableFilterDropdown.tsx) | 现代化主表分组/板块筛选下拉框 |
| [`src/components/StockAlertDialog.tsx`](../../src/components/StockAlertDialog.tsx) | 单股多条件阈值提醒配置 |

## 行情组件

| 文件 | 职责 |
| --- | --- |
| [`src/components/ExpandedStockDetails.tsx`](../../src/components/ExpandedStockDetails.tsx) | 详情标签、K 线缓存、刷新和概览 |
| [`src/components/CandlestickChart.tsx`](../../src/components/CandlestickChart.tsx) | 分时、五日、板块分时和成交量 |
| [`src/components/PeriodKlineChart.tsx`](../../src/components/PeriodKlineChart.tsx) | 日/周/月蜡烛图和增量补历史 |
| [`src/components/ChipDistributionPanel.tsx`](../../src/components/ChipDistributionPanel.tsx) | 日 K 筹码分布统计、图形和缓存保存 |
| [`src/components/OrderBookPanel.tsx`](../../src/components/OrderBookPanel.tsx) | 买卖五档盘口 |
| [`src/components/FundsFlowPanel.tsx`](../../src/components/FundsFlowPanel.tsx) | 资金流请求、缓存、摘要和表格 |
| [`src/components/FundsFlowChart.tsx`](../../src/components/FundsFlowChart.tsx) | 主力资金净额曲线 |
| [`src/components/SectorIndexPanel.tsx`](../../src/components/SectorIndexPanel.tsx) | 所属行业板块概览和分时 |

## 做 T 组件

| 文件 | 职责 |
| --- | --- |
| [`src/components/TTradingDrawer.tsx`](../../src/components/TTradingDrawer.tsx) | 做 T 交易、费用、双五档、提醒、结算和历史 |
| [`src/components/TPlanTable.tsx`](../../src/components/TPlanTable.tsx) | 买入/卖出共用五档表 |
| [`src/components/TAlertBadges.tsx`](../../src/components/TAlertBadges.tsx) | 主表和任务栏提醒标识 |
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
| [`src/modules/ai`](../../src/modules/ai/) | Provider、加密凭证、会话、`@股票` 上下文、行情解读和独立 IPC/UI |
| [`src/modules/ai/main/conversations/context-builder.ts`](../../src/modules/ai/main/conversations/context-builder.ts) | 最近消息与多股票快照组装，加入筹码分布缓存 |
| [`src/modules/ai/renderer/AiAssistantDrawer.tsx`](../../src/modules/ai/renderer/AiAssistantDrawer.tsx) | 会话管理、流式聊天和 `@自选股` 选择 |
| [`src/modules/ai-t-advice`](../../src/modules/ai-t-advice/) | 结构化做 T 参考、确定性事件、校验、应用预览和独立历史 |

## 脚本和历史文档

| 文件 | 职责 |
| --- | --- |
| [`scripts/convert-stock-helper-config.mjs`](../../scripts/convert-stock-helper-config.mjs) | 转换“股票基金助手”配置 |
| [`scripts/generate-icon.mjs`](../../scripts/generate-icon.mjs) | 生成打包图标 |
| [`scripts/generate_dividend_financing_report.py`](../../scripts/generate_dividend_financing_report.py) | 生成 A 股分红融资比研究报告 |
| [`docs/plan/non-ai-market-insight-implementation-plan.md`](../plan/non-ai-market-insight-implementation-plan.md) | 非 AI 指标、要闻与智能盯盘的历史实施计划 |
| [`docs/plan/ai-module-implementation-plan.md`](../plan/ai-module-implementation-plan.md) | AI 基础模块和独立做 T 参考的历史实施计划 |
| [`docs/wiki/08-ai-extension-points.md`](08-ai-extension-points.md) | 当前市场观察、AI 对话/分析和 AI 做 T 参考模块说明 |
| [`docs/plan/t-trading-alert-implementation-plan.md`](../plan/t-trading-alert-implementation-plan.md) | 双五档提醒的历史设计记录 |

## 高频符号反查

| 要找的逻辑 | 搜索符号 |
| --- | --- |
| 主进程一次完整行情刷新 | `refreshStocks` |
| 保存并广播整个应用状态 | `state:save`、`persistState`、`sendToWindows` |
| 分时/K 线入口 | `fetchKline` |
| 当前持仓和今日收益 | `calculatePositionMetrics` |
| 账户全部交易 / 某个批次交易 | `getAccountTrades` / `getBatchTrades` |
| 组合收益 | `calculatePortfolioSummary` |
| 做 T 剩余数量、均价和收益 | `calculateTBatchMetrics` |
| 做 T 交易合法性 | `validateTBatchTrades` |
| 双五档表数据 | `getTPlanRows` |
| 后台触发 T 提醒 | `applyTAlertTriggersToAccounts` |
| 后台触发自定义股价提醒 | `applyStockAlertTriggers` |
| 五档异常大单判断 | `detectFiveLevelLargeOrders` |
| 筹码分布范围和计算 | `findChipAutoRange`、`calculateChipDistribution` |
| AI `@股票` 快照组装 | `getConversationContexts`、`compactMarketSnapshot`、`toProviderMessages` |
| 旧配置兼容 | `parseConfigDocument`、全部 `normalize*` / `migrate*` |
