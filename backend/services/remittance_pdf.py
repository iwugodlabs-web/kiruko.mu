"""Statutory-remittance PDF — a printable monthly filing summary (PAYE/CSG/NSF).

Mirrors payslip_pdf_service's WeasyPrint pattern: Jinja2 + a two-pass hash
render, with graceful degradation when WeasyPrint / native libs are missing.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from pathlib import Path

_TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates" / "remittance"

_MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


class PdfRenderUnavailable(Exception):
    """WeasyPrint or a native dep is missing — caller logs + returns 503."""


def _period_label(period: str) -> str:
    try:
        y, m = period.split("-")
        return f"{_MONTHS[int(m) - 1]} {y}"
    except Exception:
        return period


def render(data: dict, company) -> bytes:
    """Render the remittance `data` (from payroll._remittance_data) to PDF bytes."""
    try:
        from jinja2 import Environment, FileSystemLoader, select_autoescape
        from weasyprint import HTML
    except ImportError as e:  # pragma: no cover - environmental
        raise PdfRenderUnavailable(f"PDF renderer not available: {e}") from e
    except OSError as e:
        raise PdfRenderUnavailable(f"PDF native libs not available: {e}") from e

    template_path = _TEMPLATES_DIR / "default.html"
    if not template_path.exists():
        raise PdfRenderUnavailable(f"Template not found: {template_path}")

    # Stable column order for the per-employee statutory breakdown.
    stat_codes = sorted({c for e in data.get("employees", []) for c in (e.get("statutory") or {}).keys()})

    context = {
        "company": {
            "name": (getattr(company, "company_name", None) or "") if company else "",
            "brn": (getattr(company, "brn", None) or "") if company else "",
            "address": (getattr(company, "address", None) or "") if company else "",
        },
        "period_label": _period_label(data.get("period", "")),
        "currency": data.get("currency", "MUR"),
        "employee_count": data.get("employee_count", 0),
        "paye_total": data.get("paye_total", "0.00"),
        "statutory": data.get("statutory", []),
        "grand_total": data.get("grand_total", "0.00"),
        "employees": data.get("employees", []),
        "stat_codes": stat_codes,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "hash_sha256": None,
    }

    env = Environment(
        loader=FileSystemLoader(str(template_path.parent)),
        autoescape=select_autoescape(["html", "xml"]),
    )
    template = env.get_template("default.html")
    first_pass = template.render(**context)
    context["hash_sha256"] = hashlib.sha256(first_pass.encode("utf-8")).hexdigest()
    final_html = template.render(**context)
    return HTML(string=final_html, base_url=str(template_path.parent)).write_pdf()
