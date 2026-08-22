
import os as _os
try:
    from dotenv import load_dotenv as _load_dotenv
    _load_dotenv(_os.path.join(_os.path.dirname(__file__), '.env'), override=True)
except Exception:
    pass

from fastapi import APIRouter, Depends, status, HTTPException
from typing import Union
from api import v1
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from typing import List
from core.model import Base
from core import config
import logging
from fastapi import Request, Response
from core.model import RequestLog
from core.config import get_session_local, get_db
from core.security import decode_token

# Rate limiting — single shared Limiter so all routers use the same state
from core.limiter import limiter, RATE_LIMITING_ENABLED
try:
    from slowapi import _rate_limit_exceeded_handler
    from slowapi.errors import RateLimitExceeded
except ImportError:
    _rate_limit_exceeded_handler = None  # type: ignore[assignment]
    RateLimitExceeded = None  # type: ignore[assignment,misc]
    if not RATE_LIMITING_ENABLED:
        print("⚠️ slowapi not installed — rate limiting disabled. Run: pip install slowapi")

# Try to create tables, but don't fail if it doesn't work
try:
    engine = config.get_engine_from_settings()
    if engine:
        # Base.metadata.create_all(bind=engine)
        print("✅ Database tables creation skipped (using alembic)")
    else:
        print("⚠️ No database engine available")
except Exception as e:
    print(f"⚠️ Database initialization failed: {e}")
    # Continue without database - let individual endpoints handle DB errors


