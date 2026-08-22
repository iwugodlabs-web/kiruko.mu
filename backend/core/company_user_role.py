from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from core.base_class import Base

class CompanyUserRole(Base):
    __tablename__ = "company_user_roles"

    id = Column(Integer, primary_key=True, autoincrement=True)
    company_id = Column(Integer, ForeignKey("companies.company_id", ondelete="CASCADE"), nullable=False)
    private_user_id = Column(Integer, ForeignKey("private_users.private_user_id", ondelete="CASCADE"), nullable=False)
    role = Column(String(50), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    created_by = Column(Integer, nullable=True)

    __table_args__ = (
        UniqueConstraint('company_id', 'private_user_id', 'role', name='uq_company_private_role'),
    )

    # Relationships
    private_user = relationship("PrivateUser", back_populates="roles")
    company = relationship("Company", back_populates="user_roles")
