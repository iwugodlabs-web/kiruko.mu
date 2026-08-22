"""Unit tests for the two-lock helpers in core.profile_lock.

Covers `fields_blocked_by_lock` (composition logic) and a sanity check on
the field-set partitioning. The integration-level guard tests live in
test_lock_enforcement.py.
"""

from types import SimpleNamespace

from core.profile_lock import (
    AUTO_LOCK_REASON,
    COMPANY_FIELDS,
    IDENTITY_FIELDS,
    fields_blocked_by_lock,
)


def _user(*, is_locked: bool = False, identity_verified: bool = False, lock_reason=None):
    """Tiny stand-in for a PrivateUser — fields_blocked_by_lock only reads
    these attrs, so we don't need the full SQLAlchemy model."""
    return SimpleNamespace(
        is_locked=is_locked, identity_verified=identity_verified, lock_reason=lock_reason
    )


class TestFieldSets:
    def test_sets_are_disjoint(self):
        """Each field belongs to exactly one lock — no overlap."""
        assert IDENTITY_FIELDS.isdisjoint(COMPANY_FIELDS)

    def test_identity_set_includes_kyc_basics(self):
        for f in ("first_name", "last_name", "date_of_birth", "pass_port_number", "gender"):
            assert f in IDENTITY_FIELDS, f"{f} missing from IDENTITY_FIELDS"

    def test_company_set_includes_employment_classification(self):
        for f in ("employment_type", "fte", "salary_assignments", "jobs"):
            assert f in COMPANY_FIELDS, f"{f} missing from COMPANY_FIELDS"


class TestFieldsBlockedByLock:
    def test_no_locks_no_block(self):
        u = _user()
        assert fields_blocked_by_lock(u, {"first_name", "fte", "phone"}) == set()

    def test_identity_verified_blocks_identity_only(self):
        u = _user(identity_verified=True)
        result = fields_blocked_by_lock(u, {"first_name", "fte", "phone"})
        assert result == {"first_name"}

    def test_manual_lock_blocks_identity_and_company(self):
        """A manually-locked profile (employer sealed it) freezes identity too."""
        u = _user(is_locked=True, lock_reason="security")
        result = fields_blocked_by_lock(u, {"first_name", "fte", "phone"})
        assert result == {"first_name", "fte"}

    def test_manual_lock_without_reason_blocks_identity_and_company(self):
        """No lock_reason ⇒ treated as a manual seal (not the auto marker)."""
        u = _user(is_locked=True, lock_reason=None)
        result = fields_blocked_by_lock(u, {"first_name", "fte", "phone"})
        assert result == {"first_name", "fte"}

    def test_auto_lock_blocks_company_only(self):
        """An auto-lock (admin company-edit) leaves identity editable for onboarding."""
        u = _user(is_locked=True, lock_reason=AUTO_LOCK_REASON)
        result = fields_blocked_by_lock(u, {"first_name", "fte", "phone"})
        assert result == {"fte"}

    def test_both_locks_compose(self):
        u = _user(is_locked=True, identity_verified=True)
        result = fields_blocked_by_lock(u, {"first_name", "fte", "phone"})
        assert result == {"first_name", "fte"}

    def test_phone_never_blocked(self):
        """phone, address, contact details remain editable in any state."""
        u = _user(is_locked=True, identity_verified=True)
        assert fields_blocked_by_lock(u, {"phone"}) == set()

    def test_empty_payload_returns_empty(self):
        u = _user(is_locked=True, identity_verified=True)
        assert fields_blocked_by_lock(u, set()) == set()
