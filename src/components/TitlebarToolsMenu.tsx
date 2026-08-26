import {
  Activity,
  Binoculars,
  ChartPie,
  CircleDollarSign,
  Filter,
  Menu,
  Plus,
  Trophy
} from 'lucide-react'
import { useRef, type ReactNode } from 'react'

interface TitlebarToolsMenuProps {
  canAddStock: boolean
  onAddStock: () => void
  onOpenDividendRanking: () => void
  onOpenFundamentalScreening: () => void
  onOpenDailyMarketScan: () => void
  onOpenStockTracking: () => void
  onOpenCorporateActionCenter: () => void
  onOpenPortfolioPerformance: () => void
}

interface ToolButtonProps {
  icon: ReactNode
  label: string
  description: string
  disabled?: boolean
  onClick: () => void
}

function ToolButton({ icon, label, description, disabled = false, onClick }: ToolButtonProps) {
  return (
    <button type="button" role="menuitem" disabled={disabled} onClick={onClick}>
      {icon}
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
    </button>
  )
}

export function TitlebarToolsMenu({
  canAddStock,
  onAddStock,
  onOpenDividendRanking,
  onOpenFundamentalScreening,
  onOpenDailyMarketScan,
  onOpenStockTracking,
  onOpenCorporateActionCenter,
  onOpenPortfolioPerformance
}: TitlebarToolsMenuProps) {
  const menuRef = useRef<HTMLDetailsElement>(null)
  const openTool = (action: () => void) => {
    menuRef.current?.removeAttribute('open')
    action()
  }

  return (
    <details className="titlebar-tools-menu" ref={menuRef}>
      <summary className="secondary-button" title="更多功能">
        <Menu size={17} />
        <span>功能</span>
      </summary>
      <div className="titlebar-tools-popover" role="menu" aria-label="更多功能">
        <ToolButton
          icon={<Plus size={17} />}
          label="添加自选"
          description={canAddStock ? '添加当前第一个搜索结果' : '请先输入股票代码或名称'}
          disabled={!canAddStock}
          onClick={() => openTool(onAddStock)}
        />
        <ToolButton
          icon={<Trophy size={17} />}
          label="分红融资榜"
          description="查看 A 股分红与融资排名"
          onClick={() => openTool(onOpenDividendRanking)}
        />
        <ToolButton
          icon={<Filter size={17} />}
          label="基本面初筛"
          description="按财务条件筛选公司"
          onClick={() => openTool(onOpenFundamentalScreening)}
        />
        <ToolButton
          icon={<Activity size={17} />}
          label="收盘扫描"
          description="运行 A 股收盘扫描"
          onClick={() => openTool(onOpenDailyMarketScan)}
        />
        <ToolButton
          icon={<Binoculars size={17} />}
          label="追踪复盘"
          description="管理选股追踪与复盘"
          onClick={() => openTool(onOpenStockTracking)}
        />
        <ToolButton
          icon={<CircleDollarSign size={17} />}
          label="公司行动"
          description="处理待确认公司行动"
          onClick={() => openTool(onOpenCorporateActionCenter)}
        />
        <ToolButton
          icon={<ChartPie size={17} />}
          label="收益分析"
          description="查看跨市场收益表现"
          onClick={() => openTool(onOpenPortfolioPerformance)}
        />
      </div>
    </details>
  )
}
