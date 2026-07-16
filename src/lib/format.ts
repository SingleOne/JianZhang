export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined) return '--'
  return value >= 100 ? value.toFixed(2) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

export function formatSigned(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return '--'
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '--'
  return `${formatSigned(value)}%`
}

export function formatAmount(value: number | null | undefined): string {
  if (value === null || value === undefined) return '--'
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(2)}亿`
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`
  return value.toLocaleString('zh-CN')
}

export function formatSignedAmount(value: number | null | undefined): string {
  if (value === null || value === undefined) return '--'
  if (value === 0) return '0'
  return `${value >= 0 ? '+' : '-'}${formatAmount(Math.abs(value))}`
}

export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return '--'
  const absolute = Math.abs(value)
  const digits = absolute >= 100 ? 2 : 3
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: digits
  })
}

export function formatProfit(value: number | null | undefined): string {
  if (value === null || value === undefined) return '--'
  return `${value >= 0 ? '+' : ''}${formatCurrency(value)}`
}

export function formatShares(value: number | null | undefined): string {
  if (value === null || value === undefined) return '--'
  return `${value.toLocaleString('zh-CN')} 股`
}

export function formatVolume(value: number | null | undefined): string {
  if (value === null || value === undefined) return '--'
  return `${(value / 10_000).toFixed(2)}万手`
}

export function formatUpdateTime(iso?: string): string {
  if (!iso) return '--:--:--'
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(new Date(iso))
}
