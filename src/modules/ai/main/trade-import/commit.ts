import { appendPortfolioLedgerEntries, withLedgerTradeRecords } from '../../../../shared/types'
import type {
  AppState,
  BrokerImportProvenance,
  PortfolioLedgerEntry,
  StockCurrency,
  StockMarket,
  TTrade,
  TTradingAccount,
  WatchStock
} from '../../../../shared/types'
import { currencyForMarket, marketFromQuoteId } from '../../../../shared/stock-market'
import {
  marketTradeQuantityError,
  estimateSettlementDate,
  settlementRuleForTradeDate
} from '../../../../lib/market-trades'
import {
  activePortfolioLedgerEntries,
  calculatePortfolioLedgerPosition
} from '../../../../lib/portfolio-ledger'
import { createInitialPositionAccount } from '../../../../lib/position-ledger'
import { roundMoney, totalRecordedTradeFees } from '../../../../lib/t-trading'
import { upsertTradeRecord } from '../../../../lib/trade-records'
import type {
  AiTradeImportDraft,
  AiTradeImportItem,
  AiTradeImportIssue,
  AiTradeImportSourceBinding
} from '../../shared/types'

const EMPTY_FEES = {
  commission: 0,
  handling: 0,
  regulatory: 0,
  transfer: 0,
  stampDuty: 0
}

export interface AppliedTradeImport {
  state: AppState
  entryCount: number
  affectedStocks: Array<{ quoteId: string; name: string }>
}

export interface TradeImportPreview {
  items: AiTradeImportItem[]
  impacts: AiTradeImportDraft['impacts']
}

function normalizedCode(value: string | undefined): string {
  return (value ?? '')
    .trim()
    .toUpperCase()
    .replace(/^(?:SH|SZ|BJ|HK|US)[.:]?/, '')
    .replace(/\.(?:SH|SZ|BJ|HK|US)$/, '')
}

function resolveStock(state: AppState, item: AiTradeImportItem): WatchStock | undefined {
  if (item.quoteId) {
    const selected = state.watchlist.find((stock) => stock.quoteId === item.quoteId)
    if (selected) return selected
  }
  const code = normalizedCode(item.stockCode)
  const byCode = code ? state.watchlist.filter((stock) => normalizedCode(stock.code) === code) : []
  if (byCode.length === 1) return byCode[0]
  const name = item.stockName?.trim()
  if (name) {
    const byName = state.watchlist.filter((stock) => stock.name.trim() === name)
    if (byName.length === 1) return byName[0]
    const narrowed = byCode.filter((stock) => stock.name.trim() === name)
    if (narrowed.length === 1) return narrowed[0]
  }
  return undefined
}

function identity(stock: WatchStock): {
  market: StockMarket
  currency: StockCurrency
} {
  const market = stock.market ?? marketFromQuoteId(stock.quoteId)
  return { market, currency: stock.currency ?? currencyForMarket(market) }
}

function validOccurredAt(value: string | undefined): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value)) {
    return false
  }
  return !Number.isNaN(new Date(value).getTime())
}

function issue(
  severity: AiTradeImportIssue['severity'],
  message: string,
  field?: string
): AiTradeImportIssue {
  return { severity, message, field }
}

function numericKey(value: number | undefined): string {
  return value === undefined ? '' : Number(value).toFixed(6)
}

function itemFingerprint(item: AiTradeImportItem): string {
  return [
    item.kind,
    item.occurredAt,
    item.side,
    numericKey(item.price),
    numericKey(item.quantity),
    numericKey(item.fees),
    numericKey(item.amount)
  ].join('|')
}

function entryFingerprint(entry: PortfolioLedgerEntry): string | null {
  if (entry.kind === 'trade') {
    return [
      'trade',
      entry.record.tradedAt,
      entry.record.side,
      numericKey(entry.record.price),
      numericKey(entry.record.quantity),
      numericKey(totalRecordedTradeFees(entry.record)),
      ''
    ].join('|')
  }
  if (entry.kind === 'cashDividend' || entry.kind === 'withholdingTax') {
    return [entry.kind, entry.occurredAt, '', '', '', '', numericKey(entry.amount)].join('|')
  }
  return null
}

