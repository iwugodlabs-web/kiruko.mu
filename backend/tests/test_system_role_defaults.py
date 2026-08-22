"""Default permission sets for the seeded company SYSTEM_ROLES.

Pure-data tests (no DB): they lock in the fresh-company defaults so a future
edit can't silently (a) introduce a typo'd permission code, (b) hand a non-admin
role the legally-sensitive compliance/disputes or role-management surfaces, or
(c) regress the HR Manager onboarding default back to empty.
"""
from api.v1.company_roles import SYSTEM_ROLES, PERMISSION_GROUPS

CATALOGUE = {p for group in PERMISSION_GROUPS.values() for p in group}
ROLES = {r["name"]: set(r["permissions"]) for r in SYSTEM_ROLES}

# Surfaces that must stay Owner/Admin-only on every non-admin management role.
FAIL_CLOSED = {
    "view_compliance", "export_compliance", "send_reminder",        # Compliance
    "view_disputes", "assign_dispute", "resolve_dispute", "export_audit",  # Disputes
    "view_roles", "create_role", "edit_role", "delete_role",        # Role Management
}
HARD_DELETES = {"delete_employee", "delete_department", "delete_schedule", "delete_documents"}
NON_ADMIN_ROLES = ["HR Manager", "Department Manager", "Supervisor"]


def test_every_permission_exists_in_catalogue():
    for name, perms in ROLES.items():
        unknown = perms - CATALOGUE
        assert not unknown, f"{name} has codes not in the catalogue: {sorted(unknown)}"


def test_owner_has_everything_admin_all_but_delete_role():
    assert ROLES["Owner"] == CATALOGUE
    assert ROLES["Company Admin"] == CATALOGUE - {"delete_role"}


def test_non_admin_roles_are_fail_closed_on_sensitive_surfaces():
    for name in NON_ADMIN_ROLES:
        leaked = ROLES[name] & FAIL_CLOSED
        assert not leaked, f"{name} must not hold sensitive perms by default: {sorted(leaked)}"
        deletes = ROLES[name] & HARD_DELETES
        assert not deletes, f"{name} must not hold hard-delete perms by default: {sorted(deletes)}"


def test_hr_manager_is_a_full_payroll_operator():
    hr = ROLES["HR Manager"]
    # No onboarding cliff — must be non-empty and cover people-ops + payroll.
    assert hr, "HR Manager default must not be empty"
    must_have = {
        "view_employee", "create_employee", "edit_employee", "onboard_employee",
        "view_attendance", "edit_hours", "view_leave", "approve_leave",
        "view_overtime", "approve_overtime",
        "view_salary", "edit_salary", "manage_payroll", "finalize_payroll",
        "view_reports",
    }
    missing = must_have - hr
    assert not missing, f"HR Manager missing expected perms: {sorted(missing)}"


def test_department_manager_and_supervisor_have_no_payroll_or_salary():
    payroll_salary = {
        "view_salary", "edit_salary", "manage_payroll", "finalize_payroll",
        "view_payslip", "export_payroll", "manage_allowances", "manage_salary_structures",
        "lock_payroll", "approve_deductions",
    }
    for name in ("Department Manager", "Supervisor"):
        assert not (ROLES[name] & payroll_salary), f"{name} should hold no payroll/salary perms"
