"use client";

import { useState, useEffect } from "react";
import { X, AlertTriangle, Mail, Phone, Briefcase, Building2, Calendar, User } from "lucide-react";
import { SalaryRow, SalaryFormData, MIN_WAGE } from "./types";
import { formatMoney } from "@/utils/payrollFormat";
import { useCompanyCurrency } from "@/hooks/useCompanyCurrency";

interface Props {
  row: SalaryRow | null;
  onClose: () => void;
  onSave: (jobId: number | null, salaryId: number | null, data: SalaryFormData) => Promise<void>;
}

const DEFAULT_FORM: SalaryFormData = {
  salary: "",
  allowance: "0",
  currency: "MUR",
  monthly_hours: "173",
  days_of_work_per_month: 22,
  break_in_minutes_per_day: 60,
};

function toForm(row: SalaryRow): SalaryFormData {
  // Prefer the mobile-canonical `allowance` column; fall back to the legacy
  // `revenue` column for rows configured before the web/mobile field unified.
  const allowance = row.allowance ?? row.revenue ?? "0";
  return {
    salary: row.salary ?? "",
    allowance,
    currency: row.currency ?? "MUR",
    monthly_hours: row.monthly_hours ?? "173",
    days_of_work_per_month: row.days_of_work_per_month ?? 22,
    break_in_minutes_per_day: row.break_in_minutes_per_day ?? 60,
  };
}

// Decorative avatar palette — red is reserved for semantic states, so index 0
// uses a brand teal instead.
const AVATAR_COLORS = [
  "bg-teal-100 text-teal-700",
  "bg-blue-100 text-blue-700",
  "bg-emerald-100 text-emerald-700",
  "bg-violet-100 text-violet-700",
  "bg-amber-100 text-amber-700",
  "bg-sky-100 text-sky-700",
];

function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function ageFromDob(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  return `${Math.floor(diff / 31_557_600_000)} yrs`;
}

