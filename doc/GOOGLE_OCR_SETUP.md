# Google Cloud Vision OCR Setup Guide

This project supports **Google Cloud Vision API** for high-accuracy receipt scanning. If Google Vision is not configured, it will automatically fall back to **EasyOCR**.

## Quick Setup

1. **Get Credentials**: 
   - Create a Google Cloud project.
   - Enable the **Cloud Vision API**.
   - Create a **Service Account** with the role `Cloud Vision API User`.
   - Create and download a **JSON key** for this service account.

2. **Install Key**:
   - Place the JSON file in the `backend` directory (e.g., `backend/google-credentials.json`).

3. **Configure Environment**:
   - Add the absolute path to your key in the `backend/.env` file:
     ```env
     GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/your/backend/google-credentials.json
     ```

4. **Git Ignore**:
   - Ensure your JSON key is added to `.gitignore` to prevent leaking credentials.

## Features
- **High Accuracy**: Much better at reading small text and table-formatted receipts than EasyOCR.
- **Speed**: Generally faster processing (2-3 seconds vs 5-7 seconds).
- **Graceful Fallback**: If the API fails or credentials are missing, the system uses EasyOCR automatically.

## Testing
You can verify your setup by running:
```bash
python test_vision.py
```
This script checks if the credentials are valid and if the API can be reached.

## Costs
- First **1000 scans per month** are free.
- Subsequent scans are very low cost (approx. $0.0015 per scan).
