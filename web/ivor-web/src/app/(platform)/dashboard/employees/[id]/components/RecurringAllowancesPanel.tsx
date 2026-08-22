"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  salaryStructures,
  type EmployeeSalaryAssignment,
  type EmployeeSalaryOverrideCreate,
  type ResolvedComponent,
  type SalaryComponent,
} from "@/services/payroll-api";
import { Coins, Loader2, MinusCircle, PiggyBank, Pencil, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { isError, formatMoney as fmtMoneyBase } from "@/utils/payrollFormat";
import { useCompanyCurrency } from "@/hooks/useCompanyCurrency";

function formatMoney(amount: string, currency: string): string {
  return fmtMoneyBase(amount, currency, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

interface Props {
  privateUserId: number;
  companyId: number;
}

/**
 * Recurring allowances & deductions on an employee's own salary profile.
 *
 * The company-wide Salary Structures page already lets admins template
 * components; this panel is the per-employee add/remove/edit surface that
 * was missing — it composes a new EmployeeSalaryAssignment carrying forward
 * the employee's existing overrides plus the one being changed (the backend
 * has no PATCH/DELETE for a single override — effective-dated assignments
 * are the model, so "edit" = supersede with a fresh one).
 */
export default function RecurringAllowancesPanel({ privateUserId, companyId }: Props) {
  // Currency is server-authoritative (company country). The resolved preview
  // sets it below; seed with the company currency so nothing flashes "MUR".
  const { currency: companyCurrency } = useCompanyCurrency();
  const [components, setComponents] = useState<ResolvedComponent[]>([]);
  const [catalog, setCatalog] = useState<SalaryComponent[]>([]);
  const [assignment, setAssignment] = useState<EmployeeSalaryAssignment | null>(null);
  const [currency, setCurrency] = useState(companyCurrency);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ component: SalaryComponent | ResolvedComponent | null; mode: "add" | "edit" } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [preview, comps, active] = await Promise.all([
      salaryStructures.preview(privateUserId),
      salaryStructures.listComponents(companyId),
      salaryStructures.getActiveAssignment(privateUserId),
    ]);
    if (!isError(preview)) {
      setComponents(preview.components.filter((c) => !c.is_basic));
      setCurrency(preview.currency);
    }
    setCatalog(isError(comps) ? [] : comps);
    setAssignment(isError(active) ? null : active);
    setLoading(false);
  }, [privateUserId, companyId]);

  useEffect(() => { refresh(); }, [refresh]);

  const earnings = useMemo(() => components.filter((c) => c.kind === "earning"), [components]);
  const deductions = useMemo(() => components.filter((c) => c.kind === "deduction"), [components]);

  // Components not already resolved for this employee — candidates for "Add".
  const availableToAdd = useMemo(() => {
    const present = new Set(components.map((c) => c.component_id));
    return catalog.filter((c) => !c.is_basic && !present.has(c.id));
  }, [catalog, components]);

  /** Compose + submit a new assignment: existing overrides, minus/plus the one changed. */
  async function submitOverride(componentId: number, amount: string) {
    const carried: EmployeeSalaryOverrideCreate[] = (assignment?.overrides ?? [])
      .filter((o) => o.component_id !== componentId)
      .map((o) => ({ component_id: o.component_id, amount: o.amount, formula_expression: o.formula_expression, notes: o.notes }));
    carried.push({ component_id: componentId, amount, formula_expression: null, notes: null });

    const r = await salaryStructures.createAssignment(privateUserId, {
      private_user_id: privateUserId,
      structure_id: assignment?.structure_id ?? null,
      currency: assignment?.currency ?? currency,
      effective_from: todayISO(),
      overrides: carried,
    });
    if (isError(r)) {
      toast.error(r.error);
      return false;
    }
    return true;
  }

  async function handleRemove(c: ResolvedComponent) {
    if (!confirm(`Remove "${c.label}" from this employee's pay? This takes effect from today.`)) return;
    const ok = await submitOverride(c.component_id, "0.00");
    if (ok) {
      toast.success(`${c.label} removed`);
      refresh();
    }
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500 dark:text-gray-400">
            <Coins size={15} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Allowances & deductions</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Recurring pay components on top of base salary. Changes take effect from today.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setEditing({ component: null, mode: "add" })}
          disabled={availableToAdd.length === 0}
          title={availableToAdd.length === 0 ? "No more components available — define one in Salary Structures → Components" : ""}
          className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </button>
      </div>

      <div className="p-5 space-y-4">
        {loading ? (
          <div className="text-center py-6 text-sm text-zinc-400 dark:text-gray-500">Loading…</div>
        ) : earnings.length === 0 && deductions.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-gray-400 text-center py-4">
            No recurring allowances or deductions configured beyond base salary.
          </p>
        ) : (
          <>
            <ComponentGroup
              title="Allowances"
              icon={<PiggyBank className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />}
              rows={earnings}
              currency={currency}
              onEdit={(c) => setEditing({ component: c, mode: "edit" })}
              onRemove={handleRemove}
            />
            <ComponentGroup
              title="Deductions"
              icon={<MinusCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />}
              rows={deductions}
              currency={currency}
              onEdit={(c) => setEditing({ component: c, mode: "edit" })}
              onRemove={handleRemove}
            />
          </>
        )}
      </div>

      <ComponentModal
        state={editing}
        currency={currency}
        catalog={availableToAdd}
        onClose={() => setEditing(null)}
        onSubmit={async (componentId, amount) => {
          const ok = await submitOverride(componentId, amount);
          if (ok) {
            toast.success("Saved");
            setEditing(null);
            refresh();
          }
        }}
      />
    </div>
  );
}

