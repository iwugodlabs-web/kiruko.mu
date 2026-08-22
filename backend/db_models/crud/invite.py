from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError
from core.platform_invite import PlatformInvite
from fastapi import HTTPException, status
from datetime import datetime, timedelta, timezone
import secrets
import os


def generate_invite_token() -> str:
    """Generate a secure random token for invites"""
    return secrets.token_urlsafe(32)


def create_invite(email: str, role_name: str, invited_by: int, db: Session) -> PlatformInvite:
    """Create a new platform invite"""
    # Check if there's already a pending invite for this email
    existing = db.query(PlatformInvite).filter(
        PlatformInvite.email == email,
        PlatformInvite.status == 'pending'
    ).first()
    
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A pending invitation already exists for this email"
        )
    
    # Generate token and expiration
    token = generate_invite_token()
    expiry_days = int(os.getenv('INVITE_EXPIRY_DAYS', '7'))
    expires_at = datetime.now(timezone.utc) + timedelta(days=expiry_days)
    
    # Create invite
    invite = PlatformInvite(
        email=email,
        role_name=role_name,
        token=token,
        status='pending',
        expires_at=expires_at,
        invited_by=invited_by
    )
    
    db.add(invite)
    db.commit()
    db.refresh(invite)
    return invite


def get_invite_by_token(token: str, db: Session) -> PlatformInvite | None:
    """Get invite by token"""
    return db.query(PlatformInvite).filter(PlatformInvite.token == token).first()


def get_invite_by_id(invite_id: int, db: Session) -> PlatformInvite | None:
    """Get invite by ID"""
    return db.query(PlatformInvite).filter(PlatformInvite.invite_id == invite_id).first()


def get_invite_by_transaction_id(invite_id: int, db: Session) -> PlatformInvite | None:
    return db.query(PlatformInvite).filter(PlatformInvite.invite_id == invite_id).first()


def get_invite_by_email(email: str, db: Session) -> PlatformInvite | None:
    """Get latest invite by email"""
    return db.query(PlatformInvite).filter(PlatformInvite.email == email).order_by(PlatformInvite.created_at.desc()).first()


def get_all_invites(db: Session, status_filter: str | None = None) -> list[PlatformInvite]:
    """Get all invites, optionally filtered by status"""
    query = db.query(PlatformInvite)
    
    if status_filter:
        query = query.filter(PlatformInvite.status == status_filter)
    
    return query.order_by(PlatformInvite.created_at.desc()).all()


def get_pending_invites(db: Session) -> list[PlatformInvite]:
    """Get all pending invites"""
    return get_all_invites(db, status_filter='pending')


def mark_invite_accepted(invite_id: int, db: Session) -> PlatformInvite:
    """Mark an invite as accepted"""
    invite = get_invite_by_id(invite_id, db)
    if not invite:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invite not found")
    
    invite.status = 'accepted'
    invite.accepted_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(invite)
    return invite


def revoke_invite(invite_id: int, db: Session) -> PlatformInvite:
    """Revoke a pending invite"""
    invite = get_invite_by_id(invite_id, db)
    if not invite:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invite not found")
    
    if invite.status != 'pending':
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot revoke invite with status '{invite.status}'"
        )
    
    invite.status = 'revoked'
    db.commit()
    db.refresh(invite)
    return invite


def check_and_expire_invites(db: Session) -> int:
    """Check for expired invites and mark them as expired. Returns count of expired invites."""
    now = datetime.now(timezone.utc)
    expired_invites = db.query(PlatformInvite).filter(
        PlatformInvite.status == 'pending',
        PlatformInvite.expires_at < now
    ).all()
    
    count = 0
    for invite in expired_invites:
        invite.status = 'expired'
        count += 1
    
    if count > 0:
        db.commit()
    
    return count


def validate_invite_token(token: str, db: Session) -> tuple[bool, str, PlatformInvite | None]:
    """
    Validate an invite token.
    Returns: (is_valid, error_message, invite)
    """
    invite = get_invite_by_token(token, db)
    
    if not invite:
        return False, "Invalid invitation token", None
    
    if invite.status != 'pending':
        return False, f"This invitation has been {invite.status}", None
    
    # Use aware comparison
    if invite.expires_at < datetime.now(timezone.utc):
        invite.status = 'expired'
        db.commit()
        return False, "This invitation has expired", None
    
    return True, "", invite
