"""分五阶段生成 A 股基本面财务数据快照。

阶段一：最近五个完整财年的加权 ROE、扣非加权 ROE 和 ROIC。
阶段二：同期净利润、经营现金流、资本开支和自由现金流。
阶段三：最近完整财年的资产负债率、行业分位和净负债。
阶段四：同一交易日的收盘价、PE TTM、PB、总市值、流通市值及行业分位。
阶段五：最近季度的现金流、应收营收背离、存货周转和商誉占比。
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
QUARTERLY_INCOME_COLUMNS = (
    "SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,SECURITY_TYPE_CODE,REPORT_DATE,"
    "NOTICE_DATE,TOTAL_OPERATE_INCOME,OPERATE_COST"
)
QUARTERLY_CASHFLOW_COLUMNS = (
    "SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,SECURITY_TYPE_CODE,REPORT_DATE,"
    "NOTICE_DATE,NETCASH_OPERATE"
)
QUARTERLY_BALANCE_COLUMNS = (
    "SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,SECURITY_TYPE_CODE,REPORT_DATE,"
    "NOTICE_DATE,ACCOUNTS_RECE,INVENTORY,TOTAL_ASSETS"
)
QUARTERLY_DETAILED_BALANCE_COLUMNS = (
    "SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,SECURITY_TYPE_CODE,REPORT_DATE,"
    "NOTICE_DATE,GOODWILL"
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
    "SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,TRADE_DATE,CLOSE_PRICE,PE_TTM,PB_MRQ,"
    "TOTAL_MARKET_CAP,NOTLIMITED_MARKETCAP_A"
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
        "sortTypes": ",".join("1" for _ in sort_columns.split(",")),
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


def a_share_report_rows(rows: list[dict], snapshot_date: str) -> dict[str, dict[str, dict]]:
    result: dict[str, dict[str, dict]] = defaultdict(dict)
    for row in rows:
        code = str(row.get("SECURITY_CODE") or "")
        secucode = str(row.get("SECUCODE") or "")
        report_date = date_part(row.get("REPORT_DATE"))
        notice_date = date_part(row.get("NOTICE_DATE"))
        if row.get("SECURITY_TYPE_CODE") != A_SHARE_TYPE:
            continue
        if not re.fullmatch(r"\d{6}\.(?:SH|SZ|BJ)", secucode):
            continue
        if not re.fullmatch(r"\d{6}", code) or not report_date:
            continue
        if notice_date and notice_date > snapshot_date:
            continue
        result[code][report_date] = row
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


def quarter_end_dates(snapshot_day: dt.date, count: int = 13) -> list[str]:
    dates: list[dt.date] = []
    year = snapshot_day.year
    while len(dates) < count:
        for month in (12, 9, 6, 3):
            day = 31 if month in (3, 12) else 30
            value = dt.date(year, month, day)
            if value <= snapshot_day:
                dates.append(value)
                if len(dates) == count:
                    break
        year -= 1
    return sorted(value.isoformat() for value in dates)


def percentage_growth(current: float | None, previous: float | None) -> float | None:
    if current is None or previous is None:
        return None
    if previous == 0:
        return 0.0 if current == 0 else None
    return (current / previous - 1) * 100


def single_quarter_value(reports: dict[str, dict], report_date: str, field: str) -> float | None:
    current = number(reports.get(report_date, {}).get(field))
    date = dt.date.fromisoformat(report_date)
    if current is None or date.month == 3:
        return current
    previous_month = {6: 3, 9: 6, 12: 9}[date.month]
    previous_day = 31 if previous_month == 3 else 30
    previous_date = f"{date.year}-{previous_month:02d}-{previous_day:02d}"
    previous = number(reports.get(previous_date, {}).get(field))
    return current - previous if previous is not None else None


def inventory_turnover_days(
    balance_reports: dict[str, dict], income_reports: dict[str, dict], report_date: str
) -> float | None:
    date = dt.date.fromisoformat(report_date)
    current_inventory = number(balance_reports.get(report_date, {}).get("INVENTORY"))
    opening_inventory = number(
        balance_reports.get(f"{date.year - 1}-12-31", {}).get("INVENTORY")
    )
    operating_cost = number(income_reports.get(report_date, {}).get("OPERATE_COST"))
    if current_inventory is None or opening_inventory is None or not operating_cost or operating_cost <= 0:
        return None
    days = (date - dt.date(date.year, 1, 1)).days + 1
    return ((opening_inventory + current_inventory) / 2) / operating_cost * days


def build_quarterly_risk_reports(
    code: str,
    income_by_code: dict[str, dict[str, dict]],
    cashflow_by_code: dict[str, dict[str, dict]],
    balance_by_code: dict[str, dict[str, dict]],
    detailed_balance_by_code: dict[str, dict[str, dict]],
) -> list[dict]:
    income_reports = income_by_code.get(code, {})
    cashflow_reports = cashflow_by_code.get(code, {})
    balance_reports = balance_by_code.get(code, {})
    detailed_balance_reports = detailed_balance_by_code.get(code, {})
    available_dates = sorted(set(income_reports) | set(cashflow_reports) | set(balance_reports))
    reports: list[dict] = []

    for report_date in available_dates:
        date = dt.date.fromisoformat(report_date)
        prior_year_date = f"{date.year - 1}-{date.month:02d}-{date.day:02d}"
        income = income_reports.get(report_date, {})
        cashflow = cashflow_reports.get(report_date, {})
        balance = balance_reports.get(report_date, {})
        detailed_balance = detailed_balance_reports.get(report_date, {})
        previous_income = income_reports.get(prior_year_date, {})
        previous_balance = balance_reports.get(prior_year_date, {})
        operating_cash_flow_cumulative = number(cashflow.get("NETCASH_OPERATE"))
        accounts_receivable = number(balance.get("ACCOUNTS_RECE"))
        accounts_receivable_growth = percentage_growth(
            accounts_receivable, number(previous_balance.get("ACCOUNTS_RECE"))
        )
        total_operating_revenue = number(income.get("TOTAL_OPERATE_INCOME"))
        revenue_growth = percentage_growth(
            total_operating_revenue, number(previous_income.get("TOTAL_OPERATE_INCOME"))
        )
        divergence = (
            accounts_receivable_growth - revenue_growth
            if accounts_receivable_growth is not None and revenue_growth is not None
            else None
        )
        inventory_days = inventory_turnover_days(balance_reports, income_reports, report_date)
        previous_inventory_days = inventory_turnover_days(
            balance_reports, income_reports, prior_year_date
        )
        inventory_days_change = percentage_growth(inventory_days, previous_inventory_days)
        total_assets = number(balance.get("TOTAL_ASSETS"))
        goodwill = number(detailed_balance.get("GOODWILL"))
        if goodwill is None and detailed_balance and total_assets is not None:
            goodwill = 0.0
        goodwill_ratio = (
            goodwill / total_assets * 100
            if goodwill is not None and total_assets is not None and total_assets > 0
            else None
        )
        reports.append(
            {
                "reportDate": report_date,
                "noticeDate": date_part(
                    balance.get("NOTICE_DATE")
                    or detailed_balance.get("NOTICE_DATE")
                    or income.get("NOTICE_DATE")
                    or cashflow.get("NOTICE_DATE")
                ),
                "operatingCashFlowCumulative": rounded(operating_cash_flow_cumulative),
                "operatingCashFlowQuarter": rounded(
                    single_quarter_value(cashflow_reports, report_date, "NETCASH_OPERATE")
                ),
                "accountsReceivable": rounded(accounts_receivable),
                "accountsReceivableGrowthYoY": rounded(accounts_receivable_growth, 4),
                "totalOperatingRevenue": rounded(total_operating_revenue),
                "revenueGrowthYoY": rounded(revenue_growth, 4),
                "receivableRevenueDivergence": rounded(divergence, 4),
                "inventory": rounded(number(balance.get("INVENTORY"))),
                "operatingCost": rounded(number(income.get("OPERATE_COST"))),
                "inventoryTurnoverDays": rounded(inventory_days, 4),
                "inventoryDaysChangeYoY": rounded(inventory_days_change, 4),
                "goodwill": rounded(goodwill),
                "totalAssets": rounded(total_assets),
                "goodwillAssetRatio": rounded(goodwill_ratio, 4),
            }
        )
    return reports[-8:]


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
    quarterly_dates = quarter_end_dates(snapshot_day)
    quarterly_filter = (
        f"(REPORT_DATE>='{quarterly_dates[0]}')"
        f"(REPORT_DATE<='{quarterly_dates[-1]}')"
    )

    log(f"阶段一/五：获取 {fiscal_years[0]}—{fiscal_years[-1]} 年 ROE 与 ROIC")
    main_by_year: dict[int, dict[str, dict]] = {}
    for year in fiscal_years:
        rows = fetch_report("RPT_F10_FINANCE_MAINFINADATA", MAIN_COLUMNS, annual_dates[year])
        main_by_year[year] = a_share_rows(rows)
        log(f"阶段一/五：{year} 年 ROE 已获取 {len(main_by_year[year]):,} 家")

    log(f"阶段二/五：获取 {fiscal_years[0]}—{fiscal_years[-1]} 年利润与现金流")
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
            f"阶段二/五：{year} 年利润 {len(income_by_year[year]):,} 家，"
            f"现金流 {len(cashflow_by_year[year]):,} 家"
        )

    log(f"阶段三/五：获取 {latest_year} 年资产负债率、净负债并计算行业分位")
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
    log(f"阶段四/五：获取 {valuation_date} 的 PE TTM、PB、总市值、流通市值并计算行业分位")
    latest_valuation = valuation_rows(
        fetch_filtered_report(
            "RPT_VALUEANALYSIS_DET",
            VALUATION_COLUMNS,
            f"(TRADE_DATE='{valuation_date}')",
            "SECURITY_CODE",
        )
    )

    log(f"阶段五/五：获取 {quarterly_dates[0]}—{quarterly_dates[-1]} 季度财务排雷数据")
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        quarterly_income_future = pool.submit(
            fetch_filtered_report,
            "RPT_DMSK_FN_INCOME",
            QUARTERLY_INCOME_COLUMNS,
            quarterly_filter,
            "REPORT_DATE,SECURITY_CODE",
        )
        quarterly_cashflow_future = pool.submit(
            fetch_filtered_report,
            "RPT_DMSK_FN_CASHFLOW",
            QUARTERLY_CASHFLOW_COLUMNS,
            quarterly_filter,
            "REPORT_DATE,SECURITY_CODE",
        )
        quarterly_balance_future = pool.submit(
            fetch_filtered_report,
            "RPT_DMSK_FN_BALANCE",
            QUARTERLY_BALANCE_COLUMNS,
            quarterly_filter,
            "REPORT_DATE,SECURITY_CODE",
        )
        quarterly_detailed_balance_future = pool.submit(
            fetch_filtered_report,
            "RPT_F10_FINANCE_GBALANCE",
            QUARTERLY_DETAILED_BALANCE_COLUMNS,
            quarterly_filter,
            "REPORT_DATE,SECURITY_CODE",
        )
        quarterly_income_by_code = a_share_report_rows(
            quarterly_income_future.result(), snapshot_date
        )
        quarterly_cashflow_by_code = a_share_report_rows(
            quarterly_cashflow_future.result(), snapshot_date
        )
        quarterly_balance_by_code = a_share_report_rows(
            quarterly_balance_future.result(), snapshot_date
        )
        quarterly_detailed_balance_by_code = a_share_report_rows(
            quarterly_detailed_balance_future.result(), snapshot_date
        )
    latest_quarterly_report_date = max(
        (
            report_date
            for reports in quarterly_balance_by_code.values()
            for report_date in reports
        ),
        default=quarterly_dates[-1],
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
        quarterly_risk_reports = build_quarterly_risk_reports(
            code,
            quarterly_income_by_code,
            quarterly_cashflow_by_code,
            quarterly_balance_by_code,
            quarterly_detailed_balance_by_code,
        )
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
        close_price = number(valuation.get("CLOSE_PRICE"))
        total_market_value = number(valuation.get("TOTAL_MARKET_CAP"))
        circulating_market_value = number(valuation.get("NOTLIMITED_MARKETCAP_A"))
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
                "quarterlyRiskReports": quarterly_risk_reports,
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
                    "closePrice": rounded(close_price, 4),
                    "priceEarningsRatioTtm": rounded(pe_ttm, 4),
                    "priceBookRatio": rounded(price_book, 4),
                    "totalMarketValue": rounded(total_market_value),
                    "circulatingMarketValue": rounded(circulating_market_value),
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
    total_market_value_count = sum(
        row["valuation"]["totalMarketValue"] is not None for row in rows
    )
    circulating_market_value_count = sum(
        row["valuation"]["circulatingMarketValue"] is not None for row in rows
    )
    pe_industry_percentile_count = sum(
        row["valuation"]["priceEarningsIndustryPercentile"] is not None for row in rows
    )
    pb_industry_percentile_count = sum(
        row["valuation"]["priceBookIndustryPercentile"] is not None for row in rows
    )
    latest_quarterly_risk_report_count = sum(
        bool(row["quarterlyRiskReports"]) for row in rows
    )
    complete_quarterly_risk_indicator_count = sum(
        bool(row["quarterlyRiskReports"])
        and row["quarterlyRiskReports"][-1]["receivableRevenueDivergence"] is not None
        and row["quarterlyRiskReports"][-1]["inventoryDaysChangeYoY"] is not None
        and row["quarterlyRiskReports"][-1]["goodwillAssetRatio"] is not None
        and any(
            report["operatingCashFlowQuarter"] is not None
            for report in row["quarterlyRiskReports"]
        )
        for row in rows
    )

    generated_at = dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat(timespec="seconds")
    snapshot = {
        "schemaVersion": 6,
        "snapshotDate": snapshot_date,
        "generatedAt": generated_at,
        "currency": "CNY",
        "fiscalYears": fiscal_years,
        "latestAnnualReportDate": annual_dates[latest_year],
        "latestQuarterlyReportDate": latest_quarterly_report_date,
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
            "latestTotalMarketValueCount": total_market_value_count,
            "latestCirculatingMarketValueCount": circulating_market_value_count,
            "latestPriceEarningsIndustryPercentileCount": pe_industry_percentile_count,
            "latestPriceBookIndustryPercentileCount": pb_industry_percentile_count,
            "latestQuarterlyRiskReportCount": latest_quarterly_risk_report_count,
            "completeQuarterlyRiskIndicatorCount": complete_quarterly_risk_indicator_count,
            "industryCount": len(industries),
        },
        "industries": industries,
        "rows": rows,
    }
    diagnostics = {
        "schemaVersion": 6,
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
        "latestQuarterlyReportDate": latest_quarterly_report_date,
        "quarterlyIncomeCompanies": len(quarterly_income_by_code),
        "quarterlyCashflowCompanies": len(quarterly_cashflow_by_code),
        "quarterlyBalanceCompanies": len(quarterly_balance_by_code),
        "quarterlyDetailedBalanceCompanies": len(quarterly_detailed_balance_by_code),
        "coverage": snapshot["coverage"],
    }
    log(
        f"阶段五/五：完成 {len(rows):,} 家公司、{len(industries):,} 个行业的财务、估值与排雷数据"
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
