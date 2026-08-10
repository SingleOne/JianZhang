import type {
  ShareholderCountPoint,
  ShareholderHolding,
  ShareholderMarket,
  ShareholderSnapshot
} from '../../src/shared/types'

interface EastmoneyShareholderCountRow {
  END_DATE?: string
  HOLDER_TOTAL_NUM?: number | null
  TOTAL_NUM_RATIO?: number | null
  AVG_FREE_SHARES?: number | null
  AVG_FREESHARES_RATIO?: number | null
  HOLD_FOCUS?: string | null
  AVG_HOLD_AMT?: number | null
  HOLD_RATIO_TOTAL?: number | null
  FREEHOLD_RATIO_TOTAL?: number | null
}

interface EastmoneyShareholderHoldingRow {
  END_DATE?: string
  HOLDER_RANK?: number | null
  HOLDER_NAME?: string | null
  HOLDER_TYPE?: string | null
  SHARES_TYPE?: string | null
  HOLD_NUM?: number | null
  HOLD_NUM_RATIO?: number | null
  FREE_HOLDNUM_RATIO?: number | null
  HOLD_NUM_CHANGE?: number | string | null
  CHANGE_RATIO?: number | null
}

interface EastmoneyControllerRow {
  HOLDER_NAME?: string | null
  HOLD_RATIO?: number | null
}

export interface EastmoneyShareholderPayload {
  gdrs?: EastmoneyShareholderCountRow[]
  sjkzr?: EastmoneyControllerRow[]
  sdgd?: EastmoneyShareholderHoldingRow[]
  sdltgd?: EastmoneyShareholderHoldingRow[]
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function reportDate(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 10) : ''
}

function normalizeCountPoint(row: EastmoneyShareholderCountRow): ShareholderCountPoint | null {
  const date = reportDate(row.END_DATE)
  const holderCount = finiteNumber(row.HOLDER_TOTAL_NUM)
  if (!date || holderCount === null) return null
  return {
    reportDate: date,
    holderCount,
    changePercent: finiteNumber(row.TOTAL_NUM_RATIO),
    averageFreeShares: finiteNumber(row.AVG_FREE_SHARES),
    averageFreeSharesChangePercent: finiteNumber(row.AVG_FREESHARES_RATIO),
    concentration: row.HOLD_FOCUS?.trim() || null,
    averageHoldingAmount: finiteNumber(row.AVG_HOLD_AMT),
    topTenHoldingRatio: finiteNumber(row.HOLD_RATIO_TOTAL),
    topTenFreeHoldingRatio: finiteNumber(row.FREEHOLD_RATIO_TOTAL)
  }
}

function normalizeHoldingChange(value: number | string | null | undefined): {
  changeShares: number | null
  changeLabel: string | null
} {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { changeShares: value, changeLabel: null }
  }
  if (typeof value !== 'string' || !value.trim()) {
    return { changeShares: null, changeLabel: null }
  }
  const text = value.trim()
  const numeric = Number(text)
  return Number.isFinite(numeric)
    ? { changeShares: numeric, changeLabel: null }
    : { changeShares: null, changeLabel: text }
}

function normalizeHolding(
  row: EastmoneyShareholderHoldingRow,
  freeShareholder: boolean
): ShareholderHolding | null {
  const date = reportDate(row.END_DATE)
  const rank = finiteNumber(row.HOLDER_RANK)
  const name = row.HOLDER_NAME?.trim()
  const holdingShares = finiteNumber(row.HOLD_NUM)
  if (!date || rank === null || !name || holdingShares === null) return null
  const change = normalizeHoldingChange(row.HOLD_NUM_CHANGE)
  return {
    reportDate: date,
    rank,
    name,
    holderType: row.HOLDER_TYPE?.trim() || null,
    sharesType: row.SHARES_TYPE?.trim() || null,
    holdingShares,
    holdingRatio: finiteNumber(freeShareholder ? row.FREE_HOLDNUM_RATIO : row.HOLD_NUM_RATIO),
    changeShares: change.changeShares,
    changeLabel: change.changeLabel,
    changeRatio: finiteNumber(row.CHANGE_RATIO)
  }
}

export function eastmoneyShareholderCode(quoteId: string): {
  code: string
  market: ShareholderMarket
  eastmoneyCode: string
} {
  const [marketId, code] = quoteId.split('.')
  if (!/^\d{6}$/.test(code ?? '') || (marketId !== '0' && marketId !== '1')) {
    throw new Error('股票代码格式无效')
  }
  const market: ShareholderMarket = marketId === '1' ? 'SH' : /^[89]/.test(code) ? 'BJ' : 'SZ'
  return { code, market, eastmoneyCode: `${market}${code}` }
}

export function normalizeEastmoneyShareholderPayload(
  quoteId: string,
  payload: EastmoneyShareholderPayload,
  fetchedAt: string
): ShareholderSnapshot {
  const identity = eastmoneyShareholderCode(quoteId)
  const holderHistory = (payload.gdrs ?? [])
    .flatMap((row) => normalizeCountPoint(row) ?? [])
    .sort((left, right) => left.reportDate.localeCompare(right.reportDate))
  const topShareholders = (payload.sdgd ?? [])
    .flatMap((row) => normalizeHolding(row, false) ?? [])
    .sort((left, right) => left.rank - right.rank)
  const topFreeShareholders = (payload.sdltgd ?? [])
    .flatMap((row) => normalizeHolding(row, true) ?? [])
    .sort((left, right) => left.rank - right.rank)
  const controllerRow = payload.sjkzr?.find((row) => row.HOLDER_NAME?.trim())
  const latestSummary = holderHistory.at(-1) ?? null
  const periodDates = [
    latestSummary?.reportDate,
    topShareholders[0]?.reportDate,
    topFreeShareholders[0]?.reportDate
  ].filter((date): date is string => Boolean(date))

  if (periodDates.length === 0 && !controllerRow) {
    throw new Error('暂无公开股东数据')
  }

  return {
    schemaVersion: 1,
    quoteId,
    code: identity.code,
    market: identity.market,
    reportDate: periodDates.sort().at(-1) ?? '',
    fetchedAt,
    source: 'eastmoney-f10',
    fromCache: false,
    controller: controllerRow
      ? {
          name: controllerRow.HOLDER_NAME!.trim(),
          holdingRatio: finiteNumber(controllerRow.HOLD_RATIO)
        }
      : null,
    latestSummary,
    holderHistory,
    topShareholders,
    topFreeShareholders
  }
}
