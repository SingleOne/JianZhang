"""重新获取A股分红、融资数据并更新分红融资比排名文档。

在项目根目录执行：
    python scripts/generate_dividend_financing_report.py

依赖 requests；如本机尚未安装，可执行：
    python -m pip install requests
"""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import html
import json
import math
import re
import sys
import threading
import time
from collections import Counter, defaultdict
from pathlib import Path

import requests


EASTMONEY_DATA_API = "https://datacenter-web.eastmoney.com/api/data/v1/get"
EASTMONEY_CAPITAL_API = "https://emweb.eastmoney.com/PC_HSF10/CapitalOperation/PageAjax"
SINA_QUOTE_API = "https://hq.sinajs.cn/list="
THS_BONUS_URL = "https://basic.10jqka.com.cn/{code}/bonus.html"
PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = PROJECT_ROOT / "docs" / "A股分红融资比大于100%排名_2026-07-22.md"
DEFAULT_DIAGNOSTICS = PROJECT_ROOT / "outputs" / "分红融资比统计诊断.json"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Safari/537.36"
)
THREAD_LOCAL = threading.local()


def log(message: str) -> None:
    print(f"[{dt.datetime.now():%H:%M:%S}] {message}", flush=True)


def retry_get(
    session: requests.Session,
    url: str,
    *,
    params: dict | None = None,
    headers: dict | None = None,
    timeout: int = 30,
    attempts: int = 4,
) -> requests.Response:
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            response = session.get(url, params=params, headers=headers, timeout=timeout)
            response.raise_for_status()
            return response
        except Exception as exc:
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(0.5 * (attempt + 1))
    assert last_error is not None
    raise last_error


def thread_session(name: str, referer: str) -> requests.Session:
    sessions = getattr(THREAD_LOCAL, "sessions", None)
    if sessions is None:
        sessions = {}
        THREAD_LOCAL.sessions = sessions
    if name not in sessions:
        session = requests.Session()
        adapter = requests.adapters.HTTPAdapter(pool_connections=4, pool_maxsize=4)
        session.mount("https://", adapter)
        session.headers.update({"User-Agent": USER_AGENT, "Referer": referer})
        sessions[name] = session
    return sessions[name]


def fetch_dividend_events() -> tuple[list[dict], dict[str, str], Counter]:
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT, "Referer": "https://data.eastmoney.com/"})
    base_params = {
        "reportName": "RPT_SHAREBONUS_DET",
        "columns": (
            "SECURITY_CODE,SECURITY_NAME_ABBR,PRETAX_BONUS_RMB,TOTAL_SHARES,"
            "ASSIGN_PROGRESS,REPORT_DATE,NOTICE_DATE,SECUCODE"
        ),
        "pageSize": 500,
        "sortColumns": "REPORT_DATE",
        "sortTypes": "-1",
        "source": "WEB",
        "client": "WEB",
    }

    first = retry_get(session, EASTMONEY_DATA_API, params={**base_params, "pageNumber": 1}).json()
    if not first.get("success") or not first.get("result"):
        raise RuntimeError(f"Dividend source failed: {first}")
    pages = int(first["result"]["pages"])
    rows_by_page: dict[int, list[dict]] = {1: first["result"].get("data") or []}
    log(f"Dividend event pages: {pages}")

    def fetch_page(page: int) -> tuple[int, list[dict]]:
        local = requests.Session()
        local.headers.update(session.headers)
        payload = retry_get(
            local,
            EASTMONEY_DATA_API,
            params={**base_params, "pageNumber": page},
        ).json()
        if not payload.get("success") or not payload.get("result"):
            raise RuntimeError(f"Dividend page {page} failed: {payload}")
        return page, payload["result"].get("data") or []

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(fetch_page, page) for page in range(2, pages + 1)]
        for index, future in enumerate(concurrent.futures.as_completed(futures), start=1):
            page, rows = future.result()
            rows_by_page[page] = rows
            if index % 20 == 0:
                log(f"Dividend pages fetched: {index + 1}/{pages}")

    events: list[dict] = []
    names: dict[str, str] = {}
    progress_values: Counter = Counter()
    for page in range(1, pages + 1):
        for row in rows_by_page[page]:
            secucode = str(row.get("SECUCODE") or "")
            code = str(row.get("SECURITY_CODE") or "")
            if not re.fullmatch(r"\d{6}\.(?:SH|SZ|BJ)", secucode):
                continue
            if not re.fullmatch(r"\d{6}", code):
                continue
            names[code] = str(row.get("SECURITY_NAME_ABBR") or names.get(code, code))
            progress_values[str(row.get("ASSIGN_PROGRESS") or "")] += 1
            events.append(row)
    log(f"Dividend events loaded: {len(events):,}; securities seen: {len(names):,}")
    return events, names, progress_values


