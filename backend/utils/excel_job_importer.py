"""Compatibility shim.

The real implementation has been moved to `backend.jobs.excel_job_importer` per project
convention: all background tasks live under `backend/jobs/`.

This file re-exports the main class to avoid breaking existing imports. Update your
imports to `from backend.jobs.excel_job_importer import ExcelJobImporter`.
"""

from backend.jobs.excel_job_importer import ExcelJobImporter  # noqa: F401

__all__ = ["ExcelJobImporter"]