def get_application():
    app = FastAPI(title=config.PROJECT_NAME, version=config.VERSION)

    # ── Rate limiter state ──────────────────────────────────────────────────
    if RATE_LIMITING_ENABLED:
        app.state.limiter = limiter
        app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    # ── CORS ────────────────────────────────────────────────────────────────
    # Load allowed origins from CORS_ORIGINS env var (comma-separated).
    # Falls back to localhost defaults for dev if the var is not set.
    _cors_env = _os.getenv("CORS_ORIGINS", "")
    _cors_origins = [o.strip() for o in _cors_env.split(",") if o.strip()] if _cors_env else [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization", "X-Platform", "Accept", "Idempotency-Key"],
    )

    # M6: Idempotency middleware — caches successful POST/PATCH/DELETE
    # responses keyed by Idempotency-Key + method + path.
    try:
        from core.idempotency import IdempotencyMiddleware
        _session_factory = get_session_local()
        if _session_factory is not None:
            app.add_middleware(IdempotencyMiddleware, session_factory=_session_factory)
            print("✅ Idempotency middleware installed")
    except Exception as _e:
        print(f"⚠️ Idempotency middleware not installed: {_e}")

    # M5b RLS: a global async dependency that binds the request's tenant
    # (app.company_id) from the JWT, in the async context so it propagates to the
    # route and the after_begin bridge re-applies it on every transaction. Inert
    # until RLS policies are enabled.
    from fastapi import Depends as _Depends
    from core.dependencies import bind_tenant_context
    app.include_router(v1.router, prefix="/api/v1", dependencies=[_Depends(bind_tenant_context)])
    # app.include_router(google_drive.router)

    # Static files for the local storage backend (services/storage_service.py
    # LocalStorage writes to ./uploads and returns "/uploads/..." URLs).
    # Without this mount, sponsored-content images, profile photos, etc.
    # serialize fine into JSON responses but 404 when the client fetches them.
    # S3/GCS deployments use absolute URLs and don't need this; the mount is
    # cheap so we leave it always-on.
    try:
        from fastapi.staticfiles import StaticFiles
        # `_os` is imported at the module top — DON'T re-import here, that
        # would create a function-local binding and shadow earlier uses
        # (line ~58 reads _os.getenv before this block executes, raising
        # UnboundLocalError).
        _uploads_dir = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "uploads")
        _os.makedirs(_uploads_dir, exist_ok=True)
        app.mount("/uploads", StaticFiles(directory=_uploads_dir), name="uploads")
    except Exception as _e:
        print(f"⚠️ /uploads static mount failed: {_e}")

    def log_request_metadata(
        method: str,
        path: str,
        ip_address: str,
        user_agent: str,
        platform: str,
        user_id: int = None
    ):
        session_factory = get_session_local()
        if session_factory:
            db = session_factory()
            try:
                log_entry = RequestLog(
                    user_id=user_id,
                    platform=platform,
                    user_agent=user_agent,
                    ip_address=ip_address,
                    method=method,
                    path=path
                )
                db.add(log_entry)
                db.commit()
            except Exception as e:
                print(f"Error logging request metadata: {e}")
            finally:
                db.close()

    @app.middleware("http")
    async def add_request_metadata_logging(request: Request, call_next):
        # Paths to exclude from logging to save DB space
        excluded_paths = ["/docs", "/openapi.json", "/redoc", "/favicon.ico"]
        path = request.url.path
        
        if path in excluded_paths:
            return await call_next(request)

        # Extract metadata
        user_agent = request.headers.get("user-agent", "unknown")
        platform = request.headers.get("x-platform")
        
        # Better platform detection fallback via User-Agent
        if not platform or platform == "web":
            ua_lower = user_agent.lower()
            if any(k in ua_lower for k in ["iphone", "ipad", "cfnetwork", "darwin"]):
                platform = "ios"
            elif "android" in ua_lower:
                platform = "android"
            else:
                platform = platform or "web"

        ip_address = request.client.host if request.client else "unknown"
        method = request.method
        
        # Try to extract user_id if token is present
        user_id = None
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]
            try:
                token_data = decode_token(token)
                if token_data:
                    user_id = token_data.get("user", {}).get("user_id")
            except:
                pass
        
        if not user_id:
            # Try cookie
            cookie_token = request.cookies.get("access_token")
            if cookie_token:
                try:
                    token_data = decode_token(cookie_token)
                    if token_data:
                        user_id = token_data.get("user", {}).get("user_id")
                except:
                    pass

        # Log to console
        log_msg = f"[REQUEST] {method} {path} | Platform: {platform} | User ID: {user_id} | IP: {ip_address}"
        print(log_msg)
        
        # Process the request
        response = await call_next(request)
        
        # Save to DB asynchronously (basic version)
        import threading
        t = threading.Thread(target=log_request_metadata, args=(method, path, ip_address, user_agent, platform, user_id))
        t.start()
            
        return response

    def cleanup_old_logs():
        """Delete request logs older than 30 days to save space"""
        from datetime import datetime, timedelta
        session_factory = get_session_local()
        if session_factory:
            db = session_factory()
            try:
                retention_period = datetime.utcnow() - timedelta(days=30)
                db.query(RequestLog).filter(RequestLog.created_at < retention_period).delete()
                db.commit()
                print("✅ Cleaned up old request logs")
            except Exception as e:
                print(f"Error cleaning up logs: {e}")
            finally:
                db.close()

    # Run cleanup in background on startup
    import threading
    threading.Thread(target=cleanup_old_logs).start()

    def stale_time_log_cleanup_loop():
        from services.time_log_service import TimeLogService
        from services.kiosk_service import KioskService
        from core.tenant_context import bypass_tenant_guard
        from sqlalchemy import text as _sql_text
        import time

        # Multi-instance safety: a Postgres session-level advisory lock ensures
        # exactly ONE web instance runs this tick, even when the service scales
        # to N instances. Harmless at instance_count=1 (always acquired).
        # MUST be released explicitly — a session-level lock survives commits and
        # is NOT freed by returning the connection to the pool.
        _CLEANUP_LOCK_KEY = 873214  # arbitrary, app-wide id for the cleanup tick

        session_factory = get_session_local()
        if not session_factory:
            print("⚠️ Stale time log cleanup disabled: no DB session available")
            return

        while True:
            try:
                db = session_factory()
                try:
                    got_lock = db.execute(
                        _sql_text("SELECT pg_try_advisory_lock(:k)"),
                        {"k": _CLEANUP_LOCK_KEY},
                    ).scalar()
                    if not got_lock:
                        # Another instance owns this tick — skip (no duplicate
                        # work or duplicate auto-close notifications).
                        pass
                    else:
                        try:
                            # System job: sweeps active sessions across ALL companies,
                            # so it legitimately has no single tenant. Bypass the tenant
                            # guard (which otherwise warns on the cross-tenant queries).
                            with bypass_tenant_guard("scheduled stale-time-log cleanup (system job, all tenants)"):
                                closed_count = TimeLogService.cleanup_active_time_logs(db)
                                if closed_count > 0:
                                    print(f"✅ Scheduled cleanup closed {closed_count} stale/redundant active time log(s)")
                                # Smart schedule-anchored close: forgotten clock-outs (past
                                # work_end_time + grace, not confirmed overtime) closed AT the
                                # scheduled end. Runs here so it fires even when no app is open.
                                sched_closed = TimeLogService.close_past_schedule_unclaimed(db)
                                if sched_closed > 0:
                                    print(f"✅ Scheduled cleanup closed {sched_closed} session(s) at their scheduled end time")
                                # Kiosk idempotency TTL sweep — no pg_cron in this project,
                                # so it piggybacks on this cleanup tick (see kiosk_service.py).
                                try:
                                    KioskService.purge_old_idempotency_rows(db)
                                except Exception as ke:
                                    print(f"⚠️ Kiosk idempotency sweep failed: {ke}")
                                # Clock-in / clock-out reminder pushes — also no
                                # external cron, so it rides this same advisory-
                                # locked tick. The job's per-day dedup makes the
                                # 5-min cadence vs 10-min window safe (see
                                # jobs/clock_reminders.py).
                                try:
                                    from jobs import clock_reminders
                                    reminded = clock_reminders.run(db)
                                    if reminded > 0:
                                        print(f"✅ Sent {reminded} clock-in/out reminder push(es)")
                                except Exception as re:
                                    print(f"⚠️ Clock reminder push failed: {re}")
                                # Notification retention — delete read recipient rows
                                # (and orphaned events) older than 90 days. No external
                                # cron, so it rides this advisory-locked tick; the
                                # age filter makes it a near no-op once caught up.
                                try:
                                    from services.notification_service import NotificationService
                                    purged = NotificationService.purge_old_notifications(db)
                                    if purged > 0:
                                        print(f"✅ Purged {purged} old read notification row(s)")
                                except Exception as ne:
                                    print(f"⚠️ Notification retention sweep failed: {ne}")
                        finally:
                            db.execute(
                                _sql_text("SELECT pg_advisory_unlock(:k)"),
                                {"k": _CLEANUP_LOCK_KEY},
                            )
                finally:
                    db.close()
            except Exception as e:
                print(f"⚠️ Scheduled stale time log cleanup failed: {e}")
            # Every 5 minutes — the schedule-anchored auto-close uses a 15-min
            # grace, so an hourly tick left forgotten clock-outs open for up to
            # an hour past their scheduled end. The work is cheap + advisory-
            # locked, so a tighter cadence is safe.
            time.sleep(300)

    threading.Thread(target=stale_time_log_cleanup_loop, daemon=True).start()

    # Durable outbound-email queue worker — delivers enqueued email_jobs with
    # retry/backoff. Disable via EMAIL_WORKER_ENABLED=false (e.g. in tests).
    try:
        from services import email_queue
        email_queue.start_worker()
    except Exception as e:
        print(f"⚠️  email_queue worker failed to start: {e}")

    # Durable outbound-push queue worker — delivers enqueued push_jobs (Expo) with
    # retry/backoff, off the request thread. Disable via PUSH_WORKER_ENABLED=false.
    try:
        from services import push_queue
        push_queue.start_worker()
    except Exception as e:
        print(f"⚠️  push_queue worker failed to start: {e}")

    def holiday_calendar_coverage_check():
        """Warn when an active country's public-holiday calendar is running
        out. Without 90+ days of forward coverage, the overtime engine
        silently misses 2× / 3× pay on holidays that aren't seeded.
        Operational gate; logs only — does not block startup."""
        from datetime import date, timedelta
        from sqlalchemy import func as _func
        session_factory = get_session_local()
        if not session_factory:
            return
        db = session_factory()
        try:
            from core.model import Company, PublicHoliday
            from core.tenant_context import bypass_tenant_guard
            # Intentionally cross-tenant: an operational health check that scans
            # every company's country code. Run under the bypass so the
            # multi-tenant guard doesn't log a (correct-here) false positive.
            with bypass_tenant_guard("startup holiday-calendar coverage check"):
                active_countries = (
                    db.query(Company.country_code).distinct().all()
                )
            cutoff = date.today() + timedelta(days=90)
            for (cc,) in active_countries:
                if not cc:
                    continue
                last_holiday = (
                    db.query(_func.max(PublicHoliday.observed_date))
                    .filter(PublicHoliday.country_code == cc)
                    .scalar()
                )
                if last_holiday is None or last_holiday < cutoff:
                    print(
                        f"⚠️  HOLIDAY CALENDAR WARNING: country={cc} — "
                        f"last seeded observed_date={last_holiday}; "
                        f"need coverage past {cutoff.isoformat()}. "
                        "Overtime engine will under-pay if a holiday falls in the gap."
                    )
        except Exception as e:
            print(f"⚠️  holiday_calendar_coverage_check failed: {e}")
        finally:
            db.close()

    threading.Thread(target=holiday_calendar_coverage_check, daemon=True).start()

    # Sector seeder — only runs when RUN_SEEDER=true is set in env.
    # Wipes and re-seeds all sector tables from the CSV.
    # Remove RUN_SEEDER after a successful seed to prevent re-running.
    if _os.environ.get('RUN_SEEDER', '').lower() == 'true':
        def run_sector_seeder():
            import time, traceback
            time.sleep(5)   # let the app and DB fully come online first
            print('[sector-seeder] RUN_SEEDER=true — wiping and re-seeding sector tables...')
            try:
                session_factory = get_session_local()
                if not session_factory:
                    print('[sector-seeder] ❌ No DB session available')
                    return
                csv_path = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), 'mauritius_sector_rates.csv')
                if not _os.path.exists(csv_path):
                    print(f'[sector-seeder] ❌ CSV not found at {csv_path}')
                    return
                from jobs.seed_sectors_from_excel import SectorExcelSeeder
                db = session_factory()
                try:
                    seeder = SectorExcelSeeder(db)
                    report = seeder.seed_file(csv_path, dry_run=False, drop_tables=True)
                    print(f'[sector-seeder] ✅ Seed complete: {report}')
                finally:
                    db.close()
            except Exception as e:
                print(f'[sector-seeder] ❌ Error: {e}')
                traceback.print_exc()

        threading.Thread(target=run_sector_seeder, daemon=True).start()

    return app


