# 多市场支持阶段 6：公司行动、权益确认与组合账本

## 1. 阶段目标

阶段 6 解决“没有买卖却改变持仓或现金”的事件，让阶段 4 的交易流水在长期使用后仍能与券商账户对得上。

本阶段交付：

- 港股、美股公司行动候选事件发现和官方原文入口。
- 现金分红、股票股息、拆股/合股、供股、证券转换和代码变更的统一数据模型。
- 用户确认前的持仓、成本、现金、税费和汇率影响预览。
- 确认后写入可追溯组合账本；不改写原始成交，不静默调整持仓。
- 事件修订、撤销和重复获取时的幂等处理。
- 手工录入入口，用于补齐券商已入账但免费官方来源无法完整覆盖的事件。

核心原则：官方公告负责“发现和提供证据”，券商实际入账负责“最终金额”，应用计算负责“生成预览”，用户确认负责“授权入账”。

## 2. 实施范围

### 2.1 P0：阶段 6 必须完成

| 事件 | 自动发现 | 自动提取草稿 | 用户确认后入账 |
| --- | --- | --- | --- |
| 现金分红 | 港股完整；美股候选 | 金额、币种、关键日期能确认时 | 是 |
| 股票股息/红股 | 港股完整；美股候选 | 股份比例能确认时 | 是 |
| 拆股 | 港美候选 | 新旧股比例 | 是 |
| 合股/反向拆股 | 港美候选 | 新旧股比例、碎股处理 | 是 |
| 供股/公开发售 | 港股完整；美股候选 | 权利比例、认购价、期限 | 用户选择是否认购 |
| 代码/名称变更 | 港美候选 | 新旧代码、生效日 | 是 |
| 手工现金调整 | 不适用 | 用户填写 | 是 |

### 2.2 P1：模型预留，阶段 6 不强求自动计算

- 分拆上市。
- 并购换股、私有化和退市现金结算。
- ADR 比例变化、存托凭证费用。
- 选择股息币种、以股代息等带选择权事件。
- 资本返还及需要特殊税务成本处理的事件。

这些事件可以先进入候选时间线和手工确认流程；只有条款完整且用户给出券商结果时才入账。

## 3. 官方来源与覆盖边界

### 3.1 港股

复用阶段 5 的 HKEXnews 股票映射与标题检索 Provider，新增公司行动类别查询：

- `13250`、`13251`：股息或分派。
- `18120`：资本重组，覆盖拆股、合股等事件候选。
- `18140`：资本化发行。
- `18500`：供股。
- `18460`：公开发售。
- `12700`：公司名称变更。
- `17450`：集团重组或协议安排。
- `17700`：分拆。
- `17600`：私有化、撤回或取消上市。
- `18260`：证券转换。

港交所现行指引明确区分公告日、登记日、停止过户期间、最后过户时间、除权日和派付日；应用必须分别保存，不能只保留一个“生效日”。

官方资料：

