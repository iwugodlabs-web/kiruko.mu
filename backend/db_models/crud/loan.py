from sqlalchemy.orm import Session
from core.model import Loan
from schema.user_schema import CreateLoan
from typing import List, Optional

def create_loan(loan_data: CreateLoan, db: Session) -> Loan:
    """Create a new loan record"""
    loan = Loan(
        private_user_id=loan_data.private_user_id,
        description=loan_data.description,
        amount=loan_data.amount,
        currency=loan_data.currency,
        start_date=loan_data.start_date,
        status=loan_data.status,
        due_date=loan_data.due_date,
        repaid_amount=loan_data.repaid_amount,
        is_recurrent=loan_data.is_recurrent,
        duration_months=loan_data.duration_months,
        payment_frequency=loan_data.payment_frequency,
        interest_rate=loan_data.interest_rate,
        lender_name=loan_data.lender_name
    )
    db.add(loan)
    db.commit()
    db.refresh(loan)
    return loan

def get_loan_by_id(loan_id: int, db: Session) -> Optional[Loan]:
    """Get a loan by its ID"""
    return db.query(Loan).filter(Loan.loan_id == loan_id).first()

def get_all_loans(db: Session) -> List[Loan]:
    """Get all loans"""
    return db.query(Loan).all()

def update_loan(loan_id: int, update_data: dict, db: Session) -> Optional[Loan]:
    """Update a loan record"""
    loan = db.query(Loan).filter(Loan.loan_id == loan_id).first()
    if not loan:
        return None
    for key, value in update_data.items():
        setattr(loan, key, value)
    db.commit()
    db.refresh(loan)
    return loan

def delete_loan(loan_id: int, db: Session) -> bool:
    """Delete a loan record"""
    loan = db.query(Loan).filter(Loan.loan_id == loan_id).first()
    if not loan:
        return False
    db.delete(loan)
    db.commit()
    return True
