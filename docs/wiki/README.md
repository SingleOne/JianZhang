# 见涨开发者 Wiki

> 代码基线：`main` 分支，应用版本 `4.17.0`
>
> 整理日期：2026-07-31
>
> 当前实现以代码为准；`docs/plan/` 下的文档用于保留设计过程，不代表当前实现状态。

这套 Wiki 面向后续维护和扩展，重点回答三个问题：

1. 某个功能从哪个文件进入？
2. 数据在 Electron 主进程、preload 和 React 渲染层之间如何流动？
3. 修改功能时还需要同步哪些类型、状态、IPC、样式或迁移代码？

## 快速导航

| 想了解什么 | 从这里开始 |
| --- | --- |
| 整体技术结构、启动和刷新流程 | [系统架构](01-architecture.md) |
| 用户功能对应哪些代码 | [功能地图](02-feature-map.md) |
| 东方财富接口、行情字段、缓存和图表 | [行情数据链路](03-market-data.md) |
| 持仓收益、正 T / 反 T、费用、双五档提醒 | [持仓与做 T](04-position-and-t-trading.md) |
| `AppState`、本地 JSON、配置迁移和 IPC | [状态、存储与 IPC](05-state-storage-and-ipc.md) |
| React 组件层级和各组件职责 | [界面与组件](06-ui-components.md) |
| 本地开发、构建、版本和打包约束 | [开发与发布](07-development-and-release.md) |
| 非 AI 指标、要闻和客观观察模块 | [AI 与市场观察模块](08-ai-extension-points.md) |
| AI 聊天、`@股票` 上下文、行情解读和独立做 T 参考 | [AI 与市场观察模块](08-ai-extension-points.md) |
| 历史实施计划 | [`docs/plan`](../plan/) |
| 按目录查看每个源码文件的职责 | [源码索引](09-source-index.md) |

## 一句话架构

见涨是一个 Electron + React + TypeScript 的本地 Windows A 股桌面应用：

- Electron 主进程抓取行情、维护权威状态、定时刷新、执行股价与 T 提醒、管理主窗口/任务栏窗口/托盘。
- preload 只暴露类型化的 `window.stockApi`，隔离渲染层与 Node/Electron 能力。
- React 渲染层展示自选、图表、持仓和做 T 界面，通过 IPC 读写状态。
- `market-insight`、`ai`、`ai-t-advice` 通过独立 IPC、preload 和存储目录提供市场观察、AI 对话/解读与做 T 参考。
- `src/shared` 保存跨进程数据结构、配置格式、交易时段、交易日历和 BOLL 计算；`src/lib` 保存收益、统一交易流水、筹码分布和提醒纯函数。

## 仓库结构

```text
JianZhang/
├─ electron/
│  ├─ main/
│  │  ├─ index.ts               # Electron 生命周期、窗口、定时刷新、IPC、状态持久化
│  │  ├─ market.ts              # 东方财富行情、K 线、盘口、异动、资金流、板块
│  │  ├─ order-book-hub.ts      # 五档盘口请求复用、缓存和串行错峰
│  │  ├─ chip-distribution-cache.ts # 筹码分布磁盘缓存
│  │  ├─ historical-kline-cache.ts # 日/周/月 K 磁盘缓存
│  │  ├─ trading-calendar.ts    # 上交所休市日抓取
│  │  └─ tray-icons.ts          # 托盘图标
│  └─ preload/index.ts          # window.stockApi 桥接
├─ src/
│  ├─ App.tsx                   # 主窗口状态编排
│  ├─ main.tsx                  # 主窗口/任务栏/托盘悬浮三种渲染入口
│  ├─ components/               # 表格、图表、设置、持仓、做 T 等 UI
│  ├─ modules/market-insight/   # 指标、要闻和客观市场观察
│  ├─ modules/ai/               # AI 对话、股票上下文和行情解读
│  ├─ modules/ai-t-advice/      # 可独立剔除的 AI 做 T 参考
│  ├─ lib/                      # API 适配和业务计算
│  ├─ shared/                   # 共享类型、配置、交易时段和日历
│  └─ styles.css                # 全局样式与窗口模式样式
├─ scripts/
│  ├─ convert-stock-helper-config.mjs
│  └─ generate-icon.mjs
├─ docs/
│  ├─ wiki/                     # 本 Wiki
│  └─ plan/                     # 历史设计与实施计划
├─ package.json
└─ electron.vite.config.ts
```

## 最常用的代码入口

