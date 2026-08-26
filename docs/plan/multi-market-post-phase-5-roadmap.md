# 多市场支持阶段 5 之后的功能路线研究

## 1. 当前基础

多市场支持前四阶段已经完成：

1. 港股、美股标的识别、行情展示与按市场开市时间自动刷新。
2. 多市场交易日历、时区和行情可靠性处理。
3. 港币、美元持仓及人民币基准汇率换算。
4. 港美股交易流水、费用模板、交收日期和已实现收益。

阶段 5 将补齐港美股官方财报库与标准化基本面。完成后，应用已经具备“行情—持仓—交易—财报”的完整基础链路。后续阶段应优先发展能够复用这些数据、且不依赖高价授权行情的能力。

## 2. 推荐顺序

| 阶段 | 方向 | 用户价值 | 实施难度 | 外部数据成本 | 建议 |
| --- | --- | --- | --- | --- | --- |
| 6 | 公司行动与持仓自动调整 | 高 | 中高 | 中 | 紧接阶段 5 |
| 7 | 跨市场收益分析与归因 | 高 | 中 | 低 | 主线 |
| 8 | 港美股异动雷达与市场观察 | 高 | 中高 | 低至中 | 主线 |
| 9 | 跨市场估值、组合质量与 AI 分析 | 高 | 高 | 低至中 | 依赖阶段 5、8 |
| 10 | 股东、内部人和权益披露监控 | 中高 | 中高 | 低至中 | 独立专题 |
| 11 | 券商账单导入与只读同步 | 高 | 高 | 低 | 账本稳定后实施 |
| 可选 | Level 2、盘口、资金流和筹码 | 中 | 高 | 高 | 不进入默认主线 |

## 3. 阶段 6：公司行动与持仓自动调整

独立实施文档：[多市场支持阶段 6：公司行动、权益确认与组合账本](./multi-market-phase-6-plan.md)

### 3.1 为什么应该优先

阶段 4 的交易账本目前只有买入和卖出，不能表达现金分红、送股、拆股、合股、供股、分拆、并购换股、代码变更和退市现金结算。时间越长，实际持仓与手工账本越容易因此失真。

阶段 5 已经能够取得公司公告和财报目录，可复用披露入口发现公司行动。因此公司行动是阶段 5 之后最自然的下一步。

### 3.2 数据模型

新增 `CorporateAction`：

- `cashDividend`
- `stockDividend`
- `split`
- `reverseSplit`
- `rightsIssue`
- `spinOff`
- `mergerExchange`
- `symbolChange`
- `delistingCash`

通用字段包括：

- 股票、市场、事件类型和官方事件标识。
- 公告日、除权日、登记日、生效日、派付日。
- 每股金额、币种、股份比例、换股比例。
- 预扣税率、ADR 费用及其他现金扣减。
- 官方来源和事件状态：`detected`、`confirmed`、`applied`、`ignored`。

交易账本扩展为组合账本事件：

```text
trade
cash-dividend
withholding-tax
corporate-action-fee
stock-dividend
split
rights-subscription
security-conversion
cash-adjustment
position-transfer
```

公司行动不直接改写历史交易。应用后写入新的账本事件；修订或撤销时写反向事件，保证过程可追溯。

### 3.3 数据来源与自动化边界

港股可从 HKEXnews 的“股息及其他权益”公告发现事件。港交所官方指南明确列出除权日、登记日、派付日、税项、现金或证券权益等字段：

