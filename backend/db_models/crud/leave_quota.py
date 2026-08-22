from sqlalchemy.orm import Session
from core.model import LeaveQuota
from schema.user_schema import CreateLeaveQuota
from typing import List, Optional


def create_leave_quota(data: CreateLeaveQuota, db: Session) -> LeaveQuota:
    quota = LeaveQuota(
        private_user_id=data.private_user_id,
        leave_type=data.leave_type,
        total_days=data.total_days,
        used_days=data.used_days,
        year=data.year,
    )
    db.add(quota)
    db.commit()
    db.refresh(quota)
    return quota


def get_leave_quotas_by_user(private_user_id: int, year: int, db: Session) -> List[LeaveQuota]:
    return db.query(LeaveQuota).filter(
        LeaveQuota.private_user_id == private_user_id,
        LeaveQuota.year == year,
    ).all()


def update_leave_quota(quota_id: int, update_data: dict, db: Session) -> Optional[LeaveQuota]:
    quota = db.query(LeaveQuota).filter(LeaveQuota.quota_id == quota_id).first()
    if not quota:
        return None
    for key, value in update_data.items():
        setattr(quota, key, value)
    db.commit()
    db.refresh(quota)
    return quota


def increment_used_days(private_user_id: int, leave_type: str, year: int, days: int, db: Session) -> Optional[LeaveQuota]:
    quota = db.query(LeaveQuota).filter(
        LeaveQuota.private_user_id == private_user_id,
        LeaveQuota.leave_type == leave_type,
        LeaveQuota.year == year,
    ).first()
    if not quota:
        return None
    quota.used_days += days
    db.commit()
    db.refresh(quota)
    return quota
