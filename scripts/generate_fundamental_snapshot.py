"""分四阶段生成 A 股基本面财务数据快照。

阶段一：最近五个完整财年的加权 ROE、扣非加权 ROE 和 ROIC。
阶段二：同期净利润、经营现金流、资本开支和自由现金流。
阶段三：最近完整财年的资产负债率、行业分位和净负债。
阶段四：同一交易日的 PE TTM、PB 及行业分位。
"""

from __future__ import annotations

import argparse
import bisect
import concurrent.futures
import datetime as dt
import json
import math
import re
import time
from collections import defaultdict
from pathlib import Path

import requests


EASTMONEY_DATA_API = "https://datacenter-web.eastmoney.com/api/data/v1/get"
PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = PROJECT_ROOT / "src" / "data" / "fundamental-snapshot.json"
DEFAULT_DIAGNOSTICS = PROJECT_ROOT / "outputs" / "fundamental-data-diagnostics.json"
PAGE_SIZE = 500
A_SHARE_TYPE = "058001001"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Safari/537.36"
)

MAIN_COLUMNS = (
    "SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,ORG_TYPE,REPORT_DATE,NOTICE_DATE,"
    "UPDATE_DATE,CURRENCY,ROEJQ,ROEKCJQ,ROIC,PARENTNETPROFIT,KCFJCXSYJLR,"
    "SECURITY_TYPE_CODE"
)
INCOME_COLUMNS = (
    "SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,INDUSTRY_CODE,INDUSTRY_NAME,"
    "SECURITY_TYPE_CODE,REPORT_DATE,NOTICE_DATE,TOTAL_PROFIT,INCOME_TAX,"
    "PARENT_NETPROFIT,DEDUCT_PARENT_NETPROFIT"
)
CASHFLOW_COLUMNS = (
    "SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,INDUSTRY_CODE,INDUSTRY_NAME,"
    "SECURITY_TYPE_CODE,REPORT_DATE,NOTICE_DATE,NETCASH_OPERATE,CONSTRUCT_LONG_ASSET"
)
BALANCE_COLUMNS = (
    "SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,INDUSTRY_CODE,INDUSTRY_NAME,"
    "SECURITY_TYPE_CODE,REPORT_DATE,NOTICE_DATE,TOTAL_ASSETS,TOTAL_LIABILITIES,"
    "DEBT_ASSET_RATIO"
)
DETAILED_BALANCE_COLUMNS = (
    "SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,ORG_TYPE,SECURITY_TYPE_CODE,"
    "REPORT_DATE,NOTICE_DATE,MONETARYFUNDS,SHORT_LOAN,SHORT_BOND_PAYABLE,"
    "NONCURRENT_LIAB_1YEAR,LONG_LOAN,BOND_PAYABLE,LEASE_LIAB"
)
VALUATION_COLUMNS = (
    "SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,TRADE_DATE,PE_TTM,PB_MRQ"
)
ORGANIZATION_TYPES = {
    "通用": "general",
    "银行": "bank",
    "证券": "securities",
    "保险": "insurance",
}


def log(message: str) -> None:
    print(f"[{dt.datetime.now():%H:%M:%S}] {message}", flush=True)


def request_page(params: dict) -> dict:
    last_error: Exception | None = None
    for attempt in range(4):
        try:
            response = requests.get(
                EASTMONEY_DATA_API,
                params=params,
                headers={"User-Agent": USER_AGENT, "Referer": "https://data.eastmoney.com/"},
                timeout=30,
            )
            response.raise_for_status()
            payload = response.json()
            if not payload.get("success") or not payload.get("result"):
                raise RuntimeError(str(payload.get("message") or "财务数据接口返回失败"))
            return payload["result"]
        except Exception as exc:
            last_error = exc
            if attempt < 3:
                time.sleep(0.5 * (attempt + 1))
    raise RuntimeError(f"财务数据接口请求失败：{last_error}")


