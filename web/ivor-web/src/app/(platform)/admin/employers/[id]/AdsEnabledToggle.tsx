"use client";

/**
 * Per-company master ads toggle (M11).
 *
 * Lives on the platform-admin employer detail page. Flipping this changes
 * whether ANY of the company's employees are eligible to see kind='ad' on
 * /serve. Independent of:
 *   - the employee-level `is_ad_free` flag (still respected; this is an OR
 *     gate at the company level)
 *   - `ads_consent_at` (employee must also have consented)
 *
 * Grandfathered companies start at `false`; sales flips this to `true`
 * after the customer re-signs the contract with the ads clause.
 */

import { useState } from 'react';
import { Megaphone, AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { setCompanyAdsEnabled } from '../../../../../../services/ads';

interface Props {
    companyId: number;
    initial: boolean;
}

export default function AdsEnabledToggle({ companyId, initial }: Props) {
    const [enabled, setEnabled] = useState(initial);
    const [saving, setSaving] = useState(false);

    async function flip() {
        const next = !enabled;
        const verb = next ? 'enable' : 'disable';
        if (!confirm(
            `${verb === 'enable' ? 'Enable' : 'Disable'} third-party ads for this company?` +
            (next
                ? ' Employees with consent will start seeing kind=\'ad\' cards.'
                : ' Ad serving stops within ~60s for all employees of this company.')
        )) return;
        setSaving(true);
        try {
            const res = await setCompanyAdsEnabled(companyId, next);
            setEnabled(res.ads_enabled);
            toast.success(`Ads ${res.ads_enabled ? 'enabled' : 'disabled'} for this company.`);
        } catch {
            toast.error('Toggle failed.');
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="bg-white dark:bg-gray-900 rounded-3xl border border-slate-200 dark:border-gray-800 p-6 shadow-sm">
            <div className="flex items-start gap-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                    enabled ? 'bg-emerald-500' : 'bg-slate-300'
                } text-white shadow-sm`}>
                    <Megaphone size={22} strokeWidth={1.5} />
                </div>
                <div className="flex-1">
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">
                        Third-party ads
                    </h3>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                        Master toggle for kind=&apos;ad&apos; serving to this company&apos;s employees.
                        New signups default to enabled; grandfathered customers start disabled
                        until the ads contract clause is signed.
                    </p>
                    <div className="flex items-center gap-3 mt-4">
                        <button
                            onClick={flip}
                            disabled={saving}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
                                enabled ? 'bg-emerald-500' : 'bg-slate-300'
                            }`}
                            aria-label={enabled ? 'Disable ads' : 'Enable ads'}
                        >
                            <span
                                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                                    enabled ? 'translate-x-5' : 'translate-x-1'
                                }`}
                            />
                        </button>
                        <span className={`text-sm font-semibold ${
                            enabled ? 'text-emerald-700' : 'text-slate-500'
                        }`}>
                            {saving && <Loader2 size={12} className="inline animate-spin mr-1" />}
                            {enabled ? 'Ads enabled' : 'Ads disabled'}
                        </span>
                    </div>
                    {!enabled && (
                        <div className="mt-3 flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs">
                            <AlertCircle size={12} className="mt-0.5 shrink-0" />
                            <span>
                                Employees still see employer announcements and house content —
                                only paid third-party ads are gated by this toggle.
                            </span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
