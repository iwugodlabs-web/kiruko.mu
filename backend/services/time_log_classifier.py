"""Review-by-exception classifier — the single source of truth for whether a
TimeLog needs admin review and why.

Do NOT duplicate this logic between the read path and any future auto-approve
path; both must read the persisted ``needs_review`` / ``exception_reasons``
columns that :func:`recompute` writes. Recompute from every write that changes
a signal (clock-in/out, auto-close, dispute, admin edit).
"""
from __future__ import annotations

import hashlib
from typing import List, Optional

# Keep in sync with geofence_service.ACCURACY_THRESHOLD_M — a fix reported
# beyond this precision (metres) is unverifiable and grounds for review.
ACCURACY_THRESHOLD_M = 150.0

# Reason keys surfaced as chips in the review UI. Order is not significant.
REASON_KEYS = {
    "auto_closed",
    "out_of_geofence",
    "out_of_schedule",
    "late",
    "overtime_unconfirmed",
    "mock_location",
    "low_accuracy",
    "disputed",
    "time_skew",
}


def _geo_reasons(geofence_check_json) -> List[str]:
    reasons: List[str] = []
    if not isinstance(geofence_check_json, dict):
        return reasons

    reason = geofence_check_json.get("reason")
    if geofence_check_json.get("mock_detected") or reason == "mock_detected":
        reasons.append("mock_location")

    accuracy_m = geofence_check_json.get("accuracy_m")
    if reason == "unverifiable_accuracy" or (
        isinstance(accuracy_m, (int, float)) and accuracy_m > ACCURACY_THRESHOLD_M
    ):
        reasons.append("low_accuracy")

    if geofence_check_json.get("time_skew"):
        reasons.append("time_skew")

    return reasons


def classify_exceptions(tl) -> List[str]:
    """Return the list of reason keys for a TimeLog row (or transient object).
    Pure function of the row's signal fields; safe to call pre- or post-persist
    because every attribute access is guarded."""
    reasons: List[str] = []

    if getattr(tl, "auto_closed", False):
        reasons.append("auto_closed")
    if getattr(tl, "out_of_geofence", False):
        reasons.append("out_of_geofence")
    if getattr(tl, "out_of_schedule", False):
        reasons.append("out_of_schedule")
    if getattr(tl, "is_late", False):
        reasons.append("late")
    if getattr(tl, "is_overtime", False) and not getattr(
        tl, "overtime_confirmed_by_employer", False
    ):
        reasons.append("overtime_unconfirmed")

    reasons.extend(_geo_reasons(getattr(tl, "geofence_check_json", None)))

    dispute = getattr(tl, "dispute", None)
    if dispute is not None and getattr(dispute, "resolution", None) == "pending":
        reasons.append("disputed")

    # NOTE: no "missing_clock_out_location" reason. Historical clock-outs predate
    # the geofence `clock_out` location capture, so flagging on its absence floods
    # the review queue (84% of a real production backfill). auto_closed already
    # covers the "closed without a device clock-out" case.

    return reasons


def needs_review(tl) -> bool:
    return bool(classify_exceptions(tl))


def recompute(tl) -> None:
    """Recompute the persisted classification on a TimeLog row. Idempotent.
    Call from every write path that changes a signal; the caller commits."""
    reasons = classify_exceptions(tl)
    tl.needs_review = bool(reasons)
    tl.exception_reasons = reasons


def is_sampled_for_review(company_id: int, timelog_id: int, sample_pct: int) -> bool:
    """Deterministic random-sample audit for clean sessions. A stable hash of
    (company_id, timelog_id) decides membership, so a given session does NOT
    churn in/out of the sample across recomputes or list reloads. sample_pct is
    an integer 0-100 (0 = off)."""
    if not sample_pct or sample_pct <= 0:
        return False
    if sample_pct >= 100:
        return True
    digest = hashlib.sha256(f"{company_id}:{timelog_id}".encode()).digest()
    bucket = int.from_bytes(digest[:4], "big") % 100
    return bucket < sample_pct
