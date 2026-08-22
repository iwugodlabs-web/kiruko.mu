"use client";

import { useEffect } from "react";
import { X, ExternalLink, AlertTriangle, ShieldCheck, Clock, Mail } from "lucide-react";
import { ComplianceEmployee, PERMIT_STATUS_CONFIG } from "./types";

interface Props {
  employee: ComplianceEmployee | null;
  onClose: () => void;
  onSendReminder: (emp: ComplianceEmployee) => void;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-4 py-2.5 border-b border-gray-100 dark:border-gray-700 last:border-0">
      <span className="text-sm text-gray-500 dark:text-gray-400 shrink-0">{label}</span>
      <span className="text-sm font-medium text-gray-900 dark:text-gray-100 text-right">{value ?? "—"}</span>
    </div>
  );
}

export default function PermitDetailDrawer({ employee, onClose, onSendReminder }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (employee) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [employee]);

  if (!employee) return null;

  const cfg = PERMIT_STATUS_CONFIG[employee.permit_status];
  const isRisk = employee.permit_status === "expired" || employee.permit_status === "tourist_visa";

  return (
    <>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white dark:bg-gray-900 z-50 shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">
              {employee.employee_name}
              {employee.employee_code && <span className="ml-1.5 font-mono text-xs font-normal text-gray-400 dark:text-gray-500">{employee.employee_code}</span>}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{employee.job_title ?? "Employee"}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Status badge */}
          <div className="flex items-center gap-3">
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${cfg.classes}`}>
              <span className={`w-2 h-2 rounded-full ${cfg.dotColor}`} />
              {cfg.label}
            </span>
            {isRisk && (
              <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400 font-medium">
                <AlertTriangle size={12} />
                Legal exposure
              </span>
            )}
          </div>

          {/* Risk warning */}
          {employee.permit_status === "tourist_visa" && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3">
              <p className="text-sm font-semibold text-red-800 dark:text-red-300">Tourist visa detected</p>
              <p className="text-xs text-red-700 dark:text-red-400 mt-1">
                Employing a person on a tourist visa is illegal in Mauritius and Madagascar.
                The company may face fines or prosecution. Verify this employee&apos;s legal work status immediately.
              </p>
            </div>
          )}

          {/* Compliance score */}
          <section>
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-3">Compliance Score</h3>
            <div className="flex items-center gap-4 bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
              <div className="relative w-16 h-16 shrink-0">
                <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                  <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="10" className="text-gray-200 dark:text-gray-700" />
                  <circle cx="50" cy="50" r="40" fill="none" strokeWidth="10"
                    className={employee.compliance_score >= 80 ? "stroke-green-500" : employee.compliance_score >= 60 ? "stroke-amber-500" : "stroke-red-500"}
                    strokeDasharray={`${(employee.compliance_score / 100) * 251} 251`}
                    strokeLinecap="round"
                  />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-gray-900 dark:text-gray-100">
                  {employee.compliance_score}
                </span>
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
                <p className={`flex items-center gap-1 ${employee.has_permission_to_work ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
                  {employee.has_permission_to_work ? <ShieldCheck size={11} /> : <AlertTriangle size={11} />}
                  Work authorization declared
                </p>
                <p className={`flex items-center gap-1 ${!employee.working_on_tourist_visa && employee.permit_type ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
                  {!employee.working_on_tourist_visa && employee.permit_type ? <ShieldCheck size={11} /> : <AlertTriangle size={11} />}
                  Valid permit type
                </p>
                <p className={`flex items-center gap-1 ${employee.days_until_expiry != null && employee.days_until_expiry >= 0 ? "text-green-600 dark:text-green-400" : "text-gray-400"}`}>
                  <Clock size={11} />
                  Permit not expired
                </p>
                <p className={`flex items-center gap-1 ${!employee.below_min_wage && employee.total_monthly_pay != null ? "text-green-600 dark:text-green-400" : "text-amber-500"}`}>
                  {!employee.below_min_wage && employee.total_monthly_pay != null ? <ShieldCheck size={11} /> : <AlertTriangle size={11} />}
                  Above minimum wage
                </p>
              </div>
            </div>
          </section>

          {/* Permit details */}
          <section>
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-3">Permit Details</h3>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl px-4 py-2">
              <Row label="Permit Type" value={employee.permit_type ?? "Not specified"} />
              <Row label="Expiry Date" value={employee.expiry_date ?? "Not on file"} />
              <Row label="Days Remaining" value={
                employee.days_until_expiry != null
                  ? employee.days_until_expiry < 0
                    ? <span className="text-red-600 dark:text-red-400">Expired {Math.abs(employee.days_until_expiry)} days ago</span>
                    : `${employee.days_until_expiry} days`
                  : "N/A"
              } />
              <Row label="Work Authorization" value={
                employee.has_permission_to_work
                  ? <span className="text-green-600 dark:text-green-400">Declared</span>
                  : <span className="text-red-600 dark:text-red-400">Not declared</span>
              } />
              <Row label="Tourist Visa" value={
                employee.working_on_tourist_visa
                  ? <span className="text-red-600 dark:text-red-400 font-semibold">Yes — Risk!</span>
                  : "No"
              } />
            </div>
          </section>

          {/* Document link */}
          {employee.permit_doc_url && (
            <section>
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-3">Document</h3>
              <a
                href={employee.permit_doc_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-3 bg-gray-50 dark:bg-gray-800 rounded-xl text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                <ExternalLink size={14} />
                View permit document
              </a>
            </section>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex gap-3">
          <button
            onClick={() => onSendReminder(employee)}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <Mail size={14} />
            Send Reminder
          </button>
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 text-sm font-medium rounded-xl bg-red-600 hover:bg-red-700 text-white transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </>
  );
}
