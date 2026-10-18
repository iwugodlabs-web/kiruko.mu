"""Bulk product (catalog) import — parse → validate (dry-run) → commit.

Mirrors `services/employee_import_service.py`: the same upload → preview →
commit shape, but for field-sales products.

Model: **one row per variant**. Multiple rows sharing the same product `name`
are grouped into a single product with several variants (e.g. a Coca-Cola
product with 330ml / 1.5L rows). A product that already exists (matched by name,
case-insensitive) is not duplicated — its missing variants are added.

Pure-ish: parse()/validate() never write; commit() writes and is idempotent
(existing product → reused; existing SKU on that product → skipped).
"""
from __future__ import annotations

import csv
import io
import re
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from core.model import Product, ProductCategory, ProductVariant

# ── Schema ──────────────────────────────────────────────────────────────────
REQUIRED_COLUMNS = ["name"]
RECOMMENDED_COLUMNS = ["sku", "price", "category"]
OPTIONAL_COLUMNS = ["currency", "barcode", "brand"]
TEMPLATE_COLUMNS = REQUIRED_COLUMNS + RECOMMENDED_COLUMNS + OPTIONAL_COLUMNS

ALLOWED_CURRENCIES = {"MUR", "MGA", "TZS", "USD", "EUR", "GBP"}
DEFAULT_CURRENCY = "MUR"
MAX_ROWS = 10000


# ── Helpers ─────────────────────────────────────────────────────────────────
def _norm_header(h: Any) -> str:
    return str(h or "").strip().lower().replace(" ", "_")


def _s(v: Any) -> str:
    return ("" if v is None else str(v)).strip()


def _norm_name(v: Any) -> str:
    return _s(v).lower()


def _company_currency(db: Session, company_id: int) -> Optional[str]:
    from core.model import Company
    company = db.query(Company).filter(Company.company_id == company_id).first()
    return getattr(company, "currency", None) if company else None


def _parse_decimal(v: Any) -> Optional[Decimal]:
    s = _s(v).replace(",", "")
    if not s:
        return None
    try:
        return Decimal(s)
    except (InvalidOperation, ValueError):
        return None


def _make_sku(name: str, row_index: int) -> str:
    base = re.sub(r"[^A-Z0-9]+", "-", (name or "SKU").upper()).strip("-")[:32] or "SKU"
    return f"{base}-{row_index + 1:03d}"


# ── Parse ───────────────────────────────────────────────────────────────────
def parse(file_bytes: bytes, filename: str) -> List[Dict[str, str]]:
    """Parse a CSV or XLSX upload into normalized row dicts (header→value).
    Raises ValueError on an unreadable/empty file."""
    name = (filename or "").lower()
    rows: List[Dict[str, str]] = []
    if name.endswith(".csv") or (not name.endswith(".xlsx") and not name.endswith(".xls")):
        text = file_bytes.decode("utf-8-sig", errors="replace")
        reader = csv.DictReader(io.StringIO(text))
        if not reader.fieldnames:
            raise ValueError("CSV has no header row.")
        fieldmap = {fn: _norm_header(fn) for fn in reader.fieldnames}
        for raw in reader:
            rows.append({fieldmap[k]: _s(v) for k, v in raw.items() if k in fieldmap})
    else:
        try:
            from openpyxl import load_workbook
        except ImportError as e:  # pragma: no cover
            raise ValueError("openpyxl is required to read .xlsx files") from e
        wb = load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
        ws = wb.active
        it = ws.iter_rows(values_only=True)
        try:
            header = [_norm_header(h) for h in next(it)]
        except StopIteration:
            raise ValueError("Spreadsheet is empty.")
        for raw in it:
            if raw is None or all(c is None or _s(c) == "" for c in raw):
                continue
            rows.append({header[i]: _s(raw[i]) for i in range(min(len(header), len(raw)))})
    return rows


def _group(rows: List[Dict[str, str]]) -> List[Tuple[str, List[Tuple[int, Dict[str, str]]]]]:
    """Group rows by product name (case-insensitive), keeping the first row's
    spelling as the display name and each row's original 1-based index."""
    groups: Dict[str, Tuple[str, List[Tuple[int, Dict[str, str]]]]] = {}
    for i, r in enumerate(rows):
        key = _norm_name(r.get("name"))
        if not key:
            continue
        if key not in groups:
            groups[key] = (_s(r.get("name")), [])
        groups[key][1].append((i, r))
    return list(groups.values())