function duplicateIssues(
  account: TTradingAccount | undefined,
  item: AiTradeImportItem,
  source: AiTradeImportSourceBinding | undefined
): AiTradeImportIssue[] {
  if (!account) return []
  const entries = account.ledger.entries
  if (item.externalId) {
    const sameExternalId = entries.filter(
      (entry) =>
        entry.source === 'brokerImport' &&
        entry.kind === item.kind &&
        entry.externalId === item.externalId
    )
    if (sameExternalId.some((entry) => entryFingerprint(entry) === itemFingerprint(item))) {
      return [issue('error', `券商成交编号 ${item.externalId} 的相同流水已经导入`, 'externalId')]
    }
    if (sameExternalId.length > 0) {
      return [issue('warning', `账本中已有相同券商编号 ${item.externalId}，请确认是否为分笔成交`)]
    }
  }
  if (
    source &&
    item.sourceLocator &&
    entries.some(
      (entry) =>
        entry.brokerImport?.sourceHash === source.hash &&
        entry.brokerImport.sourceLocator === item.sourceLocator
    )
  ) {
    return [issue('error', '同一来源位置已经导入', 'sourceLocator')]
  }
  const fingerprint = itemFingerprint(item)
  if (entries.some((entry) => entryFingerprint(entry) === fingerprint)) {
    return [issue('warning', '账本中存在时间和金额完全相同的流水，请确认是否重复')]
  }
  return []
}

export function validateTradeImportItems(
  state: AppState,
  items: readonly AiTradeImportItem[],
  sources: readonly AiTradeImportSourceBinding[]
): AiTradeImportItem[] {
  const sourcesById = new Map(sources.map((source) => [source.id, source]))
  const externalIds = new Map<string, string>()
  const sourceLocations = new Set<string>()

  return items.map((item) => {
    const issues: AiTradeImportIssue[] = []
    const stock = resolveStock(state, item)
    const source = sourcesById.get(item.sourceId)
    if (item.kind !== 'trade' && item.kind !== 'cashDividend' && item.kind !== 'withholdingTax') {
      issues.push(issue('error', '无法确认流水类型', 'kind'))
    }
    if (!source) issues.push(issue('error', '无法确认原始文件来源', 'sourceId'))
    if (!stock) issues.push(issue('error', '无法匹配自选股票，请手动选择', 'quoteId'))
    if (!validOccurredAt(item.occurredAt)) {
      issues.push(issue('error', '请填写完整的发生日期和时间', 'occurredAt'))
    }
    if (item.confidence === 'low') {
      issues.push(issue('warning', 'AI 对这条记录的识别置信度较低，请核对原文'))
    }

    let nextItem = { ...item }
    if (stock) {
      const marketIdentity = identity(stock)
      nextItem = {
        ...nextItem,
        quoteId: stock.quoteId,
        stockCode: stock.code,
        stockName: stock.name,
        currency: nextItem.currency ?? marketIdentity.currency,
        exchangeRate: marketIdentity.currency === 'CNY' ? 1 : nextItem.exchangeRate
      }
      if (nextItem.currency !== marketIdentity.currency) {
        issues.push(
          issue(
            'error',
            `币种应为 ${marketIdentity.currency}，当前为 ${nextItem.currency}`,
            'currency'
          )
        )
      }
      if (
        marketIdentity.currency !== 'CNY' &&
        (!Number.isFinite(nextItem.exchangeRate) || (nextItem.exchangeRate ?? 0) <= 0)
      ) {
        issues.push(issue('error', '港股或美股流水必须确认成交汇率', 'exchangeRate'))
      }

      if (nextItem.kind === 'trade') {
        if (nextItem.side !== 'buy' && nextItem.side !== 'sell') {
          issues.push(issue('error', '请确认买入或卖出方向', 'side'))
        }
        if (!Number.isFinite(nextItem.price) || (nextItem.price ?? 0) <= 0) {
          issues.push(issue('error', '请输入有效的成交价格', 'price'))
        }
        const quantityError = marketTradeQuantityError(
          marketIdentity.market,
          nextItem.quantity ?? Number.NaN
        )
        if (quantityError) issues.push(issue('error', quantityError, 'quantity'))
        if (nextItem.fees === undefined) {
          issues.push(issue('warning', '券商实际费用缺失，将按 0 导入，请确认', 'fees'))
        } else if (!Number.isFinite(nextItem.fees) || nextItem.fees < 0) {
          issues.push(issue('error', '请输入有效的实际费用', 'fees'))
        }
      } else {
        if (!Number.isFinite(nextItem.amount) || (nextItem.amount ?? 0) <= 0) {
          issues.push(
            issue(
              'error',
              nextItem.kind === 'cashDividend'
                ? '请输入有效的税前分红金额'
                : '请输入有效的红利税金额',
              'amount'
            )
          )
        }
        if (
          nextItem.kind === 'cashDividend' &&
          nextItem.eligibleQuantity !== undefined &&
          (!Number.isFinite(nextItem.eligibleQuantity) || nextItem.eligibleQuantity < 0)
        ) {
          issues.push(issue('error', '请输入有效的登记股数', 'eligibleQuantity'))
        }
      }

      issues.push(...duplicateIssues(state.tTradingAccounts[stock.quoteId], nextItem, source))
    }

    if (stock && nextItem.externalId) {
      const key = `${stock.quoteId}:${nextItem.kind}:${nextItem.externalId}`
      const existingFingerprint = externalIds.get(key)
      if (existingFingerprint === itemFingerprint(nextItem)) {
        issues.push(issue('error', '本次草稿中存在相同券商编号和内容的重复流水'))
      } else if (existingFingerprint) {
        issues.push(issue('warning', '本次草稿中存在相同券商编号，请确认是否为分笔成交'))
      }
      externalIds.set(key, itemFingerprint(nextItem))
    }
    if (source && nextItem.sourceLocator) {
      const key = `${source.hash}:${nextItem.sourceLocator}`
      if (sourceLocations.has(key)) issues.push(issue('error', '本次草稿中存在重复的来源位置'))
      sourceLocations.add(key)
    }

    return { ...nextItem, issues }
  })
}

