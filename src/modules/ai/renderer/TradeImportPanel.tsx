import { useSecuritiesAccountState } from '../../../components/SecuritiesAccountContext'
import { listAccountsForMarket, resolveAccountSelection } from '../../../shared/stock-accounts'
import { STOCK_MARKET_LABELS, type StockMarket } from '../../../shared/stock-market'
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Image,
  LoaderCircle,
  ReceiptText,
  RotateCcw,
  Upload
} from 'lucide-react'
import { useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { AppSelect, type AppSelectOption } from '../../../components/AppSelect'
import { useConfirmDialog } from '../../../components/ConfirmDialog'
import { TradeImportTable } from './TradeImportTable'
import { fillTradeImportDefaults, tradeImportItemMarket } from '../shared/trade-import-defaults'
import { currencyForMarket, marketFromQuoteId } from '../../../shared/stock-market'
import type {
  AiApi,
  AiTradeImportCommitResult,
  AiTradeImportDraft,
  AiTradeImportItem,
  AiStockMention
} from '../shared/types'

function formatCost(value: number | null): string {
  return value === null ? '--' : value.toFixed(4)
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(?:png|jpe?g|webp|gif)$/i.test(file.name)
}

const IMPORT_MARKETS: readonly StockMarket[] = ['CN', 'HK', 'US']
const FEE_FIELDS = [
  'accountId',
  'quoteId',
  'kind',
  'side',
  'price',
  'quantity',
  'occurredAt'
] as const

interface TradeImportPanelProps {
  api: AiApi
  stocks: AiStockMention[]
  currentModel: string
  imageUnderstandingAvailable: boolean
  onError: (message: string) => void
}

export function TradeImportPanel({
  api,
  stocks,
  currentModel,
  imageUnderstandingAvailable,
  onError
}: TradeImportPanelProps) {
  const accountState = useSecuritiesAccountState()
  const confirm = useConfirmDialog()
  const documentInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [sourceText, setSourceText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [draft, setDraft] = useState<AiTradeImportDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [bulkStock, setBulkStock] = useState('')
  const [bulkAccounts, setBulkAccounts] = useState<Partial<Record<StockMarket, string>>>({})
  const [commitResult, setCommitResult] = useState<Extract<
    AiTradeImportCommitResult,
    { status: 'committed' }
  > | null>(null)

  const stockOptions = useMemo<readonly AppSelectOption<string>[]>(
    () => [
      { value: '', label: '请选择自选股票' },
      ...stocks.map((stock) => ({
        value: stock.quoteId,
        label: `${stock.name} · ${stock.code}`,
        description: stock.marketLabel
      }))
    ],
    [stocks]
  )
  const selectedItems = draft?.items.filter((item) => item.selected) ?? []
  const selectedErrors = selectedItems.reduce(
    (total, item) => total + item.issues.filter((entry) => entry.severity === 'error').length,
    0
  )

  const reset = () => {
    setSourceText('')
    setFiles([])
    setDraft(null)
    setDirty(false)
    setBulkStock('')
    setBulkAccounts({})
    setCommitResult(null)
    if (documentInputRef.current) documentInputRef.current.value = ''
    if (imageInputRef.current) imageInputRef.current.value = ''
  }

  const addFiles = (nextFiles: File[]) => {
    const combined = [...files, ...nextFiles]
    if (combined.length > 5) {
      onError('一次最多导入 5 个文件')
      return
    }
    setFiles(combined)
    setCommitResult(null)
  }

  const chooseDocuments = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []))
    event.target.value = ''
  }

  const chooseImages = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []))
    event.target.value = ''
  }

  const unsupportedImageMessage = `当前模型 ${currentModel || '未选择'} 不支持图片理解，请切换支持的模型`

  const openImagePicker = () => {
    if (!imageUnderstandingAvailable) {
      onError(unsupportedImageMessage)
      return
    }
    imageInputRef.current?.click()
  }

  const dropFiles = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (busy) return
    const droppedFiles = Array.from(event.dataTransfer.files)
    if (droppedFiles.some(isImageFile) && !imageUnderstandingAvailable) {
      onError(unsupportedImageMessage)
      return
    }
    addFiles(droppedFiles)
  }

  const prepare = async () => {
    if (!sourceText.trim() && files.length === 0) {
      onError('请粘贴交易记录或选择文件')
      return
    }
    if (files.some(isImageFile) && !imageUnderstandingAvailable) {
      onError(unsupportedImageMessage)
      return
    }
    setBusy(true)
    setCommitResult(null)
    try {
      const preparedFiles = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          mediaType: file.type,
          data: new Uint8Array(await file.arrayBuffer())
        }))
      )
      setDraft(
        await api.prepareTradeImport({
          text: sourceText.trim() || undefined,
          files: preparedFiles
        })
      )
      setDirty(false)
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : '交易记录识别失败')
    } finally {
      setBusy(false)
    }
  }

  const updateItems = (transform: (item: AiTradeImportItem) => AiTradeImportItem) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            impacts: [],
            warnings: [],
            items: current.items.map(transform)
          }
        : current
    )
    setDirty(true)
  }

  const updateItem = (itemId: string, changes: Partial<AiTradeImportItem>) => {
    updateItems((item) =>
      item.id === itemId
        ? fillTradeImportDefaults(
            accountState,
            { ...item, ...changes, issues: [] },
            FEE_FIELDS.some((field) => field in changes && changes[field] !== item[field])
          )
        : item
    )
  }

  const mappedStock = (item: AiTradeImportItem, quoteId: string): AiTradeImportItem => {
    const stock = stocks.find((candidate) => candidate.quoteId === quoteId)
    const currency = stock ? currencyForMarket(marketFromQuoteId(stock.quoteId)) : item.currency
    const market = marketFromQuoteId(quoteId)
    const currentAccount = accountState.securitiesAccounts?.[item.accountId ?? '']
    const preferredAccount =
      currentAccount?.enabled && currentAccount.market === market
        ? currentAccount.id
        : bulkAccounts[market]
    return fillTradeImportDefaults(
      accountState,
      {
        ...item,
        quoteId: quoteId || undefined,
        stockCode: stock?.code ?? item.stockCode,
        stockName: stock?.name ?? item.stockName,
        currency,
        accountId: quoteId
          ? resolveAccountSelection(accountState, market, preferredAccount)
          : undefined,
        exchangeRate: currency === 'CNY' ? 1 : item.exchangeRate,
        issues: []
      },
      true
    )
  }

  const mapStock = (item: AiTradeImportItem, quoteId: string) => {
    updateItems((current) => (current.id === item.id ? mappedStock(current, quoteId) : current))
  }

  const mapBulkStock = (quoteId: string) => {
    setBulkStock(quoteId)
    if (quoteId) updateItems((item) => mappedStock(item, quoteId))
  }

  const mapBulkAccount = (market: StockMarket, accountId: string) => {
    setBulkAccounts((current) => ({ ...current, [market]: accountId }))
    if (!accountId) return
    updateItems((item) => {
      return tradeImportItemMarket(item) === market
        ? fillTradeImportDefaults(accountState, { ...item, accountId, issues: [] }, true)
        : item
    })
  }

  const commit = async () => {
    if (!draft || selectedItems.length === 0) return
    const accepted = await confirm({
      title: '确认导入交易记录',
      message: `将把 ${selectedItems.length} 条流水一次性写入 ${new Set(selectedItems.map((item) => item.quoteId)).size} 只股票的统一账本。成交默认记为底仓交易，确认继续吗？`,
      confirmLabel: `导入 ${selectedItems.length} 条`,
      tone: 'default'
    })
    if (!accepted) return
    setBusy(true)
    try {
      const result = await api.commitTradeImport({
        draftId: draft.id,
        expectedRevision: draft.expectedRevision,
        items: draft.items
      })
      if (result.status === 'needsReview') {
        setDraft(result.draft)
        setDirty(false)
        return
      }
      setCommitResult(result)
      setDraft(null)
      setDirty(false)
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : '交易流水导入失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ai-trade-import">
      <header className="ai-trade-import-heading">
        <span>
          <ReceiptText size={19} />
          <span>
            <strong>导入交易记录</strong>
            <small>支持成交、现金分红和红利税；确认前不会修改持仓</small>
          </span>
        </span>
        {(draft || commitResult) && (
          <button type="button" onClick={reset} disabled={busy}>
            <RotateCcw size={14} />
            新建导入
          </button>
        )}
      </header>

      {!draft && !commitResult ? (
        <div className="ai-trade-import-source">
          <label>
            <span>粘贴券商文字记录</span>
            <textarea
              value={sourceText}
              onChange={(event) => setSourceText(event.target.value)}
              placeholder="可直接粘贴成交记录、交割单文字、现金分红或红利税流水……"
              disabled={busy}
            />
          </label>
          <div
            className="ai-trade-import-files"
            onDragOver={(event) => event.preventDefault()}
            onDrop={dropFiles}
          >
            <input
              ref={documentInputRef}
              type="file"
              multiple
              accept=".txt,.xlsx,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={chooseDocuments}
              disabled={busy}
            />
            <input
              ref={imageInputRef}
              type="file"
              multiple
              accept=".png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif"
              onChange={chooseImages}
              disabled={busy}
            />
            <button type="button" onClick={() => documentInputRef.current?.click()} disabled={busy}>
              <Upload size={15} />
              选择 TXT 或 XLSX
            </button>
            <button type="button" onClick={openImagePicker} disabled={busy}>
              <Image size={15} />
              上传图片
            </button>
            <span>
              {files.length > 0
                ? files.map((file) => file.name).join('、')
                : '也可拖入文件，最多 5 个'}
            </span>
          </div>
          <div className="ai-trade-import-notice">
            <FileSpreadsheet size={16} />
            <span>TXT 和 XLSX 在本地读取，再将表格或文本内容交给当前 AI 模型识别。</span>
          </div>
          <div className="ai-trade-import-notice">
            <AlertTriangle size={16} />
            <span>现有持仓会作为期初基线，流水按增量追加；请在导入前核对影响预览。</span>
          </div>
          <div
            className={`ai-trade-import-notice${imageUnderstandingAvailable ? '' : ' is-warning'}`}
          >
            <Image size={16} />
            <span>
              {imageUnderstandingAvailable
                ? `当前模型 ${currentModel} 支持图片理解，图片会发送给当前 AI Provider 识别。`
                : `当前模型 ${currentModel || '未选择'} 不支持图片理解；文字、TXT 和 XLSX 仍可使用。`}
            </span>
          </div>
          <button
            className="primary-button ai-trade-import-prepare"
            type="button"
            onClick={prepare}
            disabled={busy}
          >
            {busy ? <LoaderCircle size={15} className="is-spinning" /> : <ReceiptText size={15} />}
            {busy ? '正在识别' : '识别交易记录'}
          </button>
        </div>
      ) : null}

      {commitResult ? (
        <section className="ai-trade-import-success">
          <CheckCircle2 size={28} />
          <strong>券商流水已导入</strong>
          <span>
            共写入 {commitResult.entryCount} 条记录，涉及{' '}
            {commitResult.affectedStocks.map((stock) => stock.name).join('、')}。
          </span>
          <small>导入批次：{commitResult.importId}</small>
        </section>
      ) : null}

      {draft ? (
        <div className="ai-trade-import-review">
          <section className="ai-trade-import-summary">
            <span>
              <strong>{draft.items.length}</strong>
              识别记录
            </span>
            <span>
              <strong>{selectedItems.length}</strong>
              待导入
            </span>
            <span className={selectedErrors > 0 ? 'is-error' : ''}>
              <strong>{selectedErrors}</strong>
              阻断问题
            </span>
            <small>
              {draft.providerId} · {draft.model}
            </small>
          </section>
          {draft.warnings.map((warning) => (
            <div className="ai-trade-import-banner" key={warning}>
              <AlertTriangle size={15} />
              {warning}
            </div>
          ))}
          {dirty ? (
            <div className="ai-trade-import-banner">
              <AlertTriangle size={15} />
              内容已修改，提交时会重新校验持仓、重复记录和来源信息。
            </div>
          ) : null}
          {draft.impacts.length > 0 ? (
            <section className="ai-trade-import-impacts">
              <strong>导入影响预览</strong>
              {draft.impacts.map((impact) => (
                <div key={`${impact.quoteId}:${impact.accountId}`}>
                  <span>
                    {impact.name} · {impact.accountName}
                  </span>
                  <span>
                    {impact.beforeQuantity} 股 / {formatCost(impact.beforeCost)} →{' '}
                    {impact.afterQuantity} 股 / {formatCost(impact.afterCost)}
                    {' · 股票合计 '}
                    {impact.totalBeforeQuantity} → {impact.totalAfterQuantity} 股
                  </span>
                </div>
              ))}
            </section>
          ) : null}
          <div className="ai-trade-import-bulk-fields">
            <div className="ai-trade-import-bulk-control ai-trade-import-bulk-stock">
              <span>批量指定股票</span>
              <AppSelect
                value={bulkStock}
                options={stockOptions}
                label="批量指定股票"
                searchable
                searchPlaceholder="输入股票名称或代码"
                portal
                onChange={mapBulkStock}
              />
            </div>
            {IMPORT_MARKETS.map((market) => (
              <div className="ai-trade-import-bulk-control" key={market}>
                <span>{STOCK_MARKET_LABELS[market]}批量账户</span>
                <AppSelect
                  value={bulkAccounts[market] ?? ''}
                  label={`${STOCK_MARKET_LABELS[market]}批量账户`}
                  options={[
                    { value: '', label: '批量指定账户' },
                    ...listAccountsForMarket(accountState.securitiesAccounts, market).map(
                      (account) => ({ value: account.id, label: account.name })
                    )
                  ]}
                  portal
                  onChange={(accountId) => mapBulkAccount(market, accountId)}
                />
              </div>
            ))}
          </div>
          <TradeImportTable
            items={draft.items}
            stockOptions={stockOptions}
            onUpdate={updateItem}
            onMapStock={mapStock}
          />
          <footer>
            <span>提交前会再次校验；所有选中记录作为一个事务保存。</span>
            <button
              className="primary-button"
              type="button"
              disabled={busy || selectedItems.length === 0}
              onClick={commit}
            >
              {busy ? (
                <LoaderCircle size={15} className="is-spinning" />
              ) : (
                <CheckCircle2 size={15} />
              )}
              {busy ? '正在校验' : `确认导入 ${selectedItems.length} 条`}
            </button>
          </footer>
        </div>
      ) : null}
    </div>
  )
}
