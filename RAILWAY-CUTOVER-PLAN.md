# Kiruko → Railway Cutover Plan

Migrating backend + web + DB from **DigitalOcean → Railway**, keeping the same
domains (`api.kiruko.mu`, `app.kiruko.mu`) behind Cloudflare. **DO stays live and
serving users through Phases 1–5; the only user-affecting moment is the Cloudflare
flip in Phase 4, which is instant and reversible.**

**Railway project:** `courteous-imagination` / production
**Services:** `kiruko.mu` (backend) · `app.kiruko.mu` (web) · `Postgres` (Amsterdam/ams)
**Data:** 18 users · 3 companies (Kiruko Demo Co 🇲🇺 · TYP 🇹🇿 · Pro-hands 🇲🇺)

---

## ✅ Phase 0 — Done
- [x] DB migrated to Railway — 18 users, 3 companies, verified by name, fresh clocking, full integrity (219 FKs / 39 RLS policies / audit triggers)
- [x] Backend `kiruko.mu` — online, env configured (JWT, POSTGRES_*, SUPER_USER, CORS, SMTP, Doc AI)
- [x] Web `app.kiruko.mu` — online, points at the Railway backend
- [x] Super-admin login works (iwugodlabs@gmail.com)

## ✅ Phase 1 — Smoke-test on Railway URLs (DO still live, no user impact)
- [x] Log into the web (`appkirukomu-production.up.railway.app`) as a real employee (e.g. **Miora**) with their existing password → profile loads, clock history empty
- [x] Spot-check 2–3 more (Nayya, Sabine) across the 3 companies + both countries (MU/TZ)
- [x] Confirm backend logs have no error spam

## ✅ Phase 2 — Security & cleanup (before going live)
- [x] Set `RESET_SUPER_USER_PASSWORD=false` (or delete) and `RUN_SEEDER=false` on `kiruko.mu` — stop deploys re-seeding
- [x] Delete stray HTTP domain `postgres-production-3dfc.up.railway.app` (Postgres → Networking → Domains)
- [x] Disable **Public Access / TCP proxy** (`reseau.proxy.rlwy.net`) on Postgres — DB now internal-only
- [ ] ~~Rotate the Postgres password~~ — **deferred (optional)**. Mitigated: Public Access is off, so the leaked password can't be used externally. Rotate later as maintenance if desired.

## ✅ Phase 3 — Add custom domains in Railway
- [x] `kiruko.mu` service → Custom Domain → **`api.kiruko.mu`** (Cloudflare CNAME connected)
- [x] `app.kiruko.mu` service → Custom Domain → **`app.kiruko.mu`** (Cloudflare CNAME connected)

## ✅ Phase 4 — The cutover (in Cloudflare — reversible)
- [x] `api` / `app` CNAMEs point to Railway (via Cloudflare); TLS live (200, MRU edge)
- [ ] Save the previous **DO targets** somewhere as rollback values (in case a revert is ever needed)

## ✅ Phase 5 — Verify live
- [x] `curl -I https://api.kiruko.mu/docs` → 200 (Cloudflare→Railway); 322 routes match Railway backend
- [x] `https://app.kiruko.mu` login confirmed — **ivortanyan (owner) + iwugodjoshua@gmail (employee)** both work → live on Railway ✅
- [x] **Mobile app** (targets `api.kiruko.mu`) → login confirmed, traffic on Railway
- [x] Everyone re-logs in once (JWT_SECRET changed) — expected
- [x] **Confirmed: all traffic on Railway, none on DO** ✅ MIGRATION COMPLETE

## ⬜ Phase 6 — Rollback (only if broken)
- [ ] Revert `api`/`app` Cloudflare records to the saved DO targets → users back on DO in seconds

## ⬜ Phase 7 — Decommission DO (days later, once stable)
- [ ] Final DO backup
- [ ] Tear down DO app + database

---

## Env cross-check (or things break silently)
- [ ] `JWT_SECRET` identical on `kiruko.mu` (backend) and `app.kiruko.mu` (web)
- [ ] Web `NEXT_PUBLIC_API_URL=https://api.kiruko.mu/api/v1` (build-scoped — redeploy web after changing)
- [ ] Backend `CORS_ORIGINS` includes `https://app.kiruko.mu`

## Open items (not blockers)
- [ ] `STORAGE_TYPE=local` is ephemeral on Railway — switch to S3/GCS before any file uploads (`document_vault` empty now)
- [ ] Enable `kiruko_app` / RLS for MU–TZ tenant isolation — a deliberate **later** step; do NOT bundle with the cutover
- [ ] Confirm what rolled the DO DB back on 2026-08-30 (457 test → real users) so nothing overwrites data mid-transition

## Reference (verified facts)
- Mobile targets the **domain** `api.kiruko.mu` (in `eas.json`) → repointing DNS is enough, **no EAS rebuild**
- `time_logs.private_user_id` → `private_users.private_user_id` (NOT `users.user_id`) — see MEMORY
- Backups of the DO/prod DB must be taken as `doadmin` (app role blocked by FORCE RLS)
- Pristine DO backup on Mac: `~/Downloads/ivor_REAL_2026-08-30_2131.dump` (57 users, rollback source)