export function previewTradeImport(
  state: AppState,
  importId: string,
  items: readonly AiTradeImportItem[],
  sources: readonly AiTradeImportSourceBinding[]
): TradeImportPreview {
  let validated = validateTradeImportItems(state, items, sources)
  const selected = validated.filter((item) => item.selected)
  if (
    selected.length === 0 ||
    selected.some((item) => item.issues.some((entry) => entry.severity === 'error'))
  ) {
    return { items: validated, impacts: [] }
  }
  try {
    const applied = applyTradeImportToState(state, importId, validated, sources)
    return {
      items: validated,
      impacts: applied.affectedStocks.map(({ quoteId, name }) => {
        const before = state.watchlist.find((stock) => stock.quoteId === quoteId)?.position
        const after = applied.state.watchlist.find((stock) => stock.quoteId === quoteId)?.position
        return {
          quoteId,
          name,
          beforeQuantity: before?.quantity ?? 0,
          beforeCost: before?.cost ?? null,
          afterQuantity: after?.quantity ?? 0,
          afterCost: after?.cost ?? null
        }
      })
    }
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : '导入后账本校验失败'
    const targetId = selected[0]?.id
    validated = validated.map((item) =>
      item.id === targetId ? { ...item, issues: [...item.issues, issue('error', message)] } : item
    )
    return { items: validated, impacts: [] }
  }
}

function createAccount(stock: WatchStock): TTradingAccount {
  const { market, currency } = identity(stock)
  return {
    quoteId: stock.quoteId,
    code: stock.code,
    name: stock.name,
    market,
    currency,
    history: [],
    ledger: { schemaVersion: 1, entries: [] },
    tradeRecords: []
  }
}

function hasPositionEntries(account: TTradingAccount): boolean {
  return activePortfolioLedgerEntries(account).some(
    (entry) =>
      entry.kind === 'trade' ||
      entry.kind === 'positionAdjustment' ||
      entry.kind === 'shareAdjustment' ||
      entry.kind === 'rightsSubscription' ||
      entry.kind === 'securityConversion'
  )
}

