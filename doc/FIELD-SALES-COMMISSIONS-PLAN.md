<!-- Text copy of the design spec artifact: https://claude.ai/code/artifact/6ece0be6-9726-4e8b-b672-ab0308aae597 -->

# Sell in the field. Pay on the payslip.

**Module Design · Field Sales & Commissions · v1**

A new selling surface bolted onto a payroll engine you've **already built**. Reps log what they sell at each outlet; the platform turns it into commission under rules you define, and pays it on the next payslip — no second system, no CSV export, no manual upload. This is the complete blueprint, with every piece marked as something you reuse or something new.

- **20** field-sales tables built, across 7 migrations (phase 0 → 3.2 + payment-method), single head
- Built on the existing **payroll spine** — payout, PAYE/CSG, and finalize are reused
- **1** write bridges sales → payroll (the one-off allowance)
- Backend + web admin + mobile capture **built & committed** · 28 backend tests green

> **Current state (2026-10-18):** Phases **0–3.2 backend are built**, and the **mobile field-capture client** and **web admin UI** are now built and **committed** on `feat/field-sales-phase0` (commits `7d4c64b`, `2c88f95`; only `mobile/app.json` and `web/ivor-web/tsconfig.json` remain uncommitted). Migrations `field_sales_phase0/1/2/3/3_1/3_2_20261017.py` + `sale_payment_method_20261018.py` (single head; the test suite applies them cleanly). Code: `schema/field_sales_schema.py`, `db_models/crud/field_sales.py`, `services/commission_service.py` (engine + rules + the one-off bridge), `services/commission_statement_pdf.py` + template, `api/v1/commissions.py` (registered), and tests `test_field_sales_phase0.py` (6) + `test_field_sales_phase2.py` (22) covering: sale → payable → one-off → taxed payslip line; outlets + geo-verified offline sync; all 5 rule types + `team_override`; on-collection; UoM volumetrics; attribute scope; targets + accelerator bands + mid-period pro-rating; catalogs; leaderboards; liability accrual; credit-assignment splits; clawbacks; **returns/credit-notes** driving negative commission; ERP reconcile **with idempotent commit**. The sync/capture routes now also enforce rep self-scoping (a rank-and-file member may only sync sales credited to themselves). **Web admin UI** (`web/ivor-web/src/app/(platform)/dashboard/field-sales/` — Overview/leaderboard/liability, Catalog, Plans + assignments, Sales approval queue + outlets, Runs with approve/push + statement PDF; Sidebar entry): the HTTP API it needs is in place. **Mobile field capture** (`mobile/app/private_dashboard/field_sales.tsx` + `field_sale_new.tsx`; `mobile/api/fieldSales.ts`; offline queue `sales_queue` / `services/offline/salesQueue.ts` + `salesSync.ts` — geofence check-in, catalog picker, barcode scan via expo-camera, offline-first submit; reachable from Settings). Everything below marked _reuse_ has been checked against the codebase; claims that failed that audit are reclassified as _new_.

**Legend:** 🟢 **Reuse** — already in your codebase · 🟠 **New** — to build · 🔵 **Goal** — the outcome it serves. _(Mauritius FMCG · currency MUR)_

---

## Four decisions that shape everything

You said go wild, so these are made, not asked. Each is the pragmatic call for a payroll platform — and each is a dial you can turn later without a rewrite.

- **Scope — Incentive tracking, not an ERP.** A sale record exists to **compute commission** — not to be the authoritative invoice or to run live inventory. That keeps the module light and out of SAP's lane. Real billing can reconcile in from an ERP later.
- **Capture — Rep self-serve, offline-first.** Field reps log their own sales on mobile, working offline and syncing later — on the SQLite store and idempotency keys you already run. Admin bulk-entry is the Phase 0 stand-in while that lands.
- **Rules — Parametric rules, never a DSL.** Commission is a small set of composable, typed rules stored as rows — not a scripting language. Covers ~90% of real plans, stays auditable, and never becomes a support tar pit.
- **Integration — One bridge into payroll.** Commission reaches pay through exactly one write: an `EmployeeOneOffAllowance`. From there your finalize gate, payslip engine, and clawback machinery own it untouched.

