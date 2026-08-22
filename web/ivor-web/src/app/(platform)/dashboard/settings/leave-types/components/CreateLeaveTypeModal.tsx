"use client";

import { useEffect, useState } from "react";
import { leaveTypes, type LeaveTypeCreate } from "@/services/payroll-api";
import { toast } from "sonner";
import { Loader2, X } from "lucide-react";


function isError<T>(v: T | { error: string; status?: number }): v is { error: string; status?: number } {
  return typeof v === "object" && v !== null && "error" in v;
}


interface Props {
  open: boolean;
  companyId: number;
  existingCodes: Set<string>;
  onClose: () => void;
  onCreated: () => void;
}


export default function CreateLeaveTypeModal({ open, companyId, existingCodes, onClose, onCreated }: Props) {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [daysPerYear, setDaysPerYear] = useState("");
  const [accrualMethod, setAccrualMethod] = useState<"monthly" | "annual" | "tenure_based">("annual");
  const [carryForward, setCarryForward] = useState("");
  const [minService, setMinService] = useState("0");
  const [isPaid, setIsPaid] = useState(true);
  const [encashable, setEncashable] = useState(false);
  const [requiresDoc, setRequiresDoc] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setCode("");
      setLabel("");
      setDaysPerYear("");
      setAccrualMethod("annual");
      setCarryForward("");
      setMinService("0");
      setIsPaid(true);
      setEncashable(false);
      setRequiresDoc(false);
    }
  }, [open]);

  if (!open) return null;

  async function handleSubmit() {
    const codeNorm = code.trim().toLowerCase();
    if (!codeNorm.match(/^[a-z][a-z0-9_]{0,39}$/)) {
      toast.error("Code must start with a letter (a–z), then a–z, 0–9, _ (max 40)");
      return;
    }
    if (existingCodes.has(codeNorm)) {
      toast.error(`Code "${codeNorm}" already exists`);
      return;
    }
    if (!label.trim()) {
      toast.error("Label is required");
      return;
    }

    const payload: LeaveTypeCreate = {
      code: codeNorm,
      label: label.trim(),
      is_paid: isPaid,
      is_statutory: false,
      accrual_method: accrualMethod,
      accrual_rate_days_per_month: null,
      days_per_year: daysPerYear.trim() ? Number(daysPerYear) : null,
      max_balance: null,
      carry_forward_max: carryForward.trim() ? Number(carryForward) : null,
      encashable,
      min_service_months: Number(minService) || 0,
      requires_doc: requiresDoc,
      is_active: true,
    };

    setLoading(true);
    const r = await leaveTypes.create(companyId, payload);
    setLoading(false);
    if (isError(r)) {
      toast.error(r.error);
      return;
    }
    toast.success(`Leave type "${codeNorm}" created`);
    onCreated();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col border border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between border-b border-zinc-100 dark:border-gray-800 px-6 py-4">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">New leave type</h2>
          <button onClick={onClose} className="text-zinc-400 dark:text-gray-500 hover:text-zinc-600 dark:hover:text-gray-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Code" value={code} onChange={setCode} mono lowercase placeholder="e.g. study, bereavement" />
            <Input label="Label" value={label} onChange={setLabel} placeholder="e.g. Study leave" />
            <Input label="Days per year" type="number" value={daysPerYear} onChange={setDaysPerYear} placeholder="e.g. 5" />
            <div>
              <label className="block text-xs uppercase font-semibold text-zinc-500 dark:text-gray-400 mb-1 tracking-wide">
                Accrual method
              </label>
              <select
                value={accrualMethod}
                onChange={(e) => setAccrualMethod(e.target.value as typeof accrualMethod)}
                className="w-full rounded-md border border-zinc-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-zinc-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="annual">annual</option>
                <option value="monthly">monthly</option>
                <option value="tenure_based">tenure_based</option>
              </select>
            </div>
            <Input label="Carry forward max" type="number" value={carryForward} onChange={setCarryForward} placeholder="(optional)" />
            <Input label="Min service (months)" type="number" value={minService} onChange={setMinService} />
          </div>

          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-zinc-100 dark:border-gray-800">
            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-gray-300 cursor-pointer">
              <input type="checkbox" checked={isPaid} onChange={(e) => setIsPaid(e.target.checked)} />
              Paid
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-gray-300 cursor-pointer">
              <input type="checkbox" checked={encashable} onChange={(e) => setEncashable(e.target.checked)} />
              Encashable
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-gray-300 cursor-pointer">
              <input type="checkbox" checked={requiresDoc} onChange={(e) => setRequiresDoc(e.target.checked)} />
              Requires doc
            </label>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 dark:border-gray-800 px-6 py-4">
          <button onClick={onClose} className="rounded-md border border-zinc-200 dark:border-gray-700 px-4 py-2 text-sm text-zinc-700 dark:text-gray-200 hover:bg-zinc-50 dark:hover:bg-gray-800">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Create
          </button>
        </div>
      </div>
    </div>
  );
}


function Input({
  label, value, onChange, type = "text", mono = false, lowercase = false, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  mono?: boolean;
  lowercase?: boolean;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs uppercase font-semibold text-zinc-500 dark:text-gray-400 mb-1 tracking-wide">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(lowercase ? e.target.value.toLowerCase() : e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-md border border-zinc-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
          mono ? "font-mono" : ""
        }`}
      />
    </div>
  );
}
