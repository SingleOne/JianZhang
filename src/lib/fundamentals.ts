import type {
  FundamentalCompany,
  FundamentalIndustryBenchmark,
  FundamentalSnapshot
} from '../shared/types'

function industryKey(company: FundamentalCompany): string {
  return `${company.industryCode}\u0000${company.industryName}`
}

function percentile(values: readonly number[], quantile: number): number {
  const position = (values.length - 1) * quantile
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return values[lower]
  return values[lower] + (values[upper] - values[lower]) * (position - lower)
}

function rankPercentile(
  values: readonly number[],
  value: number | null | undefined
): number | null {
  if (value === null || value === undefined || values.length === 0) return null
  return (
    Math.round(
      ((values.filter((candidate) => candidate <= value).length / values.length) * 100 +
        Number.EPSILON) *
        10_000
    ) / 10_000
  )
}

function completeAnnualMetric(
  company: FundamentalCompany,
  metric: (report: FundamentalCompany['annualReports'][number]) => number | null | undefined
): boolean {
  return (
    company.annualReports.length > 0 &&
    company.annualReports.every((report) => metric(report) != null)
  )
}

function createCoverage(
  rows: readonly FundamentalCompany[],
  industryCount: number
): FundamentalSnapshot['coverage'] {
  return {
    companyCount: rows.length,
    completeFiveYearRoeCount: rows.filter((company) =>
      completeAnnualMetric(company, (report) => report.deductedWeightedAverageRoe)
    ).length,
    completeFiveYearCashProfitCount: rows.filter(
      (company) =>
        completeAnnualMetric(company, (report) => report.netProfit) &&
        completeAnnualMetric(company, (report) => report.operatingCashFlow)
    ).length,
    completeFiveYearFreeCashFlowCount: rows.filter((company) =>
      completeAnnualMetric(company, (report) => report.freeCashFlow)
    ).length,
    completeFiveYearRoicCount: rows.filter((company) =>
      completeAnnualMetric(company, (report) => report.roic)
    ).length,
    latestDebtAssetRatioCount: rows.filter(
      (company) => company.latestBalanceSheet.debtAssetRatio !== null
    ).length,
    latestIndustryPercentileCount: rows.filter(
      (company) => company.latestBalanceSheet.industryPercentile != null
    ).length,
    latestNetDebtCount: rows.filter((company) => company.latestBalanceSheet.netDebt != null).length,
    latestValuationCount: rows.filter(
      (company) =>
        company.valuation?.priceEarningsRatioTtm != null ||
        company.valuation?.priceBookRatio != null
    ).length,
    latestTotalMarketValueCount: rows.filter(
      (company) => company.valuation?.totalMarketValue != null
    ).length,
    latestCirculatingMarketValueCount: rows.filter(
      (company) => company.valuation?.circulatingMarketValue != null
    ).length,
    latestPriceEarningsIndustryPercentileCount: rows.filter(
      (company) => company.valuation?.priceEarningsIndustryPercentile != null
    ).length,
    latestPriceBookIndustryPercentileCount: rows.filter(
      (company) => company.valuation?.priceBookIndustryPercentile != null
    ).length,
    latestPriceCashFlowIndustryPercentileCount: rows.filter(
      (company) => company.valuation?.priceCashFlowIndustryPercentile != null
    ).length,
    latestQuarterlyRiskReportCount: rows.filter((company) =>
      Boolean(company.quarterlyRiskReports?.length)
    ).length,
    completeQuarterlyRiskIndicatorCount: rows.filter((company) => {
      const reports = company.quarterlyRiskReports ?? []
      const latest = reports.at(-1)
      return Boolean(
        latest &&
        latest.receivableRevenueDivergence !== null &&
        latest.inventoryDaysChangeYoY !== null &&
        latest.goodwillAssetRatio !== null &&
        reports.some((report) => report.operatingCashFlowQuarter !== null)
      )
    }).length,
    companyBusinessProfileCount: rows.filter((company) =>
      Boolean(
        company.businessProfile?.mainBusiness ||
        company.businessProfile?.organizationProfile ||
        company.businessProfile?.businessScope
      )
    ).length,
    strictFcffCompanyCount: rows.filter((company) =>
      company.annualReports.some((report) => report.fcffBreakdown?.fcff != null)
    ).length,
    completeStrictFcffCompanyCount: rows.filter(
      (company) =>
        company.annualReports.length > 0 &&
        company.annualReports.every((report) => report.fcffBreakdown?.fcff != null)
    ).length,
    industryCount
  }
}

