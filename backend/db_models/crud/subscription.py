from sqlalchemy.orm import Session
from core.model import Subscription
from schema.user_schema import CreateSubscription
from typing import List, Optional

def create_subscription(subscription_data: CreateSubscription, db: Session) -> Subscription:
    """Create a new subscription record"""
    subscription = Subscription(
        private_user_id=subscription_data.private_user_id,
        description=subscription_data.description,
        amount=subscription_data.amount,
        currency=subscription_data.currency,
        subscription_date=subscription_data.subscription_date
    )
    db.add(subscription)
    db.commit()
    db.refresh(subscription)
    return subscription

def get_subscription_by_id(subscription_id: int, db: Session) -> Optional[Subscription]:
    """Get a subscription by its ID"""
    return db.query(Subscription).filter(Subscription.subscription_id == subscription_id).first()

def get_all_subscriptions(db: Session) -> List[Subscription]:
    """Get all subscriptions"""
    return db.query(Subscription).all()

def update_subscription(subscription_id: int, update_data: dict, db: Session) -> Optional[Subscription]:
    """Update a subscription record"""
    subscription = db.query(Subscription).filter(Subscription.subscription_id == subscription_id).first()
    if not subscription:
        return None
    for key, value in update_data.items():
        setattr(subscription, key, value)
    db.commit()
    db.refresh(subscription)
    return subscription

def delete_subscription(subscription_id: int, db: Session) -> bool:
    """Delete a subscription record"""
    subscription = db.query(Subscription).filter(Subscription.subscription_id == subscription_id).first()
    if not subscription:
        return False
    db.delete(subscription)
    db.commit()
    return True
