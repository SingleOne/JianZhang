# 多市场支持阶段 5：港美股官方财报库与标准化基本面

## 0. 实施状态（2026-08-25）

阶段 5 已完成实现，实际落地范围如下：

- 财报 IPC 已从 A 股代码改为 `quoteId`，并按 CN/HK/US 路由 Provider。
- A 股巨潮财报行为保留，旧缓存可继续读取；新缓存按市场隔离。
- 美股接入 SEC ticker/CIK、Submissions、Company Facts 与官方 filing 原文。
- 港股接入 HKEXnews 股票匹配和标题检索 JSON 接口，按财报及业绩类别查询近五年记录。
- SEC HTML/iXBRL 与三市场 PDF 均可进入现有 AI 财报总结链路，原文 URL 按官方域名校验。
- 美股按申报期间生成年度、阶段性和可可靠计算时的 TTM 指标；港股仅在币种、数量级、期间和标签均明确时展示派生指标。
- 港美股已开启“基本面”和“财报库”，但继续关闭 A 股专属初筛、行业分位、财务雷区、DCF、雷达与 AI 分析。
- 披露数据只在详情页首次打开、24 小时缓存过期或用户手动更新时刷新，不接入盘中行情定时器。

本次只完成静态验证：`npx tsc --noEmit`、变更文件 ESLint、`git diff --check`。未运行界面、生产构建、`build:unpacked` 或安装包流程。

## 1. 阶段目标

阶段 5 在前四阶段已经完成港美股行情、交易日历、汇率换算和交易流水的基础上，补齐港美股公司研究能力：

- 港股、美股均可查看来自官方披露平台的财报目录和原文。
- 美股通过 SEC EDGAR 的结构化 XBRL 数据生成财务概览。
- 港股优先使用 HKEXnews 官方报告，在数据能够可靠识别时生成有限的标准化财务指标。
- 保留每个指标的报告期间、原始单位、报告币种和官方来源，不把港美股硬塞进现有 A 股全市场快照。

本阶段不包含分红、拆股、供股、合股等公司行动自动入账，也不直接复用 A 股的财务雷区、行业分位和 DCF 规则。

## 2. 现有实现边界

当前代码不能通过简单打开市场能力开关支持港美股：

- 港股和美股共用 `GLOBAL_MARKET_CAPABILITIES`，`fundamentals` 与 `companyReports` 均为关闭状态。
- `FundamentalSnapshot` 固定使用人民币，并围绕 A 股全市场五年批量快照设计。
- `CompanyReportLibraryResult.source` 仅允许“巨潮资讯”，主进程财报服务只接受六位 A 股代码。
- 基本面生成脚本依赖东方财富 A 股报表接口和 A 股行业分类。
- 现有基本面 UI 包含 A 股专用的三项初筛、行业负债分位、财务雷区、同行比较和 DCF，不能直接作为港美股通用财务概览。

因此阶段 5 采用“保留 A 股现有链路，新增跨市场披露模型与市场 Provider”的增量方案。

## 3. 官方数据源

### 3.1 美股

使用美国证券交易委员会 SEC EDGAR：

- `company_tickers_exchange.json`：股票代码、交易所、公司名称与 CIK 映射。
- Submissions API：公司名称、交易所、股票代码及申报历史。
- Company Facts API：公司级 US-GAAP/IFRS XBRL 指标。
- EDGAR filing archive：10-K、10-Q、8-K、20-F、6-K 及修订报告原文。

SEC 数据接口无需 API Key，但必须：

- 在 Electron 主进程请求，避免 `data.sec.gov` 不支持浏览器 CORS 的限制。
- 使用能够识别应用和联系人的 User-Agent。
- 全局限速低于 SEC 公布的每秒 10 次。
- 优先缓存按公司获取的数据，不随行情刷新轮询。

官方资料：

