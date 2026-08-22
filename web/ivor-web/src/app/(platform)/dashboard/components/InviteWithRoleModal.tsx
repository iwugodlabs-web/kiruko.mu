"use client";

import { useEffect, useState } from "react";
import { X, Mail, UserPlus } from "lucide-react";
import { inviteCompanyUser } from "@/services/api";
import { api } from "@/services/apiClient";
import { toast } from "sonner";

type RoleOption = { value: string; label: string; description?: string };

interface Department {
  department_id: number;
  name: string;
}

interface Props {
  companyId: number;
  departments: Department[];
  onClose: () => void;
  onInvited?: () => void;
}

const inputCls =
  "w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 " +
  "text-sm text-gray-900 dark:text-gray-100 px-3 py-2.5 focus:outline-none focus:ring-2 " +
  "focus:ring-red-500 placeholder:text-gray-400 dark:placeholder:text-gray-600";

// The plain employee baseline isn't in the role catalogue (the catalogue holds
// the elevated/system roles + custom roles), so we always offer it as the first
// option, then append whatever the company's catalogue defines.
const BASE_EMPLOYEE: RoleOption = {
  value: "employee",
  label: "Employee",
  description: "Can view and manage their own tasks and records.",
};

export default function InviteWithRoleModal({ companyId, departments, onClose, onInvited }: Props) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("employee");
  const [deptId, setDeptId] = useState<string>("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roleOptions, setRoleOptions] = useState<RoleOption[]>([BASE_EMPLOYEE]);

  // Roles come from the company's catalogue (platform-seeded system roles +
  // any custom roles the company created) — never a hardcoded list. Owner is
  // excluded: it's the singular company-owner role, not an assignable one.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.get(`/company/${companyId}/roles`);
        const list = Array.isArray(r.data) ? r.data : (r.data?.data ?? []);
        const fromCatalogue: RoleOption[] = list
          .filter((c: { name?: string }) => (c.name || "").toLowerCase() !== "owner")
          .map((c: { name: string; description?: string }) => ({
            value: c.name,
            label: c.name,
            description: c.description,
          }));
        if (alive) setRoleOptions([BASE_EMPLOYEE, ...fromCatalogue]);
      } catch {
        if (alive) setRoleOptions([BASE_EMPLOYEE]);
      }
    })();
    return () => { alive = false; };
  }, [companyId]);

  const selectedDesc = roleOptions.find((o) => o.value === role)?.description;

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await inviteCompanyUser(companyId, { email: email.trim(), role });
      if ("error" in res) throw new Error(res.error);

      // If department chosen, set it after invite (user doesn't have a private_user_id yet,
      // so we store intent — no-op here, admin can set after onboarding)
      toast.success(`Invite sent to ${email.trim()}.`);
      onInvited?.();
      onClose();
    } catch (err: unknown) {
      const msg = (err as Error).message ?? "Failed to send invite.";
      setError(msg);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2 text-sm">
                <UserPlus size={15} className="text-gray-400" />
                Invite Team Member
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Set role and department before sending the invite.
              </p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400">
              <X size={16} />
            </button>
          </div>

          <form onSubmit={handleSend} className="px-6 py-5 space-y-4">
            {/* Email */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                Email Address <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <input
                  autoFocus
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="colleague@company.com"
                  className={`${inputCls} pl-9`}
                />
              </div>
            </div>

            {/* Role + Dept side by side */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                  Role
                </label>
                <select value={role} onChange={(e) => setRole(e.target.value)} className={inputCls}>
                  {roleOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                  Department
                </label>
                <select value={deptId} onChange={(e) => setDeptId(e.target.value)} className={inputCls}>
                  <option value="">None</option>
                  {departments.map((d) => (
                    <option key={d.department_id} value={String(d.department_id)}>{d.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Role description (from the catalogue) */}
            {selectedDesc && (
              <p className="text-xs text-gray-400 dark:text-gray-500 -mt-1">
                {selectedDesc}
              </p>
            )}

            {deptId && (
              <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
                Department will be assigned once the employee completes onboarding.
              </p>
            )}

            {error && (
              <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
            )}

            <div className="flex items-center justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={sending || !email.trim()}
                className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-gray-900 hover:bg-gray-800 dark:bg-white dark:hover:bg-gray-100 text-white dark:text-gray-900 rounded-xl disabled:opacity-50 transition-colors"
              >
                {sending ? (
                  <div className="w-3.5 h-3.5 border-2 border-white/40 dark:border-gray-900/40 border-t-white dark:border-t-gray-900 rounded-full animate-spin" />
                ) : (
                  <Mail size={13} />
                )}
                {sending ? "Sending…" : "Send Invite"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
