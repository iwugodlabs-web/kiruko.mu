from sqlalchemy import Column, Date, Integer, SmallInteger, String, DateTime, Time, Float, ForeignKey, Numeric, Boolean, Computed, BigInteger, Table, Text, CheckConstraint, Index
from sqlalchemy.orm import relationship, backref, object_session
from sqlalchemy import UniqueConstraint
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.dialects.postgresql import JSONB, JSON, UUID
# Assuming you have a base class for declarative models
from core.base_class import Base
import enum
from sqlalchemy import Enum, func, text
from datetime import date, datetime
from typing import Optional


# Guards effective_country_code (below) against a DB where the
# employee_country_assignments migration hasn't been applied yet — i.e. app
# code deployed ahead of its schema. Without this, every showUser serialization
# (login, employee lists) 500s on `relation "employee_country_assignments" does
# not exist`. We check table presence up front on a SEPARATE connection and skip
# the lookup when absent, rather than letting the lazy-load raise mid-request —
# a raised query poisons the transaction, so a plain try/except wouldn't recover
# the rest of the serialization. Cached per process; a post-migration deploy
# restarts the process and re-detects the now-present table.
_country_assignments_table_present: "bool | None" = None


def _country_assignments_table_available(session) -> bool:
    global _country_assignments_table_present
    if _country_assignments_table_present is None:
        try:
            _country_assignments_table_present = sa_inspect(
                session.get_bind()
            ).has_table("employee_country_assignments")
        except Exception:
            # Can't tell (no bind / inspection failed) — treat as absent so we
            # degrade gracefully rather than risk the failing lazy-load.
            return False
    return _country_assignments_table_present

# Import the CompanyUserRole model so relationships can reference it
from core.company_user_role import CompanyUserRole
from core.platform_role import PlatformRole, UserPlatformRole

class UserType(enum.Enum):
    private = "private"
    company = "company"

# Association table for the many-to-many relationship between Schedule and PrivateUser
schedule_assignments = Table(
    "schedule_assignments",
    Base.metadata,
    Column("schedule_id", Integer, ForeignKey("schedules.schedule_id", ondelete="CASCADE"), primary_key=True),
    Column("private_user_id", Integer, ForeignKey("private_users.private_user_id", ondelete="CASCADE"), primary_key=True),
)

