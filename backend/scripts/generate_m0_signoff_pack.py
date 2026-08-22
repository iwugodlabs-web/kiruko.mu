#!/usr/bin/env python3
"""Generate the M0 statutory sign-off pack — the document you hand a Mauritian
tax accountant/lawyer to verify the payroll rates and reconcile worked payslips.

Reads the FY2025/26 rates currently in the DB and writes a verification-friendly
pack as BOTH markdown and PDF: every rate has a tick-box + a space for the
correct value, and every worked payslip spells out the arithmetic line by line
(so the reviewer can check each figure against the MRA calculator in seconds).

Usage:  cd backend && python3 scripts/generate_m0_signoff_pack.py
Writes: backend/M0-SIGNOFF-PACK.md  and  backend/M0-SIGNOFF-PACK.pdf
"""
import os
import sys
from datetime import date
from decimal import Decimal

backend = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, backend); os.chdir(backend)
try:
    from dotenv import load_dotenv; load_dotenv(os.path.join(backend, ".env"), override=False)
except Exception:
    pass
from core.config import get_session_local
from services import payroll_rules as rules

AS_OF = date(2026, 9, 1)
SAMPLES = [Decimal("30000"), Decimal("80000"), Decimal("150000"), Decimal("1200000")]
NSF_CEILING = Decimal("28570")


def _m(x):
    return f"{Decimal(x):,.2f}"


