
from sqlalchemy.orm import Session
from core.model import Transfer
from schema.user_schema import Transfer as TransferSchema
from typing import List, Optional

def get_transfer_by_id(transfer_id: int, db: Session) -> Optional[Transfer]:
    """Get a transfer by its ID"""
    return db.query(Transfer).filter(Transfer.transfer_id == transfer_id).first()

def get_all_transfers(db: Session) -> List[Transfer]:
    """Get all transfers"""
    return db.query(Transfer).all()

def update_transfer(transfer_id: int, update_data: dict, db: Session) -> Optional[Transfer]:
    """Update a transfer record"""
    transfer = db.query(Transfer).filter(Transfer.transfer_id == transfer_id).first()
    if not transfer:
        return None
    for key, value in update_data.items():
        setattr(transfer, key, value)
    db.commit()
    db.refresh(transfer)
    return transfer

def delete_transfer(transfer_id: int, db: Session) -> bool:
    """Delete a transfer record"""
    transfer = db.query(Transfer).filter(Transfer.transfer_id == transfer_id).first()
    if not transfer:
        return False
    db.delete(transfer)
    db.commit()
    return True

def create_transfer_transaction(transfer_data: TransferSchema, db: Session) -> TransferSchema:
    """Create a new transfer transaction"""
    transfer = Transfer(
        private_user_id=transfer_data.private_user_id,
        from_user=transfer_data.from_user,
        to_user=transfer_data.to_user,
        amount=transfer_data.amount,
        currency=transfer_data.currency,
        status=transfer_data.status
    )
    db.add(transfer)
    db.commit()
    db.refresh(transfer)
    return transfer