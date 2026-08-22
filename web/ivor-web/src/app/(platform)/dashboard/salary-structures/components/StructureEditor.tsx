"use client";

import { useState } from "react";
import {
  salaryStructures,
  type SalaryComponent,
  type SalaryStructureCreate,
  type SalaryStructureLineCreate,
} from "@/services/payroll-api";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, X } from "lucide-react";


function isError<T>(v: T | { error: string; status?: number }): v is { error: string; status?: number } {
  return typeof v === "object" && v !== null && "error" in v;
}


type LineDraft = {
  componentId: number | null;
  mode: "amount" | "formula";
  amount: string;
  formula: string;
};


function emptyLine(): LineDraft {
  return { componentId: null, mode: "amount", amount: "", formula: "" };
}


interface Props {
  open: boolean;
  companyId: number;
  components: SalaryComponent[];
  onClose: () => void;
  onCreated: () => void;
}


export default function StructureEditor({ open, companyId, components, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [defaultRole, setDefaultRole] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  function addLine() {
    setLines([...lines, emptyLine()]);
  }
  function removeLine(idx: number) {
    setLines(lines.filter((_, i) => i !== idx));
  }
  function updateLine(idx: number, patch: Partial<LineDraft>) {
    setLines(lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  async function handleSubmit() {
    if (!name.trim()) {
      toast.error("Structure name is required");
      return;
    }
    if (lines.length === 0) {
      toast.error("At least one line is required");
      return;
    }

    const cleanLines: SalaryStructureLineCreate[] = [];
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (ln.componentId == null) {
        toast.error(`Line ${i + 1}: pick a component`);
        return;
      }
      if (ln.mode === "amount") {
        if (!ln.amount.trim() || isNaN(Number(ln.amount))) {
          toast.error(`Line ${i + 1}: enter a numeric amount`);
          return;
        }
        cleanLines.push({
          component_id: ln.componentId,
          amount: ln.amount,
          formula_expression: null,
          order_index: i,
        });
      } else {
        if (!ln.formula.trim()) {
          toast.error(`Line ${i + 1}: enter a formula`);
          return;
        }
        cleanLines.push({
          component_id: ln.componentId,
          amount: null,
          formula_expression: ln.formula.trim(),
          order_index: i,
        });
      }
    }

    setLoading(true);
    const payload: SalaryStructureCreate = {
      name: name.trim(),
      description: description.trim() || null,
      is_default: isDefault,
      default_for_department_id: null,
      default_for_role: defaultRole.trim() || null,
      default_for_sector_grade_id: null,
      lines: cleanLines,
    };
    const r = await salaryStructures.createStructure(companyId, payload);
    setLoading(false);
    if (isError(r)) {
      toast.error(r.error);
      return;
    }
    toast.success(`Structure "${r.name}" created`);
    setName("");
    setDescription("");
    setDefaultRole("");
    setIsDefault(false);
    setLines([emptyLine()]);
    onCreated();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-zinc-100 dark:border-gray-800 px-6 py-4">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">New salary structure</h2>
          <button onClick={onClose} className="text-zinc-400 dark:text-gray-500 hover:text-zinc-600 dark:hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-gray-200 mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Sales-Junior"
                className="w-full rounded-md border border-zinc-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-gray-200 mb-1">
                Default role <span className="text-zinc-400 dark:text-gray-500 text-xs">(optional)</span>
              </label>
              <input
                type="text"
                value={defaultRole}
                onChange={(e) => setDefaultRole(e.target.value)}
                placeholder="e.g. employee, manager"
                className="w-full rounded-md border border-zinc-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-gray-200 mb-1">
              Description <span className="text-zinc-400 dark:text-gray-500 text-xs">(optional)</span>
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-md border border-zinc-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-gray-200">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
            Use as the company-wide default (auto-suggested when no scope match found)
          </label>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-zinc-700 dark:text-gray-200 uppercase tracking-wide">Lines</h3>
              <button
                type="button"
                onClick={addLine}
                className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
              >
                <Plus className="h-3.5 w-3.5" /> Add line
              </button>
            </div>
            <p className="text-xs text-zinc-500 dark:text-gray-400 mb-3">
              Each line maps a component to either a constant amount or a formula expression.
              Formulas can reference other component codes (e.g. <code className="bg-zinc-100 dark:bg-gray-800 px-1 rounded">BASIC * 0.10</code>) and the
              built-in <code className="bg-zinc-100 dark:bg-gray-800 px-1 rounded">period_days</code> variable.
              Whitelisted functions: <code className="bg-zinc-100 dark:bg-gray-800 px-1 rounded">min</code>, <code className="bg-zinc-100 dark:bg-gray-800 px-1 rounded">max</code>, <code className="bg-zinc-100 dark:bg-gray-800 px-1 rounded">round</code>, <code className="bg-zinc-100 dark:bg-gray-800 px-1 rounded">abs</code>.
            </p>

            <div className="space-y-2">
              {lines.map((ln, idx) => (
                <div key={idx} className="flex items-start gap-2 rounded-md border border-zinc-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3">
                  <div className="flex-1 grid grid-cols-2 gap-2">
                    <select
                      value={ln.componentId ?? ""}
                      onChange={(e) => updateLine(idx, { componentId: e.target.value ? Number(e.target.value) : null })}
                      className="rounded-md border border-zinc-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">-- pick component --</option>
                      {components.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} ({c.label})
                        </option>
                      ))}
                    </select>

                    <div className="flex items-center gap-2">
                      <select
                        value={ln.mode}
                        onChange={(e) => updateLine(idx, { mode: e.target.value as "amount" | "formula" })}
                        className="rounded-md border border-zinc-200 dark:border-gray-700 px-2 py-1.5 text-sm bg-zinc-50 dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="amount">amount</option>
                        <option value="formula">formula</option>
                      </select>
                      {ln.mode === "amount" ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          value={ln.amount}
                          onChange={(e) => updateLine(idx, { amount: e.target.value })}
                          placeholder="30000.00"
                          className="flex-1 rounded-md border border-zinc-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 px-2 py-1.5 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      ) : (
                        <input
                          type="text"
                          value={ln.formula}
                          onChange={(e) => updateLine(idx, { formula: e.target.value })}
                          placeholder="BASIC * 0.10"
                          className="flex-1 rounded-md border border-zinc-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => removeLine(idx)}
                    disabled={lines.length === 1}
                    className="text-zinc-400 dark:text-gray-500 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed mt-1"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 dark:border-gray-800 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-md border border-zinc-200 dark:border-gray-700 px-4 py-2 text-sm text-zinc-700 dark:text-gray-200 hover:bg-zinc-50 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Create structure
          </button>
        </div>
      </div>
    </div>
  );
}
