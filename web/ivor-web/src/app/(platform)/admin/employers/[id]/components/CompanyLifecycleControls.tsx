"use client";
import { useState } from "react";
import { Loader2, Power, RotateCcw, Trash2 } from "lucide-react";
import { setCompanyStatus, restoreCompany, deleteCompany } from "@/services/api";

type Status = "active" | "disabled" | "deleted";

type Props = {
  companyId: number;
  status: Status;
  canManage?: boolean;
  canDelete?: boolean;
  onChanged: (status: Status) => void;
};

export default function CompanyLifecycleControls({ companyId, status, canManage = true, canDelete = true, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<{ error?: string } | unknown>, next: Status) => {
    setBusy(true);
    setError(null);
    const res = (await fn()) as { error?: string };
    if (res && "error" in res && res.error) setError(res.error);
    else onChanged(next);
    setBusy(false);
  };

  const onDisable = () => run(() => setCompanyStatus(companyId, "disabled"), "disabled");
  const onEnable = () => run(() => setCompanyStatus(companyId, "active"), "active");
  const onRestore = () => run(() => restoreCompany(companyId), "active");
  const onSoftDelete = () => {
    if (!confirm("Soft-delete this company? It will be hidden and access blocked for its users, but you can restore it later.")) return;
    run(() => deleteCompany(companyId), "deleted");
  };

  const badge =
    status === "active"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : status === "disabled"
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : "bg-red-50 text-red-700 border-red-200";

  return (
    <div className="p-5 bg-white border border-gray-200 rounded-xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h4 className="text-sm font-bold text-gray-900">Lifecycle</h4>
          <p className="text-xs text-gray-400 mt-0.5">Enable, disable, or soft-delete this company.</p>
        </div>
        <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border ${badge}`}>
          {status}
        </span>
      </div>

      {error && <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}

      <div className="flex flex-wrap gap-2">
        {canManage && status === "active" && (
          <button onClick={onDisable} disabled={busy} className="px-3 py-2 rounded-lg border border-amber-200 text-amber-700 hover:bg-amber-50 text-sm font-medium flex items-center gap-2 disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />} Disable
          </button>
        )}
        {canManage && status === "disabled" && (
          <button onClick={onEnable} disabled={busy} className="px-3 py-2 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50 text-sm font-medium flex items-center gap-2 disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />} Enable
          </button>
        )}
        {canManage && status === "deleted" && (
          <button onClick={onRestore} disabled={busy} className="px-3 py-2 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50 text-sm font-medium flex items-center gap-2 disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />} Restore
          </button>
        )}
        {canDelete && status !== "deleted" && (
          <button onClick={onSoftDelete} disabled={busy} className="px-3 py-2 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 text-sm font-medium flex items-center gap-2 disabled:opacity-50">
            <Trash2 className="w-4 h-4" /> Soft-delete
          </button>
        )}
        {!canManage && !canDelete && (
          <p className="text-xs text-gray-400">You don&apos;t have permission to change this company&apos;s lifecycle.</p>
        )}
      </div>
    </div>
  );
}
