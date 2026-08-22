#!/usr/bin/env python3
"""Phase 0 measurement for SALARIED-OVERTIME-PLAN.md — quantify how many
salaried (monthly/daily) workers are *entitled* to overtime under WRA 2019
and how many actually have overtime exposure that the engine currently drops.

READ-ONLY. Safe to run against production. Opens no writes, commits nothing.

Decision it informs: if zero entitled salaried workers have exposure, the
salaried-OT build can be deferred for launch. If many do, it's a live
underpayment risk and the build is justified.

WRA basis:
  * s.20  normal week = 45h
  * s.24  OT applies to "a worker" (no monthly/hourly distinction);
          weekday 1.5x, rest-day / public-holiday 2x-3x
  * s.2/s.3  worker earning > Rs 600,000/yr basic (~Rs 50,000/mo) is EXCLUDED
  * s.25  salaried hourly = monthly basic / 195

Detection mirrors the plan: a worker is "exposed" if, in the window, they have
ANY ISO-week > 45h of approved work, OR any approved shift on their weekly rest
day, OR any approved shift on a public holiday. (Weekly-hours alone is NOT
enough — the dev run proved it misses rest-day/holiday exposure.)

Usage:
  python3 backend/scripts/measure_salaried_ot_exposure.py
  python3 backend/scripts/measure_salaried_ot_exposure.py --from 2026-01-01 --to 2026-06-30
  python3 backend/scripts/measure_salaried_ot_exposure.py --anonymize   # hide names
  python3 backend/scripts/measure_salaried_ot_exposure.py --csv out.csv
"""
import argparse
import csv as csvmod
import os
import sys
from collections import defaultdict
from datetime import date, datetime, time, timezone
from decimal import Decimal

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, backend_dir)

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(backend_dir, ".env"), override=False)
except Exception:
    pass

from core.config import get_session_local
from core.model import (
    Company, EmployeeSalaryAssignment, Job, PrivateUser, PublicHoliday,
    Salary, SalaryComponent, SalaryStructure, SalaryStructureLine, TimeLog,
)

# WRA s.2/s.3 — basic-wage OT-exemption ceiling: Rs 600,000/yr ⇒ Rs 50,000/mo.
THRESHOLD_MONTH = Decimal("50000")
NORMAL_WEEK_HOURS = Decimal("45")  # WRA s.20 default (sector ROs may differ — see plan)


def _monthly_basic(db, pu) -> Decimal | None:
    """Resolve a monthly BASIC figure: new-model structure first, else legacy
    Salary. Returns None if the worker isn't on a fixed monthly/daily basic."""
    a = (
        db.query(EmployeeSalaryAssignment)
        .filter(EmployeeSalaryAssignment.private_user_id == pu.private_user_id)
        .order_by(EmployeeSalaryAssignment.effective_from.desc())
        .first()
    )
    if a:
        st = db.query(SalaryStructure).filter(SalaryStructure.id == a.structure_id).first()
        if st:
            tot = Decimal("0")
            for ln in db.query(SalaryStructureLine).filter(SalaryStructureLine.structure_id == st.id).all():
                c = db.query(SalaryComponent).filter(SalaryComponent.id == ln.component_id).first()
                if c and getattr(c, "is_basic", False):
                    tot += Decimal(ln.amount or 0)
            if tot > 0:
                return tot
    job = db.query(Job).filter(Job.private_user_id == pu.private_user_id).order_by(Job.created_at.desc()).first()
    s = db.query(Salary).filter(Salary.job_id == job.job_id).first() if job else None
    if s and s.salary and (s.pay_basis or "monthly").lower() in ("monthly", "daily"):
        return Decimal(s.salary)
    return None


