import { ExternalLink, Plus, RefreshCcw, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatCost, formatMoney, formatShares } from '../lib/format'
import {
  CORPORATE_ACTION_STATUS_LABELS,
  CORPORATE_ACTION_TYPE_LABELS
} from '../lib/corporate-actions'
import { appendPortfolioLedgerEntries } from '../shared/types'
import { exchangeRateForCurrency } from '../shared/exchange-rates'
import { stockApi } from '../lib/api'
import { calculatePortfolioLedgerMetrics } from '../lib/portfolio-ledger'
import type {
  CorporateActionCandidate,
  CorporateActionConfirmation,
  CorporateActionImpactPreview,
  CorporateActionRecord,
  CorporateActionRecords,
  CorporateActionType,
  ExchangeRateSettings,
  PortfolioLedgerEntry,
  StockCurrency,
  StockPosition,
  TTradingAccount,
  WatchStock
} from '../shared/types'
import './CorporateActionPanel.css'

interface CorporateActionPanelProps {
  stock: WatchStock
  account?: TTradingAccount
  records: CorporateActionRecords
  exchangeRates: ExchangeRateSettings
  onCommit: (
    account: TTradingAccount,
    position: StockPosition | undefined,
    record: CorporateActionRecord
  ) => string | void
  onRecordChange: (record: CorporateActionRecord) => void
}

interface ConfirmationDraft {
  eligibleQuantity: string
  amountPerShare: string
  oldShares: string
  newShares: string
  subscribedQuantity: string
  subscriptionPrice: string
  withholdingTax: string
  fees: string
  cashAmount: string
  currency: StockCurrency
  exchangeRate: string
  exchangeRateEstimated: boolean
  occurredAt: string
  targetQuoteId: string
  note: string
}

const MANUAL_TYPES: CorporateActionType[] = [
  'manualCash',
  'cashDividend',
  'stockDividend',
  'split',
  'reverseSplit',
  'rightsIssue',
  'symbolChange',
  'mergerExchange',
  'delistingCash',
  'returnOfCapital'
]

function localDateTimeInput(date = new Date()): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function extractedNumber(
  candidate: CorporateActionCandidate,
  key: 'amount' | 'old' | 'new'
): number | undefined {
  if (candidate.terms.kind === 'cashDividend' && key === 'amount') {
    return candidate.terms.amountPerShare.value
  }
  if (
    (candidate.terms.kind === 'shareRatio' || candidate.terms.kind === 'securityConversion') &&
    (key === 'old' || key === 'new')
  ) {
    return candidate.terms[key === 'old' ? 'oldShares' : 'newShares'].value
  }
  return undefined
}

function candidateCurrency(
  candidate: CorporateActionCandidate,
  fallback: StockCurrency
): StockCurrency {
  if (candidate.terms.kind === 'cashDividend' || candidate.terms.kind === 'rightsIssue') {
    return candidate.terms.currency.value ?? fallback
  }
  return fallback
}

function createDraft(
  candidate: CorporateActionCandidate,
  stock: WatchStock,
  exchangeRates: ExchangeRateSettings
): ConfirmationDraft {
  const currency = candidateCurrency(candidate, stock.currency ?? 'CNY')
  const rate = exchangeRateForCurrency(exchangeRates, currency)
  return {
    eligibleQuantity: '',
    amountPerShare: extractedNumber(candidate, 'amount')?.toString() ?? '',
    oldShares: extractedNumber(candidate, 'old')?.toString() ?? '',
    newShares: extractedNumber(candidate, 'new')?.toString() ?? '',
    subscribedQuantity: candidate.type === 'rightsIssue' ? '0' : '',
    subscriptionPrice:
      candidate.terms.kind === 'rightsIssue'
        ? (candidate.terms.subscriptionPrice.value?.toString() ?? '')
        : '',
    withholdingTax: '0',
    fees: '0',
    cashAmount: '',
    currency,
    exchangeRate: rate?.toString() ?? '',
    exchangeRateEstimated: Boolean(rate),
    occurredAt: localDateTimeInput(
      new Date(
        `${candidate.payableDate ?? candidate.effectiveDate ?? candidate.exDate ?? candidate.announcementDate}T12:00:00`
      )
    ),
    targetQuoteId: '',
    note: candidate.title
  }
}

function optionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function ledgerEntryDescription(entry: PortfolioLedgerEntry, currency: StockCurrency): string {
  switch (entry.kind) {
    case 'trade':
      return `交易 ${formatShares(entry.record.quantity)} 股`
    case 'cashDividend':
      return `现金股息 ${formatMoney(entry.amount, currency)}`
    case 'withholdingTax':
      return `预扣税 ${formatMoney(entry.amount, currency)}`
    case 'corporateActionFee':
      return `公司行动费用 ${formatMoney(entry.amount, currency)}`
    case 'shareAdjustment':
      return `股份调整 ${formatShares(entry.quantityBefore)} → ${formatShares(entry.quantityAfter)}`
    case 'rightsSubscription':
      return `供股认购 ${formatShares(entry.quantity)} 股，单价 ${formatMoney(entry.price, currency)}`
    case 'securityConversion':
      return `证券转换 ${formatShares(entry.quantityBefore)} → ${formatShares(entry.quantityAfter)}`
    case 'cashAdjustment':
      return `现金调整 ${formatMoney(entry.amount, currency)}`
    case 'reversal':
      return `撤销账本记录 ${entry.reversesEntryId}`
  }
}

function confirmationFromDraft(
  draft: ConfirmationDraft,
  exchangeRates: ExchangeRateSettings
): CorporateActionConfirmation {
  return {
    eligibleQuantity: optionalNumber(draft.eligibleQuantity),
    amountPerShare: optionalNumber(draft.amountPerShare),
    oldShares: optionalNumber(draft.oldShares),
    newShares: optionalNumber(draft.newShares),
    subscribedQuantity: optionalNumber(draft.subscribedQuantity),
    subscriptionPrice: optionalNumber(draft.subscriptionPrice),
    withholdingTax: optionalNumber(draft.withholdingTax),
    fees: optionalNumber(draft.fees),
    cashAmount: optionalNumber(draft.cashAmount),
    currency: draft.currency,
    exchangeRate: optionalNumber(draft.exchangeRate),
    exchangeRateDate: exchangeRates.rateDate ?? undefined,
    exchangeRateEstimated: draft.exchangeRateEstimated,
    targetQuoteId: draft.targetQuoteId.trim() || undefined,
    occurredAt: draft.occurredAt ? new Date(draft.occurredAt).toISOString() : undefined,
    note: draft.note.trim() || undefined
  }
}

function accountForStock(stock: WatchStock, account?: TTradingAccount): TTradingAccount {
  return (
    account ?? {
      quoteId: stock.quoteId,
      code: stock.code,
      name: stock.name,
      market: stock.market,
      currency: stock.currency,
      history: [],
      ledger: { schemaVersion: 1, entries: [] },
      tradeRecords: []
    }
  )
}

