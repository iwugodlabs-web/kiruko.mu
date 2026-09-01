# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Full-stack monorepo for an employee/payroll management platform with three apps:
- **`mobile/`** — React Native (Expo) mobile app
- **`web/ivor-web/`** — Next.js 15 web app
- **`backend/`** — FastAPI (Python) REST API

---

## Commands

### Mobile (`mobile/`)
```bash
npm start              # Start Expo dev server
npm run ios            # Run on iOS simulator
npm run android        # Run on Android emulator
npm test               # Run Jest tests (watch mode)
npm run lint           # Lint with Expo lint
npx expo test path/to/file.test.ts   # Run a single test file
```

### Web (`web/ivor-web/`)
```bash
npm run dev            # Start Next.js dev server (port 3000)
npm run build          # Production build
npm run lint           # ESLint
```

### Backend (`backend/`)
```bash
source .venv/bin/activate
uvicorn main:app --reload                        # Dev server (port 8000)
uvicorn main:app --host 0.0.0.0 --port 8000 --reload  # Network-accessible

# Database migrations — must run from backend/ (script_location is relative)
cd backend && alembic -c alembic.ini upgrade head
# Combined migrate + seed:
python backend/scripts/migrate_and_seed.py
```

### Full Stack (Docker)
```bash
docker-compose up      # Starts backend (8000), web (3000), db (5432)
```

---

## Architecture

### Backend (`backend/`)

FastAPI app organized by domain:

- **`api/v1/`** — Route handlers grouped by domain (user, job, company, department, dashboard, leave, salary, scan_receipt, etc.)
- **`db_models/crud/`** — Database operations per domain (company.py, job.py, user.py, dashboard.py, etc.)
- **`core/model.py`** — All SQLAlchemy models (User, PrivateUser, Company, Department, Job, Salary, TimeLog, BreakLog, Leave, Loan, Notification, AuditLog, etc.)
- **`core/security.py`** — JWT auth utilities
- **`core/dependencies.py`** — FastAPI dependency injection (DB sessions, current user)
- **`schema/`** — Pydantic request/response schemas
- **`auth/`** — Authentication logic
- **`jobs/`** — Background jobs (Excel importer, sector seeder)
- **`main.py`** — App entry point, router registration, CORS config

Auth is JWT (HS256). CORS is configured for localhost and LAN IPs (192.168.x.x, 10.x.x.x) to support mobile dev.

### Mobile (`mobile/`)

Expo Router with file-based routing under `app/`:

- **`app/company_dashboard/`** — Screens for company/employer users
- **`app/private_dashboard/`** — Screens for individual/employee users
- **`app/login/` and `app/signup/`** — Auth flows
- **`app/context/`** — React Contexts: `AuthProvider`, `CurrencyContext`, `LanguageProvider`, `OnBoardProvider`
- **`components/`** — Reusable UI components
- **`api/`** — API service layer (axios-based calls to backend)
- **`hooks/`** — Custom React hooks
- **`db/`** — Drizzle ORM schema for local SQLite
- **`drizzle/`** — SQLite migration files

UI: GlueStack UI + NativeWind (Tailwind CSS for React Native). Forms use React Hook Form + Zod.

### Web (`web/ivor-web/`)

Next.js 15 App Router under `src/app/`:

- **`src/app/(platform)/`** — Main authenticated app routes
- **`src/app/api/`** — Next.js API routes (if any)
- **`src/app/components/`** — Shared components
- **`services/`** — Axios API client modules

UI: Tailwind CSS v4, drag-and-drop via `@hello-pangea/dnd`, toasts via `sonner`.

### Mobile API Client

The mobile app's [mobile/services/apiClient.tsx](mobile/services/apiClient.tsx) is the central axios instance — it handles auth headers and base URL config. All API calls in `mobile/api/` route through it.

---

## Key Domain Concepts

The platform manages:
- **Private Users** (employees) and **Company Users** (employers)
- **Departments** and **Jobs** within a company
- **Salary**, **Payroll**, **Loans**, and **Repayments**
- **Time Logs** and **Break Logs** (clock-in/clock-out)
- **Leave** management and approvals
- **Receipt Scanning** via Google Cloud Vision / EasyOCR
- **Notifications** via Expo push notifications

User roles: `CompanyUserRole`, `PlatformRole` (defined in backend models).

---

## Environment

- Backend env: `backend/.env` (PostgreSQL URL, JWT_SECRET, SMTP, Google Cloud creds, S3)
- Web env: `web/ivor-web/.env.local`
- Mobile env: configured in `mobile/app.json` and Expo env vars

PostgreSQL runs on port 5432 (via Docker in dev). Backend must be running for mobile/web to function.
