# 开发与发布

[Wiki 首页](README.md) · [系统架构](01-architecture.md) · [状态与 IPC](05-state-storage-and-ipc.md)

## 技术栈

| 类别 | 当前方案 |
| --- | --- |
| 桌面壳 | Electron 43 |
| 前端 | React 19 |
| 语言 | TypeScript 5.9，`strict: true` |
| 构建 | Vite 7 + electron-vite 5 |
| 图表 | Lightweight Charts 5 |
| 图标 | Lucide React |
| Windows 打包 | electron-builder 26 |
| Node.js | README 要求 20+ |

当前应用版本从 `package.json` 读取，并在主窗口状态栏展示。

## 常用命令

```powershell
npm install
npm run dev
npm run dev:web
npm run build
npm run build:unpacked
npm run package:win
npm run package:portable
```

| 命令 | 作用 |
| --- | --- |
| `dev` | 启动 electron-vite，运行真实 Electron/IPC/主进程行情 |
| `dev:web` | 只启动 Vite，使用 `src/lib/api.ts` 的浏览器演示 API |
| `build` | 先 `tsc --noEmit`，再构建 main/preload/renderer |
| `build:unpacked` | 完成类型检查、生产构建和图标生成，并更新 `release/win-unpacked` 开发预览，不生成安装包 |
| `generate:icon` | 生成 `build/icon.png` |
| `package:win` | build + icon + NSIS x64 安装包 |
| `package:portable` | build + icon + Windows portable 包 |

## 构建输出

| 目录 | 内容 | Git |
| --- | --- | --- |
| `out/` | electron-vite 构建结果 | 忽略 |
| `build/` | 动态生成图标等资源 | 忽略 |
| `release/` | electron-builder 安装包、portable 包和 `win-unpacked` 开发预览 | 忽略 |
| `outputs/` | 其他交付输出 | 忽略 |

主进程入口：

```text
electron/main/index.ts → out/main/index.js
```

preload 和 renderer 入口由 `electron.vite.config.ts` 指定。

## 浏览器预览与桌面版差异

`stockApi` 选择逻辑：

```ts
export const stockApi = window.stockApi ?? demoApi
```

| 能力 | Electron `npm run dev` | Web `npm run dev:web` |
| --- | --- | --- |
| 东方财富真实行情 | 是 | 否，演示数据 |
| Electron IPC | 是 | 否 |
| 本地文件 `settings.json` | 是 | 否，`localStorage` |
| 原生导入导出对话框 | 是 | 否，浏览器文件控件 |
| 任务栏透明窗口 | 是 | 否 |
| 托盘 | 是 | 否 |
| 上交所日历刷新 | 是 | 否 |

纯 UI 调整可先看 web 预览；窗口、IPC、定时刷新、托盘和真实行情问题必须在 Electron 模式判断。

## 配置转换脚本

把“股票基金助手”配置转换成见涨配置：

```powershell
node scripts/convert-stock-helper-config.mjs <原配置.json> <见涨配置.json>
```

脚本只转换沪 A、深 A、科创板条目，并把不兼容条目写入导出文档的 `source.skippedStocks`。

## 项目协作约束

来自仓库根目录 `AGENTS.md`：

1. 不要过度进行防御性编程。
2. 所有界面文字不得低于 `12px`。
3. 所有股票数量数字输入框统一 `step="100"`。
4. 收益/收益率：正数红色、负数绿色、零值中性色。
5. 功能完成后不主动做界面验证，除非用户直接要求；可以执行 `npm run build:unpacked` 作为完成检查和开发预览。
6. `build:unpacked` 不属于正式打包，不触发版本号和打包前提交规则。
7. 每次正式打包前先提交代码，提交信息按实际变更填写。
8. 小修小改升级补丁版本；新增小功能升级次版本并把补丁归零。
9. 检测到新功能模块时，正式打包前先提醒是否升级大版本。

## 版本规则

以当前 `4.17.0` 为例：

| 变更 | 建议版本 |
| --- | --- |
| 小修复、样式微调、文档修正 | `4.17.1` |
| 新增一个小功能 | `4.18.0` |
| 新增独立功能模块 | 先确认是否升级 `5.0.0` |

版本至少同步：

- `package.json`
- `package-lock.json`
- README 安装包示例（如果仍写死版本）

## 打包前流程

```mermaid
flowchart LR
    CHANGE["完成变更"] --> VERSION["按规则确定并更新版本"]
    VERSION --> STATUS["检查 git status/diff"]
    STATUS --> COMMIT["提交功能和目标版本"]
    COMMIT --> PACKAGE["执行 package:win / portable"]
    PACKAGE --> ARTIFACT["检查 release 产物"]
```

仓库规则明确要求“每次打包前进行代码提交”。目标版本号也应在执行打包前进入提交历史。

`npm run build:unpacked` 仅更新可直接运行的开发预览，不执行上述版本与提交步骤。


## 常见修改同步清单

### 改共享类型

- 主进程是否正常编译。
- preload 的 `StockDesktopApi` 是否匹配。
- 浏览器 `demoApi` 是否补齐。
- 旧 `settings.json` 和配置导入是否能 normalize。

### 改主表列

- `WatchlistColumnId`
- 默认顺序
- 列顺序版本
- 迁移函数
- 列元信息、排序值、渲染
- 样式最小宽度

### 改行情接口

- `market.ts` 返回值。
- 共享类型。
- IPC handler。
- preload。
- demo 数据。
- 旧数据和错误态是否保留。

### 改做 T

- 正 T / 反 T 都检查。
- 交易编辑、删除后的重放。
- 普通持仓同步。
- 双五档和提醒状态。
- 结算和历史。
- 配置导入兼容。

## 当前验证能力

`package.json` 暂无独立的：

- 单元测试。
- 组件测试。
- ESLint。
- 端到端测试。

现有静态验证入口是：

```powershell
npm run build
```

它会先执行 TypeScript 无输出类型检查。需要同时更新可运行预览时使用：

```powershell
npm run build:unpacked
```

涉及窗口和外部行情的行为仍需在 Electron 运行态检查，但除非用户直接要求，功能完成后不主动进行界面验证。

## 文档状态

`docs/plan/` 保存 AI、市场观察和双五档提醒的历史设计过程。维护时：

- 业务真相以 `types.ts`、`t-alerts.ts`、`TTradingDrawer.tsx` 和主进程刷新链路为准。
- 历史计划可用于理解设计缘由，不应再按其中的“待实施”清单判断现状。
