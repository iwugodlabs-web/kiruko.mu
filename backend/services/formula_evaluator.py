"""Safe formula evaluator for salary structure lines (Module 1 / M1).

Two layers of safety:
  1. **AST pre-validation** (`parse_and_extract_refs`) — walks the expression's
     AST and rejects attribute access, subscripts, function calls outside the
     whitelist, and dunder names. Returns the set of free-variable names so
     the caller can build a dependency graph.
  2. **`simpleeval`** — a sandboxed expression evaluator that itself blocks
     imports, attribute access, and most other Python features.

Either layer alone would be enough; running both means a future change to
either dependency can't silently widen the attack surface.

API:
    parse_and_extract_refs(expr) -> set[str]
        Validate + return free variables. Raises UnsafeFormulaError on bad input.

    evaluate(expr, context) -> Decimal
        Evaluate a single expression against a name → Decimal mapping.

    evaluate_dag(items, context=None) -> dict[code → Decimal]
        Evaluate a list of `(code, amount, formula)` triples in dependency
        order. Constants come first; formulas resolve in topological order.
        Detects cycles and unknown references with clear errors.

Allowed functions: `min`, `max`, `round`, `abs`. Anything else (including
`pow`, `sum`, `len`) raises UnsafeFormulaError at parse time.
"""

from __future__ import annotations

import ast
import logging
from decimal import Decimal
from typing import Iterable, List, Mapping, Set, Tuple

from simpleeval import NameNotDefined, SimpleEval


logger = logging.getLogger(__name__)


# Whitelist of callable names. Mapped to actual implementations passed to simpleeval.
ALLOWED_FUNCTIONS = {
    "min": min,
    "max": max,
    "round": round,
    "abs": abs,
}


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class FormulaError(ValueError):
    """Base for formula-related problems. Caller should treat as a 400-class."""


class UnsafeFormulaError(FormulaError):
    """Formula uses constructs that are not allowed (attr access, subscripts,
    non-whitelisted calls, dunders)."""


class CycleDetectedError(FormulaError):
    """Formulas reference each other in a cycle and cannot be resolved."""


class UnknownReferenceError(FormulaError):
    """Formula references a name that is not in the context, not a constant
    line, and not another formula line."""


# ---------------------------------------------------------------------------
# AST validation + reference extraction
# ---------------------------------------------------------------------------


def parse_and_extract_refs(expr: str) -> Set[str]:
    """Validate `expr` and return the set of free-variable names it references.

    A "free variable" is any `ast.Name` node that isn't the name of a
    whitelisted function. The returned set is what the caller uses to
    build the dependency graph.

    Raises:
        FormulaError: invalid Python syntax.
        UnsafeFormulaError: attribute access, subscripts, non-whitelisted
                            calls, or dunder names anywhere in the tree.
    """
    if not isinstance(expr, str) or not expr.strip():
        raise FormulaError("Formula expression must be a non-empty string")

    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError as e:
        raise FormulaError(f"Invalid expression syntax: {e.msg}") from e

    refs: Set[str] = set()

    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute):
            raise UnsafeFormulaError(
                f"Attribute access is not allowed in formulas (found `.{node.attr}`)"
            )
        if isinstance(node, ast.Subscript):
            raise UnsafeFormulaError("Subscript (`x[...]`) is not allowed in formulas")
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name) or node.func.id not in ALLOWED_FUNCTIONS:
                allowed = sorted(ALLOWED_FUNCTIONS)
                raise UnsafeFormulaError(
                    f"Only these functions are allowed: {allowed}. "
                    f"Got call to: {ast.unparse(node.func)!r}"
                )
        if isinstance(node, ast.Name):
            if node.id.startswith("__"):
                raise UnsafeFormulaError(
                    f"Names starting with `__` are not allowed (got `{node.id}`)"
                )
            if node.id not in ALLOWED_FUNCTIONS:
                refs.add(node.id)
        if isinstance(node, (ast.Lambda, ast.GeneratorExp, ast.ListComp,
                             ast.SetComp, ast.DictComp, ast.JoinedStr,
                             ast.FormattedValue, ast.Starred)):
            raise UnsafeFormulaError(
                f"Construct {type(node).__name__} is not allowed in formulas"
            )

    return refs


# ---------------------------------------------------------------------------
# Single-expression evaluation
# ---------------------------------------------------------------------------


def _to_decimal(value: object) -> Decimal:
    """Coerce a numeric result to Decimal, preserving precision where possible."""
    if isinstance(value, Decimal):
        return value
    if isinstance(value, bool):
        # Bool is subclass of int — guard against accidental Truth math sneaking in.
        return Decimal(int(value))
    if isinstance(value, (int, float)):
        return Decimal(str(value))
    raise FormulaError(
        f"Formula produced a non-numeric result of type {type(value).__name__}"
    )


