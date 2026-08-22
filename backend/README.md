brew upgrade

deactivate

rm -rf .venv  #remove already installed env
 
python3 -m venv .venv #install virtual env

source .venv/bin/activate    

pip3 install -r requirements.txt

uvicorn main:app --reload #run server

uvicorn main:app --host 0.0.0.0 --port 8000 --reload

---

## Migrations (Alembic)

To run migrations from the repository root, you can use the provided helper scripts in `backend/scripts`.

- Shell wrapper (preferred):

```bash
./backend/scripts/upgrade_alembic.sh
```

- Python helper (uses `alembic` Python API):

```bash
python backend/scripts/run_alembic.py
```

```bash
alembic -c backend/alembic.ini upgrade head
```

---

## Receipt OCR (Google Cloud Vision)

The backend supports high-accuracy receipt scanning using Google Cloud Vision.

- For setup instructions, see: [GOOGLE_OCR_SETUP.md](GOOGLE_OCR_SETUP.md)
- To verify your Google credentials, run: `python test_vision.py`

If not configured, the app will automatically fall back to EasyOCR.
