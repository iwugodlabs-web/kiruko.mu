"""Seed a starter field-sales catalog (~10 FMCG products, MUR) for a company.

Usage:
    python backend/scripts/seed_field_sales_products.py [company_id]

Idempotent: a product whose name already exists is skipped (create_product
raises 409 and we swallow it). Run from `backend/` so imports resolve.
"""

import os
import sys

# Make `backend/` importable when run directly (`python backend/scripts/...`).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import HTTPException

from core import config
from db_models.crud import field_sales as crud
from schema.field_sales_schema import (
    ProductCreate,
    ProductVariantCreate,
)

CURRENCY = "MUR"

# (name, brand, category, sku, barcode, unit_price)
CATALOG = [
    ("Coca-Cola 1.5L",        "Coca-Cola", "Beverages", "CC-1500",      "5449000000996", "42.50"),
    ("Coca-Cola 330ml Can",   "Coca-Cola", "Beverages", "CC-330",       "5449000001009", "22.00"),
    ("Fanta Orange 1.5L",     "Fanta",     "Beverages", "FANTA-1500",   "5449000012346", "40.00"),
    ("Sprite 1.25L",          "Sprite",    "Beverages", "SPRITE-1250",  "5449000022345", "38.00"),
    ("Orange Nectar 1L",      "Nectar",    "Juices",    "NEC-OR-1000",  "6001234500017", "55.00"),
    ("Mango Nectar 1L",       "Nectar",    "Juices",    "NEC-MG-1000",  "6001234500024", "58.00"),
    ("Apple Juice 1L",        "Juicy",     "Juices",    "JUC-AP-1000",  "6001234500031", "52.00"),
    ("Premium Water 500ml",   "AquaPure",  "Water",     "AQP-500",      "6009888000012", "15.00"),
    ("Premium Water 1.5L",    "AquaPure",  "Water",     "AQP-1500",     "6009888000029", "26.00"),
    ("Iced Tea Lemon 500ml",  "Fuze",      "Beverages", "FUZE-LM-500",  "6009888000036", "28.00"),
]


def main(company_id: int) -> None:
    db = config.get_db().__next__()
    created = skipped = 0
    try:
        for name, brand, category, sku, barcode, price in CATALOG:
            payload = ProductCreate(
                name=name,
                brand=brand,
                category=category,
                default_variant=ProductVariantCreate(
                    sku=sku,
                    barcode=barcode,
                    unit_price=price,
                    currency=CURRENCY,
                ),
            )
            try:
                crud.create_product(db, company_id, payload)
                db.commit()
                created += 1
                print(f"  + {name}  ({sku}, {CURRENCY} {price})")
            except HTTPException as exc:
                db.rollback()
                if exc.status_code == 409:
                    skipped += 1
                    print(f"  = {name}  (already exists, skipped)")
                else:
                    raise
    finally:
        db.close()
    print(f"\nDone: {created} created, {skipped} skipped for company {company_id}.")


if __name__ == "__main__":
    cid = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    main(cid)
