<!-- Text copy of the design spec artifact: https://claude.ai/code/artifact/6ece0be6-9726-4e8b-b672-ab0308aae597 -->

# Sell in the field. Pay on the payslip.

**Module Design · Field Sales & Commissions · v1**

A new selling surface bolted onto a payroll engine you've **already built**. Reps log what they sell at each outlet; the platform turns it into commission under rules you define, and pays it on the next payslip — no second system, no CSV export, no manual upload. This is the complete blueprint, with every piece marked as something you reuse or something new.

- **19** new tables across all phases — **10** already scaffolded for Phase 0
- Built on the existing **payroll spine** — payout, PAYE/CSG, and finalize are reused
- **1** write bridges sales → payroll (the one-off allowance)
- **4** phases, shippable from Phase 0

> **Current state (2026-10-18):** Phases **0–3.2 backend are built**, and the **mobile field-capture client** and **web admin UI** are now built (all uncommitted). Migrations `field_sales_phase0/1/2/3/3_1/3_2_20261017.py` (all applied). Code: `schema/field_sales_schema.py`, `db_models/crud/field_sales.py`, `services/commission_service.py` (engine + rules + the one-off bridge), `services/commission_statement_pdf.py` + template, `api/v1/commissions.py` (registered), and tests `test_field_sales_phase0.py` (6) + `test_field_sales_phase2.py` (22) covering: sale → payable → one-off → taxed payslip line; outlets + geo-verified offline sync; all 5 rule types + `team_override`; on-collection; UoM volumetrics; attribute scope; targets + accelerator bands + mid-period pro-rating; catalogs; leaderboards; liability accrual; credit-assignment splits; clawbacks; **returns/credit-notes** driving negative commission; ERP reconcile **with idempotent commit**. The sync/capture routes now also enforce rep self-scoping (a rank-and-file member may only sync sales credited to themselves). **Web admin UI** (`web/ivor-web/src/app/(platform)/dashboard/field-sales/` — Overview/leaderboard/liability, Catalog, Plans + assignments, Sales approval queue + outlets, Runs with approve/push + statement PDF; Sidebar entry): the HTTP API it needs is in place. **Mobile field capture** (`mobile/app/private_dashboard/field_sales.tsx` + `field_sale_new.tsx`; `mobile/api/fieldSales.ts`; offline queue `sales_queue` / `services/offline/salesQueue.ts` + `salesSync.ts` — geofence check-in, catalog picker, barcode scan via expo-camera, offline-first submit; reachable from Settings). Everything below marked _reuse_ has been checked against the codebase; claims that failed that audit are reclassified as _new_.

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
- `ProductOption` / `OptionValue` — Size · Flavour · Pack
- `ProductVariant` — sku · barcode · sell_uom · status
- `VariantOptionValue` — variant ↔ option values
- `UnitOfMeasure` — base unit + pack conversions
- `ProductPrice` — per variant · versioned · territory _(Phase 2; Phase 0 price is inline on `ProductVariant.unit_price` — a single price, no versioning or territory)_

**Sales capture** _(new)_
- `Sale` — rep · credited_to · outlet · geo · status · payment_status · client_uuid
- `SaleLine` — variant · qty · uom · unit_price_snapshot
- `Collection` — collected_amount / collected_at → earn-on-collection _(modelled as columns on `Sale` in the Phase 0 scaffold, not its own table; the on-collection evaluation lands Phase 2, so Phase 0/1 plans run earn-on-sale only)_
- `Outlet` — geo+geofence · credit terms · assigned rep · visit cadence _(Phase 1; `Sale.outlet_id` is a placeholder column today)_

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

_Build state:_ Phase 0 has scaffolded (uncommitted) `Product`, `ProductVariant`, `Sale`, `SaleLine`, `CommissionPlan`, `CommissionRule`, `CommissionPlanAssignment`, `CommissionRun`, `CommissionLineItem`, `CommissionPayable`. The rest — `ProductCategory`, `ProductOption`/`OptionValue`, `VariantOptionValue`, `UnitOfMeasure`, `ProductPrice`, `Outlet`, `Collection` (currently columns on `Sale`), `CreditAssignment`, `SalesTarget` — **do not exist yet**.

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

## Completeness check — still open, refinements scoped to later phases

The structural scope is settled. These are the remaining decisions; a few touch the data model, so they're captured now to avoid a retrofit. **None of them block Phase 0.**

- **Money & tax:** commission base gross vs **net-of-discount** (per-plan) + discount authority limits; statutory — commission sits in PAYE **and** CSG/NSF bases, counts toward EOY-bonus provisioning; rounding + sale-currency → pay-currency FX _(reuse shadow-FX)_.
- **On-collection mechanics:** **returns / credit-notes** as a first-class entity linked to the Sale / SaleLine (incl. partial returns); **payment allocation** — partial payments, FIFO against invoices — driving pro-rata commission. These are what make the on-collection trigger real.
- **Governance & lifecycle:** per-company **module feature-flag** (the B2B tier gate); **maker-checker** on plan & price changes _(existing pattern)_; never hard-delete a plan/product that has paid — archive only; sale edit / void window before approval.
- **People & output:** **view-scoping** perms — rep sees own · manager sees team · admin sees all; rep hierarchy for team overrides; commission statement PDF _(reuse payslip_pdf)_; targets depth — team targets, mid-period pro-rating, accelerator bands.

