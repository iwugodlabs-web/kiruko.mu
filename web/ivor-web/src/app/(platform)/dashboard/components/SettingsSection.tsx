"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import Link from "next/link";
import {
  Settings, Building2, Calendar, Bell, Shield,
  Save, CheckCircle, AlertCircle, Mail, Phone, MapPin, Hash, Users,
  FolderClosed, ChevronRight, GitBranch, Gift, Clock, UserX, AlertTriangle, Wallet,
} from "lucide-react";
import DashboardHeader from "@/components/ui/DashboardHeader";
import SolarisBackground from "@/components/ui/SolarisBackground";
import { api } from "@/services/apiClient";
import { deleteMyAccount, isApiError } from "@/services/api";

type CompanySettings = {
  company_name: string;
  brn: string;
  email: string;
  phone: string;
  address: string;
  annual_leave_budget: number;
  // kiosk v1.5 — company-wide fallback for the missed-clockout auto-close
  // chain (M27). Empty string = unset = falls through to the 12h system
  // default. Stored as string so the input can be cleared without it
  // snapping to 0.
  default_max_shift_hours: string;
  // Clock-driven payroll: when on, attendance drives pay (absences dock; only
  // approved clock-ins / confirmed OT / verified task pay feed the run).
  require_approved_clockins_for_payroll: boolean;
};

