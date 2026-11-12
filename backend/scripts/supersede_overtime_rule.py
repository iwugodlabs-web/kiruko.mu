"""Supersede (update) a country's active overtime rule — append-only.

There is no admin UI for overtime rules, and DELETE/UPDATE of rule rows is
blocked by design. This CLI creates the next version, closes the prior row
(effective_to + superseded_by_id), copies weekday tiers forward (or replaces
them), and writes the audit log.

Any field not passed on the command line is copied from the currently-active
rule, so a rate-only correction is a one-line command.

Examples:
    # bump only the weekday tier, effective 2026-12-01
    .venv/bin/python -m scripts.supersede_overtime_rule TZ \
        --effective-from 2026-12-01 \
        --tier "none:1.60" \
        --source-reference "TZ Employment and Labour Relations Act 2004 s.xx" \
        --change-reason "Verified OT rate with local counsel"

    # change night + holiday multipliers, keep existing tiers
    .venv/bin/python -m scripts.supersede_overtime_rule TZ \
        --effective-from 2026-12-01 \
        --night-start 20:00 --night-end 06:00 \
        --night-habitual 1.05 --night-mode ADDITIVE \
        --source-reference "..." --change-reason "..."

Tier format: UP_TO_HOURS:MULTIPLIER, e.g. "8:1.30" or "none:1.50"
(UP_TO_HOURS may be none/*/blank for the final unbounded tier).
"""

from __future__ import annotations

import argparse
from datetime import date, time
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from core.config import get_db
from core.model import CountryOvertimeRule
from services import payroll_rules


def _decimal(value: Optional[str], label: str) -> Optional[Decimal]:
    if value is None:
        return None
    try:
        return Decimal(value)
    except InvalidOperation:
        raise SystemExit(f"{label}: not a decimal: {value!r}")


def _time(value: Optional[str], label: str) -> Optional[time]:
    if value is None:
        return None
    try:
        hh, mm = value.split(":")
        return time(int(hh), int(mm))
    except (ValueError, TypeError):
        raise SystemExit(f"{label}: expected HH:MM, got {value!r}")


def _tier(spec: str, order: int) -> Dict[str, Any]:
    try:
        up_to_raw, mult_raw = spec.split(":", 1)
    except ValueError:
        raise SystemExit(f"--tier: expected UP_TO:MULTIPLIER, got {spec!r}")
    up_to = None if up_to_raw.strip().lower() in ("", "none", "*") else _decimal(up_to_raw, "--tier up_to")
    multiplier = _decimal(mult_raw, "--tier multiplier")
    assert multiplier is not None
    return {"tier_order": order, "up_to_hours": up_to, "multiplier": multiplier}


