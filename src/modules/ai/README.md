# AI 基础模块

本模块提供通用聊天、市场快照解读和要闻参考。它只读取 `market-insight` 的公开快照，绝不写入核心行情、持仓、T 计划或核心设置。

## 安装点

- `electron/main/index.ts`：在 `JIANZHANG_AI_MODULE` 未设为 `0` 时动态注册主进程服务。
- `electron/preload/index.ts`：条件暴露 `window.aiApi`。
- `src/App.tsx`：条件加载 AI 助手抽屉。
- `src/components/ExpandedStockDetails.tsx`：条件加载 AI 分析标签。

## 存储与凭证

数据位于 `%APPDATA%\\见涨\\modules\\ai\\`：`settings.json`、加密的 `credentials.bin`、会话索引、按会话拆分的 JSONL 消息和解读缓存。API Key 仅由主进程通过 Electron `safeStorage` 加密保存，渲染层只能读取配置状态和脱敏尾号。

OpenAI Codex 账号登录通过随应用携带的官方 `codex app-server` 完成。登录页面在系统浏览器打开，运行时在模块自己的 `codex-runtime` 目录中持有和刷新凭证；见涨代码不读取或复制凭证文件。Codex 对话使用独立空工作目录、只读沙箱、禁止审批和禁用网页搜索/MCP，只消费应用传入的文本与市场快照。

## 构建开关与删除

- `JIANZHANG_AI_MODULE=0`：不注册 IPC、不暴露 API，也不将 renderer 的模块入口加入产物。
- 删除整个 `src/modules/ai/` 后，同时删除主进程、preload、`App.tsx` 和 `ExpandedStockDetails.tsx` 的 AI 条件安装点、根目录的 `@openai/codex` 开发依赖以及构建配置中的 `extraResources` 即可；核心状态、行情刷新、T 提醒和 `market-insight` 不依赖本模块。`JIANZHANG_AI_MODULE=0` 时不会复制 Codex 运行时。

`ai-t-advice` 是另一个可删除模块，不由本模块提供交易方向、价格、数量、仓位或 T 计划写入。