---

## Layer 1 · The catalog — a standard product: concept, variants, units

What you *sell* is never the product; it's a **variant** — a specific size × flavour × pack with its own SKU, barcode, and price. Distribution adds a second axis: the **unit of measure**, because the same variant sells as a single, a 6-pack, or a case.

```
Product (concept)   Coca-Cola          brand · category · description
  ├─ Options            Size │ Flavour │ Pack   ← the axes of variation
  │    Size    330ml · 500ml · 1.5L
  │    Flavour Classic · Zero · Cherry
  │    Pack    Single · 6-pack · Case-24
  │
  └─ Variants  (the real SKU — a Sale line points HERE)
       Coke Zero 500ml · Single    sku=CC-Z-500-1    barcode  price
       Coke Zero 500ml · Case-24   sku=CC-Z-500-24   barcode  price
       Coke Classic 1.5L · Single  sku=CC-C-15L-1    barcode  price

Units of measure  base = bottle · 1 Case = 24 bottles · 1 Carton = 4 Cases
                 everything normalises to base units for targets & reporting
```

- **Default variant trick.** A product with no real variation gets one implicit variant. Simple SKUs carry no option machinery — so **Phase 0 ignores variants entirely** and the layer switches on later with no schema rewrite.
- **Price lives on the variant.** Versioned `ProductPrice` rows, optionally per territory. A sale **snapshots** the price onto its line — a later price change never rewrites a past sale or payout.
- **Scanning** _(OCR plumbing exists; barcode is new)_. The OCR pipeline behind `scan_receipt` (Google Vision / EasyOCR / Tesseract) exists and drives a camera — but today it reads receipt totals and merchant, **not barcodes**. Barcode / GS1 / EAN scanning is new work (no barcode support exists anywhere yet); it can borrow the camera + OCR plumbing.

---

## Layer 1 · Getting products in — how every company loads its catalog

Nobody hand-types 2,000 SKUs. You offer a ladder — manual up to full ERP sync — and every bulk path funnels through **one pipeline**: your existing employee-import machinery, generalised to products.

```
THE SHARED PIPELINE  ·  idempotent · upsert on (company_id, sku | barcode) · prices versioned, never overwritten

  Stage → Validate → Match & de-dupe → Preview diff → Commit → Audit

  commit-valid-rows + downloadable error report — not all-or-nothing
```

| Path | For whom | How it works | Reuses |
|---|---|---|---|
| **Type it in** | long-tail · tiny catalogs | web form: product + variants + price | — |
| **Spreadsheet import** | most companies | template → upload CSV/XLSX → map columns → dry-run preview → commit | `employee_import_service` · `excel_job_importer` (import-pipeline pattern) |
| **Starter catalog** | new signups | pick your sector → fork a pre-seeded tree | new product-catalog seeder — the existing `seed_sectors_from_excel` seeds salary-rate reference data (sectors, grades, category salaries), not products; only the seeding approach carries over |
| **Shared brand catalog** | distributors of known brands | Coke's SKUs are identical for everyone who carries them → fork a global master once | new · shared catalog |
| **Barcode scan** | field · warehouse | scan barcode → variant lookup → attach or create | new — no barcode / GS1 support today; can borrow the `scan_receipt` camera plumbing |
| **Supplier-doc OCR** | from supplier docs | photograph a supplier doc → OCR assists data entry → review → commit | new extraction — today's `scan_receipt` reads receipt totals/merchant, not line-item price-list rows |
| **ERP / API sync** | enterprise | scheduled REST pull or webhook push from SAP / Odoo / QuickBooks, reconciled | new · Phase 3 |

