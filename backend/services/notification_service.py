import logging
import requests
from decimal import Decimal
from typing import Optional, Dict, Any
from sqlalchemy.orm import Session
from core.model import Notification, User, UserType, Job, TimeLog, Company
from services.email_service import send_via_smtp
import os

logger = logging.getLogger(__name__)

class NotificationService:
    @staticmethod
    def send_expo_push(token: str, title: str, body: str, data: Optional[Dict[str, Any]] = None):
        """Sends a push notification via Expo Push API"""
        if not token:
            return False
            
        url = "https://exp.host/--/api/v2/push/send"
        payload = {
            "to": token,
            "title": title,
            "body": body,
            "data": data or {},
            "sound": "default",
            "priority": "high",
            "channelId": "default"
        }
        
        try:
            response = requests.post(url, json=payload, timeout=5)
            response.raise_for_status()
            logger.info(f"Push notification sent successfully to token {token[:10]}...")
            return True
        except Exception as e:
            logger.error(f"Failed to send Expo push notification: {e}")
            return False

    @staticmethod
    def create_notification(
        db: Session,
        user_id: int,
        title: str,
        message: str,
        notification_type: str,
        meta: Optional[Dict[str, Any]] = None,
        *,
        company_id: Optional[int] = None,
    ):
        """Create a single-recipient notification (back-compat entry point).
        Writes one event + one recipient row and pushes. Returns the event."""
        return NotificationService._create_event(
            db, [user_id], title, message, notification_type, meta, company_id=company_id,
        )

    @staticmethod
    def create_notification_fanout(
        db: Session,
        user_ids,
        title: str,
        message: str,
        notification_type: str,
        meta: Optional[Dict[str, Any]] = None,
        *,
        company_id: Optional[int] = None,
    ):
        """Create ONE event delivered to many recipients (deduped). Used by the
        permission-based fan-out. Returns the event."""
        return NotificationService._create_event(
            db, list(user_ids or []), title, message, notification_type, meta, company_id=company_id,
        )

    @staticmethod
    def _category_for_type(notification_type: str) -> str:
        """Map a notification type to a preference category (matches the web
        `tabForType`)."""
        t = (notification_type or "").lower()
        if "leave" in t:
            return "leave"
        if "overtime" in t:
            return "overtime"
        if "dispute" in t:
            return "disputes"
        if "concern" in t or "user_right" in t or "compliance" in t:
            return "compliance"
        if "time_log" in t or "clock" in t or "attendance" in t:
            return "attendance"
        return "general"

    @staticmethod
    def _create_event(
        db: Session,
        user_ids,
        title: str,
        message: str,
        notification_type: str,
        meta: Optional[Dict[str, Any]] = None,
        *,
        company_id: Optional[int] = None,
    ):
        """Write one Notification event + a NotificationRecipient row per
        (deduped, non-null) user_id that hasn't muted the in-app channel for
        this category, then enqueue a push for each that hasn't muted push.
        Returns the event row, or None on error / no eligible recipients."""
        from core.model import NotificationRecipient, NotificationPreference
        recipients = list(dict.fromkeys(uid for uid in (user_ids or []) if uid))
        if not recipients:
            return None

        # Per-user delivery preferences for this category (a missing row = both
        # channels on, i.e. opt-out).
        category = NotificationService._category_for_type(notification_type)
        prefs = {}
        try:
            for p in db.query(NotificationPreference).filter(
                NotificationPreference.user_id.in_(recipients),
                NotificationPreference.category == category,
            ).all():
                prefs[p.user_id] = p
        except Exception:
            prefs = {}

        def _in_app_on(uid):
            p = prefs.get(uid)
            return p is None or p.in_app

        def _push_on(uid):
            p = prefs.get(uid)
            return p is None or p.push

        in_app_recipients = [uid for uid in recipients if _in_app_on(uid)]
        if not in_app_recipients:
            return None  # everyone muted the in-app channel for this category

        try:
            event = Notification(
                title=title, message=message, type=notification_type,
                meta=meta, company_id=company_id,
            )
            db.add(event)
            db.flush()  # assign notification_id
            for uid in in_app_recipients:
                db.add(NotificationRecipient(notification_id=event.notification_id, user_id=uid))
            db.commit()
            db.refresh(event)
            logger.info(f"Notification {event.notification_id} created for {len(in_app_recipients)} recipient(s): {title}")
        except Exception as e:
            db.rollback()
            logger.error(f"Error creating notification: {e}")
            return None

        # Enqueue a push per recipient that has a token AND hasn't muted push.
        # Delivery happens in the push_queue background worker, so the request
        # thread never blocks on Expo (and pushes are retried / survive restart).
        from services import push_queue
        for uid in in_app_recipients:
            if not _push_on(uid):
                continue
            user = db.query(User).filter(User.user_id == uid).first()
            if user and user.expo_push_token:
                push_data = meta.copy() if isinstance(meta, dict) else {}
                push_data["notification_id"] = event.notification_id
                push_data["notification_type"] = notification_type
                push_queue.enqueue_push(
                    token=user.expo_push_token, title=title, body=message,
                    data=push_data, kind=notification_type,
                )
        return event

    @staticmethod
    def purge_old_notifications(db: Session, days: int = 90) -> int:
        """Retention sweep: delete READ recipient rows older than `days`, then
        any event rows left with no recipients (also older than `days`). Returns
        the number of recipient rows deleted. Cross-tenant system job; safe to
        run repeatedly (deletes nothing once caught up)."""
        from core.model import Notification, NotificationRecipient
        from datetime import datetime, timezone, timedelta
        from sqlalchemy import exists

        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        try:
            deleted = (
                db.query(NotificationRecipient)
                .filter(
                    NotificationRecipient.is_read == True,
                    NotificationRecipient.created_at < cutoff,
                )
                .delete(synchronize_session=False)
            )
            # Orphaned events (no recipients) older than the cutoff.
            has_recipient = exists().where(
                NotificationRecipient.notification_id == Notification.notification_id
            )
            db.query(Notification).filter(
                ~has_recipient,
                Notification.created_at < cutoff,
            ).delete(synchronize_session=False)
            db.commit()
            return deleted
        except Exception as e:
            db.rollback()
            logger.error(f"purge_old_notifications error: {e}")
            return 0

    @staticmethod
    def _members_with_permission(db: Session, company_id: int, permission: str) -> list:
        """user_ids of every company member whose assigned role grants
        `permission`, PLUS the company owner (Company.user_id), deduped. Used to
        fan an actionable notification to everyone allowed to act on it.
        Fail-closed: on any error returns just the owner (never broadens)."""
        from core.model import Company, CompanyRole, PrivateUser
        from core.company_user_role import CompanyUserRole

        def _norm(n):
            return str(n).strip().lower().replace(" ", "_")

        try:
            company = db.query(Company).filter(Company.company_id == company_id).first()
            result = set()
            if company and company.user_id:
                result.add(company.user_id)
            # Catalogue roles in this company that grant the permission.
            granting = {
                _norm(name)
                for (name, perms) in db.query(CompanyRole.name, CompanyRole.permissions)
                    .filter(CompanyRole.company_id == company_id).all()
                if perms and permission in perms
            }
            if granting:
                rows = db.query(CompanyUserRole.private_user_id, CompanyUserRole.role).filter(
                    CompanyUserRole.company_id == company_id
                ).all()
                matching = {r.private_user_id for r in rows if _norm(r.role) in granting}
                if matching:
                    for (uid,) in db.query(PrivateUser.user_id).filter(
                        PrivateUser.private_user_id.in_(matching)
                    ).all():
                        if uid:
                            result.add(uid)
            return list(result)
        except Exception as e:
            logger.error(f"_members_with_permission error: {e}")
            try:
                company = db.query(Company).filter(Company.company_id == company_id).first()
                return [company.user_id] if company and company.user_id else []
            except Exception:
                return []

    @staticmethod
    def notify_employer_overtime(db: Session, timelog: TimeLog, reason: Optional[str] = None):
        """Sends an email and in-app notification to the employer about overtime."""
        job = timelog.job
        if not job:
            logger.warning(f"No job found for timelog {timelog.timelog_id}")
            return False

        employee_name = f"{timelog.private_user.first_name} {timelog.private_user.last_name}"

        # 1. In-app notification — fan out to everyone who can act on overtime
        #    (view_overtime), plus the owner. (Previously owner-only.)
        recipients = NotificationService._members_with_permission(db, job.company_id, 'view_overtime')
        if recipients:
            reason_text = f" Reason: {reason}." if reason else ""
            session_date = timelog.start_time.strftime('%d %b %Y') if timelog.start_time else 'Unknown date'
            session_time = timelog.start_time.strftime('%H:%M') if timelog.start_time else ''
            hours = f"{float(timelog.hours_worked):.1f}h" if timelog.hours_worked else 'ongoing'
            NotificationService.create_notification_fanout(
                db=db,
                user_ids=recipients,
                title=f"Overtime Alert — {employee_name}",
                message=(
                    f"{employee_name} has flagged their session as overtime."
                    f" Job: {job.job_title} · Date: {session_date} {session_time}"
                    f" · Duration: {hours} · Session #{timelog.timelog_id}.{reason_text}"
                ),
                notification_type="overtime_alert",
                meta={"timelog_id": timelog.timelog_id, "job_id": job.job_id, "reason": reason},
                company_id=job.company_id,
            )

        # 2. Send Email to Employer
        if not job.employer_email:
            logger.warning(f"No employer email found for job {job.job_id}")
            return True # Still return true if in-app worked

        subject = f"Overtime Alert: {employee_name}"
        html = f"""
        <html>
        <body style="font-family: Arial, sans-serif; color: #333;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                <h2 style="color: #dc2626;">Overtime Notification</h2>
                <p>Your employee <strong>{employee_name}</strong> has marked their current session as overtime.</p>
                <div style="background-color: #f9fafb; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <p><strong>Job Title:</strong> {job.job_title}</p>
                    <p><strong>Clock In Time:</strong> {timelog.start_time.strftime('%Y-%m-%d %H:%M:%S') if timelog.start_time else 'N/A'}</p>
                </div>
                <p style="color: #d97706; background-color: #fffbeb; padding: 10px; border-radius: 5px; border-left: 4px solid #f59e0b;">
                    <strong>Warning:</strong> Overtime work usually requires additional compensation according to labor laws. Please review this session in your dashboard.
                </p>
                <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;"/>
                <p style="font-size: 12px; color: #999;">This is an automated alert from Ivor Mobile.</p>
            </div>
        </body>
        </html>
        """

        from services import email_queue
        job_id = email_queue.enqueue_email(
            job.employer_email, subject, html, kind="overtime_alert",
            meta={"timelog_id": timelog.timelog_id, "job_id": job.job_id},
        )
        if job_id is not None:
            logger.info(f"Employer overtime email enqueued (job={job_id}) for {job.employer_email}")
            return True
        logger.error(f"Failed to enqueue employer overtime email for {job.employer_email}")
        return False

    @staticmethod
    def notify_employee_overtime_confirmation(db: Session, timelog: TimeLog, reason: Optional[str] = None):
        """Sends a confirmation to the employee that their overtime has been recorded."""
        user_id = timelog.private_user.user_id
        employee_name = f"{timelog.private_user.first_name}"
        job = timelog.job
        job_title = job.job_title if job else 'your job'
        session_date = timelog.start_time.strftime('%d %b %Y') if timelog.start_time else 'Unknown date'
        session_time = timelog.start_time.strftime('%H:%M') if timelog.start_time else ''
        when = f"{session_date} at {session_time}" if session_time else session_date
        hours = f"{float(timelog.hours_worked):.1f}h" if timelog.hours_worked else 'in progress'
        reason_text = f" Reason logged: {reason}." if reason else ""

        NotificationService.create_notification(
            db=db,
            user_id=user_id,
            title="Overtime Requested",
            message=(
                f"Hi {employee_name}, your session starting {when} ({job_title}, {hours})"
                f" has been submitted as overtime and is awaiting employer approval.{reason_text}"
                f" Session #{timelog.timelog_id}."
            ),
            notification_type="overtime_confirmation",
            meta={"timelog_id": timelog.timelog_id, "reason": reason}
        )
        return True

    @staticmethod
    def notify_leave_status_change(db: Session, leave, action: str):
        """Notify the employee when their leave request is approved or rejected."""
        try:
            from core.model import PrivateUser
            private_user = db.query(PrivateUser).filter(
                PrivateUser.private_user_id == leave.private_user_id
            ).first()
            if not private_user:
                return

            user_id = private_user.user_id
            employee_name = private_user.first_name or "Employee"

            if action == 'approve':
                title = "Leave Approved ✓"
                message = f"Hi {employee_name}, your leave request ({leave.leave_type}) from {leave.start_date} to {leave.end_date} has been approved."
            else:
                reason_text = f" Reason: {leave.rejection_reason}." if leave.rejection_reason else ""
                title = "Leave Request Update"
                message = f"Hi {employee_name}, your leave request ({leave.leave_type}) from {leave.start_date} to {leave.end_date} was not approved.{reason_text}"

            NotificationService.create_notification(
                db=db,
                user_id=user_id,
                title=title,
                message=message,
                notification_type="leave_status_change",
                meta={"leave_id": leave.leave_id, "status": leave.status}
            )
        except Exception as e:
            logger.error(f"Failed to notify leave status change: {e}")

    @staticmethod
    def notify_employee_payslip_corrected(
        db: Session,
        *,
        private_user_id: int,
        adjustment,
        original,
        period_label: str,
        currency: str,
    ):
        """Notify the employee when a finalized payslip is corrected. The
        adjustment row carries the signed net DELTA; we tell the worker whether
        they're owed a top-up or face a claw-back and point them at the payslip.
        Best-effort: a notification failure must not roll back the correction."""
        try:
            from core.model import PrivateUser
            pu = db.query(PrivateUser).filter(
                PrivateUser.private_user_id == private_user_id
            ).first()
            if not pu:
                return
            name = pu.first_name or "there"
            net_delta = adjustment.net_pay or Decimal("0")
            amount = abs(net_delta)
            if net_delta >= 0:
                title = "Payslip corrected — top-up owed"
                message = (
                    f"Hi {name}, your {period_label} payslip was corrected. "
                    f"You are owed an additional {currency} {amount:,.2f}. "
                    "Open it to see the breakdown."
                )
            else:
                title = "Payslip corrected — adjustment"
                message = (
                    f"Hi {name}, your {period_label} payslip was corrected. "
                    f"It was reduced by {currency} {amount:,.2f}. "
                    "Open it to see the breakdown."
                )
            NotificationService.create_notification(
                db=db,
                user_id=pu.user_id,
                title=title,
                message=message,
                notification_type="payslip_corrected",
                meta={
                    "payslip_id": adjustment.id,
                    "original_payslip_id": original.id,
                    "payroll_run_id": adjustment.payroll_run_id,
                    "net_delta": str(net_delta),
                },
            )
        except Exception as e:
            logger.error(f"Failed to notify payslip correction: {e}")

    @staticmethod
    def notify_employee_overtime_confirmed(db: Session, timelog: TimeLog):
        """Notifies the employee that the employer has confirmed their overtime session."""
        user_id = timelog.private_user.user_id
        employee_name = f"{timelog.private_user.first_name}"
        job = timelog.job
        job_title = job.job_title if job else 'your job'
        session_date = timelog.start_time.strftime('%d %b %Y') if timelog.start_time else 'Unknown date'
        session_time = timelog.start_time.strftime('%H:%M') if timelog.start_time else ''
        hours = f"{float(timelog.hours_worked):.1f}h" if timelog.hours_worked else ''
        hours_text = f" · {hours}" if hours else ""

        NotificationService.create_notification(
            db=db,
            user_id=user_id,
            title="Overtime Approved ✓",
            message=(
                f"Hi {employee_name}, your overtime session has been approved."
                f" Job: {job_title} · {session_date} {session_time}{hours_text}."
                f" Session #{timelog.timelog_id}."
            ),
            notification_type="overtime_approved",
            meta={"timelog_id": timelog.timelog_id}
        )
        return True

    @staticmethod
    def notify_employee_overtime_rejected(db: Session, timelog: TimeLog):
        """Notifies the employee that the employer has rejected their overtime session."""
        user_id = timelog.private_user.user_id
        employee_name = f"{timelog.private_user.first_name}"
        job = timelog.job
        job_title = job.job_title if job else 'your job'
        session_date = timelog.start_time.strftime('%d %b %Y') if timelog.start_time else 'Unknown date'
        session_time = timelog.start_time.strftime('%H:%M') if timelog.start_time else ''
        hours = f"{float(timelog.hours_worked):.1f}h" if timelog.hours_worked else ''
        hours_text = f" · {hours}" if hours else ""

        NotificationService.create_notification(
            db=db,
            user_id=user_id,
            title="Overtime Not Approved",
            message=(
                f"Hi {employee_name}, your overtime session was not approved."
                f" Job: {job_title} · {session_date} {session_time}{hours_text}."
                f" Session #{timelog.timelog_id}."
                f" Please speak to your employer if you have questions."
            ),
            notification_type="overtime_rejected",
            meta={"timelog_id": timelog.timelog_id}
        )
        return True

    @staticmethod
    def notify_employer_leave_request(db: Session, leave) -> bool:
        """
        Notifies the company admin when an employee submits a new leave request.
        Triggered by POST /leave.
        """
        try:
            from core.model import PrivateUser, Job as JobModel, Company
            pu = db.query(PrivateUser).filter(
                PrivateUser.private_user_id == leave.private_user_id
            ).first()
            if not pu:
                return False

            employee_name = f"{pu.first_name} {pu.last_name}".strip() or "An employee"

            # Resolve company: prefer job-level company_id, fall back to PrivateUser.company_id
            job = next(
                (j for j in (pu.jobs or []) if j.company_id),
                None,
            )
            company_id = (job.company_id if job else None) or pu.company_id
            if not company_id:
                return False

            # Fan out to everyone who can act on leave (view_leave) + the owner.
            recipients = NotificationService._members_with_permission(db, company_id, 'view_leave')
            if not recipients:
                return False

            start = leave.start_date.strftime('%d %b %Y') if leave.start_date else '—'
            end = leave.end_date.strftime('%d %b %Y') if leave.end_date else '—'
            leave_type = (leave.leave_type or 'Leave').replace('_', ' ').title()
            notes_text = f" Note: {leave.notes}" if leave.notes else ""

            NotificationService.create_notification_fanout(
                db=db,
                user_ids=recipients,
                title=f"New Leave Request — {employee_name}",
                message=(
                    f"{employee_name} has submitted a {leave_type} request"
                    f" from {start} to {end}.{notes_text}"
                    f" Review it in the Leave section."
                ),
                notification_type="leave_request",
                meta={"leave_id": leave.leave_id, "private_user_id": leave.private_user_id},
                company_id=company_id,
            )
            return True
        except Exception as e:
            logger.error(f"notify_employer_leave_request error: {e}")
            return False

    @staticmethod
    def notify_payroll_run_employees_skipped(
        db: Session, company_id: int, run_id: int, skipped: list,
    ) -> bool:
        """Fans out to everyone who can manage payroll when create_draft_run
        excludes one or more employees due to a data error (e.g. overlapping
        clock-in records) instead of letting one bad record abort the whole
        run — see payroll_engine.create_draft_run's per-employee try/except.
        Without this, a skipped employee just sits in a run_flags string
        that nobody's necessarily looking at, and can be silently missed
        run after run. `skipped` is a list of
        {"private_user_id": int, "name": str, "reason": str} dicts.
        """
        try:
            if not skipped:
                return False
            recipients = NotificationService._members_with_permission(db, company_id, 'manage_payroll')
            if not recipients:
                return False

            names = ", ".join(s["name"] for s in skipped[:5])
            more = f" and {len(skipped) - 5} more" if len(skipped) > 5 else ""

            NotificationService.create_notification_fanout(
                db=db,
                user_ids=recipients,
                title=f"Payroll run: {len(skipped)} employee(s) skipped",
                message=(
                    f"{names}{more} could not be included in this payroll run "
                    f"because of a data problem with their clock-in records "
                    f"(most likely overlapping/conflicting entries). Fix the "
                    f"record(s) in Time Logs, then re-run payroll for them."
                ),
                notification_type="payroll_run_employees_skipped",
                meta={"payroll_run_id": run_id, "skipped": skipped},
                company_id=company_id,
            )
            return True
        except Exception as e:
            logger.error(f"notify_payroll_run_employees_skipped error: {e}")
            return False

    # ──────────────────────────────────────────────────────────────────────
    # Your Right (employee rights report) notifications — plan Phase 10 / 11
    # ──────────────────────────────────────────────────────────────────────

    @staticmethod
    def _resolve_company_admin(db: Session, private_user_id: int):
        """Resolve PrivateUser → Company → company-admin User. Returns the
        admin User or None. Used by every notify_employer_* helper for
        Your Right and similar grievance flows."""
        from core.model import PrivateUser, Company, User as UserModel, UserType
        pu = db.query(PrivateUser).filter(
            PrivateUser.private_user_id == private_user_id
        ).first()
        if not pu:
            return None, None
        job = next((j for j in (pu.jobs or []) if j.company_id), None)
        company_id = (job.company_id if job else None) or pu.company_id
        if not company_id:
            return None, None
        company = db.query(Company).filter(Company.company_id == company_id).first()
        if not company or not company.user_id:
            return None, company_id
        admin = db.query(UserModel).filter(
            UserModel.user_id == company.user_id,
            UserModel.user_type == UserType.company,
        ).first()
        return admin, company_id

    @staticmethod
    def notify_employer_user_right_report(db: Session, user_right) -> bool:
        """Notify the company admin when an employee files an INTERNAL Your
        Right report. External-channel reports must NOT call this — they
        route to compliance officers instead via
        `notify_compliance_user_right_external`."""
        try:
            # External reports never notify the employer — the whole point
            # of the external channel is the case where the employer IS the
            # subject of the complaint.
            if getattr(user_right, "channel", "internal") == "external":
                return False

            employee_name = "An employee"
            try:
                from core.model import PrivateUser
                pu = db.query(PrivateUser).filter(
                    PrivateUser.private_user_id == user_right.private_user_id
                ).first()
                if pu:
                    employee_name = f"{pu.first_name} {pu.last_name}".strip() or employee_name
                    # Anonymity opt-in: never reveal employee identity to the
                    # company admin when the employee chose to file anonymously.
                    if getattr(user_right, "is_anonymous", False):
                        employee_name = "An employee (anonymous)"
            except Exception:
                pass

            company_admin, _ = NotificationService._resolve_company_admin(
                db, user_right.private_user_id
            )
            if not company_admin:
                return False

            urgency = (user_right.urgency_level or "normal").lower()
            urgency_tag = "🚨 URGENT — " if urgency in ("urgent", "high", "critical") else ""

            NotificationService.create_notification(
                db=db,
                user_id=company_admin.user_id,
                # Plan §Notification copy handler-facing table:
                # "New concern filed — case #{id}". Named cases include the
                # employee name (substitution above already masks anonymous
                # filings as "An employee (anonymous)").
                title=f"{urgency_tag}New concern filed — case #{user_right.right_id}",
                message=(
                    f"{employee_name} filed a {urgency} concern: "
                    f"{(user_right.title or 'Untitled')[:80]}. "
                    f"Review it in the Concerns dashboard."
                ),
                notification_type="user_right_report",
                meta={
                    "user_right_id": user_right.right_id,
                    "private_user_id": user_right.private_user_id,
                    "urgency": urgency,
                },
            )
            return True
        except Exception as e:
            logger.error(f"notify_employer_user_right_report error: {e}")
            return False

    @staticmethod
    def notify_employee_user_right_status_change(db: Session, user_right, action: str) -> bool:
        """Notify the employee when their Your Right report's status changes
        (in_progress / resolved / rejected). Closes the feedback loop so
        people stop wondering whether their complaint went anywhere."""
        try:
            from core.model import PrivateUser, User as UserModel
            pu = db.query(PrivateUser).filter(
                PrivateUser.private_user_id == user_right.private_user_id
            ).first()
            if not pu:
                return False
            employee_user = db.query(UserModel).filter(
                UserModel.user_id == pu.user_id
            ).first() if pu.user_id else None
            if not employee_user:
                return False

            action_norm = (action or user_right.status or "updated").lower()
            verb_map = {
                "in_progress": "is now being reviewed",
                "resolved": "has been marked as RESOLVED",
                "rejected": "has been marked as REJECTED",
                "pending": "is awaiting review",
            }
            verb = verb_map.get(action_norm, f"was updated to '{action_norm}'")

            resolution_excerpt = ""
            if action_norm in ("resolved", "rejected") and getattr(user_right, "resolution", None):
                resolution_excerpt = f" Resolution note: {(user_right.resolution or '')[:120]}"

            NotificationService.create_notification(
                db=db,
                user_id=employee_user.user_id,
                title=f"Your Right report update — {(user_right.title or 'Untitled')[:60]}",
                message=(
                    f"Your report {verb}.{resolution_excerpt} "
                    f"Open the Your Right history screen for the full record."
                ),
                notification_type="user_right_status_change",
                meta={
                    "user_right_id": user_right.right_id,
                    "new_status": action_norm,
                },
            )
            return True
        except Exception as e:
            logger.error(f"notify_employee_user_right_status_change error: {e}")
            return False

    @staticmethod
    def notify_compliance_user_right_external(db: Session, user_right) -> bool:
        """Notify every user with the `compliance_officer` platform role when
        an employee files an EXTERNAL Your Right report. External reports
        must NEVER reach the employer — they exist specifically for the case
        where the employer is the subject of the complaint."""
        try:
            from core.model import User as UserModel
            from db_models.crud.role import get_users_by_platform_role
            try:
                officers = get_users_by_platform_role("compliance_officer", db)
            except Exception:
                # Fallback: notify platform admins if the dedicated compliance
                # role hasn't been provisioned yet. Better that someone sees
                # an external complaint than nobody at all.
                officers = get_users_by_platform_role("platform_admin", db)

            if not officers:
                logger.warning(
                    "External Your Right report %s has no compliance officer or "
                    "platform admin to route to — complaint will only surface "
                    "via the admin/compliance dashboard.",
                    user_right.right_id,
                )
                return False

            urgency = (user_right.urgency_level or "normal").lower()
            urgency_tag = "🚨 URGENT — " if urgency in ("urgent", "high", "critical") else ""
            title = f"{urgency_tag}External Your Right report #{user_right.right_id}"
            message = (
                f"An employee filed an EXTERNAL {urgency} complaint that the "
                f"employer cannot see. Category: {user_right.category or '—'}. "
                f"Review it in the Compliance dashboard."
            )
            for officer in officers:
                NotificationService.create_notification(
                    db=db,
                    user_id=officer.user_id,
                    title=title,
                    message=message,
                    notification_type="user_right_external",
                    meta={
                        "user_right_id": user_right.right_id,
                        "urgency": urgency,
                        "channel": "external",
                    },
                )
            return True
        except Exception as e:
            logger.error(f"notify_compliance_user_right_external error: {e}")
            return False

    @staticmethod
    def notify_compliance_user_right_aging(db: Session, aging_reports: list) -> int:
        """Send a daily digest to compliance officers (and as a fallback to
        platform admins) summarising any Your Right reports that have been
        pending past SLA. Called by `scripts/user_right_sla_check.py`.

        Returns the number of officers notified."""
        if not aging_reports:
            return 0
        try:
            from db_models.crud.role import get_users_by_platform_role
            try:
                officers = get_users_by_platform_role("compliance_officer", db) or \
                    get_users_by_platform_role("platform_admin", db)
            except Exception:
                officers = []
            if not officers:
                return 0

            count_total = len(aging_reports)
            count_urgent = sum(
                1 for r in aging_reports
                if (r.urgency_level or "").lower() in ("urgent", "high", "critical")
            )
            ids_preview = ", ".join(f"#{r.right_id}" for r in aging_reports[:5])
            more = f" (+{count_total - 5} more)" if count_total > 5 else ""

            title = f"{count_total} Your Right report(s) past SLA"
            message = (
                f"{count_total} reports are still pending more than 5 working days "
                f"({count_urgent} urgent). IDs: {ids_preview}{more}. "
                f"Review them in the Compliance dashboard."
            )

            for officer in officers:
                NotificationService.create_notification(
                    db=db,
                    user_id=officer.user_id,
                    title=title,
                    message=message,
                    notification_type="user_right_sla_aging",
                    meta={
                        "aging_count": count_total,
                        "urgent_count": count_urgent,
                        "right_ids": [r.right_id for r in aging_reports],
                    },
                )
            return len(officers)
        except Exception as e:
            logger.error(f"notify_compliance_user_right_aging error: {e}")
            return 0

    # ── M8 closeout: dedicated Concerns v2 notification helpers ──────────
    #
    # The original plan §Notification copy specified distinct push
    # templates per trigger. Initially we reused the three legacy helpers
    # above; the helpers below close that gap with copy that follows the
    # plan's anonymity-safe rules:
    #   - Never include the company name in subject / push title.
    #   - Never include the case title or category in subject / push title.
    #   - Never include the reporter's own name (defensive — shared device).
    #   - Generic "Kiruko" branding only, no employer references in
    #     reporter-facing notifications.
    #
    # Email metadata rules (plan §Email metadata):
    #   - SMTP from-address comes from SMTP_FROM_EMAIL (set per-deploy to a
    #     concerns-specific address like noreply-concerns@kontokaz.<domain>).
    #   - No tracking pixels, no third-party analytics — the existing
    #     create_notification path doesn't inject any, so this rule is
    #     enforced by NOT adding tracking infrastructure rather than by
    #     subtractive code.

    @staticmethod
    def notify_employee_concern_rerouted(db: Session, user_right) -> bool:
        """Reporter push: their concern was auto-escalated to Kiruko due to
        conflict-of-interest. Closes audit gap #8.

        Anonymity-safe copy: never mentions the admin names that triggered
        the routing (those live in `escalated_reason` and the audit log).
        """
        try:
            from core.model import PrivateUser
            pu = db.query(PrivateUser).filter(
                PrivateUser.private_user_id == user_right.private_user_id
            ).first()
            if pu is None:
                return False
            NotificationService.create_notification(
                db=db,
                user_id=pu.user_id,
                title="Your concern was re-routed",
                message=(
                    "Because of who is involved, your concern was sent to "
                    "Kiruko Compliance instead of your employer. "
                    "Tap to learn more."
                ),
                notification_type="concern_rerouted",
                meta={
                    "right_id": user_right.right_id,
                    "reason": "conflict_of_interest",
                },
            )
            return True
        except Exception as e:  # noqa: BLE001
            logger.error(f"notify_employee_concern_rerouted error: {e}")
            return False

    @staticmethod
    def notify_kontokaz_triage(db: Session, user_right) -> int:
        """Push to every compliance_officer / platform_admin when a case
        lands in the Triage queue (auto-escalation from an employer).
        Closes audit gap #7.
        """
        try:
            from db_models.crud.role import get_users_by_platform_role
            try:
                officers = get_users_by_platform_role("compliance_officer", db) or []
            except Exception:
                officers = []
            try:
                admins = get_users_by_platform_role("platform_admin", db) or []
            except Exception:
                admins = []
            seen = set()
            recipients = []
            for u in list(officers) + list(admins):
                if u and u.user_id and u.user_id not in seen:
                    seen.add(u.user_id)
                    recipients.append(u)
            if not recipients:
                return 0

            # Resolve the originating company name for at-a-glance triage
            # routing context (plan §Notification copy handler-facing table:
            # "Triage queue: case #{id} auto-escalated from {company}").
            company_label = "an employer"
            try:
                from core.model import PrivateUser, Job, Company
                pu = db.query(PrivateUser).filter(
                    PrivateUser.private_user_id == user_right.private_user_id
                ).first()
                if pu and pu.job_id:
                    job = db.query(Job).filter(Job.job_id == pu.job_id).first()
                    if job and job.company_id:
                        company = db.query(Company).filter(
                            Company.company_id == job.company_id
                        ).first()
                        if company and getattr(company, "name", None):
                            company_label = company.name
            except Exception:
                pass

            title = (
                f"Triage queue: case #{user_right.right_id} "
                f"auto-escalated from {company_label}"
            )
            for u in recipients:
                NotificationService.create_notification(
                    db=db,
                    user_id=u.user_id,
                    title=title,
                    message=(
                        "A case was auto-escalated to Kiruko Compliance "
                        "because the reporter named a company admin. "
                        "Accept it or dismiss it back to the employer."
                    ),
                    notification_type="concern_triage",
                    meta={
                        "right_id": user_right.right_id,
                        "company_label": company_label,
                    },
                )
            return len(recipients)
        except Exception as e:  # noqa: BLE001
            logger.error(f"notify_kontokaz_triage error: {e}")
            return 0

    @staticmethod
    def notify_employee_retaliation_survey(db: Session, user_right, window: str) -> bool:
        """Reporter push for the 30/60/90-day retaliation check-in. Pairs
        with the `concern_messages` row already inserted by the cron.
        Closes audit gap #9.
        """
        try:
            from core.model import PrivateUser
            pu = db.query(PrivateUser).filter(
                PrivateUser.private_user_id == user_right.private_user_id
            ).first()
            if pu is None:
                return False
            NotificationService.create_notification(
                db=db,
                user_id=pu.user_id,
                title="Quick check-in",
                message=(
                    f"It's been {window.replace('d', '')} days since your "
                    "concern was closed. We'd like to ask one question. "
                    "Tap to respond."
                ),
                notification_type="concern_retaliation_survey",
                meta={"right_id": user_right.right_id, "window": window},
            )
            return True
        except Exception as e:  # noqa: BLE001
            logger.error(f"notify_employee_retaliation_survey error: {e}")
            return False

    @staticmethod
    def notify_handler_reporter_message(db: Session, user_right) -> bool:
        """Push to the assigned handler (or company admin / Kiruko
        depending on channel) when the reporter posts into the thread.
        Half of audit gap #5; the reporter-side push is
        `notify_reporter_handler_message`.
        """
        try:
            if getattr(user_right, "channel", "internal") == "external":
                # Route to Kiruko queue.
                from db_models.crud.role import get_users_by_platform_role
                try:
                    officers = get_users_by_platform_role("compliance_officer", db) or []
                except Exception:
                    officers = []
                for u in officers:
                    if u and u.user_id:
                        NotificationService.create_notification(
                            db=db,
                            user_id=u.user_id,
                            title=f"Reporter replied on case #{user_right.right_id}",
                            message="The reporter posted a new message in the thread.",
                            notification_type="concern_thread_reply",
                            meta={"right_id": user_right.right_id, "side": "kontokaz"},
                        )
                return True
            # Internal — route to the assignee or fall back to company admin.
            target_user_id = getattr(user_right, "assigned_to", None)
            if target_user_id is None:
                admin, _ = NotificationService._resolve_company_admin(
                    db, user_right.private_user_id
                )
                if admin:
                    target_user_id = admin.user_id
            if not target_user_id:
                return False
            NotificationService.create_notification(
                db=db,
                user_id=target_user_id,
                title=f"Reporter replied on case #{user_right.right_id}",
                message="The reporter posted a new message in the thread.",
                notification_type="concern_thread_reply",
                meta={"right_id": user_right.right_id, "side": "employer"},
            )
            return True
        except Exception as e:  # noqa: BLE001
            logger.error(f"notify_handler_reporter_message error: {e}")
            return False

    @staticmethod
    def notify_reporter_handler_message(db: Session, user_right) -> bool:
        """Reporter push when a handler (employer admin or Kiruko) replies
        in the thread. Other half of audit gap #5.
        """
        try:
            from core.model import PrivateUser
            pu = db.query(PrivateUser).filter(
                PrivateUser.private_user_id == user_right.private_user_id
            ).first()
            if pu is None or not pu.user_id:
                return False
            NotificationService.create_notification(
                db=db,
                user_id=pu.user_id,
                title="New message",
                message="Your case has a new reply. Tap to view.",
                notification_type="concern_thread_reply",
                meta={"right_id": user_right.right_id, "side": "reporter"},
            )
            return True
        except Exception as e:  # noqa: BLE001
            logger.error(f"notify_reporter_handler_message error: {e}")
            return False

    @staticmethod
    def notify_employee_concern_acknowledged(db: Session, user_right) -> bool:
        """Reporter push: the case was acknowledged by a handler for the first
        time (EU directive — 7-day ack). Distinct copy from the generic
        status-change ping. Closes audit gap #22.
        """
        try:
            from core.model import PrivateUser
            pu = db.query(PrivateUser).filter(
                PrivateUser.private_user_id == user_right.private_user_id
            ).first()
            if pu is None or not pu.user_id:
                return False
            NotificationService.create_notification(
                db=db,
                user_id=pu.user_id,
                title="Your concern has been received",
                message=(
                    "Your handler has opened your case. "
                    "Tap to view the latest update."
                ),
                notification_type="concern_acknowledged",
                meta={"right_id": user_right.right_id},
            )
            return True
        except Exception as e:  # noqa: BLE001
            logger.error(f"notify_employee_concern_acknowledged error: {e}")
            return False

    @staticmethod
    def notify_employee_concern_closed(db: Session, user_right) -> bool:
        """Reporter push: the case was closed by a handler. Distinct copy
        from the generic status-change ping. Closes audit gap #23.
        """
        try:
            from core.model import PrivateUser
            pu = db.query(PrivateUser).filter(
                PrivateUser.private_user_id == user_right.private_user_id
            ).first()
            if pu is None or not pu.user_id:
                return False
            resolution = (getattr(user_right, "resolution", None) or "").strip()
            excerpt = f" Resolution: {resolution[:120]}" if resolution else ""
            NotificationService.create_notification(
                db=db,
                user_id=pu.user_id,
                title="Your concern is closed",
                message=(
                    "Your handler marked the case closed."
                    f"{excerpt} Tap to view the resolution"
                    " — you can still appeal if needed."
                ),
                notification_type="concern_closed",
                meta={
                    "right_id": user_right.right_id,
                    "final_status": getattr(user_right, "status", None),
                },
            )
            return True
        except Exception as e:  # noqa: BLE001
            logger.error(f"notify_employee_concern_closed error: {e}")
            return False

    @staticmethod
    def notify_company_concern_aging(db: Session, aging_cases: list) -> int:
        """Daily SLA digest for company admins: one notification per admin
        listing the cases past the SLA window (5 working days). Mirrors the
        shape of `notify_compliance_user_right_aging` but for the employer
        side. Closes half of audit gap #24.

        `aging_cases` is a flat list of `UserRight` rows; this helper groups
        them by company and notifies each company's admin(s).
        """
        if not aging_cases:
            return 0
        try:
            from core.model import (
                PrivateUser, Job, Company, User as UserModel,
                CompanyUser, CompanyUserRole,
            )
            # Group by company_id resolved via private_user → job → company.
            by_company: Dict[int, list] = {}
            for ur in aging_cases:
                pu = db.query(PrivateUser).filter(
                    PrivateUser.private_user_id == ur.private_user_id
                ).first()
                if not pu or not pu.job_id:
                    continue
                job = db.query(Job).filter(Job.job_id == pu.job_id).first()
                if not job or not job.company_id:
                    continue
                by_company.setdefault(job.company_id, []).append(ur)

            sent = 0
            for company_id, cases in by_company.items():
                company = db.query(Company).filter(
                    Company.company_id == company_id
                ).first()
                if not company:
                    continue
                admins: list[UserModel] = []
                # Owner.
                owner = db.query(UserModel).filter(
                    UserModel.user_id == company.user_id
                ).first() if company.user_id else None
                if owner:
                    admins.append(owner)
                # Linked CompanyUsers with admin role.
                linked = (
                    db.query(CompanyUser)
                    .filter(CompanyUser.company_id == company_id)
                    .filter(CompanyUser.role.in_([
                        CompanyUserRole.owner,
                        CompanyUserRole.admin,
                    ]))
                    .all()
                )
                for cu in linked:
                    u = db.query(UserModel).filter(
                        UserModel.user_id == cu.user_id
                    ).first()
                    if u and u.user_id not in {a.user_id for a in admins}:
                        admins.append(u)
                if not admins:
                    continue

                ids = ", ".join(f"#{c.right_id}" for c in cases[:5])
                more = f" (+{len(cases) - 5} more)" if len(cases) > 5 else ""
                for admin in admins:
                    NotificationService.create_notification(
                        db=db,
                        user_id=admin.user_id,
                        title=f"{len(cases)} concern(s) past the SLA window",
                        message=(
                            f"Concerns {ids}{more} have been open more than "
                            f"5 working days without resolution. "
                            f"Open the Concerns dashboard to action them."
                        ),
                        notification_type="concern_aging",
                        meta={
                            "right_ids": [c.right_id for c in cases],
                            "company_id": company_id,
                        },
                    )
                    sent += 1
            return sent
        except Exception as e:  # noqa: BLE001
            logger.error(f"notify_company_concern_aging error: {e}")
            return 0

    @staticmethod
    def notify_company_concern_unack(db: Session, user_right) -> bool:
        """Acknowledgment-reminder push: case is past 5 days without
        `acknowledged_at`. Closes other half of audit gap #24.
        """
        try:
            from core.model import (
                PrivateUser, Job, Company, User as UserModel,
                CompanyUser, CompanyUserRole,
            )
            pu = db.query(PrivateUser).filter(
                PrivateUser.private_user_id == user_right.private_user_id
            ).first()
            if not pu or not pu.job_id:
                return False
            job = db.query(Job).filter(Job.job_id == pu.job_id).first()
            if not job or not job.company_id:
                return False
            company = db.query(Company).filter(
                Company.company_id == job.company_id
            ).first()
            if not company:
                return False
            admins: list[UserModel] = []
            owner = db.query(UserModel).filter(
                UserModel.user_id == company.user_id
            ).first() if company.user_id else None
            if owner:
                admins.append(owner)
            linked = (
                db.query(CompanyUser)
                .filter(CompanyUser.company_id == company.company_id)
                .filter(CompanyUser.role.in_([
                    CompanyUserRole.owner,
                    CompanyUserRole.admin,
                ]))
                .all()
            )
            for cu in linked:
                u = db.query(UserModel).filter(
                    UserModel.user_id == cu.user_id
                ).first()
                if u and u.user_id not in {a.user_id for a in admins}:
                    admins.append(u)
            if not admins:
                return False
            days_open = 0
            if user_right.created_at:
                from datetime import datetime as _dt, timezone as _tz
                days_open = (_dt.now(_tz.utc) - user_right.created_at).days
            for admin in admins:
                NotificationService.create_notification(
                    db=db,
                    user_id=admin.user_id,
                    title=f"Concern #{user_right.right_id} needs acknowledgment",
                    message=(
                        f"Concern #{user_right.right_id} has been open "
                        f"{days_open} days without a handler opening it. "
                        f"Acknowledge it within the SLA window."
                    ),
                    notification_type="concern_unack",
                    meta={"right_id": user_right.right_id, "days_open": days_open},
                )
            return True
        except Exception as e:  # noqa: BLE001
            logger.error(f"notify_company_concern_unack error: {e}")
            return False