- [EDGAR Application Programming Interfaces](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- [Accessing EDGAR Data](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)
- [SEC fair-access rate control](https://www.sec.gov/filergroup/announcements-old/new-rate-control-limits)

### 3.2 港股

以 HKEXnews 上市公司信息为官方来源：

- 年报、中期报告、季度报告和业绩公告。
- 中英文报告、摘要、修订版和补充文件。
- 报告发布日期、标题、分类和官方 PDF 链接。

港交所公开页面允许投资者查询上市公司报告，并由页面自身调用标题检索 JSON 接口；该接口不是面向第三方开发者承诺稳定性的正式数据 API。实时 Issuer Information Feed Service（IIS）属于授权数据流，官方公布的再分发费用较高，不适合当前本地桌面应用直接接入。

阶段 5 采用以下边界：

- 仅在用户查看股票详情或本地缓存过期时按股票查询。
- 本地保存报告元数据、官方链接和用户主动生成的 AI 总结，不建立远程再分发服务。
- HKEX 页面适配器与业务模型隔离，避免页面升级影响其他市场。
- 不进行港股全市场高频抓取。

官方资料：

- [HKEX listed-company information guidance](https://www.hkex.com.hk/Global/Exchange/FAQ/Getting-Started?sc_lang=en)
- [HKEX Issuer Information Feed Service](https://www.hkex.com.hk/Services/Market-Data-Services/Infrastructure/Issuer-Information-feed-Service-%28IIS%29?sc_lang=en)
- [HKEX market-data vendor fees](https://www.hkex.com.hk/Services/Rules-and-Forms-and-Fees/Fees/Securities-%28Hong-Kong%29/Market-Data/Market-Data-Vendors?sc_lang=en)

港股报告可能采用 HKFRS、IFRS 或中国企业会计准则，且报告币种不一定与股票交易币种相同。财务概览必须保留报告原始币种和会计准则。

- [HKEX disclosure of financial information](https://en-rules.hkex.com.hk/node/3830/revisions/36870/view)

## 4. 数据模型

新增独立于 A 股快照的跨市场模型。

### 4.1 `IssuerIdentity`

- `quoteId`
- `market`
- `exchange`
- `officialIssuerId`：SEC CIK 或港交所股票代码
- `primaryTicker`
- `companyName`
- `fiscalYearEnd`
- `accountingStandard`
- `preferredLanguage`

### 4.2 `CompanyFiling`

- `id`
- `quoteId`
- `market`
- `formType`
- `reportType`
- `fiscalPeriod`
- `periodStart`
- `periodEnd`
- `filedAt`
- `amended`
- `language`
- `sourceName`
- `sourceUrl`
- `accessionNumber` 或港交所报告标识

### 4.3 `FinancialFact`

- `concept`：应用内统一指标
- `rawConcept`：XBRL tag 或报告原始名称
- `value`
- `unit`
- `currency`
- `periodStart`
- `periodEnd`
- `filedAt`
- `formType`
- `sourceUrl`
- `derivation`：原始披露、标准化映射或应用计算

### 4.4 `GlobalFundamentalSnapshot`

- 按 `quoteId` 保存，不生成港美股全市场大快照。
- 分离原始 Facts、标准化年度/季度数据和派生指标。
- 同一报告期间出现修订或重述时保留历史，并默认展示最新申报版本。
- 财政年度和季度按发行人实际期间判断，不假设自然年。

## 5. Provider 架构

新增统一披露接口：

```ts
interface CompanyDisclosureProvider {
  resolveIssuer(stock: WatchStock): Promise<IssuerIdentity>
  listFilings(issuer: IssuerIdentity, forceRefresh?: boolean): Promise<CompanyFiling[]>
  loadFinancialFacts?(issuer: IssuerIdentity, forceRefresh?: boolean): Promise<FinancialFact[]>
}
```

具体实现：

- `CninfoDisclosureProvider`：封装现有 A 股财报目录逻辑。
- `SecEdgarDisclosureProvider`：CIK 映射、申报历史、Company Facts 和原文链接。
- `HkexNewsDisclosureProvider`：港交所报告查询、分类、语言版本和 PDF 链接。

主进程服务统一按 `quoteId` 选择 Provider。IPC 不再只传递股票代码，以免不同市场代码冲突或误判。

## 6. 实施拆分

### 6.1 阶段 5A：港美股官方财报库

- 泛化财报目录类型、缓存目录和 IPC 参数。
- 保留巨潮 A 股实现并迁入统一 Provider 接口。
- 接入 SEC EDGAR 申报目录。
- 接入 HKEXnews 年报、中报、季度报告和业绩公告目录。
- 支持中英文版本、摘要、修订报告和补充文件去重。
- 港股、美股开启 `companyReports` 能力。
- 复用现有 PDF 文本提取和 AI 总结。
- 为 SEC HTML/iXBRL 报告增加正文提取，优先截取管理层讨论、财务报表、审计意见和风险章节。
- 官方原文打开功能按 Provider 校验允许的域名。

### 6.2 阶段 5B：标准化财务概览

美股从 SEC Company Facts 提取：

- 营业收入、营业利润、归母净利润。
- 基本和稀释 EPS。
- 总资产、总负债、股东权益。
- 现金、有息负债。
- 经营现金流、资本开支、自由现金流。
- 毛利率、净利率、ROE、资产负债率。
- 年度、季度和 TTM 趋势。

XBRL 指标映射需要允许同一应用指标对应多个标准 taxonomy concept，并保留实际命中的原始 concept。TTM 必须根据期间和累计口径计算，不能直接相加季度与年初至今数据。

港股从官方业绩公告或财报中提取有限通用指标：

- 营业收入。
- 股东应占利润。
- 每股收益。
- 总资产、总负债和权益。
- 经营现金流。
- 报告币种、会计准则和财政年度。

港股数值只有在金额、期间和单位均可确认时才进入标准化概览。AI 只用于财报文字总结，不作为最终财务数值来源。

### 6.3 UI

- A 股继续显示现有基本面面板。
- 港美股新增“财务概览”面板，展示报告期间、报告币种、关键指标、趋势和来源。
- 指标区分“官方原始披露”和“应用计算”。
- 每个报告或指标组提供官方原文入口。
- 数据缺失时显示未披露或暂未标准化，不将其判定为经营风险。
- ETF 等非普通公司证券明确显示“不适用公司基本面”。
- 港美股暂不显示 A 股三项初筛、行业分位、财务雷区、同行排名和 DCF。

## 7. 刷新与缓存规则

阶段 1 的交易时间限制继续只约束行情自动刷新。公司披露可能在收市后发布，因此采用独立的低频刷新策略：

- 打开股票详情时，缓存超过 24 小时才自动更新报告目录。
- 自选股后台每天最多检查一次新报告。
- 手动刷新不受市场开市时间限制。
- SEC/HKEX 不接入行情定时器。
- SEC 请求统一限速和缓存；HKEX 查询使用低并发按股票执行。
- 原始报告目录和财务 Facts 属于可重新获取数据；用户主动生成的 AI 总结继续作为用户数据保留。

建议缓存目录：

实际缓存目录：

```text
company-reports/
  cn/{quoteId}.json
  hk/{quoteId}.json
  us/{quoteId}.json
  summaries.json

global-fundamentals/
  {quoteId}.json

fundamentals/
  snapshot.json              # 现有 A 股快照
```

## 8. 验收样本

至少覆盖以下发行人：

- AAPL：美国本土发行人，10-K/10-Q、US-GAAP、自然财年差异。
- BABA：外国私人发行人，20-F/6-K。
- 00700 腾讯：港股常规公司、HKFRS、年报和中报。
- 09988 阿里巴巴：非自然财政年度、人民币报告币种、中英文报告。
- 00005 汇丰：银行类公司、美元报告币种、不适用普通企业指标。

验收要求：

- 股票能够稳定映射到官方发行人标识。
- 财报目录按报告期间和发布时间排序，修订版不会被旧版覆盖。
- 官方原文链接可以打开且来源标识正确。
- 报告币种不根据交易币种强制改写。
- 美股年度、季度及 TTM 口径不重复累计。
- 港股无法可靠识别的数值保持为空，不使用 AI 猜测。
- A 股现有基本面和财报库行为不回归。
- 行情仍只在对应市场开市期间自动刷新，披露数据使用独立低频规则。

## 9. 提交建议

阶段 5 建议拆成两个独立提交：

1. `feat: 接入港美股官方财报目录`
2. `feat: 支持港美股标准化财务概览`

完成后只执行项目约定的静态检查，不主动运行界面验证或 `npm run build:unpacked`。
