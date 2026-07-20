# 见涨开发者 Wiki

> 代码基线：`main` 分支，应用版本 `3.7.1`
>
> 整理日期：2026-07-20
>
> 当前实现以代码为准；`docs/t-trading-alert-implementation-plan.md` 是早期设计记录，其中“待实施”等状态描述已经过时。

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
| 后续接入指标、新闻和 AI 分析的代码落点 | [AI 扩展入口（未实现）](08-ai-extension-points.md) |
| 按目录查看每个源码文件的职责 | [源码索引](09-source-index.md) |

## 一句话架构

见涨是一个 Electron + React + TypeScript 的本地 Windows A 股桌面应用：

- Electron 主进程抓取行情、维护权威状态、定时刷新、执行 T 提醒、管理主窗口/任务栏窗口/托盘。
- preload 只暴露类型化的 `window.stockApi`，隔离渲染层与 Node/Electron 能力。
- React 渲染层展示自选、图表、持仓和做 T 界面，通过 IPC 读写状态。
- `src/shared` 保存主进程和渲染层共同使用的数据结构、配置格式、交易时段和交易日历。
- `src/lib` 保存浏览器演示 API、收益计算、做 T 计算和提醒纯函数。

## 仓库结构

```text
JianZhang/
├─ electron/
│  ├─ main/
│  │  ├─ index.ts               # Electron 生命周期、窗口、定时刷新、IPC、状态持久化
│  │  ├─ market.ts              # 东方财富行情、K 线、盘口、异动、资金流、板块
│  │  ├─ trading-calendar.ts    # 上交所休市日抓取
│  │  └─ tray-icons.ts          # 托盘图标
│  └─ preload/index.ts          # window.stockApi 桥接
├─ src/
│  ├─ App.tsx                   # 主窗口状态编排
│  ├─ main.tsx                  # 主窗口/任务栏/托盘悬浮三种渲染入口
│  ├─ components/               # 表格、图表、设置、持仓、做 T 等 UI
│  ├─ lib/                      # API 适配和业务计算
│  ├─ shared/                   # 共享类型、配置、交易时段和日历
│  └─ styles.css                # 全局样式与窗口模式样式
├─ scripts/
│  ├─ convert-stock-helper-config.mjs
│  └─ generate-icon.mjs
├─ docs/
│  ├─ wiki/                     # 本 Wiki
│  └─ t-trading-alert-implementation-plan.md
├─ package.json
└─ electron.vite.config.ts
```

## 最常用的代码入口

| 需求 | 首要文件 | 通常还会涉及 |
| --- | --- | --- |
| 增减自选、持仓、设置字段 | [`src/App.tsx`](../../src/App.tsx) | [`src/shared/types.ts`](../../src/shared/types.ts)、[`electron/main/index.ts`](../../electron/main/index.ts) |
| 修改主表格列 | [`WatchlistTable.tsx`](../../src/components/WatchlistTable.tsx) | 共享列顺序与迁移、[`src/styles.css`](../../src/styles.css) |
| 修改展开行情标签页 | [`ExpandedStockDetails.tsx`](../../src/components/ExpandedStockDetails.tsx) | 图表/面板组件、`StockDesktopApi`、IPC |
| 增加一种行情接口 | [`electron/main/market.ts`](../../electron/main/market.ts) | 共享类型、preload、浏览器演示实现 |
| 修改收益口径 | [`src/lib/portfolio.ts`](../../src/lib/portfolio.ts) | 主表、首页汇总、托盘摘要 |
| 修改做 T 流程 | [`TTradingDrawer.tsx`](../../src/components/TTradingDrawer.tsx) | [`t-trading.ts`](../../src/lib/t-trading.ts)、[`t-alerts.ts`](../../src/lib/t-alerts.ts)、共享类型 |
| 修改后台提醒 | [`src/lib/t-alerts.ts`](../../src/lib/t-alerts.ts) | 主进程、`TAlertBadges.tsx` |
| 修改任务栏/托盘行为 | [`electron/main/index.ts`](../../electron/main/index.ts) | `TaskbarTicker.tsx`、`TrayHoverSummary.tsx` |
| 修改配置兼容 | [`src/shared/config.ts`](../../src/shared/config.ts) | 共享类型中的 normalize/migrate 函数 |

## 当前重要边界

- 行情来自东方财富公开接口，主进程内没有本地行情数据库，最新报价只保存在内存。
- 用户状态保存在 `%APPDATA%\见涨\settings.json`，并可完整导出为 JSON。
- 浏览器模式使用 `src/lib/api.ts` 的演示数据和 `localStorage`，与桌面版网络链路不同。
- 当前没有自动下单、券商连接、新闻抓取、技术指标引擎或 AI 模块。
- 当前没有自动化测试目录；改动应至少按调用链检查共享类型、主进程、preload、浏览器演示实现和 UI 是否同步。
- 股票数量输入统一以 100 股为步长；收益/收益率正红、负绿、零值中性。

## Wiki 维护规则

新增功能时，优先同步：

1. [功能地图](02-feature-map.md)中的功能到文件映射。
2. 涉及的数据链路、状态结构或 IPC 页面。
3. [AI 扩展入口](08-ai-extension-points.md)中已经失效的扩展假设。
4. 本页的仓库结构和快速入口。
