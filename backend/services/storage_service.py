import os
import uuid
import logging
from abc import ABC, abstractmethod
from typing import Optional
from fastapi import UploadFile
from core import config as app_config

logger = logging.getLogger(__name__)

class BaseStorage(ABC):
    @abstractmethod
    async def upload_file(self, file: UploadFile, folder: str = "uploads") -> Optional[str]:
        pass

    @abstractmethod
    def get_file_url(self, file_path: str) -> str:
        pass

    def upload_bytes(
        self,
        data: bytes,
        *,
        filename: str,
        content_type: str = "application/octet-stream",
        folder: str = "uploads",
    ) -> Optional[str]:
        """Synchronous bytes upload — the M21 PDF generator calls this
        from inside finalize_run rather than going through UploadFile.

        Subclasses override; the default raises so misconfigured backends
        fail fast instead of silently dropping the upload.
        """
        raise NotImplementedError(
            f"{type(self).__name__} does not implement upload_bytes"
        )

    def delete_file(self, file_url: Optional[str]) -> bool:
        """Best-effort deletion of a previously-stored file (used by account
        deletion to scrub uploaded documents/receipts). Returns True on success.
        Default is a safe no-op so callers never crash on an unconfigured backend."""
        return False

class LocalStorage(BaseStorage):
    def __init__(self, base_path: str = "uploads"):
        self.base_path = base_path
        if not os.path.exists(self.base_path):
            os.makedirs(self.base_path, exist_ok=True)

    async def upload_file(self, file: UploadFile, folder: str = "uploads") -> Optional[str]:
        try:
            folder_path = os.path.join(self.base_path, folder)
            os.makedirs(folder_path, exist_ok=True)

            file_extension = os.path.splitext(file.filename)[1]
            unique_filename = f"{uuid.uuid4()}{file_extension}"
            file_path = os.path.join(folder_path, unique_filename)

            with open(file_path, "wb") as buffer:
                import shutil
                shutil.copyfileobj(file.file, buffer)

            return f"/uploads/{folder}/{unique_filename}"
        except Exception as e:
            logger.error(f"LocalStorage upload error: {e}")
            return None

    def upload_bytes(self, data, *, filename, content_type="application/octet-stream", folder="uploads"):
        try:
            folder_path = os.path.join(self.base_path, folder)
            os.makedirs(folder_path, exist_ok=True)
            file_path = os.path.join(folder_path, filename)
            with open(file_path, "wb") as buf:
                buf.write(data)
            return f"/uploads/{folder}/{filename}"
        except Exception as e:
            logger.error(f"LocalStorage upload_bytes error: {e}")
            return None

    def get_file_url(self, file_path: str) -> str:
        return file_path

    def delete_file(self, file_url: Optional[str]) -> bool:
        if not file_url:
            return False
        try:
            rel = file_url
            for prefix in ("/uploads/", "uploads/"):
                if rel.startswith(prefix):
                    rel = rel[len(prefix):]
                    break
            path = os.path.join(self.base_path, rel)
            if os.path.isfile(path):
                os.remove(path)
            return True
        except Exception as e:
            logger.error(f"LocalStorage delete error for {file_url}: {e}")
            return False

