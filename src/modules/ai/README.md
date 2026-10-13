# AI 基础模块

本模块提供通用聊天、股票数据按需读取、市场快照解读、要闻参考和券商流水识别。聊天与分析只读访问行情、基本面、持仓、账本、T 计划和追踪记录；券商流水必须先生成可编辑草稿，经用户明确确认后，再由主进程的专用导入事务写入统一账本。

## 安装点

- `electron/main/index.ts`：在 `JIANZHANG_AI_MODULE` 未设为 `0` 时动态注册主进程服务。
- `electron/preload/index.ts`：条件暴露 `window.aiApi`。
- `src/App.tsx`：条件加载 AI 助手抽屉。
- `src/components/ExpandedStockDetails.tsx`：条件加载 AI 分析标签。
- AI 分析拆为“技术面特征”和“基本面透视”：前者从市场观察快照中只提取日 K 技术/趋势/动量/波动指标、新闻、公告事件和筹码，后者读取五年财务、用户已保存的财报 AI 二次总结、DCF、分红融资、PE/PB 历史及行业分位和历史价格统计；没有财报总结时直接忽略，不读取 PDF 原文。输出固定为客观指标、数据证据、规则命中的风险事实和数据边界，不提供未来预测、主观评级、买卖建议或择时判断。
- 页面常驻非持牌证券投资咨询免责声明。两类结果按股票保存在 `cache/latest-interpretations.json`；合规 schema 与提示词版本升级后，旧版含预测/评级结构的结果不再恢复展示，新生成的合规结果仍可在切换标签或重启应用后恢复。
- 当前支持 OpenAI、DeepSeek、智谱 GLM、Kimi、MiniMax、腾讯混元、文心一言、阿里千问、小米 MiMo、Grok、Gemini 和 Anthropic。保存 API Key 前会由主进程向对应 Provider 查询账号可用模型，服务设置中的模型 ID 只能从实时返回的列表中选择。
- 对话中带有当前股票上下文或 `@股票` 时，DeepSeek 默认使用带 `stockRef` 的数据目录；其他 Provider 在开启“联网搜索”后使用同一目录。模型选择必要的 `datasetId` 后，主进程才通过 `read_stock_data` 读取对应明细；工具不能访问本条消息未授权的股票。所有 Provider 均支持受限的连续多轮工具调用。
- 所有 Provider 的消息均可按需开启“联网搜索”。开启后，`search_stock_information` 只检索授权股票的现有官方来源：A 股巨潮资讯、证监会和沪深北交易所，港股 HKEXnews，美股 SEC EDGAR，以及公司行动的官方证据；不接入通用网页、媒体或第三方搜索 API。结果使用消息级唯一的来源编号并随消息保存，可从对话中打开原文。
- “券商导入”支持粘贴文字、TXT、XLSX 和图片，识别已成交买卖、税前现金分红和红利税。TXT/XLSX 在本地读取；图片能力同时按 Provider 适配器和当前模型 ID 判断，不支持图片理解的模型在点击上传、拖入和主进程提交识别前都会被阻止。识别结果会匹配当前自选股票、校验市场数量规则、汇率、重复流水和完整账本回放，并展示导入后的持仓/成本预览；所有选中记录作为一个 revision 原子提交，成交默认作为底仓交易，不自动写入 T 批次。

## 存储与凭证

数据位于 `%APPDATA%\\见涨\\modules\\ai\\`：`settings.json`、加密的 `credentials.bin`、会话索引、按会话拆分的 JSONL 消息和解读缓存。API Key 仅由主进程通过 Electron `safeStorage` 加密保存，渲染层只能读取配置状态和脱敏尾号。

## 构建开关与删除

- `JIANZHANG_AI_MODULE=0`：不注册 IPC、不暴露 API，也不将 renderer 的模块入口加入产物。
- 删除整个 `src/modules/ai/` 后，同时删除主进程、preload、`App.tsx` 和 `ExpandedStockDetails.tsx` 的 AI 条件安装点即可；核心状态、行情刷新、T 提醒和 `market-insight` 不依赖本模块。

`ai-t-advice` 是另一个可删除模块，不由本模块提供交易方向、价格、数量、仓位或 T 计划写入。
