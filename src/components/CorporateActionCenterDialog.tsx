import { CircleDollarSign, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  CORPORATE_ACTION_STATUS_LABELS,
  CORPORATE_ACTION_TYPE_LABELS
} from '../lib/corporate-actions'
import { stockApi } from '../lib/api'
import { marketFromQuoteId, STOCK_MARKET_LABELS } from '../shared/stock-market'
import type {
  CorporateActionCandidate,
  CorporateActionListResult,
  CorporateActionRecords,
  CorporateActionType,
  StockMarket,
  WatchStock
} from '../shared/types'
import './CorporateActionCenterDialog.css'

interface CorporateActionCenterDialogProps {
  open: boolean
  watchlist: WatchStock[]
  records: CorporateActionRecords
  onViewStock: (quoteId: string) => void
  onClose: () => void
}

type MarketFilter = 'all' | StockMarket
type TypeFilter = 'all' | CorporateActionType
type CorporateActionLoadResult = {
  stock: WatchStock
  result: PromiseSettledResult<CorporateActionListResult>
}

async function listAtLowConcurrency(
  stocks: readonly WatchStock[]
): Promise<CorporateActionLoadResult[]> {
  const results: CorporateActionLoadResult[] = []
  for (let index = 0; index < stocks.length; index += 3) {
    const batch = stocks.slice(index, index + 3)
    const settled = await Promise.allSettled(
      batch.map((stock) => stockApi.listCorporateActions(stock.quoteId))
    )
    results.push(...settled.map((result, batchIndex) => ({ stock: batch[batchIndex], result })))
  }
  return results
}

function stockLabel(stock: WatchStock): string {
  return stock.name ? `${stock.name}（${stock.code}）` : stock.quoteId
}

function failureReason(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : '未知错误'
  return message.length > 80 ? `${message.slice(0, 80)}…` : message
}

export default function CorporateActionCenterDialog({
  open,
  watchlist,
  records,
  onViewStock,
  onClose
}: CorporateActionCenterDialogProps) {
  const [candidates, setCandidates] = useState<CorporateActionCandidate[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [marketFilter, setMarketFilter] = useState<MarketFilter>('all')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [onClose, open])

  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    setError('')
    const globalStocks = watchlist.filter((stock) => marketFromQuoteId(stock.quoteId) !== 'CN')
    void listAtLowConcurrency(globalStocks)
      .then((results) => {
        if (!active) return
        const successful = results.flatMap(({ result }) =>
          result.status === 'fulfilled' ? result.value.candidates : []
        )
        const failures = results.filter(({ result }) => result.status === 'rejected')
        setCandidates(successful)
        if (failures.length > 0) {
          const details = failures
            .map(({ stock, result }) =>
              result.status === 'rejected'
                ? `${stockLabel(stock)}：${failureReason(result.reason)}`
                : stockLabel(stock)
            )
            .join('；')
          setError(`${failures.length} 只股票请求失败（成功但无候选不会计入失败）：${details}`)
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [open, watchlist])

  const stockMap = useMemo(
    () => new Map(watchlist.map((stock) => [stock.quoteId, stock] as const)),
    [watchlist]
  )
  const rows = useMemo(() => {
    const merged: CorporateActionCandidate[] = candidates.map((candidate) => {
      const saved = records[candidate.id] as CorporateActionCandidate | undefined
      if (!saved) return candidate
      return saved.contentHash === candidate.contentHash
        ? saved
        : {
            ...candidate,
            status: 'revised',
            reviewedAt: saved.reviewedAt,
            appliedEntryIds: saved.appliedEntryIds
          }
    })
    const persisted = Object.values(records).filter(
      (record) =>
        stockMap.has(record.quoteId) && !merged.some((candidate) => candidate.id === record.id)
    )
    const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN')
    return [...merged, ...persisted]
      .filter((candidate) => ['detected', 'needsReview', 'revised'].includes(candidate.status))
      .filter((candidate) => marketFilter === 'all' || candidate.market === marketFilter)
      .filter((candidate) => typeFilter === 'all' || candidate.type === typeFilter)
      .filter((candidate) => {
        if (!normalizedQuery) return true
        const stock = stockMap.get(candidate.quoteId)
        return `${stock?.name ?? ''} ${stock?.code ?? ''} ${candidate.title}`
          .toLocaleLowerCase('zh-CN')
          .includes(normalizedQuery)
      })
      .sort((left, right) => right.announcementDate.localeCompare(left.announcementDate))
  }, [candidates, marketFilter, query, records, stockMap, typeFilter])

  if (!open) return null

  return createPortal(
    <div
      className="corporate-action-center-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className="corporate-action-center-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="corporate-action-center-title"
      >
        <header>
          <div>
            <CircleDollarSign size={20} />
            <span>
              <strong id="corporate-action-center-title">公司行动待确认中心</strong>
              <small>逐条查看官方证据并确认，不提供批量自动入账</small>
            </span>
          </div>
          <button className="icon-button" type="button" aria-label="关闭" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="corporate-action-center-filters">
          <label>
            <Search size={15} />
            <input
              type="search"
              value={query}
              placeholder="搜索股票或公告"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <select
            value={marketFilter}
            onChange={(event) => setMarketFilter(event.target.value as MarketFilter)}
          >
            <option value="all">全部市场</option>
            <option value="HK">港股</option>
            <option value="US">美股</option>
          </select>
          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value as TypeFilter)}
          >
            <option value="all">全部事件</option>
            {Object.entries(CORPORATE_ACTION_TYPE_LABELS).map(([type, label]) => (
              <option value={type} key={type}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {error ? <div className="corporate-action-center-error">{error}</div> : null}
        <div className="corporate-action-center-list">
          {rows.map((candidate) => {
            const stock = stockMap.get(candidate.quoteId)
            return (
              <button
                type="button"
                onClick={() => onViewStock(candidate.quoteId)}
                key={candidate.id}
              >
                <span>
                  <strong>
                    {stock?.name ?? candidate.quoteId} · {stock?.code ?? ''}
                  </strong>
                  <small>
                    {STOCK_MARKET_LABELS[candidate.market]} ·{' '}
                    {CORPORATE_ACTION_TYPE_LABELS[candidate.type]} · {candidate.announcementDate}
                  </small>
                </span>
                <span>
                  <em>{CORPORATE_ACTION_STATUS_LABELS[candidate.status]}</em>
                  <small>{candidate.title}</small>
                </span>
              </button>
            )
          })}
          {!loading && rows.length === 0 ? (
            <div className="corporate-action-center-empty">当前筛选条件下没有待确认事件。</div>
          ) : null}
          {loading ? (
            <div className="corporate-action-center-empty">正在汇总港美股官方候选…</div>
          ) : null}
        </div>
      </section>
    </div>,
    document.body
  )
}
