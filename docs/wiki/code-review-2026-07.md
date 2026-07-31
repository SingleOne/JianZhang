# 见涨代码审查报告

> 审查基线：`main` 分支，应用版本 `4.19.0`
>
> 审查日期：2026-07-20
>
> 审查范围：`electron/`、`src/` 全部 121 个 TypeScript/TSX 源文件

---

## 一、总体评价

见涨的代码质量整体**良好**。架构分层清晰，类型系统覆盖完整，数据迁移和容错机制周到。主要问题集中在：个别文件职责过重、缺少自动化测试、以及少数安全与可维护性隐患。

---

## 二、优点

| 领域 | 评价 |
| --- | --- |
| 架构分层 | Electron 主进程/preload/React 渲染层严格隔离，`window.stockApi` 桥接设计干净 |
| 类型安全 | `types.ts` 823 行覆盖全部数据结构，每个子结构都有对应的 `normalize*` 函数保证输入合法性 |
| 构建时模块开关 | `__JIANZHANG_*_ENABLED__` 让 AI/市场观察/做T参考模块可以独立剔除，分享构建不含 AI |
| 数据兼容迁移 | `normalizeTTradingAccounts` 等函数处理旧结构并自动备份 (`settings.pre-unified-trades.json`) |
| 行情容错 | 东方财富主节点 → 镜像节点 → 腾讯 → 新浪三级备用，K 线有磁盘缓存 fallback |
| 刷新协调 | `QuoteRefreshCoordinator` 单队列合并重点/普通/指数/板块请求，避免并发冲突 |
| 状态管理 | 统一 `persist` + `normalize` 闭环，主进程 `state:save` 同时归一化、差异检测、触发刷新 |

---

## 三、问题与建议

### 3.1 高优先级

#### 3.1.1 无自动化测试

**位置：** 全项目

**问题：** 当前没有任何测试目录或测试文件。`types.ts` 中 823 行类型定义包含大量归一化、迁移和兼容性逻辑（如 `normalizeTTradingAccounts`、`migrateWatchlistColumnOrder`），`portfolio.ts` 的收益计算也直接影响用户财务数据展示。

**建议：**
- 引入 `vitest`（与 vite 构建链无缝）
- 优先为 `src/shared/types.ts` 的 normalize/migrate 函数和 `src/lib/portfolio.ts` 的收益计算编写单元测试
- 后续为 `t-alerts.ts`、`t-trading.ts`、`stock-alerts.ts` 等纯函数模块补测试

---

#### 3.1.2 主进程入口文件过重

**位置：** `electron/main/index.ts`（1097 行）

**问题：** 该文件同时承担：
- 窗口生命周期管理（主窗口、任务栏窗口、托盘悬浮窗口）
- 状态加载/持久化/迁移
- 行情刷新编排
- IPC 注册
- 托盘菜单
- 交易日历
- AI/market-insight 模块初始化

**建议：** 拆分为独立模块：
- `window-manager.ts`：三个窗口的创建/定位/销毁
- `state-persistence.ts`：`loadState`/`persistState`/迁移逻辑
- `tray-manager.ts`：托盘图标、菜单和悬浮窗口
- `ipc-handlers.ts`：`registerIpc` 内的所有 handler

---

#### 3.1.3 全局样式文件过大

**位置：** `src/styles.css`（7597 行）

**问题：** 单一 CSS 文件，随功能增长已难以维护。不同组件的样式规则混杂，搜索和修改成本高。

**建议：**
- 将各组件样式拆分到对应组件旁边的 `.css` 文件（如 `WatchlistTable.css`）
- 在 `styles.css` 中只保留 CSS 变量、全局 reset 和跨组件共享样式
- 或使用 CSS Modules（Vite 原生支持 `*.module.css`）

---

### 3.2 中优先级

#### 3.2.1 API 搜索令牌硬编码

**位置：** `electron/main/market.ts` 第 18 行

```ts
const SEARCH_TOKEN = 'D43BF722C8E33A67B1BDCC6FDED9C901'
```

**问题：** 东方财富接口的搜索令牌直接写在源码中。虽然是公开接口的固定 token，但放在代码中不利于后续更换，也可能随接口变更失效。

**建议：** 将此类常量集中到 `electron/main/market-constants.ts` 或 `.env` 配置中，方便维护。

---

#### 3.2.2 K 线缓存无上限增长

**位置：** `src/components/ExpandedStockDetails.tsx` 第 41 行

```ts
const klineCache = new Map<string, KlineCacheEntry>()
```

**问题：** 模块级 `Map` 在应用生命周期内只增不减。用户反复查看不同股票的 K 线后，缓存会持续增长。

**建议：**
- 添加 LRU 策略，限制缓存条目数（如最多 50 条）
- 或在组件卸载/股票切换时清理不需要的条目
- 或在 `stock` prop 变化时清理上一只股票的缓存

---

#### 3.2.3 `formatPrice` / `formatPercent` / `formatProfit` 重复定义

**位置：** `electron/main/index.ts` 第 239–252 行 与 `src/lib/format.ts`

