import { Activity, Binoculars, ChartPie, Filter, Menu, Trophy } from 'lucide-react'
import type { ReactNode } from 'react'

interface TitlebarToolsMenuProps {
  open: boolean
  onToggle: () => void
  onOpenDividendRanking: () => void
  onOpenFundamentalScreening: () => void
  onOpenDailyMarketScan: () => void
  onOpenStockTracking: () => void
  onOpenPortfolioPerformance: () => void
}

interface ToolButtonProps {
  icon: ReactNode
  label: string
  description: string
  onClick: () => void
}

function ToolButton({ icon, label, description, onClick }: ToolButtonProps) {
  return (
    <button type="button" role="menuitem" onClick={onClick}>
      {icon}
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
    </button>
  )
}

export function TitlebarToolsMenu({
  open,
  onToggle,
  onOpenDividendRanking,
  onOpenFundamentalScreening,
  onOpenDailyMarketScan,
  onOpenStockTracking,
  onOpenPortfolioPerformance
}: TitlebarToolsMenuProps) {
  return (
    <details className="titlebar-tools-menu" open={open}>
      <summary
        className="secondary-button"
        title="更多功能"
        onClick={(event) => {
          event.preventDefault()
          onToggle()
        }}
      >
        <Menu size={17} />
        <span>功能</span>
      </summary>
      <div className="titlebar-tools-popover" role="menu" aria-label="更多功能">
        <ToolButton
          icon={<Trophy size={17} />}
          label="分红融资榜"
          description="查看 A 股分红与融资排名"
          onClick={onOpenDividendRanking}
        />
        <ToolButton
          icon={<Filter size={17} />}
          label="基本面初筛"
          description="按财务条件筛选公司"
          onClick={onOpenFundamentalScreening}
        />
        <ToolButton
          icon={<Activity size={17} />}
          label="收盘扫描"
          description="运行 A 股收盘扫描"
          onClick={onOpenDailyMarketScan}
        />
        <ToolButton
          icon={<Binoculars size={17} />}
          label="追踪复盘"
          description="管理选股追踪与复盘"
          onClick={onOpenStockTracking}
        />
        <ToolButton
          icon={<ChartPie size={17} />}
          label="收益分析"
          description="查看跨市场收益表现"
          onClick={onOpenPortfolioPerformance}
        />
      </div>
    </details>
  )
}
