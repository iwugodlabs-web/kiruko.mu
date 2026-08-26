---
name: railway-deploy-topology
description: How kiruko.mu deploys on Railway — 3 services, per-service config, and two gotchas
metadata:
  type: project
---

Railway deploys 3 services from this monorepo (Railway ignores docker-compose.yml; one container per service): **Postgres** (managed), **backend** (root dir = `backend/`, auto-reads `backend/railway.json` → Dockerfile), **web** (root dir = repo root because it imports `shared/` which stays at repo root; needs a **repo-root `railway.json`** with `dockerfilePath: web/ivor-web/Dockerfile` so Railway uses the Dockerfile instead of Railpack).

Railway only auto-reads a `railway.json` at a service's **root directory** — that's why backend works and web needed a root-level config. Backend DB config lives only in the backend service's Variables as `${{Postgres.*}}` references; never edit the Postgres service's own vars.

**Gotchas:**
- Do NOT set `ENVIRONMENT=production` on the backend — `core/settings.py` then takes the Google Cloud SQL path and crashes (`CLOUD_SQL_CONNECTION_NAME` has no default). Leave unset (defaults to development) to use `POSTGRES_*` vars.
- `NEXT_PUBLIC_*` web vars need **Build scope** (Next.js bakes them at build time via Dockerfile ARG).
- `JWT_SECRET` must match backend and web. `STORAGE_TYPE=local` is ephemeral on Railway.

Full guide committed at `doc/RAILWAY-DEPLOY.md`. Backend live at `kirukomu-production.up.railway.app`. Cannot push to the repo from this git identity (`iwugod` → 403); the user pushes. See [[no-cosmetic-refactors]].