class S3Storage(BaseStorage):
    def __init__(self):
        try:
            import boto3
            from decouple import config
            # AWS_S3_ENDPOINT_URL lets this client target any S3-compatible
            # store (e.g. DigitalOcean Spaces: https://<region>.digitaloceanspaces.com).
            # Left empty → real AWS S3.
            endpoint = config('AWS_S3_ENDPOINT_URL', default='') or None
            client_kwargs = dict(
                aws_access_key_id=config('AWS_ACCESS_KEY_ID'),
                aws_secret_access_key=config('AWS_SECRET_ACCESS_KEY'),
                region_name=config('AWS_REGION'),
            )
            if endpoint:
                client_kwargs['endpoint_url'] = endpoint
            self.s3_client = boto3.client('s3', **client_kwargs)
            self.bucket_name = config('S3_BUCKET_NAME')
            self.endpoint_url = endpoint
            # SSE-KMS is AWS-only; S3-compatible stores like Spaces reject it.
            self._use_kms = endpoint is None
        except Exception as e:
            logger.error(f"S3Storage initialization error: {e}")
            self.s3_client = None
            self.endpoint_url = None
            self._use_kms = False

    def _public_url(self, key: str) -> str:
        """Virtual-hosted public URL — works for AWS S3 and DO Spaces."""
        if getattr(self, 'endpoint_url', None):
            host = self.endpoint_url.split('://', 1)[-1].rstrip('/')
            return f"https://{self.bucket_name}.{host}/{key}"
        return f"https://{self.bucket_name}.s3.amazonaws.com/{key}"

    async def upload_file(self, file: UploadFile, folder: str = "uploads") -> Optional[str]:
        if not self.s3_client:
            logger.error("S3 client not initialized")
            return None
        try:
            file_extension = os.path.splitext(file.filename)[1]
            unique_filename = f"{folder}/{uuid.uuid4()}{file_extension}"
            
            self.s3_client.upload_fileobj(
                file.file,
                self.bucket_name,
                unique_filename,
                ExtraArgs={'ContentType': file.content_type}
            )

            return self._public_url(unique_filename)
        except Exception as e:
            logger.error(f"S3Storage upload error: {e}")
            return None

    def upload_bytes(self, data, *, filename, content_type="application/octet-stream", folder="uploads"):
        if not self.s3_client:
            logger.error("S3 client not initialized")
            return None
        try:
            import io
            key = f"{folder}/{filename}"
            extra_args = {"ContentType": content_type}
            if self._use_kms:
                extra_args["ServerSideEncryption"] = "aws:kms"
            self.s3_client.upload_fileobj(
                io.BytesIO(data),
                self.bucket_name,
                key,
                ExtraArgs=extra_args,
            )
            return self._public_url(key)
        except Exception as e:
            logger.error(f"S3Storage upload_bytes error: {e}")
            return None

    def get_file_url(self, file_path: str) -> str:
        return file_path

    def delete_file(self, file_url: Optional[str]) -> bool:
        if not file_url or not self.s3_client:
            return False
        try:
            key = file_url
            if file_url.startswith("http") and file_url.count("/") >= 3:
                key = file_url.split("/", 3)[3]
            self.s3_client.delete_object(Bucket=self.bucket_name, Key=key)
            return True
        except Exception as e:
            logger.error(f"S3Storage delete error for {file_url}: {e}")
            return False

class GCSStorage(BaseStorage):
    def __init__(self):
        try:
            from google.cloud import storage
            from decouple import config
            credentials_path = config('GOOGLE_APPLICATION_CREDENTIALS', default=None)
            if credentials_path:
                self.client = storage.Client.from_service_account_json(credentials_path)
            else:
                self.client = storage.Client()
            self.bucket_name = config('GCS_BUCKET_NAME')
        except Exception as e:
            logger.error(f"GCSStorage initialization error: {e}")
            self.client = None

    async def upload_file(self, file: UploadFile, folder: str = "uploads") -> Optional[str]:
        if not self.client:
            logger.error("GCS client not initialized")
            return None
        try:
            bucket = self.client.bucket(self.bucket_name)
            file_extension = os.path.splitext(file.filename)[1]
            unique_filename = f"{folder}/{uuid.uuid4()}{file_extension}"
            blob = bucket.blob(unique_filename)
            
            blob.upload_from_file(file.file, content_type=file.content_type)
            
            return blob.public_url
        except Exception as e:
            logger.error(f"GCSStorage upload error: {e}")
            return None

    def get_file_url(self, file_path: str) -> str:
        return file_path

    def delete_file(self, file_url: Optional[str]) -> bool:
        if not file_url or not self.client:
            return False
        try:
            blob_name = file_url
            marker = f"{self.bucket_name}/"
            if marker in file_url:
                blob_name = file_url.split(marker, 1)[-1]
            self.client.bucket(self.bucket_name).blob(blob_name).delete()
            return True
        except Exception as e:
            logger.error(f"GCSStorage delete error for {file_url}: {e}")
            return False

def get_storage_service() -> BaseStorage:
    from decouple import config
    storage_type = config('STORAGE_TYPE', default='local').lower()

    if storage_type == 's3':
        return S3Storage()
    elif storage_type == 'gcs':
        return GCSStorage()
    else:
        # Default to local storage at <backend>/uploads. Previous version
        # had an extra os.path.dirname() that bumped the base up to /uploads
        # (filesystem root) inside the docker container, which broke both
        # the named volume mount at /app/uploads AND the PDF stream route's
        # path resolver. backend_dir = /app inside the container, so the
        # corrected path is /app/uploads.
        backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        return LocalStorage(base_path=os.path.join(backend_dir, "uploads"))
