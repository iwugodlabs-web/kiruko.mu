# Railway Deployment — kiruko.mu

Complete, ordered process to deploy this monorepo (backend + web + Postgres) on
Railway. Every service builds from its own Dockerfile. Only the database is a
managed service. **Railway does not use `docker-compose.yml`** — it deploys one
container per service and does the networking itself.

## Architecture

```
Railway project (production)
├── Postgres   ← managed database (create FIRST)
├── backend    ← FastAPI, root dir = backend/
└── web        ← Next.js, repo-root context, config = web/ivor-web/railway.json
```

---

## Phase 1 — Create the Postgres database (do this first)

1. Project canvas → **New** → **Database** → **Add PostgreSQL**.
2. Wait until it's provisioned (green).
3. Note its exact service name — usually **`Postgres`**. If different, adjust the
   `${{Postgres.*}}` references below (or use the **Add Reference** button, which
   lists the real name).

Why first: the backend reads its DB connection from this service's variables. No
DB = the references resolve to nothing = crash.

---

## Phase 2 — Configure the backend service

### 2a. Point it at the backend folder (fixes the Railpack build failure)

- Backend service → **Settings** → **Source** → **Root Directory** = `backend`
- This makes Railway find `backend/railway.json` → use the Dockerfile, not
  Railpack. (Symptom of the wrong setting: build logs show
  `[railway] prepare railpack-...` listing repo-root files, then
  "Failed to build an image".)
- Optional: rename the service to `backend`.

### 2b. Set variables (Variables tab → Raw Editor)

```
POSTGRES_USER=${{Postgres.PGUSER}}
POSTGRES_PASSWORD=${{Postgres.PGPASSWORD}}
POSTGRES_SERVER=${{Postgres.RAILWAY_PRIVATE_DOMAIN}}
POSTGRES_PORT=5432
POSTGRES_DB=${{Postgres.PGDATABASE}}
POSTGRES_SSLMODE=disable
JWT_SECRET=replace_with_64_char_hex   # python3 -c "import secrets; print(secrets.token_hex(32))"
JWT_ALGORITHM=HS256
SUPER_ADMIN_EMAILS=iwugodlabs@gmail.com
SUPER_USER_EMAIL=iwugodlabs@gmail.com
SUPER_USER_PASSWORD=CHANGE_ME_strong_password
CORS_ORIGINS=https://your-web.up.railway.app,http://localhost:3000
FRONTEND_URL=https://your-web.up.railway.app
APP_NAME=Kiruko
TIME_ZONE_LOCAL=Indian/Mauritius
STORAGE_TYPE=local
```

Critical notes:

- ⚠️ **Do NOT set `ENVIRONMENT=production`.** `backend/core/settings.py` sends
  `production` down the Google Cloud SQL path, which requires
  `CLOUD_SQL_CONNECTION_NAME` (no default) and crashes on Railway. Leaving it
  unset (defaults to `development`) uses the plain `POSTGRES_*` vars — correct
  for Railway.
- `${{Postgres.*}}` are Railway variable references. Replace `Postgres` if the DB
  service has another name.
- `RAILWAY_PRIVATE_DOMAIN` + `POSTGRES_SSLMODE=disable` uses Railway's internal
  network (free, no SSL). If you use the public host instead, set sslmode to
  `require`.
- Save the `JWT_SECRET` — the **web service must use the identical value**.
- ⚠️ `STORAGE_TYPE=local` is **ephemeral** — uploaded files vanish on redeploy.
  Fine to launch; switch to `s3`/`gcs` before real production.

### 2c. Add SMTP later (only when you need invite/payslip emails)

`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_EMAIL`.

### 2d. Deploy

On boot, `backend/startup.sh` (1) verifies the app imports, then (2) runs
`migrate.sh` → Alembic migrations + seed data. Fail-loud: if migration fails the
container exits and the previous deploy keeps serving.

### 2e. Expose it

Settings → **Networking** → **Generate Domain**. Copy the URL (e.g.
`https://backend-xxxx.up.railway.app`) for the web service.

---

## Phase 3 — Add the web service

1. Project canvas → **New** → **GitHub Repo** → select the same repo again.
2. New service → **Settings**:
   - **Root Directory** = *(leave empty / repo root)* — the web Dockerfile copies
     both `web/ivor-web/` **and** `shared/`, so it needs repo-root context.
   - **Build** → **Config-as-code path** = `web/ivor-web/railway.json`
3. **Variables** → Raw Editor (swap in the real backend URL from 2e):

```
NEXT_PUBLIC_API_URL=https://YOUR-BACKEND.up.railway.app/api/v1
NEXT_PUBLIC_API_BASE_URL=https://YOUR-BACKEND.up.railway.app
BACKEND_URL=https://YOUR-BACKEND.up.railway.app
JWT_SECRET=must_match_backend_jwt_secret
```

⚠️ The two `NEXT_PUBLIC_*` vars must have **Build scope** — Next.js bakes them
into the bundle at build time, or they'll be `undefined` in the browser.
`JWT_SECRET` must **exactly match** the backend's.

4. **Deploy**, then Settings → Networking → **Generate Domain** for the public web
   URL.

---

## Phase 4 — Wire the two together

1. Put the **web** domain into the backend's `CORS_ORIGINS` and `FRONTEND_URL`
   (replace the `your-web...` placeholders), then redeploy the backend.
2. Open the web URL, try logging in, confirm requests reach the backend
   (devtools → Network).

---

## Verification checklist

- [ ] Postgres service is green
- [ ] Backend build uses **Dockerfile** (no `railpack` in logs)
- [ ] Backend logs show `✅ Main app imported — N routes` then migrations run
- [ ] Backend `/health` responds on its domain
- [ ] Web build succeeds; site loads
- [ ] Login works end-to-end (same `JWT_SECRET` both sides)

---

## Before real production

- **File storage**: move `STORAGE_TYPE` off `local` to `s3`/`gcs` (+ the AWS/GCS
  vars) — local is wiped on redeploy.
- **Scaling**: migrations run on boot, safe at **1 replica** only. If you scale
  up, move `migrate.sh` to a pre-deploy job so instances don't race (noted in
  `startup.sh`).

---

## Alternative: everything in Docker on one host

If you want the single-host `docker-compose up` experience (backend + web +
Postgres-in-a-container all together), that's a VPS (DigitalOcean, Hetzner, EC2),
**not** Railway — your existing `docker-compose.yml` works as-is there. Trade-off:
full control and your compose file "just works," but you own the OS, TLS, backups,
uptime, and patching. Railway trades that model for near-zero ops + a managed DB.
