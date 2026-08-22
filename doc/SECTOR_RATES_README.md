# Sector Rates — Data Management Guide

This document explains how to prepare, import, and update government remuneration
data for the salary calculator.

---

## File Format

The seeder accepts both `.csv` and `.xlsx` files. The file must have exactly
**8 columns** with these exact header names:

| Column | Header | Required | Description |
|--------|--------|----------|-------------|
| A | `Sector` | ✅ | Industry name — must be spelled identically on every row for the same sector |
| B | `Category of Employee` | ✅ | Job category e.g. Supervisor, Cook, General Worker |
| C | `Grade / Service Details` | ❌ | Sub-grade description — leave blank if not applicable |
| D | `Year of Service` | ❌ | e.g. `1st year`, `2nd year`, `5th year & above` — leave blank if not year-based |
| E | `Rate Type` | ✅ | One of: `monthly` `daily` `hourly` `per_kg` `per_show` |
| F | `Rate` | ✅ | Plain number only — no commas, symbols or currency — e.g. `17101` or `810.89` |
| G | `Effective From` | ✅ | ISO date `YYYY-MM-DD` — e.g. `2024-01-01` |
| H | `Notes` | ❌ | Free text — e.g. `6-day week` — leave blank if not needed |

### Example rows

```
Sector,Category of Employee,Grade / Service Details,Year of Service,Rate Type,Rate,Effective From,Notes
Attorneys,Clerk,,1st year,monthly,17101,2024-01-01,
Attorneys,Clerk,,2nd year,monthly,17257,2024-01-01,
Baking Industry,Bakery Operator,Semi-automated bakery,,daily,810.89,2024-01-01,6-day week
Banks Fishermen,Banks Fisherman,Up to 125 kilogrammes,,per_kg,32.82,2024-01-01,Per dory of 3 fishermen
Domestic Workers,Cook,Hourly,,hourly,85.87,2024-01-01,
Cinema Industry,Projectionist,,,per_show,826.66,2024-01-01,Per show above 28 shows
```

**Rules:**
- One row = one rate. If a category has 10 years-of-service tiers, that is 10 rows.
- The `Sector` name is the grouping key — consistent spelling is critical.
- `Rate` must be a plain number with no formatting.
- Sugar Industry and Tea Industry use `effective_from = 2024-07-01` (July fiscal year start).

---

## Running the Seeder

All commands are run from the **repo root** (`ivor-mobile/`).

### First-time load (wipes existing data for the country, then reseeds)

```bash
python backend/scripts/seed_sectors_run.py \
  --file backend/mauritius_sector_rates.csv \
  --country MU \
  --currency MUR \
  --apply \
  --drop
```

### Add new rates without touching existing data

```bash
python backend/scripts/seed_sectors_run.py \
  --file backend/mauritius_sector_rates.csv \
  --country MU \
  --currency MUR \
  --apply
```

### Dry run (preview only — nothing is written to the DB)

```bash
python backend/scripts/seed_sectors_run.py \
  --file backend/mauritius_sector_rates.csv \
  --country MU \
  --currency MUR
```

### Adding a new country

```bash
python backend/scripts/seed_sectors_run.py \
  --file backend/kenya_sector_rates.csv \
  --country KE \
  --currency KES \
  --apply
```

---

## Adding a New Year's Data (e.g. 2026 rates)

**Do not modify existing rows.** Simply append the new year's rows to the same
file with the updated `Effective From` date.

### Example — Attorneys / Clerk (2024 rows stay, 2026 rows are added below)

```
Attorneys,Clerk,,1st year,monthly,17101,2024-01-01,   ← existing, keep as-is
Attorneys,Clerk,,2nd year,monthly,17257,2024-01-01,   ← existing, keep as-is
Attorneys,Clerk,,1st year,monthly,18500,2026-01-01,   ← new 2026 rate
Attorneys,Clerk,,2nd year,monthly,18700,2026-01-01,   ← new 2026 rate
```

