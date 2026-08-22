import React, { useEffect, useState } from 'react';
import { ArrowLeft, Building2, FileText, Mail, Phone, MapPin, Users, DollarSign, Calendar, CheckCircle, Clock, Edit2, Save, X, Loader2, Tablet, ChevronRight, Globe } from 'lucide-react';
import Link from 'next/link';
import MetricCard from '@/components/ui/MetricCard';
import {
    CompanySummary,
    Company,
    getCompanyStats,
    CompanyStats,
    getCompanyPayrolls,
    updateCompanyPayrolls,
    updateCompany,
    CompanyMonthlyPayroll
} from "@/services/api";
import { countryLabel, currencyForCountry } from "@/utils/countryDisplay";

export default function CompanyDetails({
    company,
    onBack,
    canEdit = false,
    onUpdate
}: {
    company: Company;
    onBack: () => void;
    canEdit?: boolean;
    onUpdate: (updated: Company) => void;
}) {
    const [stats, setStats] = useState<CompanyStats | null>(null);
    const [loading, setLoading] = useState(true);

    // This EMPLOYER's currency (admin is viewing another company) — from the
    // company's own currency, else derived from its country, else the MUR symbol.
    const ccy =
        (company as { currency?: string }).currency ||
        currencyForCountry((company as { country_code?: string }).country_code) ||
        "Rs";

    // Inline company-info editing
    const [editingInfo, setEditingInfo] = useState(false);
    const [savingInfo, setSavingInfo] = useState(false);
    const [infoForm, setInfoForm] = useState({
        company_name: company.company_name || '',
        brn: company.brn || '',
        email: company.email || '',
        phone: company.phone || '',
        address: company.address || '',
    });

    // Financials State
    const [payrolls, setPayrolls] = useState<Record<number, number>>({}); // Month -> Amount
    const [loadingFinancials, setLoadingFinancials] = useState(false);
    const [savingFinancials, setSavingFinancials] = useState(false);

    // Annual Leave Budget Editing
    const [leaveBudget, setLeaveBudget] = useState<number>(company.annual_leave_budget || 0);
    const [origLeaveBudget, setOrigLeaveBudget] = useState<number>(company.annual_leave_budget || 0);
    const [editingBudget, setEditingBudget] = useState(false);
    const [savingBudget, setSavingBudget] = useState(false);

    const currentYear = new Date().getFullYear();
    const months = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];

    useEffect(() => {
        const loadData = async () => {
            setLoading(true);
            try {
                const [s, p] = await Promise.all([
                    getCompanyStats(company.company_id),
                    getCompanyPayrolls(company.company_id, currentYear)
                ]);

                if (!(s as any).error) setStats(s as CompanyStats);

                if (Array.isArray(p)) {
                    const pMap: Record<number, number> = {};
                    p.forEach((r: CompanyMonthlyPayroll) => {
                        pMap[r.month] = Number(r.total_amount);
                    });
                    setPayrolls(pMap);
                }
            } catch (error) {
                console.error("Failed to load company data", error);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, [company.company_id, currentYear]);

    const handlePayrollChange = (monthIndex: number, val: string) => {
        const num = parseFloat(val);
        setPayrolls(prev => ({
            ...prev,
            [monthIndex + 1]: isNaN(num) ? 0 : num
        }));
    };

    const saveFinancials = async () => {
        setSavingFinancials(true);
        try {
            const payload = Object.entries(payrolls).map(([m, amt]) => ({
                month: parseInt(m),
                amount: amt
            }));

            await updateCompanyPayrolls(company.company_id, currentYear, payload);
            alert('Financial records updated successfully.');

            const s = await getCompanyStats(company.company_id);
            if (!(s as any).error) setStats(s as CompanyStats);
        } catch (e) {
            console.error(e);
            alert('Failed to save financials.');
        } finally {
            setSavingFinancials(false);
        }
    };

    const startEditInfo = () => {
        setInfoForm({
            company_name: company.company_name || '',
            brn: company.brn || '',
            email: company.email || '',
            phone: company.phone || '',
            address: company.address || '',
        });
        setEditingInfo(true);
    };

    const brnChanged = editingInfo && infoForm.brn.trim() !== (company.brn || '');

    const saveInfo = async () => {
        // Changing the BRN re-points the company to a different legal/tax
        // entity — a fraud vector. Require explicit confirmation; the backend
        // writes an audit row recording old→new BRN and the actor.
        if (brnChanged) {
            const ok = confirm(
                `You are changing the Business Registration Number from "${company.brn || '—'}" to "${infoForm.brn.trim()}".\n\n` +
                `The BRN is the company's legal/tax identity. This change is logged in the audit trail with your account. Continue?`
            );
            if (!ok) return;
        }
        setSavingInfo(true);
        try {
            const res = await updateCompany(company.company_id, { ...infoForm, brn: infoForm.brn.trim() });
            if ((res as any).error) throw new Error((res as any).error);
            onUpdate({ ...company, ...infoForm, brn: infoForm.brn.trim() } as Company);
            setEditingInfo(false);
        } catch (e: any) {
            console.error(e);
            alert(e?.message || 'Failed to update company details.');
        } finally {
            setSavingInfo(false);
        }
    };

    const saveLeaveBudget = async () => {
        setSavingBudget(true);
        try {
            const res = await updateCompany(company.company_id, { annual_leave_budget: leaveBudget });
            if ((res as any).error) throw new Error((res as any).error);
            setOrigLeaveBudget(leaveBudget);
            setEditingBudget(false);

            const s = await getCompanyStats(company.company_id);
            if (!(s as any).error) setStats(s as CompanyStats);
        } catch (e) {
            console.error(e);
            alert('Failed to update leave budget.');
        } finally {
            setSavingBudget(false);
        }
    };

    return (
        <div className="w-full h-full flex flex-col space-y-8 animate-in fade-in duration-700 pb-20">
            {/* Header / Back Button */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onBack}
                        className="p-3 bg-white dark:bg-gray-900 rounded-xl shadow-sm hover:bg-slate-50 dark:hover:bg-gray-800 transition-colors border border-slate-200 dark:border-gray-700"
                    >
                        <ArrowLeft size={18} className="text-slate-600 dark:text-gray-400" />
                    </button>
                    <div>
                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1.5">Entity Snapshot • ID: {company.company_id}</div>
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white uppercase tracking-tight leading-none">{company.company_name}</h2>
                    </div>
                </div>
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Left Column: Company Info */}
                <div className="lg:col-span-1 space-y-4">
                    <div className="bg-white dark:bg-gray-900 rounded-3xl border border-slate-200 dark:border-gray-800 p-8 shadow-sm">
                        <div className="flex items-center justify-between mb-8">
                            <div className="flex items-center gap-4">
                                <div className="w-14 h-14 rounded-xl bg-slate-900 flex items-center justify-center text-white shadow-sm">
                                    <Building2 size={24} strokeWidth={1.5} />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-slate-900 dark:text-white uppercase tracking-tight leading-none">Information</h3>
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1.5">Core business details</p>
                                </div>
                            </div>
                            {canEdit && (
                                !editingInfo ? (
                                    <button
                                        onClick={startEditInfo}
                                        className="p-2.5 text-slate-400 hover:text-red-600 hover:bg-slate-50 rounded-lg transition-all"
                                        title="Edit details"
                                    >
                                        <Edit2 size={16} />
                                    </button>
                                ) : (
                                    <div className="flex items-center gap-1.5">
                                        <button
                                            onClick={saveInfo}
                                            disabled={savingInfo}
                                            className="p-2.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                                            title="Save"
                                        >
                                            {savingInfo ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                        </button>
                                        <button
                                            onClick={() => setEditingInfo(false)}
                                            className="p-2.5 text-red-600 hover:bg-red-50 rounded-lg transition-all"
                                            title="Cancel"
                                        >
                                            <X size={16} />
                                        </button>
                                    </div>
                                )
                            )}
                        </div>

                        <div className="space-y-4">
                            {editingInfo && (
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Entity Name</label>
                                    <div className="flex items-center gap-3 p-3 bg-white dark:bg-gray-800 rounded-xl border border-slate-200 dark:border-gray-700">
                                        <Building2 size={16} className="text-slate-400" />
                                        <input
                                            value={infoForm.company_name}
                                            onChange={(e) => setInfoForm({ ...infoForm, company_name: e.target.value })}
                                            className="w-full bg-transparent text-sm font-bold text-slate-900 dark:text-white focus:outline-none"
                                        />
                                    </div>
                                </div>
                            )}

                            <div className="group">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">BRN Protocol</label>
                                <div className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${editingInfo ? 'bg-white dark:bg-gray-800 border-amber-300' : 'bg-slate-50 dark:bg-gray-800 border-slate-100 dark:border-gray-700 group-hover:border-slate-200'}`}>
                                    <FileText size={16} className="text-slate-400" />
                                    {editingInfo ? (
                                        <input
                                            value={infoForm.brn}
                                            onChange={(e) => setInfoForm({ ...infoForm, brn: e.target.value })}
                                            className="w-full bg-transparent font-mono font-bold text-slate-900 dark:text-white text-sm tracking-tight focus:outline-none"
                                        />
                                    ) : (
                                        <>
                                            <span className="font-mono font-bold text-slate-700 dark:text-gray-300 text-sm tracking-tight">{company.brn || "N/A"}</span>
                                            <span className="ml-auto text-[8px] font-black bg-slate-200 dark:bg-gray-700 text-slate-500 dark:text-gray-400 px-2 py-0.5 rounded uppercase">Legal ID</span>
                                        </>
                                    )}
                                </div>
                                {brnChanged && (
                                    <p className="mt-1.5 text-[10px] font-bold text-amber-600 uppercase tracking-tight leading-relaxed">
                                        ⚠ Changing the BRN re-points this company's legal/tax identity. This is logged to the audit trail.
                                    </p>
                                )}
                            </div>

                            <div>
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Contact Email</label>
                                <div className="flex items-center gap-3 p-3 bg-white dark:bg-gray-800 rounded-xl border border-slate-200 dark:border-gray-700">
                                    <Mail size={16} className="text-slate-400" />
                                    {editingInfo ? (
                                        <input
                                            type="email"
                                            value={infoForm.email}
                                            onChange={(e) => setInfoForm({ ...infoForm, email: e.target.value })}
                                            className="w-full bg-transparent text-sm font-bold text-slate-900 dark:text-white focus:outline-none"
                                        />
                                    ) : (
                                        <span className="text-sm font-bold text-slate-900 dark:text-white">{company.email || "—"}</span>
                                    )}
                                </div>
                            </div>

                            <div>
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Phone Link</label>
                                <div className="flex items-center gap-3 p-3 bg-white dark:bg-gray-800 rounded-xl border border-slate-200 dark:border-gray-700">
                                    <Phone size={16} className="text-slate-400" />
                                    {editingInfo ? (
                                        <input
                                            value={infoForm.phone}
                                            onChange={(e) => setInfoForm({ ...infoForm, phone: e.target.value })}
                                            className="w-full bg-transparent text-sm font-bold text-slate-900 dark:text-white focus:outline-none"
                                        />
                                    ) : (
                                        <span className="text-sm font-bold text-slate-900 dark:text-white">{company.phone || "—"}</span>
                                    )}
                                </div>
                            </div>

                            <div>
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Geolocation</label>
                                <div className="flex items-center gap-3 p-3 bg-white dark:bg-gray-800 rounded-xl border border-slate-200 dark:border-gray-700">
                                    <MapPin size={16} className="text-slate-400" />
                                    {editingInfo ? (
                                        <input
                                            value={infoForm.address}
                                            onChange={(e) => setInfoForm({ ...infoForm, address: e.target.value })}
                                            className="w-full bg-transparent text-sm font-bold text-slate-900 dark:text-white focus:outline-none"
                                        />
                                    ) : (
                                        <span className="text-sm font-bold text-slate-900 dark:text-white leading-tight">{company.address || "—"}</span>
                                    )}
                                </div>
                            </div>

                            <div>
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Country</label>
                                <div className="flex items-center gap-3 p-3 bg-white dark:bg-gray-800 rounded-xl border border-slate-200 dark:border-gray-700">
                                    <Globe size={16} className="text-slate-400" />
                                    <span className="text-sm font-bold text-slate-900 dark:text-white" title="Set at company creation, not editable — changing it would corrupt fiscal-year-keyed payroll history.">
                                        {(company as { country_code?: string }).country_code
                                          ? countryLabel((company as { country_code?: string }).country_code as string)
                                          : "—"}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Annual Leave Budget Card */}
                    <div className="bg-white dark:bg-gray-900 rounded-3xl border border-slate-200 dark:border-gray-800 p-8 shadow-sm">
                        <div className="flex items-center justify-between mb-6">
                            <div>
                                <h4 className="text-lg font-bold text-slate-900 dark:text-white uppercase tracking-tight">Total Leaves</h4>
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Annual Company Budget</p>
                            </div>
                            {!editingBudget ? (
                                <button
                                    onClick={() => setEditingBudget(true)}
                                    className="p-2.5 text-slate-400 hover:text-red-600 hover:bg-slate-50 rounded-lg transition-all"
                                >
                                    <Edit2 size={16} />
                                </button>
                            ) : (
                                <div className="flex items-center gap-1.5">
                                    <button
                                        onClick={saveLeaveBudget}
                                        disabled={savingBudget}
                                        className="p-2.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                                    >
                                        {savingBudget ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                    </button>
                                    <button
                                        onClick={() => { setEditingBudget(false); setLeaveBudget(origLeaveBudget); }}
                                        className="p-2.5 text-red-600 hover:bg-red-50 rounded-lg transition-all"
                                    >
                                        <X size={16} />
                                    </button>
                                </div>
                            )}
                        </div>

                        {editingBudget ? (
                            <input
                                type="number"
                                value={leaveBudget}
                                onChange={(e) => setLeaveBudget(parseInt(e.target.value) || 0)}
                                className="w-full text-3xl font-black text-slate-900 dark:text-white bg-slate-50 dark:bg-gray-800 rounded-xl p-3 border border-slate-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-red-600/5 transition-all"
                            />
                        ) : (
                            <p className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter">{origLeaveBudget > 0 ? origLeaveBudget : '20'} <span className="text-sm font-black text-slate-400 uppercase tracking-widest">/ emp</span></p>
                        )}
                        <div className="mt-4 flex items-center gap-2">
                            <div className="w-1 h-1 rounded-full bg-slate-200" />
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tight leading-relaxed">
                                {origLeaveBudget > 0
                                    ? "Manually configured entitlement per employee."
                                    : "Default system calculation (20 days)."}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Right Column: Stats & Financials */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Aggregated Metrics */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* Workforce breakdown card */}
                        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5">
                            <div className="flex items-start justify-between mb-4">
                                <div className="w-9 h-9 bg-blue-50 dark:bg-blue-950/40 rounded-lg flex items-center justify-center shrink-0">
                                    <Users className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                                </div>
                            </div>
                            <div>
                                {loading ? (
                                    <div className="h-7 w-32 bg-gray-100 dark:bg-gray-800 animate-pulse rounded mb-1.5" />
                                ) : (
                                    <div className="flex items-baseline gap-1.5 flex-wrap">
                                        <span className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{stats?.employee_count ?? 0}</span>
                                        <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">emp</span>
                                        <span className="text-gray-300 dark:text-gray-600 text-lg font-light mx-0.5">+</span>
                                        <span className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{stats?.admin_count ?? 0}</span>
                                        <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">admin</span>
                                    </div>
                                )}
                                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Workforce</p>
                                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Employees · Admins &amp; Managers</p>
                            </div>
                        </div>
                        <MetricCard
                            title="Monthly Payroll"
                            value={loading ? "..." : `${ccy} ${(stats?.total_salary_per_month ?? 0).toLocaleString()}`}
                            icon={DollarSign}
                            color="red"
                            subtitle="Est. total disbursements"
                        />
                        <MetricCard
                            title="Leave Liability"
                            value={loading ? "..." : String(stats?.total_leaves_entitled ?? 0)}
                            icon={Calendar}
                            color="amber"
                            subtitle="Total entitled nodes"
                        />
                    </div>

                    {/* Operational Status */}
                    <div className="bg-white dark:bg-gray-900 rounded-3xl border border-slate-200 dark:border-gray-800 p-8 shadow-sm">
                        <h4 className="text-lg font-bold text-slate-900 dark:text-white uppercase tracking-tight mb-6">Operational Overview</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="flex items-center gap-4 p-5 rounded-2xl bg-red-50/50 border border-red-100">
                                <div className="w-12 h-12 bg-white dark:bg-gray-900 rounded-xl flex items-center justify-center text-red-600 shadow-sm border border-red-100">
                                    <CheckCircle size={24} strokeWidth={1.5} />
                                </div>
                                <div>
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1.5">Compliance</p>
                                    <p className="text-sm font-bold text-slate-900 dark:text-white">Active & Verified</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-4 p-5 rounded-2xl bg-slate-50 dark:bg-gray-800 border border-slate-200 dark:border-gray-700">
                                <div className="w-12 h-12 bg-white dark:bg-gray-900 rounded-xl flex items-center justify-center text-slate-400 shadow-sm border border-slate-200 dark:border-gray-700">
                                    <Clock size={24} strokeWidth={1.5} />
                                </div>
                                <div>
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1.5">Last Pulse</p>
                                    <p className="text-sm font-bold text-slate-900 dark:text-white">Synchronized</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* kiosk v1.6 polish — entry point to manage this company's
                        registered kiosk tablets. Routes to /admin/kiosks with
                        the company pre-selected via the ?company_id= query
                        param the list page reads on mount. */}
                    <Link
                        href={`/admin/kiosks?company_id=${company.company_id}`}
                        className="bg-white dark:bg-gray-900 rounded-3xl border border-slate-200 dark:border-gray-800 p-6 shadow-sm hover:border-slate-900 dark:hover:border-white transition-colors flex items-center gap-4 group"
                    >
                        <div className="w-12 h-12 bg-slate-900 text-white rounded-xl flex items-center justify-center flex-shrink-0">
                            <Tablet size={22} strokeWidth={1.5} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1.5">Kiosk Devices</p>
                            <p className="text-sm font-bold text-slate-900 dark:text-white">Register + manage tablets for entrance clock-in</p>
                        </div>
                        <ChevronRight size={18} className="text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white transition-colors flex-shrink-0" />
                    </Link>

                    {/* Financials / Monthly Payroll Grid */}
                    <div className="bg-white dark:bg-gray-900 rounded-3xl border border-slate-200 dark:border-gray-800 p-8 shadow-sm relative">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                            <div>
                                <h4 className="text-lg font-bold text-slate-900 dark:text-white uppercase tracking-tight">Monthly Payroll ({currentYear})</h4>
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Record total payroll distribution per month</p>
                            </div>
                            <button
                                onClick={saveFinancials}
                                disabled={savingFinancials || loading}
                                className="px-6 py-2.5 bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all flex items-center justify-center gap-2"
                            >
                                {savingFinancials ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                                Save Ledger
                            </button>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {months.map((m, idx) => (
                                <div key={m} className={`p-4 rounded-2xl border transition-all ${idx === new Date().getMonth() ? 'bg-red-50/30 border-red-200 ring-4 ring-red-600/5' : 'bg-white dark:bg-gray-800 border-slate-100 dark:border-gray-700 hover:border-slate-200'}`}>
                                    <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1.5 block">{m}</label>
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-slate-300 font-bold text-sm">{ccy}</span>
                                        <input
                                            type="number"
                                            value={payrolls[idx + 1] || ''}
                                            onChange={(e) => handlePayrollChange(idx, e.target.value)}
                                            placeholder="0"
                                            className="w-full bg-transparent font-bold text-slate-900 dark:text-white focus:outline-none text-sm"
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="mt-6 p-5 bg-slate-50 dark:bg-gray-800 rounded-2xl border border-slate-200 dark:border-gray-700 flex items-start gap-3">
                            <CheckCircle size={16} className="text-red-600 mt-0.5" />
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tight leading-relaxed">
                                Record executed payroll totals. The current month ({months[new Date().getMonth()]}) is highlighted. Data is used for aggregation and financial reporting.
                            </p>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
}
