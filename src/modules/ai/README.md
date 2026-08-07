# AI 基础模块

本模块提供通用聊天、市场快照解读和要闻参考。它只读取 `market-insight` 的公开快照，绝不写入核心行情、持仓、T 计划或核心设置。

## 安装点

- `electron/main/index.ts`：在 `JIANZHANG_AI_MODULE` 未设为 `0` 时动态注册主进程服务。
- `electron/preload/index.ts`：条件暴露 `window.aiApi`。
- `src/App.tsx`：条件加载 AI 助手抽屉。
- `src/components/ExpandedStockDetails.tsx`：条件加载 AI 分析标签。
- AI 分析拆为“短期行情”和“长期价值”：短期只读取市场观察快照，长期读取五年财务、用户已保存的管理层讨论/审计意见/重要附注/AI 结论摘要、简化 DCF、分红融资、PE/PB历史及行业分位和长期价格强弱；没有财报总结时直接忽略，不读取 PDF 原文。结果固定输出企业质量、财务安全、当前价格，并把长期价值与当前时机分开评级。DCF 使用应用已计算的同一口径，模型不得自行修改假设或重算；DCF/现价低于70%时必须进入当前价格结论和风险。两类上下文、提示词、缓存和最近结果键互相独立。
- 两类 AI 分析按股票将最近一次完整结果保存在 `cache/latest-interpretations.json`，切换标签或重启应用后自动恢复，重新生成期间仍保留同类型旧结果。旧版 `quoteId` 结果继续作为短期行情读取，长期结果使用 `quoteId:long-term`。

## 存储与凭证

数据位于 `%APPDATA%\\见涨\\modules\\ai\\`：`settings.json`、加密的 `credentials.bin`、会话索引、按会话拆分的 JSONL 消息和解读缓存。API Key 仅由主进程通过 Electron `safeStorage` 加密保存，渲染层只能读取配置状态和脱敏尾号。

OpenAI Codex 账号登录通过随应用携带的官方 `codex app-server` 完成。登录页面在系统浏览器打开，运行时在模块自己的 `codex-runtime` 目录中持有和刷新凭证；见涨代码不读取或复制凭证文件。Codex 对话使用独立空工作目录、只读沙箱、禁止审批和禁用网页搜索/MCP，只消费应用传入的文本与市场快照。

## 构建开关与删除

- `JIANZHANG_AI_MODULE=0`：不注册 IPC、不暴露 API，也不将 renderer 的模块入口加入产物。
- 删除整个 `src/modules/ai/` 后，同时删除主进程、preload、`App.tsx` 和 `ExpandedStockDetails.tsx` 的 AI 条件安装点、根目录的 `@openai/codex` 开发依赖以及构建配置中的 `extraResources` 即可；核心状态、行情刷新、T 提醒和 `market-insight` 不依赖本模块。`JIANZHANG_AI_MODULE=0` 时不会复制 Codex 运行时。

`ai-t-advice` 是另一个可删除模块，不由本模块提供交易方向、价格、数量、仓位或 T 计划写入。
