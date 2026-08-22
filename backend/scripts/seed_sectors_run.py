#!/usr/bin/env python3
"""Run sector seeder (dry-run by default).

Usage:
    python3 backend/scripts/seed_sectors_run.py [--file path] [--country MU] [--currency MUR] [--apply] [--drop]

Options:
    --file PATH       Path to CSV/spreadsheet (default: backend/mauritius_sector_rates.csv)
    --country CODE    ISO 3166-1 alpha-2 country code (default: MU)
    --currency CODE   ISO 4217 currency code (default: MUR)
    --apply           Actually write to the database (default: dry-run)
    --drop            When applying, purge existing data for that country first (use with caution)

This script uses the application's DB settings (environment/.env). It will print the
connection info (with password masked) before running so you can confirm it targets
your local DB.
"""
import sys
import os
repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, repo_root)
import argparse
from backend.jobs.seed_sectors_from_excel import SectorExcelSeeder
from core import config


def mask_password(url):
    try:
        return url.replace(config.get_db_credentials()['POSTGRES_PASSWORD'], '***')
    except Exception:
        return url


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--file', default='backend/mauritius_sector_rates.csv')
    parser.add_argument('--country', default='MU', help='ISO 3166-1 alpha-2 country code')
    parser.add_argument('--currency', default='MUR', help='ISO 4217 currency code')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--drop', action='store_true')
    args = parser.parse_args()

    print('Using DB settings:')
    try:
        sync_url = config.get_sync_url()
        print('Sync URL:', mask_password(sync_url))
    except Exception as e:
        print('Could not read DB URL from settings:', e)

    print(f'Country: {args.country}  Currency: {args.currency}  Dry-run: {not args.apply}')

    SessionLocal = config.get_session_local()
    if SessionLocal is None:
        print('No database session available. Check your environment variables.')
        sys.exit(1)

    db = SessionLocal()
    seeder = SectorExcelSeeder(db, default_country=args.country, default_currency=args.currency)

    try:
        report = seeder.seed_file(args.file, dry_run=not args.apply, drop_tables=args.drop)
        print('\nSEED REPORT:')
        for k, v in report.items():
            print(f'{k}: {v}')
    finally:
        db.close()


if __name__ == '__main__':
    main()
