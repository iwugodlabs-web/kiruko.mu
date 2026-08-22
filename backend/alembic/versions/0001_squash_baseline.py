"""Squash: single baseline migration replacing all previous migrations

Revision ID: squash_2026_04_06
Revises: (none — this is the new chain root)
Create Date: 2026-04-06

Collapses ~43 individual migration files into one authoritative baseline.
Uses CREATE TABLE / ADD COLUMN with IF NOT EXISTS guards so it is safe to
run against both:
  - A fresh empty database (creates everything from scratch)
  - A production database that was already up-to-date (all statements are no-ops)

downgrade() is intentionally left as a no-op: the squash baseline cannot be
rolled back because the old migration history no longer exists.
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic
revision = 'squash_2026_04_06'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # PostgreSQL extensions
    # ------------------------------------------------------------------
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    # ------------------------------------------------------------------
    # Core auth / identity tables
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE IF NOT EXISTS users (
            user_id       SERIAL PRIMARY KEY,
            user_type     VARCHAR NOT NULL,
            email         VARCHAR UNIQUE,
            phone         VARCHAR(20),
            user_name     VARCHAR UNIQUE,
            password_hash VARCHAR,
            onboard_complete          BOOLEAN NOT NULL DEFAULT FALSE,
            user_verified             BOOLEAN NOT NULL DEFAULT FALSE,
            company_onboarding_status VARCHAR NOT NULL DEFAULT 'pending',
            verification_note         VARCHAR,
            user_enabled              BOOLEAN NOT NULL DEFAULT TRUE,
            expo_push_token           VARCHAR,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS countries (
            code              VARCHAR(2) PRIMARY KEY,
            name              VARCHAR(100) NOT NULL,
            currency          VARCHAR(10)  NOT NULL,
            locale            VARCHAR(10),
            fiscal_year_start VARCHAR(5),
            date_format       VARCHAR(20),
            min_wage          NUMERIC(12,2),
            is_active         BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS platform_roles (
            role_id     SERIAL PRIMARY KEY,
            name        VARCHAR(100) UNIQUE NOT NULL,
            description VARCHAR(255),
            system      BOOLEAN NOT NULL DEFAULT FALSE,
            created_at  TIMESTAMPTZ DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS user_platform_roles (
            id         SERIAL PRIMARY KEY,
            user_id    INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
            role_id    INTEGER NOT NULL REFERENCES platform_roles(role_id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ DEFAULT now(),
            created_by INTEGER,
            CONSTRAINT uq_user_platform_role UNIQUE (user_id, role_id)
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS platform_invites (
            invite_id  SERIAL PRIMARY KEY,
            email      VARCHAR(255) NOT NULL,
            role_name  VARCHAR(100) NOT NULL REFERENCES platform_roles(name) ON DELETE CASCADE,
            token      VARCHAR(255) NOT NULL,
            status     VARCHAR(20)  NOT NULL DEFAULT 'pending',
            expires_at TIMESTAMPTZ  NOT NULL,
            invited_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
            accepted_at TIMESTAMPTZ,
            created_at  TIMESTAMPTZ DEFAULT now(),
            CONSTRAINT uq_platform_invite_token UNIQUE (token)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_platform_invites_email  ON platform_invites (email)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_platform_invites_status ON platform_invites (status)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS verification_tokens (
            id         SERIAL PRIMARY KEY,
            email      VARCHAR NOT NULL,
            token_type VARCHAR(20) NOT NULL DEFAULT 'signup',
            otp_hash   VARCHAR NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL,
            used       BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_verification_tokens_email ON verification_tokens (email)")

    # ------------------------------------------------------------------
    # Company / organisation tables
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE IF NOT EXISTS companies (
            company_id            SERIAL PRIMARY KEY,
            user_id               INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
            company_name          VARCHAR(255) NOT NULL,
            email                 VARCHAR UNIQUE,
            brn                   VARCHAR NOT NULL,
            address               VARCHAR,
            phone                 VARCHAR(20),
            vat                   VARCHAR(50),
            annual_leave_budget   INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS departments (
            department_id SERIAL PRIMARY KEY,
            company_id    INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
            name          VARCHAR(255) NOT NULL,
            created_at    TIMESTAMPTZ DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS company_monthly_payrolls (
            id           SERIAL PRIMARY KEY,
            company_id   INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
            year         INTEGER NOT NULL,
            month        INTEGER NOT NULL,
            total_amount NUMERIC(12,2) DEFAULT 0.0,
            currency     VARCHAR(3) DEFAULT 'MUR',
            updated_at   TIMESTAMPTZ DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS company_invites (
            invite_id  SERIAL PRIMARY KEY,
            company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
            email      VARCHAR NOT NULL,
            role       VARCHAR(20) NOT NULL DEFAULT 'employee',
            token      VARCHAR(128) NOT NULL UNIQUE,
            invited_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
            accepted   BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ DEFAULT now(),
            expires_at TIMESTAMPTZ
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_company_invites_token ON company_invites (token)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS company_roles (
            role_id     SERIAL PRIMARY KEY,
            company_id  INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
            name        VARCHAR(100) NOT NULL,
            description VARCHAR,
            is_system   BOOLEAN NOT NULL DEFAULT FALSE,
            permissions JSONB   NOT NULL DEFAULT '[]',
            created_at  TIMESTAMPTZ DEFAULT now(),
            CONSTRAINT uq_company_role_name UNIQUE (company_id, name)
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS company_holiday_rates (
            id         SERIAL PRIMARY KEY,
            company_id INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
            name       VARCHAR NOT NULL,
            date       VARCHAR(10) NOT NULL,
            recurrent  BOOLEAN NOT NULL DEFAULT FALSE,
            multiplier NUMERIC(4,2) NOT NULL DEFAULT 2.0,
            note       VARCHAR,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_company_holiday_rates_company_id ON company_holiday_rates (company_id)")

    # ------------------------------------------------------------------
    # Private users (workers / employees)
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE IF NOT EXISTS private_users (
            private_user_id SERIAL PRIMARY KEY,
            user_id         INTEGER NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
            first_name      VARCHAR(100) NOT NULL,
            last_name       VARCHAR(100) NOT NULL,
            phone           VARCHAR(20),
            gender          VARCHAR,
            date_of_birth   TIMESTAMP,
            pass_port_number VARCHAR UNIQUE,
            company_id      INTEGER REFERENCES companies(company_id) ON DELETE SET NULL,
            department_id   INTEGER REFERENCES departments(department_id) ON DELETE SET NULL,
            role            VARCHAR(20) NOT NULL DEFAULT 'employee',
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS company_user_roles (
            id              SERIAL PRIMARY KEY,
            company_id      INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
            private_user_id INTEGER NOT NULL REFERENCES private_users(private_user_id) ON DELETE CASCADE,
            role            VARCHAR(50) NOT NULL,
            created_at      TIMESTAMPTZ DEFAULT now(),
            created_by      INTEGER,
            CONSTRAINT uq_company_private_role UNIQUE (company_id, private_user_id, role)
        )
    """)

    # ------------------------------------------------------------------
    # Jobs & employment
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE IF NOT EXISTS jobs (
            job_id          SERIAL PRIMARY KEY,
            private_user_id INTEGER NOT NULL REFERENCES private_users(private_user_id) ON DELETE SET NULL,
            company_id      INTEGER REFERENCES companies(company_id) ON DELETE SET NULL,
            department_id   INTEGER REFERENCES departments(department_id) ON DELETE SET NULL,
            job_title       VARCHAR,
            employer_name   VARCHAR,
            employer_brn    VARCHAR,
            employer_email  VARCHAR UNIQUE,
            employer_phone  VARCHAR,
            employer_address VARCHAR,
            first_date_of_employment TIMESTAMP,
            work_start_time TIME,
            work_end_time   TIME,
            work_days       JSONB NOT NULL DEFAULT '{}',
            has_contract                        BOOLEAN NOT NULL DEFAULT FALSE,
            has_permission_to_work              BOOLEAN NOT NULL DEFAULT FALSE,
            work_permit_type                    VARCHAR,
            working_on_tourist_visa             BOOLEAN NOT NULL DEFAULT FALSE,
            is_salary_deducted                  BOOLEAN NOT NULL DEFAULT FALSE,
            reason_for_deduction                JSONB,
            is_accommodation_covered_by_employer BOOLEAN NOT NULL DEFAULT FALSE,
            is_accommodation_a_dormitory        BOOLEAN NOT NULL DEFAULT FALSE,
            is_accommodation_decent             BOOLEAN NOT NULL DEFAULT FALSE,
            is_passport_retained                BOOLEAN NOT NULL DEFAULT FALSE,
            is_job_execution_same_as_description BOOLEAN NOT NULL DEFAULT FALSE,
            doubts_about_compensation           BOOLEAN NOT NULL DEFAULT FALSE,
            auto_clockin_enabled                BOOLEAN NOT NULL DEFAULT FALSE,
            minimum_break_minutes               INTEGER,
            verification_status VARCHAR NOT NULL DEFAULT 'pending',
            verified_at         TIMESTAMP,
            verified_by         VARCHAR,
            rejection_reason    VARCHAR,
            created_at TIMESTAMP,
            updated_at TIMESTAMP
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS job_history (
            history_id      SERIAL PRIMARY KEY,
            job_id          INTEGER NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
            private_user_id INTEGER NOT NULL REFERENCES private_users(private_user_id) ON DELETE SET NULL,
            company_id      INTEGER REFERENCES companies(company_id) ON DELETE SET NULL,
            job_title       VARCHAR,
            employer_name   VARCHAR,
            employer_brn    VARCHAR,
            employer_email  VARCHAR,
            employer_phone  VARCHAR,
            employer_address VARCHAR,
            first_date_of_employment TIMESTAMP,
            work_start_time TIME,
            work_end_time   TIME,
            work_days       JSONB NOT NULL DEFAULT '{}',
            has_contract                        BOOLEAN NOT NULL,
            has_permission_to_work              BOOLEAN NOT NULL,
            work_permit_type                    VARCHAR,
            working_on_tourist_visa             BOOLEAN NOT NULL,
            is_salary_deducted                  BOOLEAN NOT NULL,
            reason_for_deduction                JSONB,
            is_accommodation_covered_by_employer BOOLEAN NOT NULL,
            is_accommodation_a_dormitory        BOOLEAN NOT NULL,
            is_accommodation_decent             BOOLEAN NOT NULL,
            is_passport_retained                BOOLEAN NOT NULL,
            is_job_execution_same_as_description BOOLEAN NOT NULL,
            doubts_about_compensation           BOOLEAN NOT NULL,
            change_reason       VARCHAR,
            changed_by          VARCHAR,
            change_timestamp    TIMESTAMPTZ NOT NULL DEFAULT now(),
            original_created_at TIMESTAMPTZ,
            original_updated_at TIMESTAMP
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS salaries (
            salary_id               SERIAL PRIMARY KEY,
            job_id                  INTEGER NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
            monthly_hours           VARCHAR,
            break_in_minutes_per_day INTEGER,
            days_of_work_per_month  INTEGER,
            currency                VARCHAR(3) DEFAULT 'MUR',
            salary                  VARCHAR,
            revenue                 VARCHAR,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now()
        )
    """)

    # ------------------------------------------------------------------
    # Time tracking
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE IF NOT EXISTS time_logs (
            timelog_id      SERIAL PRIMARY KEY,
            job_id          INTEGER NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
            private_user_id INTEGER NOT NULL REFERENCES private_users(private_user_id) ON DELETE CASCADE,
            day_of_week     VARCHAR,
            start_time      TIMESTAMPTZ,
            end_time        TIMESTAMPTZ,
            location        JSONB NOT NULL DEFAULT '{}',
            hours_worked    NUMERIC(5,2),
            is_overtime                   BOOLEAN NOT NULL DEFAULT FALSE,
            overtime_confirmed_by_employer BOOLEAN NOT NULL DEFAULT FALSE,
            overtime_rejected             BOOLEAN NOT NULL DEFAULT FALSE,
            marked_as_overtime_at         TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS break_logs (
            break_id   SERIAL PRIMARY KEY,
            timelog_id INTEGER NOT NULL REFERENCES time_logs(timelog_id) ON DELETE CASCADE,
            start_time TIMESTAMPTZ NOT NULL,
            end_time   TIMESTAMPTZ
        )
    """)

    # ------------------------------------------------------------------
    # Notifications
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE IF NOT EXISTS notifications (
            notification_id SERIAL PRIMARY KEY,
            user_id         INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
            title           VARCHAR(255) NOT NULL,
            message         VARCHAR NOT NULL,
            type            VARCHAR(50) NOT NULL,
            is_read         BOOLEAN NOT NULL DEFAULT FALSE,
            meta            JSONB,
            created_at      TIMESTAMPTZ DEFAULT now()
        )
    """)

    # ------------------------------------------------------------------
    # User rights / disputes
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE IF NOT EXISTS user_rights (
            right_id                     SERIAL PRIMARY KEY,
            private_user_id              INTEGER NOT NULL REFERENCES private_users(private_user_id) ON DELETE CASCADE,
            title                        VARCHAR NOT NULL,
            category                     VARCHAR NOT NULL,
            issue_description            VARCHAR NOT NULL,
            contact_method               VARCHAR NOT NULL,
            previous_occurence           BOOLEAN,
            date_of_occurrence           DATE,
            time                         TIME,
            occurrence_description       VARCHAR,
            urgency_level                VARCHAR NOT NULL,
            resolution_method            VARCHAR,
            accept_terms_and_conditions  BOOLEAN NOT NULL,
            acknowledge_information      BOOLEAN NOT NULL,
            agreed_to_be_contacted       BOOLEAN NOT NULL,
            status                       VARCHAR NOT NULL,
            expected_outcome             VARCHAR NOT NULL,
            attachment_url               VARCHAR,
            channel                      VARCHAR(20) NOT NULL DEFAULT 'internal',
            assigned_to                  INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
            internal_notes               TEXT,
            resolution                   TEXT,
            closed_at                    TIMESTAMPTZ,
            closed_by                    INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)

    # ------------------------------------------------------------------
    # Financial tables
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE IF NOT EXISTS transfers (
            transfer_id     SERIAL PRIMARY KEY,
            private_user_id INTEGER NOT NULL REFERENCES private_users(private_user_id) ON DELETE CASCADE,
            from_user       VARCHAR NOT NULL,
            to_user         VARCHAR NOT NULL,
            amount          FLOAT NOT NULL,
            currency        VARCHAR(3) DEFAULT 'MUR',
            status          VARCHAR NOT NULL,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS purchases (
            purchase_id     SERIAL PRIMARY KEY,
            private_user_id INTEGER NOT NULL REFERENCES private_users(private_user_id) ON DELETE CASCADE,
            description     VARCHAR NOT NULL,
            amount          FLOAT NOT NULL,
            currency        VARCHAR(3) DEFAULT 'MUR',
            merchant        VARCHAR,
            category        VARCHAR,
            payment_method  VARCHAR,
            items           JSONB,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS subscriptions (
            subscription_id   SERIAL PRIMARY KEY,
            private_user_id   INTEGER NOT NULL REFERENCES private_users(private_user_id) ON DELETE CASCADE,
            description       VARCHAR NOT NULL,
            amount            FLOAT NOT NULL,
            currency          VARCHAR(3) DEFAULT 'MUR',
            subscription_date DATE,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS loans (
            loan_id         SERIAL PRIMARY KEY,
            private_user_id INTEGER NOT NULL REFERENCES private_users(private_user_id) ON DELETE CASCADE,
            description     VARCHAR NOT NULL,
            amount          FLOAT NOT NULL,
            currency        VARCHAR(3) DEFAULT 'MUR',
            start_date      DATE,
            due_date        DATE,
            status          VARCHAR(20) DEFAULT 'active',
            repaid_amount   FLOAT DEFAULT 0.0,
            is_recurrent    BOOLEAN NOT NULL DEFAULT FALSE,
            duration_months INTEGER,
            payment_frequency VARCHAR(20),
            interest_rate   FLOAT,
            lender_name     VARCHAR,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS repayments (
            repayment_id SERIAL PRIMARY KEY,
            loan_id      INTEGER NOT NULL REFERENCES loans(loan_id) ON DELETE CASCADE,
            amount       FLOAT NOT NULL,
            payment_date DATE NOT NULL,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS rents (
            rent_id         SERIAL PRIMARY KEY,
            private_user_id INTEGER NOT NULL REFERENCES private_users(private_user_id) ON DELETE CASCADE,
            description     VARCHAR NOT NULL,
            amount          FLOAT NOT NULL,
            currency        VARCHAR(3) DEFAULT 'MUR',
            landlord_name   VARCHAR,
            property_address VARCHAR,
            due_day         INTEGER,
            is_recurring    BOOLEAN NOT NULL DEFAULT TRUE,
            status          VARCHAR(20) DEFAULT 'active',
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS budget_goals (
            budget_id       SERIAL PRIMARY KEY,
            private_user_id INTEGER NOT NULL REFERENCES private_users(private_user_id) ON DELETE CASCADE,
            category        VARCHAR NOT NULL,
            monthly_limit   FLOAT NOT NULL,
            currency        VARCHAR(3) DEFAULT 'MUR',
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now(),
            CONSTRAINT uq_budget_category UNIQUE (private_user_id, category)
        )
    """)

    # ------------------------------------------------------------------
    # Scheduling
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE IF NOT EXISTS schedules (
            schedule_id SERIAL PRIMARY KEY,
            title       VARCHAR NOT NULL,
            company_id  INTEGER NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
            location    VARCHAR NOT NULL,
            hours       VARCHAR,
            notes       VARCHAR,
            status      VARCHAR(20) NOT NULL DEFAULT 'pending',
            start_time  TIMESTAMP NOT NULL,
            end_time    TIMESTAMP NOT NULL,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS schedule_assignments (
            schedule_id     INTEGER NOT NULL REFERENCES schedules(schedule_id) ON DELETE CASCADE,
            private_user_id INTEGER NOT NULL REFERENCES private_users(private_user_id) ON DELETE CASCADE,
            PRIMARY KEY (schedule_id, private_user_id)
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS schedule_assignee_statuses (
            schedule_id     INTEGER NOT NULL REFERENCES schedules(schedule_id) ON DELETE CASCADE,
            private_user_id INTEGER NOT NULL REFERENCES private_users(private_user_id) ON DELETE CASCADE,
            status          VARCHAR(20) NOT NULL DEFAULT 'pending',
            updated_at      TIMESTAMPTZ DEFAULT now(),
            PRIMARY KEY (schedule_id, private_user_id)
        )
    """)

    # ------------------------------------------------------------------
    # Leave management
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE IF NOT EXISTS leaves (
            leave_id        SERIAL PRIMARY KEY,
            private_user_id INTEGER NOT NULL REFERENCES private_users(private_user_id),
            leave_type      VARCHAR NOT NULL,
            start_date      DATE NOT NULL,
            end_date        DATE NOT NULL,
            status          VARCHAR NOT NULL DEFAULT 'pending',
            notes           VARCHAR,
            approved_by     INTEGER REFERENCES users(user_id),
            approved_at     TIMESTAMPTZ,
            rejection_reason  VARCHAR,
            approver_comments VARCHAR,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS leave_quotas (
            quota_id        SERIAL PRIMARY KEY,
            private_user_id INTEGER NOT NULL REFERENCES private_users(private_user_id) ON DELETE CASCADE,
            leave_type      VARCHAR NOT NULL,
            total_days      INTEGER NOT NULL DEFAULT 0,
            used_days       INTEGER NOT NULL DEFAULT 0,
            year            INTEGER NOT NULL,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now(),
            CONSTRAINT uq_leave_quota UNIQUE (private_user_id, leave_type, year)
        )
    """)

    # ------------------------------------------------------------------
    # Sector / wage reference tables
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE IF NOT EXISTS sectors (
            sector_id    SERIAL PRIMARY KEY,
            name         VARCHAR NOT NULL,
            description  VARCHAR,
            country_code VARCHAR(2) NOT NULL DEFAULT 'MU' REFERENCES countries(code),
            currency     VARCHAR(10) NOT NULL DEFAULT 'MUR',
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now(),
            CONSTRAINT uq_sector_name_country UNIQUE (name, country_code)
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS sector_categories (
            id        SERIAL PRIMARY KEY,
            sector_id INTEGER NOT NULL REFERENCES sectors(sector_id) ON DELETE CASCADE,
            name      VARCHAR NOT NULL,
            currency  VARCHAR(3) DEFAULT 'MUR',
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS sector_grades (
            id                 SERIAL PRIMARY KEY,
            sector_id          INTEGER NOT NULL REFERENCES sectors(sector_id) ON DELETE CASCADE,
            sector_category_id INTEGER NOT NULL REFERENCES sector_categories(id) ON DELETE CASCADE,
            grade              VARCHAR,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS sector_category_salaries (
            id                   SERIAL PRIMARY KEY,
            sector_category_id   INTEGER NOT NULL REFERENCES sector_categories(id) ON DELETE CASCADE,
            sector_grade_id      INTEGER REFERENCES sector_grades(id) ON DELETE SET NULL,
            min_years_of_service INTEGER,
            max_years_of_service INTEGER,
            effective_from       DATE,
            basic_monthly_salary NUMERIC(12,2),
            basic_daily_salary   NUMERIC(12,2),
            hourly_rate          NUMERIC(12,2),
            productivity         NUMERIC(12,2),
            unit                 VARCHAR,
            notes                VARCHAR,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now()
        )
    """)

    # ------------------------------------------------------------------
    # Audit / logging
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE IF NOT EXISTS audit_logs (
            id            SERIAL PRIMARY KEY,
            actor_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
            action        VARCHAR(255) NOT NULL,
            target_type   VARCHAR(100),
            target_id     VARCHAR(100),
            meta          JSONB,
            created_at    TIMESTAMPTZ DEFAULT now()
        )
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS request_logs (
            id         SERIAL PRIMARY KEY,
            user_id    INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
            platform   VARCHAR(50),
            user_agent VARCHAR(500),
            ip_address VARCHAR(50),
            method     VARCHAR(10),
            path       VARCHAR(255),
            created_at TIMESTAMPTZ DEFAULT now()
        )
    """)

    # ------------------------------------------------------------------
    # Documents
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE IF NOT EXISTS document_vault (
            doc_id          SERIAL PRIMARY KEY,
            private_user_id INTEGER NOT NULL REFERENCES private_users(private_user_id) ON DELETE CASCADE,
            doc_type        VARCHAR(50)  NOT NULL,
            name            VARCHAR(255) NOT NULL,
            expiry_date     VARCHAR(20),
            notes           VARCHAR,
            file_url        VARCHAR,
            file_name       VARCHAR(255),
            file_mime       VARCHAR(100),
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now()
        )
    """)

    # ------------------------------------------------------------------
    # Public holidays reference table
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE IF NOT EXISTS public_holidays (
            holiday_id   SERIAL PRIMARY KEY,
            country_code VARCHAR(3) NOT NULL,
            name         VARCHAR NOT NULL,
            date         DATE NOT NULL,
            year         INTEGER NOT NULL,
            is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
            created_at   TIMESTAMPTZ DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_public_holidays_country_code ON public_holidays (country_code)")

    # ------------------------------------------------------------------
    # Alembic version table bootstrap:
    # If the table doesn't exist yet (truly fresh DB), alembic will create
    # it itself and stamp it.  Nothing to do here.
    # ------------------------------------------------------------------


def downgrade() -> None:
    # The squash baseline cannot be rolled back — the old individual migration
    # files no longer exist.  Raising an error prevents accidental downgrade.
    raise NotImplementedError(
        "Downgrade from squash_2026_04_06 is not supported. "
        "Restore a database backup to roll back to a previous state."
    )
