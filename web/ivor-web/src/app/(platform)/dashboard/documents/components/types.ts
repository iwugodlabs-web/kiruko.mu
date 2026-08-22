export interface VaultDoc {
  doc_id: number;
  private_user_id: number;
  employee_name: string;
  doc_type: string;
  name: string;
  expiry_date: string | null;   // YYYY-MM-DD string
  notes: string | null;
  file_url: string | null;
  file_name: string | null;
  file_mime: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface CompanyVaultResponse {
  status: string;
  data: VaultDoc[];
}

export const DOC_TYPES = [
  { value: "work_permit",  label: "Work Permit",  emoji: "🛡" },
  { value: "passport",     label: "Passport",     emoji: "🪪" },
  { value: "contract",     label: "Contract",     emoji: "📄" },
  { value: "pay_stub",     label: "Payslip",      emoji: "💰" },
  { value: "id_card",      label: "ID Card",      emoji: "🪪" },
  { value: "visa",         label: "Visa",         emoji: "✈" },
  { value: "certificate",  label: "Certificate",  emoji: "🏆" },
  { value: "other",        label: "Other",        emoji: "📎" },
];

export function docTypeConfig(type: string) {
  return DOC_TYPES.find((d) => d.value === type) ?? { value: type, label: type, emoji: "📎" };
}

export type ExpiryStatus = "expired" | "expiring" | "valid" | "none";

export function expiryStatus(expiry: string | null): ExpiryStatus {
  if (!expiry) return "none";
  const days = Math.floor((new Date(expiry).getTime() - Date.now()) / 86400000);
  if (days < 0) return "expired";
  if (days <= 30) return "expiring";
  return "valid";
}

export function daysUntilExpiry(expiry: string | null): number | null {
  if (!expiry) return null;
  return Math.floor((new Date(expiry).getTime() - Date.now()) / 86400000);
}

export const EXPIRY_CHIP: Record<ExpiryStatus, string> = {
  expired:  "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400",
  expiring: "bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400",
  valid:    "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400",
  none:     "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400",
};

export const EXPIRY_LABEL: Record<ExpiryStatus, (days: number | null) => string> = {
  expired:  (d) => `Expired ${d !== null ? Math.abs(d) + "d ago" : ""}`,
  expiring: (d) => `Expiring in ${d}d`,
  valid:    (d) => `Valid · ${d}d left`,
  none:     () => "No expiry",
};
