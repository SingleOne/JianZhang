import json
import tempfile
import unittest
from pathlib import Path

from scripts.generate_dividend_financing_report import (
    aggregate_approx_dividends,
    enrich_ranked_items,
    write_json_snapshot,
)


def enrich(year: int = 2025, *, source: tuple | None = None) -> list[dict]:
    ranked = [
        {
            "code": "600001",
            "name": "测试股份",
            "market": "SH",
            "dividend_yi": 8,
            "financing_yi": 4,
            "ratio": 200,
        }
    ]
    approx, annual, counts, per_share, _ = source or (
        {"600001": 200_000_000},
        {"600001": {year: 200_000_000}},
        {"600001": {year: 2}},
        {"600001": {year: 0.5}},
        set(),
    )
    enrich_ranked_items(
        ranked,
        snapshot_date="2026-10-22",
        approx_dividends=approx,
        annual_dividends=annual,
        annual_event_counts=counts,
        annual_dividends_per_share=per_share,
        previous_closes={"600001": 10},
        financing_events={},
    )
    return ranked


class ReportedDividendPerShareTest(unittest.TestCase):
    def test_sums_reported_per_ten_dividends_only_for_implemented_events(self) -> None:
        def event(bonus: float, year: int = 2025, progress: str = "实施分配") -> dict:
            return {
                "SECURITY_CODE": "600001",
                "PRETAX_BONUS_RMB": bonus,
                "TOTAL_SHARES": 1_000_000_000,
                "REPORT_DATE": f"{year}-12-31",
                "ASSIGN_PROGRESS": progress,
            }

        result = aggregate_approx_dividends(
            [event(3), event(2), event(9, progress="董事会预案"), event(8, year=2024)],
            {"600001": "测试股份"},
        )

        self.assertAlmostEqual(result[3]["600001"][2025], 0.5)
        self.assertEqual(result[2]["600001"][2025], 2)

    def test_retains_direct_dividends_when_source_total_shares_are_unavailable(self) -> None:
        for shares in (None, "", "invalid", 0, -1, float("nan")):
            with self.subTest(shares=shares):
                source = aggregate_approx_dividends(
                    [{
                        "SECURITY_CODE": "600001",
                        "PRETAX_BONUS_RMB": 3,
                        "TOTAL_SHARES": shares,
                        "REPORT_DATE": "2025-12-31",
                        "ASSIGN_PROGRESS": "实施分配",
                    }],
                    {"600001": "测试股份"},
                )
                item = enrich(source=source)[0]

                self.assertEqual(source[3]["600001"][2025], 0.3)
                self.assertEqual(item["annual_dividends"][0]["dividend_per_share"], 0.3)
                self.assertIsNone(item["annual_dividends"][0]["amount_yi"])
                self.assertEqual(item["last_dividend_year"], 2025)
                self.assertEqual(item["dividend_yield"], 3)

    def test_does_not_publish_a_partial_annual_cash_amount_as_complete(self) -> None:
        events = [
            {
                "SECURITY_CODE": "600001",
                "PRETAX_BONUS_RMB": bonus,
                "TOTAL_SHARES": shares,
                "REPORT_DATE": "2025-12-31",
                "ASSIGN_PROGRESS": "实施分配",
            }
            for bonus, shares in [(3, None), (2, 1_000_000_000)]
        ]
        item = enrich(source=aggregate_approx_dividends(events, {"600001": "测试股份"}))[0]

        self.assertEqual(item["annual_dividends"][0]["dividend_per_share"], 0.5)
        self.assertIsNone(item["annual_dividends"][0]["amount_yi"])
        self.assertEqual(item["dividend_yield"], 5)

    def test_does_not_scale_per_share_dividends_with_cumulative_cash_amounts(self) -> None:
        item = enrich()[0]

        self.assertEqual(item["annual_dividends"][0]["amount_yi"], 8)
        self.assertEqual(item["annual_dividends"][0]["dividend_per_share"], 0.5)
        self.assertEqual(item["dividend_yield"], 5)

    def test_does_not_use_an_older_dividend_year_when_the_previous_year_is_missing(self) -> None:
        item = enrich(2024)[0]

        self.assertEqual(item["last_dividend_year"], 2024)
        self.assertIsNone(item["dividend_yield"])

    def test_exports_reported_per_share_dividends_in_a_schema_v3_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "ranking.json"
            write_json_snapshot(
                output,
                enrich(),
                snapshot_date="2026-10-22",
                active_count=1,
                exact_candidate_count=1,
                financing_errors=[],
                dividend_errors=[],
                dual_listed=set(),
            )
            snapshot = json.loads(output.read_text(encoding="utf-8"))

        self.assertEqual(snapshot["schemaVersion"], 3)
        self.assertEqual(snapshot["rows"][0]["annualDividends"][0]["dividendPerShare"], 0.5)
        self.assertEqual(snapshot["rows"][0]["dividendYield"], 5)


if __name__ == "__main__":
    unittest.main()