def fetch_report(report_name: str, columns: str, report_date: str) -> list[dict]:
    return fetch_filtered_report(
        report_name,
        columns,
        f"(REPORT_DATE='{report_date}')",
        "SECURITY_CODE",
    )


def fetch_filtered_report(
    report_name: str,
    columns: str,
    filter_expression: str,
    sort_columns: str,
) -> list[dict]:
    base_params = {
        "reportName": report_name,
        "columns": columns,
        "pageSize": PAGE_SIZE,
        "sortColumns": sort_columns,
        "sortTypes": "1",
        "filter": filter_expression,
        "source": "WEB",
        "client": "WEB",
    }
    first = request_page({**base_params, "pageNumber": 1})
    pages = int(first.get("pages") or 1)
    rows_by_page: dict[int, list[dict]] = {1: first.get("data") or []}

    def fetch_page(page: int) -> tuple[int, list[dict]]:
        result = request_page({**base_params, "pageNumber": page})
        return page, result.get("data") or []

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(fetch_page, page) for page in range(2, pages + 1)]
        for future in concurrent.futures.as_completed(futures):
            page, rows = future.result()
            rows_by_page[page] = rows

    return [row for page in range(1, pages + 1) for row in rows_by_page[page]]


def latest_valuation_date(snapshot_date: str) -> str:
    result = request_page(
        {
            "reportName": "RPT_VALUEANALYSIS_DET",
            "columns": "TRADE_DATE",
            "pageSize": 1,
            "pageNumber": 1,
            "sortColumns": "TRADE_DATE",
            "sortTypes": "-1",
            "filter": f"(TRADE_DATE<='{snapshot_date}')",
            "source": "WEB",
            "client": "WEB",
        }
    )
    data = result.get("data") or []
    value = date_part(data[0].get("TRADE_DATE")) if data else None
    if not value:
        raise RuntimeError("未找到估值数据对应的最近交易日")
    return value


def a_share_rows(rows: list[dict]) -> dict[str, dict]:
    result: dict[str, dict] = {}
    for row in rows:
        code = str(row.get("SECURITY_CODE") or "")
        secucode = str(row.get("SECUCODE") or "")
        if row.get("SECURITY_TYPE_CODE") != A_SHARE_TYPE:
            continue
        if not re.fullmatch(r"\d{6}\.(?:SH|SZ|BJ)", secucode):
            continue
        if re.fullmatch(r"\d{6}", code):
            result[code] = row
    return result


def valuation_rows(rows: list[dict]) -> dict[str, dict]:
    result: dict[str, dict] = {}
    for row in rows:
        code = str(row.get("SECURITY_CODE") or "")
        secucode = str(row.get("SECUCODE") or "")
        if re.fullmatch(r"\d{6}\.(?:SH|SZ|BJ)", secucode) and re.fullmatch(r"\d{6}", code):
            result[code] = row
    return result


def number(value: object) -> float | None:
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else None
    except (TypeError, ValueError):
        return None


def rounded(value: float | None, digits: int = 2) -> float | None:
    return round(value, digits) if value is not None else None


def sum_nullable_fields(row: dict, fields: tuple[str, ...]) -> float | None:
    values = [number(row.get(field)) for field in fields]
    return sum(value or 0 for value in values) if any(value is not None for value in values) else None


def date_part(value: object) -> str | None:
    text = str(value or "")[:10]
    return text if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text) else None


def percentile(values: list[float], quantile: float) -> float:
    position = (len(values) - 1) * quantile
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return values[lower]
    return values[lower] + (values[upper] - values[lower]) * (position - lower)


def quote_id(secucode: str) -> str:
    code, market = secucode.split(".")
    return f"{'1' if market == 'SH' else '0'}.{code}"


def is_active_company_name(name: str) -> bool:
    return "退市" not in name and not name.endswith("退")


