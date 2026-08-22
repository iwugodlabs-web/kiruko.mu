"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { api } from "@/services/apiClient";
import { salaryStructures } from "@/services/payroll-api";
import { SalaryRow, SalaryFormData, MIN_WAGE } from "../../../salaries/components/types";
import SalaryConfigModal from "../../../salaries/components/SalaryConfigModal";
import { DollarSign, Pencil, AlertTriangle, TrendingUp, Clock, Coffee } from "lucide-react";
import { toast } from "sonner";
import { useCompanyCurrency } from "@/hooks/useCompanyCurrency";

interface Props {
  jobId: number | null;
  employeeName: string;
  // Needed to deep-link the "edit the structure" action for monthly staff.
  privateUserId?: number | null;
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center py-2.5 border-b border-gray-100 dark:border-gray-700 last:border-0">
      <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{value}</span>
    </div>
  );
}

export default function SalaryTab({ jobId, employeeName, privateUserId }: Props) {
  const { currency: companyCurrency } = useCompanyCurrency();
  const [row, setRow] = useState<SalaryRow | null>(null);
  const [payBasis, setPayBasis] = useState<string | null>(null);
  // Raw rate columns for hourly/daily staff — the real pay lever for them
  // (their monthly `salary` is 0). Shown instead of the meaningless "0/mo".
  const [hourlyRateRaw, setHourlyRateRaw] = useState<number | null>(null);
  const [dailyRateRaw, setDailyRateRaw] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  // The assigned salary STRUCTURE is the modern source of truth for how this
  // employee is paid. Its components carry a `frequency` ('monthly' | 'daily');
  // a daily-frequency structure means pay is per unit of worked time, even if
  // the legacy `pay_basis` column below is stale or missing.
  const [structPayType, setStructPayType] = useState<'monthly' | 'hourly' | 'daily' | null>(null);

  async function loadSalary() {
    if (!jobId) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await api.get<{
        salary_id: number;
        job_id: number;
        salary: string;
        allowance: string | null;
        revenue: string | null;
        currency: string;
        monthly_hours: string;
        days_of_work_per_month: number;
        break_in_minutes_per_day: number;
        pay_basis: string | null;
        hourly_rate: string | null;
        daily_rate: string | null;
      }>(`/job/salary/${jobId}`);
      const d = res.data;
      setPayBasis(d.pay_basis ?? null);
      setHourlyRateRaw(d.hourly_rate != null ? parseFloat(d.hourly_rate) : null);
      setDailyRateRaw(d.daily_rate != null ? parseFloat(d.daily_rate) : null);
      setRow({
        job_id: jobId,
        private_user_id: 0,
        employee_name: employeeName,
        job_title: null,
        department: null,
        department_id: null,
        has_salary: true,
        salary_id: d.salary_id,
        salary: d.salary,
        allowance: d.allowance ?? d.revenue ?? null,
        revenue: d.revenue ?? d.allowance ?? null,
        currency: d.currency,
        monthly_hours: d.monthly_hours,
        days_of_work_per_month: d.days_of_work_per_month,
        break_in_minutes_per_day: d.break_in_minutes_per_day,
        hourly_rate: null,
      });
    } catch (err: unknown) {
      if ((err as { response?: { status: number } })?.response?.status === 404) {
        // No salary — show configure state
        setPayBasis(null);
        setHourlyRateRaw(null);
        setDailyRateRaw(null);
        setRow({
          job_id: jobId,
          private_user_id: 0,
          employee_name: employeeName,
          job_title: null,
          department: null,
          department_id: null,
          has_salary: false,
          salary_id: null,
          salary: null,
          allowance: null,
          revenue: null,
          currency: companyCurrency,
          monthly_hours: null,
          days_of_work_per_month: null,
          break_in_minutes_per_day: null,
          hourly_rate: null,
        });
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadSalary(); }, [jobId]);

  // Resolve the structure pay type once, so the badge/labels always reflect
  // the structure that actually drives payroll (not a stale legacy column).
  useEffect(() => {
    if (!privateUserId) return;
    let cancelled = false;
    salaryStructures.preview(privateUserId).then((res) => {
      if (cancelled || "error" in res) return;
      const basic = res.components?.find((c) => c.kind === "earning" && c.is_basic);
      if (basic) {
        const isDaily =
          basic.frequency === "daily" ||
          (basic.meta as { frequency?: string } | null)?.frequency === "daily";
        setStructPayType(isDaily ? "daily" : "monthly");
      }
    });
    return () => { cancelled = true; };
  }, [privateUserId]);

  async function handleSave(jid: number | null, salaryId: number | null, formData: SalaryFormData) {
    if (!jid) {
      toast.error("Cannot save salary: no job record linked.");
      return;
    }
    // Write allowance to both columns; see SalariesSection.handleSave for rationale.
    const payload = {
      job_id: jid,
      salary: formData.salary,
      allowance: formData.allowance,
      revenue: formData.allowance,
      currency: formData.currency,
      monthly_hours: formData.monthly_hours,
      days_of_work_per_month: formData.days_of_work_per_month,
      break_in_minutes_per_day: formData.break_in_minutes_per_day,
    };
    if (salaryId) {
      await api.put(`/job/salary/update/${salaryId}`, payload);
    } else {
      await api.post(`/job/salary`, payload);
    }
    toast.success("Salary saved.");
    loadSalary();
  }

  if (!jobId) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-400 dark:text-gray-500 text-sm">
        No job profile linked to this employee.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-3 py-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-10 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  const hasSalary = row?.has_salary;
  // Monthly vs hourly/daily. The resolved salary STRUCTURE wins — it is the
  // actual source of pay and always reflects the employer's assignment. We
  // only fall back to the legacy `pay_basis` column when no structure is
  // configured (empty preview) so a stale value never mislabels someone who
  // was just moved onto/off an hourly structure.
  const legacyKey = (payBasis || "monthly").toLowerCase();
  const basisKey = structPayType ?? legacyKey;
  const isMonthly = basisKey === "monthly";
  // Pay-basis badge shown in the header so every employee reads clearly as
  // Monthly / Hourly / Daily — not "monthly warns, hourly is silent".
  const basisBadge =
    basisKey === "hourly"
      ? { label: "Hourly", cls: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800" }
      : basisKey === "daily"
      ? { label: "Daily", cls: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-900/30 dark:text-teal-300 dark:border-teal-800" }
      : { label: "Monthly", cls: "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700" };
  const baseVal = parseFloat(row?.salary ?? "0");
  // Mobile-canonical column first, legacy `revenue` as fallback.
  const allowance = parseFloat(row?.allowance ?? row?.revenue ?? "0");
  const total = baseVal + allowance;
  const minWage = row?.currency ? MIN_WAGE[row.currency] : null;
  const belowMin = minWage && total > 0 && total < minWage.amount;

  const hourlyRate =
    hasSalary && baseVal > 0 && row?.monthly_hours
      ? baseVal / parseFloat(row.monthly_hours)
      : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DollarSign size={16} className="text-gray-400" />
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            {hasSalary ? "Salary Configuration" : "No Salary Configured"}
          </span>
          {hasSalary && (
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${basisBadge.cls}`}>
              {basisBadge.label}
            </span>
          )}
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 px-2.5 py-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
        >
          <Pencil size={12} />
          {hasSalary ? "Edit" : "Configure"}
        </button>
      </div>

      {hasSalary && isMonthly && (
        <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3">
          <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-800 dark:text-amber-300">
            <p className="font-semibold">These amounts don&apos;t drive this employee&apos;s payroll.</p>
            <p className="mt-0.5">
              {employeeName || "This employee"} is paid monthly, so pay is set by their{" "}
              <strong>salary structure</strong> — the figures below are a legacy reference and can
              differ from what payroll actually pays.
              {privateUserId ? (
                <>
                  {" "}
                  <Link
                    href={`/dashboard/salary-structures?tab=preview&employee=${privateUserId}&assign=1`}
                    className="underline font-medium hover:text-amber-900 dark:hover:text-amber-200"
                  >
                    Edit the salary structure →
                  </Link>
                </>
              ) : null}
            </p>
          </div>
        </div>
      )}

      {hasSalary && !isMonthly && (
        <div className="flex items-start gap-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl px-4 py-3">
          <TrendingUp size={14} className="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
          <div className="text-xs text-blue-800 dark:text-blue-300">
            <p className="font-semibold">
              This employee is paid {basisKey === "hourly" ? "hourly" : "daily"} — from this card.
            </p>
            <p className="mt-0.5">
              Payroll pays the {basisKey === "hourly" ? "hourly rate × clocked hours" : "daily rate × days worked"},
              so the rate below is what matters. Any salary structure&apos;s basic pay is ignored for this employee.
            </p>
          </div>
        </div>
      )}

      {!hasSalary ? (
        <div className="flex items-center gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-4">
          <AlertTriangle size={16} className="text-red-500 shrink-0" />
          <div>
            <p className="text-sm font-medium text-red-800 dark:text-red-300">Salary not configured</p>
            <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">
              Accurate payroll and compliance checks require a salary record.
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-gray-50 dark:bg-gray-800/60 rounded-xl px-4 py-2">
          {isMonthly ? (
            <>
              <InfoRow label="Base Salary" value={`${row?.currency} ${baseVal.toLocaleString()}/mo`} />
              <InfoRow
                label="Allowances"
                value={allowance > 0 ? `${row?.currency} ${allowance.toLocaleString()}/mo` : "None"}
              />
              <InfoRow
                label="Total Monthly Pay"
                value={
                  <span className={belowMin ? "text-amber-600 dark:text-amber-400" : undefined}>
                    {row?.currency} {total.toLocaleString()}
                    {belowMin && (
                      <span className="ml-1.5 text-xs font-normal">⚠ Below min wage</span>
                    )}
                  </span>
                }
              />
              {hourlyRate != null && (
                <InfoRow
                  label="Effective Hourly Rate"
                  value={
                    <span className="flex items-center gap-1">
                      <TrendingUp size={12} className="text-gray-400" />
                      {row?.currency} {hourlyRate.toFixed(2)}/hr
                    </span>
                  }
                />
              )}
            </>
          ) : basisKey === "hourly" ? (
            <InfoRow
              label="Hourly Rate"
              value={
                <span className="flex items-center gap-1 font-semibold">
                  <TrendingUp size={12} className="text-blue-500 dark:text-blue-400" />
                  {hourlyRateRaw != null ? `${row?.currency} ${hourlyRateRaw.toFixed(2)}/hr` : "Not set"}
                </span>
              }
            />
          ) : (
            <InfoRow
              label="Daily Rate"
              value={
                <span className="flex items-center gap-1 font-semibold">
                  <TrendingUp size={12} className="text-teal-500 dark:text-teal-400" />
                  {dailyRateRaw != null ? `${row?.currency} ${dailyRateRaw.toFixed(2)}/day` : "Not set"}
                </span>
              }
            />
          )}
          <InfoRow
            label="Monthly Hours"
            value={
              <span className="flex items-center gap-1">
                <Clock size={12} className="text-gray-400" />
                {row?.monthly_hours ?? "—"} hrs
              </span>
            }
          />
          <InfoRow label="Work Days / Month" value={`${row?.days_of_work_per_month ?? "—"} days`} />
          <InfoRow
            label="Break Time"
            value={
              <span className="flex items-center gap-1">
                <Coffee size={12} className="text-gray-400" />
                {row?.break_in_minutes_per_day ?? "—"} min/day
              </span>
            }
          />
        </div>
      )}

      {belowMin && minWage && (
        <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3">
          <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 dark:text-amber-300">
            Total pay is below the legal minimum wage ({minWage.label}).
            This may expose the company to labour compliance risk.
          </p>
        </div>
      )}

      <SalaryConfigModal
        row={showModal ? row : null}
        onClose={() => setShowModal(false)}
        onSave={handleSave}
      />
    </div>
  );
}
