from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Index
from sqlalchemy.sql import func
from core.base_class import Base


class PlatformInvite(Base):
    __tablename__ = "platform_invites"

    invite_id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String(255), nullable=False, index=True)
    role_name = Column(String(100), ForeignKey("platform_roles.name", ondelete="CASCADE"), nullable=False)
    token = Column(String(255), unique=True, nullable=False)
    status = Column(String(20), nullable=False, server_default='pending', index=True)  # pending, accepted, expired, revoked
    expires_at = Column(DateTime(timezone=True), nullable=False)
    invited_by = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    accepted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
