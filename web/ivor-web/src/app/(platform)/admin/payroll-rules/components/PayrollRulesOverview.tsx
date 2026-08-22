"use client";

import { useCallback, useEffect, useState } from "react";
import {
    payrollRules,
    type TaxBracketSet,
    type StatutoryDeduction,
    type CountryLeaveDefault,
    type CountryBonusRule,
    type CountryOvertimeRule,
    type PublicHoliday,
} from "@/services/payroll-api";
import { isError } from "@/utils/payrollFormat";
import { ArrowRight, AlertTriangle, CheckCircle2, Percent, Wallet, CalendarDays, Gift, Timer, CalendarCheck } from "lucide-react";

export type RuleType = "tax" | "statutory" | "leave" | "bonus" | "overtime" | "holidays";

interface OverviewProps {
    countryCode: string;
    onManage: (type: RuleType) => void;
}

interface Summary {
    tax: TaxBracketSet[];
    statutory: StatutoryDeduction[];
    leave: CountryLeaveDefault[];
    bonus: CountryBonusRule[];
    overtime: CountryOvertimeRule[];
    holidays: PublicHoliday[];
}

function activeOnly<T extends { superseded_by_id?: number | null }>(rows: T[]): T[] {
    return rows.filter((r) => r.superseded_by_id == null);
}

function fmtDate(s?: string | null): string {
    if (!s) return "—";
    try { return new Date(s).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
    catch { return s; }
}

export default function PayrollRulesOverview({ countryCode, onManage }: OverviewProps) {
    const [data, setData] = useState<Summary | null>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        const [tax, statutory, leave, bonus, overtime, holidays] = await Promise.all([
            payrollRules.listTaxBracketSets(countryCode),
            payrollRules.listStatutoryDeductions(countryCode),
            payrollRules.listLeaveDefaults(countryCode),
            payrollRules.listBonusRules(countryCode),
            payrollRules.listOvertimeRules(countryCode),
            payrollRules.listPublicHolidays(countryCode),
        ]);
        setData({
            tax: isError(tax) ? [] : tax,
            statutory: isError(statutory) ? [] : statutory,
            leave: isError(leave) ? [] : leave,
            bonus: isError(bonus) ? [] : bonus,
            overtime: isError(overtime) ? [] : overtime,
            holidays: isError(holidays) ? [] : holidays,
        });
        setLoading(false);
    }, [countryCode]);

    useEffect(() => { load(); }, [load]);

    if (loading || !data) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 h-44 animate-pulse" />
                ))}
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <TaxCard rows={data.tax} onManage={() => onManage("tax")} />
            <StatutoryCard rows={data.statutory} countryCode={countryCode} onManage={() => onManage("statutory")} />
            <LeaveCard rows={data.leave} onManage={() => onManage("leave")} />
            <BonusCard rows={data.bonus} countryCode={countryCode} onManage={() => onManage("bonus")} />
            <OvertimeCard rows={data.overtime} onManage={() => onManage("overtime")} />
            <HolidaysCard rows={data.holidays} onManage={() => onManage("holidays")} />
        </div>
    );
}

