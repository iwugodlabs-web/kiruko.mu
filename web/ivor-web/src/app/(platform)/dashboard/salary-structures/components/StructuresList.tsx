"use client";

import { useCallback, useEffect, useState } from "react";
import {
  salaryStructures,
  type SalaryComponent,
  type SalaryStructure,
  type SalaryStructureLine,
} from "@/services/payroll-api";
import { toast } from "sonner";
import {
  Plus,
  RefreshCcw,
  Star,
  ChevronDown,
  ChevronRight,
  Pencil,
  Check,
  Trash2,
  Archive,
  RotateCcw,
} from "lucide-react";
import StructureEditor from "./StructureEditor";
import { getDepartments } from "@/services/api";


function isError<T>(v: T | { error: string; status?: number }): v is { error: string; status?: number } {
  return typeof v === "object" && v !== null && "error" in v;
}


// ---------------------------------------------------------------------------
// Usage-warning modal — shown before destructive line edits / structure archive.
// Backend returns the count; UI just confirms intent.
// ---------------------------------------------------------------------------

type ConfirmIntent = "delete-line" | "edit-line-amount" | "archive-structure";

interface UsageGate {
  intent: ConfirmIntent;
  structureId: number;
  structureName: string;
  lineId?: number;
  proceed: () => Promise<void>;
}

