from sqlalchemy.orm import Session
from core.model import Purchase
from schema.user_schema import CreatePurchase
from typing import List, Optional

def create_purchase(purchase_data: CreatePurchase, db: Session) -> Purchase:
    """Create a new purchase record"""
    db_data = purchase_data.model_dump()
    purchase = Purchase(**db_data)
    db.add(purchase)
    db.commit()
    db.refresh(purchase)
    return purchase

def get_purchase_by_id(purchase_id: int, db: Session) -> Optional[Purchase]:
    """Get a purchase by its ID"""
    return db.query(Purchase).filter(Purchase.purchase_id == purchase_id).first()

def get_all_purchases(db: Session) -> List[Purchase]:
    """Get all purchases"""
    return db.query(Purchase).all()

def update_purchase(purchase_id: int, update_data: dict, db: Session) -> Optional[Purchase]:
    """Update a purchase record"""
    purchase = db.query(Purchase).filter(Purchase.purchase_id == purchase_id).first()
    if not purchase:
        return None
    for key, value in update_data.items():
        setattr(purchase, key, value)
    db.commit()
    db.refresh(purchase)
    return purchase

def delete_purchase(purchase_id: int, db: Session) -> bool:
    """Delete a purchase record"""
    purchase = db.query(Purchase).filter(Purchase.purchase_id == purchase_id).first()
    if not purchase:
        return False
    db.delete(purchase)
    db.commit()
    return True
