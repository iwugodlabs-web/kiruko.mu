"use client";

import { OnboardDraft, PERMIT_TYPES, STEPS, getComplianceIssues } from "./types";
import ComplianceCheckBanner from "./ComplianceCheckBanner";
import { User, Shield, Briefcase, DollarSign, FileText, CheckCircle, XCircle, AlertTriangle } from "lucide-react";

interface Props {
  draft: OnboardDraft;
  onEditStep: (step: number) => void;
}

function Section({ icon, label, step, onEdit, children }: {
  icon: React.ReactNode; label: string; step: number;
  onEdit: (step: number) => void; children: React.ReactNode;
}) {
  return (
    <div className="bg-gray-50 dark:bg-gray-800/60 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-gray-500 dark:text-gray-400">{icon}</span>
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{label}</p>
        </div>
        <button
          onClick={() => onEdit(step)}
          className="text-xs text-red-600 dark:text-red-400 hover:underline font-medium"
        >
          Edit
        </button>
      </div>
      <div className="space-y-1.5 text-sm text-gray-700 dark:text-gray-300">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0 w-36">{label}</span>
      <span className="font-medium text-right">{value || "—"}</span>
    </div>
  );
}

export default function Step6_Review({ draft, onEditStep }: Props) {
  const issues = getComplianceIssues(draft);
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");

  const permitLabel = PERMIT_TYPES.find((p) => p.value === draft.permit_type)?.label ?? draft.permit_type;
  const hoursPerMonth = draft.hours_per_month ?? (draft.contracted_hours ? Math.round(draft.contracted_hours * 4.33) : null);
  const hourlyRate = draft.base_salary && hoursPerMonth ? (draft.base_salary / hoursPerMonth).toFixed(2) : null;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Review & Add Employee</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Double-check everything, then add the employee. They&apos;ll be emailed a link to set their password and activate their account.
        </p>
      </div>

      {/* Compliance summary */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Compliance Check</p>
        </div>
        <div className="px-4 py-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            {[
              { label: "Work Authorization", pass: draft.has_permission_to_work && draft.permit_type !== "tourist_visa" && draft.permit_type !== "none" },
              { label: "Permit Not Expired", pass: !issues.some(i => i.text.includes("expired")) },
              { label: "Above Min. Wage", pass: !issues.some(i => i.text.includes("minimum wage")) },
            ].map(({ label, pass }) => (
              <div key={label} className={`flex items-center gap-2 px-3 py-2 rounded-lg ${pass ? "bg-green-50 dark:bg-green-900/20" : "bg-red-50 dark:bg-red-900/20"}`}>
                {pass
                  ? <CheckCircle size={12} className="text-green-500 shrink-0" />
                  : <XCircle size={12} className="text-red-500 shrink-0" />}
                <span className={pass ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}>{label}</span>
              </div>
            ))}
          </div>
          {issues.length > 0 && <ComplianceCheckBanner draft={draft} />}
        </div>
      </div>

      {errors.length > 0 && (
        <div className="flex items-start gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3">
          <AlertTriangle size={14} className="text-red-500 shrink-0 mt-0.5" />
          <p className="text-xs text-red-700 dark:text-red-400 font-medium">
            There are {errors.length} compliance error{errors.length > 1 ? "s" : ""}. You can still add this employee, but they may pose a legal risk.
          </p>
        </div>
      )}

      <Section icon={<User size={14} />} label="Personal Information" step={0} onEdit={onEditStep}>
        <Row label="Name" value={`${draft.first_name} ${draft.last_name}`.trim()} />
        <Row label="Email" value={draft.email} />
        <Row label="Nationality" value={draft.nationality} />
        <Row label="Passport / ID" value={draft.passport_number} />
        <Row label="Role" value={draft.role.charAt(0).toUpperCase() + draft.role.slice(1)} />
      </Section>

      <Section icon={<Shield size={14} />} label="Work Authorization" step={1} onEdit={onEditStep}>
        <Row label="Permit Type" value={permitLabel || "—"} />
        <Row label="Permit Number" value={draft.permit_number || "—"} />
        <Row label="Expiry Date" value={draft.permit_expiry
          ? new Date(draft.permit_expiry).toLocaleDateString([], { dateStyle: "medium" })
          : "—"} />
        <Row label="Permission Confirmed" value={draft.has_permission_to_work ? "Yes" : "No"} />
      </Section>

      <Section icon={<Briefcase size={14} />} label="Job Details" step={2} onEdit={onEditStep}>
        <Row label="Job Title" value={draft.job_title} />
        <Row label="Department" value={draft.department_name || "—"} />
        <Row label="Start Date" value={draft.start_date
          ? new Date(draft.start_date).toLocaleDateString([], { dateStyle: "medium" })
          : "—"} />
        <Row label="Hours / Week" value={draft.contracted_hours ? `${draft.contracted_hours}h` : "—"} />
        <Row label="Days / Week" value={draft.work_days_per_week ? `${draft.work_days_per_week} days` : "—"} />
      </Section>

      <Section icon={<DollarSign size={14} />} label="Salary" step={3} onEdit={onEditStep}>
        <Row label="Base Salary" value={draft.base_salary
          ? `${draft.currency} ${draft.base_salary.toLocaleString()}/mo`
          : "Not configured"} />
        {hourlyRate && <Row label="Hourly Rate" value={`${draft.currency} ${hourlyRate}/hr`} />}
        <Row label="Deductions" value={[
          draft.deduct_transport ? "Transport" : null,
          draft.deduct_accommodation ? "Accommodation" : null,
        ].filter(Boolean).join(", ") || "None"} />
      </Section>

      {(draft.contract_notes || draft.other_notes) && (
        <Section icon={<FileText size={14} />} label="Notes" step={4} onEdit={onEditStep}>
          {draft.contract_notes && <Row label="Contract" value={draft.contract_notes} />}
          {draft.other_notes && <Row label="Documents to collect" value={draft.other_notes} />}
        </Section>
      )}
    </div>
  );
}
