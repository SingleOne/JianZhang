import { AppInput } from '../../../components/AppFormControls'
import { AppSelect, type AppSelectOption } from '../../../components/AppSelect'
import { AppTable, type AppTableColumn } from '../../../components/AppTable'
import { useSecuritiesAccountState } from '../../../components/SecuritiesAccountContext'
import { listAccountsForMarket } from '../../../shared/stock-accounts'
import { tradeImportItemMarket } from '../shared/trade-import-defaults'
import type { AiTradeImportEntryKind, AiTradeImportItem } from '../shared/types'

const KIND_OPTIONS: readonly AppSelectOption<AiTradeImportEntryKind>[] = [
  { value: 'trade', label: '成交', description: '买入或卖出' },
  { value: 'cashDividend', label: '现金分红', description: '税前分红金额' },
  { value: 'withholdingTax', label: '红利税', description: '实际扣缴金额' }
]

const SIDE_OPTIONS: readonly AppSelectOption<'' | 'buy' | 'sell'>[] = [
  { value: '', label: '请选择方向' },
  { value: 'buy', label: '买入' },
  { value: 'sell', label: '卖出' }
]

const EVIDENCE_ACTION_COLORS: Record<string, string> = {
  买入: 'var(--green)',
  卖出: 'var(--red)',
  现金分红: 'var(--red)',
  分红: 'var(--red)',
  股息: 'var(--red)',
  红利税: 'var(--green)',
  预扣税: 'var(--green)',
  缴税: 'var(--green)',
  扣税: 'var(--green)'
}
const EVIDENCE_ACTION_PATTERN = new RegExp(
  `(${Object.keys(EVIDENCE_ACTION_COLORS).join('|')})`,
  'g'
)

function renderEvidence(evidence: string) {
  return evidence.split(EVIDENCE_ACTION_PATTERN).map((part, index) => {
    const color = EVIDENCE_ACTION_COLORS[part]
    return color ? (
      <span key={index} style={{ color }}>
        {part}
      </span>
    ) : (
      part
    )
  })
}

function optionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

interface TradeImportTableProps {
  items: AiTradeImportItem[]
  stockOptions: readonly AppSelectOption<string>[]
  onUpdate: (itemId: string, changes: Partial<AiTradeImportItem>) => void
  onMapStock: (item: AiTradeImportItem, quoteId: string) => void
}