function Card({
    icon, title, blurb, status, body, onManage, manageLabel,
}: {
    icon: React.ReactNode;
    title: string;
    blurb: string;
    status: { tone: "ok" | "warn"; label: string };
    body: React.ReactNode;
    onManage: () => void;
    manageLabel: string;
}) {
    const toneClasses = status.tone === "ok"
        ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30"
        : "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30";
    return (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 flex flex-col">
            <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-700 dark:text-zinc-300">
                        {icon}
                    </div>
                    <div>
                        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">{blurb}</p>
                    </div>
                </div>
                <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full border ${toneClasses}`}>
                    {status.tone === "ok" ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                    {status.label}
                </span>
            </div>
            <div className="text-sm text-zinc-700 dark:text-zinc-300 mb-4 flex-1">{body}</div>
            <button
                type="button"
                onClick={onManage}
                className="inline-flex items-center justify-center gap-1.5 self-start rounded-md bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white px-4 py-2 text-sm font-medium"
            >
                {manageLabel}
                <ArrowRight className="h-4 w-4" />
            </button>
        </div>
    );
}

function TaxCard({ rows, onManage }: { rows: TaxBracketSet[]; onManage: () => void }) {
    const active = activeOnly(rows);
    const byYear = new Map<number, TaxBracketSet>();
    for (const r of active) {
        const prev = byYear.get(r.fiscal_year);
        if (!prev || r.version > prev.version) byYear.set(r.fiscal_year, r);
    }
    const years = Array.from(byYear.keys()).sort((a, b) => b - a);
    const latest = years.length > 0 ? byYear.get(years[0])! : null;

    if (!latest) {
        return (
            <Card
                icon={<Percent className="h-5 w-5" />}
                title="Tax brackets"
                blurb="Progressive PAYE bands per fiscal year"
                status={{ tone: "warn", label: "Not configured" }}
                body={<p>No tax brackets on file. Add a fiscal-year bracket set so the engine can compute PAYE.</p>}
                onManage={onManage}
                manageLabel="Set up tax brackets"
            />
        );
    }
    const rates = latest.brackets.map((b) => Number(b.rate)).filter((r) => !Number.isNaN(r));
    const maxPct = rates.length ? Math.max(...rates) : 0;
    return (
        <Card
            icon={<Percent className="h-5 w-5" />}
            title="Tax brackets"
            blurb="Progressive PAYE bands per fiscal year"
            status={{ tone: "ok", label: `FY ${latest.fiscal_year}` }}
            body={
                <div className="space-y-1">
                    <p><span className="font-medium text-zinc-900 dark:text-zinc-100">v{latest.version}</span> · effective {fmtDate(latest.effective_from)}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {latest.brackets.length} band{latest.brackets.length === 1 ? "" : "s"} · top rate {(maxPct * 100).toFixed(0)}%
                    </p>
                </div>
            }
            onManage={onManage}
            manageLabel="Manage"
        />
    );
}

function StatutoryCard({ rows, countryCode, onManage }: { rows: StatutoryDeduction[]; countryCode: string; onManage: () => void }) {
    const active = activeOnly(rows);
    const codes = Array.from(new Set(active.map((r) => r.code))).sort();

    if (codes.length === 0) {
        const suggestion = countryCode === "MU"
            ? "Suggested codes: NPF, CSG_EE / CSG_ER, NSF_EE / NSF_ER."
            : "Add the deduction codes your regulator requires.";
        return (
            <Card
                icon={<Wallet className="h-5 w-5" />}
                title="Statutory deductions"
                blurb="Social contributions deducted from pay"
                status={{ tone: "warn", label: "Not configured" }}
                body={<p>No deduction codes yet. {suggestion}</p>}
                onManage={onManage}
                manageLabel="Set up deductions"
            />
        );
    }
    return (
        <Card
            icon={<Wallet className="h-5 w-5" />}
            title="Statutory deductions"
            blurb="Social contributions deducted from pay"
            status={{ tone: "ok", label: `${codes.length} active` }}
            body={
                <div className="space-y-1">
                    <p className="font-medium text-zinc-900 dark:text-zinc-100">{codes.slice(0, 4).join(" · ")}{codes.length > 4 ? ` +${codes.length - 4}` : ""}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">{active.length} version{active.length === 1 ? "" : "s"} currently in effect</p>
                </div>
            }
            onManage={onManage}
            manageLabel="Manage"
        />
    );
}

function LeaveCard({ rows, onManage }: { rows: CountryLeaveDefault[]; onManage: () => void }) {
    const active = activeOnly(rows);
    const codes = Array.from(new Set(active.map((r) => r.leave_type_code))).sort();

    if (codes.length === 0) {
        return (
            <Card
                icon={<CalendarDays className="h-5 w-5" />}
                title="Leave defaults"
                blurb="Per-country accrual rules per leave type"
                status={{ tone: "warn", label: "Not configured" }}
                body={<p>No leave defaults yet. Add at least annual + sick so accruals start computing.</p>}
                onManage={onManage}
                manageLabel="Set up leave"
            />
        );
    }
    return (
        <Card
            icon={<CalendarDays className="h-5 w-5" />}
            title="Leave defaults"
            blurb="Per-country accrual rules per leave type"
            status={{ tone: "ok", label: `${codes.length} type${codes.length === 1 ? "" : "s"}` }}
            body={
                <div className="space-y-1">
                    <p className="font-medium text-zinc-900 dark:text-zinc-100 capitalize">{codes.slice(0, 4).join(" · ")}{codes.length > 4 ? ` +${codes.length - 4}` : ""}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">{active.length} current default{active.length === 1 ? "" : "s"}</p>
                </div>
            }
            onManage={onManage}
            manageLabel="Manage"
        />
    );
}

function OvertimeCard({ rows, onManage }: { rows: CountryOvertimeRule[]; onManage: () => void }) {
    const active = activeOnly(rows);
    const byVersion = [...active].sort((a, b) => b.version - a.version);
    const latest = byVersion[0] ?? null;

    if (!latest) {
        return (
            <Card
                icon={<Timer className="h-5 w-5" />}
                title="Overtime & premiums"
                blurb="OT, rest-day, holiday & night pay rules"
                status={{ tone: "warn", label: "Not configured" }}
                body={<p>No overtime rule on file. Payroll runs for this country will fail until one is seeded.</p>}
                onManage={onManage}
                manageLabel="View overtime rules"
            />
        );
    }
    const wk = Number(latest.weekly_threshold_h);
    const restMult = Number(latest.rest_day_multiplier);
    return (
        <Card
            icon={<Timer className="h-5 w-5" />}
            title="Overtime & premiums"
            blurb="OT, rest-day, holiday & night pay rules"
            status={{ tone: "ok", label: `v${latest.version}` }}
            body={
                <div className="space-y-1">
                    <p className="font-medium text-zinc-900 dark:text-zinc-100">
                        {Number.isNaN(wk) ? latest.weekly_threshold_h : `${wk}h`}/week threshold · rest day {Number.isNaN(restMult) ? "—" : `${restMult}×`}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {latest.weekday_tiers.length} weekday OT tier{latest.weekday_tiers.length === 1 ? "" : "s"} · effective {fmtDate(latest.effective_from)}
                    </p>
                </div>
            }
            onManage={onManage}
            manageLabel="Manage"
        />
    );
}

function HolidaysCard({ rows, onManage }: { rows: PublicHoliday[]; onManage: () => void }) {
    const thisYear = new Date().getFullYear();
    const count = rows.length;

    if (count === 0) {
        return (
            <Card
                icon={<CalendarCheck className="h-5 w-5" />}
                title="Public holidays"
                blurb="Gazetted holiday calendar"
                status={{ tone: "warn", label: "Not configured" }}
                body={<p>No public holidays seeded for {thisYear}. Clock-ins on holidays won&apos;t get the holiday premium until these are added.</p>}
                onManage={onManage}
                manageLabel="View calendar"
            />
        );
    }
    const next = [...rows]
        .filter((h) => new Date(h.observed_date || h.date) >= new Date(new Date().toISOString().slice(0, 10)))
        .sort((a, b) => ((a.observed_date || a.date) < (b.observed_date || b.date) ? -1 : 1))[0];
    return (
        <Card
            icon={<CalendarCheck className="h-5 w-5" />}
            title="Public holidays"
            blurb="Gazetted holiday calendar"
            status={{ tone: "ok", label: `${count} in ${thisYear}` }}
            body={
                <div className="space-y-1">
                    {next ? (
                        <p className="font-medium text-zinc-900 dark:text-zinc-100">Next: {next.name} · {fmtDate(next.observed_date || next.date)}</p>
                    ) : (
                        <p className="font-medium text-zinc-900 dark:text-zinc-100">All {thisYear} holidays have passed</p>
                    )}
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">{count} holiday{count === 1 ? "" : "s"} on file this year</p>
                </div>
            }
            onManage={onManage}
            manageLabel="Manage"
        />
    );
}

function BonusCard({ rows, countryCode, onManage }: { rows: CountryBonusRule[]; countryCode: string; onManage: () => void }) {
    const active = activeOnly(rows);
    const codes = Array.from(new Set(active.map((r) => r.bonus_code))).sort();

    if (codes.length === 0) {
        const suggestion = countryCode === "MU"
            ? "Most Mauritius employers add EOY_GRATUITY (1/12 of annual earnings, paid December)."
            : "Add the year-end bonus formula your country requires.";
        return (
            <Card
                icon={<Gift className="h-5 w-5" />}
                title="Year-end bonus"
                blurb="13th-month / gratuity formula"
                status={{ tone: "warn", label: "Not configured" }}
                body={<p>{suggestion}</p>}
                onManage={onManage}
                manageLabel="Set up bonus"
            />
        );
    }
    return (
        <Card
            icon={<Gift className="h-5 w-5" />}
            title="Year-end bonus"
            blurb="13th-month / gratuity formula"
            status={{ tone: "ok", label: `${codes.length} rule${codes.length === 1 ? "" : "s"}` }}
            body={
                <div className="space-y-1">
                    <p className="font-medium text-zinc-900 dark:text-zinc-100">{codes.slice(0, 4).join(" · ")}{codes.length > 4 ? ` +${codes.length - 4}` : ""}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">{active.length} current rule{active.length === 1 ? "" : "s"}</p>
                </div>
            }
            onManage={onManage}
            manageLabel="Manage"
        />
    );
}
