from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from core.base_class import Base


class PlatformRole(Base):
    __tablename__ = "platform_roles"

    role_id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), unique=True, nullable=False)
    description = Column(String(255), nullable=True)
    system = Column(Boolean, nullable=False, server_default='False')
    # Phase 2 — fine-grained platform permissions. Empty array = role
    # has only the legacy bypass semantics (e.g. seeded 'platform_admin').
    # See backend/core/platform_permissions.py for the catalogue.
    permissions = Column(JSONB, nullable=False, server_default="[]")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # relationships
    user_roles = relationship("UserPlatformRole", back_populates="role", cascade="all, delete-orphan")


class UserPlatformRole(Base):
    __tablename__ = "user_platform_roles"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    role_id = Column(Integer, ForeignKey("platform_roles.role_id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    created_by = Column(Integer, nullable=True)

    __table_args__ = (
        UniqueConstraint('user_id', 'role_id', name='uq_user_platform_role'),
    )

    # relationships
    role = relationship("PlatformRole", back_populates="user_roles")