def evaluate(expr: str, context: Mapping[str, Decimal]) -> Decimal:
    """Evaluate a single formula expression against `context`.

    The expression has already been validated by `parse_and_extract_refs` if
    you used `evaluate_dag`. Calling `evaluate` directly re-validates first.

    Internally evaluates in float because Python won't mix `Decimal` and
    `float` literals (a formula like `basic * 0.10` would crash). Rounds the
    final result to 2 decimal places — standard payroll practice. For
    reasonable salary magnitudes (Decimal up to ~10^14, formulas with
    coefficients < 1000) this loses at most 1 cent of precision, which is
    well below the rounding boundary anyway.
    """
    parse_and_extract_refs(expr)  # validation pass; raises if unsafe

    float_context = {k: float(v) for k, v in context.items()}
    evaluator = SimpleEval(
        names=float_context,
        functions=dict(ALLOWED_FUNCTIONS),
    )
    try:
        result = evaluator.eval(expr)
    except NameNotDefined as e:
        raise UnknownReferenceError(str(e)) from e

    if isinstance(result, bool):
        raise FormulaError("Formula produced a bool; expected a numeric result")
    if not isinstance(result, (int, float, Decimal)):
        raise FormulaError(
            f"Formula produced a non-numeric result of type {type(result).__name__}"
        )

    return Decimal(str(result)).quantize(Decimal("0.01"))


# ---------------------------------------------------------------------------
# DAG evaluation
# ---------------------------------------------------------------------------


def evaluate_dag(
    items: Iterable[Tuple[str, Decimal | None, str | None]],
    context: Mapping[str, Decimal] | None = None,
) -> dict[str, Decimal]:
    """Evaluate a set of `(code, amount, formula)` triples in dependency order.

    Args:
        items: each is `(code, amount, formula)`. Exactly one of `amount` or
               `formula` should be non-None per item. Both-None items are
               skipped silently (the caller already filters them out).
        context: optional name → Decimal mapping for external variables
                 (e.g. `worked_days`, `period_days`). Items can reference
                 these in their formulas.

    Returns:
        `{code: Decimal}` for every item with a value (constant or computed).

    Raises:
        UnknownReferenceError: a formula references a name not in context,
                               not a constant line, and not another formula
                               line.
        CycleDetectedError: formulas reference each other in a way that can't
                            be topologically sorted.
        UnsafeFormulaError / FormulaError: from underlying parsing.
    """
    context_dict: dict[str, Decimal] = {k: _to_decimal(v) for k, v in (context or {}).items()}
    items_list: List[Tuple[str, Decimal | None, str | None]] = [
        (c, a, f) for c, a, f in items if a is not None or f is not None
    ]

    constants: dict[str, Decimal] = {
        code: _to_decimal(amount)
        for code, amount, formula in items_list
        if formula is None and amount is not None
    }
    formulas: dict[str, str] = {
        code: formula
        for code, amount, formula in items_list
        if formula is not None
    }

    all_known_names = set(constants) | set(formulas) | set(context_dict)

    # Pre-validate all formulas + collect their refs so we can fail loudly
    # before any partial evaluation.
    deps: dict[str, Set[str]] = {}
    for code, formula in formulas.items():
        refs = parse_and_extract_refs(formula)
        unknown = refs - all_known_names
        if unknown:
            raise UnknownReferenceError(
                f"Formula for `{code}` references unknown name(s): "
                f"{sorted(unknown)}. Known: {sorted(all_known_names)}"
            )
        deps[code] = refs

    # Topological evaluation. resolved holds constants + context + already-eval'd formulas.
    resolved: dict[str, Decimal] = {**context_dict, **constants}
    pending: Set[str] = set(formulas)

    while pending:
        progress = False
        for code in sorted(pending):  # sorted for deterministic order in errors
            if deps[code].issubset(resolved.keys()):
                resolved[code] = evaluate(formulas[code], resolved)
                pending.remove(code)
                progress = True
        if not progress:
            # Either a cycle, or all remaining refs are between pending nodes
            # but form a cycle. Either way, surface a clear error.
            cycle_view = {c: sorted(deps[c] - resolved.keys()) for c in sorted(pending)}
            raise CycleDetectedError(
                f"Formula cycle among {sorted(pending)}: unresolved refs = {cycle_view}"
            )

    # Return only the codes that came from `items` (not external context).
    return {code: resolved[code] for code in (set(constants) | set(formulas))}
