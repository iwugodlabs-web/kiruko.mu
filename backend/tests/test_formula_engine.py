"""Tests for the salary formula engine (M1).

Covers:
  * Single-expression evaluation against a context dict
  * DAG resolution: constants + formulas mixed, multi-level dependencies
  * Cycle detection
  * Unknown reference detection
  * Whitelist enforcement (min/max/round/abs allowed; everything else rejected)
  * Unsafe construct rejection (attribute access, subscripts, dunders, comprehensions)
  * Integration with `salary_resolver`: a structure with a formula line resolves correctly
"""

from datetime import date
from decimal import Decimal as D

import pytest

from services.formula_evaluator import (
    CycleDetectedError,
    FormulaError,
    UnknownReferenceError,
    UnsafeFormulaError,
    evaluate,
    evaluate_dag,
    parse_and_extract_refs,
)


# ---------------------------------------------------------------------------
# Single-expression evaluation
# ---------------------------------------------------------------------------


class TestEvaluate:
    def test_constant_arithmetic(self):
        assert evaluate("2 + 3", {}) == D("5.00")
        assert evaluate("100 / 4", {}) == D("25.00")

    def test_variable_substitution(self):
        assert evaluate("basic * 0.10", {"basic": D("30000")}) == D("3000.00")

    def test_max_function(self):
        assert evaluate("max(basic * 0.25, 5000)", {"basic": D("30000")}) == D("7500.00")
        assert evaluate("max(basic * 0.25, 5000)", {"basic": D("10000")}) == D("5000.00")

    def test_min_function(self):
        assert evaluate("min(basic * 0.50, 20000)", {"basic": D("30000")}) == D("15000.00")
        assert evaluate("min(basic * 0.50, 20000)", {"basic": D("100000")}) == D("20000.00")

    def test_round_function(self):
        assert evaluate("round(basic * 0.123)", {"basic": D("30000")}) == D("3690.00")

    def test_abs_function(self):
        assert evaluate("abs(basic - 50000)", {"basic": D("30000")}) == D("20000.00")

    def test_complex_expression(self):
        # Hypothetical: bonus = max((basic - 30000) * 0.20, 0) + min(basic * 0.05, 2500)
        ctx = {"basic": D("50000")}
        assert evaluate(
            "max((basic - 30000) * 0.20, 0) + min(basic * 0.05, 2500)",
            ctx,
        ) == D("6500.00")


# ---------------------------------------------------------------------------
# Reference extraction
# ---------------------------------------------------------------------------


class TestExtractRefs:
    def test_simple(self):
        assert parse_and_extract_refs("basic + transport") == {"basic", "transport"}

    def test_with_constant(self):
        assert parse_and_extract_refs("basic * 0.10") == {"basic"}

    def test_function_calls_dont_count_as_refs(self):
        # min/max/round/abs are functions, not free variables
        assert parse_and_extract_refs("max(basic, 5000)") == {"basic"}
        assert parse_and_extract_refs("round(basic * 0.123)") == {"basic"}

    def test_pure_constant(self):
        assert parse_and_extract_refs("100 + 50") == set()


# ---------------------------------------------------------------------------
# Unsafe construct rejection
# ---------------------------------------------------------------------------


class TestUnsafeRejection:
    @pytest.mark.parametrize(
        "expr",
        [
            '__import__("os")',
            "x.__class__",
            "x.upper()",
            "obj.attr",
        ],
    )
    def test_attribute_access_rejected(self, expr):
        with pytest.raises(UnsafeFormulaError):
            parse_and_extract_refs(expr)

    @pytest.mark.parametrize("expr", ["arr[0]", "d['key']", "matrix[0][1]"])
    def test_subscript_rejected(self, expr):
        with pytest.raises(UnsafeFormulaError):
            parse_and_extract_refs(expr)

    @pytest.mark.parametrize(
        "expr",
        [
            "pow(2, 10)",
            "sum([1, 2, 3])",
            "len(x)",
            "list(range(10))",
            "print(basic)",
        ],
    )
    def test_non_whitelisted_call_rejected(self, expr):
        with pytest.raises(UnsafeFormulaError):
            parse_and_extract_refs(expr)

    @pytest.mark.parametrize("expr", ["__name", "__class__", "x + __secret"])
    def test_dunder_name_rejected(self, expr):
        with pytest.raises(UnsafeFormulaError):
            parse_and_extract_refs(expr)

    @pytest.mark.parametrize(
        "expr",
        [
            "[x for x in range(10)]",
            "(x for x in [1])",
            "lambda x: x",
            "{x: x for x in [1]}",
        ],
    )
    def test_comprehension_rejected(self, expr):
        with pytest.raises(UnsafeFormulaError):
            parse_and_extract_refs(expr)

    def test_invalid_syntax_rejected(self):
        with pytest.raises(FormulaError):
            parse_and_extract_refs("x +")

    def test_empty_expression_rejected(self):
        with pytest.raises(FormulaError):
            parse_and_extract_refs("")
        with pytest.raises(FormulaError):
            parse_and_extract_refs("   ")


# ---------------------------------------------------------------------------
# DAG evaluation
# ---------------------------------------------------------------------------