function UsageWarningModal({
  gate,
  companyId,
  onClose,
}: {
  gate: UsageGate | null;
  companyId: number;
  onClose: () => void;
}) {
  const [usage, setUsage] = useState<{
    active_assignment_count: number;
    total_assignment_count: number;
    sample_employee_names: string[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!gate) {
      setUsage(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const r = await salaryStructures.getStructureUsage(companyId, gate.structureId);
      if (!cancelled) {
        if (isError(r)) {
          // Non-fatal — show modal anyway with unknown count.
          setUsage({
            active_assignment_count: -1,
            total_assignment_count: -1,
            sample_employee_names: [],
          });
        } else {
          setUsage(r);
        }
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [gate, companyId]);

  if (!gate) return null;

  const verb = {
    "delete-line": "remove this line",
    "edit-line-amount": "change this line's amount",
    "archive-structure": "archive this structure",
  }[gate.intent];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-zinc-100 dark:border-gray-800">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-white">
            About to {verb}
          </h3>
          <p className="text-sm text-zinc-500 dark:text-gray-400 mt-1">
            <span className="font-mono">{gate.structureName}</span>
          </p>
        </div>
        <div className="px-6 py-4 space-y-3 text-sm text-zinc-700 dark:text-gray-200">
          {loading || !usage ? (
            <p className="text-zinc-400 dark:text-gray-500">Checking how many employees this affects…</p>
          ) : usage.active_assignment_count < 0 ? (
            <p className="text-amber-700 dark:text-amber-400">
              Could not check usage. Continue with caution.
            </p>
          ) : usage.active_assignment_count === 0 ? (
            <p>No employees currently use this structure. Safe to proceed.</p>
          ) : (
            <>
              <p>
                <strong>{usage.active_assignment_count}</strong> employee
                {usage.active_assignment_count === 1 ? "" : "s"} currently
                use this structure.
              </p>
              {usage.sample_employee_names.length > 0 && (
                <p className="text-xs text-zinc-500 dark:text-gray-400">
                  e.g. {usage.sample_employee_names.slice(0, 3).join(", ")}
                  {usage.active_assignment_count > 3 ? `, +${usage.active_assignment_count - 3} more` : ""}
                </p>
              )}
              <p className="text-xs text-zinc-500 dark:text-gray-400 leading-relaxed">
                Their existing assignments are unaffected — the salary they
                see today is frozen in a snapshot taken when the assignment
                was created. Only assignments created <em>after</em> this
                change will reflect the new shape.
              </p>
            </>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 dark:border-gray-800 px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border border-zinc-200 dark:border-gray-700 px-3 py-1.5 text-sm text-zinc-700 dark:text-gray-200 hover:bg-zinc-50 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={async () => {
              setSubmitting(true);
              await gate.proceed();
              setSubmitting(false);
              onClose();
            }}
            disabled={submitting}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {submitting ? "…" : "Proceed"}
          </button>
        </div>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Per-line row — view + inline edit + remove.
// ---------------------------------------------------------------------------

function LineRow({
  companyId,
  structureId,
  line,
  componentLabel,
  onChangedNeedConfirm,
  onChanged,
  onDeleteRequested,
}: {
  companyId: number;
  structureId: number;
  line: SalaryStructureLine;
  componentLabel: string | null;
  onChangedNeedConfirm: (proceed: () => Promise<void>) => void;
  onChanged: () => void;
  onDeleteRequested: () => void;
}) {
  const [editingAmount, setEditingAmount] = useState(false);
  const [draftAmount, setDraftAmount] = useState<string>(
    line.amount != null ? String(line.amount) : "",
  );
  const [saving, setSaving] = useState(false);
  const code = line.component_code ?? `#${line.component_id}`;

  function startEditAmount() {
    if (line.formula_expression) {
      // Lines with formulas are edited in the editor modal (not inline).
      toast.info("Formula lines are edited via the structure editor");
      return;
    }
    setDraftAmount(line.amount != null ? String(line.amount) : "");
    setEditingAmount(true);
  }

  async function commitAmount() {
    const trimmed = draftAmount.trim();
    if (!trimmed || isNaN(Number(trimmed))) {
      toast.error("Enter a numeric amount");
      return;
    }
    if (Number(trimmed) === Number(line.amount)) {
      setEditingAmount(false);
      return;
    }
    onChangedNeedConfirm(async () => {
      setSaving(true);
      const r = await salaryStructures.patchStructureLine(
        companyId, structureId, line.id, { amount: trimmed },
      );
      setSaving(false);
      if (isError(r)) {
        toast.error(r.error);
        return;
      }
      toast.success(`${code} amount updated`);
      setEditingAmount(false);
      onChanged();
    });
  }

  return (
    <tr className="border-t border-zinc-100 dark:border-gray-800 group">
      <td className="py-1.5 font-mono text-xs text-zinc-700 dark:text-gray-200">{code}</td>
      <td className="py-1.5 text-zinc-600 dark:text-gray-400 text-xs">{componentLabel ?? "—"}</td>
      <td className="py-1.5 text-right tabular-nums">
        {editingAmount ? (
          <input
            type="text"
            inputMode="decimal"
            value={draftAmount}
            onChange={(e) => setDraftAmount(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") commitAmount();
              if (e.key === "Escape") setEditingAmount(false);
            }}
            className="w-32 rounded border border-blue-300 px-2 py-0.5 text-right text-xs"
          />
        ) : line.amount != null ? (
          <span className="text-zinc-900 dark:text-white">
            {Number(line.amount).toLocaleString("en-MU", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        ) : line.formula_expression ? (
          <code className="text-xs bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded">
            {line.formula_expression}
          </code>
        ) : (
          <span className="text-zinc-400 dark:text-gray-500 italic text-xs">empty</span>
        )}
      </td>
      <td className="py-1.5 pl-2 w-16">
        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition">
          {editingAmount ? (
            <button
              type="button"
              onClick={commitAmount}
              disabled={saving}
              title="Save"
              className="text-blue-600 hover:text-blue-800 disabled:opacity-40"
            >
              <Check className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={startEditAmount}
              title="Edit amount"
              className="text-zinc-400 dark:text-gray-500 hover:text-blue-600"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onDeleteRequested}
            title="Remove line"
            className="text-zinc-400 dark:text-gray-500 hover:text-red-600"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}


// ---------------------------------------------------------------------------
// Structure card — header (rename/archive) + expandable line table.
// ---------------------------------------------------------------------------

function StructureCard({
  s,
  companyId,
  expanded,
  onToggle,
  componentByCode,
  deptNameById,
  onChangedNeedConfirm,
  refresh,
}: {
  s: SalaryStructure;
  companyId: number;
  expanded: boolean;
  onToggle: () => void;
  componentByCode: Map<string, SalaryComponent>;
  deptNameById: Map<number, string>;
  onChangedNeedConfirm: (gate: UsageGate) => void;
  refresh: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(s.name);
  const [savingRename, setSavingRename] = useState(false);

  const archived = !!s.archived_at;

  async function commitRename() {
    if (!draftName.trim() || draftName === s.name) {
      setRenaming(false);
      setDraftName(s.name);
      return;
    }
    setSavingRename(true);
    const r = await salaryStructures.patchStructure(
      companyId, s.id, { name: draftName.trim() },
    );
    setSavingRename(false);
    if (isError(r)) {
      toast.error(r.error);
      return;
    }
    toast.success("Renamed");
    setRenaming(false);
    refresh();
  }

  function archive() {
    onChangedNeedConfirm({
      intent: "archive-structure",
      structureId: s.id,
      structureName: s.name,
      proceed: async () => {
        const r = await salaryStructures.archiveStructure(companyId, s.id);
        if (isError(r)) { toast.error(r.error); return; }
        toast.success(`Archived "${s.name}"`);
        refresh();
      },
    });
  }

  async function restore() {
    const r = await salaryStructures.restoreStructure(companyId, s.id);
    if (isError(r)) { toast.error(r.error); return; }
    toast.success(`Restored "${s.name}"`);
    refresh();
  }

  return (
    <div className={`rounded-lg border overflow-hidden ${archived ? "border-amber-200 dark:border-amber-900 bg-amber-50/30 dark:bg-amber-950/20" : "border-zinc-200 dark:border-gray-800 bg-white dark:bg-gray-900"}`}>
      <div className="flex items-start justify-between px-4 py-3 hover:bg-zinc-50/50 dark:hover:bg-gray-800">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-start gap-3 flex-1 text-left"
        >
          {expanded ? <ChevronDown className="h-4 w-4 mt-1 text-zinc-400 dark:text-gray-500" /> : <ChevronRight className="h-4 w-4 mt-1 text-zinc-400 dark:text-gray-500" />}
          <div className="flex-1">
            <div className="flex items-center gap-2">
              {renaming ? (
                <input
                  type="text"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.stopPropagation(); commitRename(); }
                    if (e.key === "Escape") { e.stopPropagation(); setRenaming(false); setDraftName(s.name); }
                  }}
                  autoFocus
                  className="font-medium rounded border border-blue-300 px-2 py-0.5 text-sm"
                />
              ) : (
                <span className="font-medium text-zinc-900 dark:text-white">{s.name}</span>
              )}
              {s.is_default && (
                <span className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400 text-xs">
                  <Star className="h-3 w-3 fill-amber-400" /> default
                </span>
              )}
              {archived && (
                <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300 text-xs bg-amber-100 dark:bg-amber-500/15 px-2 py-0.5 rounded">
                  <Archive className="h-3 w-3" /> archived
                </span>
              )}
            </div>
            {s.description && <p className="text-xs text-zinc-500 dark:text-gray-400 mt-0.5">{s.description}</p>}
            <div className="flex items-center gap-3 mt-1 text-xs text-zinc-500 dark:text-gray-400">
              <span>{s.lines.length} line{s.lines.length !== 1 ? "s" : ""}</span>
              {s.default_for_department_id && (
                <span>
                  · dept: {deptNameById.get(s.default_for_department_id) ?? `#${s.default_for_department_id}`}
                </span>
              )}
              {s.default_for_role && <span>· role: {s.default_for_role}</span>}
              {/* Sector grades have no name lookup in this view; show the id. */}
              {s.default_for_sector_grade_id && <span>· grade #{s.default_for_sector_grade_id}</span>}
            </div>
          </div>
        </button>
        <div className="flex items-center gap-1 ml-2">
          {!archived && !renaming && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setRenaming(true); }}
              title="Rename"
              className="text-zinc-400 dark:text-gray-500 hover:text-blue-600 p-1"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          {renaming && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); commitRename(); }}
              disabled={savingRename}
              title="Save name"
              className="text-blue-600 hover:text-blue-800 p-1 disabled:opacity-40"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          )}
          {archived ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); restore(); }}
              title="Restore"
              className="text-zinc-400 dark:text-gray-500 hover:text-emerald-600 p-1"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); archive(); }}
              title="Archive"
              className="text-zinc-400 dark:text-gray-500 hover:text-amber-600 p-1"
            >
              <Archive className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-zinc-100 dark:border-gray-800 bg-zinc-50/30 dark:bg-gray-800/60 px-4 py-3">
          {s.lines.length === 0 ? (
            <p className="text-sm text-zinc-400 dark:text-gray-500 italic">No lines.</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-xs text-zinc-500 dark:text-gray-400 uppercase">
                  <th className="text-left py-1">Code</th>
                  <th className="text-left py-1">Component</th>
                  <th className="text-right py-1">Amount / Formula</th>
                  <th className="w-16" />
                </tr>
              </thead>
              <tbody>
                {[...s.lines].sort((a, b) => a.order_index - b.order_index).map((line) => {
                  const code = line.component_code ?? `#${line.component_id}`;
                  const comp = componentByCode.get(code);
                  return (
                    <LineRow
                      key={line.id}
                      companyId={companyId}
                      structureId={s.id}
                      line={line}
                      componentLabel={comp?.label ?? null}
                      onChangedNeedConfirm={(proceed) =>
                        onChangedNeedConfirm({
                          intent: "edit-line-amount",
                          structureId: s.id,
                          structureName: s.name,
                          lineId: line.id,
                          proceed,
                        })
                      }
                      onChanged={refresh}
                      onDeleteRequested={() =>
                        onChangedNeedConfirm({
                          intent: "delete-line",
                          structureId: s.id,
                          structureName: s.name,
                          lineId: line.id,
                          proceed: async () => {
                            const r = await salaryStructures.deleteStructureLine(
                              companyId, s.id, line.id,
                            );
                            if (isError(r)) { toast.error(r.error); return; }
                            toast.success("Line removed");
                            refresh();
                          },
                        })
                      }
                    />
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export default function StructuresList({ companyId }: { companyId: number }) {
  const [structures, setStructures] = useState<SalaryStructure[]>([]);
  const [components, setComponents] = useState<SalaryComponent[]>([]);
  const [departments, setDepartments] = useState<{ department_id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [showArchived, setShowArchived] = useState(false);
  const [confirmGate, setConfirmGate] = useState<UsageGate | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [structuresR, componentsR, departmentsR] = await Promise.all([
      salaryStructures.listStructures(companyId, { includeArchived: showArchived }),
      salaryStructures.listComponents(companyId),
      // Departments resolve the `default_for_department_id` label. Best-effort:
      // a failure just falls back to showing the id.
      getDepartments(companyId),
    ]);
    if (isError(structuresR)) {
      toast.error(structuresR.error);
      setStructures([]);
    } else {
      setStructures(structuresR);
    }
    if (isError(componentsR)) {
      toast.error(componentsR.error);
      setComponents([]);
    } else {
      setComponents(componentsR);
    }
    if (Array.isArray(departmentsR)) {
      setDepartments(departmentsR.map((d) => ({ department_id: d.department_id, name: d.name })));
    }
    setLoading(false);
  }, [companyId, showArchived]);

  useEffect(() => { refresh(); }, [refresh]);

  function toggleExpand(id: number) {
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpandedIds(next);
  }

  const componentByCode = new Map(components.map((c) => [c.code, c]));
  const deptNameById = new Map(departments.map((d) => [d.department_id, d.name]));

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-zinc-600 dark:text-gray-400">
          {structures.length} structure{structures.length !== 1 ? "s" : ""}.
          Each structure is a named template (e.g. Sales-Junior, Engineering-Senior) that
          employees are assigned to. Lines can be constants or formulas (e.g. <code className="text-xs bg-zinc-100 dark:bg-gray-800 px-1 py-0.5 rounded">BASIC * 0.10</code>).
        </p>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Show archived
          </label>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 dark:border-gray-700 px-3 py-2 text-sm text-zinc-700 dark:text-gray-200 hover:bg-zinc-50 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => setEditorOpen(true)}
            disabled={components.length === 0}
            title={components.length === 0 ? "Define at least one component first" : ""}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="h-4 w-4" />
            New structure
          </button>
        </div>
      </div>

      {loading && structures.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-12 text-center text-zinc-400 dark:text-gray-500">
          Loading...
        </div>
      ) : structures.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-12 text-center">
          <h3 className="text-base font-medium text-zinc-700 dark:text-gray-200">No structures yet</h3>
          <p className="text-sm text-zinc-500 dark:text-gray-400 mt-1">
            {components.length === 0
              ? "First, add at least one component on the Components tab."
              : "Create your first structure (e.g. Junior, Senior, Manager)."}
          </p>
          {components.length > 0 && (
            <button
              type="button"
              onClick={() => setEditorOpen(true)}
              className="mt-4 inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              New structure
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {structures.map((s) => (
            <StructureCard
              key={s.id}
              s={s}
              companyId={companyId}
              expanded={expandedIds.has(s.id)}
              onToggle={() => toggleExpand(s.id)}
              componentByCode={componentByCode}
              deptNameById={deptNameById}
              onChangedNeedConfirm={(gate) => setConfirmGate(gate)}
              refresh={refresh}
            />
          ))}
        </div>
      )}

      <StructureEditor
        open={editorOpen}
        companyId={companyId}
        components={components}
        onClose={() => setEditorOpen(false)}
        onCreated={() => {
          setEditorOpen(false);
          refresh();
        }}
      />

      <UsageWarningModal
        gate={confirmGate}
        companyId={companyId}
        onClose={() => setConfirmGate(null)}
      />
    </div>
  );
}