- [HKEX Guide on Dividends & Other Entitlements](https://www.hkex.com.hk/-/media/HKEX-Market/Listing/Rules-and-Guidance/Other-Resources/Listed-Issuers/Practices-and-Procedures-for-Handling-Listing-related-Matters/f_div.pdf)
- [HKEX listed-company information guidance](https://www.hkex.com.hk/Global/Exchange/FAQ/Getting-Started?sc_lang=en)

美股交易所存在正式公司行动数据产品，例如 Nasdaq Daily List 提供分红、拆股、代码变更和退市信息，但属于订阅产品：

- [Nasdaq Daily List](https://nasdaqtrader.com/Trader.aspx?id=DailyListPD)

SEC 披露可以用于发现事件和读取原文，但不能替代覆盖全部交易所、带完整除权时间表的公司行动数据流。因此阶段 6 采用：

- 官方公告自动发现候选事件。
- 应用提取结构化草稿并展示原文。
- 用户确认后才写入账本。
- 用户可手动新增券商已入账但公告未识别的事件。
- 阶段 11 接入券商记录后，以账户实际入账事件进行对账。

### 3.4 UI 与验收

- 个股详情增加“公司行动”时间线。
- 主界面增加“待确认公司行动”入口。
- 确认前预览持仓数量、成本、现金和收益变化。
- 现金分红分别记录税前金额、预扣税、费用和净入账。
- 拆股和合股只调整数量与每股成本，不凭空产生收益。
- 跨币种现金事件保存实际到账汇率；未知时允许稍后补录。
- 同一官方事件重复获取不会重复入账。

## 4. 阶段 7：跨市场收益分析与归因

阶段 6 完成后，账本同时拥有交易、现金分红、税费和股份调整，可以生成可靠的组合收益报告。

独立实施文档：[多市场支持阶段 7：跨市场收益分析与归因](./multi-market-phase-7-plan.md)

### 4.1 阶段 7A：持仓收益汇总与归因

- 按股票、市场、默认账户、币种和组合汇总。
- 区分已实现收益、未实现收益、税前分红、预扣税、交易费用、公司行动费用和公司行动现金收益。
- 原币收益与人民币基准收益并列展示。
- 将人民币证券收益拆分为价格贡献和汇率贡献。
- 历史汇率、当前汇率、行情或账本不完整时明确标记；人民币组合只汇总数据完整的股票并显示排除数量。
- 未记录完整出入金时只展示“持仓收益”，不描述为“账户收益”。

### 4.2 阶段 7B：收益率、曲线与基准比较

- 时间加权收益率（TWR），用于排除出入金影响后评价投资表现。
- 资金加权收益率（XIRR），用于评价用户实际资金回报。
- 日、月、季度、年度收益曲线和最大回撤。
- 与对应市场基准指数进行同币种和人民币口径比较。

### 4.3 实施边界

- 主要计算基于本地账本、行情和阶段 3 汇率，不需要新增收费数据源。
- 未记录完整出入金时，明确区分“持仓收益”与“账户收益”，不伪造 XIRR。
- 组合收益不混用交易日；每个市场按本地交易日结算，再归并到统一展示日期。
- 历史汇率缺失时标记不完整，不用当前汇率回填历史收益。

## 5. 阶段 8：港美股异动雷达与市场观察

现有市场观察模块已经包含日线、分时、趋势、动量、波动、相对强弱、新闻和事件模型，但当前依赖 A 股指数、盘口、资金流及 A 股新闻 Provider。技术指标和事件框架本身可以复用。

### 5.1 首期范围

- 港美股日线趋势、均线、动量、波动率、ATR、突破和回撤。
- 成交量相对均量、量价背离和放量异动。
- 按市场绑定基准指数，计算相对强弱。
- 结合阶段 5 官方披露，提醒新财报、业绩公告、重大 8-K/6-K 和报告修订。
- 结合阶段 6 提醒临近除权、派息和公司行动确认。
- 继续使用各市场交易时间，只在相应市场常规交易时段自动刷新行情型指标。
- 披露和公司行动检查使用独立低频计划，不受行情开市门控。

### 5.2 市场差异

- 港股午间休市，分时连续性和开盘区间必须按两个交易时段处理。
- 美股首期只处理常规交易时段；盘前盘后需要数据源明确支持后再开放。
- 成交额、股价和绝对成交量阈值不能沿用 A 股固定值，应使用股票自身历史分位或相对均值。
- 基准指数和市场状态按股票所属市场选择，不使用全局唯一 A 股指数。

### 5.3 暂不依赖的数据

首期不要求 Level 2、五档盘口、主力资金流或筹码分布。缺少这些数据时，市场观察仍可由行情、K 线、官方披露和公司行动组成完整基础版本。

完成后可为港美股开启 `radar` 和 `marketInsight`，但继续关闭 `orderBook`、`fundsFlow` 和 `chipDistribution`。

## 6. 阶段 9：跨市场估值、组合质量与 AI 分析

该阶段依赖阶段 5 的标准化财务数据和阶段 8 的市场观察数据。

### 6.1 通用研究能力

- 收入、利润、现金流、资本回报、杠杆和每股指标趋势。
- PE、PB、PS、EV/EBITDA、自由现金流收益率等可计算指标。
- 当前估值与公司自身历史区间比较。
- 同一市场、相近会计准则和可比行业内的同行比较。
- 多市场持仓质量概览，按人民币市值汇总，但保留指标原始报告币种。

美股可以使用 SEC 披露中的 SIC 作为基础行业标识：

- [SEC Standard Industrial Classification list](https://www.sec.gov/search-filings/standard-industrial-classification-sic-code-list)

港股不直接使用需要额外授权的商业行业分类。首期可采用发行人披露业务、港交所类别和应用内部中性分类，允许用户修正。

### 6.2 估值边界

- DCF 使用可配置假设，并展示无风险利率、风险溢价、增长率和终值方法。
- 银行、保险和券商使用独立估值口径，不套用普通企业自由现金流模型。
- 不同会计准则或报告币种的数据不能仅因字段同名就直接做同行排名。
- ADR 必须记录存托凭证比例，避免每股指标和股本重复计算。

### 6.3 AI 能力

- 短期行情读取阶段 8 的市场化指标和官方事件。
- 长期价值读取阶段 5 的标准化财务数据、官方财报总结和估值假设。
- 输出继续区分企业质量、财务安全、当前价格和结论。
- 不生成自动下单指令。

现有 AI 做 T 模块固定要求 100 股整数倍，并围绕 A 股做 T 语义设计。港美股不能直接开启。后续应重构为“短线交易计划”，按市场最小交易单位、可卖数量、结算和交易时段校验。

完成后可开启港美股 `aiAnalysis`；`aiTAdvice` 需要完成市场化重构后再单独开放。

## 7. 阶段 10：股东、内部人与权益披露监控

### 7.1 美股

- SEC Forms 3、4、5：董事、高管和主要股东持股及交易变化。
- Schedule 13D/13G：重要实益所有权变化。
- 形成内部人交易时间线、大股东变化和新披露提醒。

SEC 提供由 Forms 3、4、5 结构化申报提取的官方季度数据集：

- [SEC Insider Transactions Data Sets](https://www.sec.gov/files/insider_transactions_readme.pdf)

### 7.2 港股

- SFC Part XV 权益披露：持股达到规定门槛的大股东、董事和最高行政人员权益变化。
- HKEX Disclosure of Interests：公开查询披露表格。
- CCASS 持股：只能反映中央结算参与者持仓，不等于最终实益拥有人。

官方资料：

- [SFC Part XV Disclosure of Interests](https://www.sbz.sfc.hk/en/Rules-and-standards/Securities-and-Futures-Ordinance-Part-XV---Disclosure-of-Interests)
- [HKEX Disclosure of Interests](https://www2.hkexnews.hk/Shareholding-Disclosures/Disclosure-of-Interests?sc_lang=en)
- [HKEX CCASS Shareholding Search](https://www3.hkexnews.hk/sdw/search/searchsdw.aspx?lang=zh)

CCASS 公开查询条款限定个人及非商业用途，因此不建立远程聚合或再分发。若产品用途扩展，需要先重新确认授权边界。

### 7.3 展示原则

- 区分主动买卖、股权激励、行权、赠与和内部转仓。
- 不把“内部人买入”直接判定为利好，也不把 CCASS 券商席位变化解释为实际股东变化。
- 所有结论保留申报人、申报日期、交易日期、交易性质和原文链接。

完成后可按市场逐步开启 `shareholders` 能力。

## 8. 阶段 11：券商账单导入与只读同步

### 8.1 建议顺序

1. 通用 CSV/Excel 导入预览。
2. IBKR Flex/Activity Statement 适配。
3. 长桥等券商账单适配。
4. 在用户明确配置后增加只读 API 同步。

Interactive Brokers 官方 Web API 可查询账户、持仓、成交和报表；长桥也提供订单和成交接口：

- [IBKR Web API](https://ibkrcampus.com/campus/ibkr-api-page/webapi-doc/)
- [IBKR Activity Statements](https://ibkrcampus.com/docs/web-api/account-management/reporting/activity-statements)
- [Longbridge order and executions](https://open.longbridge.com/docs/cli/orders/order)

### 8.2 主要能力

- 导入成交、佣金、平台费、股息、预扣税、利息、汇兑和公司行动。
- 根据券商成交编号和事件编号幂等去重。
- 对比本地账本与券商持仓，生成差异报告。
- 用户确认后补齐或修正本地账本，不静默覆盖历史。
- 多账户独立保存，再汇总到统一人民币组合视图。

### 8.3 安全边界

- 首期只读，不下单、不改单、不撤单。
- API 凭据加密保存，不进入普通备份和日志。
- 导入前展示影响预览，发生冲突时由用户选择保留本地或采用券商记录。

券商活动流通常已经包含实际入账的股息、拆股、费用和公司行动，可作为阶段 6 预测事件的最终对账依据。Alpaca 官方活动模型也明确将成交、股息、拆股、费用和重组统一为账户活动事件，可作为内部账本模型的参考：

- [Alpaca Activities integration guide](https://docs.alpaca.markets/us/docs/activity-sse)

## 9. 可选专业数据方向

### 9.1 Level 2 与订单簿

港交所 OMD-C、Nasdaq TotalView 和 NYSE Integrated/OpenBook 均提供正式深度行情，但属于专业授权数据产品：

- [HKEX OMD-C](https://www.hkex.com.hk/OMDC?sc_lang=en)
- [Nasdaq market-data products](https://www.nasdaqtrader.com/Trader.aspx?id=mddataproducts)
- [NYSE real-time market data](https://www.nyse.com/market-data/real-time)

在没有明确授权来源前，不建议依赖网页接口为港美股开启五档盘口。

### 9.2 资金流和筹码分布

“主力资金流”和“筹码分布”通常是数据商根据成交和持仓模型计算的衍生指标，并不存在跨港股、美股统一的官方口径。即使取得 Level 2，也需要定义应用自己的算法和准确性边界。

因此这两项不进入默认路线。只有用户确认数据供应商、费用、授权方式和计算口径后，再通过可替换 Provider 接入。

## 10. 总体建议

最有连续性的实施主线为：

```text
阶段 5 官方财报与基本面
  → 阶段 6 公司行动与账本
  → 阶段 7 收益分析与归因
  → 阶段 8 异动雷达与市场观察
  → 阶段 9 估值、组合质量与 AI 分析
```

阶段 10 股东权益披露和阶段 11 券商同步可以在主线稳定后独立推进。Level 2、盘口、资金流和筹码属于付费专业数据路线，不建议阻塞核心多市场功能。
