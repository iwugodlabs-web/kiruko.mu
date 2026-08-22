from sqlalchemy.orm import Session
from core.model import Transfer, Purchase, Subscription, Loan, Repayment, Rent
from typing import List

def get_transfers_by_user_id(db: Session, private_user_id: int) -> List[Transfer]:
    """Get all transfers for a specific user"""
    return db.query(Transfer).filter(Transfer.private_user_id == private_user_id).order_by(Transfer.created_at.desc()).all()

def get_purchases_by_user_id(db: Session, private_user_id: int) -> List[Purchase]:
    """Get all purchases for a specific user"""
    return db.query(Purchase).filter(Purchase.private_user_id == private_user_id).order_by(Purchase.created_at.desc()).all()

def get_subscriptions_by_user_id(db: Session, private_user_id: int) -> List[Subscription]:
    """Get all subscriptions for a specific user"""
    return db.query(Subscription).filter(Subscription.private_user_id == private_user_id).order_by(Subscription.subscription_date.desc()).all()

def get_loans_by_user_id(db: Session, private_user_id: int) -> List[Loan]:
    """Get all loans for a specific user"""
    return db.query(Loan).filter(Loan.private_user_id == private_user_id).order_by(Loan.start_date.desc()).all()

def get_repayments_by_loan_id(db: Session, loan_id: int) -> List[Repayment]:
    """Get all repayments for a specific loan"""
    return db.query(Repayment).filter(Repayment.loan_id == loan_id).order_by(Repayment.payment_date.desc()).all()

def get_rents_by_user_id(db: Session, private_user_id: int) -> List[Rent]:
    """Get all rents for a specific user"""
    return db.query(Rent).filter(Rent.private_user_id == private_user_id).order_by(Rent.created_at.desc()).all()

def get_financials_by_user_id(db: Session, private_user_id: int):
    loans_from_db = get_loans_by_user_id(db, private_user_id)
    loans_with_repayments = []
    for loan in loans_from_db:
        loan.repayments = get_repayments_by_loan_id(db, loan.loan_id)
        loans_with_repayments.append(loan)

    return {
        "transfers": get_transfers_by_user_id(db, private_user_id),
        "purchases": get_purchases_by_user_id(db, private_user_id),
        "subscriptions": get_subscriptions_by_user_id(db, private_user_id),
        "loans": loans_with_repayments,
        "rents": get_rents_by_user_id(db, private_user_id),
    }