def main():
    db = get_session_local()()
    try:
        snap = rules.resolve(db, "MU", AS_OF)
        ee = [d for d in snap.statutory_deductions if d.employer_or_employee == "employee"]
        brackets = sorted(snap.tax_bracket_set.brackets, key=lambda b: b.order_index)
        eff = snap.statutory_deductions[0].effective_from

        def csg_for(g):
            return rules.compute_statutory({"CSG_EE": g}, ee).get("CSG_EE", Decimal("0"))

        def nsf_for(g):
            return rules.compute_statutory({"NSF_EE": g}, ee).get("NSF_EE", Decimal("0"))

        def paye_bands(annual):
            """Return [(low, top, rate, amount)] per band that the income reaches."""
            rows = []
            for b in brackets:
                if annual <= b.lower_bound:
                    break
                upper = b.upper_bound if b.upper_bound is not None else annual
                top = min(annual, upper)
                amt = (top - b.lower_bound) * b.rate
                if (top - b.lower_bound) > 0:
                    rows.append((b.lower_bound, top, b.rate, amt))
            return rows

        # ---- build one verifiable payslip block (returns md + html) -------------
        def payslip(g):
            csg = csg_for(g)
            csg_rate = "3%" if g > 50000 else "1.5%"
            nsf = nsf_for(g)
            nsf_base = min(g, NSF_CEILING)
            annual = g * 12
            bands = paye_bands(annual)
            paye_annual = sum((r[3] for r in bands), Decimal("0"))
            paye = (paye_annual / 12).quantize(Decimal("0.01"))
            net = (g - csg - nsf - paye).quantize(Decimal("0.01"))

            band_md = "\n".join(
                f"    - Rs {_m(lo)} – {_m(hi)} @ {rate*100:.0f}% = {_m(amt)}" for lo, hi, rate, amt in bands
            ) or "    - (none — under the tax-free threshold)"
            band_html = "".join(
                f"<div class='sub2'>Rs {_m(lo)}–{_m(hi)} @ {rate*100:.0f}% = {_m(amt)}</div>" for lo, hi, rate, amt in bands
            ) or "<div class='sub2'>none — under the tax-free threshold</div>"

            md = (
                f"### Employee earning Rs {_m(g)} / month (single, no dependents)  ☐\n\n"
                f"- **Gross pay = Rs {_m(g)}**\n"
                f"- CSG (social): {csg_rate} × {_m(g)} = **{_m(csg)}**  ☐\n"
                f"- NSF (savings): 1% × Rs {_m(nsf_base)} (capped at {_m(NSF_CEILING)}) = **{_m(nsf)}**  ☐\n"
                f"- PAYE (income tax): annual taxable = {_m(g)} × 12 = Rs {_m(annual)}\n{band_md}\n"
                f"    - **annual tax {_m(paye_annual)} ÷ 12 = Rs {_m(paye)} / month**  ☐\n"
                f"- **TAKE-HOME = {_m(g)} − {_m(csg)} − {_m(nsf)} − {_m(paye)} = Rs {_m(net)}**  ☐\n"
            )
            html = (
                f"<div class='ps'><div class='ps-h'>Employee earning <b>Rs {_m(g)} / month</b></div>"
                f"<table>"
                f"<tr><td>Gross pay</td><td class='r'><b>{_m(g)}</b></td><td class='c'></td></tr>"
                f"<tr><td>CSG (social) — {csg_rate} × {_m(g)}</td><td class='r'>{_m(csg)}</td><td class='c'>☐</td></tr>"
                f"<tr><td>NSF (savings) — 1% × {_m(nsf_base)} <span class='note'>(cap {_m(NSF_CEILING)})</span></td><td class='r'>{_m(nsf)}</td><td class='c'>☐</td></tr>"
                f"<tr><td>PAYE (income tax) on Rs {_m(annual)}/yr {band_html}<span class='note'>annual {_m(paye_annual)} ÷ 12</span></td><td class='r'>{_m(paye)}</td><td class='c'>☐</td></tr>"
                f"<tr class='net'><td>TAKE-HOME (net pay)</td><td class='r'>{_m(net)}</td><td class='c'>☐</td></tr>"
                f"</table></div>"
            )
            return md, html

        ps_blocks = [payslip(g) for g in SAMPLES]

        # ---- rate schedule rows (item, system value) ----------------------------
        rate_rows = [
            ("PAYE — tax-free threshold (no dependents)", "Rs 500,000 / year"),
            ("PAYE — band 1", "0% on the first Rs 500,000"),
            ("PAYE — band 2", "10% on Rs 500,000 – 1,000,000"),
            ("PAYE — band 3", "20% on Rs 1,000,000 – 12,000,000"),
            ("PAYE — Fair Share (very high earners)", "+15% above Rs 12,000,000/yr (35% total)"),
            ("CSG employee", "1.5% if pay ≤ Rs 50,000/mo · 3% if above"),
            ("CSG employer", "3% if pay ≤ Rs 50,000/mo · 6% if above"),
            ("NSF employee", "1%, capped at Rs 28,570/mo"),
            ("NSF employer", "2.5%, capped at Rs 28,570/mo"),
            ("HRDC Training Levy (employer)", "1.5%"),
        ]

        # ---- MARKDOWN -----------------------------------------------------------
        md = []
        md.append("# Mauritius Payroll — Statutory Rates Sign-Off\n")
        md.append(f"**Kiruko payroll** · rates effective **{eff}** (FY2025/26) · source: MRA + PwC (Finance Act 2025).\n")
        md.append("**What we're asking:** please confirm the rates and the worked payslips below match current "
                  "Mauritius law. Tick ☐ where correct; write the right figure where not. ~30 minutes.\n")
        md.append("---\n## 1. Rates — tick if correct, or write the correct value\n")
        md.append("| # | Rate | System uses | ✔ correct? | If wrong, correct value |")
        md.append("|--|--|--|--|--|")
        for i, (item, val) in enumerate(rate_rows, 1):
            md.append(f"| {i} | {item} | {val} | ☐ | |")
        md.append("\n---\n## 2. Worked payslips — check each line\n")
        md.append("*Tip: punch each monthly gross into the MRA calculator (mra.mu) and compare.*\n")
        for block, _ in ps_blocks:
            md.append(block)
        md.append("---\n## 3. Three assumptions to confirm\n")
        md.append("1. **Tax-free amount is a flat Rs 500,000** (for someone with no dependents). The system does "
                  "**not yet** give the larger allowance to staff with children/dependents — so they're currently "
                  "taxed a bit too much. ☐ OK for now ☐ must add before launch\n")
        md.append("2. **NSF is charged on basic pay; CSG on total pay** (basic + allowances). ☐ Correct\n")
        md.append("3. **Fair Share** (the +15% for very high earners) is built into the income-tax figure rather "
                  "than shown as a separate line. ☐ Fine ☐ must be separate\n")
        md.append("---\n## 4. Sign-off\n")
        md.append("I confirm the above is correct for FY2025/26 (corrections noted):\n")
        md.append("Name: ________________________   Firm: ________________________\n")
        md.append("Signature: ____________________   Date: ____________________\n")
        with open(os.path.join(backend, "M0-SIGNOFF-PACK.md"), "w") as f:
            f.write("\n".join(md))

        # ---- PDF ----------------------------------------------------------------
        rate_html = "".join(
            f"<tr><td class='n'>{i}</td><td>{item}</td><td>{val}</td><td class='c'>☐</td><td class='fill'></td></tr>"
            for i, (item, val) in enumerate(rate_rows, 1)
        )
        ps_html = "".join(h for _, h in ps_blocks)
        html = f"""<html><head><meta charset='utf-8'><style>
@page{{size:A4;margin:1.3cm}} body{{font-family:'Helvetica','Arial',sans-serif;color:#1a2238;font-size:11px;line-height:1.5}}
h1{{font-size:18px;margin:0 0 2px}} h2{{font-size:13px;margin:18px 0 8px;border-bottom:2px solid #1a2238;padding-bottom:3px}}
.meta{{color:#555}} .ask{{background:#eef6ff;border:1px solid #b9d8ff;border-radius:6px;padding:8px 11px;margin:9px 0 4px}}
table{{width:100%;border-collapse:collapse;margin:4px 0}}
td,th{{padding:5px 7px;border-bottom:1px solid #eef0f4;vertical-align:top}} th{{text-align:left;color:#8a93a6;font-size:9px;text-transform:uppercase;letter-spacing:.04em}}
.r{{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}} .c{{text-align:center;width:34px;font-size:14px}} .n{{width:20px;color:#8a93a6}}
.fill{{width:120px;border-left:1px dashed #ccc}}
.ps{{border:1px solid #d9dee8;border-radius:9px;padding:6px 12px;margin-bottom:11px;page-break-inside:avoid}}
.ps-h{{font-size:12px;padding:4px 0;border-bottom:1px solid #eee;margin-bottom:2px}} .tick{{float:right;font-size:14px}}
.ps .net td{{font-weight:700;color:#0a7d3f;border-top:2px solid #0a7d3f}}
.sub2{{color:#445;margin-left:10px}} .note{{color:#8a93a6;font-size:9px;display:block;margin-left:10px}}
.assume{{margin:6px 0}} .sign{{margin-top:14px;border-top:1px solid #ddd;padding-top:10px;line-height:2.4}}
</style></head><body>
<h1>Mauritius Payroll — Statutory Rates Sign-Off</h1>
<div class='meta'>Kiruko payroll · rates effective <b>{eff}</b> (FY2025/26) · source: MRA + PwC (Finance Act 2025)</div>
<div class='ask'><b>What we're asking:</b> confirm the rates and worked payslips below match current Mauritius law.
Tick ☐ where correct; write the right figure where not. ~30 minutes.</div>
<h2>1. Rates — tick if correct, or write the correct value</h2>
<table><tr><th></th><th>Rate</th><th>System uses</th><th class='c'>OK?</th><th>Correct value</th></tr>{rate_html}</table>
<h2>2. Worked payslips — check each line</h2>
<div class='meta' style='margin-bottom:6px'>Punch each monthly gross into the MRA calculator (mra.mu) and compare.</div>
{ps_html}
<h2>3. Three assumptions to confirm</h2>
<div class='assume'>1. <b>Tax-free amount is a flat Rs 500,000</b> (no-dependents case). Staff with children get a bigger allowance — not yet modelled, so they're taxed slightly high. &nbsp;☐ OK for now &nbsp;☐ must add</div>
<div class='assume'>2. <b>NSF is on basic pay; CSG on total pay</b> (basic + allowances). &nbsp;☐ Correct</div>
<div class='assume'>3. <b>Fair Share</b> (+15% for very high earners) is built into the income-tax figure, not a separate line. &nbsp;☐ Fine &nbsp;☐ must be separate</div>
<h2>4. Sign-off</h2>
<div class='sign'>I confirm the above is correct for FY2025/26 (corrections noted above).<br>
Name: ________________________   Firm: ________________________<br>
Signature: ____________________   Date: ________________</div>
</body></html>"""
        from weasyprint import HTML
        pdf_path = os.path.join(backend, "M0-SIGNOFF-PACK.pdf")
        HTML(string=html).write_pdf(pdf_path)
        print(f"Wrote M0-SIGNOFF-PACK.md and {pdf_path} ({os.path.getsize(pdf_path)} bytes)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