**Everything is tenant-scoped.** Every product, variant, and price is `company_id`-scoped like the rest of your platform. The *only* platform-global things are the rule-type library and the optional shared brand catalog — a company **forks** from those into its own tenant.

---

## The data model — three new layers on an existing spine

The green zone is **already built and untouched**. The amber zones are the whole of the new work. Look at the ratio — that's the thesis of this design in one picture.

**Catalog** _(new)_
- `ProductCategory` — parent_id → self · tree _(Phase 2; Phase 0 keeps `Product.category` a plain string)_
- `Product` — category_id · brand · status
- `ProductOption` — option axes (Size · Flavour · Pack); _no separate `OptionValue` table_
- `ProductVariant` — sku · barcode · sell_uom · status
- `ProductVariantOptionValue` — variant ↔ option values
- `UnitOfMeasure` — base unit + pack conversions
- `ProductPrice` — per variant · versioned · territory _(Phase 2; Phase 0 price is inline on `ProductVariant.unit_price` — a single price, no versioning or territory)_

**Sales capture** _(new)_
- `Sale` — rep · credited_to · outlet · geo · status · payment_status · client_uuid
- `SaleLine` — variant · qty · uom · unit_price_snapshot
- `Collection` — `collected_amount` / `collected_at` columns on `Sale` + `payment_method` (`sale_payment_method_20261018`); the on-collection trigger is **built**
- `SalesReturn` / `SalesReturnLine` — returns / credit-notes linked to a Sale, driving negative commission **(built)**
- `Outlet` — geo+geofence · credit terms · assigned rep · visit cadence **(built; Phase 1)**

**Commission** _(new)_
- `CommissionPlan` — per company · trigger: on-sale | on-collection
- `CreditAssignment` — territory / house-account → rep _(Phase 3)_
- `CommissionRule` — type · params · scope(cat/prod/variant/attr)
- `CommissionPlanAssignment` — plan → rep (and later role / dept)
- `SalesTarget` — rep · period · category
- `CommissionRun` — company · period · draft→approved
- `CommissionLineItem` — rep · rule · amount · why-trace
- `CommissionPayable` ★ — per rep, per run · the ledger seam · `payout_channel` (payroll | manual) · `one_off_allowance_id` links to the bridge

**Existing payroll spine — reused, not modified** _(reuse)_
- `SalaryComponent` — +1 row: earning.commission
- `EmployeeOneOffAllowance` ★ — the single bridge · already lifecycle-complete
- `PayrollRun` — draft → finalize · completeness gate _(opt-in: default off unless a company override or `PAYROLL_COMPLETENESS_GATE` is set to warn/enforce)_
- `Payslip` — component line · is_adjustment / parent
- `CompanyGeofence` — geofence primitive **exists** (today wired to time-log clock-ins only); the outlet-visit check is **new** integration over it, and there is no outlet/visit entity yet
- `AuditLog · RBAC · Idempotency` — approvals · perms · offline sync

_Build state (verified 2026-10-18):_ all **20** field-sales models exist, are committed, and are exercised by **28 green tests** — including `ProductCategory`, `ProductOption`, `ProductVariantOptionValue`, `UnitOfMeasure`, `ProductPrice`, `Outlet`, `SalesReturn`/`SalesReturnLine`, `CreditAssignment`, and `SalesTarget`. The paid-module gate is the generic `company_modules` entitlement (`core/modules.py`). **Not built:** manager/team view-scoping (only rep self-scoping exists), maker-checker on plan/price changes, and the off-payroll **manual** payout-channel settlement (off-payroll reps are *detected and skipped*, not silently mispaid — see the completeness check).

### Key foreign keys — how the new tables wire into yours

