# Task-Based Earnings Model — Executive Summary for Product Owner

> **Status note (2026-05-30)**: This doc originally evaluated **pure task-based pay** (compensation = sum of completed task values). The product-owner discussion landed on a **hybrid model** that's substantially safer and smaller-scope — section 1B below. The original analysis (sections 2–4) remains valid as the rationale for *not* building the pure version; section 5's recommendation now distinguishes the two paths. The hybrid is the recommended build.

---

## 1A. MODEL DEFINITION — Pure task-based (originally evaluated)

**What is it?**

An alternative earnings tracking system where:
- **Employer pre-schedules tasks** (weeks/months in advance) with fixed monetary values
- **Employee completes tasks** instead of clocking in/out hourly
- **Completion = automatic payment** (sum of completed tasks)
- **Employer choice**: Enable task-based OR stick with daily clock-in/clock-out OR both

**Example:**
```
Week 1: Employer schedules:
  - Pack 100 widgets: $50
  - Process 50 invoices: $40
  - Organize warehouse: $30

Employee completes:
  - Packed 100 widgets ✓
  - Processed 50 invoices ✓
  - Could not organize warehouse ✗

Employee earns: $90
```

**Key Difference from Current System**:
- **Current**: Click clock-in → Click clock-out → Earn (hours × hourly_rate)
- **Proposed (pure)**: Complete task → Get paid task_value (no hours involved)

---

## 1B. HYBRID MODEL — Hourly compensation + task tagging + employer-attached allowances (recommended)

**What is it?**

A lighter feature that keeps **hourly rate as the pay basis** but adds tasks as a *tracking dimension* — and lets the employer optionally attach a per-task allowance (hazard pay, travel reimbursement, meal voucher, etc.) when relevant.

- **Employee still earns hours × hourly_rate** for time worked. Minimum wage, breaks, overtime, payroll mechanics all behave exactly as today.
- **Employer pre-defines tasks** per company (think: "Off-site warehouse run", "Hazardous site visit", "Standard reception shift").
- **Employer optionally attaches an allowance** to a specific task assignment from a per-company **allowance catalog** (the existing `services/one_off_allowances_service.py` already models this — same plumbing, just bound to a task instance instead of a payroll period).
- **Employee tags their clock-in with a task** (mobile, web, kiosk). The hours feed payroll the normal way; any attached allowance flows in as an extra payroll line for that period.
- **No employee self-attestation** of allowances — only the employer adds them, so the wage-theft-in-reverse surface from pure task-based disappears.

**Example:**
```
Tuesday — Alice is scheduled for "Off-site warehouse run"
Employer attaches: TRAVEL_ALLOWANCE = Rs 200

Alice clocks in 08:00 → out 16:00 → 8h × Rs 250 = Rs 2,000
Plus the task-attached allowance: Rs 200
Tuesday total: Rs 2,200

Wednesday — Alice is scheduled for "Standard reception shift"
No allowance attached.

Alice clocks in 09:00 → out 17:00 → 8h × Rs 250 = Rs 2,000
Wednesday total: Rs 2,000
```

**Key Difference from Pure Task-Based**:
- Pay is still hourly → minimum wage automatically satisfied, no FLSA / MRA classification risk
- Allowances are employer-set, not employee-claimed → no dispute surface
- Tasks are a *categorization* dimension (useful for reporting + costing), not a pay determinant
- Reuses the existing `one_off_allowances` infrastructure (catalog, tax treatment, payroll integration)

**Cross-reference**: The kiosk MVP plan (`KIOSK_IMPLEMENTATION_PLAN.md` → M34) already designs the kiosk clock-in payload to accept optional `task_id` + `allowances[]` fields, so kiosk integration is purely additive when this hybrid lands.

---

## 2. WHY YOU SHOULD NOT BUILD THE *PURE* VERSION

