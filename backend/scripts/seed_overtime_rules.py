"""Generic, idempotent country overtime-rule seeder.

Creates the first active country_overtime_rules row (+ weekday tiers) from the
registry in scripts/overtime_rule_configs.py. Safe to run on every deploy:
an existing active rule is left untouched (updates must go through
scripts/supersede_overtime_rule.py so the append-only audit chain is kept).

Examples:
    .venv/bin/python -m scripts.seed_overtime_rules --country TZ
    .venv/bin/python -m scripts.seed_overtime_rules --country TZ --allow-placeholder
    .venv/bin/python -m scripts.seed_overtime_rules --all
    .venv/bin/python -m scripts.seed_overtime_rules --country TZ --dry-run

Unverified placeholder configs are SKIPPED unless --allow-placeholder is
passed (or ALLOW_PLACEHOLDER_OVERTIME=true). This keeps a deploy from quietly
seeding unverified legal rates for a country.
"""

from __future__ import annotations

import argparse
import os
from typing import List, Optional

from sqlalchemy.orm import Session

from core.config import get_db
from core.model import Country, CountryOvertimeRule
from scripts.overtime_rule_configs import (
    COUNTRY_CONFIGS,
    CountryOvertimeConfig,
    get_config,
)
from services import payroll_rules


def _truthy(value: Optional[str]) -> bool:
    return (value or "").strip().lower() in ("1", "true", "yes", "on")


def _ensure_country(db: Session, cfg: CountryOvertimeConfig) -> None:
    if db.query(Country).filter(Country.code == cfg.country_code).one_or_none():
        return
    db.add(Country(
        code=cfg.country_code,
        name=cfg.country_name or cfg.country_code,
        currency=cfg.currency or "USD",
        locale=cfg.locale,
        fiscal_year_start=cfg.fiscal_year_start,
        date_format=cfg.date_format,
        default_timezone=cfg.default_timezone,
        is_active=True,
    ))
    db.commit()


def seed_config(
    db: Session,
    cfg: CountryOvertimeConfig,
    *,
    allow_placeholder: bool,
    dry_run: bool,
) -> str:
    cc = cfg.country_code
    if not cfg.verified and not allow_placeholder:
        print(
            f"  {cc}: SKIPPED — unverified placeholder. "
            "Re-run with --allow-placeholder (or ALLOW_PLACEHOLDER_OVERTIME=true) "
            "after reading the warning in scripts/overtime_rule_configs.py."
        )
        return "skipped_unverified"

    existing = (
        db.query(CountryOvertimeRule)
        .filter(CountryOvertimeRule.country_code == cc)
        .filter(CountryOvertimeRule.effective_to.is_(None))
        .one_or_none()
    )
    if existing is not None:
        print(
            f"  {cc}: already active (id={existing.id}, version={existing.version}, "
            f"effective_from={existing.effective_from}). Skipping."
        )
        return "exists"

    tiers = [
        {
            "tier_order": t.tier_order,
            "up_to_hours": t.up_to_hours,
            "multiplier": t.multiplier,
        }
        for t in cfg.tiers
    ]
    payload = cfg.rule_payload()

    if dry_run:
        print(
            f"  {cc}: DRY RUN — would create v1 effective {cfg.effective_from} "
            f"with {len(tiers)} weekday tier(s)."
        )
        return "dry_run"

    _ensure_country(db, cfg)
    try:
        rule = payroll_rules.supersede(
            db,
            model=CountryOvertimeRule,
            rule_filter={"country_code": cc},
            new_payload=payload,
            actor_user_id=None,
            overtime_tiers=tiers,
            # First-time create: fail if someone raced us instead of silently
            # producing a second active row.
            expected_latest_version=0,
        )
    except payroll_rules.RuleSupersedeConflictError:
        db.rollback()
        print(f"  {cc}: another version appeared during seeding — skipped.")
        return "exists"
    db.commit()
    print(
        f"  {cc}: seeded v{rule.version} (id={rule.id}, effective {rule.effective_from}) "
        f"with {len(tiers)} weekday tier(s)."
    )
    return "seeded"


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--country", action="append", default=[],
        help="Country code to seed (repeatable).",
    )
    parser.add_argument("--all", action="store_true", help="Seed every configured country.")
    parser.add_argument(
        "--allow-placeholder", action="store_true",
        help="Permit seeding configs marked verified=False (legal values not confirmed).",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print actions without writing.")
    args = parser.parse_args(argv)

    allow_placeholder = args.allow_placeholder or _truthy(
        os.getenv("ALLOW_PLACEHOLDER_OVERTIME")
    )

    if args.all:
        codes = sorted(COUNTRY_CONFIGS)
    else:
        codes = sorted({c.upper() for c in args.country})
    if not codes:
        parser.error(
            "pass --country XX (repeatable) or --all; configured: "
            + ", ".join(sorted(COUNTRY_CONFIGS))
        )

    unknown = [c for c in codes if get_config(c) is None]
    if unknown:
        print(
            f"Unknown/unconfigured country code(s): {', '.join(unknown)}. "
            f"Add them to scripts/overtime_rule_configs.py. Configured: "
            + ", ".join(sorted(COUNTRY_CONFIGS))
        )
        return 2

    print("Seeding country overtime rules…")
    if allow_placeholder:
        print("  ⚠️  Placeholder values are allowed for this run.")

    exit_code = 0
    db: Session = next(get_db())
    try:
        for code in codes:
            cfg = get_config(code)
            assert cfg is not None
            result = seed_config(
                db, cfg, allow_placeholder=allow_placeholder, dry_run=args.dry_run
            )
            if result == "skipped_unverified" and not args.all:
                exit_code = 1
    finally:
        db.close()
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
