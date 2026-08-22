"""Unit tests for CreateSchedule / UpdateSchedule schema edge cases.

Tests the `Field(default_factory=list)` fix for the real bug:
  - assigned_employee_ids missing from payload (frontend omits when
    no employees selected) → defaults to empty list

Also validates that required-field and type-mismatch scenarios still
correctly reject (empty-string Decimal, null list, etc).
"""

from decimal import Decimal
from datetime import datetime

import pytest
from pydantic import ValidationError

from schema.job_schema import CreateSchedule, UpdateSchedule


def minimal_payload(**overrides):
    """Return a valid CreateSchedule payload with optional field overrides."""
    payload = dict(
        title="Test Shift",
        company_id=1,
        location="Main Building",
        start_time="2026-07-27T08:00:00Z",
        end_time="2026-07-27T16:00:00Z",
        assigned_employee_ids=[1],
    )
    payload.update(overrides)
    return payload


class TestCreateSchedule:
    def test_happy_path(self):
        s = CreateSchedule(**minimal_payload())
        assert s.assigned_employee_ids == [1]
        assert isinstance(s.start_time, datetime)

    def test_missing_assigned_employee_ids_defaults_to_empty(self):
        """The real bug: frontend can omit the field entirely."""
        p = minimal_payload()
        del p["assigned_employee_ids"]
        s = CreateSchedule(**p)
        assert s.assigned_employee_ids == []

    def test_null_assigned_employee_ids_rejected(self):
        with pytest.raises(ValidationError):
            CreateSchedule(**minimal_payload(assigned_employee_ids=None))

    def test_empty_array_assigned_employee_ids(self):
        s = CreateSchedule(**minimal_payload(assigned_employee_ids=[]))
        assert s.assigned_employee_ids == []

    def test_empty_string_additional_remuneration_rejected(self):
        with pytest.raises(ValidationError):
            CreateSchedule(**minimal_payload(additional_remuneration_amount=""))

    def test_null_additional_remuneration(self):
        s = CreateSchedule(**minimal_payload(additional_remuneration_amount=None))
        assert s.additional_remuneration_amount is None

    def test_string_additional_remuneration(self):
        s = CreateSchedule(**minimal_payload(additional_remuneration_amount="500.00"))
        assert s.additional_remuneration_amount == Decimal("500.00")

    def test_numeric_additional_remuneration(self):
        s = CreateSchedule(**minimal_payload(additional_remuneration_amount=250.50))
        assert s.additional_remuneration_amount == Decimal("250.50")

    def test_integer_additional_remuneration(self):
        s = CreateSchedule(**minimal_payload(additional_remuneration_amount=100))
        assert s.additional_remuneration_amount == Decimal("100")

    def test_non_string_non_numeric_additional_remuneration_still_fails(self):
        with pytest.raises(ValidationError):
            CreateSchedule(**minimal_payload(additional_remuneration_amount=[1, 2, 3]))

    def test_hours_omitted_defaults_to_none(self):
        s = CreateSchedule(**minimal_payload())
        assert s.hours is None

    def test_hours_explicit_none(self):
        s = CreateSchedule(**minimal_payload(hours=None))
        assert s.hours is None

    def test_hours_empty_string(self):
        s = CreateSchedule(**minimal_payload(hours=""))
        assert s.hours == ""

    def test_hours_provided(self):
        s = CreateSchedule(**minimal_payload(hours="8 hours/day"))
        assert s.hours == "8 hours/day"

    def test_title_is_required(self):
        p = minimal_payload()
        del p["title"]
        with pytest.raises(ValidationError):
            CreateSchedule(**p)

    def test_location_is_required(self):
        p = minimal_payload()
        del p["location"]
        with pytest.raises(ValidationError):
            CreateSchedule(**p)


class TestUpdateSchedule:
    def test_empty_string_additional_remuneration_rejected(self):
        with pytest.raises(ValidationError):
            UpdateSchedule(additional_remuneration_amount="")

    def test_null_additional_remuneration(self):
        s = UpdateSchedule(additional_remuneration_amount=None)
        assert s.additional_remuneration_amount is None

    def test_valid_additional_remuneration(self):
        s = UpdateSchedule(additional_remuneration_amount="500.00")
        assert s.additional_remuneration_amount == Decimal("500.00")

    def test_partial_update(self):
        s = UpdateSchedule(status="completed")
        assert s.status == "completed"
        assert s.title is None
        assert s.start_time is None

    def test_null_assigned_employee_ids(self):
        s = UpdateSchedule(assigned_employee_ids=None)
        assert s.assigned_employee_ids is None
