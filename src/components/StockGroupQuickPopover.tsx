import { Folders, X } from 'lucide-react'
import type { CSSProperties, Ref } from 'react'
import { isHoldingWatchlistGroup, isTrackingWatchlistGroup } from '../shared/types'
import type { WatchlistGroup, WatchStock } from '../shared/types'

interface StockGroupQuickPopoverProps {
  id: string
  stock: WatchStock
  groups: WatchlistGroup[]
  groupCount: number
  className?: string
  placement?: 'above' | 'below'
  style?: CSSProperties
  popoverRef?: Ref<HTMLDivElement>
  onToggleGroup: (groupId: string, checked: boolean) => void
  onManageGroups: () => void
  onClose: () => void
}

export function StockGroupQuickPopover({
  id,
  stock,
  groups,
  groupCount,
  className = '',
  placement = 'below',
  style,
  popoverRef,
  onToggleGroup,
  onManageGroups,
  onClose
}: StockGroupQuickPopoverProps) {
  return (
    <div
      className={`watchlist-group-quick-popover ${placement === 'above' ? 'is-above' : ''} ${className}`.trim()}
      id={id}
      style={style}
      ref={popoverRef}
      role="dialog"
      aria-label={`调整 ${stock.name} 的分组`}
    >
      <div className="watchlist-group-quick-heading">
        <span>
          <strong>{stock.name}</strong>
          <small>
            {stock.code} · 已加入 {groupCount} 个分组
          </small>
        </span>
        <button
          className="icon-button watchlist-group-quick-close"
          type="button"
          onClick={onClose}
          aria-label="关闭分组选择"
          title="关闭"
        >
          <X size={14} />
        </button>
      </div>
      <div className="watchlist-group-quick-list">
        {groups.map((group) => {
          const checked = Boolean(stock.groupIds?.includes(group.id))
          const trackingGroup = isTrackingWatchlistGroup(group)
          const holdingGroup = isHoldingWatchlistGroup(group)
          const automaticGroup = trackingGroup || holdingGroup
          const automaticDescription = trackingGroup ? '由追踪状态自动维护' : '由持仓数量自动维护'
          return (
            <label
              className={`watchlist-group-quick-row ${checked ? 'is-selected' : ''} ${automaticGroup ? 'is-readonly' : ''}`}
              key={group.id}
              title={automaticGroup ? `${group.name}分组${automaticDescription}` : undefined}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={automaticGroup}
                onChange={(event) => onToggleGroup(group.id, event.target.checked)}
                aria-label={
                  automaticGroup
                    ? `${group.name}分组${automaticDescription}`
                    : `${checked ? '移出' : '加入'}分组 ${group.name}`
                }
              />
              <span>
                <strong>{group.name}</strong>
                <small>
                  {automaticGroup ? automaticDescription : checked ? '已加入' : '点击加入'}
                </small>
              </span>
            </label>
          )
        })}
      </div>
      <div className="watchlist-group-quick-footer">
        <button className="secondary-button" type="button" onClick={onManageGroups}>
          <Folders size={15} />
          管理分组…
        </button>
      </div>
    </div>
  )
}
