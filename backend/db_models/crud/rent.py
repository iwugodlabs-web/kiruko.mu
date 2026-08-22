from sqlalchemy.orm import Session
from core.model import Rent
from schema.user_schema import CreateRent
from typing import List, Optional


def create_rent(rent_data: CreateRent, db: Session) -> Rent:
    rent = Rent(
        private_user_id=rent_data.private_user_id,
        description=rent_data.description,
        amount=rent_data.amount,
        currency=rent_data.currency,
        landlord_name=rent_data.landlord_name,
        property_address=rent_data.property_address,
        due_day=rent_data.due_day,
        is_recurring=rent_data.is_recurring,
        status=rent_data.status,
    )
    db.add(rent)
    db.commit()
    db.refresh(rent)
    return rent


def get_rent_by_id(rent_id: int, db: Session) -> Optional[Rent]:
    return db.query(Rent).filter(Rent.rent_id == rent_id).first()


def get_rents_by_user(private_user_id: int, db: Session) -> List[Rent]:
    return db.query(Rent).filter(Rent.private_user_id == private_user_id).all()


def update_rent(rent_id: int, update_data: dict, db: Session) -> Optional[Rent]:
    rent = db.query(Rent).filter(Rent.rent_id == rent_id).first()
    if not rent:
        return None
    for key, value in update_data.items():
        setattr(rent, key, value)
    db.commit()
    db.refresh(rent)
    return rent


def delete_rent(rent_id: int, db: Session) -> bool:
    rent = db.query(Rent).filter(Rent.rent_id == rent_id).first()
    if not rent:
        return False
    db.delete(rent)
    db.commit()
    return True
