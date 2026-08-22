"""Seed default departments (Management, Operations) for all companies that don't have them yet.

Run with: python -m backend.scripts.seed_default_departments (or from project root: python backend/scripts/seed_default_departments.py)
"""

from sqlalchemy.orm import Session
from core.config import get_db
from core.model import Company
from db_models.crud import department as department_crud


def seed_default_departments():
    db: Session = next(get_db())
    companies = db.query(Company).all()
    for c in companies:
        try:
            existing = department_crud.get_departments_by_company(c.company_id, db)
            names = {d.name.lower() for d in existing}
            if 'management' not in names:
                try:
                    department_crud.create_department(c.company_id, 'Management', db)
                    print(f"Created 'Management' for company {c.company_id}")
                except Exception as e:
                    print(f"Skipping creation of 'Management' for company {c.company_id}: {e}")
            if 'operations' not in names:
                try:
                    department_crud.create_department(c.company_id, 'Operations', db)
                    print(f"Created 'Operations' for company {c.company_id}")
                except Exception as e:
                    print(f"Skipping creation of 'Operations' for company {c.company_id}: {e}")
        except Exception as e:
            print(f"Error processing company {c.company_id}: {e}")


if __name__ == '__main__':
    seed_default_departments()
    print('Seeding completed')
