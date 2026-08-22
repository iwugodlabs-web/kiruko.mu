"""Pytest harness for the Kontokaz backend.

This conftest sets up an isolated `kontokaz_test` Postgres database,
runs alembic migrations, and seeds Mauritius payroll rules. Fixtures
provided:

  * `db`            — a SQLAlchemy session against the test DB.
  * `test_company`  — a Company with country_code='MU'.
  * `test_employee` — a PrivateUser + Job + Salary tied to test_company,
                      backdated to 2024-01-01 so EOY eligibility is met.
  * `seed_mu_rules` — the four MU rule types seeded once per session.
  * `clean_payroll_state` — auto-cleanup of payroll runs/payslips/one-offs
                            after each test, so tests don't bleed into each other.

The test DB is separate from the dev DB by design — the user's payroll product
must never have its dev seed corrupted by a stray test commit.
"""

# IMPORTANT: set POSTGRES_DB before any backend imports so decouple/settings pick
# it up. The backend connects to whatever POSTGRES_DB env var resolves to at
# settings load time.
import os

os.environ["POSTGRES_DB"] = os.environ.get("KONTOKAZ_TEST_DB", "kontokaz_test")
# Tests assume a local Postgres unless explicitly overridden.
os.environ.setdefault("POSTGRES_SERVER", "127.0.0.1")
os.environ.setdefault("POSTGRES_PORT", "5432")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", os.environ.get("POSTGRES_PASSWORD", ""))
os.environ.setdefault("POSTGRES_SSLMODE", "disable")
os.environ.setdefault("JWT_SECRET", "test-only-secret-not-for-prod")
os.environ.setdefault("JWT_ALGORITHM", "HS256")
# Never spawn the background email worker in tests — queue jobs are drained
# explicitly via email_queue.process_due_jobs().
os.environ.setdefault("EMAIL_WORKER_ENABLED", "false")

import sys
from datetime import date
from decimal import Decimal
from pathlib import Path

import asyncio

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker


