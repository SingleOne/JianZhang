import {
  BookOpen,
  ExternalLink,
  FileText,
  GraduationCap,
  RefreshCw,
  Search,
  TriangleAlert
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { COMPANY_REPORT_READING_HINTS, COMPANY_REPORT_TYPE_LABELS } from '../lib/company-reports'
import { stockApi } from '../lib/api'
import type { FundamentalScreeningEvaluation } from '../lib/fundamental-screening'
import type {
  CompanyReportItem,
  CompanyReportLibraryResult,
  CompanyReportType,
  WatchStock
} from '../shared/types'
import './CompanyReportLibrary.css'

type LibrarySection = 'reports' | 'guide'
type ReportFilter = 'all' | CompanyReportType

const REPORT_TYPES = Object.keys(COMPANY_REPORT_TYPE_LABELS) as CompanyReportType[]
const reportLibraryCache = new Map<string, CompanyReportLibraryResult>()

const REPORT_VARIANT_LABELS = {
  full: '全文',
  summary: '摘要',
  english: '英文版'
} as const

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(value))
}

function formatPercent(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined
    ? '--'
    : `${value.toLocaleString('zh-CN', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits
      })}%`
}

function directionClass(value: number | null | undefined): string {
  return value === null || value === undefined || value === 0
    ? 'is-zero'
    : value > 0
      ? 'is-positive'
      : 'is-negative'
}

function FundamentalReadingGuide({ evaluation }: { evaluation?: FundamentalScreeningEvaluation }) {
  const company = evaluation?.company
  const reports = company?.annualReports ?? []
  const roeValues = reports.flatMap((report) =>
    report.weightedAverageRoe === null ? [] : [report.weightedAverageRoe]
  )
  const roeRange = roeValues.length > 0 ? Math.max(...roeValues) - Math.min(...roeValues) : null
  const latest = reports.at(-1)
  const earliest = reports.at(0)

  return (
    <div className="fundamental-reading-guide">
      <section className="report-guide-intro">
        <span>
          <GraduationCap size={24} />
        </span>
        <div>
          <small>基本面阅读方法</small>
          <strong>先判断企业是否值得研究，再判断当前价格是否合适</strong>
          <p>
            不要只盯一个 ROE 或
            PE。把盈利能力、增长、现金、负债和估值串起来，最后回到财报原文核实原因。
          </p>
        </div>
      </section>

      <section className="report-guide-section">
        <header>
          <span>01</span>
          <div>
            <strong>先用五年数据做体检</strong>
            <small>看趋势和一致性，不被单年高点误导</small>
          </div>
        </header>
        <div className="report-guide-metric-grid">
          <article>
            <small>五年最低加权 ROE</small>
            <strong className={directionClass(evaluation?.minimumRoe)}>
              {formatPercent(evaluation?.minimumRoe)}
            </strong>
            <p>ROE 表示股东投入资本的赚钱效率。长期较高且稳定，比某一年突然很高更有参考价值。</p>
          </article>
          <article>
            <small>五年 ROE 波动范围</small>
            <strong>{formatPercent(roeRange)}</strong>
            <p>波动越小通常代表盈利质量越稳定；若 ROE 很高但持续下降，要查竞争力是否减弱。</p>
          </article>
          <article>
            <small>五年累计现金转换率</small>
            <strong className={directionClass(evaluation?.cumulativeCashConversion)}>
              {formatPercent(evaluation?.cumulativeCashConversion)}
            </strong>
            <p>
              经营现金流 ÷ 净利润。长期高于 100% 较理想，明显偏低时要查应收、存货或利润确认方式。
            </p>
          </article>
          <article>
            <small>行业负债分位</small>
            <strong>{formatPercent(company?.latestBalanceSheet.industryPercentile, 1)}</strong>
            <p>
              必须与同行比较。越靠前代表负债率高于更多同行，但银行、保险和券商不能套用普通企业口径。
            </p>
          </article>
        </div>
        {company ? (
          <div className="report-guide-practice">
            <strong>用 {company.name} 当前数据练习</strong>
            <span>
              从 {earliest?.year ?? '--'} 到 {latest?.year ?? '--'} 年，先看 ROE
              是否稳定，再比较净利润和经营现金流是否同向，
              最后打开最新年报核实变化来自销量、价格、成本、应收、存货还是负债。
            </span>
          </div>
        ) : (
          <div className="report-guide-practice">
            <span>当前股票还没有基本面快照，可先阅读下面的方法，再更新基本面财务数据。</span>
          </div>
        )}
      </section>

      <section className="report-guide-section">
        <header>
          <span>02</span>
          <div>
            <strong>把三张表串起来</strong>
            <small>利润是结果，现金是验证，资产负债表解释代价和风险</small>
          </div>
        </header>
        <div className="report-three-statements">
          <article>
            <strong>利润表：赚了多少</strong>
            <p>
              依次看营收、毛利率、费用率、营业利润和扣非净利润。利润增长要分清是主营增长，还是投资收益、资产处置等一次性项目。
            </p>
          </article>
          <article>
            <strong>现金流量表：利润有没有变成钱</strong>
            <p>
              重点比较经营现金流与净利润。利润上涨但经营现金流持续下降，常见原因是应收增加、存货积压或付款节奏改变。
            </p>
          </article>
          <article>
            <strong>资产负债表：赚钱付出了什么</strong>
            <p>
              检查应收、存货、有息负债和商誉是否比收入增长更快。高 ROE
              如果主要依赖高杠杆，质量与低负债 ROE 不同。
            </p>
          </article>
        </div>
      </section>

      <section className="report-guide-section">
        <header>
          <span>03</span>
          <div>
            <strong>打开年报后按这个顺序读</strong>
            <small>先读关键章节，再决定是否深入附注</small>
          </div>
        </header>
        <ol className="report-reading-order">
          <li>
            <strong>公司业务概要</strong>
            <span>弄清公司靠什么赚钱、客户是谁、是否有周期性。</span>
          </li>
          <li>
            <strong>管理层讨论与分析</strong>
            <span>找收入、成本和利润变化的经营原因，并与上一年的说法对照。</span>
          </li>
          <li>
            <strong>审计报告</strong>
            <span>优先确认是否为标准无保留意见，再看关键审计事项。</span>
          </li>
          <li>
            <strong>合并财务报表</strong>
            <span>用利润表、现金流量表和资产负债表互相验证。</span>
          </li>
          <li>
            <strong>财务报表附注</strong>
            <span>重点查应收账款、存货、商誉、借款、关联交易和收入确认政策。</span>
          </li>
          <li>
            <strong>分红与资本开支</strong>
            <span>判断赚到的钱最终用于回报股东、扩大再生产，还是填补资金缺口。</span>
          </li>
        </ol>
      </section>

      <section className="report-guide-warning">
        <TriangleAlert size={19} />
        <div>
          <strong>几个常见误区</strong>
          <p>
            高 ROE 不一定好，可能来自高负债；低 PE
            不一定便宜，可能反映利润处于周期高点；利润增长不等于现金增长；好公司也可能因为价格过高而不是好投资。
          </p>
        </div>
      </section>
    </div>
  )
}

