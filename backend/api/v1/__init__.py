from fastapi import APIRouter
from . import (
    user, job, dashboard, financials, password_reset,
    sector, company, admin, invite, scan_receipt,
    verification, department, notification, reports, company_roles,
    payroll_rules, profile_lock, payroll, leave_types, one_off_allowances,
    salary_structures, auth_step_up, bonus_liability, time_log_review,
    payslip_estimate, concerns_portal, announcements, sponsored,
    kiosk,
    auth_otp,
    employee_import,
    account_claim,
    country_assignments,
    geocode,
)

router = APIRouter()

router.include_router(user.router)
router.include_router(job.router)
router.include_router(dashboard.router)
router.include_router(sector.router)
router.include_router(financials.router)
router.include_router(password_reset.router, prefix="/password", tags=["Password Reset"])
router.include_router(department.router)
router.include_router(company.router)
router.include_router(admin.router)
router.include_router(invite.router)
router.include_router(scan_receipt.router)
router.include_router(verification.router)
router.include_router(notification.router)
router.include_router(reports.router)
router.include_router(company_roles.router)
router.include_router(payroll_rules.router)
router.include_router(profile_lock.router)
router.include_router(payroll.router)
router.include_router(leave_types.router)
router.include_router(one_off_allowances.router)
router.include_router(salary_structures.router)
router.include_router(auth_step_up.router)
router.include_router(bonus_liability.router)
router.include_router(time_log_review.router)
router.include_router(payslip_estimate.router)
router.include_router(concerns_portal.router)
router.include_router(announcements.router)
router.include_router(sponsored.router)
router.include_router(kiosk.router)
router.include_router(auth_otp.router)
router.include_router(employee_import.router)
router.include_router(account_claim.router)
router.include_router(country_assignments.router)
router.include_router(geocode.router)