class TestEvaluateDag:
    def test_constants_only(self):
        result = evaluate_dag([("BASIC", D("30000"), None), ("ALLOW", D("5000"), None)])
        assert result == {"BASIC": D("30000"), "ALLOW": D("5000")}

    def test_formulas_only(self):
        result = evaluate_dag(
            [("A", None, "10 + 5"), ("B", None, "A * 2")],
        )
        assert result["A"] == D("15.00")
        assert result["B"] == D("30.00")

    def test_constants_and_formulas_mixed(self):
        items = [
            ("BASIC", D("30000"), None),
            ("TRANSPORT", None, "BASIC * 0.10"),
            ("HOUSING", None, "max(BASIC * 0.25, 5000)"),
        ]
        result = evaluate_dag(items)
        assert result == {
            "BASIC": D("30000"),
            "TRANSPORT": D("3000.00"),
            "HOUSING": D("7500.00"),
        }

    def test_external_context(self):
        items = [
            ("DAILY_RATE", D("1500"), None),
            ("MONTHLY", None, "DAILY_RATE * period_days"),
        ]
        result = evaluate_dag(items, context={"period_days": D("22")})
        assert result["MONTHLY"] == D("33000.00")

    def test_multi_level_chain(self):
        # A → B → C → D, in reverse declaration order, must still resolve.
        items = [
            ("A", None, "B + 100"),
            ("B", None, "C * 2"),
            ("C", None, "D - 10"),
            ("D", D("60"), None),
        ]
        result = evaluate_dag(items)
        assert result == {
            "D": D("60"),
            "C": D("50.00"),
            "B": D("100.00"),
            "A": D("200.00"),
        }

    def test_cycle_two_node(self):
        items = [("A", None, "B + 1"), ("B", None, "A + 1")]
        with pytest.raises(CycleDetectedError):
            evaluate_dag(items)

    def test_cycle_three_node(self):
        items = [
            ("A", None, "B + 1"),
            ("B", None, "C + 1"),
            ("C", None, "A + 1"),
        ]
        with pytest.raises(CycleDetectedError):
            evaluate_dag(items)

    def test_self_reference_cycle(self):
        items = [("A", None, "A + 1")]
        with pytest.raises(CycleDetectedError):
            evaluate_dag(items)

    def test_unknown_reference(self):
        items = [("A", None, "MYSTERY * 2")]
        with pytest.raises(UnknownReferenceError):
            evaluate_dag(items)

    def test_empty_items(self):
        assert evaluate_dag([]) == {}


# ---------------------------------------------------------------------------
# Integration with salary_resolver
# ---------------------------------------------------------------------------


class TestResolverWithFormulas:
    """The resolver uses evaluate_dag under the hood; assert end-to-end."""

    def test_structure_with_formula_resolves_correctly(
        self, db, test_company_id, test_employee_id, seed_mu_rules, clean_payroll_state
    ):
        from sqlalchemy import text as sql_text

        from core.model import (
            EmployeeSalaryAssignment,
            SalaryComponent,
            SalaryStructure,
            SalaryStructureLine,
        )
        from services import salary_resolver

        # Build a fresh per-test structure with a formula line.
        # Reuse the existing BASIC component from the fixture; add TRANSPORT_PCT.
        basic = (
            db.query(SalaryComponent)
            .filter(
                SalaryComponent.company_id == test_company_id,
                SalaryComponent.code == "BASIC",
            )
            .one()
        )
        transport_pct = SalaryComponent(
            company_id=test_company_id,
            code="TRANSPORT_PCT",
            label="Transport (10% of basic)",
            kind="earning",
            category="allowance.transport",
            is_basic=False,
            is_taxable=True,
        )
        db.add(transport_pct)
        db.flush()

        struct = SalaryStructure(
            company_id=test_company_id,
            name="Formula Test Structure",
            description="Test structure with a formula line",
        )
        db.add(struct)
        db.flush()
        db.add_all(
            [
                SalaryStructureLine(
                    structure_id=struct.id,
                    component_id=basic.id,
                    amount=D("40000.00"),
                    order_index=0,
                ),
                SalaryStructureLine(
                    structure_id=struct.id,
                    component_id=transport_pct.id,
                    formula_expression="BASIC * 0.10",
                    order_index=1,
                ),
            ]
        )

        # Close the existing assignment and create a new one pointing at the
        # formula structure.
        existing = (
            db.query(EmployeeSalaryAssignment)
            .filter(
                EmployeeSalaryAssignment.private_user_id == test_employee_id,
                EmployeeSalaryAssignment.effective_to.is_(None),
            )
            .one()
        )
        existing.effective_to = date(2026, 7, 1)
        db.add(
            EmployeeSalaryAssignment(
                private_user_id=test_employee_id,
                structure_id=struct.id,
                currency="MUR",
                effective_from=date(2026, 7, 1),
                notes="Formula test",
            )
        )
        db.commit()

        try:
            resolved = salary_resolver.resolve_components(
                db, test_employee_id, date(2026, 8, 1)
            )
            by_code = {c.code: c.amount for c in resolved.components}
            assert by_code["BASIC"] == D("40000.00")
            assert by_code["TRANSPORT_PCT"] == D("4000.00"), (
                f"expected formula 'BASIC * 0.10' on basic=40000 to yield 4000; "
                f"got {by_code.get('TRANSPORT_PCT')}"
            )
        finally:
            # Clean up the per-test structure + assignment so the session
            # fixture's data is restored for other tests.
            db.execute(
                sql_text(
                    "DELETE FROM employee_salary_assignments "
                    "WHERE private_user_id=:pid AND structure_id=:sid"
                ),
                {"pid": test_employee_id, "sid": struct.id},
            )
            db.execute(
                sql_text(
                    "UPDATE employee_salary_assignments SET effective_to=NULL "
                    "WHERE private_user_id=:pid AND id=:id"
                ),
                {"pid": test_employee_id, "id": existing.id},
            )
            db.execute(
                sql_text("DELETE FROM salary_structure_lines WHERE structure_id=:sid"),
                {"sid": struct.id},
            )
            db.execute(
                sql_text("DELETE FROM salary_structures WHERE id=:sid"),
                {"sid": struct.id},
            )
            db.execute(
                sql_text("DELETE FROM salary_components WHERE id=:cid"),
                {"cid": transport_pct.id},
            )
            db.commit()