export function TradeImportTable({
  items,
  stockOptions,
  onUpdate,
  onMapStock
}: TradeImportTableProps) {
  const accountState = useSecuritiesAccountState()
  const columns: AppTableColumn<AiTradeImportItem>[] = [
    {
      key: 'selected',
      title: '导入',
      width: 76,
      render: (item, index) => (
        <label className="ai-trade-import-row-selection">
          <AppInput
            type="checkbox"
            checked={item.selected}
            onChange={(event) => onUpdate(item.id, { selected: event.target.checked })}
          />
          第 {index + 1} 条
        </label>
      )
    },
    {
      key: 'kind',
      title: '流水类型',
      width: 140,
      render: (item, index) => (
        <AppSelect
          value={item.kind}
          options={KIND_OPTIONS}
          label={`第 ${index + 1} 条流水类型`}
          portal
          onChange={(kind) => onUpdate(item.id, { kind })}
        />
      )
    },
    {
      key: 'stock',
      title: '股票',
      width: 220,
      render: (item, index) => (
        <AppSelect
          value={item.quoteId ?? ''}
          options={stockOptions}
          label={`第 ${index + 1} 条股票`}
          searchable
          searchPlaceholder="输入股票名称或代码"
          portal
          onChange={(quoteId) => onMapStock(item, quoteId)}
        />
      )
    },
    {
      key: 'account',
      title: '股票账户',
      width: 160,
      render: (item, index) => {
        const market = tradeImportItemMarket(item)
        return (
          <AppSelect
            value={item.accountId ?? ''}
            options={[
              { value: '', label: '请选择账户' },
              ...(market
                ? listAccountsForMarket(accountState.securitiesAccounts, market).map((account) => ({
                    value: account.id,
                    label: account.name
                  }))
                : [])
            ]}
            label={`第 ${index + 1} 条股票账户`}
            disabled={!market}
            portal
            onChange={(accountId) => onUpdate(item.id, { accountId })}
          />
        )
      }
    },
    {
      key: 'occurredAt',
      title: '发生日期 / 时间',
      width: 270,
      render: (item, index) => {
        const [date = '', time = '09:30'] = (item.occurredAt ?? '').split('T')
        return (
          <div className="ai-trade-import-row-time">
            <AppInput
              type="date"
              aria-label={`第 ${index + 1} 条发生日期`}
              value={date}
              onChange={(event) =>
                onUpdate(item.id, { occurredAt: `${event.target.value}T${time || '09:30'}` })
              }
            />
            <AppInput
              type="time"
              step="1"
              aria-label={`第 ${index + 1} 条发生时间`}
              value={time || '09:30'}
              onChange={(event) =>
                onUpdate(item.id, { occurredAt: `${date}T${event.target.value || '09:30'}` })
              }
            />
          </div>
        )
      }
    },
    {
      key: 'side',
      title: '方向',
      width: 110,
      render: (item, index) =>
        item.kind === 'trade' ? (
          <AppSelect
            value={item.side ?? ''}
            options={SIDE_OPTIONS}
            label={`第 ${index + 1} 条成交方向`}
            portal
            onChange={(side) => onUpdate(item.id, { side: side || undefined })}
          />
        ) : (
          '—'
        )
    },
    {
      key: 'price',
      title: '成交价',
      width: 110,
      render: (item, index) =>
        item.kind === 'trade' ? (
          <AppInput
            aria-label={`第 ${index + 1} 条成交价`}
            type="number"
            min="0"
            step="0.0001"
            value={item.price ?? ''}
            onChange={(event) => onUpdate(item.id, { price: optionalNumber(event.target.value) })}
          />
        ) : (
          '—'
        )
    },
    {
      key: 'quantity',
      title: '成交数量',
      width: 110,
      render: (item, index) =>
        item.kind === 'trade' ? (
          <AppInput
            aria-label={`第 ${index + 1} 条成交数量`}
            type="number"
            min="0"
            step="100"
            value={item.quantity ?? ''}
            onChange={(event) =>
              onUpdate(item.id, { quantity: optionalNumber(event.target.value) })
            }
          />
        ) : (
          '—'
        )
    },
    {
      key: 'fees',
      title: '实际费用',
      width: 110,
      render: (item, index) =>
        item.kind === 'trade' ? (
          <AppInput
            aria-label={`第 ${index + 1} 条实际费用`}
            title="缺失费用按所选账户模板估算；切换账户或修改成交数据时重算，可手动修改"
            type="number"
            min="0"
            step="0.01"
            value={item.fees ?? ''}
            onChange={(event) => {
              const fees = optionalNumber(event.target.value)
              onUpdate(item.id, {
                fees,
                feeSource: fees === undefined ? undefined : 'actual',
                feeEstimate: undefined
              })
            }}
          />
        ) : (
          '—'
        )
    },
    {
      key: 'amount',
      title: '税前分红 / 红利税',
      width: 140,
      render: (item, index) =>
        item.kind !== 'trade' ? (
          <AppInput
            aria-label={`第 ${index + 1} 条${item.kind === 'cashDividend' ? '税前分红' : '红利税'}`}
            type="number"
            min="0"
            step="0.01"
            value={item.amount ?? ''}
            onChange={(event) => onUpdate(item.id, { amount: optionalNumber(event.target.value) })}
          />
        ) : (
          '—'
        )
    },
    {
      key: 'eligibleQuantity',
      title: '登记股数',
      width: 110,
      render: (item, index) =>
        item.kind === 'cashDividend' ? (
          <AppInput
            aria-label={`第 ${index + 1} 条登记股数`}
            type="number"
            min="0"
            step="100"
            value={item.eligibleQuantity ?? ''}
            onChange={(event) =>
              onUpdate(item.id, { eligibleQuantity: optionalNumber(event.target.value) })
            }
          />
        ) : (
          '—'
        )
    }
  ]

  if (items.some((item) => item.currency && item.currency !== 'CNY')) {
    columns.push({
      key: 'exchangeRate',
      title: '成交汇率',
      width: 120,
      render: (item, index) =>
        item.currency && item.currency !== 'CNY' ? (
          <AppInput
            aria-label={`第 ${index + 1} 条成交汇率`}
            type="number"
            min="0"
            step="0.000001"
            value={item.exchangeRate ?? ''}
            onChange={(event) =>
              onUpdate(item.id, { exchangeRate: optionalNumber(event.target.value) })
            }
          />
        ) : (
          '—'
        )
    })
  }

  columns.push(
    {
      key: 'externalId',
      title: '券商编号',
      width: 150,
      render: (item, index) => (
        <AppInput
          aria-label={`第 ${index + 1} 条券商编号`}
          placeholder="可留空"
          title="券商原始成交或流水编号，用于来源追溯及重复导入检查"
          value={item.externalId ?? ''}
          onChange={(event) => onUpdate(item.id, { externalId: event.target.value || undefined })}
        />
      )
    },
    {
      key: 'note',
      title: '备注',
      width: 200,
      render: (item, index) => (
        <AppInput
          aria-label={`第 ${index + 1} 条备注`}
          value={item.note ?? ''}
          onChange={(event) => onUpdate(item.id, { note: event.target.value || undefined })}
        />
      )
    }
  )

  return (
    <AppTable
      label="交易记录识别确认"
      className="ai-trade-import-table"
      rows={items}
      columns={columns}
      rowKey={(item) => item.id}
      rowClassName={(item) => (item.selected ? '' : 'is-disabled')}
      renderDetails={(item) => (
        <div className="ai-trade-import-row-summary">
          <span className={`ai-trade-import-confidence is-confidence-${item.confidence}`}>
            {item.confidence === 'high'
              ? '高置信'
              : item.confidence === 'medium'
                ? '中置信'
                : '低置信'}
          </span>
          {item.evidence || item.issues.length > 0 ? (
            <div className="ai-trade-import-row-details">
              {item.evidence ? <blockquote>{renderEvidence(item.evidence)}</blockquote> : null}
              {item.issues.length > 0 ? (
                <div className="ai-trade-import-issues">
                  {item.issues.map((entry, index) => (
                    <span className={`is-${entry.severity}`} key={`${entry.message}:${index}`}>
                      {entry.message}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    />
  )
}