Then re-run the seeder **without** `--drop`:

```bash
python backend/scripts/seed_sectors_run.py \
  --file backend/mauritius_sector_rates.csv \
  --country MU --currency MUR --apply
```

The DB will now hold both years. The calculator automatically picks the most
recent rate on or before today's date.

---

## How the Effective Date Logic Works

The salary calculator filters rows using:

```sql
WHERE effective_from <= TODAY
ORDER BY effective_from DESC   -- newest rates win
```

| Scenario | Result |
|----------|--------|
| Only 2024 rows exist | Calculator shows 2024 rates |
| 2024 + 2026 rows exist, today = Apr 2026 | Calculator shows 2026 rates |
| 2024 + `2026-07-01` rows exist, today = Apr 2026 | Calculator still shows 2024 rates (July not reached yet) |
| 2024 + `2026-07-01` rows exist, today = Aug 2026 | Calculator shows 2026 rates |

This means you can **pre-load future rates** into the DB before they are live —
the system will switch automatically on the right date.

---

## Year-over-Year Comparison API

To see all historical rates for a category (for comparative reporting):

```
GET /api/v1/sector/category/{category_id}/history
```

Response groups all years oldest → newest:

```json
{
  "category_name": "Clerk",
  "sector_name": "Attorneys",
  "country_code": "MU",
  "currency": "MUR",
  "years": [
    {
      "effective_from": "2024-01-01",
      "rows": [
        { "min_years_of_service": 1, "basic_monthly_salary": 17101.0 },
        { "min_years_of_service": 2, "basic_monthly_salary": 17257.0 }
      ]
    },
    {
      "effective_from": "2026-01-01",
      "rows": [
        { "min_years_of_service": 1, "basic_monthly_salary": 18500.0 },
        { "min_years_of_service": 2, "basic_monthly_salary": 18700.0 }
      ]
    }
  ]
}
```

Use this endpoint to build a side-by-side comparison table:

| Year of Service | 2024 Rate (MUR) | 2026 Rate (MUR) | Change |
|-----------------|-----------------|-----------------|--------|
| 1st year | 17,101 | 18,500 | +8.2% |
| 2nd year | 17,257 | 18,700 | +8.4% |

---

## Seeder Output — What the Report Means

```
rows: 847               ← total rows read from the file
sectors_created: 21     ← new sector records inserted
categories_created: 170 ← new category records inserted
grades_created: 112     ← new grade records inserted
salary_ranges_created: 847 ← salary rows inserted
skipped: 0              ← rows that already existed (idempotent)
failures: []            ← any rows that failed to parse (should be empty)
```

A non-zero `skipped` count is normal when re-running without `--drop` — it means
those exact rows already exist and were left untouched.

---

## Exporting a Formatted Excel Template

To regenerate the Excel template from the current CSV:

```bash
python backend/scripts/export_xlsx.py
```

Output: `backend/mauritius_sector_rates_template.xlsx`

The template includes:
- **Sheet 1 "Sector Rates"** — all current data with styled headers, alternating
  row shading, frozen header row, and auto-filter
- **Sheet 2 "Reference"** — field-by-field guide with allowed values

---

## Files

| File | Purpose |
|------|---------|
| `backend/mauritius_sector_rates.csv` | Master data file — source of truth for Mauritius rates |
| `backend/mauritius_sector_rates_template.xlsx` | Formatted Excel export of the master file |
| `backend/jobs/seed_sectors_from_excel.py` | Seeder engine (CSV/XLSX parser + DB upsert logic) |
| `backend/scripts/seed_sectors_run.py` | CLI wrapper for the seeder |
| `backend/scripts/export_xlsx.py` | Generates the formatted Excel template |
| `backend/api/v1/sector.py` | Sector API endpoints |
| `backend/db_models/crud/sector.py` | Sector database queries |
| `backend/schema/sector_schema.py` | Pydantic request/response schemas |
