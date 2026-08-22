"""Platform-side permission catalogue + seed definitions.

Parallel to `PERMISSION_GROUPS` in `api/v1/company_roles.py`, but for the
PlatformRole tier. Used by the `/admin/permissions` endpoint and validated
on PUT `/admin/roles/{id}/permissions`.

The catalogue is intentionally narrower than company-side (~20 permissions
vs ~50) because the platform admin surface is smaller — see the plan in
`~/.claude/plans/as-a-senior-software-tranquil-ullman.md` section 2.2.

The two "cross-tier" permissions
(`act_on_behalf_of_company`, `read_any_company_data`) are load-bearing:
they govern whether a platform user can pass company-side gates. See
`require_company_permission` / `_cross_tier_bypass_allowed` in
`core/permission_guards.py`.
"""

from __future__ import annotations


PERMISSION_GROUPS: dict[str, list[str]] = {
    "Companies": [
        "view_companies",
        "manage_companies",
        "delete_company",
        "transfer_ownership",
    ],
    "Cross-tier (operate on employers)": [
        # Allows a platform user to pass company-side write guards on any
        # company. With PLATFORM_PERM_ENFORCEMENT=true, only users holding
        # this permission can finalize payroll, edit salaries, etc. on
        # customer companies.
        "act_on_behalf_of_company",
        # Read-only cross-tier — for support/compliance read access without
        # write authority.
        "read_any_company_data",
    ],
    "Users": [
        "view_platform_users",
        "manage_platform_users",
        "impersonate_user",
    ],
    "Roles": [
        "view_roles",
        "manage_roles",
        "assign_roles",
    ],
    "Payroll Rules": [
        "view_payroll_rules",
        "supersede_payroll_rules",
    ],
    "Audit & Compliance": [
        "view_audit_log",
        "manage_compliance_cases",
        "export_audit",
    ],
    "Sectors": [
        "view_sectors",
        "manage_sectors",
    ],
    "Platform Settings": [
        "view_platform_settings",
        "manage_platform_settings",
    ],
    "Sponsored Content": [
        "view_sponsored",
        "manage_sponsored",
    ],
}


def all_permissions() -> set[str]:
    """Flat set of every valid permission code."""
    return {p for perms in PERMISSION_GROUPS.values() for p in perms}


# Seeded role defaults — applied at deploy via the seed script (or in-tests
# manually). Existing platform_admin keeps full powers; new operational
# roles get scoped sets so a support agent doesn't accidentally get
# write authority over customer payroll.
SYSTEM_ROLE_DEFAULTS: list[dict] = [
    {
        "name": "platform_admin",
        "description": "Root. All permissions plus cross-tier write authority.",
        "permissions": sorted(all_permissions()),
    },
    {
        "name": "support",
        "description": "Customer support — read across companies, no writes.",
        "permissions": [
            "read_any_company_data",
            "view_companies",
            "view_platform_users",
            "view_audit_log",
        ],
    },
    {
        "name": "compliance_officer",
        "description": "Compliance case workflow + audit.",
        "permissions": [
            "read_any_company_data",
            "manage_compliance_cases",
            "view_audit_log",
            "export_audit",
            "view_companies",
        ],
    },
    {
        "name": "engineer",
        "description": "Engineering / SRE — all permissions except cross-tier write and destructive company actions.",
        "permissions": sorted(
            all_permissions() - {"act_on_behalf_of_company", "delete_company"}
        ),
    },
]


def seed_platform_roles(db) -> None:
    """Seed or update the system platform roles. Idempotent.

    - Creates roles that don't exist.
    - Updates `permissions` on existing system roles to the latest defaults
      (so adding a new permission to the catalogue automatically propagates
      to platform_admin and the operational roles).
    - Does NOT touch non-system roles (admin-customised platform roles).
    """
    from core.platform_role import PlatformRole

    for spec in SYSTEM_ROLE_DEFAULTS:
        existing = (
            db.query(PlatformRole).filter(PlatformRole.name == spec["name"]).one_or_none()
        )
        if existing is None:
            db.add(PlatformRole(
                name=spec["name"],
                description=spec["description"],
                system=True,
                permissions=spec["permissions"],
            ))
        else:
            # Refresh permissions + flag system on every seed so the latest
            # catalogue defaults always apply.
            existing.permissions = spec["permissions"]
            existing.system = True
            if not existing.description:
                existing.description = spec["description"]
    db.commit()