app = get_application()

from fastapi.responses import JSONResponse
from core.exceptions import IvorServiceException
from fastapi.exceptions import RequestValidationError
logger = logging.getLogger(__name__)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    logger.warning(
        "Request validation error on %s %s: body=%s errors=%s",
        request.method,
        request.url.path,
        (await request.body()).decode("utf-8", errors="replace")[:2000],
        exc.errors(),
    )
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors()},
    )


@app.exception_handler(IvorServiceException)
async def ivor_service_exception_handler(request: Request, exc: IvorServiceException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.message},
    )


# ── Never leak internal error detail to clients ──────────────────────────────
# Raw SQL, driver messages and stack traces must never reach the app. 4xx
# details are curated, user-facing messages and pass through unchanged; ANY 5xx
# detail is replaced with a generic message and the real one is logged
# server-side. This single choke point neutralizes every endpoint that did
# `raise HTTPException(500, detail=str(e))`, and the SQLAlchemyError / Exception
# handlers catch anything that propagates uncaught.
from starlette.exceptions import HTTPException as _StarletteHTTPException
from fastapi.exception_handlers import http_exception_handler as _default_http_exception_handler
from sqlalchemy.exc import SQLAlchemyError as _SQLAlchemyError

_GENERIC_5XX = "Something went wrong on our end. Please try again in a moment."