def _active_rule(db: Session, country_code: str) -> CountryOvertimeRule:
    rule = (
        db.query(CountryOvertimeRule)
        .filter(CountryOvertimeRule.country_code == country_code)
        .filter(CountryOvertimeRule.effective_to.is_(None))
        .one_or_none()
    )
    if rule is None:
        raise SystemExit(
            f"No active overtime rule for {country_code}. Seed one first:\n"
            f"  .venv/bin/python -m scripts.seed_overtime_rules --country {country_code}"
        )
    return rule


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("country_code", help="ISO country code, e.g. TZ")
    parser.add_argument("--effective-from", required=True, help="YYYY-MM-DD (must be after the active rule's date)")
    parser.add_argument("--source-reference", default=None, help="Legal/source citation for this version")
    parser.add_argument("--change-reason", required=True, help="Why this version exists (audited)")
    parser.add_argument("--notes", default=None)
    parser.add_argument("--actor-user-id", type=int, default=None)
    parser.add_argument("--expected-version", type=int, default=None,
                        help="Optional optimistic-concurrency guard")
    parser.add_argument("--dry-run", action="store_true")

    # Rule value overrides (omit to copy the active rule's value).
    parser.add_argument("--weekly-threshold")
    parser.add_argument("--daily-threshold")
    parser.add_argument("--rest-day")
    parser.add_argument("--holiday-normal")
    parser.add_argument("--holiday-after")
    parser.add_argument("--night-start")
    parser.add_argument("--night-end")
    parser.add_argument("--night-habitual")
    parser.add_argument("--night-occasional")
    parser.add_argument("--night-mode", choices=["ADDITIVE", "REPLACE", "none"])
    parser.add_argument("--weekly-ot-soft-cap")
    parser.add_argument("--weekly-total-max")
    parser.add_argument("--monthly-basic-ot-cap")
    parser.add_argument("--notional-hourly-divisor")
    parser.add_argument("--stack-holiday-on-rest-day", choices=["MAX", "ADD", "NO_STACK"])
    parser.add_argument("--stack-night-on-premium", choices=["STACK", "NO_STACK"])
    parser.add_argument("--week-start-dow", type=int)
    parser.add_argument(
        "--tier", action="append", default=[],
        help="UP_TO:MULTIPLIER (repeatable). Omit to copy existing tiers.",
    )
    parser.add_argument(
        "--allow-empty-tiers", action="store_true",
        help="Permit a version with no weekday tiers (the engine will drop those hours).",
    )
    args = parser.parse_args()

    cc = args.country_code.upper()
    try:
        effective_from = date.fromisoformat(args.effective_from)
    except ValueError:
        raise SystemExit(f"--effective-from: expected YYYY-MM-DD, got {args.effective_from!r}")

    db: Session = next(get_db())
    try:
        prior = _active_rule(db, cc)
        if effective_from <= prior.effective_from:
            raise SystemExit(
                f"--effective-from {effective_from} must be strictly after the active "
                f"rule's effective_from {prior.effective_from}."
            )

        payload: Dict[str, Any] = {
            "country_code": cc,
            "effective_from": effective_from,
            "source_reference": args.source_reference or prior.source_reference,
            "change_reason": args.change_reason,
            "notes": args.notes if args.notes is not None else prior.notes,
            "weekly_threshold_h": prior.weekly_threshold_h,
            "daily_threshold_h": prior.daily_threshold_h,
            "rest_day_multiplier": prior.rest_day_multiplier,
            "public_holiday_normal_hours_multiplier": prior.public_holiday_normal_hours_multiplier,
            "public_holiday_after_hours_multiplier": prior.public_holiday_after_hours_multiplier,
            "night_start": prior.night_start,
            "night_end": prior.night_end,
            "night_multiplier_habitual": prior.night_multiplier_habitual,
            "night_multiplier_occasional": prior.night_multiplier_occasional,
            "night_mode": prior.night_mode,
            "weekly_ot_soft_cap_h": prior.weekly_ot_soft_cap_h,
            "weekly_total_max_h": prior.weekly_total_max_h,
            "monthly_basic_ot_cap": prior.monthly_basic_ot_cap,
            "notional_hourly_divisor": prior.notional_hourly_divisor,
            "stack_holiday_on_rest_day": prior.stack_holiday_on_rest_day,
            "stack_night_on_premium": prior.stack_night_on_premium,
            "week_start_dow": prior.week_start_dow,
        }

        overrides = {
            "weekly_threshold_h": _decimal(args.weekly_threshold, "--weekly-threshold"),
            "daily_threshold_h": _decimal(args.daily_threshold, "--daily-threshold"),
            "rest_day_multiplier": _decimal(args.rest_day, "--rest-day"),
            "public_holiday_normal_hours_multiplier": _decimal(args.holiday_normal, "--holiday-normal"),
            "public_holiday_after_hours_multiplier": _decimal(args.holiday_after, "--holiday-after"),
            "night_start": _time(args.night_start, "--night-start"),
            "night_end": _time(args.night_end, "--night-end"),
            "night_multiplier_habitual": _decimal(args.night_habitual, "--night-habitual"),
            "night_multiplier_occasional": _decimal(args.night_occasional, "--night-occasional"),
            "night_mode": None if args.night_mode == "none" else args.night_mode,
            "weekly_ot_soft_cap_h": _decimal(args.weekly_ot_soft_cap, "--weekly-ot-soft-cap"),
            "weekly_total_max_h": _decimal(args.weekly_total_max, "--weekly-total-max"),
            "monthly_basic_ot_cap": _decimal(args.monthly_basic_ot_cap, "--monthly-basic-ot-cap"),
            "notional_hourly_divisor": _decimal(args.notional_hourly_divisor, "--notional-hourly-divisor"),
            "stack_holiday_on_rest_day": args.stack_holiday_on_rest_day,
            "stack_night_on_premium": args.stack_night_on_premium,
            "week_start_dow": args.week_start_dow,
        }
        for key, value in overrides.items():
            if value is not None:
                payload[key] = value

        if args.tier:
            tiers = [_tier(spec, i + 1) for i, spec in enumerate(args.tier)]
        else:
            tiers = [
                {
                    "tier_order": t.tier_order,
                    "up_to_hours": t.up_to_hours,
                    "multiplier": t.multiplier,
                }
                for t in sorted(prior.weekday_tiers, key=lambda t: t.tier_order)
            ]
        if not tiers and not args.allow_empty_tiers:
            raise SystemExit(
                "No weekday tiers: pass --tier UP_TO:MULTIPLIER, or "
                "--allow-empty-tiers if that is truly intended."
            )

        if args.dry_run:
            print(f"DRY RUN — would supersede {cc} v{prior.version} with:")
            for key in sorted(payload):
                print(f"  {key} = {payload[key]!r}")
            print("  weekday_tiers =")
            for t in tiers:
                print(f"    {t!r}")
            db.rollback()
            return 0

        new_rule = payroll_rules.supersede(
            db,
            model=CountryOvertimeRule,
            rule_filter={"country_code": cc},
            new_payload=payload,
            actor_user_id=args.actor_user_id,
            overtime_tiers=tiers,
            expected_latest_version=args.expected_version,
        )
        db.commit()
        print(
            f"Superseded {cc}: v{prior.version} (id={prior.id}) → "
            f"v{new_rule.version} (id={new_rule.id}), effective {new_rule.effective_from}."
        )
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