export default function SalaryConfigModal({ row, onClose, onSave }: Props) {
  // Currency is server-authoritative (company's country) — not chosen here. Show
  // the stored salary currency, or the company currency for a not-yet-configured
  // employee. The backend ignores any submitted currency anyway.
  const { currency: companyCurrency } = useCompanyCurrency();
  const [form, setForm] = useState<SalaryFormData>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (row) setForm(row.has_salary ? toForm(row) : { ...DEFAULT_FORM, currency: row.currency ?? companyCurrency });
  }, [row, companyCurrency]);

  useEffect(() => {
    if (!row) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [row]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!row) return null;

  const baseAmount = parseFloat(form.salary || "0");
  const allowance = parseFloat(form.allowance || "0");
  const total = baseAmount + allowance;
  const minWage = MIN_WAGE[form.currency];
  const belowMinWage = minWage && total > 0 && total < minWage.amount;

  // Derive hourly rate preview from total monthly pay (salary + allowance),
  // matching how mobile profile.tsx computes monthlyRevenue.
  const hrs = parseFloat(form.monthly_hours || "0");
  const previewHourly = hrs > 0 ? (total / hrs).toFixed(2) : null;

  const avatarColor = AVATAR_COLORS[(row.private_user_id ?? 0) % AVATAR_COLORS.length];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.salary || parseFloat(form.salary) <= 0) {
      setError("Base salary must be greater than 0.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (!row) return;
      await onSave(row.job_id, row.salary_id, form);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save salary.");
    } finally {
      setSaving(false);
    }
  }

  function set(field: keyof SalaryFormData, value: string | number) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">

          {/* ── Modal Header bar ── */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">
              {row.has_salary ? "Edit Salary" : "Configure Salary"}
            </h2>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors">
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* ── Employee Profile Panel ── */}
            <div className="px-6 py-5 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-start gap-4">
                {/* Avatar */}
                <div className={`w-14 h-14 rounded-xl flex items-center justify-center text-lg font-bold shrink-0 ${avatarColor}`}>
                  {initials(row.employee_name) || <User size={22} />}
                </div>

                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white">{row.employee_name}</h3>

                  {/* Job + dept */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                    {row.job_title && (
                      <span className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-300">
                        <Briefcase size={12} className="text-gray-400" />
                        {row.job_title}
                      </span>
                    )}
                    {row.department && (
                      <span className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400">
                        <Building2 size={12} className="text-gray-400" />
                        {row.department}
                      </span>
                    )}
                  </div>

                  {/* Contact + personal details grid */}
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
                    {row.email && (
                      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                        <Mail size={12} className="text-gray-400 shrink-0" />
                        <span className="truncate">{row.email}</span>
                      </div>
                    )}
                    {row.phone && (
                      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                        <Phone size={12} className="text-gray-400 shrink-0" />
                        <span>{row.phone}</span>
                      </div>
                    )}
                    {row.first_date_of_employment && (
                      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                        <Calendar size={12} className="text-gray-400 shrink-0" />
                        <span>Started {formatDate(row.first_date_of_employment)}</span>
                      </div>
                    )}
                    {row.date_of_birth && (
                      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                        <User size={12} className="text-gray-400 shrink-0" />
                        <span>
                          {formatDate(row.date_of_birth)}
                          {ageFromDob(row.date_of_birth) && (
                            <span className="ml-1 text-gray-400">({ageFromDob(row.date_of_birth)})</span>
                          )}
                        </span>
                      </div>
                    )}
                    {row.gender && (
                      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                        <User size={12} className="text-gray-400 shrink-0" />
                        <span className="capitalize">{row.gender}</span>
                      </div>
                    )}
                    {row.passport_number && (
                      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                        <span className="text-gray-400 shrink-0 font-mono text-[10px]">PP</span>
                        <span className="font-mono">{row.passport_number}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Status badge */}
                <div className="shrink-0">
                  <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
                    row.has_salary
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
                      : "bg-red-50 text-red-700 border border-red-100"
                  }`}>
                    {row.has_salary ? "Salary set" : "No salary"}
                  </span>
                </div>
              </div>
            </div>

            {/* ── Salary Form ── */}
            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">

              {/* No job record warning */}
              {!row.job_id && (
                <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
                  <AlertTriangle size={15} className="text-amber-500 shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-700 dark:text-amber-300">
                    <p className="font-semibold">No job record found</p>
                    <p className="mt-0.5">This employee has no active job linked to your company. Complete their onboarding first before configuring a salary.</p>
                  </div>
                </div>
              )}

              {/* Currency — read-only, derived from the company's country */}
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Currency</label>
                <div className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 px-3 py-2.5 text-sm flex items-center justify-between cursor-not-allowed">
                  <span className="font-medium text-gray-700 dark:text-gray-300">{form.currency}</span>
                  <span className="text-xs text-gray-400">Set by company country</span>
                </div>
              </div>

              {/* Base salary + allowance */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                    Base Salary ({form.currency}/mo)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.salary}
                    onChange={(e) => set("salary", e.target.value)}
                    placeholder="e.g. 15000"
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                    Allowances ({form.currency}/mo)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.allowance}
                    onChange={(e) => set("allowance", e.target.value)}
                    placeholder="0"
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Total + minimum wage warning */}
              {total > 0 && (
                <div className={`rounded-xl px-4 py-3 ${
                  belowMinWage
                    ? "bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800"
                    : "bg-gray-50 dark:bg-gray-800"
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600 dark:text-gray-400">Total monthly pay</span>
                    <span className="font-semibold text-gray-900 dark:text-gray-100 text-sm">
                      {formatMoney(total, form.currency, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  {previewHourly && (
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs text-gray-400">Effective hourly rate</span>
                      <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                        {formatMoney(Number(previewHourly), form.currency, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/hr
                      </span>
                    </div>
                  )}
                  {belowMinWage && (
                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-1.5 flex items-center gap-1">
                      <AlertTriangle size={11} />
                      Below {minWage.label}
                    </p>
                  )}
                </div>
              )}

              {/* Hours */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Monthly Hours</label>
                  <input
                    type="number"
                    min="1"
                    value={form.monthly_hours}
                    onChange={(e) => set("monthly_hours", e.target.value)}
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Work Days/Mo</label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={form.days_of_work_per_month}
                    onChange={(e) => set("days_of_work_per_month", parseInt(e.target.value) || 0)}
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Break (min/day)</label>
                  <input
                    type="number"
                    min="0"
                    value={form.break_in_minutes_per_day}
                    onChange={(e) => set("break_in_minutes_per_day", parseInt(e.target.value) || 0)}
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {error && (
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              )}
            </form>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30 rounded-b-2xl">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit as unknown as React.MouseEventHandler}
              disabled={saving || !row.job_id}
              title={!row.job_id ? "No job record — complete onboarding first" : undefined}
              className="px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? "Saving…" : row.has_salary ? "Update Salary" : "Configure Salary"}
            </button>
          </div>

        </div>
      </div>
    </>
  );
}