def generate(snapshot_date: str, years: int) -> tuple[dict, dict]:
    snapshot_day = dt.date.fromisoformat(snapshot_date)
    annual_reports_complete = snapshot_day >= dt.date(snapshot_day.year, 5, 1)
    latest_year = snapshot_day.year - (1 if annual_reports_complete else 2)
    fiscal_years = list(range(latest_year - years + 1, latest_year + 1))
    annual_dates = {year: f"{year}-12-31" for year in fiscal_years}

    log(f"阶段一/四：获取 {fiscal_years[0]}—{fiscal_years[-1]} 年 ROE 与 ROIC")
    main_by_year: dict[int, dict[str, dict]] = {}
    for year in fiscal_years:
        rows = fetch_report("RPT_F10_FINANCE_MAINFINADATA", MAIN_COLUMNS, annual_dates[year])
        main_by_year[year] = a_share_rows(rows)
        log(f"阶段一/四：{year} 年 ROE 已获取 {len(main_by_year[year]):,} 家")

    log(f"阶段二/四：获取 {fiscal_years[0]}—{fiscal_years[-1]} 年利润与现金流")
    income_by_year: dict[int, dict[str, dict]] = {}
    cashflow_by_year: dict[int, dict[str, dict]] = {}
    for year in fiscal_years:
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            income_future = pool.submit(
                fetch_report, "RPT_DMSK_FN_INCOME", INCOME_COLUMNS, annual_dates[year]
            )
            cashflow_future = pool.submit(
                fetch_report, "RPT_DMSK_FN_CASHFLOW", CASHFLOW_COLUMNS, annual_dates[year]
            )
            income_by_year[year] = a_share_rows(income_future.result())
            cashflow_by_year[year] = a_share_rows(cashflow_future.result())
        log(
            f"阶段二/四：{year} 年利润 {len(income_by_year[year]):,} 家，"
            f"现金流 {len(cashflow_by_year[year]):,} 家"
        )

    log(f"阶段三/四：获取 {latest_year} 年资产负债率、净负债并计算行业分位")
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        balance_future = pool.submit(
            fetch_report, "RPT_DMSK_FN_BALANCE", BALANCE_COLUMNS, annual_dates[latest_year]
        )
        detailed_balance_future = pool.submit(
            fetch_report,
            "RPT_F10_FINANCE_GBALANCE",
            DETAILED_BALANCE_COLUMNS,
            annual_dates[latest_year],
        )
        latest_balance = a_share_rows(balance_future.result())
        latest_detailed_balance = a_share_rows(detailed_balance_future.result())
    latest_balance = {
        code: row
        for code, row in latest_balance.items()
        if is_active_company_name(str(row.get("SECURITY_NAME_ABBR") or ""))
    }

    valuation_date = latest_valuation_date(snapshot_date)
    log(f"阶段四/四：获取 {valuation_date} 的 PE TTM、PB 并计算行业分位")
    latest_valuation = valuation_rows(
        fetch_filtered_report(
            "RPT_VALUEANALYSIS_DET",
            VALUATION_COLUMNS,
            f"(TRADE_DATE='{valuation_date}')",
            "SECURITY_CODE",
        )
    )

    industry_values: dict[tuple[str, str], list[float]] = defaultdict(list)
    for row in latest_balance.values():
        industry_code = str(row.get("INDUSTRY_CODE") or "")
        industry_name = str(row.get("INDUSTRY_NAME") or "")
        debt_asset_ratio = number(row.get("DEBT_ASSET_RATIO"))
        if industry_code and industry_name and debt_asset_ratio is not None:
            industry_values[(industry_code, industry_name)].append(debt_asset_ratio)
    for values in industry_values.values():
        values.sort()

    valuation_industry_values: dict[tuple[str, str], dict[str, list[float]]] = defaultdict(
        lambda: {"pe": [], "pb": []}
    )
    for code, balance in latest_balance.items():
        valuation = latest_valuation.get(code, {})
        key = (
            str(balance.get("INDUSTRY_CODE") or ""),
            str(balance.get("INDUSTRY_NAME") or ""),
        )
        pe_ttm = number(valuation.get("PE_TTM"))
        price_book = number(valuation.get("PB_MRQ"))
        if key[0] and key[1] and pe_ttm is not None and pe_ttm > 0:
            valuation_industry_values[key]["pe"].append(pe_ttm)
        if key[0] and key[1] and price_book is not None and price_book > 0:
            valuation_industry_values[key]["pb"].append(price_book)
    for metrics in valuation_industry_values.values():
        metrics["pe"].sort()
        metrics["pb"].sort()

    industries = [
        {
            "code": code,
            "name": name,
            "sampleSize": len(values),
            "debtAssetRatioP60": rounded(percentile(values, 0.6), 4),
        }
        for (code, name), values in sorted(industry_values.items(), key=lambda item: item[0][0])
    ]

    rows: list[dict] = []
    for code, balance in sorted(latest_balance.items()):
        secucode = str(balance["SECUCODE"])
        industry_code = str(balance.get("INDUSTRY_CODE") or "")
        industry_name = str(balance.get("INDUSTRY_NAME") or "")
        debt_asset_ratio = number(balance.get("DEBT_ASSET_RATIO"))
        peer_values = industry_values.get((industry_code, industry_name), [])
        latest_main = main_by_year[latest_year].get(code, {})
        detailed_balance = latest_detailed_balance.get(code, {})
        valuation = latest_valuation.get(code, {})
        annual_reports: list[dict] = []

        for year in fiscal_years:
            main = main_by_year[year].get(code, {})
            income = income_by_year[year].get(code, {})
            cashflow = cashflow_by_year[year].get(code, {})
            total_profit = number(income.get("TOTAL_PROFIT"))
            income_tax = number(income.get("INCOME_TAX"))
            net_profit = (
                total_profit - income_tax
                if total_profit is not None and income_tax is not None
                else None
            )
            operating_cash_flow = number(cashflow.get("NETCASH_OPERATE"))
            capital_expenditure = number(cashflow.get("CONSTRUCT_LONG_ASSET"))
            free_cash_flow = (
                operating_cash_flow - capital_expenditure
                if operating_cash_flow is not None and capital_expenditure is not None
                else None
            )
            annual_reports.append(
                {
                    "year": year,
                    "reportDate": annual_dates[year],
                    "noticeDate": date_part(
                        main.get("NOTICE_DATE")
                        or income.get("NOTICE_DATE")
                        or cashflow.get("NOTICE_DATE")
                    ),
                    "weightedAverageRoe": rounded(number(main.get("ROEJQ")), 4),
                    "deductedWeightedAverageRoe": rounded(number(main.get("ROEKCJQ")), 4),
                    "roic": rounded(number(main.get("ROIC")), 4),
                    "netProfit": rounded(net_profit),
                    "parentNetProfit": rounded(number(income.get("PARENT_NETPROFIT"))),
                    "deductedParentNetProfit": rounded(
                        number(income.get("DEDUCT_PARENT_NETPROFIT"))
                    ),
                    "operatingCashFlow": rounded(operating_cash_flow),
                    "capitalExpenditure": rounded(capital_expenditure),
                    "freeCashFlow": rounded(free_cash_flow),
                }
            )

        industry_percentile = None
        if peer_values and debt_asset_ratio is not None:
            industry_percentile = 100 * bisect.bisect_right(peer_values, debt_asset_ratio) / len(
                peer_values
            )

        interest_bearing_debt = sum_nullable_fields(
            detailed_balance,
            (
                "SHORT_LOAN",
                "SHORT_BOND_PAYABLE",
                "NONCURRENT_LIAB_1YEAR",
                "LONG_LOAN",
                "BOND_PAYABLE",
                "LEASE_LIAB",
            ),
        )
        monetary_funds = number(detailed_balance.get("MONETARYFUNDS"))
        net_debt = (
            interest_bearing_debt - monetary_funds
            if interest_bearing_debt is not None and monetary_funds is not None
            else None
        )
        pe_ttm = number(valuation.get("PE_TTM"))
        price_book = number(valuation.get("PB_MRQ"))
        valuation_peers = valuation_industry_values.get(
            (industry_code, industry_name), {"pe": [], "pb": []}
        )
        pe_percentile = (
            100 * bisect.bisect_right(valuation_peers["pe"], pe_ttm) / len(valuation_peers["pe"])
            if pe_ttm is not None and pe_ttm > 0 and valuation_peers["pe"]
            else None
        )
        pb_percentile = (
            100 * bisect.bisect_right(valuation_peers["pb"], price_book) / len(valuation_peers["pb"])
            if price_book is not None and price_book > 0 and valuation_peers["pb"]
            else None
        )

        rows.append(
            {
                "code": code,
                "name": str(balance.get("SECURITY_NAME_ABBR") or latest_main.get("SECURITY_NAME_ABBR") or code),
                "market": secucode.rsplit(".", 1)[1],
                "quoteId": quote_id(secucode),
                "organizationType": ORGANIZATION_TYPES.get(
                    str(latest_main.get("ORG_TYPE") or ""), "other"
                ),
                "industryCode": industry_code,
                "industryName": industry_name,
                "annualReports": annual_reports,
                "latestBalanceSheet": {
                    "reportDate": annual_dates[latest_year],
                    "noticeDate": date_part(balance.get("NOTICE_DATE")),
                    "totalAssets": rounded(number(balance.get("TOTAL_ASSETS"))),
                    "totalLiabilities": rounded(number(balance.get("TOTAL_LIABILITIES"))),
                    "debtAssetRatio": rounded(debt_asset_ratio, 4),
                    "industryPercentile": rounded(industry_percentile, 4),
                    "monetaryFunds": rounded(monetary_funds),
                    "interestBearingDebt": rounded(interest_bearing_debt),
                    "netDebt": rounded(net_debt),
                },
                "valuation": {
                    "dataDate": valuation_date,
                    "priceEarningsRatioTtm": rounded(pe_ttm, 4),
                    "priceBookRatio": rounded(price_book, 4),
                    "priceEarningsIndustryPercentile": rounded(pe_percentile, 4),
                    "priceBookIndustryPercentile": rounded(pb_percentile, 4),
                    "priceEarningsIndustrySampleSize": len(valuation_peers["pe"]),
                    "priceBookIndustrySampleSize": len(valuation_peers["pb"]),
                },
            }
        )

    complete_roe = sum(
        all(report["deductedWeightedAverageRoe"] is not None for report in row["annualReports"])
        for row in rows
    )
    complete_cash_profit = sum(
        all(
            report["netProfit"] is not None and report["operatingCashFlow"] is not None
            for report in row["annualReports"]
        )
        for row in rows
    )
    complete_free_cash_flow = sum(
        all(report["freeCashFlow"] is not None for report in row["annualReports"])
        for row in rows
    )
    complete_roic = sum(
        all(report["roic"] is not None for report in row["annualReports"])
        for row in rows
    )
    debt_asset_count = sum(
        row["latestBalanceSheet"]["debtAssetRatio"] is not None for row in rows
    )
    industry_percentile_count = sum(
        row["latestBalanceSheet"]["industryPercentile"] is not None for row in rows
    )
    net_debt_count = sum(row["latestBalanceSheet"]["netDebt"] is not None for row in rows)
    valuation_count = sum(
        row["valuation"]["priceEarningsRatioTtm"] is not None
        or row["valuation"]["priceBookRatio"] is not None
        for row in rows
    )
    pe_industry_percentile_count = sum(
        row["valuation"]["priceEarningsIndustryPercentile"] is not None for row in rows
    )
    pb_industry_percentile_count = sum(
        row["valuation"]["priceBookIndustryPercentile"] is not None for row in rows
    )

    generated_at = dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat(timespec="seconds")
    snapshot = {
        "schemaVersion": 3,
        "snapshotDate": snapshot_date,
        "generatedAt": generated_at,
        "currency": "CNY",
        "fiscalYears": fiscal_years,
        "latestAnnualReportDate": annual_dates[latest_year],
        "sources": [
            {
                "name": "东方财富主要财务指标",
                "reportName": "RPT_F10_FINANCE_MAINFINADATA",
                "url": EASTMONEY_DATA_API,
            },
            {
                "name": "东方财富利润表",
                "reportName": "RPT_DMSK_FN_INCOME",
                "url": EASTMONEY_DATA_API,
            },
            {
                "name": "东方财富现金流量表",
                "reportName": "RPT_DMSK_FN_CASHFLOW",
                "url": EASTMONEY_DATA_API,
            },
            {
                "name": "东方财富资产负债表",
                "reportName": "RPT_DMSK_FN_BALANCE",
                "url": EASTMONEY_DATA_API,
            },
            {
                "name": "东方财富详细资产负债表",
                "reportName": "RPT_F10_FINANCE_GBALANCE",
                "url": EASTMONEY_DATA_API,
            },
            {
                "name": "东方财富估值分析",
                "reportName": "RPT_VALUEANALYSIS_DET",
                "url": EASTMONEY_DATA_API,
            },
        ],
        "coverage": {
            "companyCount": len(rows),
            "completeFiveYearRoeCount": complete_roe,
            "completeFiveYearCashProfitCount": complete_cash_profit,
            "completeFiveYearFreeCashFlowCount": complete_free_cash_flow,
            "completeFiveYearRoicCount": complete_roic,
            "latestDebtAssetRatioCount": debt_asset_count,
            "latestIndustryPercentileCount": industry_percentile_count,
            "latestNetDebtCount": net_debt_count,
            "latestValuationCount": valuation_count,
            "latestPriceEarningsIndustryPercentileCount": pe_industry_percentile_count,
            "latestPriceBookIndustryPercentileCount": pb_industry_percentile_count,
            "industryCount": len(industries),
        },
        "industries": industries,
        "rows": rows,
    }
    diagnostics = {
        "schemaVersion": 3,
        "snapshotDate": snapshot_date,
        "generatedAt": generated_at,
        "fiscalYears": fiscal_years,
        "sourceRowCounts": {
            str(year): {
                "mainFinance": len(main_by_year[year]),
                "income": len(income_by_year[year]),
                "cashflow": len(cashflow_by_year[year]),
            }
            for year in fiscal_years
        },
        "latestBalanceRows": len(latest_balance),
        "latestDetailedBalanceRows": len(latest_detailed_balance),
        "latestValuationDate": valuation_date,
        "latestValuationRows": len(latest_valuation),
        "coverage": snapshot["coverage"],
    }
    log(
        f"阶段四/四：完成 {len(rows):,} 家公司、{len(industries):,} 个行业的财务与估值分位"
    )
    return snapshot, diagnostics


def main() -> None:
    parser = argparse.ArgumentParser(description="生成 A 股五年基本面财务数据快照")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--diagnostics", type=Path, default=DEFAULT_DIAGNOSTICS)
    parser.add_argument("--snapshot-date", default=dt.date.today().isoformat())
    parser.add_argument("--years", type=int, default=5)
    args = parser.parse_args()

    snapshot, diagnostics = generate(args.snapshot_date, args.years)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.diagnostics.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    args.diagnostics.write_text(
        json.dumps(diagnostics, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    log(f"基本面快照已写入：{args.output}")
    log(f"诊断数据已写入：{args.diagnostics}")


if __name__ == "__main__":
    main()