| From | References | Meaning |
|---|---|---|
| `SaleLine` | `ProductVariant` · `UnitOfMeasure` | what was sold, in which unit, at a snapshotted price |
| `Sale` | `PrivateUser` · `Outlet` (Phase 1) | which rep, at which outlet — the outlet-visit geofence check is new work over the existing geofence primitive (wired to time-logs today) |
| `CommissionRule` | `ProductCategory` / `Product` / `ProductVariant` | nullable scope — rule applies at any catalog level |
| `CommissionPlanAssignment` | `CommissionPlan` · `PrivateUser` | conceptually mirrors `EmployeeSalaryAssignment`, but that model also carries currency, structure_snapshot, notes, created_by_user_id, and effective-dating (per-component overrides live in a separate `EmployeeSalaryOverride` table) — this would need those to match |
| `CommissionLineItem` | `CommissionRun` · `CommissionRule` | one computed amount + its why-trace |
| **`CommissionPayable` ★** | **`EmployeeOneOffAllowance`** | **THE BRIDGE** — the only FK that crosses into payroll (`one_off_allowance_id`, payroll channel) |
| `EmployeeOneOffAllowance` | `SalaryComponent` · `Payslip` | existing — picked up on draft, stamped on finalize |

---

## Layer 3 · The commission rules engine

Five typed rules cover almost every real plan. Each is a row with parameters and a scope; the engine evaluates them deterministically at period close and emits a human-readable trace for every cent.

- **Flat percentage** (% of value) — a straight cut of revenue, scoped to any catalog level. _e.g. 3% of all Beverages sold._
- **Per-unit bonus** (per unit) — a fixed amount for every base unit moved. _e.g. ₨20 × each Premium Water bottle._
- **Tiered by volume** (volume bands) — rate steps up as volume crosses thresholds. _e.g. 0–100u → 3% · 101u+ → 5%._
- **Target attainment** (quota) — accelerator kicks in at a share of quota. Needs a SalesTarget. _e.g. hit 100% of quota → +2% on all._
- **SPIFF (promo push)** (time-boxed) — a temporary bonus on a product or attribute, with an end date. _e.g. anything Flavour=Zero, until Dec 31._
- **Every run is explainable** (deterministic) — re-runnable, snapshotted, and each line carries its own reasoning:
  `Rahul: 3% of ₨84,200 Bev = ₨2,526 + Juice tier-1 = ₨1,100 + Water SPIFF 140u×₨20 = ₨2,800 = ₨6,426`

The payoff of the variant model shows here: a rule can scope at **category** ("all Beverages"), **product** ("all Coca-Cola"), **variant** ("Coke Zero 500ml"), or **attribute** ("anything Zero, across every size") — the last is how you push a whole line without listing SKUs.

---

## Layer 3 · Self-service, multi-tenant — every company writes its own rules, no code

The crucial split: rule *types* are a fixed platform capability; every *parameter* is the company's. We ship the engine; they author the percentages, thresholds, product scopes, and dates in a no-code builder stored as JSONB — so you never write per-company code.

1. **Pick** — choose a rule type from the fixed library: flat %, per-unit, tiered, target, SPIFF.
2. **Fill** — set your numbers & scope: percentages, thresholds, dates — and point it at **your own** catalog via the scope picker (category / product / variant / attribute).
3. **Preview** — test on real history: "This rule would have paid ₨X last month." Save when it looks right.

### A plan stacks rules with a combination policy

This policy layer is what lets five rule types cover every business:

- **Earn on sale, or on collection** (trigger) — a per-plan switch: pay when the order is logged, or only when the customer actually **pays** — pro-rata to the amount collected. The anti-bad-debt lever distribution runs on.
- **Stacking vs exclusive** (compose) — sum every matching rule, or let the highest / priority rule win.
- **Caps & floors** (bound) — max payout per period; a guaranteed minimum or a **draw** — an advance recovered from future commission, on your `Loan`/`Repayment` rails.
- **Splits** (credit) — one sale credited across several reps by percentage.
- **Effective-dating** (version) — rules are versioned and snapshotted — a mid-period edit never rewrites a closed period.

