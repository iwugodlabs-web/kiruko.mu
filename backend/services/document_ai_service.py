"""
Document AI Expense Parser wrapper for receipt scanning.

Returns structured fields with per-field confidence so the caller can decide
whether to trust the result or fall back to the Cloud Vision + heuristic path
in api/v1/scan_receipt.py. Returns None on any error — never raises — so the
fallback is the responsibility of the caller, not this module.
"""

import logging
import os
from typing import Optional, TypedDict, List

logger = logging.getLogger(__name__)

try:
    from google.cloud import documentai
    DOCUMENT_AI_AVAILABLE = True
except ImportError:
    DOCUMENT_AI_AVAILABLE = False
    documentai = None  # type: ignore


_client = None


def _get_client():
    global _client
    if _client is None:
        if not DOCUMENT_AI_AVAILABLE:
            return None
        location = os.getenv("DOC_AI_LOCATION", "us")
        client_options = {"api_endpoint": f"{location}-documentai.googleapis.com"}
        _client = documentai.DocumentProcessorServiceClient(client_options=client_options)
    return _client


class ExtractedItem(TypedDict, total=False):
    name: Optional[str]
    quantity: Optional[float]
    unit_price: Optional[float]
    amount: Optional[float]
    confidence: Optional[float]


class ExpenseExtraction(TypedDict, total=False):
    merchant: Optional[str]
    date: Optional[str]
    amount: Optional[float]
    currency: Optional[str]
    tax: Optional[float]
    items: List[ExtractedItem]
    overall_confidence: float
    low_confidence_fields: List[str]
    field_confidences: dict


def is_enabled() -> bool:
    return (
        DOCUMENT_AI_AVAILABLE
        and os.getenv("DOC_AI_ENABLED", "false").lower() == "true"
        and bool(os.getenv("DOC_AI_PROJECT_ID"))
        and bool(os.getenv("DOC_AI_EXPENSE_PROCESSOR_ID"))
    )


def is_shadow_mode() -> bool:
    return os.getenv("DOC_AI_SHADOW_MODE", "true").lower() == "true"


def min_confidence() -> float:
    try:
        return float(os.getenv("DOC_AI_MIN_CONFIDENCE", "0.7"))
    except ValueError:
        return 0.7


def _money_to_float(money_value) -> Optional[float]:
    if money_value is None:
        return None
    units = getattr(money_value, "units", 0) or 0
    nanos = getattr(money_value, "nanos", 0) or 0
    return float(units) + (float(nanos) / 1e9)


def _date_to_iso(date_value) -> Optional[str]:
    if date_value is None:
        return None
    year = getattr(date_value, "year", 0)
    month = getattr(date_value, "month", 0)
    day = getattr(date_value, "day", 0)
    if year and month and day:
        return f"{year:04d}-{month:02d}-{day:02d}"
    return None


def _entity_value(entity, prefer: str = "text"):
    """Pull a value from a Document AI entity.

    `prefer` selects which normalized representation to try first:
      - "date"  : structured date_value first (ISO YYYY-MM-DD), then text
      - "money" : structured money_value first, then text → safe_float
      - "text"  : normalized text first, then date/money/mention_text

    Without this, dates like "01/15/2024" came back unchanged because the
    raw `normalized_value.text` was returned before the structured
    `date_value` was considered.
    """
    nv = getattr(entity, "normalized_value", None)
    text = getattr(nv, "text", None) if nv is not None else None
    money = getattr(nv, "money_value", None) if nv is not None else None
    date = getattr(nv, "date_value", None) if nv is not None else None
    mention = getattr(entity, "mention_text", None)

    if prefer == "date":
        if date is not None and getattr(date, "year", 0):
            return _date_to_iso(date)
        if text:
            return text
        return mention

    if prefer == "money":
        if money is not None and (getattr(money, "units", 0) or getattr(money, "nanos", 0)):
            return _money_to_float(money)
        if text:
            return _safe_float(text)
        return _safe_float(mention) if mention else None

    # default: "text"
    if text:
        return text
    if money is not None and (getattr(money, "units", 0) or getattr(money, "nanos", 0)):
        return _money_to_float(money)
    if date is not None and getattr(date, "year", 0):
        return _date_to_iso(date)
    return mention


def _money_currency(entity) -> Optional[str]:
    """Pull the ISO currency code from a money-typed entity, if present."""
    nv = getattr(entity, "normalized_value", None)
    money = getattr(nv, "money_value", None) if nv is not None else None
    if money is not None:
        code = getattr(money, "currency_code", None)
        if code:
            return code
    return None


def _line_item_from_entity(entity) -> ExtractedItem:
    item: ExtractedItem = {"confidence": getattr(entity, "confidence", None)}
    for prop in entity.properties or []:
        ptype = prop.type_
        if ptype == "line_item/description":
            name = getattr(prop, "mention_text", None)
            item["name"] = name.strip() if isinstance(name, str) else name
        elif ptype == "line_item/quantity":
            # Quantity can arrive as "2", "2.0", "2x", "x2" — try the
            # normalized text first, then fall back to a digit scrape so
            # we don't lose the field when the mention is "2 x".
            raw = getattr(prop, "mention_text", "") or ""
            try:
                item["quantity"] = float(raw) or None
            except (ValueError, TypeError):
                import re as _re
                m = _re.search(r"\d+(?:[.,]\d+)?", raw)
                if m:
                    try:
                        item["quantity"] = float(m.group(0).replace(",", "."))
                    except ValueError:
                        item["quantity"] = None
                else:
                    item["quantity"] = None
        elif ptype == "line_item/unit_price":
            item["unit_price"] = _entity_value(prop, prefer="money")
        elif ptype == "line_item/amount":
            item["amount"] = _entity_value(prop, prefer="money")
    return item


