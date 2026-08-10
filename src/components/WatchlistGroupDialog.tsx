import { FolderPlus, Folders, Search, Trash2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { isSystemWatchlistGroup, isTrackingWatchlistGroup } from '../shared/types'
import type { StockQuote, WatchlistGroup, WatchStock } from '../shared/types'
import { useConfirmDialog } from './ConfirmDialog'

interface WatchlistGroupDialogProps {
  groups: WatchlistGroup[]
  stocks: WatchStock[]
  quotes: StockQuote[]
  onSave: (groups: WatchlistGroup[], groupIdsByQuoteId: Record<string, string[]>) => void
  onClose: () => void
}

export function WatchlistGroupDialog({
  groups: initialGroups,
  stocks,
  quotes,
  onSave,
  onClose
}: WatchlistGroupDialogProps) {
  const confirm = useConfirmDialog()
  const [groups, setGroups] = useState<WatchlistGroup[]>(() =>
    initialGroups.map((group) => ({ ...group }))
  )
  const [groupIdsByQuoteId, setGroupIdsByQuoteId] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(stocks.map((stock) => [stock.quoteId, [...(stock.groupIds ?? [])]]))
  )
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(
    initialGroups[0]?.id ?? null
  )
  const [newGroupName, setNewGroupName] = useState('')
  const [stockQuery, setStockQuery] = useState('')
  const quoteMap = useMemo(() => new Map(quotes.map((quote) => [quote.quoteId, quote])), [quotes])
  const selectedGroup = groups.find((group) => group.id === selectedGroupId)
  const selectedTrackingGroup = Boolean(selectedGroup && isTrackingWatchlistGroup(selectedGroup))
  const normalizedNames = groups.map((group) => group.name.trim().toLocaleLowerCase('zh-CN'))
  const namesInvalid =
    normalizedNames.some((name) => !name) ||
    new Set(normalizedNames).size !== normalizedNames.length
  const normalizedNewGroupName = newGroupName.trim().toLocaleLowerCase('zh-CN')
  const canAddGroup =
    Boolean(normalizedNewGroupName) && !normalizedNames.includes(normalizedNewGroupName)
  const filteredStocks = useMemo(() => {
    const query = stockQuery.trim().toLocaleLowerCase('zh-CN')
    if (!query) return stocks
    return stocks.filter((stock) => {
      const sectorName = quoteMap.get(stock.quoteId)?.sector?.name ?? ''
      return (
        stock.name.toLocaleLowerCase('zh-CN').includes(query) ||
        stock.code.includes(query) ||
        sectorName.toLocaleLowerCase('zh-CN').includes(query)
      )
    })
  }, [quoteMap, stockQuery, stocks])

  const groupStockCount = (groupId: string) =>
    stocks.filter((stock) => groupIdsByQuoteId[stock.quoteId]?.includes(groupId)).length

  const addGroup = () => {
    const name = newGroupName.trim()
    if (!canAddGroup) return
    const group = { id: crypto.randomUUID(), name }
    setGroups((current) => [...current, group])
    setSelectedGroupId(group.id)
    setNewGroupName('')
  }

  const deleteGroup = async (group: WatchlistGroup) => {
    if (isSystemWatchlistGroup(group)) return
    const confirmed = await confirm({
      title: '删除自定义分组',
      message: `确定删除分组“${group.name}”吗？组内股票不会从自选列表中删除。`,
      confirmLabel: '删除分组',
      tone: 'danger'
    })
    if (!confirmed) return
    const nextGroups = groups.filter((item) => item.id !== group.id)
    setGroups(nextGroups)
    setGroupIdsByQuoteId((current) =>
      Object.fromEntries(
        Object.entries(current).map(([quoteId, groupIds]) => [
          quoteId,
          groupIds.filter((groupId) => groupId !== group.id)
        ])
      )
    )
    if (selectedGroupId === group.id) setSelectedGroupId(nextGroups[0]?.id ?? null)
  }

  const toggleStock = (quoteId: string, checked: boolean) => {
    if (!selectedGroupId || selectedTrackingGroup) return
    setGroupIdsByQuoteId((current) => {
      const currentGroupIds = current[quoteId] ?? []
      return {
        ...current,
        [quoteId]: checked
          ? [...new Set([...currentGroupIds, selectedGroupId])]
          : currentGroupIds.filter((groupId) => groupId !== selectedGroupId)
      }
    })
  }

  const addFilteredStocks = () => {
    if (!selectedGroupId || selectedTrackingGroup) return
    setGroupIdsByQuoteId((current) => {
      const next = { ...current }
      for (const stock of filteredStocks) {
        next[stock.quoteId] = [...new Set([...(next[stock.quoteId] ?? []), selectedGroupId])]
      }
      return next
    })
  }

  const clearSelectedGroup = () => {
    if (!selectedGroupId || selectedTrackingGroup) return
    setGroupIdsByQuoteId((current) =>
      Object.fromEntries(
        Object.entries(current).map(([quoteId, groupIds]) => [
          quoteId,
          groupIds.filter((groupId) => groupId !== selectedGroupId)
        ])
      )
    )
  }

  return createPortal(
    <div className="position-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="position-dialog watchlist-group-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="watchlist-group-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
      >
        <header className="position-dialog-header">
          <div>
            <span className="position-dialog-icon">
              <Folders size={18} />
            </span>
            <span>
              <strong id="watchlist-group-dialog-title">管理自选分组</strong>
              <small>一只股票可以加入多个分组；系统分组不可改名或删除。</small>
            </span>
          </div>
          <button
            className="icon-button dialog-close"
            type="button"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </header>

        <form
          className="watchlist-group-form"
          onSubmit={(event) => {
            event.preventDefault()
            if (namesInvalid) return
            onSave(
              groups.map((group) => ({ ...group, name: group.name.trim() })),
              groupIdsByQuoteId
            )
          }}
        >
          <aside className="watchlist-group-sidebar">
            <div className="watchlist-group-create">
              <input
                type="text"
                value={newGroupName}
                onChange={(event) => setNewGroupName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  addGroup()
                }}
                placeholder="输入新分组名称"
                aria-label="新分组名称"
              />
              <button
                className="secondary-button"
                type="button"
                disabled={!canAddGroup}
                onClick={addGroup}
                title="新建分组"
              >
                <FolderPlus size={15} />
                新建
              </button>
            </div>
            <div className="watchlist-group-list">
              {groups.map((group) => (
                <div
                  className={`watchlist-group-list-item ${selectedGroupId === group.id ? 'is-active' : ''}`}
                  key={group.id}
                >
                  <button type="button" onClick={() => setSelectedGroupId(group.id)}>
                    <strong>{group.name || '未命名分组'}</strong>
                    <small>{groupStockCount(group.id)} 只股票</small>
                  </button>
                  {isSystemWatchlistGroup(group) ? (
                    <span className="watchlist-system-group-badge" title="系统默认分组">
                      系统
                    </span>
                  ) : (
                    <button
                      className="icon-button"
                      type="button"
                      onClick={() => deleteGroup(group)}
                      aria-label={`删除分组 ${group.name}`}
                      title="删除分组"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
              {groups.length === 0 ? (
                <div className="watchlist-group-list-empty">新建一个分组后，即可批量添加股票。</div>
              ) : null}
            </div>
          </aside>

          <div className="watchlist-group-content">
            {selectedGroup ? (
              <>
                <div className="watchlist-group-content-heading">
                  <label>
                    <span>分组名称</span>
                    <input
                      type="text"
                      value={selectedGroup.name}
                      disabled={isSystemWatchlistGroup(selectedGroup)}
                      title={
                        isSystemWatchlistGroup(selectedGroup) ? '系统默认分组不可改名' : undefined
                      }
                      onChange={(event) =>
                        setGroups((current) =>
                          current.map((group) =>
                            group.id === selectedGroup.id
                              ? { ...group, name: event.target.value }
                              : group
                          )
                        )
                      }
                    />
                  </label>
                  <div className="watchlist-group-stock-search">
                    <Search size={15} aria-hidden="true" />
                    <input
                      type="text"
                      value={stockQuery}
                      onChange={(event) => setStockQuery(event.target.value)}
                      placeholder="搜索股票、代码或板块"
                      aria-label="搜索待分组股票"
                    />
                  </div>
                </div>
                <div className="watchlist-group-batch-actions">
                  <span>
                    {selectedTrackingGroup
                      ? `追踪分组由开始/停止追踪自动维护，当前有 ${groupStockCount(selectedGroup.id)} 只股票`
                      : `当前分组已包含 ${groupStockCount(selectedGroup.id)} 只股票`}
                  </span>
                  <span>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={addFilteredStocks}
                      disabled={selectedTrackingGroup}
                    >
                      加入当前搜索结果
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={clearSelectedGroup}
                      disabled={selectedTrackingGroup}
                    >
                      清空当前分组
                    </button>
                  </span>
                </div>
                <div className="watchlist-group-stock-list">
                  {filteredStocks.map((stock) => {
                    const sectorName = quoteMap.get(stock.quoteId)?.sector?.name ?? '暂无板块'
                    return (
                      <label className="watchlist-group-stock-row" key={stock.quoteId}>
                        <input
                          type="checkbox"
                          checked={Boolean(
                            groupIdsByQuoteId[stock.quoteId]?.includes(selectedGroup.id)
                          )}
                          disabled={selectedTrackingGroup}
                          onChange={(event) => toggleStock(stock.quoteId, event.target.checked)}
                        />
                        <strong>{stock.name}</strong>
                        <span>{stock.code}</span>
                        <small>{sectorName}</small>
                      </label>
                    )
                  })}
                  {filteredStocks.length === 0 ? (
                    <div className="watchlist-group-stock-empty">没有匹配的股票。</div>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="watchlist-group-content-empty">
                <Folders size={28} />
                <strong>还没有自定义分组</strong>
                <span>请先在左侧输入名称并新建分组。</span>
              </div>
            )}
          </div>

          <footer className="watchlist-group-actions">
            <span className={namesInvalid ? 'is-error' : ''}>
              {namesInvalid
                ? '分组名称不能为空或重复。'
                : `共 ${groups.length} 个分组，保存后立即应用到筛选器。`}
            </span>
            <span>
              <button className="secondary-button compact-button" type="button" onClick={onClose}>
                取消
              </button>
              <button
                className="primary-button compact-button"
                type="submit"
                disabled={namesInvalid}
              >
                保存分组
              </button>
            </span>
          </footer>
        </form>
      </section>
    </div>,
    document.body
  )
}