export function applyTradeImportToState(
  state: AppState,
  importId: string,
  items: readonly AiTradeImportItem[],
  sources: readonly AiTradeImportSourceBinding[]
): AppliedTradeImport {
  const validated = validateTradeImportItems(state, items, sources)
  const selected = validated.filter((item) => item.selected)
  if (selected.length === 0) throw new Error('请至少选择一条可以导入的流水')
  const invalid = selected.find((item) => item.issues.some((entry) => entry.severity === 'error'))
  if (invalid)
    throw new Error(`“${invalid.stockName ?? invalid.stockCode ?? '未匹配股票'}”仍有待处理错误`)

  const sourcesById = new Map(sources.map((source) => [source.id, source]))
  const groups = new Map<string, AiTradeImportItem[]>()
  for (const item of selected) {
    const group = groups.get(item.quoteId!) ?? []
    group.push(item)
    groups.set(item.quoteId!, group)
  }

  const accounts = { ...state.tTradingAccounts }
  const positions = new Map<
    string,
    ReturnType<typeof calculatePortfolioLedgerPosition>['position']
  >()
  const recordedAt = new Date().toISOString()
  let entryIndex = 0

  for (const [quoteId, group] of groups) {
    const stock = state.watchlist.find((candidate) => candidate.quoteId === quoteId)!
    const { market, currency } = identity(stock)
    let account = accounts[quoteId] ?? createAccount(stock)
    if (stock.position && !hasPositionEntries(account)) {
      account = createInitialPositionAccount(
        account,
        { quoteId, code: stock.code, name: stock.name, market, currency },
        stock.position,
        group[0].occurredAt!
      )
    }

    for (const item of group) {
      const source = sourcesById.get(item.sourceId)!
      const suffix = (++entryIndex).toString().padStart(5, '0')
      const provenance: BrokerImportProvenance = {
        importId,
        recordedAt,
        sourceId: source.id,
        sourceName: source.name,
        sourceHash: source.hash,
        sourceLocator: item.sourceLocator,
        externalId: item.externalId
      }
      const common = {
        accountId: quoteId,
        quoteId,
        occurredAt: item.occurredAt!,
        marketDate: item.occurredAt!.slice(0, 10),
        recordedAt,
        source: 'brokerImport' as const,
        externalId: item.externalId ?? `${importId}:${suffix}`,
        brokerImport: provenance,
        currency,
        exchangeRate: currency === 'CNY' ? 1 : item.exchangeRate,
        exchangeRateDate: item.occurredAt!.slice(0, 10),
        note: item.note?.trim() || undefined
      }

      if (item.kind === 'trade') {
        const actualFees = roundMoney(item.fees ?? 0)
        const record: TTrade = {
          id: `broker:${importId}:${suffix}`,
          side: item.side!,
          purpose: 'base',
          tradedAt: item.occurredAt!,
          price: item.price!,
          quantity: item.quantity!,
          fees: market === 'CN' ? { ...EMPTY_FEES, commission: actualFees } : { ...EMPTY_FEES },
          feeItems:
            market !== 'CN' && actualFees > 0
              ? [{ code: 'manual', label: '券商实际费用', amount: actualFees }]
              : undefined,
          feeSource: market !== 'CN' && item.fees !== undefined ? 'actual' : undefined,
          market,
          currency,
          marketDate: item.occurredAt!.slice(0, 10),
          exchangeRate: currency === 'CNY' ? 1 : item.exchangeRate,
          exchangeRateDate: item.occurredAt!.slice(0, 10),
          estimatedSettlementDate: estimateSettlementDate(
            market,
            item.occurredAt!.slice(0, 10),
            state.settings.tradingCalendar
          ),
          settlementRule: settlementRuleForTradeDate(market, item.occurredAt!.slice(0, 10)),
          origin: 'execution',
          brokerImport: provenance,
          note: item.note?.trim() || '券商流水导入'
        }
        account = withLedgerTradeRecords(account, upsertTradeRecord(account.tradeRecords, record))
        continue
      }

      const amount = roundMoney(item.amount!)
      account = appendPortfolioLedgerEntries(account, [
        item.kind === 'cashDividend'
          ? {
              ...common,
              id: `cash-dividend:broker:${importId}:${suffix}`,
              kind: 'cashDividend',
              eligibleQuantity: item.eligibleQuantity ?? 0,
              amountPerShare:
                (item.eligibleQuantity ?? 0) > 0 ? amount / item.eligibleQuantity! : 0,
              amount
            }
          : {
              ...common,
              id: `withholding-tax:broker:${importId}:${suffix}`,
              kind: 'withholdingTax',
              amount
            }
      ])
    }

    const replay = calculatePortfolioLedgerPosition(account, market, currency)
    if (replay.error) throw new Error(`${stock.name} 导入后账本校验失败：${replay.error}`)
    accounts[quoteId] = account
    positions.set(quoteId, replay.position)
  }

  return {
    state: {
      ...state,
      tTradingAccounts: accounts,
      watchlist: state.watchlist.map((stock) =>
        positions.has(stock.quoteId)
          ? {
              ...stock,
              position: positions.get(stock.quoteId),
              isPriority: positions.get(stock.quoteId) ? true : stock.isPriority
            }
          : stock
      )
    },
    entryCount: selected.length,
    affectedStocks: [...groups.keys()].map((quoteId) => {
      const stock = state.watchlist.find((candidate) => candidate.quoteId === quoteId)!
      return { quoteId, name: stock.name }
    })
  }
}