| 需求 | 首要文件 | 通常还会涉及 |
| --- | --- | --- |
| 增减自选、持仓、设置字段 | [`src/App.tsx`](../../src/App.tsx) | [`src/shared/types.ts`](../../src/shared/types.ts)、[`electron/main/index.ts`](../../electron/main/index.ts) |
| 修改主表格列 | [`WatchlistTable.tsx`](../../src/components/WatchlistTable.tsx) | 共享列顺序与迁移、[`src/styles.css`](../../src/styles.css) |
| 修改自定义分组或板块筛选 | [`WatchlistTable.tsx`](../../src/components/WatchlistTable.tsx) | `WatchlistGroupDialog.tsx`、`TableFilterDropdown.tsx`、共享状态 |
| 修改展开行情标签页 | [`ExpandedStockDetails.tsx`](../../src/components/ExpandedStockDetails.tsx) | 图表/面板组件、`StockDesktopApi`、IPC |
| 增加一种行情接口 | [`electron/main/market.ts`](../../electron/main/market.ts) | 共享类型、preload、浏览器演示实现 |
| 修改收益口径 | [`src/lib/portfolio.ts`](../../src/lib/portfolio.ts) | 主表、首页汇总、托盘摘要 |
| 修改做 T 或交易流水 | [`TTradingDrawer.tsx`](../../src/components/TTradingDrawer.tsx) | `PositionEditor.tsx`、[`trade-records.ts`](../../src/lib/trade-records.ts)、[`t-trading.ts`](../../src/lib/t-trading.ts)、[`t-alerts.ts`](../../src/lib/t-alerts.ts) |
| 修改后台提醒 | [`src/lib/t-alerts.ts`](../../src/lib/t-alerts.ts) | 主进程、`TAlertBadges.tsx` |
| 修改筹码分布 | [`chip-distribution.ts`](../../src/lib/chip-distribution.ts) | `ChipDistributionPanel.tsx`、`PeriodKlineChart.tsx`、主进程磁盘缓存 |
| 修改 BOLL 指标 | [`bollinger.ts`](../../src/shared/bollinger.ts) | `PeriodKlineChart.tsx`、市场观察波动指标 |
| 修改 AI 对话或 `@股票` | [`AiAssistantDrawer.tsx`](../../src/modules/ai/renderer/AiAssistantDrawer.tsx) | AI service、context builder、独立存储和 IPC |
| 修改任务栏/托盘行为 | [`electron/main/index.ts`](../../electron/main/index.ts) | `TaskbarTicker.tsx`、`TrayHoverSummary.tsx` |
| 修改配置兼容 | [`src/shared/config.ts`](../../src/shared/config.ts) | 共享类型中的 normalize/migrate 函数 |

## 当前重要边界

- 行情来自东方财富公开接口，最新报价只保存在内存；日/周/月 K 会按股票和周期缓存在 `userData/market-cache/klines/`。
- 用户核心状态保存在 Electron `userData/settings.json`（当前安装通常为 `%APPDATA%\jianzhang-stock-desktop\settings.json`），并可完整导出为 JSON。
- `TTradingAccount.tradeRecords` 是底仓和做 T 成交的唯一数据源；活动批次与历史批次不再各自保存流水。首次读取旧结构时会先生成 `settings.pre-unified-trades.json` 备份，再按交易 ID 合并迁移。
- 筹码分布由当前日 K 可视范围内的数据在本地计算，向前取数直到累计换手率达到固定 100%；首批数据不足时按平均换手率估算目标根数后直接补取。最近一次结果单独缓存在 `userData/market-cache/chip-distributions.json`，并加入 AI 分析上下文。
- 浏览器模式使用 `src/lib/api.ts` 的演示数据和 `localStorage`，与桌面版网络链路不同。
- 当前没有自动下单或券商连接；`ai` 支持 OpenAI API、DeepSeek API 和 Codex 账号，聊天会按设置提交最近若干条消息，并允许一条消息快速 `@` 多只自选股。`ai-t-advice` 默认编译但需用户主动启用。
- 当前没有自动化测试目录；改动应至少按调用链检查共享类型、主进程、preload、浏览器演示实现和 UI 是否同步。
- 股票数量输入统一以 100 股为步长；收益/收益率正红、负绿、零值中性。

## 4.2.0–4.17.0 主要变化

| 版本 | 主要变化 |
| --- | --- |
| 4.2–4.3 | 市场观察快照、做 T 状态和指标说明完善 |
| 4.4–4.5 | 股价/涨幅/持仓收益率提醒、五档大单提示、市场资讯分栏和托盘收益汇总 |
| 4.6–4.9 | 做 T 客观事件提取、K 线备用源、AI 分析进度与实时盘口等待、个人自用 AI 做 T |
| 4.10–4.11 | AI 最近结果恢复、统一交易记录展示、股价提醒配色和托盘收益布局优化 |
| 4.12 | 自定义分组与板块组合筛选、现代化筛选下拉框 |
| 4.13 | 筹码分布本地计算/缓存、AI 上下文接入和对话 `@股票` |
| 4.14 | 交易记录行内编辑与删除 |
| 4.15–4.15.1 | 交易流水统一为单一数据源、旧数据自动备份迁移、编辑持仓弹窗加宽 |
| 4.16 | 历史 K 线磁盘缓存、筹码范围按换手率估算补取、主源异常时保留带换手率缓存 |
| 4.17 | 日/周/月 K 叠加 BOLL(20,2) 三轨线、下方指标栏和持久化显示开关 |

## Wiki 维护规则

新增功能时，优先同步：

1. [功能地图](02-feature-map.md)中的功能到文件映射。
2. 涉及的数据链路、状态结构或 IPC 页面。
3. [AI 与市场观察模块](08-ai-extension-points.md)中的模块边界、存储和构建开关。
4. 本页的仓库结构和快速入口。
