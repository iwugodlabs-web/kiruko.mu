"use client";

/**
 * Per-company paid-module toggles.
 *
 * Lives on the platform-admin employer detail page. Each registered module
 * (e.g. Field Sales & Commissions) is a paid capability that defaults to OFF;
 * sales flips it on here after a deal is signed. The backend `require_module`
 * gate enforces it on the module's API, and the company UI hides the related
 * navigation when it's off.
 */

import { useState } from "react";
import { Puzzle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { setCompanyModule, type CompanyModule } from "@/services/modules";
import { invalidateCompanyModules } from "@/hooks/useCompanyModules";

interface Props {
    companyId: number;
    initial: CompanyModule[];
    canManage: boolean;
}

export default function ModuleToggles({ companyId, initial, canManage }: Props) {
    const [modules, setModules] = useState<CompanyModule[]>(initial);
    const [saving, setSaving] = useState<string | null>(null);

    async function flip(m: CompanyModule) {
        const next = !m.enabled;
        if (!confirm(
            `${next ? "Enable" : "Disable"} ${m.label} for this company?` +
            (next
                ? " The company will gain access immediately."
                : " The company loses access to this module immediately."),
        )) return;
        setSaving(m.module_key);
        try {
            const res = await setCompanyModule(companyId, m.module_key, next);
            setModules((prev) =>
                prev.map((x) =>
                    x.module_key === m.module_key ? { ...x, enabled: res.enabled } : x,
                ),
            );
            invalidateCompanyModules(companyId);
            toast.success(`${m.label} ${res.enabled ? "enabled" : "disabled"} for this company.`);
        } catch {
            toast.error("Toggle failed.");
        } finally {
            setSaving(null);
        }
    }

    return (
        <div className="bg-white dark:bg-gray-900 rounded-3xl border border-slate-200 dark:border-gray-800 p-6 shadow-sm">
            <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-slate-900 text-white shadow-sm dark:bg-white dark:text-slate-900">
                    <Puzzle size={22} strokeWidth={1.5} />
                </div>
                <div className="flex-1">
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">
                        Modules
                    </h3>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                        Paid features activated per company. Off by default —
                        turn one on after a deal is signed. Changes take effect
                        immediately on the company&apos;s dashboard and apps.
                    </p>

                    <div className="mt-4 divide-y divide-slate-100 dark:divide-gray-800">
                        {modules.length === 0 && (
                            <p className="text-xs text-slate-400 py-2">No modules registered.</p>
                        )}
                        {modules.map((m) => (
                            <div key={m.module_key} className="flex items-center justify-between gap-4 py-3">
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                                        {m.label}
                                    </p>
                                    {m.description && (
                                        <p className="text-xs text-slate-500 mt-0.5">{m.description}</p>
                                    )}
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                    <button
                                        onClick={() => flip(m)}
                                        disabled={saving === m.module_key || !canManage}
                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
                                            m.enabled ? "bg-emerald-500" : "bg-slate-300"
                                        }`}
                                        aria-label={m.enabled ? `Disable ${m.label}` : `Enable ${m.label}`}
                                    >
                                        <span
                                            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                                                m.enabled ? "translate-x-5" : "translate-x-1"
                                            }`}
                                        />
                                    </button>
                                    <span
                                        className={`text-xs font-semibold w-14 ${
                                            m.enabled ? "text-emerald-700" : "text-slate-500"
                                        }`}
                                    >
                                        {saving === m.module_key && (
                                            <Loader2 size={12} className="inline animate-spin mr-1" />
                                        )}
                                        {m.enabled ? "Enabled" : "Disabled"}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                    {!canManage && (
                        <p className="mt-2 text-xs text-slate-400">
                            You need the &apos;manage_companies&apos; permission to change modules.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
