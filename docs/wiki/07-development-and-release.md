# 开发与发布

[Wiki 首页](README.md) · [系统架构](01-architecture.md) · [状态与 IPC](05-state-storage-and-ipc.md)

## 技术栈

| 类别     | 当前方案                       |
| -------- | ------------------------------ |
| 桌面壳   | Electron 43                    |
| 前端     | React 19                       |
| 语言     | TypeScript 5.9，`strict: true` |
| 构建     | Vite 7 + electron-vite 5       |
| 图表     | Lightweight Charts 5           |
| 图标     | Lucide React                   |
| 桌面打包 | electron-builder 26            |
| Node.js  | README 要求 20+                |

当前应用版本从 `package.json` 读取，并在主窗口状态栏展示。

## 常用命令

```powershell
npm install
npm run dev
npm run dev:web
npm test
npm run lint
npm run format:check
npm run build
npm run build:unpacked
npm run package:win
npm run package:portable
npm run package:mac
npm run package:mac:local
npm run package:mac:dist
```

| 命令               | 作用                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------- |
| `dev`              | 启动 electron-vite，运行真实 Electron/IPC/主进程行情                                   |
| `dev:web`          | 只启动 Vite，使用 `src/lib/api.ts` 的浏览器演示 API                                    |
| `test`             | 使用 Vitest 运行单元测试                                                               |
| `test:watch`       | 以监听模式运行 Vitest                                                                  |
| `lint`             | 检查 Electron、renderer、共享代码和构建配置                                            |
| `format:check`     | 用 Prettier 检查代码格式；当前仍会列出尚未批量格式化的历史文件                         |
| `build`            | 先 `tsc --noEmit`，再构建 main/preload/renderer                                        |
| `build:unpacked`   | 完成类型检查、生产构建和图标生成，并更新 `release/win-unpacked` 开发预览，不生成安装包 |
| `generate:icon`    | 生成白底、红底和黑底三套图标，Windows 为 256px、macOS 为 1024px                        |
| `package:win`      | build + icon + NSIS x64 安装包                                                         |
| `package:portable` | build + icon + Windows portable 包                                                     |
| `package:mac`      | 本机 macOS 打包的默认别名，同 `package:mac:local`                                      |
| `package:mac:local` | build + icon + 当前架构 DMG，使用 ad-hoc 签名，无联网时间戳和公证                     |
| `package:mac:dist` | build + icon + x64/arm64 DMG，要求 Developer ID Application 签名和 Apple 公证          |

Windows portable 产物命名为 `见涨-portable-<版本>-<架构>.exe`，例如 `见涨-portable-18.0.5-x64.exe`。

应用图标默认使用白底红箭头。通过编译环境变量可统一切换 exe、主窗体和托盘图标：

```powershell
$env:JIANZHANG_ICON_VARIANT = 'black'
npm run build:unpacked
Remove-Item Env:JIANZHANG_ICON_VARIANT
```

| 参数            | 生成文件               | 配色       |
| --------------- | ---------------------- | ---------- |
| `white`（默认） | `build/icon-white.png` | 白底红箭头 |
| `red`           | `build/icon.png`       | 红底白箭头 |
| `black`         | `build/icon-black.png` | 黑底红箭头 |

三个版本的 PNG 都会由 `generate:icon` 保留在 `build/`。macOS 另生成 `icon-white-mac.png`、`icon-mac.png` 和 `icon-black-mac.png`，沿用同一个 `JIANZHANG_ICON_VARIANT` 配色选项。

### macOS 打包

本机运行在 macOS 上执行：

```sh
npm run package:mac:local
# package:mac 是相同命令的别名
npm run package:mac
# 可选：指定另一种架构
npm run package:mac:local -- --x64
```

命令自动执行类型检查、main/preload/renderer 生产构建和图标生成，再通过 `electron-builder.config.cjs`
中的本机模式打包。默认只生成当前 Mac 架构，产物为
`release/mac-local/见涨-<版本>-mac-<架构>-local.dmg`。
本机模式固定使用 ad-hoc 签名，关闭 Hardened Runtime、联网时间戳和公证；
忽略并移除传给打包子进程的 `CSC_NAME`、`CSC_LINK`、证书密码等签名凭据，
避免自动选择旧的 Apple Development 证书或导入分发证书。

对外分发使用：

```sh
# 先在钥匙串中安装有效的 Developer ID Application 证书及私钥。
# 交互式保存公证凭据，密码由 notarytool 在终端提示输入，不写入项目。
xcrun notarytool store-credentials jianzhang-dist
export APPLE_KEYCHAIN_PROFILE=jianzhang-dist
npm run package:mac:dist
```

分发模式默认生成两个镜像，位于 `release/mac-dist/`：

- `见涨-<版本>-mac-x64.dmg`：Intel Mac。
- `见涨-<版本>-mac-arm64.dmg`：Apple Silicon Mac。

