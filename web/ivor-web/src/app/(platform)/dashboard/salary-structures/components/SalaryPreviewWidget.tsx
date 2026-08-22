"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { salaryStructures, type ResolvedSalary, type SalaryStructure } from "@/services/payroll-api";
import { fetchCompanyUsers, type User } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { useCompanyCurrency } from "@/hooks/useCompanyCurrency";
import { toast } from "sonner";
import { Eye, Loader2, Search, UserPlus, X } from "lucide-react";
import { isError, formatMoney as fmtMoneyBase } from "@/utils/payrollFormat";


function todayISO(): string {
    return new Date().toISOString().slice(0, 10);
}

function fmtDate(iso: string): string {
    try { return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
    catch { return iso; }
}

function formatMoney(amount: string, currency: string): string {
    return fmtMoneyBase(amount, currency, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// The backend returns `private_user_id` nested under `private_user`, not at
// the top level (see SalariesSection.tsx for the established read path).
// Centralize the lookup so every consumer in this file agrees.
function privateIdOf(u: User): number | undefined {
    return u.private_user?.private_user_id ?? u.private_user_id;
}

function nameOf(u: User): string {
    const first = u.private_user?.first_name?.trim() ?? "";
    const last = u.private_user?.last_name?.trim() ?? "";
    const full = `${first} ${last}`.trim();
    return full || u.user_name || u.email || `Employee #${privateIdOf(u) ?? u.user_id}`;
}


const SOURCE_PILL: Record<string, string> = {
    structure: "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300",
    override: "bg-amber-50 text-amber-700",
    bonus: "bg-teal-50 text-teal-700",
    one_off: "bg-blue-50 text-blue-700",
};

const SOURCE_LABEL: Record<string, string> = {
    structure: "From template",
    override: "Override",
    bonus: "Bonus",
    one_off: "One-off",
};


export default function SalaryPreviewWidget() {
    const { companyId } = useAuth();
    const searchParams = useSearchParams();

    const [employees, setEmployees] = useState<User[]>([]);
    const [loadingEmployees, setLoadingEmployees] = useState(false);
    const [query, setQuery] = useState("");
    const [selected, setSelected] = useState<User | null>(null);
    const [asOf, setAsOf] = useState(todayISO());
    const [resolved, setResolved] = useState<ResolvedSalary | null>(null);
    const [loading, setLoading] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);
    const pickerRef = useRef<HTMLDivElement>(null);
    const [assignOpen, setAssignOpen] = useState(false);
    // Guard so the ?employee=… deep-link preselect fires exactly once, not on
    // every employees/asOf change (which would fight the user's own picks).
    const presetDone = useRef(false);

    const runPreview = useCallback(async (privateUserId: number, date: string) => {
        setLoading(true);
        const r = await salaryStructures.preview(privateUserId, date);
        setLoading(false);
        if (isError(r)) {
            toast.error(r.error);
            setResolved(null);
            return;
        }
        setResolved(r);
    }, []);

    useEffect(() => {
        if (!companyId) return;
        setLoadingEmployees(true);
        fetchCompanyUsers(companyId, "approved").then((r) => {
            if (Array.isArray(r)) {
                // Only employees whose onboarding produced a private_user row
                // can be previewed — the backend keys salary resolution on
                // private_user.private_user_id. Drop anyone missing it so the
                // picker never offers an un-previewable selection. Cast at the
                // boundary: fetchCompanyUsers is declared with the shared User
                // shape (all-optional), but every row at runtime has the local
                // stricter fields populated by the backend.
                setEmployees((r as User[]).filter((u) => privateIdOf(u) != null));
            }
            setLoadingEmployees(false);
        });
    }, [companyId]);

    // Close the dropdown when the user clicks anywhere outside the picker.
    useEffect(() => {
        if (!pickerOpen) return;
        function onClick(e: MouseEvent) {
            if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
                setPickerOpen(false);
            }
        }
        document.addEventListener("mousedown", onClick);
        return () => document.removeEventListener("mousedown", onClick);
    }, [pickerOpen]);

    // Deep-link support: the employee-profile "Edit salary structure" button
    // lands here with ?employee=<privateUserId>(&assign=1). Once the roster is
    // loaded, preselect that employee, run their preview, and (if asked) pop the
    // assign modal — so the admin arrives exactly on the flow they wanted
    // instead of a blank picker.
    useEffect(() => {
        if (presetDone.current || employees.length === 0) return;
        const raw = searchParams.get("employee");
        if (!raw) return;
        const pid = Number(raw);
        if (!Number.isFinite(pid)) return;
        const match = employees.find((u) => privateIdOf(u) === pid);
        if (!match) return;
        presetDone.current = true;
        setSelected(match);
        setQuery("");
        runPreview(pid, asOf);
        if (searchParams.get("assign") === "1") setAssignOpen(true);
    }, [employees, searchParams, asOf, runPreview]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return employees.slice(0, 25);
        return employees
            .filter((u) => nameOf(u).toLowerCase().includes(q) || u.email?.toLowerCase().includes(q))
            .slice(0, 25);
    }, [employees, query]);

    async function handlePreview() {
        const id = selected ? privateIdOf(selected) : undefined;
        if (!id) return;
        await runPreview(id, asOf);
    }

    const selectedId = selected ? privateIdOf(selected) : undefined;

    const earnings = resolved?.components.filter((c) => c.kind === "earning") ?? [];
    const deductions = resolved?.components.filter((c) => c.kind === "deduction") ?? [];
    const totalEarnings = earnings.reduce((s, c) => s + Number(c.amount), 0);
    const totalDeductions = deductions.reduce((s, c) => s + Number(c.amount), 0);
    const net = totalEarnings - totalDeductions;

    return (
        <div>
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 mb-4">
                <div className="flex items-end gap-3 flex-wrap">
                    <div className="flex-1 min-w-[240px] relative" ref={pickerRef}>
                        <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-1">
                            Employee
                        </label>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 dark:text-zinc-500 pointer-events-none" />
                            <input
                                type="text"
                                value={selected ? nameOf(selected) : query}
                                onChange={(e) => {
                                    setQuery(e.target.value);
                                    setSelected(null);
                                    setPickerOpen(true);
                                }}
                                onFocus={() => setPickerOpen(true)}
                                placeholder={loadingEmployees ? "Loading employees…" : "Search by name or email"}
                                className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                autoComplete="off"
                            />
                        </div>
                        {pickerOpen && !selected && filtered.length > 0 && (
                            <div className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg">
                                {filtered.map((u) => {
                                    const pid = privateIdOf(u);
                                    return (
                                        <button
                                            key={u.user_id}
                                            type="button"
                                            onClick={() => { setSelected(u); setQuery(""); setPickerOpen(false); }}
                                            className="w-full text-left px-3 py-2 hover:bg-zinc-50 dark:bg-zinc-900/40 flex items-center justify-between gap-3"
                                        >
                                            <div>
                                                <div className="text-sm text-zinc-900 dark:text-zinc-100">{nameOf(u)}</div>
                                                <div className="text-xs text-zinc-500 dark:text-zinc-400">{u.email}</div>
                                            </div>
                                            {pid != null && (
                                                <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500">#{pid}</span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                        {pickerOpen && !selected && query && filtered.length === 0 && !loadingEmployees && (
                            <div className="absolute z-20 mt-1 w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg p-3 text-sm text-zinc-500 dark:text-zinc-400">
                                No employee matches “{query}”.
                            </div>
                        )}
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-1">
                            On date
                        </label>
                        <input
                            type="date"
                            value={asOf}
                            onChange={(e) => setAsOf(e.target.value)}
                            className="rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <button
                        type="button"
                        onClick={handlePreview}
                        disabled={loading || !selectedId}
                        className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                        Preview pay
                    </button>
                    <button
                        type="button"
                        onClick={() => setAssignOpen(true)}
                        disabled={!selectedId}
                        title="Assign a new structure, or change the one currently in effect"
                        className="inline-flex items-center gap-2 rounded-md border border-zinc-200 dark:border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <UserPlus className="h-4 w-4" />
                        Assign / change structure
                    </button>
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-3">
                    Shows what this employee&apos;s pay would look like on the chosen date — combining the assigned structure,
                    any overrides, and one-off items in effect. This is the <strong>structural baseline</strong>; the actual
                    payslip generated during a payroll run also applies pay-basis pro-ration (hourly employees swap BASIC for
                    hours × rate; monthly employees pro-rate for joiner/leaver dates).
                </p>
            </div>

            {resolved && (
                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
                    <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40">
                        <div className="flex items-center justify-between gap-4">
                            <div>
                                <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
                                    {selected ? nameOf(selected) : `Employee #${resolved.private_user_id}`}
                                </h3>
                                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                                    On {fmtDate(resolved.period_start)}
                                    {resolved.assignment_id
                                        ? <> · paid in {resolved.currency}</>
                                        : <> · no salary structure assigned yet</>}
                                </p>
                            </div>
                            {resolved.components.length > 0 && (
                                <div className="text-right">
                                    <div className="text-xs text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Take-home</div>
                                    <div className="text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                                        {formatMoney(String(net), resolved.currency)}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {resolved.components.length === 0 ? (
                        resolved.assignment_id == null ? (
                            // 1. No assignment row exists for this date.
                            <div className="p-8 text-center">
                                <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3">
                                    No structure is assigned for this date.
                                </p>
                                <button
                                    type="button"
                                    onClick={() => setAssignOpen(true)}
                                    disabled={!selectedId}
                                    className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <UserPlus className="h-4 w-4" />
                                    Assign a structure
                                </button>
                            </div>
                        ) : resolved.structure_id == null ? (
                            // 2. Assignment exists but has no structure pointer
                            //    — happens when an assignment was created via a
                            //    flow that didn't pick a structure (e.g. older
                            //    onboarding paths). Offer to re-assign with one.
                            <div className="p-8 text-center">
                                <p className="text-sm text-zinc-900 dark:text-zinc-100 font-medium mb-1">
                                    Assignment #{resolved.assignment_id} exists but has no structure attached
                                </p>
                                <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3">
                                    Without a structure, the engine has nothing to resolve. Assign a structure
                                    starting from today (or earlier) — it will supersede the empty one.
                                </p>
                                <button
                                    type="button"
                                    onClick={() => setAssignOpen(true)}
                                    disabled={!selectedId}
                                    className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <UserPlus className="h-4 w-4" />
                                    Assign a structure now
                                </button>
                            </div>
                        ) : (
                            // 3. Assignment + structure both exist, but the
                            //    structure has no lines (or all its lines were
                            //    filtered out for lacking amount/formula).
                            <div className="p-8 text-center">
                                <p className="text-sm text-zinc-900 dark:text-zinc-100 font-medium mb-1">
                                    Structure assigned ✓
                                </p>
                                <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3">
                                    Assignment #{resolved.assignment_id} · Structure #{resolved.structure_id} has no
                                    components yet. Add at least one line on the <strong>Structures</strong> tab,
                                    then re-run preview.
                                </p>
                                <button
                                    type="button"
                                    onClick={() => selectedId && runPreview(selectedId, asOf)}
                                    className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700"
                                >
                                    <Eye className="h-4 w-4" />
                                    Re-run preview
                                </button>
                            </div>
                        )
                    ) : (
                        <table className="min-w-full divide-y divide-zinc-100">
                            <thead className="bg-white dark:bg-zinc-900">
                                <tr>
                                    <th className="px-5 py-2 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase">Component</th>
                                    <th className="px-5 py-2 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase">Source</th>
                                    <th className="px-5 py-2 text-right text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase">Amount</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-50">
                                {resolved.components.map((c, i) => (
                                    <tr key={`${c.code}-${i}`}>
                                        <td className="px-5 py-2 text-sm">
                                            <div className="text-zinc-900 dark:text-zinc-100">{c.label}</div>
                                            <div className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500">{c.code}</div>
                                        </td>
                                        <td className="px-5 py-2">
                                            <span className={`inline-flex rounded px-2 py-0.5 text-[10px] font-medium ${SOURCE_PILL[c.source] ?? "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"}`}>
                                                {SOURCE_LABEL[c.source] ?? c.source}
                                            </span>
                                        </td>
                                        <td className="px-5 py-2 text-sm tabular-nums text-right">
                                            <span className={c.kind === "deduction" ? "text-red-700" : "text-zinc-900 dark:text-zinc-100"}>
                                                {c.kind === "deduction" ? "−" : ""}
                                                {formatMoney(c.amount, resolved.currency)}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot className="bg-zinc-50 dark:bg-zinc-900/40">
                                <tr>
                                    <td colSpan={2} className="px-5 py-2 text-right text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase">
                                        Gross earnings
                                    </td>
                                    <td className="px-5 py-2 text-right tabular-nums text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                        {formatMoney(String(totalEarnings), resolved.currency)}
                                    </td>
                                </tr>
                                <tr>
                                    <td colSpan={2} className="px-5 py-2 text-right text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase">
                                        Deductions
                                    </td>
                                    <td className="px-5 py-2 text-right tabular-nums text-sm font-medium text-red-700">
                                        −{formatMoney(String(totalDeductions), resolved.currency)}
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    )}
                </div>
            )}

            {assignOpen && selected && selectedId != null && companyId && (
                <AssignStructureModal
                    companyId={companyId}
                    privateUserId={selectedId}
                    employeeName={nameOf(selected)}
                    defaultEffectiveFrom={asOf}
                    currentStructureId={resolved?.structure_id ?? null}
                    onClose={() => setAssignOpen(false)}
                    onAssigned={async () => {
                        // Refresh the preview BEFORE closing the modal so the
                        // user keeps seeing the saving spinner until the new
                        // resolved data lands. Closing first would briefly
                        // re-render the stale empty state, which reads as
                        // "nothing happened".
                        await runPreview(selectedId, asOf);
                        setAssignOpen(false);
                        toast.success("Structure assigned.");
                    }}
                />
            )}
        </div>
    );
}


// ──────────────────────────────────────────────────────────────────────────
// Assignment modal — lets the employer pick a structure + effective date and
// links it to the selected employee via the salary-assignment API. Renders
// in-place so the user doesn't have to navigate away to act on the empty
// preview state.

interface AssignStructureModalProps {
    companyId: number;
    privateUserId: number;
    employeeName: string;
    defaultEffectiveFrom: string;
    // The structure currently in effect on the previewed date, if any. When
    // set, this is a *change* (the new assignment supersedes the current one
    // from the effective date onward) rather than a first-time assignment.
    currentStructureId?: number | null;
    onClose: () => void;
    onAssigned: () => void | Promise<void>;
}

function AssignStructureModal({
    companyId, privateUserId, employeeName, defaultEffectiveFrom, currentStructureId, onClose, onAssigned,
}: AssignStructureModalProps) {
    const { currency: companyCurrency } = useCompanyCurrency();
    const [structures, setStructures] = useState<SalaryStructure[]>([]);
    const [loadingStructures, setLoadingStructures] = useState(true);
    const [structureId, setStructureId] = useState<number | "">("");
    // Server-authoritative currency (company country) — the assignment is always
    // paid in the company currency, so this is fixed, not a free-text field.
    const [currency, setCurrency] = useState(companyCurrency);
    const [effectiveFrom, setEffectiveFrom] = useState(defaultEffectiveFrom);
    const [notes, setNotes] = useState("");
    const [saving, setSaving] = useState(false);

    // Keep the (read-only) currency locked to the company currency, incl. when
    // auth resolves after mount.
    useEffect(() => { setCurrency(companyCurrency); }, [companyCurrency]);

    useEffect(() => {
        setLoadingStructures(true);
        salaryStructures.listStructures(companyId).then((r) => {
            if (isError(r)) {
                toast.error(r.error);
                setStructures([]);
            } else {
                setStructures(r);
                // When changing, preselect the structure currently in effect so
                // the admin sees what's assigned before switching. Otherwise
                // default to the first active structure. Currency lives on the
                // assignment, not the structure, so we leave it at the company
                // default.
                const current = currentStructureId != null
                    ? r.find((s) => s.id === currentStructureId && !s.archived_at)
                    : undefined;
                const firstActive = current ?? r.find((s) => !s.archived_at);
                if (firstActive) {
                    setStructureId(firstActive.id);
                }
            }
            setLoadingStructures(false);
        });
    }, [companyId, currentStructureId]);

    useEffect(() => {
        function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [onClose]);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (typeof structureId !== "number") {
            toast.error("Pick a structure first.");
            return;
        }
        setSaving(true);
        const r = await salaryStructures.createAssignment(privateUserId, {
            private_user_id: privateUserId,
            structure_id: structureId,
            currency,
            effective_from: effectiveFrom,
            notes: notes.trim() || null,
            overrides: [],
        });
        setSaving(false);
        if (isError(r)) {
            toast.error(r.error);
            return;
        }
        await onAssigned();
    }

    const activeStructures = structures.filter((s) => !s.archived_at);
    const isChange = currentStructureId != null;
    const currentStructureName = currentStructureId != null
        ? structures.find((s) => s.id === currentStructureId)?.name ?? null
        : null;

    return (
        <>
            <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" onClick={onClose} />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <form
                    onSubmit={handleSubmit}
                    className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col"
                >
                    <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 dark:border-zinc-800">
                        <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">
                            {isChange ? "Change structure" : "Assign structure"}
                        </h2>
                        <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500">
                            <X size={18} />
                        </button>
                    </div>

                    <div className="px-6 py-5 space-y-4">
                        <p className="text-sm text-zinc-600 dark:text-zinc-400">
                            {isChange ? (
                                <>
                                    <strong>{employeeName}</strong> is currently on{" "}
                                    <strong>{currentStructureName ?? "a structure"}</strong>. Picking a structure
                                    below creates a new assignment that supersedes it from the effective date
                                    onward — the current one stays on record for earlier periods.
                                </>
                            ) : (
                                <>
                                    Link <strong>{employeeName}</strong> to a salary template. From the effective
                                    date onward, the template&apos;s components flow into their payroll.
                                </>
                            )}
                        </p>

                        <div>
                            <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-1">
                                Structure
                            </label>
                            {loadingStructures ? (
                                <div className="text-sm text-zinc-400 dark:text-zinc-500 py-2">Loading structures…</div>
                            ) : activeStructures.length === 0 ? (
                                <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                                    No active structures yet. Create one on the <strong>Structures</strong> tab first.
                                </div>
                            ) : (
                                <select
                                    value={structureId}
                                    onChange={(e) => setStructureId(Number(e.target.value))}
                                    className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    required
                                >
                                    <option value="" disabled>Select a structure…</option>
                                    {activeStructures.map((s) => (
                                        <option key={s.id} value={s.id}>
                                            {s.name}
                                            {s.lines?.length ? ` · ${s.lines.length} component${s.lines.length === 1 ? "" : "s"}` : ""}
                                        </option>
                                    ))}
                                </select>
                            )}
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-1">
                                    Effective from
                                </label>
                                <input
                                    type="date"
                                    value={effectiveFrom}
                                    onChange={(e) => setEffectiveFrom(e.target.value)}
                                    className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-1">
                                    Currency
                                </label>
                                <div
                                    className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/60 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 cursor-not-allowed flex items-center justify-between"
                                    title="Set by the company's country"
                                >
                                    <span className="font-medium">{currency}</span>
                                    <span className="text-xs text-zinc-400">Company country</span>
                                </div>
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-1">
                                Notes <span className="text-zinc-400 dark:text-zinc-500 normal-case">(optional)</span>
                            </label>
                            <input
                                type="text"
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder="e.g. promoted to senior band"
                                className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                    </div>

                    <div className="px-6 py-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-end gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 rounded-md text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:bg-zinc-800"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={saving || typeof structureId !== "number"}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                            {isChange ? "Change" : "Assign"}
                        </button>
                    </div>
                </form>
            </div>
        </>
    );
}