@app.exception_handler(_StarletteHTTPException)
async def http_exception_handler_override(request: Request, exc: _StarletteHTTPException):
    if exc.status_code >= 500:
        logger.error(
            "%s on %s %s: %s",
            exc.status_code, request.method, request.url.path, exc.detail,
        )
        return JSONResponse(status_code=exc.status_code, content={"detail": _GENERIC_5XX})
    return await _default_http_exception_handler(request, exc)


@app.exception_handler(_SQLAlchemyError)
async def sqlalchemy_exception_handler(request: Request, exc: _SQLAlchemyError):
    logger.exception("Unhandled database error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "A database error occurred. Please try again."},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": _GENERIC_5XX})


# ── Health check ────────────────────────────────────────────────────────────
@app.get("/health", tags=["system"])
async def health_check():
    """
    Liveness + readiness probe for container orchestration.
    Checks DB connectivity so the orchestrator knows when the app is truly ready.
    """
    from sqlalchemy import text
    session_factory = get_session_local()
    db_status = "unavailable"
    if session_factory:
        db = session_factory()
        try:
            db.execute(text("SELECT 1"))
            db_status = "connected"
        except Exception as e:
            logger.error(f"Health check DB error: {e}")
            db_status = "error"
        finally:
            db.close()
    return {
        "status": "ok" if db_status == "connected" else "degraded",
        "db": db_status,
        "version": config.VERSION,
        "rate_limiting": RATE_LIMITING_ENABLED,
    }


