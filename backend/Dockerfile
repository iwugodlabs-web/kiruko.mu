FROM python:3.10-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install runtime dependencies for PostgreSQL, OCR, and WeasyPrint (M21).
# WeasyPrint needs Pango + Cairo on the host. Pango's apt package pulls
# in cairo and harfbuzz transitively, so we only declare the two pango
# packages explicitly — keeps the install resilient across Debian
# versions where transitive package names get renamed.
# fonts-dejavu-core gives broad Latin/diacritics coverage in ~6MB.
RUN apt-get update && apt-get install -y --fix-missing \
    postgresql-client \
    tesseract-ocr \
    libtesseract-dev \
    libgl1 \
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
    shared-mime-info \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# Install CPU-only PyTorch first (avoids downloading the huge CUDA build ~900MB)
# Pin numpy<2 because torch 2.1.0 was compiled against numpy 1.x
#
# Use --extra-index-url (NOT --index-url): --index-url REPLACES PyPI with the
# PyTorch index, so pip can no longer fetch normal build dependencies like
# flit_core (build backend for torch's transitive deps) and the build fails
# with "No matching distribution found for flit_core". --extra-index-url keeps
# PyPI as the primary index and adds PyTorch as a secondary one. This stays
# CPU-only because the CPU wheels are versioned "2.1.0+cpu", which sorts higher
# than plain "2.1.0" on PyPI, so pip still prefers the +cpu build.
RUN pip install --no-cache-dir "numpy<2" && \
    pip install --no-cache-dir \
    torch==2.1.0 torchvision==0.16.0 \
    --extra-index-url https://download.pytorch.org/whl/cpu

# Copy requirements and install all dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Fail the build if WeasyPrint can't load — better to break here than to
# discover at first finalize that libpango is missing on the host.
RUN python -c "from weasyprint import HTML; HTML(string='<p>ok</p>').write_pdf()" \
    && echo "WeasyPrint smoke OK"

# Copy the main application files to test imports
COPY . .

# Set Python path
ENV PYTHONPATH=/app

# Copy startup script
COPY startup.sh .
RUN chmod +x startup.sh

EXPOSE 8080

CMD ["bash", "startup.sh"]