**问题：** 主进程和渲染层各有一套格式化函数，逻辑相同但维护时需同步修改。

**建议：** 将纯函数提取到 `src/shared/` 下的共享模块（如 `shared/format.ts`），两端共同引用。

---

#### 3.2.4 缺少 ESLint / Prettier 配置

**位置：** 项目根目录

**问题：** 没有 `.eslintrc`、`eslint.config.*`、`.prettierrc` 或 `.editorconfig`。代码风格依赖开发者个人习惯。

**建议：**
- 添加 `eslint.config.js`（flat config）+ `typescript-eslint`
- 添加 `.prettierrc` 与项目现有风格对齐（2 空格缩进、单引号、无分号）
- 添加 `.editorconfig` 保证跨编辑器一致性

---

#### 3.2.5 `window.confirm` 使用

**位置：** `src/App.tsx` 第 294 行

```ts
const confirmed = window.confirm(
  `导入后将用文件中的 ${result.state.watchlist.length} 只股票和全部设置覆盖当前配置，是否继续？`
)
```

**问题：** Electron 桌面应用中使用浏览器原生 `confirm` 对话框，体验不统一且无法自定义样式。

**建议：** 实现一个应用内的确认对话框组件，与整体 UI 风格保持一致。

---

#### 3.2.6 `WatchlistTable.tsx` 组件过重

**位置：** `src/components/WatchlistTable.tsx`（1251 行）

**问题：** 单文件承载了表格渲染、行拖拽、列排序、展开详情、持仓编辑、做T抽屉、提醒对话框、分组筛选等全部逻辑。

**建议：**
- 将行渲染提取为 `WatchlistRow.tsx`
- 将拖拽逻辑提取为自定义 hook `useDragReorder`
- 将列定义和渲染提取为独立模块

---

### 3.3 低优先级

#### 3.3.1 package.json `author` 字段

**位置：** `package.json`

```json
"author": "Codex"
```

**建议：** 修改为实际开发者名称。

---

#### 3.3.2 Demo 数据硬编码块过大

**位置：** `src/lib/api.ts` 第 74–145 行

**问题：** `DEMO_VALUES` 约 70 行硬编码的演示行情数据，影响文件可读性。

**建议：** 将演示数据移到独立的 `src/lib/demo-data.ts` 文件。

---

#### 3.3.3 搜索无防抖

**位置：** `src/components/SearchBar.tsx`

**建议：** 如果搜索触发远程请求，应添加 `debounce`（200–300ms）。当前搜索是本地 demo 数据时不影响，但桌面版每次搜索都会调用东方财富接口。

---

#### 3.3.4 托盘悬浮窗口 `setIgnoreMouseEvents(true)` 后无法交互

**位置：** `electron/main/index.ts` 第 437 行

```ts
window.setIgnoreMouseEvents(true)
```

**问题：** 托盘悬浮窗口设置了鼠标穿透，意味着用户无法点击其中的内容。这可能是有意设计（纯展示），但应确认是否满足需求。

---

## 四、安全审查

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| contextIsolation | ✅ | 所有窗口均启用 `contextIsolation: true` |
| sandbox | ✅ | 渲染窗口启用 `sandbox: true` |
| nodeIntegration | ✅ | 所有窗口 `nodeIntegration: false` |
| preload 桥接 | ✅ | 使用 `contextBridge.exposeInMainWorld` 类型化暴露 API |
| 外部请求 | ⚠️ | 东方财富接口使用硬编码 token，无鉴权机制 |
| 用户数据 | ⚠️ | `settings.json` 明文保存，无加密（本地桌面应用可接受） |

---

## 五、性能审查

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| 行情刷新合并 | ✅ | `QuoteRefreshCoordinator` 单队列去重 |
| React memo 使用 | ⚠️ | `WatchlistTable` 未使用 `React.memo`，每次状态变化都会整体重渲染 |
| K 线缓存 | ⚠️ | 模块级 `Map` 无上限，可能内存泄漏 |
| CSS 变量体系 | ✅ | 全局使用 CSS 变量，避免重复计算 |
| Lazy loading | ✅ | 图表、AI 面板等重组件使用 `lazy` + `Suspense` |
| useMemo/useCallback | ✅ | App.tsx 中适当使用了 memo 和 callback |

---

## 六、总结

### 快速行动项

1. **[高]** 引入 vitest，先覆盖 `types.ts` normalize 和 `portfolio.ts` 计算
2. **[高]** 拆分 `electron/main/index.ts` 到多个职责模块
3. **[中]** 给 K 线缓存加 LRU 上限
4. **[中]** 提取共享 format 函数到 `src/shared/`
5. **[中]** 添加 ESLint + Prettier + EditorConfig
6. **[低]** 搜索加 debounce
7. **[低]** 修改 `package.json` author

### 长期建议

- 逐步将 `styles.css` 拆分为组件级样式
- 将 `WatchlistTable` 分解为更小的组件
- 考虑为主进程关键路径添加集成测试
- 随着功能增长，考虑引入状态管理库（zustand 等）替代 App.tsx 中大量的 `useState` + `useCallback`