# ── In-app PDF viewer ─────────────────────────────────────────────────────────
# A pdf.js viewer page used by the mobile app's DocViewerModal to render PDFs
# inside a WebView (Android's system WebView can't render PDFs inline). The page
# is fully static — the `?file=` URL is read CLIENT-SIDE and fetched by pdf.js,
# so there's no server-side reflection (no XSS) and no SSRF (the server never
# fetches the file). For local storage the file is same-origin (no CORS); for
# S3/Spaces the bucket needs CORS allowing the app to GET the object.
_PDF_VIEWER_HTML = """<!DOCTYPE html>
<html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=4"/>
<style>
  html,body{margin:0;background:#525659;height:100%}
  #pages{padding:8px 0}
  canvas{display:block;margin:8px auto;max-width:98%;box-shadow:0 1px 6px rgba(0,0,0,.5)}
  #msg{color:#fff;font-family:-apple-system,Roboto,sans-serif;padding:24px;text-align:center}
</style></head>
<body>
<div id="pages"></div>
<div id="msg">Loading…</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script>
  var file = new URLSearchParams(location.search).get('file');
  var msg = document.getElementById('msg');
  if(!file){ msg.textContent='No file specified.'; }
  else {
    pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    pdfjsLib.getDocument(file).promise.then(function(pdf){
      msg.style.display='none';
      var box=document.getElementById('pages');
      var dpr=Math.min(window.devicePixelRatio||1,2);
      (function render(i){
        if(i>pdf.numPages) return;
        pdf.getPage(i).then(function(page){
          var vp=page.getViewport({scale:1.4*dpr});
          var c=document.createElement('canvas');
          c.width=vp.width; c.height=vp.height; c.style.width='100%';
          box.appendChild(c);
          page.render({canvasContext:c.getContext('2d'),viewport:vp}).promise.then(function(){ render(i+1); });
        });
      })(1);
    }).catch(function(e){ msg.textContent='Could not load PDF: '+(e&&e.message||e); });
  }
</script>
</body></html>"""


@app.get("/pdf-view", include_in_schema=False)
async def pdf_view():
    return Response(content=_PDF_VIEWER_HTML, media_type="text/html")