> The risks in this section assume the **pure** task-based model from section 1A — where the task value *is* the compensation. Most of them **do not apply** to the hybrid model from section 1B because hourly remains the pay basis. Each risk below carries a 🟢 *hybrid: N/A* or ⚠️ *hybrid: still consider* annotation.

### 🔴 Critical Risks

#### **A. Wage Theft Liability** (LEGAL EXPOSURE) — 🟢 *hybrid: N/A*
- Employer can arbitrarily reduce task values anytime, cutting wages
- Example: "$5 per widget" → suddenly "$2 per widget" (retroactively)
- **Risk**: Lawsuits, regulatory fines, reputational damage
- **Real-world**: Amazon Flex, Instacart drivers sue over rate cuts regularly
- **Hybrid posture**: Pay is the hourly contract, not the task value. Task allowances are discretionary additions, equivalent to one-off bonuses — never a cut.

#### **B. Minimum Wage Violations** (LEGAL EXPOSURE) — 🟢 *hybrid: N/A*
- If task takes longer than estimated, employee may fall below minimum wage
- Example: Task = "$50 for 1 hour" → takes 3 hours → effective wage = $16.67/hr (below some states' minimum)
- **Risk**: Company liable for back wages + penalties
- **Employee Protection**: Labor law guarantees minimum wage, regardless of task structure
- **Hybrid posture**: Hourly rate IS the floor by definition. Min wage automatically satisfied.

#### **C. Dispute Explosion** (OPERATIONAL BURDEN) — 🟢 *hybrid: N/A*
- "I marked task complete, employer says I didn't actually complete it"
- Requires constant manual review: screenshots, video proof, mediation
- **Real-world**: Upwork, Fiverr platforms flooded with "task completion" disputes
- **Admin Overhead**: Spirals quickly (1 dispute per 100 tasks = massive team)
- **Hybrid posture**: Task completion doesn't drive pay, so there's nothing to dispute. The existing `time_log_disputes` flow handles any hour-related disputes the same as today.

#### **D. Worker Classification Risk** (TAX/LEGAL) — 🟢 *hybrid: N/A*
- Task-based looks like "contractor" work, not "employee"
- If misclassified: Company liable for back taxes, worker's comp, benefits
- **Real-world**: Uber/Lyft spent years in litigation over this exact issue
- **Hybrid posture**: Hourly employee is unambiguously an employee under FLSA / MRA Workers' Rights Act. No reclassification risk.

#### **E. Labor Law Complexity** (REGULATORY) — 🟢 *hybrid: N/A*
- No "shift" concept = harder to enforce breaks, meal periods, overtime rules
- Gig workers often work 12+ hours without OT protections
- **Risk**: Violates FLSA (Fair Labor Standards Act) depending on state
- **Hybrid posture**: Shifts remain the unit. All existing overtime / break / max-shift logic applies unchanged.

#### **F. Earnings Unpredictability** (EMPLOYEE RETENTION) — 🟢 *hybrid: N/A*
- Employees don't know weekly/monthly pay (impossible to budget)
- Income fluctuates wildly → low-income workers suffer
- **Risk**: High employee turnover, morale issues
- **Hybrid posture**: Paychecks match today's hourly model. Allowances are additive, never subtractive.

---

### 🟡 Operational Challenges

#### **Task Definition Scope Creep** — ⚠️ *hybrid: still consider (lighter form)*
- "Complete task" means different things
- Task 1: "Answer 1 phone call" = $2 vs Task 2: "Answer 1 phone call" = $15?
- Unfairness: Same work, different pay → morale collapse
- **Hybrid posture**: Tasks here are *categorization labels*, not pay rules. Still worth keeping the catalog tight per company so reporting stays meaningful.

#### **Queue Gaming** — 🟢 *hybrid: N/A*
- Employer schedules 200 tasks worth $5000, knowing only 30% will complete
- Employees show up, no tasks available → $0 pay
- OR: Employer removes tasks before completion → theft
- **Hybrid posture**: Employees are paid for hours regardless of how many tasks are queued. Removing a task doesn't change their paycheck.

#### **Burnout & Injury Risk** — 🟢 *hybrid: N/A*
- Task-based creates "optimize for speed" pressure
- Warehouse workers sprint to pack faster → repetitive strain injuries spike
- **Real-world**: Amazon warehouse injury rates correlate with task-based pay
- **Hybrid posture**: No "more tasks = more pay" pressure since pay tracks hours.

#### **Data Quality Issues** — 🟢 *hybrid wins here*
- Task completion = worse data than hourly time logs
- Hard to audit "when" work actually happened
- Payroll disputes harder to resolve
- **Hybrid posture**: Actually *better* than today — hour data stays as the source of truth, and the task tag adds an extra dimension for reporting/costing.

---

### 💰 Business Impact

- **Higher Support Burden**: Disputes = massive help desk volume
- **Lower Adoption**: Employees prefer predictable hourly pay; competitor with hourly wins talent
- **Regulatory Scrutiny**: Task-based workers invite labor board audits
- **Reputational Risk**: "Kontokaz exploits workers" headlines if rates cut harshly

---

## 3. WHY YOU SHOULD BUILD THIS

### ✅ Real Business Opportunities

#### **A. Market Fit for Gig & Project Work**
- **Industries that genuinely need this**:
  - Delivery services (DoorDash model: per-delivery pay)
  - Freelance platforms (Upwork model: per-project pay)
  - Manufacturing/piecework (widget factory: $5 per widget)
  - Data entry (process 100 records = $25)
  - Customer service (ticket-based: resolve ticket = $3)

- **Revenue Unlock**: 30-50% of your customers may prefer this model
- **Competitive Advantage**: If your only competitor uses hourly, you win this segment

#### **B. Employer Benefits (Real)**
- **Predictable labor costs** (know job budget upfront)
- **Incentive alignment** (productive workers = more pay, lazy workers = less)
- **Reduced admin burden** (no approval workflow if tasks self-mark)
- **Seasonal/project work** (pre-schedule tasks for busy months)

#### **C. Employee Benefits (Real, if done right)**
- **Clarity**: Know exactly what tasks to do
- **Autonomy**: Tackle tasks in any order (flexibility)
- **Earning potential**: Work faster, do more tasks, earn more
- **Faster paycheck**: Complete task = instant value (vs waiting for admin approval)

#### **D. Platform Differentiation**
- Current system: Only hourly time tracking
- With this: "Choose hourly OR task-based per company"
- **Competitive advantage**: More flexible than competitors
- **Market expansion**: Access gig economy + project-based companies

#### **E. Data & Analytics Goldmine**
- Task completion data = rich insights for employers
- Productivity metrics, performance anomalies, training needs
- **Upsell opportunity**: Premium analytics product

---

### 📊 Market Validation

**Real-World Precedent:**
- ✅ DoorDash: $2-15 per delivery (task-based, massive scale)
- ✅ Amazon Flex: $18-25 per delivery block (task-based, billions in volume)
- ✅ Upwork: Per-project pricing (freelance, $10B+ platform)
- ✅ Manufacturing sector: Piecework wages (decades-long standard)

**Proven Demand**: Billions of dollars flow through task-based platforms annually. It's not a hypothetical niche.

---

## 4. RISK MITIGATION (If You Proceed)

> Each guardrail below is annotated with whether it's needed for the **pure** model (section 1A), the **hybrid** model (section 1B), or both. The hybrid drops 4 of the 8 outright.

### **Build It Safely with These Guardrails** 🛡️

1. **Minimum Wage Guarantee** (Automatic Top-Up) — *pure only*
   - If task pays less than min_wage × hours_worked, top up the difference
   - Code: `payment = MAX(task_value, minimum_wage × hours_worked)`
   - **Hybrid**: Not needed — hourly rate is already the floor.

2. **Clear Task Definitions** (Acceptance Criteria) — *both*
   - Every task must have detailed completion criteria
   - Example: "Task: Fix login bug → Acceptance: User can enter email/password, receives token, redirected to dashboard"
   - NOT: "Fix login" (too vague)
   - **Hybrid**: Still useful for reporting clarity, but the consequence of fuzziness is "messy reports" not "wage disputes".

3. **Transparent Pricing** (30-Day Notice) — *pure only*
   - Publish all task values 30 days in advance
   - No rate cuts mid-month (only for NEW tasks)
   - **Trust**: Employees see stability
   - **Hybrid**: Not needed — there's no per-task "price" to publish. Allowances follow the existing one-off-allowance disclosure flow.

4. **Admin Approval** (Not Self-Marking) — *pure only*
   - Employee marks complete, admin reviews
   - Prevents disputes by catching issues early
   - Maintains governance gate
   - **Hybrid**: Not needed — task completion doesn't drive pay. (The existing M3 admin-approval gate on `time_logs` still applies for hours review.)

5. **Dispute Resolution** (Independent Mediation) — *pure only*
   - If employee/employer disagree: 3rd party decides
   - Too many disputes = sign model isn't working
   - **Hybrid**: Not needed — existing `time_log_disputes` flow already covers hour-level disputes; tasks add no new dispute surface.

6. **Shift Boundaries** (Labor Law Compliance) — *both (already in place)*
   - Tasks organized into shifts (8am-5pm)
   - Prevents infinite queues (employee works 12+ hours)
   - Overtime rules apply to excess hours
   - **Hybrid**: Already done by M27 (profile-driven max-shift-hours auto-close).

7. **Legal Review** (Before Launch) — *both, but hybrid is much smaller*
   - Consult labor attorney
   - Varies by state/country
   - Some states may forbid this model entirely
   - **Hybrid**: Question becomes "is an employer-discretionary per-task allowance legal?" — answer is yes (it's a one-off bonus). Far cheaper consultation.

8. **Pilot Carefully** (1 Company, 3 Months) — *both*
   - Test with single company first
   - Measure: dispute rate, employee satisfaction, wage compliance
   - Only scale if metrics healthy
   - **Hybrid**: Pilot still wise but lower stakes — failure mode is "employees ignore the task picker", not "employees get underpaid".

---

## 5. RECOMMENDATION

### **Decision Matrix (updated for hybrid)**

| Question | Pure (1A) | Hybrid (1B) |
|----------|-----------|-------------|
| Customer demand validated? | Required | Nice-to-have (hybrid is small enough to ship speculatively) |
| Legal review budget available? | Required (2–3 weeks) | Light (1 week, focused on "per-task allowance" treatment) |
| Min-wage top-up engineering committed? | Required | N/A |
| Hourly system stable? | Required | Required (and it is — M0–M30 are shipped) |
| Pilot company lined up? | Required | Recommended |
| | **CONDITIONAL** | **YES** |

### **My Stance**

**Pure task-based (1A): CONDITIONAL YES.** Unchanged from the original analysis. If you want to position Kontokaz for gig/piecework verticals (delivery, freelance, manufacturing piecework), build it — but only with all 8 guardrails from section 4, and only after a 1-company / 3-month pilot.

**Hybrid (1B): YES, build it.** It's substantially smaller (~3–4 weeks vs 6–8), has none of the section-2 legal landmines, and reuses infrastructure that already exists (`one_off_allowances_service`, the M3 time-log review surface, the kiosk plan's M34 forward-compat hook). The downside risk is "employees don't engage with the task picker" — recoverable, not catastrophic.

**Phased build (hybrid):**
- **v1 (MVP, ~3 weeks)**: Task entity + per-company catalog + employer-side "attach allowance to task" UI + payroll integration via `one_off_allowances`. Mobile + web clock-in get an optional task picker.
- **v2 (Polish, ~1 week)**: Reporting — hours-by-task, allowances-by-task, cost-by-task (this is the "Data & Analytics Goldmine" payoff from section 3E, properly delivered now that pay isn't entangled).
- **v3 (Kiosk integration)**: Activate kiosk M34 — the kiosk endpoint payload already accepts `task_id` + `allowances[]`; UI gains the task picker screen between PIN and success.

**Skip the pure model unless**:
- You've identified a specific gig/freelance vertical to target
- You've validated demand with 10+ committed companies in that vertical
- Legal counsel has confirmed it's permissible in your target markets

---

## 6. NEXT STEPS FOR PO

1. **Validate Customer Demand**
   - Survey 10-15 customers: "Would you use task-based pay?"
   - Get commitment: "If available, would you enable it?"
   - Identify which industries want this

2. **Legal Consultation**
   - 1-week engagement with employment lawyer
   - Confirm legality in your target markets
   - Identify guardrails required

3. **Competitive Analysis**
   - How do DoorDash, Upwork, Amazon handle it?
   - What worked, what failed?
   - Borrow best practices

4. **Design Decision**
   - **Schedule**: When would you build this? After hourly is stable?
   - **Resource**: Who owns this?
   - **Timeline**: 6-month plan vs backlog?

5. **Pilot Plan** (if approved)
   - Identify 1 company willing to test
   - 3-month trial
   - Measure: adoption, disputes, wage issues, satisfaction
   - Decide: launch, iterate, or kill

---

## 7. FINANCIAL ESTIMATE

### Pure (1A) — unchanged from original

**Development Cost**: ~6-8 weeks (if done right with guardrails)
- Backend: Task model + service layer (2-3 weeks)
- Frontend: Admin UI + dispute resolution (2-3 weeks)
- Testing + legal compliance (1-2 weeks)

**Ongoing Cost**: ~1 FTE (support, dispute handling, monitoring)

**Revenue Potential**: +$50K-100K ARR (if 20% adoption at $5K per company per year)

### Hybrid (1B) — recommended

**Development Cost**: ~3-4 weeks
- Backend: Task entity + per-company catalog + bind allowance to task instance (1 week — reuses `one_off_allowances_service`)
- Frontend: Admin "create task" + "attach allowance" UI; clock-in flows gain optional task picker (1.5 weeks across mobile + web)
- Reporting (v2 slice): hours-by-task / allowances-by-task / cost-by-task dashboards (1 week)
- Testing + light legal consultation (0.5 weeks)

**Ongoing Cost**: ~0.1 FTE (no dispute machinery to maintain; allowance treatment piggybacks on existing payroll-engine paths)

**Revenue Potential**: Two streams
- **B2B**: same as pure (~$50K-100K ARR at 20% adoption) — and probably higher uptake because the legal posture lets more companies enable it
- **Data product**: per-task reporting is a credible premium analytics upsell once a customer base has ~3 months of tagged data

**Net**: hybrid is ~half the cost, ~zero ongoing burden, plausibly higher revenue. The pure model only wins if you're chasing gig/freelance verticals specifically.

---

## Summary Table

| Aspect | Pure (1A) | Hybrid (1B) |
|--------|-----------|-------------|
| **Market Fit** | ✅ High in gig verticals | ✅ High across the existing customer base |
| **Legal Risk** | 🔴 High (wage theft, FLSA, classification) | 🟢 Low (additive bonus pattern) |
| **Complexity** | 🟡 Medium (8 guardrails) | 🟢 Low (reuses `one_off_allowances`) |
| **Effort** | 6–8 weeks + 1 FTE ongoing | 3–4 weeks + ~0.1 FTE ongoing |
| **Business Value** | ✅ Differentiation in gig verticals | ✅ Better data + new revenue + low risk |
| **Employee Trust** | 🟡 Conditional on guardrails | 🟢 No pay-model change |
| **Build It?** | ⚠️ Conditional — only if gig vertical is the strategy | ✅ **Yes** — recommended next product step |

---

**Prepared**: 2026-05-29  
**Revised**: 2026-05-30 (hybrid model added; recommendation updated)  
**For**: Product Owner  
**Status**: Hybrid path approved direction; pure model preserved as the rejected alternative for audit