def _safe_float(text) -> Optional[float]:
    """Parse a money string into a float, handling both EU and US formats.

    Examples:
      "1,234.56" → 1234.56  (US: comma is thousands separator)
      "1.234,56" → 1234.56  (EU: dot is thousands, comma is decimal)
      "1234,56"  → 1234.56  (EU short)
      "Rs 1,200" → 1200.0
    """
    if not text:
        return None
    cleaned = "".join(ch for ch in str(text) if ch.isdigit() or ch in ".,-")
    if not cleaned:
        return None

    has_dot = "." in cleaned
    has_comma = "," in cleaned
    if has_dot and has_comma:
        # Both present — the rightmost one is the decimal separator.
        if cleaned.rfind(",") > cleaned.rfind("."):
            cleaned = cleaned.replace(".", "").replace(",", ".")  # EU
        else:
            cleaned = cleaned.replace(",", "")  # US
    elif has_comma:
        # Comma only — heuristic: if exactly 2 digits after the last comma
        # and only one comma, treat as decimal. Otherwise thousands sep.
        last = cleaned.rsplit(",", 1)
        if cleaned.count(",") == 1 and len(last[1]) == 2:
            cleaned = cleaned.replace(",", ".")
        else:
            cleaned = cleaned.replace(",", "")

    try:
        return float(cleaned)
    except ValueError:
        return None


def extract_expense(image_bytes: bytes, mime_type: str = "image/jpeg") -> Optional[ExpenseExtraction]:
    """
    Run the Document AI Expense Parser on the receipt image and return a
    structured extraction. Returns None on any failure so the caller can
    fall back to the heuristic path.
    """
    if not is_enabled():
        return None

    client = _get_client()
    if client is None:
        return None

    project_id = os.getenv("DOC_AI_PROJECT_ID")
    location = os.getenv("DOC_AI_LOCATION", "us")
    processor_id = os.getenv("DOC_AI_EXPENSE_PROCESSOR_ID")

    try:
        name = client.processor_path(project_id, location, processor_id)
        raw_document = documentai.RawDocument(content=image_bytes, mime_type=mime_type)
        request = documentai.ProcessRequest(name=name, raw_document=raw_document)
        result = client.process_document(request=request)
        document = result.document
    except Exception as e:
        logger.warning("Document AI process_document failed: %s", e)
        return None

    extraction: ExpenseExtraction = {
        "items": [],
        "field_confidences": {},
        "low_confidence_fields": [],
    }
    threshold = min_confidence()
    confidences: List[float] = []

    for entity in document.entities or []:
        etype = entity.type_
        confidence = getattr(entity, "confidence", 0.0) or 0.0

        if etype == "supplier_name":
            raw = _entity_value(entity)
            extraction["merchant"] = raw.strip() if isinstance(raw, str) else raw
            extraction["field_confidences"]["merchant"] = confidence
            confidences.append(confidence)
            if confidence < threshold:
                extraction["low_confidence_fields"].append("merchant")
        elif etype in ("receipt_date", "invoice_date", "purchase_time"):
            if "date" not in extraction or extraction.get("date") is None:
                extraction["date"] = _entity_value(entity, prefer="date")
                extraction["field_confidences"]["date"] = confidence
                confidences.append(confidence)
                if confidence < threshold:
                    extraction["low_confidence_fields"].append("date")
        elif etype == "total_amount":
            extraction["amount"] = _entity_value(entity, prefer="money")
            extraction["field_confidences"]["amount"] = confidence
            confidences.append(confidence)
            if confidence < threshold:
                extraction["low_confidence_fields"].append("amount")
            # Currency often rides on the total_amount money_value rather
            # than being emitted as its own entity — pick it up here so
            # we don't lose it.
            if not extraction.get("currency"):
                cur = _money_currency(entity)
                if cur:
                    extraction["currency"] = cur
        elif etype == "total_tax_amount":
            extraction["tax"] = _entity_value(entity, prefer="money")
            extraction["field_confidences"]["tax"] = confidence
        elif etype == "currency":
            extraction["currency"] = _entity_value(entity)
            extraction["field_confidences"]["currency"] = confidence
        elif etype == "line_item":
            item = _line_item_from_entity(entity)
            # Default quantity to 1 when missing — Doc AI omits the field
            # for many receipts and downstream UI expects a number.
            if item.get("quantity") in (None, 0):
                item["quantity"] = 1
            extraction["items"].append(item)
            if (item.get("confidence") or 0.0) < threshold:
                idx = len(extraction["items"]) - 1
                extraction["low_confidence_fields"].append(f"items[{idx}]")

    extraction["overall_confidence"] = (
        sum(confidences) / len(confidences) if confidences else 0.0
    )
    return extraction
