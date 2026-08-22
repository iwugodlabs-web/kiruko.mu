#!/usr/bin/env python3
"""Create all database tables from SQLAlchemy models."""

import os
import sys

# Add the backend directory to Python path
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, backend_dir)

from core.config import get_engine
from core.model import Base

def main():
    # Get database credentials from environment variables
    user = os.getenv("POSTGRES_USER", "postgres")
    password = os.getenv("POSTGRES_PASSWORD", "")
    host = os.getenv("POSTGRES_SERVER", "127.0.0.1")
    port = os.getenv("POSTGRES_PORT", "5432")
    db = os.getenv("POSTGRES_DB", "ivor_db")
    sslmode = os.getenv("POSTGRES_SSLMODE", "disable")

    print(f"Creating tables in database: {db}")

    try:
        engine = get_engine(user, password, host, port, db, sslmode)
        Base.metadata.create_all(engine)
        print("✅ All tables created successfully!")
    except Exception as e:
        print(f"❌ Failed to create tables: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()