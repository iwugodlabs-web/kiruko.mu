"""Commission statement PDF — a printable per-rep earnings statement for a run.

Mirrors remittance_pdf's WeasyPrint + Jinja2 two-pass hash pattern, with the
same graceful degradation when WeasyPrint / native libs are missing.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from pathlib import Path

_TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates" / "commission_statement"


class PdfRenderUnavailable(Exception):
    """WeasyPrint or a native dep is missing — caller logs + returns 503."""


def build_data(db, company, private_user, run, line_items) -> dict:
    """Assemble the statement context from a run's line items for one rep."""
    name = " ".join(
        p for p in [(private_user.first_name or "").strip(), (private_user.last_name or "").strip()] if p
    ).strip() or f"Rep #{private_user.private_user_id}"

    lines = []
    total = 0
    for li in line_items:
        amount = li.amount
        total += float(amount)
        rule = getattr(li, "rule", None)
        rule_type = (li.trace or {}).get("rule_type") or (rule.rule_type if rule else "commission")
        lines.append({
            "rule_type": rule_type,
            "description": _describe(li),
            "amount": f"{float(amount):.2f}",
        })

    return {
        "company_name": getattr(company, "company_name", None) or "",
        "company_brn": getattr(company, "brn", None) or "",
        "rep_name": name,
        "rep_id": private_user.private_user_id,
        "period_label": f"{run.period_start} → {run.period_end}",
        "currency": run.currency or "MUR",
        "run_status": run.status,
        "lines": lines,
        "total": f"{total:.2f}",
    }


def _describe(line_item) -> str:
    trace = line_item.trace or {}
    rt = trace.get("rule_type", "commission")
    if rt == "flat_percent":
        return f"{trace.get('percent', '0')}% of {trace.get('base', '0.00')}"
    if rt == "per_unit":
        return f"{trace.get('amount_per_unit', '0')} per unit × {trace.get('units', '0')}"
    if rt == "tiered":
        band = trace.get("band") or {}
        return f"tier {band.get('percent', '0')}% ({trace.get('units', '0')} units)"
    if rt == "target":
        return f"target {trace.get('percent', '0')}% (attainment {trace.get('attainment') or 'n/a'})"
    if rt == "spiff":
        return "SPIFF"
    return rt


def render(data: dict, company=None) -> bytes:
    """Render the statement `data` (from `build_data`) to PDF bytes."""
    try:
        from jinja2 import Environment, FileSystemLoader, select_autoescape
        from weasyprint import HTML
    except ImportError as e:  # pragma: no cover - environmental
        raise PdfRenderUnavailable(f"PDF renderer not available: {e}") from e
    except OSError as e:  # pragma: no cover - environmental
        raise PdfRenderUnavailable(f"PDF native libs not available: {e}") from e

    template_path = _TEMPLATES_DIR / "default.html"
    if not template_path.exists():
        raise PdfRenderUnavailable(f"Template not found: {template_path}")

    context = {
        **data,
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