@pytest.fixture(autouse=True)
def _ensure_event_loop():
    """Some tests run async endpoints via asyncio.run(), which CLOSES the
    thread's event loop and clears the current one. Tests that instead use
    asyncio.get_event_loop().run_until_complete() (e.g. kiosk) then hit
    "no current event loop" purely from ordering. Guarantee a live loop before
    each test so the two patterns coexist regardless of order."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            raise RuntimeError
    except RuntimeError:
        asyncio.set_event_loop(asyncio.new_event_loop())
    yield

# Make `backend/` importable as a top-level package root.
_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))


# ---------------------------------------------------------------------------
# Session-scoped: bootstrap the test database (create + migrate + seed).
# ---------------------------------------------------------------------------


def _admin_db_url() -> str:
    """Connection URL pointing at the default `postgres` DB so we can issue
    CREATE DATABASE for kontokaz_test."""
    return (
        f"postgresql+psycopg2://{os.environ['POSTGRES_USER']}:"
        f"{os.environ['POSTGRES_PASSWORD']}@{os.environ['POSTGRES_SERVER']}:"
        f"{os.environ['POSTGRES_PORT']}/postgres"
    )


def _ensure_test_db_exists() -> None:
    """(Re)create the kontokaz_test database so every pytest session starts
    pristine.

    The harness has no transactional per-test isolation — services call
    ``db.commit()`` directly and cleanup is manual (see the ``db`` fixture).
    That makes the suite order- and history-sensitive: a test that fails
    mid-cleanup leaves rows behind, and because the DB was historically
    never reset, that residue survived into the *next* pytest run and
    poisoned unrelated tests (duplicate-key/IntegrityErrors, stale counts).
    Symptom: wildly non-deterministic full-suite results between runs.

    So by default we DROP and recreate the test DB at session start — it's
    explicitly separate from the dev DB, so this is safe. For fast local
    iteration (skip the re-migrate/re-seed), set ``KONTOKAZ_TEST_KEEP_DB=1``
    to fall back to create-if-missing.
    """
    target = os.environ["POSTGRES_DB"]
    keep = os.environ.get("KONTOKAZ_TEST_KEEP_DB", "").strip().lower() in ("1", "true", "yes")
    admin_engine = create_engine(_admin_db_url(), isolation_level="AUTOCOMMIT")
    with admin_engine.connect() as conn:
        exists = conn.execute(
            text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": target}
        ).fetchone()
        if exists is not None and not keep:
            print(f"[pytest bootstrap] dropping stale database {target} for a pristine session")
            # Terminate any lingering connections so DROP doesn't error with
            # "database is being accessed by other users".
            conn.execute(
                text(
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                    "WHERE datname = :name AND pid <> pg_backend_pid()"
                ),
                {"name": target},
            )
            conn.execute(text(f'DROP DATABASE "{target}"'))
            exists = None
        if exists is None:
            print(f"[pytest bootstrap] creating database {target}")
            conn.execute(text(f'CREATE DATABASE "{target}"'))
        else:
            print(f"[pytest bootstrap] reusing database {target} (KONTOKAZ_TEST_KEEP_DB set)")
    admin_engine.dispose()


def _run_alembic_upgrade() -> None:
    """Run `alembic upgrade head` against the test DB.

    We invoke alembic programmatically so the test bootstrap doesn't depend
    on a shell. Alembic reads its own connection URL via env.py's call to
    core.settings, which we've already pointed at kontokaz_test.
    """
    from alembic import command
    from alembic.config import Config

    alembic_ini = _BACKEND_ROOT / "alembic.ini"
    cfg = Config(str(alembic_ini))
    # alembic's script_location in alembic.ini is relative; ensure it resolves.
    cfg.set_main_option("script_location", str(_BACKEND_ROOT / "alembic"))
    print(f"[pytest bootstrap] running alembic upgrade head against {os.environ['POSTGRES_DB']}")
    command.upgrade(cfg, "head")


def _seed_mu_rules() -> None:
    """Run the MU payroll rules seed once per session.

    Idempotent: if MU rules already exist (from a prior pytest session or a
    manual seed), skip. The seed uses supersede() which would reject a
    duplicate effective_from on re-run.
    """
    from core.config import get_engine_from_settings
    from sqlalchemy import text as _text

    eng = get_engine_from_settings()
    with eng.connect() as conn:
        existing = conn.execute(
            _text(
                "SELECT COUNT(*) FROM tax_bracket_sets WHERE country_code = 'MU'"
            )
        ).scalar()
    if existing and existing > 0:
        print("[pytest bootstrap] MU rules already seeded — skipping")
        return

    print("[pytest bootstrap] seeding MU payroll rules")
    from scripts import seed_mu_payroll_rules

    seed_mu_payroll_rules.main()


def _seed_mu_overtime() -> None:
    """Seed the MU overtime rule + 2026 holidays once per session.

    Idempotent — seed_overtime_rules_mu.py checks for an existing row and skips.
    Required since M2 draft-run creation hard-gates on the overtime rule.
    """
    from core.config import get_engine_from_settings
    from sqlalchemy import text as _text

    eng = get_engine_from_settings()
    with eng.connect() as conn:
        existing = conn.execute(
            _text(
                "SELECT COUNT(*) FROM country_overtime_rules WHERE country_code = 'MU'"
            )
        ).scalar()
    if existing and existing > 0:
        print("[pytest bootstrap] MU overtime rule already seeded — skipping")
        return

    print("[pytest bootstrap] seeding MU overtime rule")
    from scripts import seed_overtime_rules_mu

    seed_overtime_rules_mu.main()


@pytest.fixture(scope="session")
def _bootstrap_test_db():
    """Create + migrate + seed the test DB once per pytest session."""
    _ensure_test_db_exists()
    _run_alembic_upgrade()
    _seed_mu_rules()
    _seed_mu_overtime()
    _seed_tz_shadow_rules()
    yield


def _seed_tz_shadow_rules() -> None:
    """Seed TZ PAYE + statutory ded (placeholder) so a MU→TZ mission produces
    non-zero host-country shadow figures. Idempotent guarded by existence check
    (places systems wholly in superseded state if re-run on a fresh DB)."""
    from sqlalchemy import text as _text2

    from core.config import get_engine_from_settings

    eng = get_engine_from_settings()
    with eng.connect() as conn:
        existing = conn.execute(
            _text2("SELECT COUNT(*) FROM tax_bracket_sets WHERE country_code = 'TZ'")
        ).scalar()
    if existing and existing > 0:
        print("[pytest bootstrap] TZ shadow rules already seeded — skipping")
        return
    print("[pytest bootstrap] seeding TZ shadow-payroll rules")
    from scripts import seed_tz_shadow_rules

    seed_tz_shadow_rules.main()


# ---------------------------------------------------------------------------
# Per-test session — yields a SQLAlchemy Session against the test DB.
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def _engine(_bootstrap_test_db):
    from sqlalchemy import event

    from core import config as core_config

    eng = core_config.get_engine_from_settings()

    # Reset session-level state to a clean baseline on every connection
    # checkout. Without this, a test that uses `set_config(... is_local=false)`
    # or `SET ROLE` poisons that connection for the rest of the pytest session
    # (both persist in the pool). Tests that intentionally exercise RLS set
    # these themselves AFTER checkout.
    #
    # RESET ROLE is load-bearing: the RLS tests do `SET ROLE kiruko_app`
    # (a non-owner role) and, on any path where their own RESET doesn't take
    # (aborted tx, error before the finally), the role leaks. A later test
    # then inherits it and fails its `ALTER TABLE audit_logs DISABLE TRIGGER`
    # teardown with "must be owner of table audit_logs". Resetting here makes
    # every connection start as the owning role regardless of prior leakage.
    @event.listens_for(eng, "checkout")
    def _reset_session_state_on_checkout(dbapi_conn, connection_record, connection_proxy):
        try:
            cursor = dbapi_conn.cursor()
            cursor.execute("RESET ROLE")
            cursor.execute("SELECT set_config('app.company_id', '*', false)")
            cursor.close()
        except Exception:
            pass  # don't fail tests if the reset doesn't take

    yield eng
    eng.dispose()


@pytest.fixture()
def db(_engine) -> Session:
    """A fresh SQLAlchemy session per test.

    The backend services use `db.commit()` directly, so a savepoint-based
    rollback wouldn't work. Tests are responsible for cleanup; the
    `clean_payroll_state` fixture handles the most common churn-y tables.

    M5b: each test starts with `app.company_id = '*'` (RLS bypass) so a
    test that didn't fully reset the session-level Postgres setting
    (e.g. crashed mid-cleanup) doesn't leave the next test running under
    a stale tenant scope. Tests that want strict RLS opt in via
    `_set_pg_company_id`.
    """
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)
    session = SessionLocal()
    try:
        # Defensive reset — survives any prior test's leftover state.
        try:
            session.execute(sql_text("SELECT set_config('app.company_id', '*', false)"))
            session.commit()
        except Exception:
            session.rollback()
        yield session
    finally:
        session.close()


# ---------------------------------------------------------------------------
# Domain fixtures — a stable test company + employee.
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def test_company_id(_bootstrap_test_db, _engine) -> int:
    """One Company row for the entire test session. Idempotent."""
    from core.model import Company, User

    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)
    s = SessionLocal()
    try:
        existing = (
            s.query(Company).filter(Company.brn == "TEST_BRN_FIXTURE").one_or_none()
        )
        if existing is not None:
            return existing.company_id

        # Create an owner user first (needed for Company.user_id FK semantics).
        owner = (
            s.query(User).filter(User.email == "test-owner@kontokaz.test").one_or_none()
        )
        if owner is None:
            owner = User(
                user_type="company",
                email="test-owner@kontokaz.test",
                user_name="test-owner",
                password_hash="not-used-in-tests",
            )
            s.add(owner)
            s.flush()

        company = Company(
            user_id=owner.user_id,
            company_name="Kontokaz Test Co.",
            email="test-co@kontokaz.test",
            brn="TEST_BRN_FIXTURE",
            country_code="MU",
        )
        s.add(company)
        s.commit()
        return company.company_id
    finally:
        s.close()


@pytest.fixture(scope="session")
def test_employee_id(_bootstrap_test_db, _engine, test_company_id: int) -> int:
    """One PrivateUser + Job + Salary + active SalaryAssignment for the
    session. Backdated to 2024-01-01 so EOY eligibility is met by Dec 2026."""
    from core.model import (
        EmployeeSalaryAssignment,
        Job,
        PrivateUser,
        Salary,
        SalaryComponent,
        SalaryStructure,
        SalaryStructureLine,
        User,
    )

    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)
    s = SessionLocal()
    try:
        # Idempotent: reuse if already created.
        existing = (
            s.query(PrivateUser)
            .filter(PrivateUser.pass_port_number == "TEST_PASS_FIXTURE")
            .one_or_none()
        )
        if existing is not None:
            return existing.private_user_id

        owner = User(
            user_type="private",
            email="test-employee@kontokaz.test",
            user_name="test-employee",
            password_hash="not-used-in-tests",
        )
        s.add(owner)
        s.flush()

        priv = PrivateUser(
            user_id=owner.user_id,
            first_name="Jane",
            last_name="Doe",
            company_id=test_company_id,
            pass_port_number="TEST_PASS_FIXTURE",
            role="employee",
        )
        s.add(priv)
        s.flush()

        job = Job(
            private_user_id=priv.private_user_id,
            company_id=test_company_id,
            job_title="Test role",
            employer_name="Kontokaz Test Co.",
            employer_brn="TEST_BRN_FIXTURE",
            employer_email="test-employer@kontokaz.test",
            first_date_of_employment=date(2024, 1, 1),
        )
        s.add(job)
        s.flush()

        # Legacy Salary row (kept for reference; not used by post-redesign engine).
        s.add(
            Salary(
                job_id=job.job_id,
                monthly_hours="173",
                break_in_minutes_per_day=30,
                days_of_work_per_month=22,
                salary=Decimal("30000.00"),
                allowance=Decimal("6000.00"),
                revenue=Decimal("36000.00"),
            )
        )

        # New-model: components + structure + assignment.
        basic = SalaryComponent(
            company_id=test_company_id,
            code="BASIC",
            label="Basic salary",
            kind="earning",
            category="earning.basic",
            is_basic=True,
            is_taxable=True,
        )
        allowance = SalaryComponent(
            company_id=test_company_id,
            code="ALLOWANCE",
            label="Allowance",
            kind="earning",
            category="allowance.general",
            is_basic=False,
            is_taxable=True,
        )
        s.add_all([basic, allowance])
        s.flush()

        structure = SalaryStructure(
            company_id=test_company_id, name="Test Structure", description="Fixture"
        )
        s.add(structure)
        s.flush()

        s.add_all(
            [
                SalaryStructureLine(
                    structure_id=structure.id,
                    component_id=basic.id,
                    amount=Decimal("30000.00"),
                    order_index=0,
                ),
                SalaryStructureLine(
                    structure_id=structure.id,
                    component_id=allowance.id,
                    amount=Decimal("6000.00"),
                    order_index=1,
                ),
            ]
        )
        s.add(
            EmployeeSalaryAssignment(
                private_user_id=priv.private_user_id,
                structure_id=structure.id,
                currency="MUR",
                effective_from=date(2024, 1, 1),
                notes="Fixture",
            )
        )

        s.commit()
        return priv.private_user_id
    finally:
        s.close()


@pytest.fixture()
def test_company(db: Session, test_company_id: int):
    from core.model import Company

    return db.query(Company).filter(Company.company_id == test_company_id).one()


@pytest.fixture()
def test_employee(db: Session, test_employee_id: int):
    from core.model import PrivateUser

    return db.query(PrivateUser).filter(PrivateUser.private_user_id == test_employee_id).one()


@pytest.fixture()
def seed_mu_rules(_bootstrap_test_db):
    """Marker fixture — the seed already ran in _bootstrap_test_db. Exists so
    tests can declare an explicit dependency on seeded MU rules."""
    return True



# ---------------------------------------------------------------------------
# audit_logs WORM-trigger workaround for tests
# ---------------------------------------------------------------------------


from contextlib import contextmanager
from typing import Iterator


@contextmanager
def audit_logs_unlocked(db: Session) -> Iterator[None]:
    """Suspend the audit_logs WORM triggers (audit_logs_no_update +
    audit_logs_no_delete from audit_log_indexes_20260512) for the
    duration of the `with` block, then re-enable them — even on error.

    Tests need to wipe per-row audit churn between cases. The triggers
    block UPDATE and DELETE outright (the hint says
    ``ALTER TABLE audit_logs DISABLE TRIGGER ALL — that DDL is itself
    auditable``). This helper packages that DDL into a one-liner so
    every test teardown that touches audit_logs uses the same idiom.

    Production code MUST NOT call this — the WORM guarantee in prod
    is load-bearing for compliance. Test-only usage is signalled by
    living in conftest.py.
    """
    try:
        db.execute(text("ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_delete"))
        db.execute(text("ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_update"))
        db.commit()
        yield
    finally:
        # Always restore. Use a fresh tx so a mid-block rollback doesn't
        # leave the triggers disabled past the test boundary.
        try:
            db.rollback()
        except Exception:
            pass
        db.execute(text("ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_delete"))
        db.execute(text("ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_update"))
        db.commit()


# ---------------------------------------------------------------------------
# Cleanup — wipe per-test churn so tests can't bleed into each other.
# ---------------------------------------------------------------------------


@pytest.fixture()
def clean_payroll_state(db: Session):
    """Truncate payroll-side tables that tests commonly create rows in.

    The seeded country rules and the session-scoped company/employee/structure
    fixtures are preserved; only the per-test churn is wiped.

    Cleans BOTH before and after the test. Cleaning before is load-bearing:
    a prior test that created a payroll_run for the shared test company/period
    and didn't clean up would otherwise make this test's setup fail with a 409
    "run for this period already exists" (the failure mode that made the suite
    order-dependent). Cleaning before guarantees a clean slate at entry; the
    after-pass keeps this test's own churn from leaking onward.
    """
    def _clean():
        db.rollback()  # discard any uncommitted state on the session
        # Use raw SQL because some FKs are RESTRICT — explicit order matters.
        for stmt in [
            "DELETE FROM payslips",
            "DELETE FROM payroll_runs",
            "DELETE FROM employee_one_off_allowances",
            # Wipe any post-fixture statutory_deductions versions added by tests
            # (e.g. supersede tests). Keep the originals (version=1) intact.
            "UPDATE statutory_deductions SET effective_to=NULL, superseded_by_id=NULL "
            "WHERE country_code='MU' AND version=1",
            "DELETE FROM statutory_deductions WHERE version > 1",
        ]:
            db.execute(text(stmt))
        db.commit()
        # audit_logs cleanup runs INSIDE the WORM unlock so the per-test
        # churn (payroll-rule supersedes, profile-lock toggles) doesn't
        # outlive the test that produced it.
        with audit_logs_unlocked(db):
            db.execute(text(
                "DELETE FROM audit_logs WHERE action IN ("
                "'payroll_rule.superseded','payroll_rule.consistency_violation',"
                "'profile.lock','profile.unlock','profile.edit_blocked')"
            ))
            db.commit()

    _clean()
    yield
    _clean()
