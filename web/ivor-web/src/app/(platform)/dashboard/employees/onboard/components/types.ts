export interface OnboardDraft {
  // Step 1 — Identity
  first_name: string;
  last_name: string;
  email: string;
  dob: string;
  nationality: string;
  passport_number: string;

  // Step 2 — Work Authorization
  permit_type: string;       // work_permit | dependent_pass | tourist_visa | none | other
  permit_number: string;
  permit_expiry: string;     // YYYY-MM-DD
  has_permission_to_work: boolean;

  // Step 3 — Job Details
  job_title: string;
  department_id: number | null;
  department_name: string;   // for display; if creating new dept
  start_date: string;        // YYYY-MM-DD
  contracted_hours: number | null;
  work_days_per_week: number | null;

  // Step 4 — Salary
  base_salary: number | null;
  currency: string;          // MUR | MGA | USD | EUR
  hours_per_month: number | null;
  deduct_transport: boolean;
  deduct_accommodation: boolean;

  // Step 5 — Document Notes
  contract_notes: string;
  other_notes: string;

  // Meta
  role: string;              // employee | manager | admin
  created_at: string;
  step: number;              // last completed step (0-5)
}

export const PERMIT_TYPES = [
  { value: "work_permit", label: "Work Permit" },
  { value: "dependent_pass", label: "Dependent Pass" },
  { value: "occupation_permit", label: "Occupation Permit" },
  { value: "residence_permit", label: "Residence Permit" },
  { value: "tourist_visa", label: "Tourist Visa ⚠" },
  { value: "citizen", label: "Citizen / Permanent Resident" },
  { value: "none", label: "None / Not provided" },
  { value: "other", label: "Other" },
];

export const CURRENCIES = [
  { value: "MUR", label: "MUR — Mauritian Rupee" },
  { value: "MGA", label: "MGA — Malagasy Ariary" },
  { value: "USD", label: "USD — US Dollar" },
  { value: "EUR", label: "EUR — Euro" },
  { value: "GBP", label: "GBP — British Pound" },
];

export const MIN_WAGES: Record<string, { monthly: number; label: string }> = {
  MUR: { monthly: 11275, label: "MUR 11,275/mo" },
  MGA: { monthly: 258960, label: "MGA 258,960/mo" },
};

export const EMPTY_DRAFT: OnboardDraft = {
  first_name: "", last_name: "", email: "", dob: "", nationality: "", passport_number: "",
  permit_type: "", permit_number: "", permit_expiry: "", has_permission_to_work: true,
  job_title: "", department_id: null, department_name: "", start_date: "", contracted_hours: null, work_days_per_week: 5,
  base_salary: null, currency: "MUR", hours_per_month: null, deduct_transport: false, deduct_accommodation: false,
  contract_notes: "", other_notes: "",
  role: "employee", created_at: new Date().toISOString(), step: 0,
};

export const STEPS = [
  "Personal Info",
  "Work Authorization",
  "Job Details",
  "Salary",
  "Documents",
  "Review & Invite",
];

// Derive compliance issues from a draft
export function getComplianceIssues(draft: OnboardDraft): { level: "error" | "warning"; text: string }[] {
  const issues: { level: "error" | "warning"; text: string }[] = [];

  if (draft.permit_type === "tourist_visa") {
    issues.push({ level: "error", text: "Tourist visa — this employee may not be legally authorized to work." });
  }
  if (draft.permit_type === "none") {
    issues.push({ level: "warning", text: "No permit type specified. Work authorization is unclear." });
  }
  if (!draft.has_permission_to_work) {
    issues.push({ level: "error", text: "Employee does not have permission to work." });
  }
  if (draft.permit_expiry) {
    const daysLeft = Math.floor((new Date(draft.permit_expiry).getTime() - Date.now()) / 86400000);
    if (daysLeft < 0) {
      issues.push({ level: "error", text: `Permit has already expired (${Math.abs(daysLeft)}d ago).` });
    } else if (daysLeft <= 30) {
      issues.push({ level: "warning", text: `Permit expiring in ${daysLeft} days.` });
    }
  }

  const mw = MIN_WAGES[draft.currency];
  if (mw && draft.base_salary !== null && draft.base_salary > 0) {
    const hoursPerMonth = draft.hours_per_month ?? (draft.contracted_hours ? draft.contracted_hours * 4.33 : null);
    if (draft.base_salary < mw.monthly) {
      issues.push({ level: "warning", text: `Salary below minimum wage (${mw.label} for ${draft.currency}).` });
    }
  }

  return issues;
}