def run(date_from: date | None, date_to: date | None, anonymize: bool, csv_path: str | None) -> None:
    SessionLocal = get_session_local()
    if SessionLocal is None:
        print("ERROR: no DB engine configured (check backend/.env DATABASE_URL).")
        sys.exit(1)
    db = SessionLocal()
    try:
        # Public-holiday lookup per country (date set).
        holidays_by_country: dict[str, set] = defaultdict(set)
        for h in db.query(PublicHoliday).all():
            holidays_by_country[h.country_code].add(h.observed_date or h.date)

        rows = []
        for pu in db.query(PrivateUser).all():
            job = db.query(Job).filter(Job.private_user_id == pu.private_user_id).order_by(Job.created_at.desc()).first()
            salary = db.query(Salary).filter(Salary.job_id == job.job_id).first() if job else None
            basis = (salary.pay_basis if salary and salary.pay_basis else "").lower()
            if basis not in ("monthly", "daily"):
                continue  # only salaried bases are at risk; hourly already computes OT

            company = db.query(Company).filter(Company.company_id == pu.company_id).first()
            cc = (company.country_code if company else "MU") or "MU"
            rest_dow = (job.weekly_rest_day_dow if job and job.weekly_rest_day_dow else 7)

            q = db.query(TimeLog).filter(
                TimeLog.private_user_id == pu.private_user_id,
                TimeLog.admin_approved == True,  # noqa: E712 — only approved hours count
            )
            if date_from:
                q = q.filter(TimeLog.start_time >= datetime.combine(date_from, time.min, tzinfo=timezone.utc))
            if date_to:
                q = q.filter(TimeLog.start_time <= datetime.combine(date_to, time.max, tzinfo=timezone.utc))
            logs = q.all()

            wk_hours: dict = defaultdict(Decimal)
            rest_shifts = 0
            holiday_shifts = 0
            for t in logs:
                if not t.start_time:
                    continue
                d = t.start_time.date()
                iso = t.start_time.isocalendar()
                wk_hours[(iso[0], iso[1])] += Decimal(t.hours_worked or 0)
                iso_dow = t.start_time.isoweekday()  # 1=Mon..7=Sun
                if iso_dow == rest_dow:
                    rest_shifts += 1
                if d in holidays_by_country.get(cc, set()):
                    holiday_shifts += 1

            weeks_over = sum(1 for h in wk_hours.values() if h > NORMAL_WEEK_HOURS)
            basic = _monthly_basic(db, pu)
            entitled = basic is not None and basic <= THRESHOLD_MONTH
            exposed = entitled and (weeks_over > 0 or rest_shifts > 0 or holiday_shifts > 0)

            rows.append({
                "company": (company.company_name if company else str(pu.company_id)),
                "employee": (f"#{pu.private_user_id}" if anonymize else f"{pu.first_name} {pu.last_name}".strip()),
                "basis": basis,
                "basic_mo": str(basic) if basic is not None else "",
                "ot_entitled": entitled,
                "weeks_over_45h": weeks_over,
                "rest_day_shifts": rest_shifts,
                "public_holiday_shifts": holiday_shifts,
                "exposed": exposed,
            })

        # ---- report ----
        win = "all time" if not (date_from or date_to) else f"{date_from or '…'} → {date_to or '…'}"
        print(f"\nSalaried-overtime exposure — window: {win}")
        print(f"Threshold: basic ≤ Rs {THRESHOLD_MONTH}/mo entitled (WRA s.24); normal week {NORMAL_WEEK_HOURS}h (s.20)\n")
        hdr = f"{'company':<20}{'employee':<18}{'basis':<8}{'basic/mo':<11}{'entitled':<9}{'wk>45':<7}{'rest':<6}{'holiday':<8}{'EXPOSED'}"
        print(hdr)
        print("-" * len(hdr))
        for r in sorted(rows, key=lambda x: (not x["exposed"], x["company"])):
            print(f"{r['company'][:19]:<20}{r['employee'][:17]:<18}{r['basis']:<8}{(r['basic_mo'] or '—'):<11}"
                  f"{('YES' if r['ot_entitled'] else 'no'):<9}{r['weeks_over_45h']:<7}{r['rest_day_shifts']:<6}"
                  f"{r['public_holiday_shifts']:<8}{'⚠ YES' if r['exposed'] else ''}")
        print("-" * len(hdr))

        monthly = len(rows)
        entitled_n = sum(1 for r in rows if r["ot_entitled"])
        exposed_n = sum(1 for r in rows if r["exposed"])
        print(f"\nSalaried (monthly/daily) workers:        {monthly}")
        print(f"  OT-entitled (basic ≤ Rs50k/mo):        {entitled_n}")
        print(f"  WITH overtime exposure (engine drops): {exposed_n}")
        print("\nVerdict:")
        if exposed_n == 0:
            print("  No exposed salaried workers in this window → salaried-OT build can be DEFERRED for launch.")
        else:
            print(f"  {exposed_n} salaried worker(s) likely owed overtime the engine isn't paying →")
            print("  live underpayment risk; proceed with SALARIED-OVERTIME-PLAN.md (after legal sign-off).")
        print("\nNote: exposure ≠ definite OT owed — a worker's contract may bundle OT (WRA s.24(5)).")
        print("      This counts who NEEDS review, not who must be paid.\n")

        if csv_path:
            with open(csv_path, "w", newline="") as f:
                w = csvmod.DictWriter(f, fieldnames=list(rows[0].keys()) if rows else
                                      ["company", "employee", "basis", "basic_mo", "ot_entitled",
                                       "weeks_over_45h", "rest_day_shifts", "public_holiday_shifts", "exposed"])
                w.writeheader()
                w.writerows(rows)
            print(f"CSV written: {csv_path}")
    finally:
        db.close()


def _parse_date(s: str | None) -> date | None:
    return datetime.strptime(s, "%Y-%m-%d").date() if s else None


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Measure salaried-overtime exposure (read-only).")
    ap.add_argument("--from", dest="date_from", default=None, help="Window start YYYY-MM-DD.")
    ap.add_argument("--to", dest="date_to", default=None, help="Window end YYYY-MM-DD.")
    ap.add_argument("--anonymize", action="store_true", help="Show employee ids instead of names.")
    ap.add_argument("--csv", dest="csv_path", default=None, help="Also write per-employee rows to a CSV file.")
    args = ap.parse_args()
    run(_parse_date(args.date_from), _parse_date(args.date_to), args.anonymize, args.csv_path)