### Coverage proof — same engine, any business

| Business | Their pay, expressed in the engine |
|---|---|
| **FMCG distributor rep** | flat % per category + per-unit SPIFF |
| **Pharmaceutical rep** | per-box bonus + quota accelerator |
| **Real-estate agent** | tiered % of deal value |
| **Car salesperson** | fixed/unit + volume tier + aging-stock SPIFF |
| **B2B / SaaS field sales** | % of contract value, capped, quota-gated |
| **Direct sales / MLM** | personal % + team override (split) |

**Why there's never per-company code:** the types **compose**, the params are **tenant-owned**, and the scope picker reads **their** catalog. New company, new industry, same engine. The **pattern** behind your `rule_consistency_check` job can be cloned to flag contradictory or overlapping commission rules before a run — but the job itself only validates country payroll rule tables (tax brackets, statutory deductions, leave/bonus defaults) and does not cover commission.

---

## The lifecycle · A → L — one month, one rep, point A to Z

Island Distributors Ltd. Rahul services ~30 shops. Follow a Coke case from his boot to his payslip — and watch how little of the path is new.

- **A. Build the catalog** _(admin · web · once)_ — Category tree, products, variants, prices. Can ship pre-seeded per sector. _new: catalog tables + a product-catalog seeder (the existing sector seeder loads salary-rate data, not products) · reuse: archive pattern · goal: one source of truth for what sells._
- **B. Define the commission component** _(admin · once)_ — A single row: `earning.commission`, taxable. Your PAYE/CSG engine now knows how to tax it. _reuse: SalaryComponent · goal: commission is first-class, taxed pay._
- **C. Author & assign Rahul's plan** _(admin)_ — "Field Rep – Beverages Q4": 3% on Beverages, tiered Juices, ₨20/unit SPIFF on Premium Water. _new: CommissionPlan · Rule · CommissionPlanAssignment (the pattern echoes salary-structure assignment, but is not a 1:1 reuse — see the FK note) · goal: encode how selling becomes money._
- **D. 9:04am — walks into Shop #12** _(rep · mobile)_ — App checks GPS against the outlet geofence. Green tick. Proof he was there. _new: outlet-visit check — the geofence primitive exists but is wired to clock-in/time-logs today, and there is no outlet/visit entity yet · goal: anti-fraud, presence verified._
- **E. Logs the sale** _(rep · mobile · offline)_ — 24× Coke, 12× Orange Nectar, 6× Premium Water. Prices auto-fill and snapshot. Dead zone — saves to local SQLite, syncs later; `client_uuid` stops a double-submit. _new: Sale · SaleLine + sync · reuse: Drizzle SQLite, idempotency keys._
- **F. Supervisor reviews** _(manager · web)_ — Approves clean visits; rejects one mismatch with a reason. Only approved sales earn money. _new: approval queue · reuse: AuditLog, RBAC guards._
- **G. Month-end — compute commissions** _(admin · web)_ — A CommissionRun pulls approved sales, evaluates each rep's plan, produces line items with a full why-trace. A draft — recompute, review, adjust. _new: rules evaluator, CommissionRun · reuse: draft→finalize model._
- **H. Approve → push to payroll** _(the single bridge)_ — Rahul's ₨6,426 becomes **one** `EmployeeOneOffAllowance` for October. That is the entire integration. _reuse: EmployeeOneOffAllowance · goal: hand money to the rail you own._
- **I. Run October payroll** _(admin · existing engine)_ — Draft picks the one-off up; payslip shows a taxed **Commission ₨6,426** line. Finalize stamps it, freezes the ledger, counts Rahul in the `paid` bucket. _reuse: 100% existing machinery · goal: sale → payslip, closed loop._
- **J. Rahul gets paid — and sees why** _(rep · mobile)_ — Payslip shows base + commission, traceable to October's visits. _reuse: payslip viewer · goal: trust compounds._
- **K. November — a shop returns 6 units** _(the real world)_ — October is finalized, so no rewrite. November's run emits a **negative** line (−₨360) as a signed one-off or a payslip adjustment row. _reuse: is_adjustment, parent_payslip_id · goal: corrections flow forward, history intact._
- **L. The compounding payoff** _(ongoing)_ — Leaderboards by rep / category / territory; earned-but-unpaid commission accrued as a liability tile. _new: commission accrual + dashboards — clone the `bonus_provisioning` pattern (it is EOY-bonus-specific and does not accrue commission) · goal: management sees the field operation live._