分发模式启用 Hardened Runtime、联网时间戳与公证。只接受 Developer ID Application，
不会把 Apple Development 当作可分发证书。多个分发证书可用 `CSC_NAME` 指定名称或 SHA-1 指纹；
CI 也可使用 `CSC_LINK` / `CSC_KEY_PASSWORD` 导入证书，导入后仍会再次检查所选证书类型。
公证也支持完整的 `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`，
或 `APPLE_API_KEY` / `APPLE_API_KEY_ID` / `APPLE_API_ISSUER` 环境变量。
这几种凭据使用 electron-builder 的优先次序；不要混用不完整的凭据组。
没有有效分发证书或完整公证凭据会直接报错；公证失败则打包失败。

两种模式的输出目录分开，均不自动上传发布。需要其他架构时在命令末尾加 `-- --arm64`、
`-- --x64` 或 `-- --universal`，显式指定时不再额外生成默认架构。

macOS 打包入口会将 npm 已解析的重复依赖引用降为调试日志；设置 `DEBUG=electron-builder` 可查看，未解析引用和依赖缺失仍保留警告。

在 macOS 27 及以上，入口通过 `diskutil image` 创建、挂载和压缩 APFS 镜像，通过 `diskutil eject` 卸载，避免调用已弃用的 `hdiutil`；仍使用 electron-builder 自带的 dmgbuild 运行时生成背景、应用图标位置和 `/Applications` 快捷入口，无需另外安装 Python 包。旧版 macOS 保留原有 DMG 流程。显式设置 `CUSTOM_DMGBUILD_PATH` 时使用指定工具。

DMG 制作使用 macOS 的系统工具，需在 Mac 上运行。仓库不内置证书、密码或公证凭据。
本机模式的实际安装和界面兼容性仍需人工确认；分发模式还需在具备 Developer ID Application
与公证凭据的环境中完成完整流程及安装验证。

打包路线与签名边界可用 `node --test scripts/mac-package-options.test.cjs` 校验，无需真实证书。
20.0.1 已通过 14 项测试、生产构建、lint 和 Luna 静态复核；实际生成并挂载 arm64 本机 DMG，
验证 ad-hoc 签名、Finder 布局及包内 Electron 无界面运行。当前机器没有 Developer ID Application，
已验证分发命令明确报错，尚未执行完整分发签名与公证。

## 构建输出

| 目录       | 内容                                                                       | Git  |
| ---------- | -------------------------------------------------------------------------- | ---- |
| `out/`     | electron-vite 构建结果                                                     | 忽略 |
| `build/`   | 动态生成图标等资源                                                         | 忽略 |
| `release/` | electron-builder 安装包、portable 包、macOS DMG 和 `win-unpacked` 开发预览 | 忽略 |
| `outputs/` | 其他交付输出                                                               | 忽略 |

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

| 能力                     | Electron `npm run dev` | Web `npm run dev:web` |
| ------------------------ | ---------------------- | --------------------- |
| 东方财富真实行情         | 是                     | 否，演示数据          |
| Electron IPC             | 是                     | 否                    |
| 本地文件 `settings.json` | 是                     | 否，`localStorage`    |
| 原生导入导出对话框       | 是                     | 否，浏览器文件控件    |
| 任务栏透明窗口           | 是                     | 否                    |
| 托盘                     | 是                     | 否                    |
| 上交所日历刷新           | 是                     | 否                    |

纯 UI 调整可先看 web 预览；窗口、IPC、定时刷新、托盘和真实行情问题必须在 Electron 模式判断。

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

以当前 `5.0.1` 为例：

| 变更                       | 建议版本               |
| -------------------------- | ---------------------- |
| 小修复、样式微调、文档修正 | `5.0.2`                |
| 新增一个小功能             | `5.1.0`                |
| 新增独立功能模块           | 先确认是否升级 `6.0.0` |

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
    COMMIT --> PACKAGE["执行 package:win / portable / mac"]
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
- 配置导入验证。

## 当前验证能力

当前已配置：

- Vitest 单元测试，覆盖状态规范化/迁移、配置存储恢复、持仓与做 T 计算、提醒状态机、LRU/K 线缓存、主表列和格式化函数。
- ESLint flat config、TypeScript ESLint 和 React Hooks 检查。
- Prettier 配置与 `.editorconfig`；历史文件尚未一次性全量格式化，避免制造大规模无关差异。
- `npm run build` 的 TypeScript 无输出检查和 main/preload/renderer 生产构建。

常规完整检查：

```powershell
npm test
npm run lint
npm run build
```

当前尚未配置 React 组件测试和端到端测试。需要同时更新可运行预览时使用：

```powershell
npm run build:unpacked
```

涉及窗口和外部行情的行为仍需在 Electron 运行态检查，但除非用户直接要求，功能完成后不主动进行界面验证。

## 文档状态

`docs/plan/` 保存 AI、市场观察和双五档提醒的历史设计过程。维护时：

- 业务真相以 `types.ts`、`t-alerts.ts`、`TTradingDrawer.tsx` 和主进程刷新链路为准。
- 历史计划可用于理解设计缘由，不应再按其中的“待实施”清单判断现状。
