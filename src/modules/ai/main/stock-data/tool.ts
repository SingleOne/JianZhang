import { randomUUID } from 'node:crypto'
import { calculatePortfolioPerformanceReport } from '../../../../lib/portfolio-performance'
import {
  marketCapabilitiesForQuoteId,
  stockMarketIdentity,
  type StockMarketCapabilities
} from '../../../../shared/stock-market'
import type { KlinePeriod, WatchStock } from '../../../../shared/types'
import type {
  AiContextRef,
  AiModuleDependencies,
  AiProviderTool,
  AiProviderToolCall
} from '../../shared/types'
import { compactMarketSnapshot } from '../conversations/context-builder'

const TOOL_NAME = 'read_stock_data'
const DEFAULT_LIMIT = 120
const MAX_LIMIT = 500
const MAX_REQUESTS = 8

type DatasetAvailability = 'ready' | 'loadable' | 'empty' | 'unsupported'
type DatasetDetail = 'summary' | 'full'

export interface StockDataContextInput {
  source: 'conversation' | 'mention'
  quoteId: string
  quoteName?: string
  code?: string
  marketLabel?: string
}

export interface StockDataManifestDataset {
  id: string
  label: string
  description: string
  availability: DatasetAvailability
  privacy: 'market' | 'personal'
}

export interface StockDataManifestStock {
  stockRef: string
  source: StockDataContextInput['source']
  identity: {
    quoteId: string
    code: string
    name: string
    marketLabel: string
    market: string
    exchange: string
    currency: string
  }
  datasets: StockDataManifestDataset[]
}

export interface StockDataManifest {
  schemaVersion: 1
  contextId: string
  generatedAt: string
  stocks: StockDataManifestStock[]
}

interface DatasetDefinition {
  id: string
  label: string
  description: string
  privacy: StockDataManifestDataset['privacy']
  capability?: keyof StockMarketCapabilities
  localState?: 'quote' | 'chip' | 'position' | 'ledger' | 'tPlan' | 'tracking' | 'dailyScan'
}

interface StockDataTarget {
  stockRef: string
  request: StockDataContextInput
  stock?: WatchStock
}

interface ParsedDatasetRequest {
  stockRef: string
  datasetId: string
  detail: DatasetDetail
  period: KlinePeriod
  limit: number
  cursor: number
}

interface DatasetPage<T> {
  total: number
  offset: number
  records: T[]
  nextCursor: string | null
}

