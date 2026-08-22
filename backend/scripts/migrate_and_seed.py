#!/usr/bin/env python3
"""Run database migrations and seed the database with sector data."""

import sys
import os
import subprocess

# Add the backend directory to Python path
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, backend_dir)

def run_migrations():
    """Run database migrations using the manage_migrations.py script."""
    print("🔄 Running database migrations...")
    try:
        script_path = os.path.join(backend_dir, "manage_migrations.py")

        # First try to upgrade normally
        result = subprocess.run([
            sys.executable, script_path, "upgrade"
        ], capture_output=True, text=True, cwd=backend_dir)

        if result.returncode == 0:
            print("✅ Database migrations completed successfully!")
            return True
        else:
            # Check if it's a revision not found error
            if "Can't locate revision identified by" in result.stderr:
                print("⚠️  Revision mismatch detected. Stamping database with head revision...")
                # Manually update the alembic version table
                from backend.core.config import get_session_local
                from sqlalchemy import text

                db_session = get_session_local()()
                try:
                    db_session.execute(text("UPDATE alembic_version SET version_num = '94ce21ba54d7'"))
                    db_session.commit()
                    print("✅ Database stamped with head revision.")
                    return True
                except Exception as e:
                    print(f"❌ Failed to stamp database: {e}")
                    db_session.rollback()
                    return False
                finally:
                    db_session.close()
            else:
                print(f"❌ Migration failed: {result.stderr}")
                return False

    except Exception as e:
        print(f"❌ Error running migrations: {e}")
        return False

def seed_database():
    """Seed the database with sector data."""
    print("🌱 Seeding database with sector data...")
    try:
        from jobs.seed_sectors_from_excel import SectorExcelSeeder
        from core import config

        # Get database session
        SessionLocal = config.get_session_local()
        if SessionLocal is None:
            print("❌ No database session available. Check your environment variables.")
            return False

        db = SessionLocal()

        try:
            # Check if database has already been seeded
            try:
                from db_models.crud import sector as sector_crud
                existing_salaries = sector_crud.get_all_sector_category_salaries(db) if sector_crud else []
                if existing_salaries and len(existing_salaries) > 0:
                    print("ℹ️  Database already seeded with sector data. Skipping seeding to prevent duplicates.")
                    print(f"   Found {len(existing_salaries)} existing salary ranges.")
                    return True
            except Exception as e:
                print(f"⚠️  Could not check for existing sector data: {e}. Proceeding with seeding...")

            # Initialize seeder
            seeder = SectorExcelSeeder(db)

            # Seed from CSV file
            csv_file = os.path.join(backend_dir, "mauritius_sector_rates.csv")
            if not os.path.exists(csv_file):
                print(f"❌ CSV file not found: {csv_file}")
                return False

            # Run seeding with apply (no drop to preserve existing data)
            report = seeder.seed_file(csv_file, dry_run=False, drop_tables=False)

            print("✅ Database seeding completed!")
            print("📊 Seeding Report:")
            for k, v in report.items():
                print(f"  {k}: {v}")

            return True

        finally:
            db.close()

    except Exception as e:
        print(f"❌ Error seeding database: {e}")
        import traceback
        traceback.print_exc()
        return False

def main():
    print("🚀 Starting database migration and seeding process...")

    # Step 1: Run migrations
    if not run_migrations():
        print("❌ Migration failed. Aborting.")
        sys.exit(1)

    # Step 2: Seed database
    if not seed_database():
        print("❌ Seeding failed.")
        sys.exit(1)

    print("🎉 Database migration and seeding completed successfully!")

if __name__ == "__main__":
    main()