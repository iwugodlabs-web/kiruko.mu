from sqlalchemy.orm import Session
from core.model import Repayment, Loan
from schema.user_schema import Repayment as RepaymentModel
from typing import List, Optional
from fastapi import HTTPException, status

def create_repayment(repayment_data: RepaymentModel, db: Session) -> Repayment:
    """Create a new repayment record and update the associated loan."""
    # Find the loan to update
    loan = db.query(Loan).filter(Loan.loan_id == repayment_data.loan_id).first()
    if not loan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found")

    repayment = Repayment(
        loan_id=repayment_data.loan_id,
        amount=repayment_data.amount,
        payment_date=repayment_data.payment_date
    )
    db.add(repayment)

    # Update the loan's repaid amount
    loan.repaid_amount = (loan.repaid_amount or 0) + repayment_data.amount

    if loan.repaid_amount >= loan.amount:
        loan.status = 'paid'

    db.commit()
    db.refresh(repayment)
    return repayment

def get_repayment_by_id(repayment_id: int, db: Session) -> Optional[Repayment]:
    """Get a repayment by its ID"""
    return db.query(Repayment).filter(Repayment.repayment_id == repayment_id).first()

def get_repayments_by_loan(loan_id: int, db: Session) -> List[Repayment]:
    """Get all repayments for a loan"""
    return db.query(Repayment).filter(Repayment.loan_id == loan_id).all()

def update_repayment(repayment_id: int, update_data: dict, db: Session) -> Optional[Repayment]:
    """Update a repayment record"""
    repayment = db.query(Repayment).filter(Repayment.repayment_id == repayment_id).first()
    if not repayment:
        return None
    for key, value in update_data.items():
        setattr(repayment, key, value)
    db.commit()
    db.refresh(repayment)
    return repayment

def delete_repayment(repayment_id: int, db: Session) -> bool:
    """Delete a repayment record"""
    repayment = db.query(Repayment).filter(Repayment.repayment_id == repayment_id).first()
    if not repayment:
        return False
    db.delete(repayment)
    db.commit()
    return True
