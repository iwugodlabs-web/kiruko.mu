from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime, timezone
from pydantic import BaseModel
from core import config
from core.dependencies import get_current_user
from core.model import Notification, NotificationRecipient, User
from schema.user_schema import Notification as NotificationSchema
import logging

# Preference categories (match the web `tabForType` + the backend
# `_category_for_type`). A missing row means both channels are on.
NOTIFICATION_CATEGORIES = ["leave", "overtime", "attendance", "compliance", "disputes", "general"]


class PreferenceItem(BaseModel):
    category: str
    in_app: bool = True
    push: bool = True


class PreferencesPayload(BaseModel):
    preferences: List[PreferenceItem]

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/notification",
    tags=['Notifications']
)


def serialize_notification(event: Notification, recipient: NotificationRecipient) -> dict:
    """Build the wire shape (unchanged from the pre-normalization response):
    event fields + the CALLER's own `user_id` / `is_read` from their recipient
    row. Keeps web + mobile clients working without changes."""
    related = None
    if isinstance(event.meta, dict):
        related = event.meta.get("related_entity_id")
    return {
        "notification_id": event.notification_id,
        "user_id": recipient.user_id,
        "title": event.title,
        "message": event.message,
        "type": event.type,
        "notification_type": event.type,
        "is_read": bool(recipient.is_read),
        "meta": event.meta,
        "related_entity_id": related,
        "created_at": event.created_at,
    }


@router.get('', status_code=200, response_model=List[NotificationSchema])
async def get_notifications(
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user)
):
    """Retrieve all in-app notifications for the current user."""
    try:
        rows = (
            db.query(Notification, NotificationRecipient)
            .join(NotificationRecipient, NotificationRecipient.notification_id == Notification.notification_id)
            .filter(NotificationRecipient.user_id == current_user.user_id)
            .order_by(Notification.created_at.desc())
            .all()
        )
        return [serialize_notification(event, recipient) for (event, recipient) in rows]
    except Exception as e:
        logger.error(f"Error fetching notifications: {e}")
        raise HTTPException(status_code=500, detail="Could not fetch notifications")


@router.put('/{notification_id}/read', status_code=200)
async def mark_notification_read(
    notification_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user)
):
    """Mark the caller's copy of a notification as read. With per-user read
    state, a user can only mark their OWN recipient row."""
    try:
        recipient = db.query(NotificationRecipient).filter(
            NotificationRecipient.notification_id == notification_id,
            NotificationRecipient.user_id == current_user.user_id,
        ).first()
        if not recipient:
            raise HTTPException(status_code=404, detail="Notification not found")

        recipient.is_read = True
        recipient.read_at = datetime.now(timezone.utc)
        db.commit()
        return {"status": "success", "message": "Notification marked as read"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error marking notification read: {e}")
        raise HTTPException(status_code=500, detail="Could not update notification")


@router.put('/read-all', status_code=200)
async def mark_all_notifications_read(
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user)
):
    """Mark all of the caller's notifications as read."""
    try:
        db.query(NotificationRecipient).filter(
            NotificationRecipient.user_id == current_user.user_id,
            NotificationRecipient.is_read == False,
        ).update(
            {"is_read": True, "read_at": datetime.now(timezone.utc)},
            synchronize_session=False,
        )
        db.commit()
        return {"status": "success", "message": "All notifications marked as read"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error marking all notifications read: {e}")
        raise HTTPException(status_code=500, detail="Could not update notifications")


@router.delete('/{notification_id}', status_code=200)
async def dismiss_notification(
    notification_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user)
):
    """Dismiss (delete) the caller's copy of a notification. The shared event
    row is left for other recipients; orphaned events are swept by retention."""
    try:
        recipient = db.query(NotificationRecipient).filter(
            NotificationRecipient.notification_id == notification_id,
            NotificationRecipient.user_id == current_user.user_id,
        ).first()
        if not recipient:
            raise HTTPException(status_code=404, detail="Notification not found")

        db.delete(recipient)
        db.commit()
        return {"status": "success", "message": "Notification dismissed"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error dismissing notification: {e}")
        raise HTTPException(status_code=500, detail="Could not dismiss notification")


@router.delete('/', status_code=200)
async def dismiss_all_notifications(
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user)
):
    """Dismiss (delete) all of the caller's notifications."""
    try:
        db.query(NotificationRecipient).filter(
            NotificationRecipient.user_id == current_user.user_id
        ).delete(synchronize_session=False)
        db.commit()
        return {"status": "success", "message": "All notifications dismissed"}
    except Exception as e:
        logger.error(f"Error dismissing all notifications: {e}")
        raise HTTPException(status_code=500, detail="Could not dismiss notifications")


@router.get('/preferences', status_code=200)
async def get_notification_preferences(
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Return the caller's per-category delivery preferences. Categories with no
    stored row default to both channels on (opt-out model)."""
    from core.model import NotificationPreference
    existing = {
        p.category: p
        for p in db.query(NotificationPreference).filter(
            NotificationPreference.user_id == current_user.user_id
        ).all()
    }
    return {
        "preferences": [
            {
                "category": c,
                "in_app": existing[c].in_app if c in existing else True,
                "push": existing[c].push if c in existing else True,
            }
            for c in NOTIFICATION_CATEGORIES
        ]
    }


@router.put('/preferences', status_code=200)
async def update_notification_preferences(
    payload: PreferencesPayload,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user),
):
    """Upsert the caller's per-category delivery preferences."""
    from core.model import NotificationPreference
    try:
        for item in payload.preferences:
            if item.category not in NOTIFICATION_CATEGORIES:
                continue
            row = db.query(NotificationPreference).filter(
                NotificationPreference.user_id == current_user.user_id,
                NotificationPreference.category == item.category,
            ).first()
            if row:
                row.in_app = item.in_app
                row.push = item.push
            else:
                db.add(NotificationPreference(
                    user_id=current_user.user_id, category=item.category,
                    in_app=item.in_app, push=item.push,
                ))
        db.commit()
        return {"status": "success", "message": "Preferences updated"}
    except Exception as e:
        db.rollback()
        logger.error(f"Error updating notification preferences: {e}")
        raise HTTPException(status_code=500, detail="Could not update preferences")
