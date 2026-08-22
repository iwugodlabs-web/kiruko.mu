try:
    from decouple import config
    DECOUPLE_AVAILABLE = True
except ImportError:
    print("Warning: python-decouple not available. Using environment variables directly.")
    import os
    DECOUPLE_AVAILABLE = False
    # Fallback to os.getenv
    def config(key, default=None):
        return os.getenv(key, default)


def get_db_credentials():
    # Check if we're running in Cloud Run with Cloud SQL
    environment = config("ENVIRONMENT", default="development")
    
    if environment == "production":
        # Cloud Run with Cloud SQL connection
        connection_name = config("CLOUD_SQL_CONNECTION_NAME")
        if connection_name:
            # Use Unix socket connection for Cloud SQL
            db_socket_dir = "/cloudsql"
            db_socket_path = f"{db_socket_dir}/{connection_name}"
            
            return {
                'POSTGRES_USER': config("DB_USER", default="postgres"),
                'POSTGRES_PASSWORD': config("DB_PASSWORD"),
                'POSTGRES_SERVER': db_socket_path,  # Use socket path
                'POSTGRES_PORT': "5432",
                'POSTGRES_DB': config("DB_NAME", default="postgres"),
                'POSTGRES_SSLMODE': 'disable',  # Not needed for socket connection
                'JWT_SECRET': config("JWT_SECRET"),
                'JWT_ALGORITHM': config("JWT_ALGORITHM", default="HS256")
            }
    
    # Fall back to individual settings for local development
    settings = {
        'POSTGRES_USER': config("POSTGRES_USER", default="postgres"),
        'POSTGRES_PASSWORD': config("POSTGRES_PASSWORD"),
        'POSTGRES_SERVER': config("POSTGRES_SERVER", default="127.0.0.1"),
        'POSTGRES_PORT': config("POSTGRES_PORT", default="5432"),
        'POSTGRES_DB': config("POSTGRES_DB", default="postgres"),
        'POSTGRES_SSLMODE': config('POSTGRES_SSLMODE', default="disable"),
        'JWT_SECRET': config("JWT_SECRET"),
        'JWT_ALGORITHM': config("JWT_ALGORITHM", default="HS256")
    }
    return settings


def get_time_zone() -> dict:
    settings = {
        'TIME_ZONE_PROD': config("TIME_ZONE_LOCAL", default="Etc/UTC"),  # Set default to "UTC"
    }
    return settings