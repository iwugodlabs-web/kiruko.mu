"""Overtime-rule supersede/seeder safety tests.

Guards the two operational invariants the CLI depends on:
  1. supersede() carries weekday tiers forward and audits them (a version with
     zero tiers silently drops weekday OT pay in the bucketer).
  2. the generic seeder refuses unverified placeholder configs unless
     explicitly allowed, and is idempotent once a rule exists.
"""

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from core.model import Country, CountryOvertimeRule
from scripts.overtime_rule_configs import CountryOvertimeConfig, OvertimeTierConfig
from scripts.seed_overtime_rules import seed_config
from services import payroll_rules


CC = "ZZ"


def _rule_payload(effective_from: date) -> dict:
    return {
        "country_code": CC,
        "effective_from": effective_from,
        "source_reference": "test",
        "change_reason": "test",
        "notes": None,
        "weekly_threshold_h": Decimal("45.00"),
        "daily_threshold_h": Decimal("9.00"),
        "rest_day_multiplier": Decimal("2.00"),
        "public_holiday_normal_hours_multiplier": Decimal("2.00"),
        "public_holiday_after_hours_multiplier": Decimal("2.00"),
        "night_start": None,
        "night_end": None,
        "night_multiplier_habitual": None,
        "night_multiplier_occasional": None,
        "night_mode": None,
        "weekly_ot_soft_cap_h": Decimal("11.50"),
        "weekly_total_max_h": None,
        "monthly_basic_ot_cap": None,
        "notional_hourly_divisor": None,
        "stack_holiday_on_rest_day": "MAX",
        "stack_night_on_premium": "NO_STACK",
        "week_start_dow": 1,
    }


@pytest.fixture()
def test_country(db: Session):
    if db.query(Country).filter(Country.code == CC).one_or_none() is None:
        db.add(Country(code=CC, name="Testland", currency="ZZD", is_active=True))
        db.commit()
    yield CC
    db.rollback()
    db.execute(
        text(
            "DELETE FROM country_overtime_weekday_tiers "
            "WHERE overtime_rule_id IN "
            "(SELECT id FROM country_overtime_rules WHERE country_code = :cc)"
        ),
        {"cc": CC},
    )
    db.execute(
        text("DELETE FROM country_overtime_rules WHERE country_code = :cc"),
        {"cc": CC},
    )
    db.execute(text("DELETE FROM countries WHERE code = :cc"), {"cc": CC})
    db.commit()


def test_supersede_carries_and_audits_weekday_tiers(db: Session, test_country):
    v1 = payroll_rules.supersede(
        db,
        model=CountryOvertimeRule,
        rule_filter={"country_code": CC},
        new_payload=_rule_payload(date(2026, 1, 1)),
        actor_user_id=None,
        overtime_tiers=[
            {"tier_order": 1, "up_to_hours": None, "multiplier": Decimal("1.50")}
        ],
        expected_latest_version=0,
    )
    db.commit()
    assert v1.version == 1
    assert len(v1.weekday_tiers) == 1

    v2 = payroll_rules.supersede(
        db,
        model=CountryOvertimeRule,
        rule_filter={"country_code": CC},
        new_payload=_rule_payload(date(2026, 6, 1)),
        actor_user_id=None,
        overtime_tiers=[
            {"tier_order": 1, "up_to_hours": Decimal("8.00"), "multiplier": Decimal("1.30")},
            {"tier_order": 2, "up_to_hours": None, "multiplier": Decimal("1.50")},
        ],
    )
    db.commit()

    db.refresh(v1)
    assert v1.effective_to == date(2026, 6, 1)
    assert v1.superseded_by_id == v2.id
    assert v2.version == 2
    assert [
        (t.tier_order, t.up_to_hours, t.multiplier) for t in v2.weekday_tiers
    ] == [
        (1, Decimal("8.00"), Decimal("1.30")),
        (2, None, Decimal("1.50")),
    ]

    audit = db.execute(
        text(
            "SELECT meta FROM audit_logs "
            "WHERE action='payroll_rule.superseded' "
            "AND target_type='country_overtime_rules' "
            "ORDER BY created_at DESC LIMIT 1"
        )
    ).fetchone()
    assert audit is not None
    tiers_audit = audit[0]["weekday_tiers"]
    assert tiers_audit["prior"] == [
        {"tier_order": 1, "up_to_hours": None, "multiplier": "1.50"}
    ]
    assert tiers_audit["new"] == [
        {"tier_order": 1, "up_to_hours": "8.00", "multiplier": "1.30"},
        {"tier_order": 2, "up_to_hours": None, "multiplier": "1.50"},
    ]


def test_seeder_guards_placeholders_and_is_idempotent(db: Session, test_country):
    cfg = CountryOvertimeConfig(
        country_code=CC,
        effective_from=date(2026, 1, 1),
        weekly_threshold_h=Decimal("45.00"),
        daily_threshold_h=Decimal("9.00"),
        rest_day_multiplier=Decimal("2.00"),
        public_holiday_normal_hours_multiplier=Decimal("2.00"),
        public_holiday_after_hours_multiplier=Decimal("2.00"),
        tiers=(
            OvertimeTierConfig(1, None, Decimal("1.50")),
        ),
        weekly_ot_soft_cap_h=Decimal("11.50"),
        verified=False,
        source_reference="test",
        change_reason="test",
    )

    assert seed_config(db, cfg, allow_placeholder=False, dry_run=False) == "skipped_unverified"
    assert (
        db.query(CountryOvertimeRule)
        .filter(CountryOvertimeRule.country_code == CC)
        .count()
        == 0
    )

    assert seed_config(db, cfg, allow_placeholder=True, dry_run=False) == "seeded"
    assert seed_config(db, cfg, allow_placeholder=True, dry_run=False) == "exists"

    rule = (
        db.query(CountryOvertimeRule)
        .filter(CountryOvertimeRule.country_code == CC)
        .filter(CountryOvertimeRule.effective_to.is_(None))
        .one()
    )
    assert rule.version == 1
    assert len(rule.weekday_tiers) == 1