function ReportRow({ report, onOpen }: { report: CompanyReportItem; onOpen: () => void }) {
  return (
    <button className="company-report-row" type="button" onClick={onOpen}>
      <span className={`company-report-file is-${report.reportType}`}>
        <FileText size={19} />
      </span>
      <span className="company-report-copy">
        <strong>{report.title}</strong>
        <small>
          公告日期 {formatDate(report.publishedAt)} ·{' '}
          {COMPANY_REPORT_READING_HINTS[report.reportType]}
        </small>
      </span>
      <span className="company-report-badges">
        <em>{COMPANY_REPORT_TYPE_LABELS[report.reportType]}</em>
        <em className={`is-${report.variant}`}>{REPORT_VARIANT_LABELS[report.variant]}</em>
        {report.amended ? <em className="is-amended">修订</em> : null}
      </span>
      <ExternalLink size={16} />
    </button>
  )
}

export function CompanyReportLibrary({
  stock,
  fundamentalEvaluation
}: {
  stock: WatchStock
  fundamentalEvaluation?: FundamentalScreeningEvaluation
}) {
  const [activeSection, setActiveSection] = useState<LibrarySection>('reports')
  const [snapshot, setSnapshot] = useState<CompanyReportLibraryResult | null>(
    () => reportLibraryCache.get(stock.code) ?? null
  )
  const [loading, setLoading] = useState(!snapshot)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [reportType, setReportType] = useState<ReportFilter>('all')
  const [year, setYear] = useState<number | 'all'>('all')
  const [includeVariants, setIncludeVariants] = useState(false)

  const loadReports = useCallback(
    async (forceRefresh = false) => {
      setLoading(true)
      setError('')
      try {
        const result = await stockApi.getCompanyReports(stock.code, forceRefresh)
        reportLibraryCache.set(stock.code, result)
        setSnapshot(result)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : '公司财报目录获取失败')
      } finally {
        setLoading(false)
      }
    },
    [stock.code]
  )

  useEffect(() => {
    const cached = reportLibraryCache.get(stock.code)
    setSnapshot(cached ?? null)
    setQuery('')
    setReportType('all')
    setYear('all')
    if (!cached) void loadReports()
  }, [loadReports, stock.code])

  const baseReports = useMemo(
    () => snapshot?.reports.filter((report) => includeVariants || report.variant === 'full') ?? [],
    [includeVariants, snapshot]
  )
  const years = useMemo(
    () =>
      [...new Set(baseReports.map((report) => report.reportYear))].sort(
        (left, right) => right - left
      ),
    [baseReports]
  )
  const counts = useMemo(
    () =>
      new Map<ReportFilter, number>([
        ['all', baseReports.length],
        ...REPORT_TYPES.map((type): [CompanyReportType, number] => [
          type,
          baseReports.filter((report) => report.reportType === type).length
        ])
      ]),
    [baseReports]
  )
  const visibleReports = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return baseReports.filter(
      (report) =>
        (reportType === 'all' || report.reportType === reportType) &&
        (year === 'all' || report.reportYear === year) &&
        (!keyword || report.title.toLowerCase().includes(keyword))
    )
  }, [baseReports, query, reportType, year])
  const groupedReports = useMemo(() => {
    const groups = new Map<number, CompanyReportItem[]>()
    for (const report of visibleReports) {
      groups.set(report.reportYear, [...(groups.get(report.reportYear) ?? []), report])
    }
    return [...groups.entries()]
  }, [visibleReports])

  const openReport = (report: CompanyReportItem) => {
    void stockApi.openCompanyReport(report.url).catch((reason) => {
      setError(reason instanceof Error ? reason.message : '财报原文打开失败')
    })
  }

  return (
    <div className="company-report-library" role="tabpanel">
      <header className="company-report-header">
        <span className="company-report-header-icon">
          <BookOpen size={24} />
        </span>
        <span>
          <small>{stock.code} · 上市公司定期报告</small>
          <strong>{stock.name}财报库</strong>
          <em>目录来自巨潮资讯，点击条目打开官方披露 PDF</em>
        </span>
        {activeSection === 'reports' ? (
          <button type="button" onClick={() => void loadReports(true)} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'is-spinning' : ''} />
            {loading ? '查询中' : '更新目录'}
          </button>
        ) : null}
      </header>

      <div className="company-report-section-tabs" role="tablist" aria-label="财报库内容">
        <button
          className={activeSection === 'reports' ? 'is-active' : ''}
          type="button"
          role="tab"
          aria-selected={activeSection === 'reports'}
          onClick={() => setActiveSection('reports')}
        >
          <FileText size={15} />
          财报目录
        </button>
        <button
          className={activeSection === 'guide' ? 'is-active' : ''}
          type="button"
          role="tab"
          aria-selected={activeSection === 'guide'}
          onClick={() => setActiveSection('guide')}
        >
          <GraduationCap size={16} />
          基本面怎么看
        </button>
      </div>

      {activeSection === 'guide' ? (
        <FundamentalReadingGuide evaluation={fundamentalEvaluation} />
      ) : (
        <>
          {snapshot?.warning ? (
            <div className="company-report-warning">
              <TriangleAlert size={16} />
              {snapshot.warning}
            </div>
          ) : null}
          {error ? (
            <div className="company-report-error">
              <TriangleAlert size={16} />
              {error}
            </div>
          ) : null}

          <div className="company-report-toolbar">
            <label className="company-report-search">
              <Search size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索报告标题"
                aria-label="搜索财报标题"
              />
            </label>
            <label>
              <span>财年</span>
              <select
                value={year}
                onChange={(event) =>
                  setYear(event.target.value === 'all' ? 'all' : Number(event.target.value))
                }
              >
                <option value="all">全部</option>
                {years.map((item) => (
                  <option value={item} key={item}>
                    {item} 年
                  </option>
                ))}
              </select>
            </label>
            <label className="company-report-variant-toggle">
              <input
                type="checkbox"
                checked={includeVariants}
                onChange={(event) => setIncludeVariants(event.target.checked)}
              />
              包含摘要和英文版
            </label>
          </div>

          <div className="company-report-type-tabs" role="tablist" aria-label="财报类型">
            {(['all', ...REPORT_TYPES] as ReportFilter[]).map((type) => (
              <button
                className={reportType === type ? 'is-active' : ''}
                type="button"
                role="tab"
                aria-selected={reportType === type}
                onClick={() => setReportType(type)}
                key={type}
              >
                {type === 'all' ? '全部' : COMPANY_REPORT_TYPE_LABELS[type]}
                <small>{counts.get(type) ?? 0}</small>
              </button>
            ))}
          </div>

          {loading && !snapshot ? (
            <div className="company-report-empty">
              <RefreshCw size={22} className="is-spinning" />
              <span>正在查询近十年财报目录…</span>
            </div>
          ) : !snapshot && error ? (
            <div className="company-report-empty">
              <button type="button" onClick={() => void loadReports()}>
                重新查询
              </button>
            </div>
          ) : groupedReports.length === 0 ? (
            <div className="company-report-empty">
              <FileText size={22} />
              <span>当前筛选条件下没有财报</span>
            </div>
          ) : (
            <div className="company-report-groups">
              {groupedReports.map(([reportYear, reports]) => (
                <section key={reportYear}>
                  <header>
                    <strong>{reportYear} 财年</strong>
                    <small>{reports.length} 份披露文件</small>
                  </header>
                  <div>
                    {reports.map((report) => (
                      <ReportRow
                        report={report}
                        onOpen={() => openReport(report)}
                        key={report.id}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}

          {snapshot ? (
            <footer className="company-report-source">
              <span>来源：{snapshot.source}</span>
              <span>
                范围：{snapshot.periodStart}—{snapshot.periodEnd}
              </span>
              <span>
                目录更新：{formatDate(snapshot.fetchedAt)}
                {snapshot.fromCache ? ' · 本地缓存' : ''}
              </span>
            </footer>
          ) : null}
        </>
      )}
    </div>
  )
}
