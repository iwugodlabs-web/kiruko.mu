from core.config import get_session_local
from services.time_log_service import TimeLogService


def main():
    SessionLocal = get_session_local()
    if SessionLocal is None:
        raise RuntimeError("Could not initialize database session")

    with SessionLocal() as db:
        closed_count = TimeLogService.cleanup_active_time_logs(db)
        print(f"Closed {closed_count} stale or redundant active time log session(s).")


if __name__ == '__main__':
    main()