def quote_symbol(secucode: str) -> str:
    code, market = secucode.split(".")
    return market.lower() + code


def filter_active_stocks(
    events: list[dict], fallback_names: dict[str, str]
) -> tuple[dict[str, str], dict[str, str]]:
    secucodes: dict[str, str] = {}
    for row in events:
        code = str(row["SECURITY_CODE"])
        secucodes[code] = str(row["SECUCODE"])
    symbols = [(code, quote_symbol(secucode)) for code, secucode in secucodes.items()]
    active_names: dict[str, str] = {}

    session = requests.Session()
    headers = {"User-Agent": USER_AGENT, "Referer": "https://finance.sina.com.cn/"}
    for offset in range(0, len(symbols), 100):
        batch = symbols[offset : offset + 100]
        mapping = {symbol: code for code, symbol in batch}
        response = retry_get(
            session,
            SINA_QUOTE_API + ",".join(mapping),
            headers=headers,
            timeout=30,
        )
        text = response.content.decode("gb18030", errors="replace")
        for symbol, payload in re.findall(r'var hq_str_(\w+)="([^"]*)";', text):
            code = mapping.get(symbol)
            if not code or not payload:
                continue
            name = payload.split(",", 1)[0].strip() or fallback_names.get(code, code)
            if "退市" in name or name.startswith("退"):
                continue
            active_names[code] = name
        if (offset // 100 + 1) % 10 == 0:
            log(f"Active quote batches checked: {offset + len(batch):,}/{len(symbols):,}")
    active_secucodes = {code: secucodes[code] for code in active_names}
    log(f"Active dividend-paying A-share securities: {len(active_names):,}")
    return active_names, active_secucodes


def fetch_financing(
    active_secucodes: dict[str, str], active_names: dict[str, str]
) -> tuple[dict[str, float], Counter, Counter, list[str]]:
    financing: dict[str, float] = {}
    finance_types: Counter = Counter()
    security_types: Counter = Counter()
    errors: list[str] = []

    def fetch_one(item: tuple[str, str]) -> tuple[str, float, list[tuple[str, str]]]:
        code, secucode = item
        market = secucode.rsplit(".", 1)[1]
        request_code = market + code
        session = thread_session("capital", "https://emweb.eastmoney.com/")
        payload = retry_get(
            session,
            EASTMONEY_CAPITAL_API,
            params={"code": request_code},
            timeout=25,
            attempts=5,
        ).json()
        total = 0.0
        labels: list[tuple[str, str]] = []
        for row in payload.get("mjzjly") or []:
            finance_type = str(row.get("FINANCE_TYPEE") or "")
            security_type = str(row.get("SECURITY_TYPE") or "")
            labels.append((finance_type, security_type))
            value = row.get("NET_RAISE_FUNDS")
            try:
                amount = float(value)
            except (TypeError, ValueError):
                continue
            is_common_a = "A股" in security_type or any(
                marker in finance_type for marker in ("首发", "增发", "配股")
            )
            is_equity_financing = any(
                marker in finance_type for marker in ("首发", "增发", "配股")
            )
            if amount > 0 and is_common_a and is_equity_financing:
                total += amount
        return code, total, labels

    items = list(active_secucodes.items())
    completed = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        future_map = {pool.submit(fetch_one, item): item[0] for item in items}
        for future in concurrent.futures.as_completed(future_map):
            code = future_map[future]
            try:
                result_code, total, labels = future.result()
                financing[result_code] = total
                for finance_type, security_type in labels:
                    finance_types[finance_type] += 1
                    security_types[security_type] += 1
            except Exception as exc:
                errors.append(f"{code} {active_names.get(code, '')}: {exc!r}")
            completed += 1
            if completed % 500 == 0:
                log(f"Capital records fetched: {completed:,}/{len(items):,}; errors: {len(errors)}")
    log(f"Capital records complete: {len(financing):,}; errors: {len(errors)}")
    return financing, finance_types, security_types, errors


def aggregate_approx_dividends(
    events: list[dict], active_names: dict[str, str]
) -> tuple[dict[str, float], set[str]]:
    totals: defaultdict[str, float] = defaultdict(float)
    incomplete: set[str] = set()
    for row in events:
        code = str(row["SECURITY_CODE"])
        if code not in active_names:
            continue
        progress = str(row.get("ASSIGN_PROGRESS") or "")
        if "实施" not in progress:
            continue
        pretax = row.get("PRETAX_BONUS_RMB")
        shares = row.get("TOTAL_SHARES")
        if pretax in (None, ""):
            continue
        try:
            cash_per_ten = float(pretax)
            total_shares = float(shares)
        except (TypeError, ValueError):
            if float(pretax or 0) > 0:
                incomplete.add(code)
            continue
        if cash_per_ten > 0 and total_shares > 0:
            totals[code] += cash_per_ten / 10.0 * total_shares
    return dict(totals), incomplete


def parse_ths_cumulative_dividend(page: str) -> tuple[float | None, bool]:
    stripped = re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>", " ", page, flags=re.I)
    stripped = html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", stripped)))
    total_match = re.search(
        r"累计分红\s*\d+\s*次，累计分红金额为\s*([\d,.]+)\s*亿元", stripped
    )
    if not total_match:
        return None, False
    total_yi = float(total_match.group(1).replace(",", ""))
    a_match = re.search(r"其中\s*A股分红\s*([\d,.]+)\s*亿元", stripped)
    if a_match:
        return float(a_match.group(1).replace(",", "")) * 100_000_000.0, True
    return total_yi * 100_000_000.0, False


def fetch_exact_dividends(
    candidate_codes: list[str], active_names: dict[str, str]
) -> tuple[dict[str, float], set[str], list[str]]:
    exact: dict[str, float] = {}
    dual_listed: set[str] = set()
    errors: list[str] = []

    def fetch_one(code: str) -> tuple[str, float | None, bool]:
        session = thread_session("ths", "https://basic.10jqka.com.cn/")
        response = retry_get(
            session,
            THS_BONUS_URL.format(code=code),
            timeout=25,
            attempts=5,
        )
        response.encoding = "gbk"
        value, has_split = parse_ths_cumulative_dividend(response.text)
        return code, value, has_split

    completed = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        future_map = {pool.submit(fetch_one, code): code for code in candidate_codes}
        for future in concurrent.futures.as_completed(future_map):
            code = future_map[future]
            try:
                result_code, value, has_split = future.result()
                if value is None:
                    errors.append(f"{code} {active_names.get(code, '')}: cumulative dividend not found")
                else:
                    exact[result_code] = value
                    if has_split:
                        dual_listed.add(result_code)
            except Exception as exc:
                errors.append(f"{code} {active_names.get(code, '')}: {exc!r}")
            completed += 1
            if completed % 200 == 0:
                log(f"Exact cumulative dividends fetched: {completed:,}/{len(candidate_codes):,}; errors: {len(errors)}")
    log(f"Exact cumulative dividends complete: {len(exact):,}; errors: {len(errors)}")
    return exact, dual_listed, errors


def format_amount_yi(value_yi: float) -> str:
    if value_yi >= 1000:
        return f"{value_yi:,.2f}"
    if value_yi >= 1:
        return f"{value_yi:.2f}"
    return f"{value_yi:.4f}"


def write_report(
    output: Path,
    ranked: list[dict],
    *,
    snapshot_date: str,
    active_count: int,
    exact_candidate_count: int,
    financing_errors: list[str],
    dividend_errors: list[str],
    dual_listed: set[str],
) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# A股分红融资比大于100%的股票排名",
        "",
        f"> 数据快照：{snapshot_date}；共筛出 **{len(ranked)}** 只股票，按分红融资比从高到低排列。",
        "",
        "## 统计口径",
        "",
        "- 分红融资比 = 上市以来累计A股现金分红 ÷ 上市以来累计A股股权融资 × 100%。",
        "- 股权融资仅统计已完成且有实际募集净额的IPO、增发和配股；不计可转债、优先股、债券和未实施方案。",
        "- A+H、A+B公司只使用A股累计分红和A股融资，避免跨市场混算。",
        "- 股票范围为统计日仍可取得实时行情、且有历史现金分红记录的沪深北A股；退市股票不纳入。",
        "- 分红累计值来自同花顺F10，融资明细与募集净额来自东方财富F10。金额单位均为人民币亿元。",
        "- 该指标只反映历史现金回报与股权融资的比例，不代表未来收益或投资建议。",
        "",
        "## 排名",
        "",
        "| 排名 | 股票代码 | 股票简称 | 累计A股分红（亿元） | 累计A股融资（亿元） | 分红融资比 |",
        "|---:|:---:|:---|---:|---:|---:|",
    ]
    for index, item in enumerate(ranked, start=1):
        name = str(item["name"]).replace("|", "\\|")
        lines.append(
            f"| {index} | {item['code']} | {name} | "
            f"{format_amount_yi(item['dividend_yi'])} | "
            f"{format_amount_yi(item['financing_yi'])} | "
            f"{item['ratio']:.2f}% |"
        )

    lines.extend(
        [
            "",
            "## 数据完整性说明",
            "",
            f"- 历史分红数据中识别到的当前有效股票：{active_count}只。",
            f"- 进入精确累计分红复核范围的股票：{exact_candidate_count}只。",
            f"- 排名中按A股分红单独口径处理的A+H/A+B股票：{sum(1 for item in ranked if item['code'] in dual_listed)}只。",
            f"- 融资接口最终失败：{len(financing_errors)}只；累计分红接口最终失败：{len(dividend_errors)}只。失败项未使用估算值进入榜单。",
            "- 接近100%的股票会随新分红实施、再融资完成或数据源修订而进出榜单，使用时应以最新公告复核。",
            "",
            "## 数据源",
            "",
            "- [东方财富F10：分红融资](https://emweb.eastmoney.com/PC_HSF10/BonusFinancing/Index)",
            "- [东方财富F10：资本运作](https://emweb.eastmoney.com/PC_HSF10/CapitalOperation/Index)",
            "- [同花顺F10](https://basic.10jqka.com.cn/)",
            "",
        ]
    )
    output.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="更新A股分红融资比大于100%的排名文档")
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT),
        help="Markdown输出路径（默认：现有排名文档）",
    )
    parser.add_argument(
        "--snapshot-date",
        default=dt.date.today().isoformat(),
        help="数据快照日期，格式为YYYY-MM-DD（默认：今天）",
    )
    parser.add_argument(
        "--diagnostics",
        default=str(DEFAULT_DIAGNOSTICS),
        help=f"诊断JSON输出路径（默认：{DEFAULT_DIAGNOSTICS}）",
    )
    args = parser.parse_args()

    output = Path(args.output).resolve()
    diagnostics = Path(args.diagnostics).resolve()

    events, fallback_names, progress_values = fetch_dividend_events()
    active_names, active_secucodes = filter_active_stocks(events, fallback_names)
    financing, finance_types, security_types, financing_errors = fetch_financing(
        active_secucodes, active_names
    )
    approx_dividends, incomplete_dividends = aggregate_approx_dividends(events, active_names)

    prefilter_codes = [code for code in active_names if financing.get(code, 0.0) > 0]
    prefilter_codes.sort()
    log(f"Exact cumulative-dividend prefilter: {len(prefilter_codes):,}")

    exact_dividends, dual_listed, dividend_errors = fetch_exact_dividends(
        prefilter_codes, active_names
    )

    ranked: list[dict] = []
    for code, dividend in exact_dividends.items():
        funds = financing.get(code, 0.0)
        if funds <= 0:
            continue
        ratio = dividend / funds * 100.0
        if ratio > 100.0 and math.isfinite(ratio):
            ranked.append(
                {
                    "code": code,
                    "name": active_names[code],
                    "dividend_yi": dividend / 100_000_000.0,
                    "financing_yi": funds / 100_000_000.0,
                    "ratio": ratio,
                }
            )
    ranked.sort(key=lambda item: (-item["ratio"], item["code"]))

    write_report(
        output,
        ranked,
        snapshot_date=args.snapshot_date,
        active_count=len(active_names),
        exact_candidate_count=len(prefilter_codes),
        financing_errors=financing_errors,
        dividend_errors=dividend_errors,
        dual_listed=dual_listed,
    )

    known = {}
    for code in ("000876", "603042", "601398", "600036", "600519"):
        funds = financing.get(code, 0.0)
        dividend = exact_dividends.get(code, 0.0)
        known[code] = {
            "name": active_names.get(code),
            "financing_yi": funds / 100_000_000.0 if funds else None,
            "dividend_yi": dividend / 100_000_000.0 if dividend else None,
            "ratio": dividend / funds * 100.0 if funds and dividend else None,
        }

    diagnostics_payload = {
        "snapshot_date": args.snapshot_date,
        "dividend_events": len(events),
        "active_stocks_with_dividend_history": len(active_names),
        "financing_records": len(financing),
        "prefilter_count": len(prefilter_codes),
        "ranked_count": len(ranked),
        "dividend_progress_values": progress_values,
        "finance_types": finance_types,
        "security_types": security_types,
        "financing_errors": financing_errors,
        "dividend_errors": dividend_errors,
        "dual_listed_ranked_codes": [item["code"] for item in ranked if item["code"] in dual_listed],
        "known_checks": known,
        "top_30": ranked[:30],
        "bottom_30": ranked[-30:],
    }
    diagnostics.parent.mkdir(parents=True, exist_ok=True)
    diagnostics.write_text(json.dumps(diagnostics_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"Report written: {output}")
    log(f"Ranked count: {len(ranked)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
