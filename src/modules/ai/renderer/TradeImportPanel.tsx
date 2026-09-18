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
import { currencyForMarket, marketFromQuoteId } from '../../../shared/stock-market'
import type {
  AiApi,
  AiTradeImportCommitResult,
  AiTradeImportDraft,
  AiTradeImportEntryKind,
  AiTradeImportItem,
  AiStockMention
} from '../shared/types'

const KIND_OPTIONS: readonly AppSelectOption<AiTradeImportEntryKind>[] = [
  { value: 'trade', label: '成交', description: '买入或卖出' },
  { value: 'cashDividend', label: '现金分红', description: '税前分红金额' },
  { value: 'withholdingTax', label: '红利税', description: '实际扣缴金额' }
]

const SIDE_OPTIONS: readonly AppSelectOption<'buy' | 'sell'>[] = [
  { value: 'buy', label: '买入' },
  { value: 'sell', label: '卖出' }
]

function optionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function formatCost(value: number | null): string {
  return value === null ? '--' : value.toFixed(4)
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || /\.(?:png|jpe?g|webp|gif)$/i.test(file.name)
}

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
  const confirm = useConfirmDialog()
  const documentInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [sourceText, setSourceText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [draft, setDraft] = useState<AiTradeImportDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
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

  const updateItem = (itemId: string, changes: Partial<AiTradeImportItem>) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            impacts: [],
            warnings: [],
            items: current.items.map((item) =>
              item.id === itemId ? { ...item, ...changes, issues: [] } : item
            )
          }
        : current
    )
    setDirty(true)
  }

  const mapStock = (item: AiTradeImportItem, quoteId: string) => {
    const stock = stocks.find((candidate) => candidate.quoteId === quoteId)
    const currency = stock ? currencyForMarket(marketFromQuoteId(stock.quoteId)) : item.currency
    updateItem(item.id, {
      quoteId: quoteId || undefined,
      stockCode: stock?.code ?? item.stockCode,
      stockName: stock?.name ?? item.stockName,
      currency,
      exchangeRate: currency === 'CNY' ? 1 : item.exchangeRate
    })
  }

  const commit = async () => {
    if (!draft || selectedItems.length === 0) return
    const accepted = await confirm({
      title: '确认导入券商流水',
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
            <strong>导入券商流水</strong>
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
                <div key={impact.quoteId}>
                  <span>{impact.name}</span>
                  <span>
                    {impact.beforeQuantity} 股 / {formatCost(impact.beforeCost)} →{' '}
                    {impact.afterQuantity} 股 / {formatCost(impact.afterCost)}
                  </span>
                </div>
              ))}
            </section>
          ) : null}
          <div className="ai-trade-import-items">
            {draft.items.map((item, index) => (
              <article
                className={`ai-trade-import-item${item.selected ? '' : ' is-disabled'}`}
                key={item.id}
              >
                <header>
                  <label>
                    <input
                      type="checkbox"
                      checked={item.selected}
                      onChange={(event) => updateItem(item.id, { selected: event.target.checked })}
                    />
                    第 {index + 1} 条
                  </label>
                  <AppSelect
                    className="ai-trade-import-kind"
                    value={item.kind}
                    options={KIND_OPTIONS}
                    label={`第 ${index + 1} 条流水类型`}
                    onChange={(kind) => updateItem(item.id, { kind })}
                  />
                  <span className={`is-confidence-${item.confidence}`}>
                    {item.confidence === 'high'
                      ? '高置信'
                      : item.confidence === 'medium'
                        ? '中置信'
                        : '低置信'}
                  </span>
                </header>
                <div className="ai-trade-import-fields">
                  <label className="is-wide">
                    <span>股票</span>
                    <AppSelect
                      value={item.quoteId ?? ''}
                      options={stockOptions}
                      label={`第 ${index + 1} 条股票`}
                      onChange={(quoteId) => mapStock(item, quoteId)}
                    />
                  </label>
                  <label>
                    <span>发生时间</span>
                    <input
                      type="text"
                      value={item.occurredAt ?? ''}
                      placeholder="2026-09-17T10:30"
                      onChange={(event) => updateItem(item.id, { occurredAt: event.target.value })}
                    />
                  </label>
                  {item.kind === 'trade' ? (
                    <>
                      <label>
                        <span>方向</span>
                        <AppSelect
                          value={item.side ?? 'buy'}
                          options={SIDE_OPTIONS}
                          label={`第 ${index + 1} 条成交方向`}
                          onChange={(side) => updateItem(item.id, { side })}
                        />
                      </label>
                      <label>
                        <span>成交价</span>
                        <input
                          type="number"
                          min="0"
                          step="0.0001"
                          value={item.price ?? ''}
                          onChange={(event) =>
                            updateItem(item.id, { price: optionalNumber(event.target.value) })
                          }
                        />
                      </label>
                      <label>
                        <span>成交数量</span>
                        <input
                          type="number"
                          min="0"
                          step="100"
                          value={item.quantity ?? ''}
                          onChange={(event) =>
                            updateItem(item.id, { quantity: optionalNumber(event.target.value) })
                          }
                        />
                      </label>
                      <label>
                        <span>实际费用</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.fees ?? ''}
                          onChange={(event) =>
                            updateItem(item.id, { fees: optionalNumber(event.target.value) })
                          }
                        />
                      </label>
                    </>
                  ) : (
                    <>
                      <label>
                        <span>{item.kind === 'cashDividend' ? '税前分红' : '红利税'}</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.amount ?? ''}
                          onChange={(event) =>
                            updateItem(item.id, { amount: optionalNumber(event.target.value) })
                          }
                        />
                      </label>
                      {item.kind === 'cashDividend' ? (
                        <label>
                          <span>登记股数</span>
                          <input
                            type="number"
                            min="0"
                            step="100"
                            value={item.eligibleQuantity ?? ''}
                            onChange={(event) =>
                              updateItem(item.id, {
                                eligibleQuantity: optionalNumber(event.target.value)
                              })
                            }
                          />
                        </label>
                      ) : null}
                    </>
                  )}
                  {item.currency && item.currency !== 'CNY' ? (
                    <label>
                      <span>成交汇率</span>
                      <input
                        type="number"
                        min="0"
                        step="0.000001"
                        value={item.exchangeRate ?? ''}
                        onChange={(event) =>
                          updateItem(item.id, { exchangeRate: optionalNumber(event.target.value) })
                        }
                      />
                    </label>
                  ) : null}
                  <label>
                    <span>券商编号</span>
                    <input
                      value={item.externalId ?? ''}
                      onChange={(event) =>
                        updateItem(item.id, { externalId: event.target.value || undefined })
                      }
                    />
                  </label>
                  <label className="is-wide">
                    <span>备注</span>
                    <input
                      value={item.note ?? ''}
                      onChange={(event) =>
                        updateItem(item.id, { note: event.target.value || undefined })
                      }
                    />
                  </label>
                </div>
                {item.evidence ? <blockquote>{item.evidence}</blockquote> : null}
                {item.issues.length > 0 ? (
                  <div className="ai-trade-import-issues">
                    {item.issues.map((entry, issueIndex) => (
                      <span
                        className={`is-${entry.severity}`}
                        key={`${entry.message}:${issueIndex}`}
                      >
                        {entry.message}
                      </span>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
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