const DATASETS: DatasetDefinition[] = [
  {
    id: 'identity.watchlist',
    label: '股票身份与自选配置',
    description: '代码、市场、币种、自选分组、显示设置、提醒规则和加入自选时间。',
    privacy: 'personal'
  },
  {
    id: 'market.quote',
    label: '最新行情',
    description:
      '最新价、涨跌、成交量额、估值字段、板块、雷达与盘口大单；价格为原币，比例为百分点。',
    privacy: 'market',
    localState: 'quote'
  },
  {
    id: 'market.kline',
    label: 'K 线',
    description: '分时、五日、日、周或月 K 线；可用 period 和 limit 控制范围。',
    privacy: 'market'
  },
  {
    id: 'market.insight',
    label: '市场洞察',
    description: '技术、趋势、动量、波动、盘口和相对强弱指标，以及新闻与事件。',
    privacy: 'market',
    capability: 'marketInsight'
  },
  {
    id: 'market.orderBook',
    label: '五档盘口',
    description: '买卖五档价格与数量、数据状态和更新时间。',
    privacy: 'market',
    capability: 'orderBook'
  },
  {
    id: 'market.fundsFlow',
    label: '资金流向',
    description: '主力、超大单、大单、中单和小单的分时净流入序列。',
    privacy: 'market',
    capability: 'fundsFlow'
  },
  {
    id: 'market.sector',
    label: '所属板块',
    description: '所属板块行情及板块分时走势。',
    privacy: 'market',
    capability: 'sector'
  },
  {
    id: 'market.chipDistribution',
    label: '筹码分布',
    description: '平均成本、获利比例、70/90% 成本区间与价格桶。',
    privacy: 'market',
    capability: 'chipDistribution',
    localState: 'chip'
  },
  {
    id: 'portfolio.position',
    label: '持仓与收益',
    description: '用户持仓、成本、快照、提醒及基于统一账本计算的原币/CNY 收益。',
    privacy: 'personal',
    capability: 'position',
    localState: 'position'
  },
  {
    id: 'portfolio.ledger',
    label: '组合账本',
    description: '成交、分红、费用、公司行动等统一账本记录；支持 limit 和 cursor。',
    privacy: 'personal',
    capability: 'tradeLedger',
    localState: 'ledger'
  },
  {
    id: 'trading.tPlan',
    label: 'T 交易计划',
    description: '当前与历史 T 批次、计划档位、结算和成交记录。',
    privacy: 'personal',
    capability: 'tTrading',
    localState: 'tPlan'
  },
  {
    id: 'research.tracking',
    label: '股票追踪记录',
    description: '追踪来源、标签、投资逻辑、笔记、指标快照和停止结论。',
    privacy: 'personal',
    localState: 'tracking'
  },
  {
    id: 'fundamental.financials',
    label: '基本面财务',
    description: 'A 股年度/季度财务和行业基准，或港美股官方财务期间与指标。',
    privacy: 'market',
    capability: 'fundamentals'
  },
  {
    id: 'fundamental.valuation',
    label: '估值',
    description: '当前 PE/PB/PCF、市值、行业分位及历史估值样本。',
    privacy: 'market'
  },
  {
    id: 'fundamental.dividendFinancing',
    label: '分红融资',
    description: '累计分红融资、连续性、趋势、股息率与质量评分。',
    privacy: 'market',
    capability: 'dividendFinancing'
  },
  {
    id: 'fundamental.shareholders',
    label: '股东结构',
    description: '实际控制人、股东户数历史及前十大股东。',
    privacy: 'market',
    capability: 'shareholders'
  },
  {
    id: 'documents.companyReports',
    label: '公司报告',
    description: '定期报告/公告元数据、原文链接和本地已有的 AI 摘要。',
    privacy: 'market',
    capability: 'companyReports'
  },
  {
    id: 'corporate.actions',
    label: '公司行动',
    description: '拆并股、分红、换股、退市等候选与用户已处理记录。',
    privacy: 'personal',
    capability: 'corporateActions'
  },
  {
    id: 'screening.dailyMarketScan',
    label: '每日异动扫描',
    description: '该股票在最近一次每日扫描中的量价、突破、反转和形态信号。',
    privacy: 'market',
    localState: 'dailyScan'
  }
]

export const STOCK_DATA_TOOL: AiProviderTool = {
  name: TOOL_NAME,
  description:
    '读取当前消息已授权股票的详细数据。只可使用清单中的 stockRef 和 datasetId；一次调用应批量提交回答所需的全部数据集。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      requests: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_REQUESTS,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            stockRef: { type: 'string' },
            datasetId: { type: 'string' },
            detail: { type: 'string', enum: ['summary', 'full'] },
            period: {
              type: 'string',
              enum: ['intraday', 'fiveDay', 'daily', 'weekly', 'monthly']
            },
            limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT },
            cursor: { type: 'string' }
          },
          required: ['stockRef', 'datasetId']
        }
      }
    },
    required: ['requests']
  }
}

