# AI 基础模块

本模块提供通用聊天、股票数据按需读取、市场快照解读、要闻参考和券商流水识别。聊天与分析只读访问行情、基本面、持仓、账本、T 计划和追踪记录；券商流水必须先生成可编辑草稿，经用户明确确认后，再由主进程的专用导入事务写入统一账本。

## 安装点

- `electron/main/index.ts`：在 `JIANZHANG_AI_MODULE` 未设为 `0` 时动态注册主进程服务。
- `electron/preload/index.ts`：条件暴露 `window.aiApi`。
- `src/App.tsx`：条件加载 AI 助手抽屉。
- `src/components/ExpandedStockDetails.tsx`：条件加载 AI 分析标签。
- AI 分析拆为“近期动能分析”和“基本面透视”：前者只向模型发送历史日 K 技术/趋势/动量/波动指标与筹码计算结果，不发送新闻、公告或盘中数据，并由程序固定追加技术指标滞后性提示；后者读取五年财务、用户已保存的财报 AI 二次总结、分红融资、PE/PB 历史、行业分位和历史价格统计，DCF 标准句由后端直接使用严格模型的实际参数与区间生成，禁止模型输出单点或区间数值。两类输出均经过程序校验，不提供未来预测、主观评级、买卖建议或择时判断。
- 页面常驻非持牌证券投资咨询免责声明。两类结果按股票保存在 `cache/latest-interpretations.json`；合规 schema 与提示词版本升级后，旧版含预测/评级结构的结果不再恢复展示，新生成的合规结果仍可在切换标签或重启应用后恢复。
- 当前支持 OpenAI、DeepSeek、智谱 GLM、Kimi、MiniMax、腾讯混元、文心一言、阿里千问、小米 MiMo、Grok、Gemini 和 Anthropic。保存 API Key 前会由主进程向对应 Provider 查询账号可用模型，服务设置中的模型 ID 只能从实时返回的列表中选择。
- 对话中带有当前股票上下文或 `@股票` 时，DeepSeek 默认使用带 `stockRef` 的数据目录；其他 Provider 在开启“联网搜索”后使用同一目录。模型选择必要的 `datasetId` 后，主进程才通过 `read_stock_data` 读取对应明细；工具不能访问本条消息未授权的股票。所有 Provider 均支持受限的连续多轮工具调用。
- 普通回答使用中文业务名称说明数据来源、日期和缺失情况，内部数据集标识与字段路径仅用于取数；用户主动询问接口或调试细节时可以展示。股票取数结果附带中文 `datasetLabel`。
- 所有聊天 Provider 均支持 `read_pdf_document`，在有股票上下文、搜索、近期用户 HTTPS 链接或已有 PDF 引用时提供该工具；直接粘贴现有官方来源白名单内的 HTTPS 公告 PDF 链接即可读取，不依赖 DeepSeek Key 或网页搜索开关。主进程使用已有 `pdf-parse` 提取文字并附上物理页码，生成轻量 Markdown；单个 PDF 最多 32 MB、提取文本最多 200 万字符，解析结果在 `cache/pdf-documents/` 缓存 24 小时。每次最多提供 12,000 字符，支持 `keyword` 定位和 `cursor` 续读。来源保留实际传入模型片段的摘要与位置并随消息保存，界面标记为“PDF 正文”。扫描页、未提取页及复杂表格限制会明确返回，不提供 OCR 或表格结构恢复，也不会将片段冒充全文。
- 每条用户消息允许最多 8 轮、每轮最多 8 次、累计最多 32 次应用工具调用，下一条消息重新计数；服务商原生搜索内部的执行次数不由此计数器控制。超过单轮或累计额度的调用会收到明确的未执行结果，随后关闭工具入口，让模型依据已取得的资料完成回答；轮数耗尽时同样进入最终回答，不再因调用额度直接报错。
- 搜索仍使用同一个开关。当前 Provider 为 Kimi、MiniMax 或 Grok 且已配置其 Key 时，显示“网页搜索”并使用该厂家的搜索服务；其他 Provider 配置 DeepSeek Key 后使用 DeepSeek 搜索。没有可用网页搜索 Key 时，同一入口显示原有“联网搜索”，`search_stock_information` 只检索授权股票的现有官方来源：A 股巨潮资讯、证监会和沪深北交易所，港股 HKEXnews，美股 SEC EDGAR，以及公司行动的官方证据；该能力不依赖 DeepSeek Key。
- Kimi 开启网页搜索后使用国内 `/v1/responses` 和原生 `web_search`，推荐 Kimi K3；普通聊天仍使用 Chat Completions。工具续轮原样回传全部 output（包括 reasoning），不使用 Kimi 不支持的 `previous_response_id`。Grok 改用 `/v1/responses`，开启网页搜索时添加原生 `web_search`，自定义工具续轮通过 `previous_response_id` 连接。两家均复用各自模型 Key 和平台额度，不调用 DeepSeek 搜索；保留股票数据与记忆工具的受限多轮调用。
- MiniMax 保留 Chat Completions，通过 `search_web` 调用官方 MCP 同源的 `/v1/coding_plan/search`（`q` 参数），使用当前 MiniMax Key。该搜索要求具有搜索权限的订阅 Key（M Plan/Token Plan），普通按量 Key 不保证可用，配置提示和搜索失败信息会说明权限要求；不自动切换其他付费搜索。只提供搜索摘要，不提供全文抓取；最多返回 10 条，每条摘要最多 2,000 字符，支持停止和 30 秒超时。
- DeepSeek 接入保持不变：`search_web` 使用 Search API（默认 5 条摘要），`fetch_webpage` 使用 Fetch API，主进程每次请求前单独读取 DeepSeek 密钥。普通对话无需关联股票；带股票上下文时还可使用现有官方信息工具。搜索与抓取按成功请求独立计费，复用现有每轮及整轮工具调用次数限制，单页正文最多提供 12,000 字符，并向模型标明截断状态。
- 官方信息与网页结果都使用消息级唯一引用编号，引用来源随消息保存并用于重试、导出和重启后的展示。原生服务端搜索的 URL 注解转换为应用引用；只返回命中 URL 时，在回答后列出“搜索来源”，标记为“服务端搜索来源”，不伪造摘要、正文或原文证据。其他网页来源区分搜索摘要与抓取正文，记录发布时间（未知时留空）及获取时间；只有本对话保存的网页引用可通过来源入口打开，原有官方来源规则保持兼容。
- “券商导入”支持粘贴文字、TXT、XLSX 和图片，识别已成交买卖、税前现金分红和红利税。TXT/XLSX 在本地读取；图片能力同时按 Provider 适配器和当前模型 ID 判断，不支持图片理解的模型在点击上传、拖入和主进程提交识别前都会被阻止。识别结果会匹配当前自选股票、校验市场数量规则、汇率、重复流水和完整账本回放，并展示导入后的持仓/成本预览；所有选中记录作为一个 revision 原子提交，成交默认作为底仓交易，不自动写入 T 批次。

## 存储与凭证

数据位于 `%APPDATA%\\见涨\\modules\\ai\\`：`settings.json`、加密的 `credentials.bin`、会话索引、按会话拆分的 JSONL 消息和解读缓存。API Key 仅由主进程通过 Electron `safeStorage` 加密保存，渲染层只能读取配置状态和脱敏尾号。

## 构建开关与删除

- `JIANZHANG_AI_MODULE=0`：不注册 IPC、不暴露 API，也不将 renderer 的模块入口加入产物。
- 删除整个 `src/modules/ai/` 后，同时删除主进程、preload、`App.tsx` 和 `ExpandedStockDetails.tsx` 的 AI 条件安装点即可；核心状态、行情刷新、T 提醒和 `market-insight` 不依赖本模块。

`ai-t-advice` 是另一个可删除模块，不由本模块提供交易方向、价格、数量、仓位或 T 计划写入。