export function mergeFundamentalStockSnapshot(
  current: FundamentalSnapshot,
  update: FundamentalSnapshot
): FundamentalSnapshot {
  const updatedCompany = update.rows[0]
  if (!updatedCompany || update.rows.length !== 1) {
    throw new Error('单股基本面更新结果不完整')
  }

  const nextCompany: FundamentalCompany = {
    ...updatedCompany,
    dataSchemaVersion: update.schemaVersion,
    dataSnapshotDate: update.snapshotDate,
    dataGeneratedAt: update.generatedAt
  }
  const mergedRows = current.rows.some((company) => company.code === nextCompany.code)
    ? current.rows.map((company) =>
        company.code === nextCompany.code
          ? nextCompany
          : { ...company, dataSchemaVersion: company.dataSchemaVersion ?? current.schemaVersion }
      )
    : [
        ...current.rows.map((company) => ({
          ...company,
          dataSchemaVersion: company.dataSchemaVersion ?? current.schemaVersion
        })),
        nextCompany
      ].sort((left, right) => left.code.localeCompare(right.code))
  const debtValues = new Map<string, number[]>()
  const valuationValues = new Map<string, { pe: number[]; pb: number[]; pcf: number[] }>()

  for (const company of mergedRows) {
    const key = industryKey(company)
    const debt = company.latestBalanceSheet.debtAssetRatio
    if (company.industryCode && company.industryName && debt !== null) {
      const values = debtValues.get(key) ?? []
      values.push(debt)
      debtValues.set(key, values)
    }
    if (company.industryCode && company.industryName) {
      const metrics = valuationValues.get(key) ?? { pe: [], pb: [], pcf: [] }
      const valuation = company.valuation
      if (valuation?.priceEarningsRatioTtm != null && valuation.priceEarningsRatioTtm > 0) {
        metrics.pe.push(valuation.priceEarningsRatioTtm)
      }
      if (valuation?.priceBookRatio != null && valuation.priceBookRatio > 0) {
        metrics.pb.push(valuation.priceBookRatio)
      }
      if (
        (company.organizationType === 'general' || company.organizationType === 'other') &&
        valuation?.priceCashFlowRatioTtm != null &&
        valuation.priceCashFlowRatioTtm > 0
      ) {
        metrics.pcf.push(valuation.priceCashFlowRatioTtm)
      }
      valuationValues.set(key, metrics)
    }
  }

  for (const values of debtValues.values()) values.sort((left, right) => left - right)
  for (const metrics of valuationValues.values()) {
    metrics.pe.sort((left, right) => left - right)
    metrics.pb.sort((left, right) => left - right)
    metrics.pcf.sort((left, right) => left - right)
  }

  const rows = mergedRows.map((company): FundamentalCompany => {
    const key = industryKey(company)
    const industryDebtValues = debtValues.get(key) ?? []
    const metrics = valuationValues.get(key) ?? { pe: [], pb: [], pcf: [] }
    return {
      ...company,
      latestBalanceSheet: {
        ...company.latestBalanceSheet,
        industryPercentile: rankPercentile(
          industryDebtValues,
          company.latestBalanceSheet.debtAssetRatio
        )
      },
      valuation: company.valuation
        ? {
            ...company.valuation,
            priceEarningsIndustryPercentile:
              company.valuation.priceEarningsRatioTtm != null &&
              company.valuation.priceEarningsRatioTtm > 0
                ? rankPercentile(metrics.pe, company.valuation.priceEarningsRatioTtm)
                : null,
            priceBookIndustryPercentile:
              company.valuation.priceBookRatio != null && company.valuation.priceBookRatio > 0
                ? rankPercentile(metrics.pb, company.valuation.priceBookRatio)
                : null,
            priceCashFlowIndustryPercentile:
              company.valuation.priceCashFlowRatioTtm != null &&
              company.valuation.priceCashFlowRatioTtm > 0
                ? rankPercentile(metrics.pcf, company.valuation.priceCashFlowRatioTtm)
                : null,
            priceEarningsIndustrySampleSize: metrics.pe.length,
            priceBookIndustrySampleSize: metrics.pb.length,
            priceCashFlowIndustrySampleSize: metrics.pcf.length
          }
        : undefined
    }
  })
  const industries: FundamentalIndustryBenchmark[] = [...debtValues.entries()]
    .map(([key, values]) => {
      const [code, name] = key.split('\u0000')
      return {
        code,
        name,
        sampleSize: values.length,
        debtAssetRatioP60: Math.round((percentile(values, 0.6) + Number.EPSILON) * 10_000) / 10_000
      }
    })
    .sort((left, right) => left.code.localeCompare(right.code))

  return {
    ...current,
    coverage: createCoverage(rows, industries.length),
    industries,
    rows
  }
}

export function parseFundamentalSnapshot(content: string): FundamentalSnapshot {
  const snapshot = JSON.parse(content) as FundamentalSnapshot
  if (
    (snapshot.schemaVersion !== 1 &&
      snapshot.schemaVersion !== 2 &&
      snapshot.schemaVersion !== 3 &&
      snapshot.schemaVersion !== 4 &&
      snapshot.schemaVersion !== 5 &&
      snapshot.schemaVersion !== 6 &&
      snapshot.schemaVersion !== 7 &&
      snapshot.schemaVersion !== 8 &&
      snapshot.schemaVersion !== 9 &&
      snapshot.schemaVersion !== 10 &&
      snapshot.schemaVersion !== 11) ||
    !snapshot.snapshotDate ||
    !Array.isArray(snapshot.fiscalYears) ||
    !Array.isArray(snapshot.industries) ||
    !Array.isArray(snapshot.rows)
  ) {
    throw new Error('基本面财务数据快照格式不受支持')
  }
  return snapshot
}