function page<T>(records: readonly T[], request: ParsedDatasetRequest): DatasetPage<T> {
  const offset = Math.min(request.cursor, records.length)
  const selected = records.slice(offset, offset + request.limit)
  const nextOffset = offset + selected.length
  return {
    total: records.length,
    offset,
    records: selected,
    nextCursor: nextOffset < records.length ? String(nextOffset) : null
  }
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`)
  }
  return value as Record<string, unknown>
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new Error(`${label} 必须是字符串`)
  return value
}

function parseRequests(argumentsJson: string): ParsedDatasetRequest[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(argumentsJson)
  } catch {
    throw new Error('股票数据工具参数不是有效 JSON')
  }
  const root = assertRecord(parsed, '股票数据工具参数')
  if (
    !Array.isArray(root.requests) ||
    root.requests.length < 1 ||
    root.requests.length > MAX_REQUESTS
  ) {
    throw new Error(`requests 数量必须为 1-${MAX_REQUESTS}`)
  }
  return root.requests.map((value, index) => {
    const item = assertRecord(value, `requests[${index}]`)
    const stockRef = optionalString(item.stockRef, `requests[${index}].stockRef`)
    const datasetId = optionalString(item.datasetId, `requests[${index}].datasetId`)
    if (!stockRef || !datasetId) throw new Error(`requests[${index}] 缺少 stockRef 或 datasetId`)
    const detail = optionalString(item.detail, `requests[${index}].detail`) ?? 'full'
    if (detail !== 'summary' && detail !== 'full') {
      throw new Error(`requests[${index}].detail 不受支持`)
    }
    const period = optionalString(item.period, `requests[${index}].period`) ?? 'daily'
    if (!['intraday', 'fiveDay', 'daily', 'weekly', 'monthly'].includes(period)) {
      throw new Error(`requests[${index}].period 不受支持`)
    }
    const limit = item.limit === undefined ? DEFAULT_LIMIT : item.limit
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new Error(`requests[${index}].limit 必须是 1-${MAX_LIMIT} 的整数`)
    }
    const cursorText = optionalString(item.cursor, `requests[${index}].cursor`) ?? '0'
    if (!/^\d+$/.test(cursorText)) throw new Error(`requests[${index}].cursor 无效`)
    return {
      stockRef,
      datasetId,
      detail,
      period: period as KlinePeriod,
      limit,
      cursor: Number(cursorText)
    }
  })
}

export class StockDataToolSession {
  readonly manifest: StockDataManifest
  private readonly targets = new Map<string, StockDataTarget>()
  private readonly accessed = new Map<string, Set<string>>()

  constructor(
    inputs: StockDataContextInput[],
    private readonly dependencies: AiModuleDependencies
  ) {
    const state = dependencies.getState()
    const generatedAt = new Date().toISOString()
    const contextId = `stock-data:${randomUUID()}`
    const stocks = inputs.map((request, index): StockDataManifestStock => {
      const stockRef = `stock-${index + 1}`
      const stock = state.watchlist.find((item) => item.quoteId === request.quoteId)
      const quote = dependencies.getLatestQuote(request.quoteId)
      const identity = stockMarketIdentity(request.quoteId, stock?.instrumentType)
      const target = { stockRef, request, stock }
      this.targets.set(stockRef, target)
      return {
        stockRef,
        source: request.source,
        identity: {
          quoteId: request.quoteId,
          code:
            request.code ?? stock?.code ?? quote?.code ?? request.quoteId.split('.').at(-1) ?? '',
          name: request.quoteName ?? stock?.name ?? quote?.name ?? request.quoteId,
          marketLabel: request.marketLabel ?? stock?.marketLabel ?? identity.market,
          market: identity.market,
          exchange: identity.exchange,
          currency: identity.currency
        },
        datasets: DATASETS.map((definition) => ({
          id: definition.id,
          label: definition.label,
          description: definition.description,
          availability: this.availability(definition, target),
          privacy: definition.privacy
        }))
      }
    })
    this.manifest = { schemaVersion: 1, contextId, generatedAt, stocks }
  }

  contextRefs(): AiContextRef[] {
    return this.manifest.stocks.map((stock) => ({
      quoteId: stock.identity.quoteId,
      quoteName: stock.identity.name,
      code: stock.identity.code,
      marketLabel: stock.identity.marketLabel,
      snapshotId: this.manifest.contextId,
      source: stock.source,
      datasetIds: [...(this.accessed.get(stock.stockRef) ?? [])]
    }))
  }

  snapshot(): unknown {
    return {
      manifest: this.manifest,
      accesses: this.manifest.stocks.map((stock) => ({
        stockRef: stock.stockRef,
        datasetIds: [...(this.accessed.get(stock.stockRef) ?? [])]
      }))
    }
  }

  async execute(call: AiProviderToolCall, signal: AbortSignal): Promise<string> {
    if (call.name !== TOOL_NAME) throw new Error(`不支持的工具：${call.name}`)
    const requests = parseRequests(call.arguments)
    const results = await Promise.all(
      requests.map(async (request) => {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
        const target = this.targets.get(request.stockRef)
        if (!target) {
          return { ok: false, ...request, error: 'stockRef 不在本条消息授权范围内' }
        }
        const manifestStock = this.manifest.stocks.find(
          (stock) => stock.stockRef === request.stockRef
        )
        const manifestDataset = manifestStock?.datasets.find(
          (dataset) => dataset.id === request.datasetId
        )
        if (!manifestDataset) {
          return { ok: false, ...request, error: 'datasetId 不在该股票的数据清单中' }
        }
        if (manifestDataset.availability === 'unsupported') {
          return { ok: false, ...request, error: '当前市场不支持该数据集' }
        }
        try {
          const data = await this.load(target, request)
          this.recordAccess(request.stockRef, request.datasetId)
          return {
            ok: true,
            stockRef: request.stockRef,
            datasetId: request.datasetId,
            generatedAt: new Date().toISOString(),
            data
          }
        } catch (error) {
          return {
            ok: false,
            stockRef: request.stockRef,
            datasetId: request.datasetId,
            error: error instanceof Error ? error.message : '数据读取失败'
          }
        }
      })
    )
    return JSON.stringify({ schemaVersion: 1, contextId: this.manifest.contextId, results })
  }

  private availability(
    definition: DatasetDefinition,
    target: StockDataTarget
  ): DatasetAvailability {
    const capabilities = marketCapabilitiesForQuoteId(target.request.quoteId)
    if (definition.capability && !capabilities[definition.capability]) return 'unsupported'
    const state = this.dependencies.getState()
    const account = state.tTradingAccounts[target.request.quoteId]
    switch (definition.localState) {
      case 'quote':
        return this.dependencies.getLatestQuote(target.request.quoteId) ? 'ready' : 'empty'
      case 'chip':
        return this.dependencies.getChipDistributionCache(target.request.quoteId)
          ? 'ready'
          : 'empty'
      case 'position':
        return target.stock?.position ||
          target.stock?.positionSnapshots?.length ||
          target.stock?.alertRules?.length
          ? 'ready'
          : 'empty'
      case 'ledger':
        return account?.ledger.entries.length ? 'ready' : 'empty'
      case 'tPlan':
        return account?.activeBatch || account?.history.length || account?.tradeRecords.length
          ? 'ready'
          : 'empty'
      case 'tracking':
        return state.stockTrackingProfiles[target.request.quoteId] ? 'ready' : 'empty'
      case 'dailyScan':
        return this.dependencies
          .getDailyMarketScanResult()
          ?.rows.some((row) => row.quoteId === target.request.quoteId)
          ? 'ready'
          : 'empty'
      default:
        return 'loadable'
    }
  }

  private recordAccess(stockRef: string, datasetId: string): void {
    const datasets = this.accessed.get(stockRef) ?? new Set<string>()
    datasets.add(datasetId)
    this.accessed.set(stockRef, datasets)
  }

  private async load(target: StockDataTarget, request: ParsedDatasetRequest): Promise<unknown> {
    const quoteId = target.request.quoteId
    const state = this.dependencies.getState()
    const stock = state.watchlist.find((item) => item.quoteId === quoteId) ?? target.stock
    const quote = this.dependencies.getLatestQuote(quoteId)
    const account = state.tTradingAccounts[quoteId]
    switch (request.datasetId) {
      case 'identity.watchlist':
        return {
          stock: stock
            ? {
                quoteId: stock.quoteId,
                code: stock.code,
                name: stock.name,
                marketLabel: stock.marketLabel,
                market: stock.market,
                exchange: stock.exchange,
                currency: stock.currency,
                instrumentType: stock.instrumentType,
                showInTaskbar: stock.showInTaskbar,
                isPriority: stock.isPriority,
                showRadarSignals: stock.showRadarSignals,
                alertRules: stock.alertRules ?? [],
                groupIds: stock.groupIds ?? [],
                addedAt: stock.addedAt,
                addedPrice: stock.addedPrice
              }
            : null,
          groups: (stock?.groupIds ?? []).map((id) => ({
            id,
            name: state.watchlistGroups.find((group) => group.id === id)?.name ?? null
          })),
          marketIdentity: stockMarketIdentity(quoteId, stock?.instrumentType)
        }
      case 'market.quote':
        return quote
      case 'market.kline': {
        const result = await this.dependencies.getKline(quoteId, request.period, request.limit)
        return {
          ...result,
          period: request.period,
          columns: ['time', 'open', 'high', 'low', 'close', 'volume', 'amount', 'turnoverRate'],
          rows: result.bars.map((bar) => [
            bar.time,
            bar.open,
            bar.high,
            bar.low,
            bar.close,
            bar.volume,
            bar.amount,
            bar.turnoverRate ?? null
          ]),
          bars: undefined
        }
      }
      case 'market.insight': {
        let snapshot = await this.dependencies.getMarketInsightSnapshot(quoteId)
        if (!snapshot) snapshot = await this.dependencies.refreshMarketInsightSnapshot(quoteId)
        return snapshot ? compactMarketSnapshot(snapshot, null) : null
      }
      case 'market.orderBook':
        return this.dependencies.getOrderBook(quoteId)
      case 'market.fundsFlow': {
        const result = await this.dependencies.getFundsFlow(quoteId)
        const points = page(result.points, request)
        return {
          quoteId: result.quoteId,
          name: result.name,
          tradingDate: result.tradingDate,
          columns: ['time', 'main', 'superLarge', 'large', 'medium', 'small'],
          ...points,
          records: points.records.map((point) => [
            point.time,
            point.main,
            point.superLarge,
            point.large,
            point.medium,
            point.small
          ])
        }
      }
      case 'market.sector': {
        const result = await this.dependencies.getSectorIndex(quoteId)
        const trend = page(result.trend.bars, request)
        return { ...result, trend: { ...result.trend, bars: trend } }
      }
      case 'market.chipDistribution': {
        const chip = this.dependencies.getChipDistributionCache(quoteId)
        return chip ? { ...chip, buckets: page(chip.buckets, request) } : null
      }
      case 'portfolio.position': {
        const quotes = state.watchlist.flatMap((item) => {
          const current = this.dependencies.getLatestQuote(item.quoteId)
          return current ? [current] : []
        })
        const report = calculatePortfolioPerformanceReport(
          state.watchlist,
          quotes,
          state.tTradingAccounts,
          state.settings.exchangeRates,
          state.portfolioPerformanceAdjustments ?? {}
        )
        return {
          position: stock?.position ?? null,
          positionSnapshots: stock?.positionSnapshots ?? [],
          alertRules: stock?.alertRules ?? [],
          performance: report.stocks.find((item) => item.quoteId === quoteId) ?? null,
          manualCnyAdjustment: state.portfolioPerformanceAdjustments?.[quoteId] ?? 0
        }
      }
      case 'portfolio.ledger':
        return account
          ? {
              account: { quoteId: account.quoteId, code: account.code, name: account.name },
              entries: page(account.ledger.entries, request)
            }
          : null
      case 'trading.tPlan':
        return account
          ? {
              activeBatch: account.activeBatch ?? null,
              history: page(account.history, request),
              tradeRecords: page(account.tradeRecords, request)
            }
          : null
      case 'research.tracking': {
        const profile = state.stockTrackingProfiles[quoteId]
        return profile
          ? {
              ...profile,
              sources: page(profile.sources, request),
              entries: page(profile.entries, request),
              metricSnapshots: page(profile.metricSnapshots, request)
            }
          : null
      }
      case 'fundamental.financials': {
        const market = stockMarketIdentity(quoteId).market
        if (market !== 'CN') return this.dependencies.getGlobalFundamentals(quoteId)
        const snapshot = await this.dependencies.getFundamentalSnapshot()
        const company = snapshot?.rows.find((row) => row.quoteId === quoteId) ?? null
        return {
          state: this.dependencies.getFundamentalState(),
          snapshot: snapshot
            ? {
                schemaVersion: snapshot.schemaVersion,
                snapshotDate: snapshot.snapshotDate,
                generatedAt: snapshot.generatedAt,
                currency: snapshot.currency,
                fiscalYears: snapshot.fiscalYears,
                latestAnnualReportDate: snapshot.latestAnnualReportDate,
                latestQuarterlyReportDate: snapshot.latestQuarterlyReportDate,
                sources: snapshot.sources
              }
            : null,
          company,
          industry: snapshot?.industries.find((item) => item.code === company?.industryCode) ?? null
        }
      }
      case 'fundamental.valuation': {
        const history = await this.dependencies.getValuationHistory(quoteId)
        const paginateValues = (values: number[]) => page(values, request)
        const fundamentalSnapshot =
          stockMarketIdentity(quoteId).market === 'CN'
            ? await this.dependencies.getFundamentalSnapshot()
            : null
        return {
          quote: quote
            ? {
                dataAt: quote.dataAt ?? quote.updatedAt,
                latest: quote.latest,
                totalMarketValue: quote.totalMarketValue ?? null,
                priceEarningsRatioTtm: quote.priceEarningsRatioTtm ?? null,
                priceBookRatio: quote.priceBookRatio ?? null
              }
            : null,
          snapshotValuation:
            fundamentalSnapshot?.rows.find((row) => row.quoteId === quoteId)?.valuation ?? null,
          history: {
            quoteId: history.quoteId,
            fetchedAt: history.fetchedAt,
            periodStart: history.periodStart,
            periodEnd: history.periodEnd,
            priceEarningsRatioTtmValues: paginateValues(history.priceEarningsRatioTtmValues),
            priceBookRatioValues: paginateValues(history.priceBookRatioValues),
            priceCashFlowRatioTtmValues: paginateValues(history.priceCashFlowRatioTtmValues)
          }
        }
      }
      case 'fundamental.dividendFinancing': {
        const snapshot = await this.dependencies.getDividendFinancingSnapshot()
        return {
          state: this.dependencies.getDividendFinancingState(),
          snapshot: snapshot
            ? {
                schemaVersion: snapshot.schemaVersion,
                snapshotDate: snapshot.snapshotDate,
                generatedAt: snapshot.generatedAt,
                thresholdPercent: snapshot.thresholdPercent
              }
            : null,
          row: snapshot?.rows.find((item) => item.code === (stock?.code ?? quote?.code)) ?? null
        }
      }
      case 'fundamental.shareholders': {
        const snapshot = await this.dependencies.getShareholderSnapshot(quoteId)
        return {
          ...snapshot,
          holderHistory: page(snapshot.holderHistory, request),
          topShareholders: page(snapshot.topShareholders, request),
          topFreeShareholders: page(snapshot.topFreeShareholders, request)
        }
      }
      case 'documents.companyReports': {
        const library = await this.dependencies.getCompanyReports(quoteId)
        return {
          ...library,
          reports: page(library.reports, request),
          savedSummaries: page(
            this.dependencies.getCompanyReportSummaries(stock?.code ?? quote?.code ?? ''),
            request
          )
        }
      }
      case 'corporate.actions': {
        const remote = await this.dependencies.listCorporateActions(quoteId)
        const saved = Object.values(state.corporateActionRecords).filter(
          (record) => record.quoteId === quoteId
        )
        return {
          provider: { ...remote, candidates: page(remote.candidates, request) },
          savedRecords: page(saved, request)
        }
      }
      case 'screening.dailyMarketScan': {
        const result = this.dependencies.getDailyMarketScanResult()
        return result
          ? {
              schemaVersion: result.schemaVersion,
              tradingDate: result.tradingDate,
              generatedAt: result.generatedAt,
              source: result.source,
              row: result.rows.find((item) => item.quoteId === quoteId) ?? null
            }
          : null
      }
      default:
        throw new Error(`未实现的数据集：${request.datasetId}`)
    }
  }
}