export default function SettingsSection() {
  const { user, companyBrn, logout, refreshUser } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const company = (user as any)?.company;

  const [activeTab, setActiveTab] = useState<"company" | "leave" | "payroll" | "account">("company");

  // Deep-link support: the sidebar's "Payroll" entry (and any other) lands here
  // with ?tab=<id> so it can open straight to that tab instead of "company".
  useEffect(() => {
    const t = searchParams.get("tab");
    if (t && ["company", "leave", "payroll", "account"].includes(t)) {
      setActiveTab(t as typeof activeTab);
    }
  }, [searchParams]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Account deletion (danger zone). Gated behind typing the exact phrase so it
  // can't be triggered by a stray click.
  const DELETE_PHRASE = "DELETE MY ACCOUNT";
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  const handleDeleteAccount = async () => {
    if (deleteConfirm.trim() !== DELETE_PHRASE) return;
    setDeleting(true);
    setDeleteErr(null);
    const res = await deleteMyAccount();
    if (isApiError(res)) {
      setDeleteErr(res.error);
      setDeleting(false);
      return;
    }
    // Success — the account is gone. Clear the session and bounce to login.
    try { await logout(); } catch { /* best-effort; account already deleted */ }
    router.replace("/login");
  };

  const [companySettings, setCompanySettings] = useState<CompanySettings>({
    company_name: "", brn: "", email: "", phone: "", address: "", annual_leave_budget: 21,
    default_max_shift_hours: "",
    require_approved_clockins_for_payroll: false,
  });


  useEffect(() => {
    if (company) {
      setCompanySettings({
        company_name: company.company_name || "",
        brn: company.brn || companyBrn || "",
        email: company.email || "",
        phone: company.phone || "",
        address: company.address || "",
        annual_leave_budget: company.annual_leave_budget || 21,
        default_max_shift_hours:
          company.default_max_shift_hours != null ? String(company.default_max_shift_hours) : "",
        require_approved_clockins_for_payroll: company.require_approved_clockins_for_payroll ?? false,
      });
    }
  }, [company, companyBrn]);

  const handleSave = async () => {
    setLoading(true); setError(null); setSuccess(null);
    try {
      // The backend route is PUT /company/{id} (see api/v1/company.py:219).
      // The previous code used api.patch which 405'd silently — fixed as part
      // of the kiosk v1.5 polish since we needed to add a field anyway.
      const maxShiftRaw = companySettings.default_max_shift_hours.trim();
      const maxShiftValue = maxShiftRaw === "" ? null : Number(maxShiftRaw);
      if (maxShiftValue !== null && !Number.isFinite(maxShiftValue)) {
        setError("Max shift hours must be a number");
        setLoading(false);
        return;
      }
      await api.put(`/company/${company?.company_id}`, {
        company_name: companySettings.company_name,
        email: companySettings.email,
        phone: companySettings.phone,
        address: companySettings.address,
        annual_leave_budget: companySettings.annual_leave_budget,
        default_max_shift_hours: maxShiftValue,
        require_approved_clockins_for_payroll: companySettings.require_approved_clockins_for_payroll,
      });
      setSuccess("Company settings saved successfully!");
      // Refresh the cached user/company so edited fields (e.g. the clock-driven
      // toggle) reflect what was just saved instead of the stale login snapshot.
      await refreshUser();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to save settings");
    } finally { setLoading(false); }
  };

  const tabs = [
    { id: "company" as const, label: "Company Profile", icon: Building2 },
    { id: "leave" as const, label: "Leave Settings", icon: Calendar },
    { id: "payroll" as const, label: "Payroll", icon: Wallet },
  ];

  // Link-based navigation items (open sub-pages)
  const linkItems = [
    { label: "Departments", icon: FolderClosed, href: "/dashboard/settings/departments", description: "Create and manage departments" },
    { label: "Roles & Permissions", icon: Shield, href: "/dashboard/settings/permissions", description: "Custom roles and access control" },
    { label: "Holiday Pay Rates", icon: Gift, href: "/dashboard/settings/holidays", description: "Configure public holidays and pay multipliers" },
    { label: "Organisation Chart", icon: GitBranch, href: "/dashboard/settings/organization", description: "Visual company hierarchy" },
    { label: "Geofencing", icon: MapPin, href: "/dashboard/settings/geofencing", description: "Sites, clock-in perimeters and branch assignment" },
    { label: "In-App & Push Alerts", icon: Bell, href: "/dashboard/settings/notification-preferences", description: "Per-category in-app and push toggles" },
  ];

  const inputCls =
    "w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm " +
    "text-gray-900 dark:text-white bg-white dark:bg-gray-800 " +
    "placeholder-gray-400 dark:placeholder-gray-500 " +
    "focus:outline-none focus:border-gray-400 dark:focus:border-gray-500 transition-colors";

  const saveBtnCls =
    "flex items-center gap-2 px-4 py-2.5 bg-gray-900 dark:bg-white " +
    "hover:bg-gray-800 dark:hover:bg-gray-100 text-white dark:text-gray-900 " +
    "text-sm font-medium rounded-lg transition-colors disabled:opacity-50";

  const spinner = (
    <div className="w-4 h-4 border-2 border-white/30 dark:border-gray-900/30 border-t-white dark:border-t-gray-900 rounded-full animate-spin" />
  );

  return (
    <SolarisBackground>
      <div className="w-full max-w-7xl mx-auto py-8 px-6 space-y-6">
        <DashboardHeader title="Settings" subtitle="Manage your company profile, leave policies, and notification preferences." icon={Settings} />

        {(success || error) && (
          <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-medium animate-in slide-in-from-top-2 duration-300 ${
            success
              ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-100 dark:border-emerald-900 text-emerald-700 dark:text-emerald-400"
              : "bg-red-50 dark:bg-red-950/40 border-red-100 dark:border-red-900 text-red-700 dark:text-red-400"
          }`}>
            {success ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
            {success || error}
          </div>
        )}

        <div className="flex flex-col lg:flex-row gap-6">
          {/* Sidebar */}
          <div className="w-full lg:w-56 shrink-0">
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-1.5 sticky top-8">
              <nav className="space-y-0.5">
                {tabs.map((tab) => (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-all text-sm font-medium ${
                      activeTab === tab.id
                        ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900"
                        : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white"
                    }`}>
                    <tab.icon size={16} className={activeTab === tab.id ? "text-white dark:text-gray-900" : "text-gray-400 dark:text-gray-500"} />
                    {tab.label}
                  </button>
                ))}
                <div className="h-px bg-gray-100 dark:bg-gray-800 my-1" />
                {linkItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-all text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white"
                  >
                    <item.icon size={16} className="text-gray-400 dark:text-gray-500 shrink-0" />
                    <span className="flex-1">{item.label}</span>
                    <ChevronRight size={12} className="text-gray-300 dark:text-gray-600 shrink-0" />
                  </Link>
                ))}
                <div className="h-px bg-gray-100 dark:bg-gray-800 my-1" />
                <button
                  onClick={() => setActiveTab("account")}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-all text-sm font-medium ${
                    activeTab === "account"
                      ? "bg-red-600 text-white"
                      : "text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
                  }`}
                >
                  <UserX size={16} className={activeTab === "account" ? "text-white" : "text-red-500 dark:text-red-400"} />
                  Account
                </button>
              </nav>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">

            {/* Company Profile */}
            {activeTab === "company" && (
              <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 space-y-5">
                <div className="pb-4 border-b border-gray-100 dark:border-gray-800">
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Company Profile</h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Update your organisation&apos;s contact details and identity.</p>
                </div>
                <div className="grid gap-4">
                  {/* Company Name */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">Company Name</label>
                    <div className="relative">
                      <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" size={15} />
                      <input type="text" value={companySettings.company_name}
                        onChange={(e) => setCompanySettings(s => ({ ...s, company_name: e.target.value }))}
                        className={`${inputCls} pl-9`} placeholder="Legal entity name" />
                    </div>
                  </div>
                  {/* BRN */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                      BRN <span className="text-gray-400 dark:text-gray-500">(read-only)</span>
                    </label>
                    <div className="relative">
                      <Hash className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300 dark:text-gray-600" size={15} />
                      <input type="text" value={companySettings.brn} disabled
                        className="w-full pl-9 pr-4 py-2.5 border border-gray-100 dark:border-gray-700 rounded-lg text-sm text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-800/60 cursor-not-allowed" />
                    </div>
                  </div>
                  {/* Email */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">Email</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" size={15} />
                      <input type="email" value={companySettings.email}
                        onChange={(e) => setCompanySettings(s => ({ ...s, email: e.target.value }))}
                        className={`${inputCls} pl-9`} placeholder="company@example.com" />
                    </div>
                  </div>
                  {/* Phone */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">Phone</label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" size={15} />
                      <input type="tel" value={companySettings.phone}
                        onChange={(e) => setCompanySettings(s => ({ ...s, phone: e.target.value }))}
                        className={`${inputCls} pl-9`} placeholder="+230 123 4567" />
                    </div>
                  </div>
                  {/* Address */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">Address</label>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-3 text-gray-400 dark:text-gray-500" size={15} />
                      <textarea value={companySettings.address}
                        onChange={(e) => setCompanySettings(s => ({ ...s, address: e.target.value }))}
                        className={`${inputCls} pl-9 resize-none`} rows={3} placeholder="Physical address" />
                    </div>
                  </div>
                </div>
                <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
                  <button onClick={handleSave} disabled={loading} className={saveBtnCls}>
                    {loading ? spinner : <Save size={14} />}
                    {loading ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </div>
            )}

            {/* Leave Settings */}
            {activeTab === "leave" && (
              <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 space-y-5">
                <div className="pb-4 border-b border-gray-100 dark:border-gray-800">
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Leave Settings</h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Configure default leave policies for your company.</p>
                </div>
                <div className="p-5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl">
                  <div className="flex items-start gap-3 mb-4">
                    <div className="w-8 h-8 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg flex items-center justify-center shrink-0">
                      <Calendar className="text-gray-500 dark:text-gray-300" size={16} />
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-gray-900 dark:text-white">Annual Leave Budget</h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Default leave days per employee per year</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <input type="number" min={0} max={365} value={companySettings.annual_leave_budget}
                      onChange={(e) => setCompanySettings(s => ({ ...s, annual_leave_budget: parseInt(e.target.value) || 0 }))}
                      className="w-24 px-3 py-2.5 border border-gray-200 dark:border-gray-600 rounded-lg text-sm font-semibold text-gray-900 dark:text-white bg-white dark:bg-gray-700 text-center focus:outline-none focus:border-gray-400 dark:focus:border-gray-500 transition-colors tabular-nums" />
                    <span className="text-sm text-gray-500 dark:text-gray-400">days per cycle</span>
                  </div>
                </div>
                <div className="p-4 bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900 rounded-xl flex items-start gap-3">
                  <Shield className="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" size={16} />
                  <p className="text-xs text-blue-700 dark:text-blue-400">
                    Supported leave types: Annual, Sick, Personal, Maternity, Paternity, and Unpaid. These are built-in and cannot be modified.
                  </p>
                </div>
                <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
                  <button onClick={handleSave} disabled={loading} className={saveBtnCls}>
                    {loading ? spinner : <Save size={14} />}
                    {loading ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </div>
            )}

            {/* Payroll */}
            {activeTab === "payroll" && (
              <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 space-y-5">
                <div className="pb-4 border-b border-gray-100 dark:border-gray-800">
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Payroll Settings</h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">How payroll treats attendance and clock-ins.</p>
                </div>

                {/* Clock-driven payroll switch — turns attendance into the
                    source of truth for pay (absences dock; only approved
                    clock-ins / confirmed OT / verified task pay feed the run). */}
                <div className="p-5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg flex items-center justify-center shrink-0">
                        <Clock className="text-gray-500 dark:text-gray-300" size={16} />
                      </div>
                      <div>
                        <h3 className="text-sm font-medium text-gray-900 dark:text-white">Clock-driven payroll</h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 max-w-md">
                          When on, payroll follows attendance: scheduled days with no approved clock-in (and no leave) are deducted, and only approved clock-ins, confirmed overtime, and verified task pay feed the run. When off, salaries are paid in full regardless of the clock.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={companySettings.require_approved_clockins_for_payroll}
                      onClick={() => setCompanySettings(s => ({ ...s, require_approved_clockins_for_payroll: !s.require_approved_clockins_for_payroll }))}
                      className={`relative w-10 h-6 rounded-full transition-colors border-2 shrink-0 ${
                        companySettings.require_approved_clockins_for_payroll
                          ? "bg-gray-900 dark:bg-white border-gray-900 dark:border-white"
                          : "bg-gray-200 dark:bg-gray-600 border-gray-200 dark:border-gray-600"
                      }`}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full shadow-sm transition-all duration-200 ${
                        companySettings.require_approved_clockins_for_payroll ? "right-0.5 bg-white dark:bg-gray-900" : "left-0.5 bg-white dark:bg-gray-400"
                      }`} />
                    </button>
                  </div>
                  {companySettings.require_approved_clockins_for_payroll && (
                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-3 ml-11">
                      Make sure employee schedules and clock-ins are accurate before running payroll — absences will reduce pay.
                    </p>
                  )}
                </div>

                {/* Max-shift-hours auto-close cap — also an attendance/payroll setting. */}
                <div className="p-5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl">
                  <div className="flex items-start gap-3 mb-4">
                    <div className="w-8 h-8 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg flex items-center justify-center shrink-0">
                      <Clock className="text-gray-500 dark:text-gray-300" size={16} />
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-gray-900 dark:text-white">Max Shift Hours (Auto-Close Cap)</h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        How long a clock-in can run before the system closes it automatically (for employees who forget to clock out).
                        Per-employee or per-job overrides take precedence over this value.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="number" min={1} max={24} step={0.5}
                      value={companySettings.default_max_shift_hours}
                      placeholder="12"
                      onChange={(e) => setCompanySettings(s => ({ ...s, default_max_shift_hours: e.target.value }))}
                      className="w-24 px-3 py-2.5 border border-gray-200 dark:border-gray-600 rounded-lg text-sm font-semibold text-gray-900 dark:text-white bg-white dark:bg-gray-700 text-center focus:outline-none focus:border-gray-400 dark:focus:border-gray-500 transition-colors tabular-nums"
                    />
                    <span className="text-sm text-gray-500 dark:text-gray-400">hours per shift</span>
                    <span className="text-xs text-gray-400 dark:text-gray-500 ml-2">
                      (leave blank to use the default of 12 hours)
                    </span>
                  </div>
                </div>

                <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
                  <button onClick={handleSave} disabled={loading} className={saveBtnCls}>
                    {loading ? spinner : <Save size={14} />}
                    {loading ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </div>
            )}

            {/* Account — danger zone (self-service deletion) */}
            {activeTab === "account" && (
              <div className="bg-white dark:bg-gray-900 border border-red-200 dark:border-red-900 rounded-xl p-6 space-y-5">
                <div className="pb-4 border-b border-gray-100 dark:border-gray-800">
                  <h2 className="text-sm font-semibold text-red-700 dark:text-red-400 flex items-center gap-2">
                    <AlertTriangle size={16} /> Delete account
                  </h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Permanently delete your Kiruko account. This cannot be undone.
                  </p>
                </div>

                <div className="p-4 bg-red-50 dark:bg-red-950/40 border border-red-100 dark:border-red-900 rounded-xl space-y-2">
                  <p className="text-xs font-medium text-red-700 dark:text-red-400">What happens when you delete:</p>
                  <ul className="text-xs text-red-700/90 dark:text-red-400/90 space-y-1 list-disc pl-4">
                    <li>Your login is disabled immediately and your personal details are erased.</li>
                    <li>Uploaded documents and receipt images are permanently removed.</li>
                    <li>Employment, payroll and audit records your employer must keep by law are retained, but de-identified — they no longer point to you.</li>
                  </ul>
                  <p className="text-xs text-red-700/90 dark:text-red-400/90 pt-1">
                    If you own a company that still has other members, transfer ownership or remove your team first — otherwise deletion is blocked so no one is left stranded.
                  </p>
                </div>

                {deleteErr && (
                  <div className="flex items-start gap-2 px-4 py-3 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-sm text-red-700 dark:text-red-400">
                    <AlertCircle size={16} className="shrink-0 mt-0.5" />
                    <span>{deleteErr}</span>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                    Type <span className="font-mono font-semibold text-red-600 dark:text-red-400">{DELETE_PHRASE}</span> to confirm
                  </label>
                  <input
                    value={deleteConfirm}
                    onChange={(e) => setDeleteConfirm(e.target.value)}
                    placeholder={DELETE_PHRASE}
                    className={inputCls}
                    autoComplete="off"
                  />
                </div>

                <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
                  <button
                    onClick={handleDeleteAccount}
                    disabled={deleting || deleteConfirm.trim() !== DELETE_PHRASE}
                    className="flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {deleting ? spinner : <UserX size={14} />}
                    {deleting ? "Deleting..." : "Delete my account permanently"}
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </SolarisBackground>
  );
}