# SQLAlchemy User model
class User(Base):
    __tablename__ = "users"

    user_id = Column(Integer, primary_key=True, autoincrement=True)
    user_type = Column(Enum(UserType), nullable=False)
    email = Column(String, unique=True, index=True)
    phone = Column(String(20), nullable=True)
    user_name = Column(String, unique=True, index=True, nullable=True)
    password_hash = Column(String)
    onboard_complete = Column(Boolean, default=False)
    user_verified = Column(Boolean, default=False)
    company_onboarding_status = Column(String, default="pending", server_default="pending")
    verification_note = Column(String, nullable=True)
    user_enabled = Column(Boolean, default=True)
    expo_push_token = Column(String, nullable=True)
    # M18 — UI locale preference. NULL means "use browser/device default".
    # CHECK constraint enforces BCP-47-ish shape; engine resolution priority
    # is documented on the migration.
    preferred_locale = Column(String(10), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    company = relationship("Company", back_populates="user", uselist=False)
    private_user = relationship(
        "PrivateUser",
        back_populates="user",
        uselist=False,
        foreign_keys="PrivateUser.user_id",
    )

# PrivateUsers table for private user-specific details
class PrivateUser(Base):
    __tablename__ = "private_users"

    private_user_id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.user_id", ondelete="CASCADE"), unique=True, nullable=False)
    first_name = Column(String(100), nullable=False)
    last_name = Column(String(100), nullable=False)
    phone = Column(String(20))
    gender = Column(String)
    date_of_birth = Column(DateTime, nullable=True)
    pass_port_number = Column(String, unique=True, nullable=True)
    company_id = Column(Integer, ForeignKey("companies.company_id", ondelete="SET NULL"))
    department_id = Column(Integer, ForeignKey("departments.department_id", ondelete="SET NULL"), nullable=True)
    # Home site (geofence) the employee is based at — "Port Louis HQ", "Vacoas
    # branch"… Shown on payslips (snapshotted per run) and used by admin to
    # bucket staff by branch. NOT an enforcement rule: clock-in still verifies
    # against every active fence, never just this one. NULL = not assigned.
    home_geofence_id = Column(
        Integer,
        ForeignKey("company_geofences.geofence_id", ondelete="SET NULL"),
        nullable=True,
    )
    # Role for company-level permissions: owner, admin, manager, employee
    role = Column(String(20), nullable=False, server_default='employee')
    # Plan Phase 12.A — escape hatch for the "I have no current employer"
    # case. Without this, a user between jobs is permanently stuck on the
    # onboarding gate. Acknowledging it satisfies the employer-link check.
    onboarding_acknowledged_no_employer = Column(Boolean, nullable=False, server_default='false')
    # Profile lock — when set, employee cannot self-edit COMPANY_FIELDS
    # (employment_type, fte, salary_assignments, jobs) until an admin unlocks.
    # Auto-flips to true on any admin company-edit; admin can also toggle manually.
    is_locked = Column(Boolean, nullable=False, server_default='false')
    locked_at = Column(DateTime(timezone=True), nullable=True)
    locked_by_user_id = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    lock_reason = Column(String, nullable=True)
    # KYC identity verification — one-way flag set when admin verifies the
    # employee's identity (DOB / passport / NID). Once true, IDENTITY_FIELDS
    # become non-self-editable to keep MRA filings consistent.
    identity_verified = Column(Boolean, nullable=False, server_default='false')
    identity_verified_at = Column(DateTime(timezone=True), nullable=True)
    identity_verified_by_user_id = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    # M20 — employment classification + FTE multiplier for part-time
    employment_type = Column(String(20), nullable=False, server_default='full_time')
    fte = Column(Numeric(4, 3), nullable=False, server_default='1.000')
    # Sponsored Content Phase 2 (M9) — per-seat ads opt-out + DPA consent timestamp.
    # `is_ad_free=true` blocks all kind='ad' serving for this user (set by
    # employer-paid B2B perk OR by consent withdrawal). `ads_consent_at IS NULL`
    # also blocks ads — both flags are checked independently in serve_one().
    is_ad_free = Column(Boolean, nullable=False, server_default='false')
    ads_consent_at = Column(DateTime(timezone=True), nullable=True)
    # M26 — kiosk MVP. NULL means "PIN not set, kiosk login disabled".
    # bcrypt-hashed 4-digit PIN; admin sets via POST /admin/private-users/{id}/kiosk-pin.
    kiosk_pin_hash = Column(String(255), nullable=True)
    # M26 — employee-specific max-shift override for the missed-clockout
    # auto-close chain (Job → PrivateUser → Company → 12h). NULL means
    # "fall through to Company.default_max_shift_hours".
    max_shift_hours = Column(Numeric(4, 2), nullable=True)
    # Short human-readable code (e.g. 'JS4821') shown on the Clock-in review
    # screen and the Employees list — initials + random digits, unique per
    # company (not globally). NULL until backfilled/generated; see
    # services/employee_code_service.py.
    employee_code = Column(String(10), nullable=True)
    # Country for independent/personal users (no company_id) who self-report
    # their own profile — mirrors how they already self-report `Salary`.
    # Company-affiliated employees ignore this column entirely; see
    # effective_country_code below. Left NULL by default (no backfill) so
    # every existing independent user's behavior is unchanged until they
    # actively set it.
    country_code = Column(String(2), ForeignKey("countries.code"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    user = relationship(
        "User",
        back_populates="private_user",
        foreign_keys=[user_id],
    )
    company = relationship("Company", back_populates="private_users")
    department = relationship("Department", back_populates="private_users")
    home_geofence = relationship("CompanyGeofence")
    jobs = relationship("Job", back_populates="private_user")
    time_logs = relationship("TimeLog", back_populates="private_user")
    job_history = relationship("JobHistory", back_populates="private_user")
    schedules = relationship("Schedule", secondary=schedule_assignments, back_populates="assigned_employees")
    leaves = relationship("Leave", back_populates="private_user", cascade="all, delete-orphan")

    @property
    def home_site_name(self) -> Optional[str]:
        """Resolved branch/site name for serialization (payslips, profiles).
        Resolves even when the site is soft-deleted so historical references stay readable."""
        return self.home_geofence.name if self.home_geofence is not None else None

    # Associated roles (many-to-many entries in company_user_roles)
    roles = relationship("CompanyUserRole", back_populates="private_user", cascade="all, delete-orphan")
    # Effective-dated country assignments (missions / transfers). Read by
    # effective_country_code (display/admin) — eager-load in bulk loops to
    # avoid N+1, same guidance as the `company` relationship.
    country_locations = relationship(
        "EmployeeCountryAssignment",
        back_populates="private_user",
        order_by="EmployeeCountryAssignment.effective_from",
    )

    __table_args__ = (
        Index(
            "uq_private_user_company_employee_code",
            "company_id", "employee_code",
            unique=True,
            postgresql_where=text("employee_code IS NOT NULL"),
        ),
    )

    @property
    def effective_country_code(self) -> str:
        """Country assignment → company → self → phone → 'MU'.

        Resolution order (matches the no-assignment behavior exactly — a user
        with no country assignment resolves identically to before):
          1. The **active country assignment** on `as_of = today`, if any
             (foreign mission / transfer — see EmployeeCountryAssignment).
          2. Company employees inherit their employer's country.
          3. Independent users fall back to their own profile setting.
          4. Inferred from their phone's calling code (there's no signup/
             settings UI to set `country_code` directly yet — see
             core/model.py:113-118).
          5. 'MU' — preserving every existing independent user's behavior
             for anyone whose phone doesn't resolve to a known calling code.

        This property only feeds admin-side display/filtering (compliance
        dispute lists, the platform All Users table) — it is NOT consulted by
        the payroll engine, which is entirely Company.country_code-scoped via
        Job/PrivateUser.company_id. Independent users (no company_id) never
        enter payroll at all, so this inference is a display accuracy
        improvement, not a statutory-correctness one.

        Callers iterating many PrivateUser rows (bulk payroll runs,
        compliance dashboards) should eager-load `company` and
        `country_locations` first — this property does not, and will N+1 in a
        loop otherwise.
        """
        as_of = date.today()
        # Only consult country assignments when the table actually exists. If the
        # migration hasn't run in this environment, skip straight to the
        # company/self/phone/'MU' fallback instead of 500-ing (see
        # _country_assignments_table_available). A detached instance (no session)
        # also can't load the relationship, so skip it there too.
        _sess = object_session(self)
        if _sess is not None and _country_assignments_table_available(_sess):
            for assignment in (self.country_locations or []):
                if (
                    assignment.effective_from <= as_of
                    and (assignment.effective_to is None or assignment.effective_to > as_of)
                    and assignment.archived_at is None
                ):
                    return assignment.country_code
        if self.company_id and self.company and self.company.country_code:
            return self.company.country_code
        if self.country_code:
            return self.country_code
        if self.phone:
            from core.phone_utils import MU_COUNTRY_CODE, TZ_COUNTRY_CODE, normalize_phone
            normalized = normalize_phone(self.phone)
            if normalized:
                digits = normalized.lstrip("+")
                calling_code_to_country = {MU_COUNTRY_CODE: "MU", TZ_COUNTRY_CODE: "TZ"}
                for calling_code, country in calling_code_to_country.items():
                    if digits.startswith(calling_code):
                        return country
        return "MU"



# Companies table for company-specific details
class Company(Base):
    __tablename__ = "companies"

    company_id = Column(Integer, primary_key=True, autoincrement=True)
    # user_id = Column(Integer, ForeignKey("users.user_id", ondelete="CASCADE"), unique=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    
    company_name = Column(String(255), nullable=False)
    email= Column(String, unique=True, index=True,  nullable=True)
    brn = Column(String, nullable=False)
    address = Column(String, nullable=True)
    phone = Column(String(20))
    vat = Column(String(50), nullable=True)  # VAT registration number (optional)
    annual_leave_budget = Column(Integer, default=0, nullable=True)  # Manually set total leaves for the year
    country_code = Column(String(2), ForeignKey("countries.code"), nullable=False, server_default='MU')
    # M3: when true, payroll engine only consumes time_logs with
    # admin_approved=true. Default false so existing flows aren't disrupted;
    # admins opt in once they're ready to run an approval workflow.
    require_approved_clockins_for_payroll = Column(
        Boolean, nullable=False, server_default='false',
    )
    # M8 closeout — per-company retention override for Concerns v2 (default
    # 7 years). Customers with stricter regimes can extend; customers with
    # lighter contracts can request 3. The retention-purge cron reads this
    # column when computing `retention_purge_at` on close.
    concern_retention_years = Column(Integer, nullable=False, server_default='7')
    # Sponsored Content Phase 2 (M9) — master per-company toggle for
    # third-party ads (kind='ad'). Existing rows at migration time were
    # backfilled to FALSE (grandfathered); new signups default TRUE per the
    # post-Phase-2 contract clause. Flipping here cuts ads for ALL the
    # company's employees on the next /serve (60s cache window). Does NOT
    # affect kind='employer' (own-company announcements) or kind='house'.
    ads_enabled = Column(Boolean, nullable=False, server_default='true')
    # Tanzania's SDL (Skills Development Levy, employer-only) applies only
    # to employers with 10+ staff — a headcount condition, not an income
    # threshold, so it doesn't fit StatutoryDeduction's existing
    # threshold_low/high (income-based) fields. Platform-admin-set rather
    # than a live per-run headcount query: a count that flickers right
    # around the 10-person line would make SDL inconsistently apply between
    # payroll periods, which is worse than one deliberate judgment call at
    # onboarding. NULL/False for every non-TZ company — irrelevant outside
    # TZ until this is wired into a filter on employer-side deductions.
    sdl_applicable = Column(Boolean, nullable=True)
    # Overtime engine: IANA timezone name. UTC TimeLog timestamps are converted
    # to local wall-clock for night-window + day-type classification. Default
    # matches the launch market; admins override per-tenant.
    timezone = Column(String(60), nullable=False, server_default='Indian/Mauritius')
    # Lifecycle: 'active' (normal), 'disabled' (admin froze it — non-admins get
    # 403), 'deleted' (soft-deleted — hidden from normal listings, admin-only
    # restore). Enforced in require_company_scope; there is no hard-delete path.
    status = Column(String(16), nullable=False, server_default='active')
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    status_changed_at = Column(DateTime(timezone=True), nullable=True)
    # M26 — company-wide default for the missed-clockout auto-close chain
    # (Job → PrivateUser → Company → 12h). NULL means "fall through to the
    # 12h system constant".
    default_max_shift_hours = Column(Numeric(4, 2), nullable=True)
    # Geofencing v3 — master switch for location-based clock-in/out
    # enforcement: 'off' (record only — existing behaviour), 'block' (reject
    # punches outside every fence), 'flag' (allow but mark out_of_geofence for
    # admin review). Per-fence mode overrides for a specific site.
    geofence_default_mode = Column(String(16), nullable=False, server_default='off')
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    user = relationship("User", back_populates="company")  # <-- Add this line
    private_users = relationship("PrivateUser", back_populates="company")
    jobs = relationship("Job", back_populates="company")
    job_history = relationship("JobHistory", back_populates="company")
    schedules = relationship("Schedule", back_populates="company")
        # Company-user roles (many-to-many via CompanyUserRole)
    user_roles = relationship("CompanyUserRole", back_populates="company", cascade="all, delete-orphan")
    monthly_payrolls = relationship("CompanyMonthlyPayroll", back_populates="company", cascade="all, delete-orphan")
    # M26 — registered kiosk tablets for this company
    kiosk_devices = relationship("KioskDevice", back_populates="company", cascade="all, delete-orphan")
    # Geofencing v3 — one or more per-site perimeters (multi-branch support).
    geofences = relationship("CompanyGeofence", back_populates="company", cascade="all, delete-orphan")
    # Read-only — Company doesn't own this FK relationship's other side
    # (Country has no back_populates list of companies; not needed).
    country = relationship("Country", viewonly=True)

    @property
    def currency(self) -> str | None:
        """The company's operating currency, derived from its country (e.g.
        'MUR' for MU, 'TZS' for TZ) — NOT a stored column. Was previously
        unavailable on any client-facing schema, so mobile/web had no way to
        label money correctly for a non-MU company; every UI that showed a
        currency string either hardcoded 'Rs' or relied on a user's personal
        display-currency preference (a different, unrelated concept)."""
        return self.country.currency if self.country else None


class CompanyMonthlyPayroll(Base):
    __tablename__ = "company_monthly_payrolls"

    id = Column(Integer, primary_key=True, autoincrement=True)
    company_id = Column(Integer, ForeignKey("companies.company_id", ondelete="CASCADE"), nullable=False)
    year = Column(Integer, nullable=False)
    month = Column(Integer, nullable=False) # 1-12
    total_amount = Column(Numeric(12, 2), default=0.0)
    currency = Column(String(3), default="MUR")
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    company = relationship("Company", back_populates="monthly_payrolls")


class CompanyGeofence(Base):
    """Geofencing v3 — one virtual perimeter for a company site.

    A punch is "on site" when the device position (or a QR/Wi-Fi anchor)
    falls within at least one active fence. Companies with multiple sites
    (branches, warehouses) configure one fence per site.

    ``mode`` overrides the company's ``geofence_default_mode`` for this
    specific site:
      * 'block' — reject punches from outside this fence (HTTP 403).
      * 'flag'  — allow the punch but mark ``out_of_geofence`` so the
        time-log review UI surfaces it for admin decision.

    Anchors are weak-GPS fallbacks (indoor sites, kiosk tablets without
    reliable GPS):
      * ``anchor_qr_token``  — a printable QR token scanned at the site
        (Kronos-style Known-Place anchor). Unique across the platform.
      * ``anchor_wifi_bssids`` — accepted Wi-Fi BSSIDs. Best-effort: iOS
        requires the location entitlement to read the SSID/BSSID.
    ``ip_country_required`` opts into an IP cross-check (multi-signal
    convergence). It can only *raise* confidence — a flaky IP geo lookup
    must never block a legitimate punch.
    """
    __tablename__ = "company_geofences"

    geofence_id = Column(Integer, primary_key=True, autoincrement=True)
    company_id = Column(Integer, ForeignKey("companies.company_id", ondelete="CASCADE"), nullable=False)
    name = Column(String(120), nullable=False)
    # Human-readable address for this site (e.g. "12 Avenue Road, Port Louis")
    # so branch lists show where each fence is — set by the web settings UI
    # from the geocoder result (or reverse-geocoded from the pin).
    address = Column(String(255), nullable=True)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    radius_meters = Column(Integer, nullable=False, server_default='200')
    mode = Column(String(16), nullable=False, server_default='block')  # 'block' | 'flag'
    active = Column(Boolean, nullable=False, server_default='true')
    ip_country_required = Column(Boolean, nullable=False, server_default='false')
    anchor_qr_token = Column(String(64), nullable=True, unique=True)
    anchor_wifi_bssids = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
    # Soft delete: set (never cleared) to hide a site from lists + enforcement
    # while keeping employee home-site assignments and payslip snapshots intact.
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    company = relationship("Company", back_populates="geofences")



class CompanyInvite(Base):
    __tablename__ = "company_invites"

    invite_id = Column(Integer, primary_key=True, autoincrement=True)
    company_id = Column(Integer, ForeignKey("companies.company_id", ondelete="CASCADE"), nullable=False)
    email = Column(String, nullable=False)
    role = Column(String(20), nullable=False, server_default='employee')
    token = Column(String(128), nullable=False, unique=True, index=True)
    invited_by = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    accepted = Column(Boolean, nullable=False, server_default='False')
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    expires_at = Column(DateTime(timezone=True), nullable=True)

    company = relationship("Company")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    actor_user_id = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    action = Column(String(255), nullable=False)
    target_type = Column(String(100), nullable=True)
    target_id = Column(String(100), nullable=True)
    meta = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class EmailJob(Base):
    """Durable outbound-email queue. Every email is enqueued (status='pending')
    and delivered by a background worker with retry/backoff; exhausted jobs go
    to a 'dead' terminal state. Decouples sending from the request and survives
    restarts (unlike FastAPI BackgroundTasks)."""
    __tablename__ = "email_jobs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    to_email = Column(String(320), nullable=False)
    subject = Column(String(998), nullable=False)
    html = Column(Text, nullable=False)
    kind = Column(String(50), nullable=True)  # e.g. 'signup_otp', 'invite' — for metrics/logging
    status = Column(String(20), nullable=False, server_default='pending')  # pending | sent | dead
    attempts = Column(Integer, nullable=False, server_default='0')
    max_attempts = Column(Integer, nullable=False, server_default='5')
    last_error = Column(Text, nullable=True)
    next_attempt_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    sent_at = Column(DateTime(timezone=True), nullable=True)
    meta = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        CheckConstraint("status IN ('pending','sent','dead')", name='email_jobs_status_chk'),
    )


class PushJob(Base):
    """Durable outbound push-notification queue. Mirrors EmailJob: every Expo
    push is enqueued as a row and delivered by a background worker with
    retry/backoff, so notification fan-out never makes a synchronous Expo call
    on the request thread (and pushes survive a restart, unlike BackgroundTasks)."""
    __tablename__ = "push_jobs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    to_token = Column(String(255), nullable=False)
    title = Column(String(255), nullable=False)
    body = Column(Text, nullable=False)
    data = Column(JSONB, nullable=True)
    kind = Column(String(50), nullable=True)  # notification_type — for metrics/logging
    status = Column(String(20), nullable=False, server_default='pending')  # pending | sent | dead
    attempts = Column(Integer, nullable=False, server_default='0')
    max_attempts = Column(Integer, nullable=False, server_default='5')
    last_error = Column(Text, nullable=True)
    next_attempt_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    sent_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        CheckConstraint("status IN ('pending','sent','dead')", name='push_jobs_status_chk'),
    )


class StepUpToken(Base):
    """M7: opaque single-use 2FA token issued after a successful OTP
    challenge. Required for high-stakes endpoints (payroll finalize) so a
    fresh re-auth is needed before money is disbursed.
    """
    __tablename__ = "step_up_tokens"

    token = Column(String(80), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    purpose = Column(String(60), nullable=False)  # e.g. 'payroll_finalize'
    issued_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    expires_at = Column(DateTime(timezone=True), nullable=False)
    consumed_at = Column(DateTime(timezone=True), nullable=True)


class IdempotencyKey(Base):
    """M6: idempotency cache. PK is (key, method, path) so the same client
    key may be reused across different endpoints without conflict.

    Read/written exclusively by core/idempotency.py middleware. A 24h
    retention cron (jobs/idempotency_cleanup.py — TODO) purges old rows.
    """
    __tablename__ = "idempotency_keys"

    key = Column(String(80), primary_key=True)
    method = Column(String(10), primary_key=True)
    path = Column(String(500), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    request_hash = Column(String(64), nullable=False)
    response_status = Column(Integer, nullable=True)
    response_body = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class Department(Base):
    __tablename__ = "departments"

    department_id = Column(Integer, primary_key=True, autoincrement=True)
    company_id = Column(Integer, ForeignKey("companies.company_id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    company = relationship("Company")
    private_users = relationship("PrivateUser", back_populates="department")


class Job(Base) :
    __tablename__ = "jobs"

    job_id = Column(Integer, primary_key=True, autoincrement=True)
    private_user_id = Column(Integer, ForeignKey("private_users.private_user_id", ondelete="SET NULL"), nullable=False)
    company_id = Column(Integer, ForeignKey("companies.company_id", ondelete="SET NULL"), nullable=True)
    job_title= Column(String)
    employer_name= Column(String)
    employer_brn= Column(String)
    # NOT unique: every employee at a company shares that company's employer
    # email, so a unique constraint here blocks the 2nd hire (see migration
    # drop_job_empemail_uniq_20260703). Indexed for lookup only.
    employer_email= Column(String, index=True,  nullable=True)
    employer_phone= Column(String, nullable=True)
    employer_address= Column(String, nullable=True)
    first_date_of_employment =  Column(DateTime)
    work_start_time = Column(Time)
    work_end_time = Column(Time)
    work_days = Column(JSONB, nullable=False)
    has_contract = Column(Boolean, nullable=False, server_default='False')
    has_permission_to_work = Column(Boolean, nullable=False, server_default='False')
    work_permit_type = Column(String)
    working_on_tourist_visa = Column(Boolean, nullable=False, server_default='False')
    is_salary_deducted = Column(Boolean, nullable=False, server_default='False')
    reason_for_deduction =Column(JSONB, nullable=True)
    is_accommodation_covered_by_employer = Column(Boolean, nullable=False, server_default='False')
    is_accommodation_a_dormitory = Column(Boolean, nullable=False, server_default='False')
    is_accommodation_decent = Column(Boolean, nullable=False, server_default='False')
    is_passport_retained = Column(Boolean, nullable=False, server_default='False')
    is_job_execution_same_as_description = Column(Boolean, nullable=False, server_default='False')
    doubts_about_compensation =  Column(Boolean, nullable=False, server_default='False')
    auto_clockin_enabled = Column(Boolean, nullable=False, server_default='False')
    minimum_break_minutes = Column(Integer, nullable=True)
    # M20 — termination support for joiner/leaver pro-rata
    end_date = Column(Date, nullable=True)
    termination_reason = Column(String, nullable=True)
    # Overtime engine inputs (see backend/OVERTIME.md).
    #   overtime_eligibility: 'HOURLY' | 'MONTHLY_ELIGIBLE' | 'EXEMPT'.
    #   weekly_rest_day_dow: ISO 1=Mon … 7=Sun. The worker's weekly rest day.
    #   contracted_hours_per_week: NULL → use country statutory threshold.
    overtime_eligibility = Column(String(20), nullable=False, server_default='HOURLY')
    weekly_rest_day_dow = Column(SmallInteger, nullable=False, server_default='7')
    contracted_hours_per_week = Column(Numeric(5, 2), nullable=True)
    verification_status = Column(String, nullable=False, server_default='pending')  # pending, approved, rejected
    verified_at = Column(DateTime, nullable=True)
    verified_by = Column(String, nullable=True)  # Who verified the employee
    rejection_reason = Column(String, nullable=True)
    # M26 — per-job override for the missed-clockout auto-close chain
    # (Job → PrivateUser → Company → 12h). A delivery driver job might be 6h;
    # a security/night-watch job 14h. NULL means "fall through to
    # PrivateUser.max_shift_hours".
    max_shift_hours = Column(Numeric(4, 2), nullable=True)
    created_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, nullable=True)

    # New: link job to a department (nullable) — a job can belong to a department within the company
    department_id = Column(Integer, ForeignKey("departments.department_id", ondelete="SET NULL"), nullable=True)

      # Relationships
    private_user = relationship("PrivateUser", back_populates="jobs")
    company = relationship("Company", back_populates="jobs")
    salaries = relationship("Salary", back_populates="job")
    time_logs = relationship("TimeLog", back_populates="job")
    department = relationship("Department")

class JobHistory(Base):
    __tablename__ = "job_history"

    history_id = Column(Integer, primary_key=True, autoincrement=True)
    job_id = Column(Integer, ForeignKey("jobs.job_id", ondelete="CASCADE"), nullable=False)
    private_user_id = Column(Integer, ForeignKey("private_users.private_user_id", ondelete="SET NULL"), nullable=False)
    company_id = Column(Integer, ForeignKey("companies.company_id", ondelete="SET NULL"), nullable=True)
    job_title = Column(String)
    employer_name = Column(String)
    employer_brn = Column(String)
    employer_email = Column(String, nullable=True)
    employer_phone = Column(String, nullable=True)
    employer_address = Column(String, nullable=True)
    first_date_of_employment = Column(DateTime)
    work_start_time = Column(Time)
    work_end_time = Column(Time)
    work_days = Column(JSONB, nullable=False)
    has_contract = Column(Boolean, nullable=False)
    has_permission_to_work = Column(Boolean, nullable=False)
    work_permit_type = Column(String)
    working_on_tourist_visa = Column(Boolean, nullable=False)
    is_salary_deducted = Column(Boolean, nullable=False)
    reason_for_deduction = Column(JSONB, nullable=True)
    is_accommodation_covered_by_employer = Column(Boolean, nullable=False)
    is_accommodation_a_dormitory = Column(Boolean, nullable=False)
    is_accommodation_decent = Column(Boolean, nullable=False)
    is_passport_retained = Column(Boolean, nullable=False)
    is_job_execution_same_as_description = Column(Boolean, nullable=False)
    doubts_about_compensation = Column(Boolean, nullable=False)
    change_reason = Column(String, nullable=True)  # Why the job was updated
    changed_by = Column(String, nullable=True)     # Who made the change
    change_timestamp = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    original_created_at = Column(DateTime(timezone=True), nullable=True)
    original_updated_at = Column(DateTime, nullable=True)

    # Relationships
    job = relationship("Job", backref=backref("job_history", cascade="all, delete-orphan"))
    private_user = relationship("PrivateUser", back_populates="job_history")
    company = relationship("Company", back_populates="job_history")

class Salary(Base) :
    __tablename__ = "salaries"

    salary_id = Column(Integer, primary_key=True, autoincrement=True)
    job_id = Column(Integer, ForeignKey("jobs.job_id", ondelete="CASCADE"), nullable=False)
    # RLS tenant-scoping column (rls_april_tables_fix migration), denormalized
    # from the job. The DB enforces NOT NULL and a BEFORE-INSERT trigger fills it
    # from the job — but that trigger is MISSING on the create_all-bootstrapped
    # prod schema, so onboarding's INSERT wrote NULL and 500'd. We now map the
    # column and populate it in the app on every salary insert (see create_salary
    # / the importer) so we never depend on the trigger. nullable in the ORM
    # (the DB owns the NOT NULL); always set explicitly.
    company_id = Column(Integer, ForeignKey("companies.company_id", ondelete="CASCADE"), nullable=True, index=True)
    monthly_hours = Column(String)
    break_in_minutes_per_day = Column(Integer)
    days_of_work_per_month = Column(Integer)
    currency = Column(String(3), default="MUR")
    salary = Column(Numeric(14, 2))
    revenue = Column(Numeric(14, 2))
    allowance = Column(Numeric(14, 2))
    # M20 — pay basis controls how the engine computes basic pay
    pay_basis = Column(String(10), nullable=False, server_default='monthly')
    hourly_rate = Column(Numeric(10, 2), nullable=True)
    daily_rate = Column(Numeric(10, 2), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    job = relationship("Job", back_populates="salaries")

# TimeLogs table to track work hours
class TimeLog(Base):
    __tablename__ = "time_logs"

    timelog_id = Column(Integer, primary_key=True, autoincrement=True)
    job_id = Column(Integer, ForeignKey("jobs.job_id", ondelete="CASCADE"), nullable=False)
    private_user_id = Column(Integer, ForeignKey("private_users.private_user_id", ondelete="CASCADE"), nullable=False)
    day_of_week = Column(String)
    start_time = Column(DateTime(timezone=True), nullable=True)
    end_time = Column(DateTime(timezone=True), nullable=True)
    location = Column(JSONB, nullable=False)
    hours_worked = Column(Numeric(5, 2), nullable=True)
    
    # Overtime tracking
    is_overtime = Column(Boolean, default=False, server_default='False')
    overtime_confirmed_by_employer = Column(Boolean, default=False, server_default='False')
    overtime_rejected = Column(Boolean, default=False, server_default='False')
    marked_as_overtime_at = Column(DateTime(timezone=True), nullable=True)
    # Employee's optional explanation, captured on mobile when marking the
    # session as overtime — mirrors late_reason below.
    overtime_reason = Column(String, nullable=True)

    # M3: admin review gate. When Company.require_approved_clockins_for_payroll
    # is true, only logs with admin_approved=true feed the proration sum.
    # The migration backfills existing rows to true so flipping the company
    # flag doesn't silently zero out historical hours.
    admin_approved = Column(Boolean, nullable=False, server_default='False')
    admin_approved_at = Column(DateTime(timezone=True), nullable=True)
    admin_approved_by_user_id = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    admin_rejected = Column(Boolean, nullable=False, server_default='False')
    admin_rejected_at = Column(DateTime(timezone=True), nullable=True)
    admin_rejected_by_user_id = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    admin_rejected_reason = Column(String, nullable=True)

    # M26 — provenance for fast-track approval filtering. Existing rows
    # backfilled to 'mobile'; constraint enforces the four-value enum.
    created_source = Column(String(16), nullable=False, server_default='mobile')
    # M26 — flipped true when TimeLogService.cleanup_active_time_logs closes
    # a session via the resolved max-shift-hours cap. Distinguishes a
    # missed-clockout closure from a real one in the dispute flow.
    auto_closed = Column(Boolean, nullable=False, server_default='false')

    # v1.7 — buddy-punching deterrents (no biometric hardware required).
    # kiosk_photo_path: relative path under backend/uploads/ to the
    # selfie captured at clock-in; served at /uploads/<path>. NULL when
    # the kiosk couldn't capture (no camera, denied permission, or this
    # row didn't come from a kiosk).
    # out_of_schedule: true when start_time fell outside the job's
    # configured work-hours window (with grace). Admin reviews
    # exceptions in the time-logs surface.
    kiosk_photo_path = Column(String(255), nullable=True)
    out_of_schedule = Column(Boolean, nullable=False, server_default='false')
    # Schedule-aware clock-in: is_late = clocked in AFTER the shift start
    # (beyond grace) but still within the shift — i.e. a late START, not
    # off-hours overtime (which is out_of_schedule). late_reason is the
    # employee's optional explanation captured at clock-in.
    is_late = Column(Boolean, nullable=False, server_default='false')
    late_reason = Column(String, nullable=True)

    # Geofencing v3 — location-based enforcement result. out_of_geofence is
    # true when the punch was recorded while the device position fell outside
    # every active fence (flag mode), or when the fix was unverifiable
    # (poor accuracy / mock detected). geofence_check_json is the per-punch
    # audit pack: fence, distance, mode, accuracy, provider, mock flag,
    # device/OS/app/IP — so admins and auditors can verify every decision.
    out_of_geofence = Column(Boolean, nullable=False, server_default='false')
    geofence_check_json = Column(JSONB, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    job = relationship("Job", back_populates="time_logs")
    private_user = relationship("PrivateUser", back_populates="time_logs")
    breaks = relationship("BreakLog", back_populates="time_log", cascade="all, delete-orphan")
    dispute = relationship(
        "TimeLogDispute",
        back_populates="time_log",
        cascade="all, delete-orphan",
        uselist=False,
    )


class TimeLogDispute(Base):
    """An employee's dispute against an admin's rejection of their clock-in.

    Created via POST /time-logs/{id}/dispute by the employee. Admins resolve
    via /dispute/resolve — either approve (the underlying log flips back to
    admin_approved=true) or uphold the rejection. Payroll engine refuses
    to finalize a run that contains any unresolved disputes.
    """
    __tablename__ = "time_log_disputes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    time_log_id = Column(
        Integer,
        ForeignKey("time_logs.timelog_id", ondelete="CASCADE"),
        nullable=False,
        unique=True,  # One open dispute per log; resolved disputes stay for audit.
        index=True,
    )
    employee_user_id = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    employee_comment = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    # Resolution: 'pending' | 'approved' | 'rejection_upheld'
    resolution = Column(String(32), nullable=False, server_default="'pending'")
    admin_response = Column(String, nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    resolved_by_user_id = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)

    time_log = relationship("TimeLog", back_populates="dispute")

class Notification(Base):
    """A notification EVENT. Recipients live in `notification_recipients` with
    per-user read state. The legacy single-recipient columns (`user_id`,
    `is_read`) are retained nullable during the transition — new events leave
    them NULL and the recipient join is the source of truth; they are dropped
    in a follow-up once soaked."""
    __tablename__ = "notifications"

    notification_id = Column(Integer, primary_key=True, autoincrement=True)
    # Legacy single-recipient columns — nullable during transition (see docstring).
    user_id = Column(Integer, ForeignKey("users.user_id", ondelete="CASCADE"), nullable=True)
    is_read = Column(Boolean, default=False, server_default='False', nullable=True)
    # Optional company context for the event (analytics / scoping).
    company_id = Column(Integer, ForeignKey("companies.company_id", ondelete="CASCADE"), nullable=True)
    title = Column(String(255), nullable=False)
    message = Column(String, nullable=False)
    type = Column(String(50), nullable=False)  # e.g., 'clock_out_reminder', 'overtime_warning'
    meta = Column(JSONB, nullable=True) # e.g., {"timelog_id": 123}
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", backref=backref("notifications", cascade="all, delete-orphan"))
    recipients = relationship(
        "NotificationRecipient", back_populates="notification",
        cascade="all, delete-orphan",
    )


class NotificationRecipient(Base):
    """One row per (notification event, recipient user), carrying that user's
    own read state. The normalized replacement for Notification.user_id/is_read,
    so fan-out is one event + N light rows instead of N duplicated events."""
    __tablename__ = "notification_recipients"

    id = Column(Integer, primary_key=True, autoincrement=True)
    notification_id = Column(Integer, ForeignKey("notifications.notification_id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    is_read = Column(Boolean, default=False, server_default='false', nullable=False)
    read_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    notification = relationship("Notification", back_populates="recipients")

    __table_args__ = (
        UniqueConstraint("notification_id", "user_id", name="uq_notification_recipient"),
        Index("ix_notification_recipients_user_unread", "user_id", "is_read"),
    )


class NotificationPreference(Base):
    """Per-user, per-category delivery preferences. A missing row means BOTH
    channels are on (opt-out model). Categories are derived from notification
    type (leave / overtime / attendance / compliance / disputes / general)."""
    __tablename__ = "notification_preferences"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    category = Column(String(40), nullable=False)
    in_app = Column(Boolean, nullable=False, server_default='true')
    push = Column(Boolean, nullable=False, server_default='true')

    __table_args__ = (
        UniqueConstraint("user_id", "category", name="uq_notification_pref"),
    )


# ── Sponsored Content (employer announcements + in-app ads) ────────────
# Unified table backing both user-facing concepts. Per-kind invariants are
# enforced by CHECK constraints in the migration; serializers re-enforce them
# before insert. See SPONSORED_CONTENT_PLAN.md.
class SponsoredContent(Base):
    __tablename__ = "sponsored_content"

    sponsored_content_id = Column(Integer, primary_key=True, autoincrement=True)
    kind = Column(String(20), nullable=False)  # 'employer' | 'ad' | 'house'
    funding_company_id = Column(
        Integer,
        ForeignKey("companies.company_id", ondelete="CASCADE"),
        nullable=True,
    )
    title = Column(String(255), nullable=False)
    body = Column(Text, nullable=False)
    image_url = Column(String, nullable=True)
    cta_label = Column(String(100), nullable=True)
    cta_url = Column(String, nullable=True)
    current_version_id = Column(
        Integer,
        ForeignKey("sponsored_content_versions.version_id", ondelete="SET NULL"),
        nullable=True,
    )
    status = Column(String(20), nullable=False, server_default="draft")
    surfaces = Column(JSONB, nullable=False)
    targeting = Column(JSONB, nullable=False)
    start_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    end_at = Column(DateTime(timezone=True), nullable=True)
    base_priority = Column(Integer, nullable=False, server_default="50")
    paid_amount_cents = Column(Integer, nullable=True)
    paid_currency = Column(String(3), nullable=True)
    payment_notes = Column(Text, nullable=True)
    # M18 — display attribution for `kind='house'` slots sold to external
    # advertisers who are NOT on-platform Companies. When set, the mobile
    # SponsoredCard renders "from {external_advertiser_name}" instead of
    # the hardcoded "from Kiruko" fallback. Null on Kiruko first-party
    # house cards. Distinct from funding_company_id (which references an
    # on-platform Company row used for kind='ad'/'employer' attribution
    # + targeting).
    external_advertiser_name = Column(String(255), nullable=True)
    variant_group = Column(String(36), nullable=True)
    variant_label = Column(String(10), nullable=True)
    view_count = Column(Integer, nullable=False, server_default="0")
    click_count = Column(Integer, nullable=False, server_default="0")
    created_by_user_id = Column(
        Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    updated_by_user_id = Column(
        Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    funding_company = relationship("Company", foreign_keys=[funding_company_id])
    current_version = relationship(
        "SponsoredContentVersion",
        foreign_keys=[current_version_id],
        post_update=True,
    )
    versions = relationship(
        "SponsoredContentVersion",
        back_populates="content",
        foreign_keys="SponsoredContentVersion.sponsored_content_id",
        cascade="all, delete-orphan",
    )


class SponsoredContentVersion(Base):
    __tablename__ = "sponsored_content_versions"

    version_id = Column(Integer, primary_key=True, autoincrement=True)
    sponsored_content_id = Column(
        Integer,
        ForeignKey("sponsored_content.sponsored_content_id", ondelete="CASCADE"),
        nullable=False,
    )
    version_number = Column(Integer, nullable=False)
    title = Column(String(255), nullable=False)
    body = Column(Text, nullable=False)
    image_url = Column(String, nullable=True)
    cta_label = Column(String(100), nullable=True)
    cta_url = Column(String, nullable=True)
    created_by_user_id = Column(
        Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "sponsored_content_id",
            "version_number",
            name="uq_sponsored_content_versions_content_number",
        ),
    )

    content = relationship(
        "SponsoredContent",
        back_populates="versions",
        foreign_keys=[sponsored_content_id],
    )


class SponsoredContentView(Base):
    __tablename__ = "sponsored_content_views"

    view_id = Column(Integer, primary_key=True, autoincrement=True)
    sponsored_content_id = Column(
        Integer,
        ForeignKey("sponsored_content.sponsored_content_id", ondelete="CASCADE"),
        nullable=False,
    )
    version_id = Column(
        Integer,
        ForeignKey("sponsored_content_versions.version_id", ondelete="CASCADE"),
        nullable=False,
    )
    private_user_id = Column(
        Integer,
        ForeignKey("private_users.private_user_id", ondelete="CASCADE"),
        nullable=False,
    )
    kind = Column(String(20), nullable=False)
    surface = Column(String(32), nullable=False)
    view_token = Column(String(36), nullable=False)
    viewed_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "sponsored_content_id",
            "private_user_id",
            "view_token",
            name="uq_sponsored_content_views_idempotency",
        ),
    )


class SponsoredContentClick(Base):
    __tablename__ = "sponsored_content_clicks"

    click_id = Column(Integer, primary_key=True, autoincrement=True)
    sponsored_content_id = Column(
        Integer,
        ForeignKey("sponsored_content.sponsored_content_id", ondelete="CASCADE"),
        nullable=False,
    )
    version_id = Column(
        Integer,
        ForeignKey("sponsored_content_versions.version_id", ondelete="CASCADE"),
        nullable=False,
    )
    private_user_id = Column(
        Integer,
        ForeignKey("private_users.private_user_id", ondelete="CASCADE"),
        nullable=False,
    )
    kind = Column(String(20), nullable=False)
    click_token = Column(String(36), nullable=False)
    clicked_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "sponsored_content_id",
            "private_user_id",
            "click_token",
            name="uq_sponsored_content_clicks_idempotency",
        ),
    )


class SponsoredContentDismissal(Base):
    __tablename__ = "sponsored_content_dismissals"

    dismissal_id = Column(Integer, primary_key=True, autoincrement=True)
    sponsored_content_id = Column(
        Integer,
        ForeignKey("sponsored_content.sponsored_content_id", ondelete="CASCADE"),
        nullable=False,
    )
    private_user_id = Column(
        Integer,
        ForeignKey("private_users.private_user_id", ondelete="CASCADE"),
        nullable=False,
    )
    kind = Column(String(20), nullable=False)
    surface = Column(String(32), nullable=False)
    dismissed_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class BreakLog(Base):
    __tablename__ = "break_logs"
    break_id = Column(Integer, primary_key=True, autoincrement=True)
    timelog_id = Column(Integer, ForeignKey("time_logs.timelog_id", ondelete="CASCADE"), nullable=False)
    start_time = Column(DateTime(timezone=True), nullable=False)
    end_time = Column(DateTime(timezone=True), nullable=True)

    time_log = relationship("TimeLog", back_populates="breaks")

class UserRight(Base):
    __tablename__ = "user_rights"

    right_id = Column(Integer, primary_key=True, autoincrement=True)
    private_user_id = Column(Integer, ForeignKey("private_users.private_user_id", ondelete="CASCADE"), nullable=False)
    title = Column(String, nullable=False)
    category = Column(String, nullable=False)
    issue_description = Column(String, nullable=False)
    contact_method = Column(String, nullable=False)
    previous_occurence = Column(Boolean, nullable=True)
    date_of_occurrence = Column(Date, nullable=True)
    time = Column(Time, nullable=True)
    occurrence_description = Column(String, nullable=True)
    urgency_level = Column(String, nullable=False)
    resolution_method = Column(String, nullable=True)
    accept_terms_and_conditions = Column(Boolean, nullable=False)
    acknowledge_information = Column(Boolean, nullable=False)
    agreed_to_be_contacted = Column(Boolean, nullable=False)
    status = Column(String, nullable=False)
    expected_outcome = Column(String, nullable=False)
    attachment_url = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Channel: "internal" (employer sees it) | "external" (mediator/embassy — employer never sees content)
    channel = Column(String(20), nullable=False, server_default="internal")

    # Plan Phase 11 Step 6 — anonymity opt-in. When True, company-side reads
    # mask the employee's identity (first_name, last_name, private_user_id).
    # Compliance officers and platform admins still see full identity for
    # follow-up and legal record-keeping.
    is_anonymous = Column(Boolean, nullable=False, server_default="false")

    # Internal dispute workflow fields
    assigned_to = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    internal_notes = Column(Text, nullable=True)
    resolution = Column(Text, nullable=True)
    closed_at = Column(DateTime(timezone=True), nullable=True)
    closed_by = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)

    # Optional link to the payroll run / payslip this concern is about. Set when
    # an employee raises a query from a payslip ("Raise a query" → disputes) so
    # the employer can jump straight to the run and reconcile it. SET NULL on
    # delete — the concern survives a voided run / removed payslip.
    payroll_run_id = Column(Integer, ForeignKey("payroll_runs.id", ondelete="SET NULL"), nullable=True, index=True)
    payslip_id = Column(Integer, ForeignKey("payslips.id", ondelete="SET NULL"), nullable=True, index=True)

    # M1 (Concerns v2) — reporter portal: bcrypt hash of the case PIN issued
    # at submission. Plaintext PIN is shown to the reporter ONCE in the API
    # response and never stored.
    case_pin_hash = Column(String(255), nullable=True)

    # M1 — conflict-of-interest gating + auto-escalation. JSON list of
    # {user_id, label} for admins/employees implicated in the report. If any
    # entry matches a target-company admin, POST /user-right auto-sets
    # channel='external' and stamps the escalation columns below.
    named_parties = Column(JSON, nullable=True)
    escalated_to_external_at = Column(DateTime(timezone=True), nullable=True)
    escalated_reason = Column(String(255), nullable=True)

    # M1 — operational stamps. None of these are in the
    # `user_rights_closed_immutable` trigger's reject list, so they remain
    # writeable on closed rows (required: retaliation surveys fire post-close
    # by design).
    acknowledged_at = Column(DateTime(timezone=True), nullable=True)
    last_sla_notified_at = Column(DateTime(timezone=True), nullable=True)
    retention_purge_at = Column(DateTime(timezone=True), nullable=True)
    retaliation_check_30d_at = Column(DateTime(timezone=True), nullable=True)
    retaliation_check_60d_at = Column(DateTime(timezone=True), nullable=True)
    retaliation_check_90d_at = Column(DateTime(timezone=True), nullable=True)

    # M1 — attachment hygiene. PR 4 wires ClamAV + magic-byte sniffing; the
    # columns ship in PR 1 so the response payload doesn't need a follow-up
    # migration when scanning lights up.
    attachment_scanned_at = Column(DateTime(timezone=True), nullable=True)
    attachment_scan_result = Column(String(64), nullable=True)

    # M8 closeout — dedicated triage-dismissal timestamp (originally scoped
    # in plan PR 3 but landed in the M8 audit close-out migration). Stamped
    # when Kiruko dismisses an auto-escalated case back to the employer.
    triage_dismissed_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    assignee = relationship("User", foreign_keys=[assigned_to], backref="assigned_disputes")
    closer = relationship("User", foreign_keys=[closed_by], backref="closed_disputes")
    private_user = relationship("PrivateUser", backref=backref("user_rights", cascade="all, delete-orphan"))


# M1 (Concerns v2) — two-way message thread between reporter and handler.
# Anonymous reporters post via the reporter portal (author_user_id=NULL,
# author_kind='reporter'); employer/Kiruko handlers post via the dashboard.
class ConcernMessage(Base):
    __tablename__ = "concern_messages"

    message_id = Column(Integer, primary_key=True, autoincrement=True)
    right_id = Column(Integer, ForeignKey("user_rights.right_id", ondelete="CASCADE"), nullable=False, index=True)
    author_kind = Column(String(20), nullable=False)  # 'reporter' | 'employer' | 'kontokaz' | 'system'
    author_user_id = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    body = Column(Text, nullable=False)
    attachment_url = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# M1 (Concerns v2) — append-only audit log. Partitioned BY RANGE on
# created_at (monthly partitions). Created via raw SQL in Migration 1.A
# because Alembic's op.create_table doesn't natively express partitioning.
# This SQLAlchemy model is read/write-only against the parent table; routing
# to the right partition is automatic in Postgres ≥ 10.
class ConcernAuditLog(Base):
    __tablename__ = "concern_audit_log"

    audit_id = Column(BigInteger, primary_key=True, autoincrement=True)
    right_id = Column(Integer, ForeignKey("user_rights.right_id", ondelete="CASCADE"), nullable=False, index=True)
    actor_user_id = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    actor_kind = Column(String(20), nullable=False)  # 'reporter' | 'employer' | 'kontokaz' | 'system'
    action = Column(String(64), nullable=False)
    details = Column(JSON, nullable=True)
    ip = Column(String(45), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# M1 (Concerns v2) — captures retaliation-survey responses. Cron in PR 4 sends
# one survey at 30/60/90 days post-closure; this table holds the answers.
class ConcernRetaliationResponse(Base):
    __tablename__ = "concern_retaliation_responses"

    response_id = Column(Integer, primary_key=True, autoincrement=True)
    right_id = Column(Integer, ForeignKey("user_rights.right_id", ondelete="CASCADE"), nullable=False, index=True)
    survey_window = Column(String(8), nullable=False)  # '30d' | '60d' | '90d'
    experienced_retaliation = Column(Boolean, nullable=False)
    details = Column(Text, nullable=True)
    submitted_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Transfer(Base):
    __tablename__ = "transfers"
    private_user_id = Column(Integer, ForeignKey("private_users.private_user_id", ondelete="CASCADE"), nullable=False)
    transfer_id = Column(Integer, primary_key=True, autoincrement=True)
    from_user = Column(String, nullable=False)
    to_user = Column(String, nullable=False)
    amount = Column(Float, nullable=False)
    currency = Column(String(3), default="MUR")
    status = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class Purchase(Base):
    __tablename__ = "purchases"

    purchase_id = Column(Integer, primary_key=True, autoincrement=True)
    private_user_id = Column(Integer, ForeignKey("private_users.private_user_id", ondelete="CASCADE"), nullable=False)
    description = Column(String, nullable=False)
    amount = Column(Float, nullable=False)
    currency = Column(String(3), default="MUR")
    merchant = Column(String, nullable=True)
    category = Column(String, nullable=True)
    payment_method = Column(String, nullable=True)
    items = Column(JSONB, nullable=True) # To store list of {name, price, quantity}
    # URL of the originally-scanned receipt image. LocalStorage paths look
    # like '/uploads/receipts/{private_user_id}/{uuid}.jpg' in dev; absolute
    # https URLs once STORAGE_TYPE is set to s3 / gcs.
    receipt_image_url = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class Subscription(Base):
    __tablename__ = "subscriptions"

    subscription_id = Column(Integer, primary_key=True, autoincrement=True)
    private_user_id = Column(Integer, ForeignKey("private_users.private_user_id", ondelete="CASCADE"), nullable=False)
    description = Column(String, nullable=False)
    amount = Column(Float, nullable=False)
    currency = Column(String(3), default="MUR")
    subscription_date = Column(Date, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Loan(Base):
    __tablename__ = "loans"
    loan_id = Column(Integer, primary_key=True, autoincrement=True)
    private_user_id = Column(Integer, ForeignKey("private_users.private_user_id", ondelete="CASCADE"), nullable=False)
    description = Column(String, nullable=False)
    amount = Column(Float, nullable=False)
    currency = Column(String(3), default="MUR")
    # 'personal' = employee self-tracked (the mobile Expenses tracker) — NOT
    # payroll-deducted. 'employer' = an employer-granted loan / salary advance
    # that payroll repays. Only 'employer' loans are deducted from pay (see
    # payroll_engine._compute/_record_loan_repayments_for_period). Existing rows
    # backfill to 'personal' so no self-tracked loan is ever deducted from pay.
    loan_type = Column(String(20), nullable=False, server_default="personal", default="personal")
    start_date = Column(Date, nullable=True)
    due_date = Column(Date, nullable=True)
    status = Column(String(20), default="active")  # active, paid, overdue
    repaid_amount = Column(Float, default=0.0)
    is_recurrent = Column(Boolean, default=False, server_default='False')
    duration_months = Column(Integer, nullable=True)
    payment_frequency = Column(String(20), nullable=True)  # weekly, biweekly, monthly
    interest_rate = Column(Float, nullable=True)
    lender_name = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    repayments = relationship("Repayment", back_populates="loan")

class Repayment(Base):
    __tablename__ = "repayments"
    repayment_id = Column(Integer, primary_key=True, autoincrement=True)
    loan_id = Column(Integer, ForeignKey("loans.loan_id", ondelete="CASCADE"), nullable=False)
    amount = Column(Float, nullable=False)
    payment_date = Column(Date, nullable=False)
    # The payroll run that booked this repayment, if any. NULL = a manual
    # repayment (db_models/crud/repayment.py). Lets finalize stay idempotent and
    # lets cancel reverse exactly the rows it booked, without a date heuristic.
    payroll_run_id = Column(Integer, ForeignKey("payroll_runs.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    loan = relationship("Loan", back_populates="repayments")


class Schedule(Base):
    __tablename__ = "schedules"

    schedule_id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String, nullable=False)
    company_id = Column(Integer, ForeignKey("companies.company_id", ondelete="CASCADE"), nullable=False)
    location = Column(String, nullable=False)
    hours = Column(String, nullable=True)
    notes = Column(String, nullable=True)
    status = Column(String(20), nullable=False, server_default='pending', default='pending')
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=False)
    # #18/Tasks — optional additional remuneration for additional duty. When set,
    # each assignee earns this amount once the employer VERIFIES their completion
    # (booked as a one-off allowance in the task's month). NULL = unpaid task.
    additional_remuneration_amount = Column(Numeric(14, 2), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    company = relationship("Company", back_populates="schedules")
    assigned_employees = relationship(
        "PrivateUser",
        secondary=schedule_assignments,
        back_populates="schedules"
    )
    # Per-employee completion tracking
    assignee_statuses = relationship(
        "ScheduleAssigneeStatus",
        cascade="all, delete-orphan",
        lazy="selectin"
    )


class ScheduleAssigneeStatus(Base):
    """Tracks each individual employee's completion status on a task/schedule.
    Allows multiple assignees to independently mark started/completed without
    overwriting each other's state. The Schedule.status (global) auto-completes
    when all assignees have marked their own status as 'completed'.
    """
    __tablename__ = "schedule_assignee_statuses"

    schedule_id = Column(Integer, ForeignKey("schedules.schedule_id", ondelete="CASCADE"), primary_key=True)
    private_user_id = Column(Integer, ForeignKey("private_users.private_user_id", ondelete="CASCADE"), primary_key=True)
    status = Column(String(20), nullable=False, server_default='pending', default='pending')
    # Each assignee's own private note/message on the task (employer's shared
    # message lives on schedules.notes). Employer sees it per-employee.
    note = Column(Text, nullable=True)
    # #4 — optional photo the employee attaches as proof of task completion.
    proof_image_url = Column(String, nullable=True)
    # Tasks — the one-off allowance booked when the employer verified THIS
    # assignee's completion. NULL until verified-and-paid; non-null makes
    # re-verification idempotent (we never double-book the same assignee).
    remuneration_one_off_id = Column(
        Integer, ForeignKey("employee_one_off_allowances.id", ondelete="SET NULL"), nullable=True
    )
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class Leave(Base):
    __tablename__ = "leaves"

    leave_id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    private_user_id = Column(Integer, ForeignKey("private_users.private_user_id"), nullable=False)
    leave_type = Column(String, nullable=False)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    status = Column(String, nullable=False, default='pending') # e.g., pending, approved, rejected
    notes = Column(String, nullable=True)
    approved_by = Column(Integer, ForeignKey("users.user_id"), nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)
    rejection_reason = Column(String, nullable=True)
    approver_comments = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Optional FK to leave_types (Module 1). Coexists with the legacy
    # `leave_type` string column during transition; new leave applications
    # should populate this. Reads from this column when set, fall back to
    # the string for legacy rows.
    leave_type_id = Column(Integer, ForeignKey("leave_types.id", ondelete="SET NULL"), nullable=True, index=True)

    private_user = relationship("PrivateUser", back_populates="leaves")
    approver = relationship("User", foreign_keys=[approved_by])
    leave_type_ref = relationship("LeaveType", foreign_keys=[leave_type_id])


class Country(Base):
    """Reference table for countries supported by the platform.

    `code` is the ISO 3166-1 alpha-2 primary key so it is human-readable in
    every FK column, log line, and API response — no integer surrogate needed.
    """
    __tablename__ = "countries"

    code               = Column(String(2), primary_key=True)        # e.g. 'MU'
    name               = Column(String(100), nullable=False)         # e.g. 'Mauritius'
    currency           = Column(String(10), nullable=False)         # ISO 4217, e.g. 'MUR'
    locale             = Column(String(10), nullable=True)          # e.g. 'en-MU'
    fiscal_year_start  = Column(String(5), nullable=True)           # 'MM-DD', e.g. '07-01'
    date_format        = Column(String(20), nullable=True)          # e.g. 'DD/MM/YYYY'
    min_wage           = Column(Numeric(12, 2), nullable=True)       # minimum monthly wage
    default_timezone   = Column(String(60), nullable=True)          # IANA tz, e.g. 'Indian/Mauritius'
    is_active          = Column(Boolean, nullable=False, server_default='true')
    created_at         = Column(DateTime(timezone=True), server_default=func.now())
    updated_at         = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    sectors = relationship("Sector", back_populates="country")


class EmployeeCountryAssignment(Base):
    """Effective-dated country change for an employee: a **mission** (temporary
    work abroad, same employer) or a **transfer** (permanent move — within the
    same company or to a different one).

    Mirrors the proven ``EmployeeSalaryAssignment`` pattern (effective windows,
    supersede-on-create, audit trail) so the resolution precedence is uniform
    across the platform. Phase 1 is display/currency-only: this table feeds
    ``PrivateUser.effective_country_code`` and employee-detail UI. The payroll
    engine is NOT country-assignment-aware yet (Phase 2, gated).

    ``reason`` is one of:
      * ``mission``                — temporary work abroad, same employer.
      * ``transfer_same_company``  — permanent move, still the same company.
      * ``transfer_new_company``   — permanent move to a different company;
                                     requires ``new_company_id``.
    """
    __tablename__ = "employee_country_assignments"
    __table_args__ = (
        # At most one OPEN (un-ended, un-archived) assignment per employee.
        Index(
            "uq_employee_country_open_assignments",
            "private_user_id",
            unique=True,
            postgresql_where=text("effective_to IS NULL AND archived_at IS NULL"),
        ),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    private_user_id = Column(Integer, ForeignKey("private_users.private_user_id", ondelete="CASCADE"), nullable=False, index=True)
    country_code = Column(String(2), ForeignKey("countries.code"), nullable=False)
    reason = Column(String(32), nullable=False)  # mission | transfer_same_company | transfer_new_company
    effective_from = Column(Date, nullable=False)
    effective_to = Column(Date, nullable=True)  # NULL = open-ended
    new_company_id = Column(Integer, ForeignKey("companies.company_id", ondelete="SET NULL"), nullable=True)
    notes = Column(Text, nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    archived_at = Column(DateTime(timezone=True), nullable=True)  # soft delete for audit

    private_user = relationship("PrivateUser", back_populates="country_locations")
    country = relationship("Country")
    new_company = relationship("Company")
    created_by = relationship("User")


class Sector(Base):
    __tablename__ = "sectors"
    __table_args__ = (
        # (name, country_code) must be unique — allows same sector name across countries
        UniqueConstraint('name', 'country_code', name='uq_sector_name_country'),
    )

    sector_id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    # ISO 3166-1 alpha-2 country code — FK to countries.code
    country_code = Column(String(2), ForeignKey("countries.code"), nullable=False, server_default='MU')
    # Convenience currency field (mirrors countries.currency); kept for denormalised reads
    currency = Column(String(10), nullable=False, server_default='MUR')
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    # Relationships
    country = relationship("Country", back_populates="sectors")
    categories = relationship("SectorCategory", back_populates="sector", cascade="all, delete-orphan")
    grades = relationship("SectorGrade", back_populates="sector", cascade="all, delete-orphan")

    # Compatibility properties for Pydantic/response schemas expecting `id` and `activity`
    @property
    def id(self) -> int:
        return self.sector_id

    @property
    def activity(self) -> str:
        return self.name


class SectorCategory(Base):
    __tablename__ = "sector_categories"

    id = Column(Integer, primary_key=True, autoincrement=True)
    sector_id = Column(Integer, ForeignKey("sectors.sector_id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    currency = Column(String(3), default="MUR")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    sector = relationship("Sector", back_populates="categories")
    grades = relationship("SectorGrade", back_populates="sector_category", cascade="all, delete-orphan")
    salary_ranges = relationship("SectorCategorySalary", back_populates="sector_category", cascade="all, delete-orphan")


class SectorGrade(Base):
    __tablename__ = "sector_grades"

    id = Column(Integer, primary_key=True, autoincrement=True)
    sector_id = Column(Integer, ForeignKey("sectors.sector_id", ondelete="CASCADE"), nullable=False)
    sector_category_id = Column(Integer, ForeignKey("sector_categories.id", ondelete="CASCADE"), nullable=False)
    grade = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    sector = relationship("Sector", back_populates="grades")
    sector_category = relationship("SectorCategory", back_populates="grades")
    salary_ranges = relationship("SectorCategorySalary", back_populates="sector_grade", cascade="all, delete-orphan")


class SectorCategorySalary(Base):
    __tablename__ = "sector_category_salaries"

    id = Column(Integer, primary_key=True, autoincrement=True)
    sector_category_id = Column(Integer, ForeignKey("sector_categories.id", ondelete="CASCADE"), nullable=False)
    # Optional link to the specific grade this salary range applies to (None = applies to all grades)
    sector_grade_id = Column(Integer, ForeignKey("sector_grades.id", ondelete="SET NULL"), nullable=True)
    min_years_of_service = Column(Integer, nullable=True)
    max_years_of_service = Column(Integer, nullable=True)
    # Date from which this rate is effective. NULL = always valid.
    # The calculator uses: WHERE effective_from <= CURRENT_DATE ORDER BY effective_from DESC
    # Pre-load future rates safely — they are invisible until their date arrives.
    effective_from = Column(Date, nullable=True)
    basic_monthly_salary = Column(Numeric(12, 2), nullable=True)
    basic_daily_salary = Column(Numeric(12, 2), nullable=True)
    hourly_rate = Column(Numeric(12, 2), nullable=True)
    productivity = Column(Numeric(12, 2), nullable=True)  # Normalized to Rs/kg
    unit = Column(String, nullable=True)  # e.g., 'per_kg', 'per_lb', 'daily', 'hourly', 'unknown'
    notes = Column(String, nullable=True)
    # Append-only correction path (plan Phase 3.A): voided rows are excluded
    # from the active-version partial unique index and from calculator reads,
    # but stay readable in history. NEVER UPDATE the rate/date columns of an
    # existing row — append a new row with the correction.
    voided_at = Column(DateTime(timezone=True), nullable=True)
    voided_by_user_id = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    voided_reason = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    sector_category = relationship("SectorCategory", back_populates="salary_ranges")
    sector_grade = relationship("SectorGrade", back_populates="salary_ranges")


class RequestLog(Base):
    __tablename__ = "request_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    platform = Column(String(50), nullable=True)
    user_agent = Column(String(500), nullable=True)
    ip_address = Column(String(50), nullable=True)
    method = Column(String(10), nullable=True)
    path = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User")


class VerificationToken(Base):
    """Persisted OTP store for both signup verification and password reset.
    Replaces the previous in-memory dicts so tokens survive server restarts
    and multi-worker deployments."""
    __tablename__ = "verification_tokens"

    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String, nullable=False, index=True)
    # 'signup' | 'password_reset'
    token_type = Column(String(20), nullable=False, default='signup')
    otp_hash = Column(String, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Rent(Base):
    __tablename__ = "rents"

    rent_id = Column(Integer, primary_key=True, autoincrement=True)
    private_user_id = Column(Integer, ForeignKey("private_users.private_user_id", ondelete="CASCADE"), nullable=False)
    description = Column(String, nullable=False)
    amount = Column(Float, nullable=False)
    currency = Column(String(3), default="MUR")
    landlord_name = Column(String, nullable=True)
    property_address = Column(String, nullable=True)
    due_day = Column(Integer, nullable=True)  # day of month rent is due (1-31)
    is_recurring = Column(Boolean, default=True, server_default='True')
    status = Column(String(20), default="active")  # active, paid, overdue
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class LeaveType(Base):
    """Per-company catalog of leave types (annual, sick, etc.).

    Optionally linked to a country_leave_defaults row via
    `country_default_id` so admins can reset/seed from country statutory
    defaults. Custom company-defined leave types leave that FK NULL.
    """
    __tablename__ = "leave_types"

    id = Column(Integer, primary_key=True, autoincrement=True)
    company_id = Column(Integer, ForeignKey("companies.company_id", ondelete="CASCADE"), nullable=False, index=True)
    code = Column(String(40), nullable=False)  # 'annual', 'sick', 'unpaid_personal', etc.
    label = Column(String(100), nullable=False)
    is_paid = Column(Boolean, nullable=False, server_default="true")
    is_statutory = Column(Boolean, nullable=False, server_default="false")
    accrual_method = Column(String(20), nullable=False, server_default="annual")  # monthly | annual | tenure_based
    accrual_rate_days_per_month = Column(Numeric(5, 3), nullable=True)
    days_per_year = Column(Integer, nullable=True)
    max_balance = Column(Integer, nullable=True)
    carry_forward_max = Column(Integer, nullable=True)
    encashable = Column(Boolean, nullable=False, server_default="false")
    min_service_months = Column(Integer, nullable=False, server_default="0")
    requires_doc = Column(Boolean, nullable=False, server_default="false")
    country_default_id = Column(Integer, ForeignKey("country_leave_defaults.id", ondelete="SET NULL"), nullable=True)
    is_active = Column(Boolean, nullable=False, server_default="true")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    company = relationship("Company")
    country_default = relationship("CountryLeaveDefault")

    __table_args__ = (
        UniqueConstraint("company_id", "code", name="uq_leave_type_company_code"),
    )


class LeaveQuota(Base):
    __tablename__ = "leave_quotas"

    quota_id = Column(Integer, primary_key=True, autoincrement=True)
    private_user_id = Column(Integer, ForeignKey("private_users.private_user_id", ondelete="CASCADE"), nullable=False)
    leave_type = Column(String, nullable=False)  # legacy free-form; superseded by leave_type_id
    # Module 1: nullable FK to the leave_types catalog. New quotas should set this;
    # legacy rows continue to use the string column until backfill.
    leave_type_id = Column(Integer, ForeignKey("leave_types.id", ondelete="SET NULL"), nullable=True, index=True)
    total_days = Column(Integer, nullable=False, default=0)
    used_days = Column(Integer, nullable=False, default=0)
    year = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    leave_type_ref = relationship("LeaveType", foreign_keys=[leave_type_id])

    __table_args__ = (UniqueConstraint('private_user_id', 'leave_type', 'year', name='uq_leave_quota'),)


class BudgetGoal(Base):
    __tablename__ = "budget_goals"

    budget_id = Column(Integer, primary_key=True, autoincrement=True)
    private_user_id = Column(Integer, ForeignKey("private_users.private_user_id", ondelete="CASCADE"), nullable=False)
    category = Column(String, nullable=False)  # rent, groceries, transport, utilities, etc.
    monthly_limit = Column(Float, nullable=False)
    currency = Column(String(3), default="MUR")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (UniqueConstraint('private_user_id', 'category', name='uq_budget_category'),)


class PublicHoliday(Base):
    __tablename__ = "public_holidays"

    holiday_id = Column(Integer, primary_key=True, autoincrement=True)
    country_code = Column(String(3), nullable=False, index=True)
    name = Column(String, nullable=False)
    date = Column(Date, nullable=False)
    # Observed date — for MU's Sunday-to-Monday substitution custom. NULL falls
    # back to `date`. Engine classifies slices against `observed_date`.
    observed_date = Column(Date, nullable=True)
    year = Column(Integer, nullable=False)
    is_recurring = Column(Boolean, default=False, server_default='False')
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class CompanyHolidayRate(Base):
    """Company-scoped public holiday pay rates (distinct from the global PublicHoliday reference table)."""
    __tablename__ = "company_holiday_rates"

    id = Column(Integer, primary_key=True, autoincrement=True)
    company_id = Column(Integer, ForeignKey("companies.company_id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String, nullable=False)
    date = Column(String(10), nullable=False)   # YYYY-MM-DD stored as string for flexibility
    recurrent = Column(Boolean, default=False, server_default='False')
    multiplier = Column(Numeric(4, 2), nullable=False, default=2.0)
    note = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    company = relationship("Company")


class DocumentVault(Base):
    __tablename__ = "document_vault"

    doc_id = Column(Integer, primary_key=True, autoincrement=True)
    private_user_id = Column(Integer, ForeignKey("private_users.private_user_id", ondelete="CASCADE"), nullable=False)
    doc_type = Column(String(50), nullable=False)  # passport, work_permit, contract, pay_stub, id_card, other
    name = Column(String(255), nullable=False)
    expiry_date = Column(String(20), nullable=True)  # YYYY-MM-DD
    notes = Column(String, nullable=True)
    file_url = Column(String, nullable=True)   # S3 or local URL
    file_name = Column(String(255), nullable=True)
    file_mime = Column(String(100), nullable=True)
    # M22 — provenance + access control
    uploaded_by_user_id = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    visibility = Column(String(20), nullable=False, server_default="employer_only")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    private_user = relationship("PrivateUser", backref=backref("vault_docs", cascade="all, delete-orphan"))


class DocumentAccessLog(Base):
    """M22 — audit row written on every read/download/delete of a vault doc.

    `doc_id` is nullable + ON DELETE SET NULL so the audit row outlives the
    underlying document — important for compliance review where 'who deleted
    document X' must remain answerable after the deletion."""
    __tablename__ = "document_access_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    doc_id = Column(Integer, ForeignKey("document_vault.doc_id", ondelete="SET NULL"), nullable=True)
    actor_user_id = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    action = Column(String(20), nullable=False)  # view | list | download | delete | update
    ip = Column(String(45), nullable=True)
    user_agent = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class DocumentExpiryReminder(Base):
    """M22 — produced by jobs/document_expiry.py when a doc is within
    30 days of expiry. UNIQUE on (doc_id, reminder_at) keeps the daily
    cron idempotent."""
    __tablename__ = "document_expiry_reminders"

    id = Column(Integer, primary_key=True, autoincrement=True)
    doc_id = Column(Integer, ForeignKey("document_vault.doc_id", ondelete="CASCADE"), nullable=False)
    reminder_at = Column(Date, nullable=False)
    sent = Column(Boolean, nullable=False, server_default="false")
    channel = Column(String(20), nullable=False, server_default="in_app")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    sent_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("doc_id", "reminder_at", name="uq_doc_reminder"),
    )



class CompanyRole(Base):
    """Custom role definitions per company with a JSONB permissions array."""
    __tablename__ = "company_roles"

    role_id = Column(Integer, primary_key=True, autoincrement=True)
    company_id = Column(Integer, ForeignKey("companies.company_id", ondelete="CASCADE"), nullable=False)
    name = Column(String(100), nullable=False)
    description = Column(String, nullable=True)
    is_system = Column(Boolean, default=False, server_default="false")  # system roles are not deletable
    permissions = Column(JSONB, nullable=False, server_default="[]")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    company = relationship("Company")

    __table_args__ = (
        UniqueConstraint("company_id", "name", name="uq_company_role_name"),
    )


# ---------------------------------------------------------------------------
# Country payroll rules engine — temporal, append-only.
#
# Every legal/compliance rule (tax bands, statutory deductions, leave defaults,
# bonus formulas) is versioned by (effective_from, effective_to). Updates are
# forbidden at the DB level by a Postgres trigger; only `effective_to` and
# `superseded_by_id` may change (set when a successor row is inserted).
# Resolution: pick rows where effective_from <= period AND (effective_to IS
# NULL OR effective_to > period). Payroll runs snapshot the resolved rules
# into a JSONB column on finalize so historical re-runs reproduce byte-for-byte.
# ---------------------------------------------------------------------------


class TaxBracketSet(Base):
    """A versioned set of progressive PAYE-style tax brackets for a country/year.

    Bracket boundaries can change between revisions (e.g. MU could shift the
    0% band from 0-30k to 0-40k), so brackets are children of a versioned
    parent rather than versioned individually.
    """
    __tablename__ = "tax_bracket_sets"

    id = Column(Integer, primary_key=True, autoincrement=True)
    country_code = Column(String(2), ForeignKey("countries.code"), nullable=False, index=True)
    fiscal_year = Column(Integer, nullable=False)
    label = Column(String(100), nullable=True)  # e.g. "MU PAYE 2026"
    # CUMULATIVE_YTD: MU's WRA model — tax computed on cumulative
    # year-to-date taxable income, only the delta over what's already been
    # withheld this fiscal year is deducted each period (see
    # payroll_engine.py's _ytd_paye_state). FLAT_PERIODIC: apply this
    # period's bracket table directly to this period's taxable income,
    # independently, no YTD lookup — Tanzania's TRA model, and the more
    # common shape for future countries. Defaults to MU's existing exact
    # behavior for every current row — zero behavior change on migration.
    tax_computation_mode = Column(String(20), nullable=False, server_default="CUMULATIVE_YTD")

    # Temporal columns
    effective_from = Column(Date, nullable=False)
    effective_to = Column(Date, nullable=True)
    superseded_by_id = Column(Integer, ForeignKey("tax_bracket_sets.id"), nullable=True)
    version = Column(Integer, nullable=False, server_default="1")
    source_reference = Column(String, nullable=True)  # gazette / Finance Act / circular
    change_reason = Column(String, nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    brackets = relationship("TaxBracket", back_populates="bracket_set", cascade="all, delete-orphan", order_by="TaxBracket.order_index")
    successor = relationship("TaxBracketSet", remote_side=[id], foreign_keys=[superseded_by_id])


class TaxBracket(Base):
    """A single progressive bracket inside a TaxBracketSet."""
    __tablename__ = "tax_brackets"

    id = Column(Integer, primary_key=True, autoincrement=True)
    bracket_set_id = Column(Integer, ForeignKey("tax_bracket_sets.id", ondelete="CASCADE"), nullable=False, index=True)
    order_index = Column(Integer, nullable=False)
    lower_bound = Column(Numeric(14, 2), nullable=False)
    upper_bound = Column(Numeric(14, 2), nullable=True)  # NULL = top band, no upper limit
    rate = Column(Numeric(7, 5), nullable=False)  # 0.20000 = 20%
    description = Column(String, nullable=True)

    bracket_set = relationship("TaxBracketSet", back_populates="brackets")


class StatutoryDeduction(Base):
    """Country-level statutory deduction rule (CSG, NSF, NPF, etc.).

    Versioned by (country_code, code). Replacing a rate = close prior row,
    insert new row with version+1.
    """
    __tablename__ = "statutory_deductions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    country_code = Column(String(2), ForeignKey("countries.code"), nullable=False, index=True)
    code = Column(String(40), nullable=False)  # e.g. 'CSG_EE', 'CSG_ER', 'NSF_EE'
    label = Column(String(100), nullable=False)
    rate = Column(Numeric(7, 5), nullable=False)
    threshold_low = Column(Numeric(14, 2), nullable=True)
    threshold_high = Column(Numeric(14, 2), nullable=True)
    taxable_base = Column(String(20), nullable=False, server_default="gross")  # basic | gross | custom
    employer_or_employee = Column(String(20), nullable=False)  # employer | employee
    # When set, this deduction's own computed employee amount is subtracted
    # from bases_by_code[reduces_base_code] (floored at 0) BEFORE that base
    # is used to compute anything else — e.g. Tanzania's NSSF employee
    # contribution reduces the PAYE taxable base. NULL for every existing
    # (MU) row: the base-reduction pass in compute_for_resolved() is an
    # unconditional no-op unless a row opts in, so this cannot change MU's
    # output. Must name a code the earnings side already populates via
    # statutory_base_codes (e.g. "PAYE") — reducing a code nothing feeds is
    # a no-op, not an error.
    reduces_base_code = Column(String(40), nullable=True)
    # Whether an overtime/premium earning's amount feeds this deduction's
    # base, and whether a bonus/EOY earning's amount does. NULL (every
    # existing MU row) means "unspecified" — payroll_rules.
    # default_statutory_base_codes() falls back to a hardcoded legacy
    # heuristic (code name matching) for NULL rows specifically so MU's
    # current behavior (OT excludes NSF-like codes; bonuses are PAYE-only,
    # excluding every StatutoryDeduction code) is preserved byte-for-byte
    # without a data backfill — the append-only trigger forbids UPDATE on
    # existing rows, so backfilling these explicitly requires a proper
    # supersede() follow-up, not a migration. New rows (TZ, future
    # countries) should set both explicitly rather than rely on the
    # fallback.
    applies_to_overtime = Column(Boolean, nullable=True)
    applies_to_bonus = Column(Boolean, nullable=True)

    effective_from = Column(Date, nullable=False)
    effective_to = Column(Date, nullable=True)
    superseded_by_id = Column(Integer, ForeignKey("statutory_deductions.id"), nullable=True)
    version = Column(Integer, nullable=False, server_default="1")
    source_reference = Column(String, nullable=True)
    change_reason = Column(String, nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    successor = relationship("StatutoryDeduction", remote_side=[id], foreign_keys=[superseded_by_id])


class CountryLeaveDefault(Base):
    """Statutory leave entitlement per country, per leave type."""
    __tablename__ = "country_leave_defaults"

    id = Column(Integer, primary_key=True, autoincrement=True)
    country_code = Column(String(2), ForeignKey("countries.code"), nullable=False, index=True)
    leave_type_code = Column(String(40), nullable=False)  # e.g. 'annual', 'sick', 'maternity'
    label = Column(String(100), nullable=False)
    days_per_year = Column(Integer, nullable=False)
    accrual_method = Column(String(20), nullable=False, server_default="annual")  # monthly | annual | tenure_based
    carry_forward_max = Column(Integer, nullable=True)
    encashable = Column(Boolean, nullable=False, server_default="false")
    min_service_months = Column(Integer, nullable=False, server_default="0")
    # Entitlement window in months — e.g. Tanzania's sick leave resets every
    # 36 months, not annually. server_default=12 preserves "days_per_year
    # means annual" for every existing row with zero behavior change.
    cycle_months = Column(Integer, nullable=False, server_default="12")
    # Reduced-pay tail within the entitlement — e.g. Tanzania's sick leave is
    # 63 days full pay + 63 days half pay within the 126-day/36-month total
    # (days_per_year=126, cycle_months=36, reduced_pay_days=63,
    # reduced_pay_rate=0.5). NULL reduced_pay_days (every existing row) means
    # the whole entitlement is at full pay — today's implicit behavior.
    # NOTE: schema only as of 2026-07-16 — no engine logic yet consumes
    # these two fields (leave-taken pay impact still assumes full-pay,
    # annual-cycle entitlements everywhere it's computed). Needed before any
    # leave type actually sets them to something engine-relevant.
    reduced_pay_days = Column(Integer, nullable=True)
    reduced_pay_rate = Column(Numeric(4, 3), nullable=True)

    effective_from = Column(Date, nullable=False)
    effective_to = Column(Date, nullable=True)
    superseded_by_id = Column(Integer, ForeignKey("country_leave_defaults.id"), nullable=True)
    version = Column(Integer, nullable=False, server_default="1")
    source_reference = Column(String, nullable=True)
    change_reason = Column(String, nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    successor = relationship("CountryLeaveDefault", remote_side=[id], foreign_keys=[superseded_by_id])


class CountryBonusRule(Base):
    """Country-level bonus rule (e.g. MU End-of-Year Gratuity, MG 13th month)."""
    __tablename__ = "country_bonus_rules"

    id = Column(Integer, primary_key=True, autoincrement=True)
    country_code = Column(String(2), ForeignKey("countries.code"), nullable=False, index=True)
    bonus_code = Column(String(40), nullable=False)  # e.g. 'EOY_GRATUITY'
    label = Column(String(100), nullable=False)
    formula = Column(String(40), nullable=False)  # twelfth_of_annual | fixed | percent_of_basic | custom
    eligibility_min_service_months = Column(Integer, nullable=False, server_default="0")
    payable_month = Column(Integer, nullable=False)  # 1-12
    prorate_on_partial_year = Column(Boolean, nullable=False, server_default="true")
    taxable = Column(Boolean, nullable=False, server_default="true")
    fixed_amount = Column(Numeric(14, 2), nullable=True)  # for formula='fixed'
    rate = Column(Numeric(7, 5), nullable=True)  # for formula='percent_of_basic'

    effective_from = Column(Date, nullable=False)
    effective_to = Column(Date, nullable=True)
    superseded_by_id = Column(Integer, ForeignKey("country_bonus_rules.id"), nullable=True)
    version = Column(Integer, nullable=False, server_default="1")
    source_reference = Column(String, nullable=True)
    change_reason = Column(String, nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    successor = relationship("CountryBonusRule", remote_side=[id], foreign_keys=[superseded_by_id])


class CountryOvertimeRule(Base):
    """Country-level statutory overtime + premium-pay rule. Append-only
    temporal pattern matching the rest of the rules engine. See
    backend/OVERTIME.md."""
    __tablename__ = "country_overtime_rules"

    id = Column(Integer, primary_key=True, autoincrement=True)
    country_code = Column(String(2), ForeignKey("countries.code"), nullable=False, index=True)

    effective_from = Column(Date, nullable=False)
    effective_to = Column(Date, nullable=True)
    version = Column(Integer, nullable=False, server_default="1")
    superseded_by_id = Column(Integer, ForeignKey("country_overtime_rules.id"), nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    source_reference = Column(String, nullable=True)
    change_reason = Column(String, nullable=True)
    notes = Column(Text, nullable=True)

    # Thresholds
    weekly_threshold_h = Column(Numeric(5, 2), nullable=False)
    daily_threshold_h = Column(Numeric(5, 2), nullable=True)

    # Premium-day multipliers
    rest_day_multiplier = Column(Numeric(3, 2), nullable=False)
    public_holiday_normal_hours_multiplier = Column(Numeric(3, 2), nullable=False)
    public_holiday_after_hours_multiplier = Column(Numeric(3, 2), nullable=False)

    # Night window
    night_start = Column(Time, nullable=True)
    night_end = Column(Time, nullable=True)
    night_multiplier_habitual = Column(Numeric(3, 2), nullable=True)
    night_multiplier_occasional = Column(Numeric(3, 2), nullable=True)
    night_mode = Column(String(10), nullable=True)  # 'ADDITIVE' | 'REPLACE' | NULL

    # Caps (advisory — emit compliance_flags)
    weekly_ot_soft_cap_h = Column(Numeric(5, 2), nullable=True)
    weekly_total_max_h = Column(Numeric(5, 2), nullable=True)

    # Monthly-salary cap above which OT is not owed (MU WRR)
    monthly_basic_ot_cap = Column(Numeric(12, 2), nullable=True)

    # Notional hourly rate divisor for salaried-OT pricing (WRA s.25: monthly
    # basic ÷ 195 for MU). NULL (every existing row) falls back to 195 in
    # _apply_salaried_overtime — preserves MU's exact current output. A
    # future country's own notional-rate formula sets this explicitly on its
    # own row rather than needing a code change.
    notional_hourly_divisor = Column(Numeric(6, 2), nullable=True)

    # Stacking rules
    stack_holiday_on_rest_day = Column(String(10), nullable=False, server_default='MAX')
    stack_night_on_premium = Column(String(10), nullable=False, server_default='NO_STACK')

    # Week start (ISO Mon=1)
    week_start_dow = Column(SmallInteger, nullable=False, server_default='1')

    successor = relationship("CountryOvertimeRule", remote_side=[id], foreign_keys=[superseded_by_id])
    weekday_tiers = relationship(
        "CountryOvertimeWeekdayTier",
        back_populates="overtime_rule",
        cascade="all, delete-orphan",
        order_by="CountryOvertimeWeekdayTier.tier_order",
    )


class CountryOvertimeWeekdayTier(Base):
    """Multi-tier weekday OT (MG: 1.3 then 1.5; MU: single 1.5).
    Modeled as a child table for row-level admin-UI editing + audit."""
    __tablename__ = "country_overtime_weekday_tiers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    overtime_rule_id = Column(
        Integer,
        ForeignKey("country_overtime_rules.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    tier_order = Column(SmallInteger, nullable=False)
    up_to_hours = Column(Numeric(5, 2), nullable=True)  # NULL = and beyond
    multiplier = Column(Numeric(3, 2), nullable=False)

    overtime_rule = relationship("CountryOvertimeRule", back_populates="weekday_tiers")

    __table_args__ = (
        UniqueConstraint("overtime_rule_id", "tier_order", name="uq_ot_tier_order"),
    )


class PayrollCalendar(Base):
    """M24 — country-level period configuration. Append-only with effective_from
    so historical periods always resolve against the calendar that was in
    force on their period_start, not whatever the current rule says."""
    __tablename__ = "payroll_calendars"

    id = Column(Integer, primary_key=True, autoincrement=True)
    country_code = Column(String(2), ForeignKey("countries.code"), nullable=False, index=True)
    period_type = Column(String(20), nullable=False, server_default="monthly")
    period_close_day = Column(Integer, nullable=False, server_default="31")
    statutory_filing_deadline_day = Column(Integer, nullable=True)
    effective_from = Column(Date, nullable=False)
    effective_to = Column(Date, nullable=True)
    notes = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class BonusProvision(Base):
    """M23 — running monthly accrual of EOY bonus liability per employee.

    One row per (company, employee, year, month). The monthly cron upserts
    a row for each active employee, where `accrued_amount` is the total
    liability the company has accumulated through that month (cumulative,
    not delta — easier to query "as of date X").

    `formula_snapshot` freezes the rule that produced this provision so a
    later supersede doesn't retroactively change the historical liability.
    """
    __tablename__ = "bonus_provisions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    company_id = Column(Integer, ForeignKey("companies.company_id", ondelete="CASCADE"), nullable=False)
    private_user_id = Column(Integer, ForeignKey("private_users.private_user_id", ondelete="CASCADE"), nullable=False)
    year = Column(Integer, nullable=False)
    month = Column(Integer, nullable=False)
    accrued_amount = Column(Numeric(14, 2), nullable=False, server_default="0")
    ytd_earnings = Column(Numeric(14, 2), nullable=False, server_default="0")
    formula_snapshot = Column(JSONB, nullable=False, server_default='{}')
    bonus_rule_id = Column(Integer, ForeignKey("country_bonus_rules.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("company_id", "private_user_id", "year", "month",
                         name="uq_bonus_provisions_emp_period"),
    )


# ---------------------------------------------------------------------------
# Salary configuration redesign (Module 5).
#
# Replaces the legacy `salaries` row-per-job model. Five tables:
#   * salary_components — per-company catalog (earnings/deductions),
#                         categorized for Module 8 allowance plugins.
#   * salary_structures — named templates (e.g. "Grade A").
#   * salary_structure_lines — components in a structure with default amounts.
#   * employee_salary_assignments — employee → structure, effective-dated.
#   * employee_salary_overrides — per-component overrides on an assignment.
#
# Resolution: services/salary_resolver.resolve_components(private_user_id,
# period_start) returns dict[component_code → Decimal] applying structure
# lines plus overrides.
# ---------------------------------------------------------------------------


class SalaryComponent(Base):
    """Per-company catalog of salary components (earnings or deductions).

    `category` is a namespaced string (e.g. 'earning.basic',
    'allowance.transport', 'deduction.loan') so Module 8 (Allowances)
    can group/filter without a separate table.
    """
    __tablename__ = "salary_components"

    id = Column(Integer, primary_key=True, autoincrement=True)
    company_id = Column(Integer, ForeignKey("companies.company_id", ondelete="CASCADE"), nullable=False, index=True)
    code = Column(String(40), nullable=False)  # e.g. 'BASIC', 'TRANSPORT', 'PAYE'
    label = Column(String(100), nullable=False)
    kind = Column(String(20), nullable=False)  # 'earning' | 'deduction'
    category = Column(String(60), nullable=False, server_default="earning.other")
    is_basic = Column(Boolean, nullable=False, server_default="false")  # at most one per company
    is_taxable = Column(Boolean, nullable=False, server_default="true")
    is_recurring = Column(Boolean, nullable=False, server_default="true")
    is_one_off = Column(Boolean, nullable=False, server_default="false")
    prorate_on_partial_month = Column(Boolean, nullable=False, server_default="true")
    # How the stored amount (structure line / override) is interpreted at
    # resolution time. 'monthly' | 'daily' — a daily component's amount is a
    # per-day rate, multiplied by working days in the period (see
    # services/payroll_engine.py's _apply_pay_basis, which has the country
    # context resolve_components lacks).
    frequency = Column(String(10), nullable=False, server_default="monthly")
    # 'amount' | 'percent_of_basic' — for percent_of_basic, the stored amount
    # is percentage POINTS (e.g. 5.00 = 5%), applied against the structure's
    # BASIC component. See salary_resolver.resolve_components for the known
    # limitation on pay_basis='daily'/'hourly' employees (BASIC is replaced
    # AFTER this resolves, by _apply_pay_basis).
    value_type = Column(String(20), nullable=False, server_default="amount")
    # M4: explicit list of statutory bases this component contributes to.
    # Examples: BASIC → ["PAYE","CSG_EE","CSG_ER","NSF_EE","NSF_ER"]
    #           TRANSPORT (capped, non-CSG-able) → ["PAYE"]
    # Empty list `[]` is interpreted via legacy inference at engine time
    # (see services/payroll_engine.py).
    statutory_base_codes = Column(JSONB, nullable=False, server_default="[]")
    country_default_code = Column(String(2), ForeignKey("countries.code"), nullable=True)  # seeded country defaults link back here
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    company = relationship("Company")

    __table_args__ = (
        UniqueConstraint("company_id", "code", name="uq_salary_component_company_code"),
    )


class SalaryStructure(Base):
    """Per-company named salary template (e.g. 'Sales Grade A').

    M2 scoping fields (`default_for_*`) are optional pointers used by
    services/salary_resolver.suggest_structure_for to auto-pick a structure
    when onboarding a new employee. They are advisory only — admins can
    always override per-employee.
    """
    __tablename__ = "salary_structures"

    id = Column(Integer, primary_key=True, autoincrement=True)
    company_id = Column(Integer, ForeignKey("companies.company_id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    description = Column(String, nullable=True)
    is_default = Column(Boolean, nullable=False, server_default="false")
    # M2 scoping
    default_for_department_id = Column(
        Integer, ForeignKey("departments.department_id", ondelete="SET NULL"), nullable=True
    )
    default_for_role = Column(String(40), nullable=True)
    default_for_sector_grade_id = Column(
        Integer, ForeignKey("sector_grades.id", ondelete="SET NULL"), nullable=True
    )
    # Soft-delete: when set, the structure is hidden from default lists
    # and auto-suggest, but existing EmployeeSalaryAssignment rows keep
    # resolving (their structure_snapshot is the source of truth post-M3).
    archived_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    company = relationship("Company")
    lines = relationship("SalaryStructureLine", back_populates="structure", cascade="all, delete-orphan")
    default_for_department = relationship("Department", foreign_keys=[default_for_department_id])
    default_for_sector_grade = relationship("SectorGrade", foreign_keys=[default_for_sector_grade_id])

    __table_args__ = (
        UniqueConstraint("company_id", "name", name="uq_salary_structure_company_name"),
    )


class SalaryStructureLine(Base):
    """One component in a structure, with the default amount."""
    __tablename__ = "salary_structure_lines"

    id = Column(Integer, primary_key=True, autoincrement=True)
    structure_id = Column(Integer, ForeignKey("salary_structures.id", ondelete="CASCADE"), nullable=False)
    component_id = Column(Integer, ForeignKey("salary_components.id", ondelete="RESTRICT"), nullable=False)
    amount = Column(Numeric(14, 2), nullable=True)  # NULL when formula_expression is set (Phase 2)
    formula_expression = Column(String, nullable=True)  # reserved for Phase 2 formulas
    order_index = Column(Integer, nullable=False, server_default="0")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    structure = relationship("SalaryStructure", back_populates="lines")
    component = relationship("SalaryComponent")

    __table_args__ = (
        UniqueConstraint("structure_id", "component_id", name="uq_structure_line_unique"),
    )


class EmployeeSalaryAssignment(Base):
    """Employee → structure, effective-dated. Newer assignment supersedes older
    by setting older's effective_to to the new assignment's effective_from.

    `structure_snapshot` (M3) freezes the structure's lines + component
    metadata at assignment-creation time. The resolver reads from the
    snapshot, so editing the live structure later doesn't retroactively
    change existing employees' salaries.
    """
    __tablename__ = "employee_salary_assignments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    private_user_id = Column(Integer, ForeignKey("private_users.private_user_id", ondelete="CASCADE"), nullable=False, index=True)
    structure_id = Column(Integer, ForeignKey("salary_structures.id", ondelete="RESTRICT"), nullable=True)
    structure_snapshot = Column(JSONB, nullable=True)  # M3: frozen at create time
    currency = Column(String(3), nullable=False, server_default="MUR")
    effective_from = Column(Date, nullable=False)
    effective_to = Column(Date, nullable=True)
    notes = Column(String, nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    private_user = relationship("PrivateUser")
    structure = relationship("SalaryStructure")
    overrides = relationship("EmployeeSalaryOverride", back_populates="assignment", cascade="all, delete-orphan")


class EmployeeSalaryOverride(Base):
    """Per-component override on a single assignment."""
    __tablename__ = "employee_salary_overrides"

    id = Column(Integer, primary_key=True, autoincrement=True)
    assignment_id = Column(Integer, ForeignKey("employee_salary_assignments.id", ondelete="CASCADE"), nullable=False)
    component_id = Column(Integer, ForeignKey("salary_components.id", ondelete="RESTRICT"), nullable=False)
    amount = Column(Numeric(14, 2), nullable=True)
    formula_expression = Column(String, nullable=True)  # Phase 2
    notes = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    assignment = relationship("EmployeeSalaryAssignment", back_populates="overrides")
    component = relationship("SalaryComponent")

    __table_args__ = (
        UniqueConstraint("assignment_id", "component_id", name="uq_assignment_override_unique"),
    )


# ---------------------------------------------------------------------------
# Payroll runs + payslips (Module 2).
#
# A PayrollRun goes draft → finalized. On finalize, country rules are
# snapshot into country_rules_snapshot JSONB so historical re-renders of
# any payslip reproduce byte-for-byte regardless of later rule supersedes.
# Each Payslip stores the full component breakdown in `components` JSONB
# plus aggregated totals in dedicated columns for fast reporting.
# ---------------------------------------------------------------------------


class PayrollRun(Base):
    __tablename__ = "payroll_runs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    company_id = Column(Integer, ForeignKey("companies.company_id", ondelete="CASCADE"), nullable=False, index=True)
    period_start = Column(Date, nullable=False)
    period_end = Column(Date, nullable=False)
    status = Column(String(20), nullable=False, server_default="draft")  # draft|finalized|cancelled
    currency = Column(String(3), nullable=False, server_default="MUR")
    notes = Column(String, nullable=True)
    country_rules_snapshot = Column(JSONB, nullable=True)  # populated on finalize
    # Overtime engine — snapshot of company-level overrides (CompanyHolidayRate
    # rows) active at run creation time. Frozen for audit.
    company_overrides_snapshot = Column(JSONB, nullable=True)
    # Engine compute version. 1 = legacy hours-sum, 2 = bucketed overtime
    # engine. Sunset path documented in backend/OVERTIME.md.
    compute_version = Column(SmallInteger, nullable=False, server_default='1')
    # Soft-cap / hard-cap / data-quality warnings collected during compute.
    # e.g. ["exceeded_weekly_max_h", "holiday_during_leave_adjusted"].
    compliance_flags = Column(JSONB, nullable=False, server_default='[]')
    # Shadow-payroll FX snapshot (Phase 2). Frozen at run creation so a
    # finalized run's host-country shadow figures are auditable and never
    # re-derive from a later market rate. Shape:
    #   {"source": "BOM", "as_of": "2026-07-01", "base": "MUR",
    #    "rates": {"TZS": "0.05"}}   # rate = 1 host currency in base units
    fx_snapshot = Column(JSONB, nullable=True)
    fx_source = Column(String(16), nullable=True)
    fx_as_of = Column(Date, nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    finalized_at = Column(DateTime(timezone=True), nullable=True)
    finalized_by_user_id = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    company = relationship("Company")
    payslips = relationship("Payslip", back_populates="run", cascade="all, delete-orphan")

    __table_args__ = (
        # Partial unique: at most one NON-cancelled run per company+period.
        # Cancelled runs are excluded so a period can be cancelled and re-run
        # (the "Redo"/"cancel → start fresh" flows) without colliding with the
        # voided row, while still preventing two live runs for the same period.
        Index(
            "uq_payroll_run_company_period",
            "company_id", "period_start", "period_end",
            unique=True,
            postgresql_where=text("status <> 'cancelled'"),
        ),
    )


class Payslip(Base):
    __tablename__ = "payslips"

    id = Column(Integer, primary_key=True, autoincrement=True)
    payroll_run_id = Column(Integer, ForeignKey("payroll_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    private_user_id = Column(Integer, ForeignKey("private_users.private_user_id", ondelete="RESTRICT"), nullable=False, index=True)
    job_id = Column(Integer, ForeignKey("jobs.job_id", ondelete="SET NULL"), nullable=True)
    # Branch/site snapshot: the employee's home geofence AT RUN TIME. A payslip
    # is a historical record, so we freeze the site instead of re-resolving the
    # employee's current assignment — a mid-period transfer must not rewrite
    # past payslips. Name is resolved read-time from the geofence row.
    home_geofence_id = Column(
        Integer,
        ForeignKey("company_geofences.geofence_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Aggregated totals
    gross = Column(Numeric(14, 2), nullable=False, server_default="0.00")
    taxable_income = Column(Numeric(14, 2), nullable=False, server_default="0.00")
    paye = Column(Numeric(14, 2), nullable=False, server_default="0.00")
    bonus = Column(Numeric(14, 2), nullable=False, server_default="0.00")
    allowances_total = Column(Numeric(14, 2), nullable=False, server_default="0.00")
    deductions_total = Column(Numeric(14, 2), nullable=False, server_default="0.00")
    loan_repayments = Column(Numeric(14, 2), nullable=False, server_default="0.00")
    leave_impact = Column(Numeric(14, 2), nullable=False, server_default="0.00")
    # Per-type leave taken in the period: list of
    #   { type, code, label, days, paid }
    # with `paid` True when the leave's category is paid in MU (sick / annual
    # / public holiday). Drives both the payslip viewer's "Sick leave: 2 days"
    # row and downstream MRA reporting.
    leave_summary = Column(JSONB, nullable=True)
    net_pay = Column(Numeric(14, 2), nullable=False, server_default="0.00")

    # Statutory split: { 'CSG_EE': 450.00, 'NSF_EE': 300.00, ... }
    statutory_employee = Column(JSONB, nullable=True)
    statutory_employer = Column(JSONB, nullable=True)

    currency = Column(String(3), nullable=False, server_default="MUR")
    locale = Column(String(10), nullable=True)

    # Shadow-payroll host-country figures (Phase 2). Computed only for an
    # employee whose effective country (active assignment) differs from the
    # employer country. shadow_tax / shadow_ss are the host-country statutory
    # amounts on the converted gross, held in shadow_currency. The home
    # currency home amount of the host tax is exposed via shadow_tax_home so
    # tax-equalization comparisons never depend on the viewer's numeric
    # precision. All shadow_* are NULL unless a shadow run applied.
    shadow_country_code = Column(String(3), nullable=True)
    shadow_currency = Column(String(3), nullable=True)
    shadow_gross = Column(Numeric(14, 2), nullable=True)
    shadow_taxable_income = Column(Numeric(14, 2), nullable=True)
    shadow_tax = Column(Numeric(14, 2), nullable=True)
    shadow_ss = Column(Numeric(14, 2), nullable=True)
    shadow_equalization_due = Column(Numeric(14, 2), nullable=True,
                                     comment="Tax equalization: host tax minus home hypothetical tax, in home currency, floored at 0")

    # Full line-item breakdown — list of {code, label, kind, category, amount, source}
    components = Column(JSONB, nullable=True)

    # PDF + integrity (Phase 2 — populated when PDF is generated)
    pdf_url = Column(String, nullable=True)
    hash_sha256 = Column(String(64), nullable=True)

    # Per-employee correction: an adjustment payslip holds the DELTA vs the
    # original (which stays immutable) and points back at it. The amount columns
    # above carry signed deltas (can be negative) for an adjustment row.
    is_adjustment = Column(Boolean, nullable=False, server_default="false")
    parent_payslip_id = Column(Integer, ForeignKey("payslips.id", ondelete="SET NULL"), nullable=True, index=True)
    adjustment_reason = Column(String(255), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    run = relationship("PayrollRun", back_populates="payslips")
    parent_payslip = relationship("Payslip", remote_side=[id], foreign_keys=[parent_payslip_id])
    private_user = relationship("PrivateUser")
    job = relationship("Job")
    home_geofence = relationship("CompanyGeofence")

    __table_args__ = (
        # One ORIGINAL payslip per (run, employee). Adjustment rows
        # (is_adjustment=true) are corrections that intentionally share the
        # run+user of the original they amend, so the uniqueness only covers
        # originals — otherwise the first correction would collide with it.
        Index(
            "uq_payslip_run_user",
            "payroll_run_id", "private_user_id",
            unique=True,
            postgresql_where=text("is_adjustment = false"),
        ),
    )


class EmployeeOneOffAllowance(Base):
    """Ad-hoc earning or deduction scheduled for a specific month.

    Distinct from EmployeeSalaryOverride (which permanently changes a
    structure component's amount) — this represents a one-time payment or
    deduction (signing bonus, mid-year commission, equipment reimbursement,
    a deduction for replaced equipment, etc.).

    Lifecycle:
      * Admin creates row with applied_to_payslip_id = NULL.
      * Payroll draft for (year, month) picks it up via list_pending_for_period.
      * Payroll finalize stamps applied_to_payslip_id so it cannot be picked
        up again.
      * Cancelling a finalized run nulls the stamp (Phase 2; today, finalized
        runs cannot be cancelled cleanly while preserving one-offs).
    """
    __tablename__ = "employee_one_off_allowances"

    id = Column(Integer, primary_key=True, autoincrement=True)
    private_user_id = Column(Integer, ForeignKey("private_users.private_user_id", ondelete="CASCADE"), nullable=False, index=True)
    component_id = Column(Integer, ForeignKey("salary_components.id", ondelete="RESTRICT"), nullable=False)
    amount = Column(Numeric(14, 2), nullable=False)
    payable_in_year = Column(Integer, nullable=False)
    payable_in_month = Column(Integer, nullable=False)  # 1-12
    applied_to_payslip_id = Column(Integer, ForeignKey("payslips.id", ondelete="SET NULL"), nullable=True, index=True)
    notes = Column(String, nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    private_user = relationship("PrivateUser")
    component = relationship("SalaryComponent")
    payslip = relationship("Payslip", foreign_keys=[applied_to_payslip_id])


class KioskDevice(Base):
    """M26 — a registered kiosk tablet that creates clock-ins on behalf of
    employees who don't (or can't) use the mobile app.

    Token format: the raw token returned at registration is
    ``f"{device_id}.{secret}"`` so validation is an O(1) PK lookup plus
    one bcrypt-compare against ``api_token_hash`` — not O(active-devices)
    bcrypt-compares as a naive "compare to all hashes" implementation
    would force. Tokens expire after 30 days; the admin UI can rotate
    early at any time and deactivate immediately on tablet loss.

    Audit: kiosk-originated TimeLog and device-lifecycle events write
    AuditLog rows with ``actor_user_id=NULL`` (matching the codebase's
    existing convention for system-originated actions, see
    ``core/permission_guards.py`` and ``tests/test_smoke.py``) and the
    device + employee context in ``meta``.
    """
    __tablename__ = "kiosk_devices"

    device_id = Column(UUID(as_uuid=True), primary_key=True)
    company_id = Column(Integer, ForeignKey("companies.company_id", ondelete="CASCADE"), nullable=False)
    device_name = Column(String(120), nullable=False)
    location = Column(JSONB, nullable=True)
    # Geofencing v3 — the tablet's registered physical position, bound at
    # setup (see the kiosk "trusted device" model). Kiosk punches are treated
    # as verified against this position rather than the tablet's own GPS,
    # which is typically weak or absent on tablet hardware. NULL until an
    # admin records it; a registered position is never used to *block*.
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    location_verified_at = Column(DateTime(timezone=True), nullable=True)
    api_token_hash = Column(String(255), nullable=False)
    # 4-digit admin PIN (bcrypt hash), generated at registration. Gates the
    # tablet's admin surfaces (exit kiosk / re-onboard). Shown once on the web
    # alongside the token; the tablet caches it for offline/dead-token checks.
    admin_pin_hash = Column(String(255), nullable=True)
    token_expires_at = Column(DateTime(timezone=True), nullable=False)
    is_active = Column(Boolean, nullable=False, server_default='true')
    last_seen_at = Column(DateTime(timezone=True), nullable=True)
    # IPv6 max 45 chars (incl. embedded IPv4 + zone). Stolen-tablet
    # detection alerts on deviations from the registration IP.
    last_seen_ip = Column(String(45), nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint('company_id', 'device_name', name='uq_kiosk_devices_company_name'),
    )

    company = relationship("Company", back_populates="kiosk_devices")


class TrustedDevice(Base):
    """OTP-login device binding (trusted_devices_20260531) — mitigates
    phone-number recycling for users who only authenticate via OTP.

    Lifecycle (enforced in services/trusted_device_service.py):
      * First successful OTP verify with no prior devices → trust-on-first
        use (TOFU): row created.
      * Subsequent OTP verify from the same device_id → ``last_seen_at``
        bumped; login proceeds.
      * OTP verify from a NEW device_id for a passwordless user with
        ≥1 active (non-revoked) device already on file → rejected with
        ``new_device_requires_approval``. The user must log in from a
        known device, set a password, or have an admin revoke devices.
      * Users WITH ``password_hash`` set bypass the new-device check
        entirely — the password is the fallback channel.

    PK is composite ``(device_id, user_id)`` so the same physical device
    can legitimately bind to multiple accounts (household tablet) without
    a unique-key conflict on the bare device_id.
    """
    __tablename__ = "trusted_devices"

    device_id = Column(String(80), primary_key=True)
    user_id = Column(
        Integer,
        ForeignKey("users.user_id", ondelete="CASCADE"),
        primary_key=True,
    )
    device_name = Column(String(120), nullable=True)
    first_seen_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    last_seen_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    # Soft-delete — admins keep the forensic history but the partial
    # index ix_trusted_devices_active_per_user excludes revoked rows
    # from the hot path.
    revoked_at = Column(DateTime(timezone=True), nullable=True)


class KioskIdempotency(Base):
    """M26 — replay-safe ``/kiosk/clock-in``. Stores the (device, key) →
    timelog mapping for 7 days so a network retry from the kiosk returns
    the original timelog instead of creating a duplicate.

    Cleanup is invoked by ``services.kiosk_service.purge_old_idempotency_rows``
    on the same schedule that runs the email worker (no pg_cron in this
    project — same deferral pattern as ``step_up_tokens_20260428.py``).
    """
    __tablename__ = "kiosk_idempotency"

    device_id = Column(
        UUID(as_uuid=True),
        ForeignKey("kiosk_devices.device_id", ondelete="CASCADE"),
        primary_key=True,
    )
    idempotency_key = Column(String(64), primary_key=True)
    timelog_id = Column(Integer, ForeignKey("time_logs.timelog_id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
