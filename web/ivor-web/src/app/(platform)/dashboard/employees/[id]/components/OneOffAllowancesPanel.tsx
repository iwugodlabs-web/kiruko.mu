"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  oneOffAllowances,
  salaryStructures,
  type OneOffAllowance,
  type SalaryComponent,
} from "@/services/payroll-api";
import { CheckCircle2, Clock, HandCoins, Loader2, MinusCircle, Plus, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { isError, formatMoney as fmtMoneyBase } from "@/utils/payrollFormat";
import { useCompanyCurrency } from "@/hooks/useCompanyCurrency";


function monthLabel(year: number, month1Indexed: number): string {
  return new Date(year, month1Indexed - 1, 1).toLocaleDateString("en-GB", {
    month: "long", year: "numeric",
  });
}


function formatMoney(amount: string, currency: string): string {
  return fmtMoneyBase(amount, currency, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}


interface Props {
  privateUserId: number;
  companyId: number;
}


/**
 * One-off allowance scheduler embedded into the employee detail page.
 * Lists scheduled (pending + applied) one-offs and lets admins schedule
 * a new one. Pending rows can be deleted; applied rows can't (the
 * underlying API enforces this — replays would be unsafe).
 */
export default function OneOffAllowancesPanel({ privateUserId, companyId }: Props) {
  const { currency } = useCompanyCurrency();
  const [rows, setRows] = useState<OneOffAllowance[]>([]);
  const [components, setComponents] = useState<SalaryComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [dutyOpen, setDutyOpen] = useState(false);
  const [deductionOpen, setDeductionOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [list, comps] = await Promise.all([
      oneOffAllowances.list(privateUserId),
      salaryStructures.listComponents(companyId),
    ]);
    if (isError(list)) toast.error(list.error);
    setRows(isError(list) ? [] : list);
    setComponents(isError(comps) ? [] : comps);
    setLoading(false);
  }, [privateUserId, companyId]);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleDelete(row: OneOffAllowance) {
    if (row.applied_to_payslip_id != null) {
      toast.error("Already applied to payslip; cannot delete");
      return;
    }
    if (!confirm(`Delete the scheduled one-off "${row.component_label ?? row.component_code ?? "(?)"}" for ${monthLabel(row.payable_in_year, row.payable_in_month)}?`)) {
      return;
    }
    const r = await oneOffAllowances.remove(row.id);
    if (isError(r)) {
      toast.error(r.error);
      return;
    }
    toast.success("Removed");
    setRows((prev) => prev.filter((x) => x.id !== row.id));
  }

  // Sort: pending first, then by year/month descending
  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const aPending = a.applied_to_payslip_id == null ? 0 : 1;
      const bPending = b.applied_to_payslip_id == null ? 0 : 1;
      if (aPending !== bPending) return aPending - bPending;
      if (a.payable_in_year !== b.payable_in_year) return b.payable_in_year - a.payable_in_year;
      return b.payable_in_month - a.payable_in_month;
    });
  }, [rows]);

  const pendingCount = rows.filter((r) => r.applied_to_payslip_id == null).length;
  // Deduction-kind components were silently excluded here — this panel's own
  // copy already advertises "...or one-time deductions" (below), and the
  // backend (EmployeeOneOffAllowance / one_off_allowances_service.py) has
  // always been kind-agnostic end to end. The category-prefix checks below
  // are a fallback for earning components that weren't explicitly flagged
  // is_one_off in the catalog; deductions get the same courtesy via kind
  // instead of guessing at category naming conventions.
  const oneOffComponents = components.filter(
    (c) => c.is_one_off || c.kind === "deduction" || c.category.startsWith("earning.bonus") || c.category.startsWith("allowance."),
  );

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500 dark:text-gray-400">
            <Sparkles size={15} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">One-off allowances</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Ad-hoc bonuses, reimbursements, deductions scheduled for a specific month.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 px-2 py-0.5 text-xs font-medium">
              <Clock className="h-3 w-3" /> {pendingCount} pending
            </span>
          )}
          {/* #18 — additional duty grants its own server-provisioned component,
              so it's always available (no need to pre-define a component). */}
          <button
            type="button"
            onClick={() => setDutyOpen(true)}
            title="Grant additional remuneration for additional duty — flows into the month's payroll and the worker's estimate."
            className="inline-flex items-center gap-1 rounded-md border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-950/70"
          >
            <HandCoins className="h-3.5 w-3.5" />
            Additional duty
          </button>
          {/* Mirrors Additional duty: server-provisions the "Ad-hoc deduction"
              component, so no catalog pick is needed to dock one employee's pay. */}
          <button
            type="button"
            onClick={() => setDeductionOpen(true)}
            title="Dock this employee's pay for a one-time reason — flows into the month's payroll and the worker's estimate."
            className="inline-flex items-center gap-1 rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-1.5 text-xs font-medium text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/70"
          >
            <MinusCircle className="h-3.5 w-3.5" />
            Ad-hoc deduction
          </button>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            disabled={oneOffComponents.length === 0}
            title={oneOffComponents.length === 0 ? "Define a one-off component first (Salary Structures → Components)" : ""}
            className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="h-3.5 w-3.5" />
            Schedule
          </button>
        </div>
      </div>

      <div className="p-5">
        {loading && rows.length === 0 ? (
          <div className="text-center py-6 text-sm text-zinc-400 dark:text-gray-500">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-sm text-zinc-500 dark:text-gray-400">
              No one-offs scheduled. Use this for signing bonuses, mid-year commissions,
              equipment reimbursements, or one-time deductions.
            </p>
          </div>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-gray-800">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wide">Component</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wide">Period</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wide">Amount</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wide">Status</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wide">Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-gray-800">
              {sorted.map((row) => {
                const applied = row.applied_to_payslip_id != null;
                return (
                  <tr key={row.id}>
                    <td className="px-3 py-2 text-zinc-900 dark:text-white">
                      <div className="font-medium">{row.component_label ?? "—"}</div>
                      {row.component_code && (
                        <div className="text-xs text-zinc-500 dark:text-gray-400 font-mono">{row.component_code}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-zinc-700 dark:text-gray-300">
                      {monthLabel(row.payable_in_year, row.payable_in_month)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-zinc-900 dark:text-white">
                      {formatMoney(row.amount, currency)}
                    </td>
                    <td className="px-3 py-2">
                      {applied ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 text-[10px] font-medium uppercase">
                          <CheckCircle2 className="h-2.5 w-2.5" />
                          paid · #{row.applied_to_payslip_id}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 px-2 py-0.5 text-[10px] font-medium uppercase">
                          <Clock className="h-2.5 w-2.5" />
                          pending
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-zinc-500 dark:text-gray-400 max-w-[200px] truncate" title={row.notes ?? undefined}>
                      {row.notes ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleDelete(row)}
                        disabled={applied}
                        title={applied ? "Cannot delete a one-off that's already on a payslip" : "Delete"}
                        className="text-zinc-400 dark:text-gray-500 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <ScheduleModal
        open={createOpen}
        privateUserId={privateUserId}
        components={oneOffComponents}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          refresh();
        }}
      />

      <AdditionalDutyModal
        open={dutyOpen}
        privateUserId={privateUserId}
        onClose={() => setDutyOpen(false)}
        onCreated={() => {
          setDutyOpen(false);
          refresh();
        }}
      />

      <AdHocDeductionModal
        open={deductionOpen}
        privateUserId={privateUserId}
        onClose={() => setDeductionOpen(false)}
        onCreated={() => {
          setDeductionOpen(false);
          refresh();
        }}
      />
    </div>
  );
}


// ---------------------------------------------------------------------------
// Additional duty modal (#18) — no component picker; the server provisions the
// company's "Additional duty" component and books the grant against it.
// ---------------------------------------------------------------------------


function AdditionalDutyModal({
  open,
  privateUserId,
  onClose,
  onCreated,
}: {
  open: boolean;
  privateUserId: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const today = useMemo(() => new Date(), []);
  const [amount, setAmount] = useState("");
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setAmount("");
      setYear(today.getFullYear());
      setMonth(today.getMonth() + 1);
      setNotes("");
    }
  }, [open, today]);

  const monthOptions = useMemo(() => {
    const out: { value: string; label: string; year: number; month: number }[] = [];
    for (let offset = -2; offset <= 11; offset++) {
      const d = new Date(today.getFullYear(), today.getMonth() + offset, 1);
      out.push({
        value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        label: d.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
        year: d.getFullYear(),
        month: d.getMonth() + 1,
      });
    }
    return out;
  }, [today]);

  if (!open) return null;

  async function handleSubmit() {
    const n = Number(amount);
    if (!amount.trim() || isNaN(n) || n <= 0) {
      toast.error("Enter a positive amount");
      return;
    }
    setLoading(true);
    const r = await oneOffAllowances.grantAdditionalRemuneration(privateUserId, {
      amount: amount.trim(),
      payable_in_year: year,
      payable_in_month: month,
      notes: notes.trim() || undefined,
    });
    setLoading(false);
    if (isError(r)) {
      toast.error(r.error);
      return;
    }
    toast.success("Additional duty pay granted");
    onCreated();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-md flex flex-col">
        <div className="flex items-center justify-between border-b border-zinc-100 dark:border-gray-800 px-5 py-3.5">
          <h2 className="inline-flex items-center gap-2 text-base font-semibold text-zinc-900 dark:text-white">
            <HandCoins className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            Additional duty pay
          </h2>
          <button onClick={onClose} className="text-zinc-400 dark:text-gray-500 hover:text-zinc-600 dark:hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          <p className="text-xs text-zinc-500 dark:text-gray-400">
            A one-time taxable payment for extra duties in the selected month. It
            flows into that month&apos;s payroll run and the worker&apos;s estimate as
            an earning line — it does not change their basic salary or profile.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wide mb-1">Amount</label>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 2000.00"
                className="w-full rounded-md border border-zinc-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 px-3 py-2 text-sm tabular-nums text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wide mb-1">Payable in</label>
              <select
                value={`${year}-${String(month).padStart(2, "0")}`}
                onChange={(e) => {
                  const [y, m] = e.target.value.split("-").map(Number);
                  setYear(y);
                  setMonth(m);
                }}
                className="w-full rounded-md border border-zinc-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {monthOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wide mb-1">
              Notes <span className="text-zinc-400 dark:text-gray-500 text-xs">(optional)</span>
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Covered the warehouse shift"
              className="w-full rounded-md border border-zinc-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 dark:border-gray-800 px-5 py-3.5">
          <button onClick={onClose} className="rounded-md border border-zinc-200 dark:border-gray-700 px-4 py-2 text-sm text-zinc-700 dark:text-gray-200 hover:bg-zinc-50 dark:hover:bg-gray-800">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Grant
          </button>
        </div>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Ad-hoc deduction modal — mirrors AdditionalDutyModal for the deduction
// side. No component picker; the server provisions the company's "Ad-hoc
// deduction" component and books the grant against it. Notes are required
// since the component label stays generic on purpose.
// ---------------------------------------------------------------------------


function AdHocDeductionModal({
  open,
  privateUserId,
  onClose,
  onCreated,
}: {
  open: boolean;
  privateUserId: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const today = useMemo(() => new Date(), []);
  const [amount, setAmount] = useState("");
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setAmount("");
      setYear(today.getFullYear());
      setMonth(today.getMonth() + 1);
      setNotes("");
    }
  }, [open, today]);

  const monthOptions = useMemo(() => {
    const out: { value: string; label: string; year: number; month: number }[] = [];
    for (let offset = -2; offset <= 11; offset++) {
      const d = new Date(today.getFullYear(), today.getMonth() + offset, 1);
      out.push({
        value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        label: d.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
        year: d.getFullYear(),
        month: d.getMonth() + 1,
      });
    }
    return out;
  }, [today]);

  if (!open) return null;

  async function handleSubmit() {
    const n = Number(amount);
    if (!amount.trim() || isNaN(n) || n <= 0) {
      toast.error("Enter a positive amount");
      return;
    }
    if (!notes.trim()) {
      toast.error("Explain why this deduction is being applied");
      return;
    }
    setLoading(true);
    const r = await oneOffAllowances.grantAdHocDeduction(privateUserId, {
      amount: amount.trim(),
      payable_in_year: year,
      payable_in_month: month,
      notes: notes.trim(),
    });
    setLoading(false);
    if (isError(r)) {
      toast.error(r.error);
      return;
    }
    toast.success("Deduction scheduled");
    onCreated();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-md flex flex-col">
        <div className="flex items-center justify-between border-b border-zinc-100 dark:border-gray-800 px-5 py-3.5">
          <h2 className="inline-flex items-center gap-2 text-base font-semibold text-zinc-900 dark:text-white">
            <MinusCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
            Ad-hoc deduction
          </h2>
          <button onClick={onClose} className="text-zinc-400 dark:text-gray-500 hover:text-zinc-600 dark:hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          <p className="text-xs text-zinc-500 dark:text-gray-400">
            A one-time deduction from this employee&apos;s pay in the selected
            month. It flows into that month&apos;s payroll run and the
            worker&apos;s estimate as a deduction line — it does not change
            their salary structure or profile.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wide mb-1">Amount</label>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 500.00"
                className="w-full rounded-md border border-zinc-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 px-3 py-2 text-sm tabular-nums text-right focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wide mb-1">Payable in</label>
              <select
                value={`${year}-${String(month).padStart(2, "0")}`}
                onChange={(e) => {
                  const [y, m] = e.target.value.split("-").map(Number);
                  setYear(y);
                  setMonth(m);
                }}
                className="w-full rounded-md border border-zinc-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                {monthOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wide mb-1">
              Notes <span className="text-red-500">(required)</span>
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Till shortfall on 12 July, agreed with employee"
              className="w-full rounded-md border border-zinc-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 dark:border-gray-800 px-5 py-3.5">
          <button onClick={onClose} className="rounded-md border border-zinc-200 dark:border-gray-700 px-4 py-2 text-sm text-zinc-700 dark:text-gray-200 hover:bg-zinc-50 dark:hover:bg-gray-800">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Schedule modal
// ---------------------------------------------------------------------------


interface ModalProps {
  open: boolean;
  privateUserId: number;
  components: SalaryComponent[];
  onClose: () => void;
  onCreated: () => void;
}


function ScheduleModal({ open, privateUserId, components, onClose, onCreated }: ModalProps) {
  const today = useMemo(() => new Date(), []);
  const [componentId, setComponentId] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setComponentId(components[0]?.id ?? null);
      setAmount("");
      // Default to next month — most one-offs are scheduled forward
      const next = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      setYear(next.getFullYear());
      setMonth(next.getMonth() + 1);
      setNotes("");
    }
  }, [open, components, today]);

  // Hooks must be declared before any early return; React reconciles by
  // index, so a hook only invoked when open=true tripps the prod
  // minified error #310 the moment open flips.
  const monthOptions = useMemo(() => {
    const out: { value: string; label: string; year: number; month: number }[] = [];
    for (let offset = -2; offset <= 11; offset++) {
      const d = new Date(today.getFullYear(), today.getMonth() + offset, 1);
      out.push({
        value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        label: d.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
        year: d.getFullYear(),
        month: d.getMonth() + 1,
      });
    }
    return out;
  }, [today]);

  if (!open) return null;

  async function handleSubmit() {
    if (componentId == null) {
      toast.error("Pick a component");
      return;
    }
    if (!amount.trim() || isNaN(Number(amount))) {
      toast.error("Enter a numeric amount");
      return;
    }
    setLoading(true);
    const r = await oneOffAllowances.create({
      private_user_id: privateUserId,
      component_id: componentId,
      amount: amount.trim(),
      payable_in_year: year,
      payable_in_month: month,
      notes: notes.trim() || undefined,
    });
    setLoading(false);
    if (isError(r)) {
      toast.error(r.error);
      return;
    }
    toast.success("Scheduled");
    onCreated();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-zinc-100 dark:border-gray-800 px-5 py-3.5">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-white">Schedule one-off allowance</h2>
          <button onClick={onClose} className="text-zinc-400 dark:text-gray-500 hover:text-zinc-600 dark:hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wide mb-1">Component</label>
            <select
              value={componentId ?? ""}
              onChange={(e) => setComponentId(e.target.value ? Number(e.target.value) : null)}
              className="w-full rounded-md border border-zinc-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {components.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.label} ({c.kind})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wide mb-1">Amount</label>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 5000.00"
                className="w-full rounded-md border border-zinc-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 px-3 py-2 text-sm tabular-nums text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wide mb-1">Payable in</label>
              <select
                value={`${year}-${String(month).padStart(2, "0")}`}
                onChange={(e) => {
                  const [y, m] = e.target.value.split("-").map(Number);
                  setYear(y);
                  setMonth(m);
                }}
                className="w-full rounded-md border border-zinc-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {monthOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wide mb-1">
              Notes <span className="text-zinc-400 dark:text-gray-500 text-xs">(optional)</span>
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Q2 performance bonus"
              className="w-full rounded-md border border-zinc-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 dark:border-gray-800 px-5 py-3.5">
          <button onClick={onClose} className="rounded-md border border-zinc-200 dark:border-gray-700 px-4 py-2 text-sm text-zinc-700 dark:text-gray-200 hover:bg-zinc-50 dark:hover:bg-gray-800">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Schedule
          </button>
        </div>
      </div>
    </div>
  );
}