**The load-bearing one: paying non-payroll reps.** The bridge assumes the rep is **on payroll**. But field reps are often commission-only **contractors** — and your existing `payroll_status='off_payroll'` marker auto-excludes them from every run, so their one-off would be written and then **silently never paid**: exactly the silent-exclusion bug your completeness work targets — and because that completeness gate is **opt-in (default off** unless a company override or `PAYROLL_COMPLETENESS_GATE` is set to warn/enforce), by default nothing would flag the omission at all. Needs a decision, not a hand-wave: a **second payout rail** (a commission payable + settlement for non-payroll reps), or scope the module to on-payroll reps first. Plus two edges: a **clawback that exceeds net pay** must carry forward as a recoverable (not vanish), and **period-boundary timing** (`sold_at` vs `synced_at`) needs a rule.

**Phase 0 is still safe.** Scoped to **on-payroll reps**, Phase 0 (flat-%, earn-on-sale, admin-entered) exercises the full pipeline without any open item above. The contractor rail and these edges land in Phase 2–3 — but the on/off-payroll decision should be made *before* you promise a client commission-only reps.

---

## Where the module deliberately stops — non-goals, decisions not omissions

Naming the boundary is as much a part of the spec as naming the scope. These flow from decision #1 (incentive-tracking, not an ERP).

- **Not an ERP.** No warehouse inventory, no GL as source of truth, customer invoicing/billing stays upstream. **Van-sales stock reconciliation** (stock issued → sold → returned) is out of scope — an optional future bridge if a client genuinely needs it.
- **Not a CRM.** No lead / opportunity / pipeline management. This records **executed sales** and pays on them — it doesn't manage prospecting.
- **Not route-optimisation.** Basic territories and visit lists, yes. Full routing / TSP optimisation, no — that's a different product.
- **Optional: promo budgets.** The one feature genuinely worth flagging: SPIFFs could draw against a company trade-marketing budget with a cap. This would be **new** — your existing `crud/budget.py` (`BudgetGoal`) is a personal expense budget, not a company/trade-marketing budget, so only the nominal pattern carries over. Opt-in, later phase.

---

## Delivery — four phases, value from the first

Phase 0 proves the entire A→Z loop with the least possible code — before a line of mobile offline sync or the rules engine exists.

| Phase | Scope | New tables | Proves |
|---|---|---|---|
| **PHASE 0** | Catalog (default variant only) · admin-entered sale · one flat-% rule · on-payroll reps only | Product, ProductVariant, Sale, SaleLine, CommissionPlan, CommissionRule, CommissionPlanAssignment, CommissionRun, CommissionLineItem, CommissionPayable _(10 — schema + engine + API + tests, uncommitted)_ | the full pipeline: sale → payable → one-off → taxed payslip line |
| **PHASE 1** | Mobile field capture · offline sync · geofence visit · barcode scan · photo | Outlet · sync endpoints (no other core tables) | reps in the field, reliably, offline |
| **PHASE 2** | Full variant/catalog model · on-collection trigger · all 5 rule types · targets · approval queue · leaderboards | ProductCategory, ProductOption/OptionValue, VariantOptionValue, UnitOfMeasure, ProductPrice, SalesTarget | real plans, real teams, self-serve |
| **PHASE 3** | Clawbacks · team overrides · territories/routes · liability accrual · ERP reconcile | CreditAssignment (adjustments ride existing payslip rows) | the messy real world, cleanly |

---

## The loop nobody else closes

Field-sales tools capture selling but can't pay. Payroll tools pay but can't see the field. You'd own the whole arc — product → field sale → commission → payslip → clawback — on infrastructure that's already built and paid for.

- **The moat** — Sale and pay in one system. Once a rep's selling and earning live together, switching cost is enormous.
- **The cost** — 19 new tables across all phases (10 scaffolded for Phase 0), in 3 clean layers. Stages D–L lean on the existing payroll spine — though several once-assumed reuses (geofence-for-visits, barcode OCR, the sector/rule/bonus/budget jobs) are new work over existing *patterns*, not drop-in reuse.
- **The revenue** — A natural paid B2B tier — the field-sales upgrade on top of the payroll base.

_Status: the entire module — backend (Phases 0–3.2), the **web admin UI** and the **mobile field-capture client** — is built and tested (all uncommitted). Review, commit, then verify the clients against a running backend._

---

_Field Sales & Commissions · Module Design v1 · built on the existing payroll spine · kiruko_
