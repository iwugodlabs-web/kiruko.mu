from sqlalchemy import create_engine, engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# Make sqlalchemy_utils optional
try:
    from sqlalchemy_utils import database_exists, create_database, has_index
    SQLALCHEMY_UTILS_AVAILABLE = True
except ImportError:
    print("Warning: sqlalchemy_utils not available. Some features may be disabled.")
    SQLALCHEMY_UTILS_AVAILABLE = False
    # Define dummy functions
    def database_exists(url): return True
    def create_database(url): pass
    def has_index(table, column): return False

from core.settings import get_db_credentials
import traceback

# For error handling in get_db
try:
    from fastapi import HTTPException
except ImportError:
    # Define a simple exception if FastAPI not available
    class HTTPException(Exception):
        def __init__(self, status_code, detail):
            self.status_code = status_code
            self.detail = detail
            super().__init__(detail)



PROJECT_NAME = "Kiruko app"
VERSION = "1.0.0"
API_PREFIX = "/api"




def get_engine(user, password, host, port, db, sslmode):
    if sslmode=="disable":
        return dev_get_engine(user, password, host, port, db)
    return prod_get_engine(user, password, host, port, db, sslmode)


def _install_tenant_guard(engine):
    """Attach the M5a tenant SQL guard + the M5b Session listener that
    bridges the ContextVar into Postgres `app.company_id`. Idempotent —
    safe on every engine."""
    try:
        from core.tenant_guard import install_listener
        install_listener(engine)
    except Exception as exc:
        print(f"Warning: tenant guard not installed: {exc}")
    try:
        from core.tenant_context import install_session_listener
        install_session_listener()
    except Exception as exc:
        print(f"Warning: tenant Session listener not installed: {exc}")


def prod_get_engine(user, password, host, port, db, sslmode):
    # Check if host is a socket path (Cloud SQL)
    if host.startswith('/cloudsql/'):
        # Unix socket connection for Cloud SQL
        url = f"postgresql://{user}:{password}@/{db}?host={host}"
        print(f"Using Cloud SQL socket connection: {db}")
    else:
        # Regular TCP connection
        url = f"postgresql://{user}:{password}@{host}:{port}/{db}"
        if sslmode != "disable":
            url += f"?sslmode={sslmode}"
        print(f"Using TCP connection: {host}:{port}/{db}")

    print(f"Connection URL: {url.replace(password, '***')}")

    try:
        engine = create_engine(
            url,
            pool_pre_ping=True,   # reconnect on stale connections
            pool_size=10,
            max_overflow=20,
        )
        _install_tenant_guard(engine)

        # Test connection
        with engine.connect() as connection:
            print("Database connection successful!")

        return engine
    except Exception as e:
        print("Error connecting to the database:")
        print(traceback.format_exc())
        raise


def test_connection(engine):
    """
    Test the connection to the database.
    """
    try:
        with engine.connect() as connection:
            print("Connection successful!")
            return True
    except SQLAlchemyError as e:
        print("Failed to connect to the database:")
        print(traceback.format_exc())
        return False
    except Exception as e:
        print("An unexpected error occurred during connection testing:")
        print(traceback.format_exc())
        return False

def get_url():
    settings = get_db_credentials()
    host = settings['POSTGRES_SERVER']
    sslmode = settings.get('POSTGRES_SSLMODE', 'disable')

    if host.startswith('/cloudsql/'):
        # Socket connection for Cloud SQL
        return f"postgresql+asyncpg://{settings['POSTGRES_USER']}:{settings['POSTGRES_PASSWORD']}@/{settings['POSTGRES_DB']}?host={host}"
    else:
        # Regular TCP connection
        base = f"postgresql+asyncpg://{settings['POSTGRES_USER']}:{settings['POSTGRES_PASSWORD']}@{host}:{settings['POSTGRES_PORT']}/{settings['POSTGRES_DB']}"
        if sslmode and sslmode != 'disable':
            base += f"?ssl=true"
        return base

def get_sync_url():
    settings = get_db_credentials()
    host = settings['POSTGRES_SERVER']
    sslmode = settings.get('POSTGRES_SSLMODE', 'disable')

    if host.startswith('/cloudsql/'):
        # Socket connection for Cloud SQL
        return f"postgresql+psycopg2://{settings['POSTGRES_USER']}:{settings['POSTGRES_PASSWORD']}@/{settings['POSTGRES_DB']}?host={host}"
    else:
        # Regular TCP connection
        base = (
            f"postgresql+psycopg2://{settings['POSTGRES_USER']}:"
            f"{settings['POSTGRES_PASSWORD']}@{host}:"
            f"{settings['POSTGRES_PORT']}/{settings['POSTGRES_DB']}"
        )
        if sslmode and sslmode != 'disable':
            base += f"?sslmode={sslmode}"
        return base


def get_engine_from_settings():
    settings = get_db_credentials()
    keys = ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_SERVER', 'POSTGRES_PORT', 'POSTGRES_DB','POSTGRES_SSLMODE', 'JWT_SECRET', 'JWT_ALGORITHM']
    if not all(key in keys for key in settings.keys()):
        raise Exception('Bad Config file')

    return get_engine(
        settings['POSTGRES_USER'],
        settings['POSTGRES_PASSWORD'],
        settings['POSTGRES_SERVER'],
        settings['POSTGRES_PORT'],
        settings['POSTGRES_DB'],
        settings['POSTGRES_SSLMODE'],
    )


def dev_get_engine(user, password,host,port,db):
    url=f"postgresql://{user}:{password}@{host}:{port}/{db}"

    if SQLALCHEMY_UTILS_AVAILABLE:
        if not database_exists(url):
            create_database(url)
    else:
        print(f"Warning: Cannot check/create database. Assuming {db} exists.")

    engine = create_engine(url, pool_size=50, echo=False)
    _install_tenant_guard(engine)
    return engine


# Global variables - initialized lazily
engine = None
SessionLocal = None

def get_engine_instance():
    """Get engine instance, creating it if necessary"""
    global engine
    if engine is None:
        try:
            engine = get_engine_from_settings()
            test_connection(engine)
            # M5a: install the multi-tenant SQL guard once per engine.
            try:
                from core.tenant_guard import install_listener
                install_listener(engine)
            except Exception as exc:
                print(f"Warning: tenant guard not installed: {exc}")
        except Exception as e:
            print(f"Warning: Could not initialize database engine: {e}")
            engine = None
    return engine

def get_session_local():
    """Get SessionLocal, creating it if necessary"""
    global SessionLocal
    if SessionLocal is None:
        eng = get_engine_instance()
        if eng is not None:
            SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=eng)
    return SessionLocal



def get_db():
    """
    Dependency for providing a database session.
    """
    session_factory = get_session_local()
    if session_factory is None:
        raise HTTPException(status_code=500, detail="Database not available")
        
    db = session_factory()  # Create a new session instance
    try:
        yield db  # Provide the session to the route
    except Exception:
        db.rollback()  # Rollback in case of error
        raise
    finally:
        db.close()  # Close the session

