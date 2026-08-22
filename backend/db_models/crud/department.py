from sqlalchemy.orm import Session
from typing import List, Optional
from fastapi import HTTPException, status
from core.model import Department, Company


def create_department(company_id: int, name: str, db: Session) -> Department:
    # enforce uniqueness per company
    existing = db.query(Department).filter(Department.company_id == company_id, Department.name.ilike(name)).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Department with this name already exists for the company")
    dept = Department(company_id=company_id, name=name)
    db.add(dept)
    db.commit()
    db.refresh(dept)
    return dept


def get_department_by_id(department_id: int, db: Session) -> Optional[Department]:
    return db.query(Department).filter(Department.department_id == department_id).first()


def get_departments_by_company(company_id: int, db: Session) -> List[Department]:
    return db.query(Department).filter(Department.company_id == company_id).order_by(Department.name.asc()).all()


def update_department(department_id: int, name: str, db: Session) -> Optional[Department]:
    dept = db.query(Department).filter(Department.department_id == department_id).first()
    if not dept:
        return None
    # Check for unique name in company
    existing = db.query(Department).filter(Department.company_id == dept.company_id, Department.department_id != department_id, Department.name.ilike(name)).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Another department with this name exists for the company")
    dept.name = name
    db.commit()
    db.refresh(dept)
    return dept


def delete_department(department_id: int, db: Session) -> bool:
    dept = db.query(Department).filter(Department.department_id == department_id).first()
    if not dept:
        return False
    db.delete(dept)
    db.commit()
    return True