### The discipline that keeps it honest — snapshots forward, never backward

- **Snapshot at event time.** Price, plan, and rules are frozen when used — onto the sale line, into the commission run. A later edit never rewrites a past sale or payout. Same instinct as `structure_snapshot`, `country_rules_snapshot`, and the payslip's frozen geofence.
- **Finalized is immutable.** Once a payroll run is signed off, its commissions are set. Returns, voids, and disputes become signed deltas in the next period — a clawback one-off or an adjustment payslip — not an edit to a closed month.

---

## Completeness check — what's built vs still open

Most of the once-"open" refinements are now **built** (verified against the code, 28 tests green):

- **Returns / credit-notes** — `SalesReturn`/`SalesReturnLine` linked to a Sale, driving negative commission. ✅
- **On-collection trigger** — per-plan `on_sale` | `on_collection`, plus a `sales.payment_method` column. ✅
- **Targets depth** — team targets, mid-period pro-rating, accelerator bands. ✅
- **Team overrides** — a `team_override` rule type + `CreditAssignment` splits. ✅
- **Module feature-flag** — the paid-module gate via `company_modules` / `core/modules.py`. ✅
- **Commission statement PDF** — `services/commission_statement_pdf.py`. ✅
- **ERP reconcile** — idempotent batch, keyed on `client_uuid`. ✅
- **Archive-not-delete**, and **rep self-scoping** on sync / edit / void (403s). ✅
- **Period assignment by `sold_at`** within the period (not `synced_at`). ✅
- **Clawback > net pay** — handled, but via the **payslip's own negative-net** mechanism (`record_clawback`), not the `Loan`/`Repayment` carry-forward the earlier plan assumed.

**Still open:**

