# AI 基础模块

本模块提供通用聊天、股票数据按需读取、市场快照解读和要闻参考。它可以只读访问应用中的行情、基本面、持仓、账本、T 计划和追踪记录，绝不写入这些核心数据。

## 安装点

- `electron/main/index.ts`：在 `JIANZHANG_AI_MODULE` 未设为 `0` 时动态注册主进程服务。
- `electron/preload/index.ts`：条件暴露 `window.aiApi`。
- `src/App.tsx`：条件加载 AI 助手抽屉。
- `src/components/ExpandedStockDetails.tsx`：条件加载 AI 分析标签。
- AI 分析拆为“短期行情”和“长期价值”：短期从市场观察快照中只提取日 K 技术/趋势/动量/波动指标、新闻、公告事件和筹码，排除分时、VWAP、开盘区间、盘口、日内资金流与即时相对强弱；长期读取五年财务、用户已保存的管理层讨论/审计意见/重要附注/AI 结论摘要、简化 DCF、分红融资、PE/PB历史及行业分位和长期价格强弱；没有财报总结时直接忽略，不读取 PDF 原文。结果固定输出企业质量、财务安全、当前价格，并把长期价值与当前时机分开评级。DCF 使用应用已计算的同一口径，模型不得自行修改假设或重算；DCF/现价低于70%时必须进入当前价格结论和风险。两类上下文、提示词、缓存和最近结果键互相独立。
- 两类 AI 分析按股票将最近一次完整结果保存在 `cache/latest-interpretations.json`，切换标签或重启应用后自动恢复，重新生成期间仍保留同类型旧结果。旧版 `quoteId` 结果继续作为短期行情读取，长期结果使用 `quoteId:long-term`。
- 对话中 `@股票` 时，DeepSeek 首轮只收到带 `stockRef` 的数据目录。模型选择必要的 `datasetId` 后，主进程才通过 `read_stock_data` 读取对应明细并进行第二轮生成；工具不能访问本条消息未授权的股票。当前仅 DeepSeek 启用该链路，OpenAI Provider 的同协议支持留有代码 TODO，待 DeepSeek 调试稳定后实现。

## 存储与凭证

数据位于 `%APPDATA%\\见涨\\modules\\ai\\`：`settings.json`、加密的 `credentials.bin`、会话索引、按会话拆分的 JSONL 消息和解读缓存。API Key 仅由主进程通过 Electron `safeStorage` 加密保存，渲染层只能读取配置状态和脱敏尾号。

## 构建开关与删除

- `JIANZHANG_AI_MODULE=0`：不注册 IPC、不暴露 API，也不将 renderer 的模块入口加入产物。
- 删除整个 `src/modules/ai/` 后，同时删除主进程、preload、`App.tsx` 和 `ExpandedStockDetails.tsx` 的 AI 条件安装点即可；核心状态、行情刷新、T 提醒和 `market-insight` 不依赖本模块。

`ai-t-advice` 是另一个可删除模块，不由本模块提供交易方向、价格、数量、仓位或 T 计划写入。
