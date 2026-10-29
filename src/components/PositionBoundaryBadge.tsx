import { CircleCheck, Flag } from 'lucide-react'
import type { PositionRecordBoundary } from '../lib/position-ledger'
import './PositionBoundaryBadge.css'

export function PositionBoundaryBadge({ boundary }: { boundary?: PositionRecordBoundary }) {
  if (!boundary) return null
  return (
    <span
      className={`trade-record-boundary is-${boundary}`}
      title={
        boundary === 'opening'
          ? '本条记录使该账户的股票总持仓（含 T 仓）从零变为正数'
          : '本条记录使该账户的股票总持仓（含 T 仓）归零'
      }
    >
      {boundary === 'opening' ? (
        <Flag size={12} aria-hidden="true" />
      ) : (
        <CircleCheck size={12} aria-hidden="true" />
      )}
      {boundary === 'opening' ? '建仓' : '清仓'}
    </span>
  )
}