- **Off-payroll (contractor) payout execution** — **built** (see #2). `_is_off_payroll()` still detects-and-skips off-payroll reps on the payslip bridge (`reason: off_payroll`), and the `manual` channel now has an actual settlement path: `settle_manual_payouts` + `POST .../commission-runs/{id}/settle-manual` records an external reference (`commission_payables.settlement_reference`) and settles off-payroll commission without a one-off/payslip. (The completeness gate stays **opt-in**, default off unless a company override or `PAYROLL_COMPLETENESS_GATE` is warn/enforce.)
- **Maker-checker** on plan & price changes — not built.
- **Manager / team view-scoping** — **built** (see #4). `GET /sales` is scoped by role: owner/admin → all, manager → self + direct reports (via `PrivateUser.manager_private_user_id`), rep → self, with an out-of-scope rep filter 403'd.
- **Money & tax** — statutory **and EOY-bonus are handled downstream automatically** (commission is a taxable payslip earning; `bonus_provisioning` sums `payslip.gross`, which includes it). Genuinely absent in the commission engine: a **net-of-discount base**, discount limits, and **sale→pay FX** — see the agreed plan below.
- **On-collection allocation** — the trigger prorates by `sale.collected_amount` per sale (**built**); **multi-invoice FIFO allocation is not built** (confirmed).

---

## Agreed next build (plan — 2026-10-18)

Five items are buildable now, headless, with tests; two are deferred until a client needs them; one stays out of scope.

**Build now**
1. ✅ **Verification tests (Bucket 2)** — **done.** `tests/test_field_sales_routes_smoke.py` now smokes the lower-risk read/report routes over HTTP: returns/credit-notes, clawbacks (negative COMMISSION earning), ERP reconcile (dry-run match → commit → idempotent replay → unknown-SKU), bulk review (reject-needs-reason + both decisions apply to the batch), leaderboard/liability, product import (template download → dry-run preview → commit) and a statement-PDF check (real `%PDF`). The fixture teardown now clears `sales_return_lines`/`sales_returns` before `sale_lines` (FK order). Full field-sales set: **110 tests green**.
2. ✅ **Contractor manual-payout settlement** — **done (`0404f22`).** `payout_channel` is now **derived from the rep's `payroll_status`** at compute (off_payroll → `manual`), not hardcoded; new `settle_manual_payouts` service + `POST .../commission-runs/{id}/settle-manual` records an external reference (`commission_payables.settlement_reference`, migration `comm_settle_ref_20261018`) and settles off-payroll commission without a one-off/payslip. Tested (`test_field_sales_contractor.py`).
3. **Maker-checker on plan/price** — an approval state + two-actor flow on plan and price changes, mirroring the existing `payroll_maker_checker` pattern. _Decision: which mutations require a second approver._
4. ✅ **Team / manager view-scoping** — **done (`e2cb096`).** `GET /sales` is now scoped: owner/admin → all; **manager → self + direct reports** (via `PrivateUser.manager_private_user_id`); rep → self; an out-of-scope rep filter is 403'd. `crud.list_sales/count_sales` gained an `IN` filter. Tested with a non-team third rep (admin 3 / manager 2 / rep 1). _Follow-ups: scope `list-pending` + `leaderboard` too._
5. ✅ **Statutory-codes hardening** — **done (`0404f22`).** The `COMMISSION` component's `statutory_base_codes` now come from the shared resolver (`infer_statutory_base_codes`) — PAYE + CSG, no NSF — not a hardcoded literal.

**Deferred — demand-driven (cheap to add when a client needs it)**
- **FX (sale→pay currency)** — only if sales are booked in a currency ≠ the rep's pay; convert at run time via a single FX source (mirror payroll's `fx_snapshot`).
- **Net-of-discount commission base** — needs a new discount field on sale lines; add when a client actually gives trade discounts.

**Already handled — no build (commission rides the payslip)**
- Statutory PAYE/CSG/NSF (taxable earning), **EOY-bonus inclusion** (automatic via `bonus_provisioning` summing `payslip.gross`), and rounding.

**Out of scope** — multi-invoice FIFO payment allocation (needs an invoice/payment subsystem; collides with the "not an ERP" non-goal).

---

## Where the module deliberately stops — non-goals, decisions not omissions

Naming the boundary is as much a part of the spec as naming the scope. These flow from decision #1 (incentive-tracking, not an ERP).

- **Not an ERP.** No warehouse inventory, no GL as source of truth, customer invoicing/billing stays upstream. **Van-sales stock reconciliation** (stock issued → sold → returned) is out of scope — an optional future bridge if a client genuinely needs it.
- **Not a CRM.** No lead / opportunity / pipeline management. This records **executed sales** and pays on them — it doesn't manage prospecting.
- **Not route-optimisation.** Basic territories and visit lists, yes. Full routing / TSP optimisation, no — that's a different product.
- **Optional: promo budgets.** The one feature genuinely worth flagging: SPIFFs could draw against a company trade-marketing budget with a cap. This would be **new** — your existing `crud/budget.py` (`BudgetGoal`) is a personal expense budget, not a company/trade-marketing budget, so only the nominal pattern carries over. Opt-in, later phase.

---

## Delivery — four phases, value from the first

Phases 0–3.2 are **built & committed** (28 backend tests green). The table records what each phase delivered.

| Phase | Scope | New tables | Proves |
|---|---|---|---|
| **PHASE 0** | Catalog (default variant only) · admin-entered sale · one flat-% rule · on-payroll reps only | Product, ProductVariant, Sale, SaleLine, CommissionPlan, CommissionRule, CommissionPlanAssignment, CommissionRun, CommissionLineItem, CommissionPayable _(10 tables — committed; 28 tests green)_ | the full pipeline: sale → payable → one-off → taxed payslip line |
| **PHASE 1** | Mobile field capture · offline sync · geofence visit · barcode scan · photo | Outlet · sync endpoints (no other core tables) | reps in the field, reliably, offline |
| **PHASE 2** | Full variant/catalog model · on-collection trigger · all 5 rule types · targets · approval queue · leaderboards | ProductCategory, ProductOption/OptionValue, VariantOptionValue, UnitOfMeasure, ProductPrice, SalesTarget | real plans, real teams, self-serve |
| **PHASE 3** | Clawbacks · team overrides · territories/routes · liability accrual · ERP reconcile | CreditAssignment (adjustments ride existing payslip rows) | the messy real world, cleanly |

> **All phases built.** Phases 0–3.2 + the `sale_payment_method_20261018` follow-up are committed and backend-tested. What remains is the *Still open* list above (contractor payout settlement, maker-checker, team view-scoping) — follow-ups, not a new phase. The web admin UI **builds clean** (`next build` ✓, `tsc --noEmit` 0 errors). The HTTP route layer — previously only reached indirectly — now has **route-level tests** (`tests/test_field_sales_routes_smoke.py`): the core loop (product → sale → plan → run → approve → push) over HTTP, the `company_modules` gate 403ing when `field_sales` is disabled, the **rep self-scoping boundary** (a rep syncing another rep's sale → 403), and an **idempotent offline sync** (same `client_uuid` twice → one sale).

---

## The loop nobody else closes

Field-sales tools capture selling but can't pay. Payroll tools pay but can't see the field. You'd own the whole arc — product → field sale → commission → payslip → clawback — on infrastructure that's already built and paid for.

- **The moat** — Sale and pay in one system. Once a rep's selling and earning live together, switching cost is enormous.
- **The cost** — 20 field-sales tables, all built & committed, in 3 clean layers. Stages D–L lean on the existing payroll spine — though several once-assumed reuses (geofence-for-visits, barcode OCR, the sector/rule/bonus/budget jobs) proved to be new work over existing *patterns*, not drop-in reuse.
- **The revenue** — A natural paid B2B tier — the field-sales upgrade on top of the payroll base.

_Status (2026-10-19): backend (Phases 0–3.2) is built and **committed**; the field-sales suite is **110 tests green** (`tests/test_field_sales_routes_smoke.py` now covers both buckets — the core loop, module gate, rep self-scoping 403s, idempotent sync, and the Bucket-2 read/report routes: returns, clawbacks, ERP reconcile, bulk review, leaderboard/liability, product import, statement PDF). Web admin UI **builds clean** (`next build` ✓, `tsc --noEmit` 0 errors); mobile client **typechecks clean** with offline-sync worker unit tests. Of the agreed next-build items, **#1 (Bucket-2 verification), #2 (contractor settlement), #4 (team view-scoping) and #5 (statutory codes) are done**; **#3 maker-checker on plan/price is the remaining build** (plus the deferred, demand-driven FX and net-of-discount items). Still to do: the mobile **UI screens have not been run in a simulator** and the SQLite queue persistence is mocked (not integration-tested)._

> **Test-run note:** run the field-sales suite by **explicit file list**, not a whole-`tests/` `-k` selection. `main.py` calls `load_dotenv(override=True)`, so collecting every test module can load `backend/.env` (`POSTGRES_DB=ivor_activity_restored`) before the session bootstrap and trip conftest's non-test-DB guard. Per-file runs are unaffected.

---

_Field Sales & Commissions · Module Design v1 · built on the existing payroll spine · kiruko_