export default function CorporateActionPanel({
  stock,
  account,
  records,
  exchangeRates,
  onCommit,
  onRecordChange
}: CorporateActionPanelProps) {
  const [candidates, setCandidates] = useState<CorporateActionCandidate[]>([])
  const [source, setSource] = useState('')
  const [fetchedAt, setFetchedAt] = useState('')
  const [warning, setWarning] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<CorporateActionCandidate | null>(null)
  const [draft, setDraft] = useState<ConfirmationDraft | null>(null)
  const [preview, setPreview] = useState<CorporateActionImpactPreview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [manualType, setManualType] = useState<CorporateActionType>('manualCash')

  const load = useCallback(
    async (forceRefresh = false) => {
      setLoading(true)
      setError('')
      try {
        const result = await stockApi.listCorporateActions(stock.quoteId, forceRefresh)
        setCandidates(result.candidates)
        setSource(result.source)
        setFetchedAt(result.fetchedAt)
        setWarning(result.warning ?? '')
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '公司行动获取失败')
      } finally {
        setLoading(false)
      }
    },
    [stock.quoteId]
  )

  useEffect(() => {
    setSelected(null)
    setDraft(null)
    setPreview(null)
    void load()
  }, [load])

  const timeline = useMemo(() => {
    const merged: CorporateActionCandidate[] = candidates.map((candidate) => {
      const saved = records[candidate.id] as CorporateActionRecord | undefined
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
    const manual = Object.values(records).filter(
      (record) => record.quoteId === stock.quoteId && !merged.some((item) => item.id === record.id)
    )
    return [...merged, ...manual].sort((left, right) =>
      right.announcementDate.localeCompare(left.announcementDate)
    )
  }, [candidates, records, stock.quoteId])

  const chooseCandidate = (candidate: CorporateActionCandidate) => {
    setSelected(candidate)
    setDraft(createDraft(candidate, stock, exchangeRates))
    setPreview(null)
  }

  const startManual = () => {
    const now = new Date().toISOString()
    chooseCandidate({
      id: `manual-draft:${stock.quoteId}`,
      quoteId: stock.quoteId,
      market: stock.market ?? 'CN',
      type: manualType,
      status: 'needsReview',
      title: `手工${CORPORATE_ACTION_TYPE_LABELS[manualType]}`,
      announcementDate: now.slice(0, 10),
      effectiveDate: now.slice(0, 10),
      terms: manualType === 'manualCash' ? { kind: 'manualCash' } : { kind: 'unsupported' },
      evidence: [],
      providerId: 'manual',
      providerEventId: 'manual-draft',
      contentHash: 'manual-draft',
      detectedAt: now
    })
  }

  const updateDraft = (field: keyof ConfirmationDraft, value: string) => {
    setDraft((current) => (current ? { ...current, [field]: value } : current))
    setPreview(null)
  }

  const runPreview = async () => {
    if (!selected || !draft) return
    setPreviewing(true)
    setError('')
    try {
      const workingAccount = accountForStock(stock, account)
      const confirmation = confirmationFromDraft(draft, exchangeRates)
      if (selected.providerId === 'manual') {
        const result = await stockApi.createManualCorporateAction(
          {
            quoteId: stock.quoteId,
            market: selected.market,
            type: selected.type,
            title: draft.note || selected.title,
            announcementDate: selected.announcementDate,
            effectiveDate: selected.effectiveDate,
            currency: draft.currency,
            confirmation
          },
          workingAccount
        )
        setSelected(result.candidate)
        setPreview(result.preview)
      } else {
        const result = await stockApi.previewCorporateAction({
          candidate: selected,
          account: workingAccount,
          confirmation
        })
        if (result.resolvedCandidate) setSelected(result.resolvedCandidate)
        setPreview(result)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '影响预览生成失败')
    } finally {
      setPreviewing(false)
    }
  }

  const applyPreview = async () => {
    const confirmsRightsNonParticipation =
      selected?.type === 'rightsIssue' && optionalNumber(draft?.subscribedQuantity ?? '') === 0
    if (
      !selected ||
      !preview ||
      preview.missingFields.length > 0 ||
      (preview.entries.length === 0 && !confirmsRightsNonParticipation)
    )
      return
    const workingAccount = accountForStock(stock, account)
    const nextAccount = appendPortfolioLedgerEntries(workingAccount, preview.entries)
    const positionCurrency = draft?.currency ?? stock.position?.currency ?? stock.currency ?? 'CNY'
    const metrics = calculatePortfolioLedgerMetrics(nextAccount, positionCurrency)
    const position =
      metrics.quantity > 0
        ? {
            quantity: metrics.quantity,
            cost: metrics.averageCost ?? stock.position?.cost ?? 0,
            openedToday: stock.position?.openedToday ?? false,
            openedOn: stock.position?.openedOn,
            currency: positionCurrency,
            costExchangeRate:
              metrics.cnyCostBasis !== null && metrics.nativeCostBasis > 0
                ? metrics.cnyCostBasis / metrics.nativeCostBasis
                : stock.position?.costExchangeRate,
            costExchangeRateDate: draft?.exchangeRate
              ? (exchangeRates.rateDate ?? stock.position?.costExchangeRateDate)
              : stock.position?.costExchangeRateDate
          }
        : undefined
    const record: CorporateActionRecord = {
      ...selected,
      status: preview.entries.length > 0 ? 'applied' : 'confirmed',
      reviewedAt: new Date().toISOString(),
      appliedEntryIds: [
        ...new Set([
          ...(selected.appliedEntryIds ?? []),
          ...preview.entries.map((entry) => entry.id)
        ])
      ]
    }
    const commitError = onCommit(nextAccount, position, record)
    if (commitError) {
      setError(commitError)
      return
    }
    setSelected(null)
    setDraft(null)
    setPreview(null)
  }

  const confirmsRightsNonParticipation =
    selected?.type === 'rightsIssue' && optionalNumber(draft?.subscribedQuantity ?? '') === 0
  const canApplyPreview = Boolean(
    preview &&
    preview.missingFields.length === 0 &&
    (preview.entries.length > 0 || confirmsRightsNonParticipation)
  )

  const ignore = async (candidate: CorporateActionCandidate) => {
    try {
      onRecordChange(await stockApi.ignoreCorporateAction(candidate))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '忽略公司行动失败')
    }
  }

  const reverse = async (candidate: CorporateActionRecord) => {
    const workingAccount = accountForStock(stock, account)
    try {
      const reversals = await stockApi.reverseCorporateAction(candidate, workingAccount)
      const nextAccount = appendPortfolioLedgerEntries(workingAccount, reversals)
      const currency = workingAccount.currency ?? stock.currency ?? 'CNY'
      const metrics = calculatePortfolioLedgerMetrics(nextAccount, currency)
      const record: CorporateActionRecord = {
        ...candidate,
        status: 'reversed',
        reviewedAt: new Date().toISOString()
      }
      const commitError = onCommit(
        nextAccount,
        metrics.quantity > 0
          ? {
              quantity: metrics.quantity,
              cost: metrics.averageCost ?? stock.position?.cost ?? 0,
              openedToday: stock.position?.openedToday ?? false,
              openedOn: stock.position?.openedOn,
              currency,
              costExchangeRate:
                metrics.cnyCostBasis !== null && metrics.nativeCostBasis > 0
                  ? metrics.cnyCostBasis / metrics.nativeCostBasis
                  : stock.position?.costExchangeRate,
              costExchangeRateDate: stock.position?.costExchangeRateDate
            }
          : undefined,
        record
      )
      if (commitError) setError(commitError)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '撤销公司行动失败')
    }
  }

  return (
    <div className="corporate-action-panel" role="tabpanel">
      <header className="corporate-action-header">
        <div>
          <strong>公司行动时间线</strong>
          <span>
            {source || '官方来源'}
            {fetchedAt ? ` · 更新于 ${new Date(fetchedAt).toLocaleString()}` : ''}
          </span>
        </div>
        <div className="corporate-action-actions">
          <select
            value={manualType}
            onChange={(event) => setManualType(event.target.value as CorporateActionType)}
          >
            {MANUAL_TYPES.map((type) => (
              <option value={type} key={type}>
                {CORPORATE_ACTION_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          <button className="secondary-button" type="button" onClick={startManual}>
            <Plus size={15} />
            手工录入
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={loading}
            onClick={() => void load(true)}
          >
            <RefreshCcw size={15} className={loading ? 'is-spinning' : ''} />
            更新候选
          </button>
        </div>
      </header>

      {warning ? <div className="corporate-action-warning">{warning}</div> : null}
      {error ? <div className="corporate-action-error">{error}</div> : null}
      {loading && timeline.length === 0 ? (
        <div className="corporate-action-empty">正在查询官方公司行动…</div>
      ) : null}
      {!loading && timeline.length === 0 ? (
        <div className="corporate-action-empty">
          最近两年没有发现公司行动候选，可使用手工录入补齐券商实际入账。
        </div>
      ) : null}

      <div className="corporate-action-timeline">
        {timeline.map((candidate) => (
          <article className="corporate-action-card" key={candidate.id}>
            <div className="corporate-action-card-heading">
              <div>
                <span className={`corporate-action-status is-${candidate.status}`}>
                  {CORPORATE_ACTION_STATUS_LABELS[candidate.status]}
                </span>
                <strong>
                  {CORPORATE_ACTION_TYPE_LABELS[candidate.type]} · {candidate.title}
                </strong>
              </div>
              <time>{candidate.announcementDate}</time>
            </div>
            <div className="corporate-action-dates">
              <span>公告 {candidate.announcementDate}</span>
              {candidate.exDate ? <span>除权 {candidate.exDate}</span> : null}
              {candidate.recordDate ? <span>登记 {candidate.recordDate}</span> : null}
              {candidate.payableDate ? <span>派付 {candidate.payableDate}</span> : null}
              {candidate.effectiveDate ? <span>生效 {candidate.effectiveDate}</span> : null}
            </div>
            <div className="corporate-action-card-actions">
              {candidate.evidence[0]?.url ? (
                <button
                  className="text-button"
                  type="button"
                  onClick={() => void stockApi.openCorporateAction(candidate.evidence[0].url)}
                >
                  <ExternalLink size={14} />
                  官方原文
                </button>
              ) : null}
              {candidate.status !== 'applied' && candidate.status !== 'reversed' ? (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => chooseCandidate(candidate)}
                >
                  预览并确认
                </button>
              ) : null}
              {candidate.status === 'detected' ||
              candidate.status === 'needsReview' ||
              candidate.status === 'revised' ? (
                <button
                  className="text-button"
                  type="button"
                  onClick={() => void ignore(candidate)}
                >
                  忽略
                </button>
              ) : null}
              {candidate.status === 'applied' ? (
                <button
                  className="text-button is-danger"
                  type="button"
                  onClick={() => void reverse(candidate as CorporateActionRecord)}
                >
                  <RotateCcw size={14} />
                  写入撤销记录
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </div>

      {selected && draft ? (
        <section className="corporate-action-editor" aria-label="公司行动影响预览">
          <header>
            <div>
              <strong>{selected.title}</strong>
              <span>确认前不会修改持仓或账本</span>
            </div>
            <button className="text-button" type="button" onClick={() => setSelected(null)}>
              关闭
            </button>
          </header>
          <div className="corporate-action-form-grid">
            {selected.type === 'cashDividend' || selected.type === 'returnOfCapital' ? (
              <>
                <label>
                  权益股数
                  <input
                    type="number"
                    step="100"
                    value={draft.eligibleQuantity}
                    placeholder="按登记日账本计算"
                    onChange={(event) => updateDraft('eligibleQuantity', event.target.value)}
                  />
                </label>
                <label>
                  每股金额
                  <input
                    type="number"
                    step="0.01"
                    value={draft.amountPerShare}
                    onChange={(event) => updateDraft('amountPerShare', event.target.value)}
                  />
                </label>
              </>
            ) : null}
            {(
              [
                'stockDividend',
                'split',
                'reverseSplit',
                'symbolChange',
                'mergerExchange'
              ] as CorporateActionType[]
            ).includes(selected.type) ? (
              <>
                <label>
                  旧股比例
                  <input
                    type="number"
                    step="1"
                    value={draft.oldShares}
                    onChange={(event) => updateDraft('oldShares', event.target.value)}
                  />
                </label>
                <label>
                  新股比例
                  <input
                    type="number"
                    step="1"
                    value={draft.newShares}
                    onChange={(event) => updateDraft('newShares', event.target.value)}
                  />
                </label>
              </>
            ) : null}
            {selected.type === 'rightsIssue' ? (
              <>
                <label>
                  认购数量
                  <input
                    type="number"
                    step="100"
                    value={draft.subscribedQuantity}
                    onChange={(event) => updateDraft('subscribedQuantity', event.target.value)}
                  />
                </label>
                <label>
                  认购价
                  <input
                    type="number"
                    step="0.01"
                    value={draft.subscriptionPrice}
                    onChange={(event) => updateDraft('subscriptionPrice', event.target.value)}
                  />
                </label>
              </>
            ) : null}
            {selected.type === 'manualCash' || selected.type === 'delistingCash' ? (
              <label>
                现金金额
                <input
                  type="number"
                  step="0.01"
                  value={draft.cashAmount}
                  onChange={(event) => updateDraft('cashAmount', event.target.value)}
                />
              </label>
            ) : null}
            <label>
              预扣税
              <input
                type="number"
                step="0.01"
                value={draft.withholdingTax}
                onChange={(event) => updateDraft('withholdingTax', event.target.value)}
              />
            </label>
            <label>
              费用
              <input
                type="number"
                step="0.01"
                value={draft.fees}
                onChange={(event) => updateDraft('fees', event.target.value)}
              />
            </label>
            <label>
              币种
              <select
                value={draft.currency}
                onChange={(event) => updateDraft('currency', event.target.value)}
              >
                <option value="CNY">CNY</option>
                <option value="HKD">HKD</option>
                <option value="USD">USD</option>
              </select>
            </label>
            <label>
              人民币汇率
              <input
                type="number"
                step="0.0001"
                value={draft.exchangeRate}
                onChange={(event) => updateDraft('exchangeRate', event.target.value)}
              />
              <small>默认取阶段 3 中国官方汇率，仅作估算；可改为券商实际汇率。</small>
            </label>
            <label>
              汇率口径
              <select
                value={draft.exchangeRateEstimated ? 'official' : 'broker'}
                onChange={(event) =>
                  setDraft((current) =>
                    current
                      ? { ...current, exchangeRateEstimated: event.target.value === 'official' }
                      : current
                  )
                }
              >
                <option value="official">中国官方汇率估算</option>
                <option value="broker">券商实际入账汇率</option>
              </select>
            </label>
            <label>
              入账/生效时间
              <input
                type="datetime-local"
                value={draft.occurredAt}
                onChange={(event) => updateDraft('occurredAt', event.target.value)}
              />
            </label>
            {selected.type === 'symbolChange' || selected.type === 'mergerExchange' ? (
              <label>
                新证券 quoteId
                <input
                  type="text"
                  value={draft.targetQuoteId}
                  onChange={(event) => updateDraft('targetQuoteId', event.target.value)}
                />
              </label>
            ) : null}
            <label className="is-wide">
              备注
              <input
                type="text"
                value={draft.note}
                onChange={(event) => updateDraft('note', event.target.value)}
              />
            </label>
          </div>
          <div className="corporate-action-preview-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={previewing}
              onClick={() => void runPreview()}
            >
              {previewing ? '正在计算…' : '生成影响预览'}
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={!canApplyPreview}
              onClick={() => void applyPreview()}
            >
              {confirmsRightsNonParticipation && preview?.entries.length === 0
                ? '确认不参与供股'
                : '确认并写入账本'}
            </button>
          </div>
          {preview ? (
            <div className="corporate-action-preview">
              <div>
                <span>持仓数量</span>
                <strong>
                  {formatShares(preview.quantityBefore)} → {formatShares(preview.quantityAfter)}
                </strong>
              </div>
              <div>
                <span>每股成本</span>
                <strong>
                  {formatCost(preview.costBefore)} → {formatCost(preview.costAfter)}
                </strong>
              </div>
              <div>
                <span>总成本</span>
                <strong>
                  {formatMoney(preview.totalCostBefore, draft.currency)} →{' '}
                  {formatMoney(preview.totalCostAfter, draft.currency)}
                </strong>
              </div>
              <div>
                <span>现金总额</span>
                <strong
                  className={
                    preview.grossCash > 0 ? 'is-up' : preview.grossCash < 0 ? 'is-down' : 'is-flat'
                  }
                >
                  {formatMoney(preview.grossCash, draft.currency)}
                </strong>
              </div>
              <div>
                <span>预扣税</span>
                <strong
                  className={
                    preview.withholdingTax > 0
                      ? 'is-down'
                      : preview.withholdingTax < 0
                        ? 'is-up'
                        : 'is-flat'
                  }
                >
                  {formatMoney(preview.withholdingTax, draft.currency)}
                </strong>
              </div>
              <div>
                <span>费用</span>
                <strong
                  className={preview.fees > 0 ? 'is-down' : preview.fees < 0 ? 'is-up' : 'is-flat'}
                >
                  {formatMoney(preview.fees, draft.currency)}
                </strong>
              </div>
              <div>
                <span>净现金</span>
                <strong
                  className={
                    preview.netCash > 0 ? 'is-up' : preview.netCash < 0 ? 'is-down' : 'is-flat'
                  }
                >
                  {formatMoney(preview.netCash, draft.currency)}
                </strong>
              </div>
              <div>
                <span>人民币估算</span>
                <strong
                  className={
                    preview.netCashCny && preview.netCashCny > 0
                      ? 'is-up'
                      : preview.netCashCny && preview.netCashCny < 0
                        ? 'is-down'
                        : 'is-flat'
                  }
                >
                  {formatMoney(preview.netCashCny, 'CNY')}
                </strong>
              </div>
              <div>
                <span>账本记录</span>
                <strong>{preview.entries.length} 条</strong>
              </div>
              {preview.entries.length > 0 ? (
                <ul className="corporate-action-ledger-preview">
                  {preview.entries.map((entry) => (
                    <li key={entry.id}>{ledgerEntryDescription(entry, draft.currency)}</li>
                  ))}
                </ul>
              ) : null}
              {confirmsRightsNonParticipation && preview.entries.length === 0 ? (
                <p className="corporate-action-confirmation-note">
                  本次选择不会生成账本流水，只保存“不参与供股”的确认结果。
                </p>
              ) : null}
              {preview.missingFields.length > 0 ? (
                <p>仍需补录：{preview.missingFields.join('、')}</p>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
