"""Payslip PDF generation orchestrator (M21).

Two entry points:

* `generate_for_payslip(db, payslip_id)` — render + upload + persist for one
  payslip.

* `generate_for_run(db, run_id)` — same loop over every payslip in a run.
  Called by `payroll_engine.finalize_run` AFTER the run has been marked
  finalized so a PDF render failure can never block finalization.

Failure model: any exception is logged and the loop continues. The run is
the source of truth; PDFs are derived artifacts. A missed PDF can be
regenerated later via the same function. We deliberately catch broadly
because WeasyPrint's failure modes (missing native libs, font issues,
mid-render exceptions) are diverse and we don't want a single bad
employee record to leave the rest of the run without slips.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from core.model import Payslip, PayrollRun
from services import payslip_pdf_service
from services.storage_service import get_storage_service


logger = logging.getLogger(__name__)


def _filename_for(payslip: Payslip, run: PayrollRun) -> str:
    period = run.period_start.strftime("%Y-%m")
    prefix = "correction" if getattr(payslip, "is_adjustment", False) else "payslip"
    return f"{prefix}_{run.company_id}_{payslip.private_user_id}_{period}_{payslip.id}.pdf"


def generate_for_payslip(db: Session, payslip_id: int) -> Optional[str]:
    """Render and upload a single payslip PDF, then write `pdf_url` and
    `hash_sha256` onto the payslip row. Returns the URL or None on failure.

    Caller commits.
    """
    payslip = db.query(Payslip).filter(Payslip.id == payslip_id).one_or_none()
    if payslip is None:
        logger.warning("payslip_pdf: payslip %s not found", payslip_id)
        return None

    run = db.query(PayrollRun).filter(PayrollRun.id == payslip.payroll_run_id).one()

    try:
        pdf_bytes = payslip_pdf_service.render_pdf(db, payslip=payslip, run=run)
    except payslip_pdf_service.PdfRenderUnavailable as e:
        logger.warning(
            "payslip_pdf: skip payslip %s — renderer unavailable (%s)", payslip_id, e
        )
        return None
    except Exception as e:  # noqa: BLE001 — catch broadly per docstring
        logger.exception("payslip_pdf: render failed for payslip %s: %s", payslip_id, e)
        return None

    sha = payslip_pdf_service.compute_pdf_hash(pdf_bytes)
    storage = get_storage_service()
    filename = _filename_for(payslip, run)

    try:
        url = storage.upload_bytes(
            pdf_bytes,
            filename=filename,
            content_type="application/pdf",
            folder=f"payslips/{run.company_id}",
        )
    except NotImplementedError as e:
        logger.warning("payslip_pdf: storage backend lacks upload_bytes: %s", e)
        return None
    except Exception as e:  # noqa: BLE001
        logger.exception("payslip_pdf: upload failed for payslip %s: %s", payslip_id, e)
        return None

    if url is None:
        logger.warning("payslip_pdf: storage returned None for payslip %s", payslip_id)
        return None

    payslip.pdf_url = url
    payslip.hash_sha256 = sha
    db.flush()
    logger.info(
        "payslip_pdf: generated payslip %s (%d bytes, sha=%s…) → %s",
        payslip_id, len(pdf_bytes), sha[:12], url,
    )
    return url


def generate_for_run(db: Session, run_id: int) -> dict:
    """Generate PDFs for every payslip in a run. Returns counts.

    Designed to be called from inside finalize_run AFTER the run has been
    marked finalized — failures here must not roll back finalization.
    """
    payslips = db.query(Payslip).filter(Payslip.payroll_run_id == run_id).all()
    success = 0
    skipped = 0
    for ps in payslips:
        url = generate_for_payslip(db, ps.id)
        if url:
            success += 1
        else:
            skipped += 1
    return {"run_id": run_id, "success": success, "skipped": skipped, "total": len(payslips)}
