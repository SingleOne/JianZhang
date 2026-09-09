import unittest

from scripts.generate_fundamental_snapshot import build_fcff_breakdown


WORKING_CAPITAL_FIELDS = (
    "NOTE_RECE",
    "ACCOUNTS_RECE",
    "PREPAYMENT",
    "INVENTORY",
    "CONTRACT_ASSET",
    "OTHER_CURRENT_ASSET",
    "NOTE_PAYABLE",
    "ACCOUNTS_PAYABLE",
    "CONTRACT_LIAB",
    "ADVANCE_RECEIVABLES",
    "STAFF_SALARY_PAYABLE",
    "TAX_PAYABLE",
    "OTHER_CURRENT_LIAB",
)
DEBT_FIELDS = (
    "SHORT_LOAN",
    "SHORT_BOND_PAYABLE",
    "NONCURRENT_LIAB_1YEAR",
    "LONG_LOAN",
    "BOND_PAYABLE",
    "LEASE_LIAB",
)


def balance_with_short_loan(short_loan: float) -> dict:
    return {
        **{field: 0 for field in WORKING_CAPITAL_FIELDS},
        **{field: None for field in DEBT_FIELDS},
        "SHORT_LOAN": short_loan,
    }


class BuildFcffBreakdownTest(unittest.TestCase):
    def test_sums_present_debt_items_when_other_debt_items_are_absent(self) -> None:
        result = build_fcff_breakdown(
            2025,
            {
                "OPERATE_PROFIT": 100,
                "FE_INTEREST_EXPENSE": 5,
                "INVEST_INCOME": 0,
                "FAIRVALUE_CHANGE_INCOME": 0,
                "ASSET_DISPOSAL_INCOME": 0,
                "TOTAL_PROFIT": 100,
                "INCOME_TAX": 25,
            },
            {
                "FA_IR_DEPR": 10,
                "IA_AMORTIZE": 0,
                "USERIGHT_ASSET_AMORTIZE": 0,
                "CONSTRUCT_LONG_ASSET": 20,
            },
            balance_with_short_loan(50),
            balance_with_short_loan(30),
        )

        self.assertEqual(result["interestBearingDebt"], 50)
        self.assertEqual(result["averageInterestBearingDebt"], 40)
        self.assertEqual(result["preTaxDebtCost"], 12.5)


if __name__ == "__main__":
    unittest.main()