function ComponentGroup({
  title, icon, rows, currency, onEdit, onRemove,
}: {
  title: string;
  icon: React.ReactNode;
  rows: ResolvedComponent[];
  currency: string;
  onEdit: (c: ResolvedComponent) => void;
  onRemove: (c: ResolvedComponent) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wide">
        {icon} {title}
      </div>
      <div className="bg-gray-50 dark:bg-gray-800/60 rounded-xl divide-y divide-gray-100 dark:divide-gray-700">
        {rows.map((c) => (
          <div key={c.component_id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                {c.label}
                {c.frequency === "daily" && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-400 text-[10px] font-medium align-middle">daily</span>
                )}
                {c.value_type === "percent_of_basic" && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded bg-pink-50 dark:bg-pink-950/40 text-pink-700 dark:text-pink-400 text-[10px] font-medium align-middle">% of basic</span>
                )}
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 font-mono">
                {c.code}
                {c.frequency === "daily" && typeof c.meta?.rate === "string" && typeof c.meta?.days === "number" && (
                  <span className="ml-1.5 font-sans">· {formatMoney(c.meta.rate, currency)}/day × {c.meta.days} days</span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-sm tabular-nums text-gray-900 dark:text-gray-100">{formatMoney(c.amount, currency)}</span>
              <button type="button" onClick={() => onEdit(c)} title="Edit amount" className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => onRemove(c)} title="Remove" className="text-gray-400 hover:text-red-600">
                <MinusCircle className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ComponentModal({
  state, currency, catalog, onClose, onSubmit,
}: {
  state: { component: SalaryComponent | ResolvedComponent | null; mode: "add" | "edit" } | null;
  currency: string;
  catalog: SalaryComponent[];
  onClose: () => void;
  onSubmit: (componentId: number, amount: string) => Promise<void>;
}) {
  const [componentId, setComponentId] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!state) return;
    if (state.mode === "edit" && state.component) {
      const c = state.component as ResolvedComponent;
      setComponentId(c.component_id);
      // c.amount is the fully-RESOLVED total (daily rate × working days, or
      // percent-of-basic × basic) — editing/resubmitting that would silently
      // inflate a daily/percent component on save. The raw per-unit value the
      // override actually stores is preserved in `meta` for exactly this.
      if (c.frequency === "daily" && typeof c.meta?.rate === "string") {
        setAmount(c.meta.rate);
      } else if (c.value_type === "percent_of_basic" && typeof c.meta?.percent === "string") {
        setAmount(c.meta.percent);
      } else {
        setAmount(c.amount);
      }
    } else {
      setComponentId(catalog[0]?.id ?? null);
      setAmount("");
    }
  }, [state, catalog]);

  if (!state) return null;
  const isEdit = state.mode === "edit";
  const editTarget = isEdit ? (state.component as ResolvedComponent) : null;
  const selectedCatalogComponent = !isEdit ? catalog.find((c) => c.id === componentId) : null;
  const frequency = isEdit ? editTarget?.frequency : selectedCatalogComponent?.frequency;
  const valueType = isEdit ? editTarget?.value_type : selectedCatalogComponent?.value_type;
  const amountLabel =
    valueType === "percent_of_basic"
      ? "Percentage of basic (e.g. 5 = 5%)"
      : frequency === "daily"
        ? `Amount (${currency}/day)`
        : `Amount (${currency}/month)`;

  async function handleSubmit() {
    if (componentId == null) {
      toast.error("Pick a component");
      return;
    }
    if (!amount.trim() || isNaN(Number(amount)) || Number(amount) < 0) {
      toast.error("Enter a non-negative amount");
      return;
    }
    setSubmitting(true);
    await onSubmit(componentId, Number(amount).toFixed(2));
    setSubmitting(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between border-b border-zinc-100 dark:border-gray-800 px-5 py-3.5">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
            {isEdit ? "Edit amount" : "Add allowance or deduction"}
          </h2>
          <button onClick={onClose} className="text-zinc-400 dark:text-gray-500 hover:text-zinc-600 dark:hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 py-5 space-y-4">
          {isEdit ? (
            <div>
              <p className="text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wide mb-1">Component</p>
              <p className="text-sm text-zinc-900 dark:text-white">{editTarget?.label} <span className="text-zinc-400 font-mono text-xs">{editTarget?.code}</span></p>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wide mb-1">Component</label>
              <select
                value={componentId ?? ""}
                onChange={(e) => setComponentId(e.target.value ? Number(e.target.value) : null)}
                className="w-full rounded-md border border-zinc-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {catalog.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.label} ({c.kind})
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wide mb-1">
              {amountLabel}
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 1500.00"
              className="w-full rounded-md border border-zinc-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 px-3 py-2 text-sm tabular-nums text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 dark:border-gray-800 px-5 py-3.5">
          <button onClick={onClose} className="rounded-md border border-zinc-200 dark:border-gray-700 px-4 py-2 text-sm text-zinc-700 dark:text-gray-200 hover:bg-zinc-50 dark:hover:bg-gray-800">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
