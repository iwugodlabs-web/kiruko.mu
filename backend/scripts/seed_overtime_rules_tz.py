"""Compatibility wrapper — seed the TZ overtime rule.

Delegates to the generic seeder with TZ's placeholder guard enabled. Prefer:
    .venv/bin/python -m scripts.seed_overtime_rules --country TZ --allow-placeholder

⚠️  The TZ values are PLACEHOLDERS pending legal verification. See
scripts/overtime_rule_configs.py and doc/TANZANIA-ONBOARDING-PLAN.md §5.
"""

from __future__ import annotations

from scripts.seed_overtime_rules import main as _generic_main


def main() -> int:
    return _generic_main(["--country", "TZ", "--allow-placeholder"])


if __name__ == "__main__":
    raise SystemExit(main())