- [HKEX Distribution of Dividends and Other Entitlements](https://www.hkex.com.hk/-/media/HKEX-Market/Listing/Rules-and-Guidance/Other-Resources/Listed-Issuers/Practices-and-Procedures-for-Handling-Listing-related-Matters/f_div.pdf)
- [HKEX Practices and Procedures for Listing-related Matters](https://www.hkex.com.hk/Listing/Rules-and-Resources/Guidance/Listed-Issuers/Practices-and-Procedures-for-Handling-Listing-related-Matters?sc_lang=en)
- [HKEX Main Board forms and templates](https://www.hkex.com.hk/Listing/Rules-and-Resources/Checklist-forms-and-templates/Forms/Equity-Securities-Issuers/Main-Board-Issuers?sc_lang=en)

### 3.2 美股

免费默认模式使用阶段 5 的 SEC Submissions 发现 8-K、6-K、20-F、DEF 14A 等候选披露，并通过标题和正文关键词识别分红、拆股、并购、代码变更等事件。SEC 文件是事件证据，但并不保证包含所有交易所处理日期，因此不能承诺完整自动化。

Nasdaq Daily List 能覆盖新上市、退市、名称/代码变化、现金和股票股息、拆股及次日除权信息，但属于月度订阅产品。阶段 6 只预留可替换 Provider，不把付费数据作为默认依赖。

官方资料：

- [Nasdaq Daily List Product Description](https://nasdaqtrader.com/Trader.aspx?id=DailyListPD)
- [Nasdaq Daily List File Specification](https://www.nasdaqtrader.com/content/technicalsupport/specifications/dataproducts/dlcompletespec.pdf)
- [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)

默认覆盖策略：

1. SEC 发现候选并保留原文。
2. 日期或条款不完整时要求用户补录券商通知内容。
3. 用户确认实际到账数量、现金、预扣税和费用后入账。
4. 阶段 11 接入券商账单后，以券商活动记录自动对账。

## 4. 数据模型

### 4.1 公司行动候选

```ts
type CorporateActionType =
  | 'cashDividend'
  | 'stockDividend'
  | 'split'
  | 'reverseSplit'
  | 'rightsIssue'
  | 'spinOff'
  | 'mergerExchange'
  | 'symbolChange'
  | 'delistingCash'
  | 'returnOfCapital'

type CorporateActionStatus =
  | 'detected'
  | 'needsReview'
  | 'confirmed'
  | 'applied'
  | 'ignored'
  | 'revised'
  | 'reversed'

interface CorporateActionCandidate {
  id: string
  quoteId: string
  market: StockMarket
  type: CorporateActionType
  status: CorporateActionStatus
  announcementDate: string
  exDate?: string
  recordDate?: string
  electionDeadline?: string
  effectiveDate?: string
  payableDate?: string
  terms: CorporateActionTerms
  evidence: CorporateActionEvidence[]
  providerId: string
  providerEventId: string
  contentHash: string
  detectedAt: string
  reviewedAt?: string
  appliedEntryIds?: string[]
}
```

`CorporateActionTerms` 使用判别联合类型，避免把所有事件塞进大量可选字段：

- 现金分红：每股金额、宣派币种、可选结算币种。
- 股份事件：旧股数量、新股数量、碎股处理方式。
- 供股：每持有股数、可认购股数、认购价、认购币种。
- 证券转换：原证券、新证券、换股比例、现金补差。
- 代码变更：旧 `quoteId`、新 `quoteId`、公司身份连续性。

每个自动提取字段附带 `confidence` 和 `evidenceText`。低置信字段保持空值，不能由 AI 猜测后直接进入计算。

### 4.2 统一组合账本

阶段 4 的 `tradeRecords` 只表达买卖。本阶段新增：

```ts
type PortfolioLedgerEntry =
  | TradeLedgerEntry
  | CashDividendLedgerEntry
  | WithholdingTaxLedgerEntry
  | CorporateActionFeeLedgerEntry
  | ShareAdjustmentLedgerEntry
  | RightsSubscriptionLedgerEntry
  | SecurityConversionLedgerEntry
  | CashAdjustmentLedgerEntry
  | ReversalLedgerEntry
```

通用字段：

- `id`、`accountId`、`quoteId`、`occurredAt`、`marketDate`。
- 原币金额/数量、币种、实际汇率、汇率日期。
- `source: manual | corporateAction | brokerImport`。
- `externalId` 和 `corporateActionId`，用于幂等和追溯。
- `reversesEntryId`，用于撤销，不删除原记录。

迁移策略：

1. 给 `TTradingAccount` 增加版本化 `ledger`。
2. 首次读取时把现有 `tradeRecords` 无损映射为 trade entry。
3. 交易编辑器和持仓计算改读统一账本。
4. 完成迁移后，`tradeRecords` 只用于旧配置兼容读取，不再作为新写入源。

## 5. 市场规则配置

新增 `CorporateActionMarketRules`，按市场配置而不是写死在 UI：

```ts
interface CorporateActionMarketRules {
  market: StockMarket
  quantityPrecision: number
  cashPrecision: number
  supportsFractionalShares: boolean
  defaultWithholdingTaxMode: 'brokerActual' | 'manual'
  dateTimeZone: string
  settlementRuleIds: string[]
}
```

- 港股和美股都允许公司行动产生非 100 整数倍持仓；股票数量输入框仍按项目规范使用 `step=100`，但公司行动结果展示和账本内部不能强制舍入到 100 股。
- 是否保留碎股由券商实际处理决定；默认生成“待确认碎股”，不擅自四舍五入。
- 预扣税率不按市场给单一默认值。税收取决于发行人、投资者身份、账户类型和税务协定，以券商实际入账为准。
- 交收规则复用阶段 4 的市场版本配置；资格判断优先使用官方除权日和登记日，不自行推导官方日期。

## 6. 入账计算规则

### 6.1 现金分红

预览：

```text
税前金额 = 确认的权益股数 × 每股金额
净入账 = 税前金额 - 预扣税 - ADR/代理费 - 其他费用
人民币金额 = 各现金项 × 各自实际汇率
```

- 权益股数由账本和关键日期计算，但允许用户以券商通知覆盖。
- 普通现金分红计入投资收入，不修改股票成本。
- 资本返还必须使用独立类型，是否冲减成本由用户确认，不能当普通分红处理。
- 没有实际汇率时可使用阶段 3 的中国官方汇率生成“估算人民币值”，但必须标记为估算；券商实际汇率录入后重新计算。

### 6.2 股票股息、拆股和合股

```text
新数量 = 旧数量 × 新股比例 / 旧股比例
新每股成本 = 原总成本 / 实际保留的新数量
总成本不变
已实现收益不变
```

- 碎股被现金结算时拆成“股份调整 + 碎股现金结算”两条记录。
- 合股后数量为零或发生强制现金退出时，必须展示完整预览并单独确认。

### 6.3 供股

- 检测到供股只创建权利候选，不自动增加股票。
- 用户选择“不参与”“全部参与”或“部分参与”。
- 参与后写入认购现金流和新增股份，认购价及费用进入新增股份成本。
- 权利出售、失效或券商代售分别记录，不能都当作认购。

### 6.4 代码变更和证券转换

- 单纯代码变更保持公司身份、数量、总成本和追踪历史连续。
- 换股按比例转出旧证券并转入新证券，保留来源事件。
- 并购、分拆涉及成本分摊时要求用户填写券商或税务口径；缺少分摊依据时只记录数量和现金，不伪造每股成本。

## 7. 服务、缓存与 IPC

主进程新增：

- `CorporateActionProvider`：市场数据源接口。
- `HkexCorporateActionProvider`：HKEXnews 分类检索和公告解析。
- `SecCorporateActionProvider`：SEC 候选发现和原文提取。
- `CorporateActionService`：缓存、去重、状态迁移和证据管理。
- `PortfolioLedgerService`：预览、应用、撤销、重算和持久化。

建议 IPC：

```text
corporate-actions:list
corporate-actions:refresh
corporate-actions:preview
corporate-actions:confirm
corporate-actions:ignore
corporate-actions:reverse
portfolio-ledger:list
portfolio-ledger:add-manual
```

缓存建议：

```text
corporate-actions/
  candidates/HK/{quoteId}.json
  candidates/US/{quoteId}.json
  documents/{providerEventId}.json
```

候选和官方文档索引属于可重建缓存；用户确认结果、手工补录、忽略状态和账本记录属于用户数据，必须进入备份/Gist 恢复范围。

## 8. 幂等、修订与撤销

- 候选唯一键优先使用 `providerId + providerEventId`。
- 同一官方事件内容变化时更新 `contentHash`，原候选转为 `revised`，不创建第二条重复事件。
- 已应用事件发生修订时只提示差异，不自动改账。
- 用户接受修订后写入差额记录；整单撤销时写 `ReversalLedgerEntry`。
- 删除官方缓存不会删除确认状态和账本。
- 手工事件使用稳定本地 ID，可在阶段 11 导入券商活动后建立关联并避免重复。

## 9. UI 方案

### 9.1 个股详情“公司行动”页签

- 时间线按公告日、除权日、登记日、派付/生效日显示。
- 状态标签：待确认、已确认、已入账、已忽略、已修订、已撤销。
- 每个事件显示官方来源、提取字段、缺失字段和原文入口。
- 手动刷新不受市场开市时间限制；24 小时缓存未过期时不自动重复请求。

### 9.2 待确认中心

- 主界面集中展示全部自选股的待确认事件。
- 支持按市场、事件类型和最近日期筛选。
- 首期逐条确认，不提供高风险批量自动入账。

### 9.3 影响预览

确认弹窗同时展示：

- 事件前后股票数量、每股成本和总成本。
- 税前现金、预扣税、费用和净现金。
- 原币与人民币估算值，实际/官方估算汇率标识。
- 将写入的每一条账本记录。
- 仍需用户补录或确认的字段。

所有收益和收益率继续按项目规则显示：正数红色、负数绿色、零值中性色；所有辅助文字不低于 `12px`。

## 10. 刷新策略

公司行动可能在收市后公告，因此与行情刷新彻底分离：

- 打开公司行动页签：缓存超过 24 小时才查询。
- 手动更新：随时允许。
- 后台检查：应用启动后延迟执行，每个市场每天最多一次，只检查自选股；失败不影响行情启动。
- HKEX 按股票低并发查询；SEC 遵守 fair-access 请求约束。
- 付费 Provider 若以后接入，按其授权和频率限制独立配置。

## 11. 实施顺序

### 6A：统一账本与计算内核

- 新增公司行动/账本类型和配置迁移。
- 把阶段 4 成交迁入统一账本计算。
- 实现分红、税费、股份比例调整、供股认购和撤销的纯函数。
- 增加影响预览及单元测试。

### 6B：港股自动发现

- 复用 HKEXnews 客户端和股票映射。
- 查询公司行动分类，解析公告日期、关键日期、金额、币种和比例。
- 实现内容哈希、修订检测和官方原文入口。

### 6C：美股候选发现与手工补录

- 扩展 SEC filing 分类和正文关键词提取。
- 明确标注“候选，不保证交易所日期完整”。
- 实现完整手工公司行动录入。
- 预留 Nasdaq Daily List/券商活动 Provider 接口，不默认依赖付费服务。

### 6D：确认中心、入账和备份

- 个股时间线、全局待确认入口、影响预览。
- 确认、忽略、修订差额和撤销流程。
- 用户数据备份/Gist 恢复和缓存清理边界。
- 静态检查和回归测试；不主动运行界面或打包。

建议提交拆分：

1. `feat: 建立公司行动与统一组合账本模型`
2. `feat: 接入港美股公司行动候选数据`
3. `feat: 支持公司行动确认入账与撤销`

## 12. 测试与验收

### 12.1 计算样本

- 港股现金分红：HKD 宣派、CNY 实际到账汇率、预扣税和费用分项。
- 美股现金分红：USD 原币、预扣税、人民币官方估算和后续实际汇率替换。
- 1 拆 4：数量扩大 4 倍、每股成本除以 4、总成本及已实现收益不变。
- 10 合 1：产生碎股并由现金结算。
- 10 供 1：不参与、部分参与、全部参与三种结果。
- 代码变更：持仓、追踪、提醒和历史连续，不产生收益。
- 已应用事件修订：只生成差额预览，不重复整单入账。
- 撤销：原记录保留，反向记录使当前结果恢复。

### 12.2 数据与生命周期

- 同一公告重复获取不产生重复候选。
- 官方日期缺失时不能自动推导为已确认值。
- 自动提取失败仍能打开原文并手工录入。
- 清除缓存后，已确认/忽略/已入账状态仍存在。
- 备份恢复后，公司行动和组合账本完整恢复。
- 行情继续只在各自市场开市时间刷新；公司行动使用独立低频计划。

## 13. 明确不做

- 不自动替用户作出供股、以股代息等投资选择。
- 不根据国籍猜测预扣税率。
- 不把 SEC 公告候选描述为完整交易所公司行动数据。
- 不在没有授权的数据源上抓取或再分发专业公司行动数据。
- 不删除或改写历史成交来“修正”持仓。
- 不在阶段 6 自动下单、认购、卖出权利或处理现金选择。