# ── Validate (no writes) ────────────────────────────────────────────────────
def validate(db: Session, company_id: int, rows: List[Dict[str, str]]) -> Dict[str, Any]:
    """Validate parsed rows. Returns {total, ok, errors, warnings, groups,
    missing_columns}. Writes nothing."""
    present_cols = set().union(*[set(r.keys()) for r in rows]) if rows else set()
    missing_columns = [c for c in REQUIRED_COLUMNS if c not in present_cols]

    company_currency = _company_currency(db, company_id)
    existing_names = {
        (n or "").lower()
        for (n,) in db.query(Product.name).filter(Product.company_id == company_id).all()
    }

    ok: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []
    warnings: List[Dict[str, Any]] = []
    seen_skus: Dict[str, int] = {}

    for i, r in enumerate(rows):
        rownum = i + 2
        row_errors: List[Tuple[str, str]] = []

        name = _s(r.get("name"))
        if not name:
            row_errors.append(("name", "missing"))

        price = r.get("price")
        if _s(price):
            parsed = _parse_decimal(price)
            if parsed is None:
                row_errors.append(("price", "not a number"))
            elif parsed < 0:
                row_errors.append(("price", "must be >= 0"))

        cur = _s(r.get("currency")).upper()
        if cur and cur not in ALLOWED_CURRENCIES:
            warnings.append({"row": rownum, "reason": f"currency '{cur}' not recognised — using company currency"})

        sku = _s(r.get("sku"))
        if sku:
            key = f"{_norm_name(name)}::{sku.lower()}"
            if key in seen_skus:
                warnings.append({"row": rownum, "reason": f"duplicate SKU '{sku}' for this product in the file (first seen row {seen_skus[key]})"})
            else:
                seen_skus[key] = rownum

        if row_errors:
            for field, reason in row_errors:
                errors.append({"row": rownum, "field": field, "reason": reason})
        else:
            ok.append({"row": rownum, "data": r})

    return {
        "total": len(rows),
        "ok": ok,
        "errors": errors,
        "warnings": warnings,
        "groups": [name for name, _ in _group(rows)],
        "missing_columns": missing_columns,
        "company_currency": company_currency,
    }


# ── Commit (writes) ─────────────────────────────────────────────────────────
def commit(db: Session, company_id: int, rows: List[Dict[str, str]], actor_user_id: Optional[int] = None) -> Dict[str, Any]:
    """Create products + variants. Idempotent: an existing product (by name) is
    reused, and a SKU that already exists on that product is skipped.

    Re-validates internally and writes **only** the rows that passed — invalid
    rows are reported in `failed`, never created."""
    result = validate(db, company_id, rows)
    if result["missing_columns"]:
        raise ValueError(f"Missing required columns: {', '.join(result['missing_columns'])}")

    valid_rows = [o["data"] for o in result["ok"]]
    company_currency = _company_currency(db, company_id) or DEFAULT_CURRENCY

    existing_cats = {
        (c.name or "").lower(): c
        for c in db.query(ProductCategory).filter(ProductCategory.company_id == company_id).all()
    }

    def ensure_category(name: str) -> Optional[str]:
        trimmed = _s(name)
        if not trimmed:
            return None
        key = trimmed.lower()
        if key not in existing_cats:
            cat = ProductCategory(company_id=company_id, name=trimmed[:120])
            db.add(cat)
            db.flush()
            existing_cats[key] = cat
        return trimmed

    created_products = 0
    created_variants = 0
    skipped = 0
    failed: List[Dict[str, Any]] = list(result["errors"])
    warnings: List[Dict[str, Any]] = []

    for display_name, group_rows in _group(valid_rows):
        name = display_name[:200]
        existing = (
            db.query(Product)
            .filter(Product.company_id == company_id, func.lower(Product.name) == name.lower())
            .one_or_none()
        )
        first_row = group_rows[0][1]
        category = ensure_category(first_row.get("category"))
        brand = _s(first_row.get("brand")) or None

        if existing is None:
            product = Product(company_id=company_id, name=name, brand=brand, category=category, status="active")
            db.add(product)
            db.flush()
            created_products += 1
        else:
            product = existing
            # Backfill category/brand only when the product has none (never clobber).
            if category and not product.category:
                product.category = category
            if brand and not product.brand:
                product.brand = brand

        has_variant = (
            db.query(ProductVariant.id).filter(ProductVariant.product_id == product.id).first() is not None
        )

        for idx, row in group_rows:
            try:
                sku = _s(row.get("sku")) or _make_sku(name, idx)
                dup = (
                    db.query(ProductVariant.id)
                    .filter(ProductVariant.product_id == product.id, ProductVariant.sku == sku)
                    .first()
                )
                if dup is not None:
                    skipped += 1
                    continue
                price = _parse_decimal(row.get("price"))
                if price is None:
                    price = Decimal("0.00")
                cur = _s(row.get("currency")).upper()
                variant = ProductVariant(
                    product_id=product.id,
                    sku=sku[:64],
                    barcode=_s(row.get("barcode")) or None,
                    unit_price=price,
                    currency=cur if cur in ALLOWED_CURRENCIES else company_currency,
                    is_default=not has_variant,
                    status="active",
                )
                db.add(variant)
                db.flush()
                has_variant = True
                created_variants += 1
            except Exception as e:  # noqa: BLE001 — per-row isolation
                db.rollback()
                failed.append({"row": idx + 2, "reason": str(e)})

    return {
        "created_products": created_products,
        "created_variants": created_variants,
        "skipped": skipped,
        "failed": failed,
        "warnings": warnings,
    }


def template_csv() -> str:
    """The downloadable CSV template: header + one example row."""
    example = {
        "name": "Coca-Cola 1.5L",
        "category": "Beverages",
        "sku": "CC-1500",
        "price": "42.50",
        "currency": "MUR",
        "barcode": "5449000000996",
        "brand": "Coca-Cola",
    }
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=TEMPLATE_COLUMNS)
    w.writeheader()
    w.writerow({c: example.get(c, "") for c in TEMPLATE_COLUMNS})
    return buf.getvalue()
