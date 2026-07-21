# AI 做 T 参考模块

独立的 AI 做 T 参考模块。基础 AI 启用时默认编译进应用；显式设置 `JIANZHANG_AI_T_ADVICE_MODULE=0` 可将它从产物中剔除。构建进应用不代表运行时自动开启，用户仍需在模块界面主动启用。

## 功能

- 用户主动触发后，读取 `MarketInsightSnapshot`、当前行情、持仓和活动 T 批次的只读摘要。
- 复用基础 AI 模块当前选中的 Provider、模型和认证，不自行保存任何密钥。
- 生成结构化的观望、正 T 或反 T 参考，并在主进程校验价格、持仓上限和 100 股整数倍。
- 独立保存生成历史、忽略和应用状态。
- 应用前生成 10 分钟有效的一次性预览；确认时只接受预览 ID，并重新核对活动批次。
- 只修改活动批次的买入或卖出 T1 计划，不创建交易、不自动下单。

## 边界

- 类型、提示词、校验、存储、IPC 和 UI 全部位于 `src/modules/ai-t-advice/`。
- 本模块单向调用基础 AI 的内部结构化任务能力；基础 AI 不导入本模块。
- 不向 `AppState`、`AppSettings` 或核心配置文件增加 AI 专有字段。
- 本地数据位于 `%APPDATA%\见涨\modules\ai-t-advice\`，包含 `settings.json` 和 `advice-history.jsonl`。

## 安装点

- `electron.vite.config.ts`：计算 `__JIANZHANG_AI_T_ADVICE_MODULE_ENABLED__`。
- `electron/main/index.ts`：条件动态注册主进程服务，并传入只读上下文与受控账户保存函数。
- `electron/preload/index.ts`：条件挂载 `window.aiTAdviceApi`。
- `src/components/ExpandedStockDetails.tsx`：条件动态加载做 T 参考卡片。
- `src/vite-env.d.ts`：声明构建常量。

## 开发与构建

```powershell
npm run dev
npm run build
npm run build:unpacked
```

以上默认构建均包含本模块。原有 `npm run dev:ai-t` 和 `npm run build:ai-t` 作为兼容脚本继续可用。

## 单独移除

构建前设置 `JIANZHANG_AI_T_ADVICE_MODULE=0`，即可从 main、preload 和 renderer 产物中剔除。源码级删除时，删除本目录及上述四个薄安装点和构建常量即可；基础 AI 对话、快照解读、市场观察、持仓和手工做 T 均不依赖本模块。
