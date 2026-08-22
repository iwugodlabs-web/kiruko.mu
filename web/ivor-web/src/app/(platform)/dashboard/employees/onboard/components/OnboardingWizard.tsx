"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { createEmployee } from "@/services/api";
import { toast } from "sonner";
import { OnboardDraft, EMPTY_DRAFT, STEPS, getComplianceIssues } from "./types";
import OnboardingStepper from "./OnboardingStepper";
import Step1_PersonalInfo from "./Step1_PersonalInfo";
import Step2_WorkAuthorization from "./Step2_WorkAuthorization";
import Step3_JobDetails from "./Step3_JobDetails";
import Step4_SalaryConfig from "./Step4_SalaryConfig";
import Step5_DocumentNotes from "./Step5_DocumentNotes";
import Step6_Review from "./Step6_Review";
import { ArrowLeft, ArrowRight, Send, Trash2 } from "lucide-react";
import DashboardHeader from "@/components/ui/DashboardHeader";

const STORAGE_KEY = "ivor_onboard_draft";

function loadDraft(): OnboardDraft {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...EMPTY_DRAFT, ...JSON.parse(raw) };
  } catch {}
  return { ...EMPTY_DRAFT, created_at: new Date().toISOString() };
}

function saveDraft(draft: OnboardDraft) {
  try {
    // Stamp savedAt so EmployeesSection can age out stale drafts (> 14 days)
    // and stop showing a "resume" banner the operator forgot about.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch {}
}

function clearDraft() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

function canAdvance(step: number, draft: OnboardDraft): boolean {
  if (step === 0) return !!draft.first_name.trim() && !!draft.last_name.trim() && !!draft.email.trim();
  if (step === 1) return !!draft.permit_type;
  if (step === 2) return !!draft.job_title.trim();
  return true;
}

export default function OnboardingWizard() {
  const router = useRouter();
  const { companyId } = useAuth();

  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<OnboardDraft>(EMPTY_DRAFT);
  const [sending, setSending] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Load from localStorage after mount (avoids SSR mismatch)
  useEffect(() => {
    setDraft(loadDraft());
    setMounted(true);
  }, []);

  // Auto-save on every change
  useEffect(() => {
    if (mounted) saveDraft({ ...draft, step });
  }, [draft, step, mounted]);

  function patch(updates: Partial<OnboardDraft>) {
    setDraft((prev) => ({ ...prev, ...updates }));
  }

  function handleDiscard() {
    clearDraft();
    router.push("/dashboard/employees");
  }

  async function handleSend() {
    if (!companyId) return;

    // The wizard now DIRECTLY CREATES the employee (same pipeline as bulk
    // import), which needs a job title, start date and a positive salary — the
    // fields payroll can't resolve without. Guard here so the operator gets a
    // clear message instead of a server 400.
    if (!draft.job_title.trim()) { toast.error("Add a job title (Job Details)."); return; }
    if (!draft.start_date) { toast.error("Add a start date (Job Details)."); return; }
    if (!draft.base_salary || draft.base_salary <= 0) { toast.error("Add a base salary (Salary)."); return; }

    setSending(true);
    try {
      const res = await createEmployee(companyId, {
        first_name: draft.first_name,
        last_name: draft.last_name,
        email: draft.email,
        job_title: draft.job_title,
        start_date: draft.start_date,
        base_salary: draft.base_salary,
        currency: draft.currency,
        passport_number: draft.passport_number || null,
        department: draft.department_name || null,
        work_days_per_week: draft.work_days_per_week,
        hours_per_month: draft.hours_per_month,
        role: draft.role || null,
        dob: draft.dob || null,
        nationality: draft.nationality || null,
        permit_type: draft.permit_type || null,
        permit_number: draft.permit_number || null,
        permit_expiry: draft.permit_expiry || null,
      });
      if (res && "error" in res) {
        toast.error(res.error || "Failed to add employee.");
        return;
      }
      clearDraft();
      toast.success(
        res?.emailed
          ? `${draft.first_name} added — set-up link emailed to ${draft.email}.`
          : `${draft.first_name} added. Share their set-up link to activate the account.`,
      );
      router.push("/dashboard/employees");
    } catch {
      toast.error("Failed to add employee. Please try again.");
    } finally {
      setSending(false);
    }
  }

  const issues = getComplianceIssues(draft);
  const hasErrors = issues.some((i) => i.level === "error");
  const isLastStep = step === STEPS.length - 1;

  if (!mounted) return null; // avoid hydration flash

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-8 px-6">
      <div className="max-w-7xl mx-auto">
        {/* Standard dashboard header (breadcrumb + back handled here, matches other pages) */}
        <DashboardHeader
          title="Onboard New Employee"
          subtitle="Compliance-first hiring flow. Draft saved automatically."
          breadcrumbs={[{ label: "Employees", href: "/dashboard/employees" }, { label: "Onboard" }]}
          back="/dashboard/employees"
        />

        {/* Stepper */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-6 mb-6">
          <OnboardingStepper currentStep={step} />
        </div>

        {/* Step content */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 p-6 mb-6">
          {step === 0 && <Step1_PersonalInfo draft={draft} onChange={patch} />}
          {step === 1 && <Step2_WorkAuthorization draft={draft} onChange={patch} />}
          {step === 2 && <Step3_JobDetails draft={draft} onChange={patch} />}
          {step === 3 && <Step4_SalaryConfig draft={draft} onChange={patch} />}
          {step === 4 && <Step5_DocumentNotes draft={draft} onChange={patch} />}
          {step === 5 && <Step6_Review draft={draft} onEditStep={(s) => setStep(s)} />}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between gap-4">
          <button
            onClick={handleDiscard}
            className="flex items-center gap-1.5 text-sm text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors"
          >
            <Trash2 size={14} />
            Discard Draft
          </button>

          <div className="flex items-center gap-3">
            {step > 0 && (
              <button
                onClick={() => setStep((s) => s - 1)}
                className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                <ArrowLeft size={14} />
                Back
              </button>
            )}

            {!isLastStep ? (
              <button
                onClick={() => setStep((s) => s + 1)}
                disabled={!canAdvance(step, draft)}
                className="flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-xl disabled:opacity-40 transition-colors"
              >
                Continue
                <ArrowRight size={14} />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={sending || !draft.email.trim()}
                className={`flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium text-white rounded-xl transition-colors disabled:opacity-50 ${
                  hasErrors
                    ? "bg-amber-600 hover:bg-amber-700"
                    : "bg-green-600 hover:bg-green-700"
                }`}
              >
                <Send size={14} />
                {sending ? "Adding…" : hasErrors ? "Add Employee Anyway" : "Add Employee"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
