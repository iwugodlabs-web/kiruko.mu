from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError
from core.platform_role import PlatformRole, UserPlatformRole
from core.model import User
from fastapi import HTTPException, status


def get_or_create_role(name: str, description: str | None, db: Session) -> PlatformRole:
    role = db.query(PlatformRole).filter(PlatformRole.name == name).first()
    if role:
        return role
    role = PlatformRole(name=name, description=description or None, system=True)
    db.add(role)
    db.commit()
    db.refresh(role)
    return role


def assign_role_to_user(user_id: int, role_name: str, created_by: int | None, db: Session) -> UserPlatformRole:
    role = db.query(PlatformRole).filter(PlatformRole.name == role_name).first()
    if not role:
        role = get_or_create_role(role_name, None, db)

    # check existing
    existing = db.query(UserPlatformRole).filter(UserPlatformRole.user_id == user_id, UserPlatformRole.role_id == role.role_id).first()
    if existing:
        return existing

    upr = UserPlatformRole(user_id=user_id, role_id=role.role_id, created_by=created_by)
    db.add(upr)
    db.commit()
    db.refresh(upr)
    return upr


def user_has_role_by_user_id(user_id: int, role_name: str, db: Session) -> bool:
    return db.query(UserPlatformRole).join(PlatformRole).filter(UserPlatformRole.user_id == user_id, PlatformRole.name == role_name).count() > 0


def get_roles_for_user(user_id: int, db: Session) -> list:
    rows = db.query(PlatformRole.name).join(UserPlatformRole).filter(UserPlatformRole.user_id == user_id).all()
    return [r.name if hasattr(r, 'name') else r[0] for r in rows]


def get_users_by_platform_role(role_name: str, db: Session) -> list[User]:
    """Return every User who holds the named platform role. Used by
    notification fan-out (e.g. compliance_officer for external Your Right
    reports). Empty list if the role doesn't exist or has no members."""
    role = db.query(PlatformRole).filter(PlatformRole.name == role_name).first()
    if not role:
        return []
    return (
        db.query(User)
        .join(UserPlatformRole, UserPlatformRole.user_id == User.user_id)
        .filter(UserPlatformRole.role_id == role.role_id)
        .all()
    )


def get_all_roles(db: Session) -> list[PlatformRole]:
    """Get all platform roles"""
    return db.query(PlatformRole).all()


def get_role_by_id(role_id: int, db: Session) -> PlatformRole | None:
    """Get role by ID"""
    return db.query(PlatformRole).filter(PlatformRole.role_id == role_id).first()


def get_role_by_name(name: str, db: Session) -> PlatformRole | None:
    """Get role by name"""
    return db.query(PlatformRole).filter(PlatformRole.name == name).first()


def create_role(
    name: str,
    description: str | None,
    db: Session,
    permissions: list[str] | None = None,
) -> PlatformRole:
    """Create a new custom role (system=False).

    `permissions` is an optional list of platform permission codes from
    `core.platform_permissions.PERMISSION_GROUPS`. Caller is responsible
    for validating against the catalogue before passing in.
    """
    # Check if role already exists
    existing = get_role_by_name(name, db)
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Role with this name already exists")

    role = PlatformRole(
        name=name,
        description=description,
        system=False,
        permissions=list(permissions or []),
    )
    db.add(role)
    db.commit()
    db.refresh(role)
    return role


def set_role_permissions(role_id: int, permissions: list[str], db: Session) -> PlatformRole:
    """Replace a role's permission array. Allowed on both system and
    non-system roles (a platform admin may need to grant a freshly-added
    permission to the platform_admin role without re-seeding)."""
    role = get_role_by_id(role_id, db)
    if not role:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")
    role.permissions = list(permissions or [])
    db.commit()
    db.refresh(role)
    return role


def update_role(role_id: int, name: str | None, description: str | None, db: Session) -> PlatformRole:
    """Update a role (cannot update system roles)"""
    role = get_role_by_id(role_id, db)
    if not role:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")
    
    if role.system:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot modify system roles")
    
    if name and name != role.name:
        # Check if new name already exists
        existing = get_role_by_name(name, db)
        if existing:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Role with this name already exists")
        role.name = name
    
    if description is not None:
        role.description = description
    
    db.commit()
    db.refresh(role)
    return role


def delete_role(role_id: int, db: Session) -> bool:
    """Delete a role (cannot delete system roles or roles with assigned users)"""
    role = get_role_by_id(role_id, db)
    if not role:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")
    
    if role.system:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot delete system roles")
    
    # Check if any users have this role
    user_count = db.query(UserPlatformRole).filter(UserPlatformRole.role_id == role_id).count()
    if user_count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot delete role. {user_count} user(s) currently assigned to this role"
        )
    
    db.delete(role)
    db.commit()
    return True


def get_role_user_count(role_id: int, db: Session) -> int:
    """Get count of users assigned to a role"""
    return db.query(UserPlatformRole).filter(UserPlatformRole.role_id == role_id).count()


def remove_role_from_user(user_id: int, role_name: str, db: Session) -> bool:
    """Remove a role from a user"""
    role = get_role_by_name(role_name, db)
    if not role:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")
    
    user_role = db.query(UserPlatformRole).filter(
        UserPlatformRole.user_id == user_id,
        UserPlatformRole.role_id == role.role_id
    ).first()
    
    if not user_role:
        return False
    
    db.delete(user_role)
    db.commit()
    return True
