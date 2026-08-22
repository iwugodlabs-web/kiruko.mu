"use client";

/**
 * "Why isn't this serving?" diagnostic panel (M16).
 *
 * Sits on the campaign/announcement detail page next to the serving-window
 * banner. Calls GET /admin/sponsored/{id}/eligibility and renders the
 * structured report as a checklist. Each row says pass/fail, what was
 * checked, and (when failed) a concrete fix the admin can apply.
 *
 * Platform-admin only — the underlying endpoint is gated, and the parent
 * pages mount this behind an `isPlatformAdmin` check.
 *
 * The panel does NOT auto-refresh. Admin-side edits that move a check from
 * red→green (e.g. flipping Company.ads_enabled, extending end_at) require
 * a manual reload — there's a "Re-check" button. We deliberately avoid
 * polling: this is a diagnostic surface, not a live monitor.
 */

import { useCallback, useEffect, useState } from 'react';
import { Check, X, Info, RefreshCw, AlertTriangle, Megaphone, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
    EligibilityCheck,
    EligibilityReport,
    getSponsoredEligibility,
} from '../../../../../../services/sponsored-admin';
import { setCompanyAdsEnabled } from '../../../../../../services/ads';

interface Props {
    contentId: number;
}

export default function EligibilityPanel({ contentId }: Props) {
    const [report, setReport] = useState<EligibilityReport | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const r = await getSponsoredEligibility(contentId);
            setReport(r);
        } catch (e) {
            const msg =
                e instanceof Error ? e.message : 'Could not load eligibility report.';
            setError(msg);
        } finally {
            setLoading(false);
        }
    }, [contentId]);

    useEffect(() => {
        load();
    }, [load]);

    if (loading && !report) {
        return (
            <div className="p-4 border border-gray-100 dark:border-gray-800 rounded-xl mb-6 text-sm text-gray-400 dark:text-gray-500">
                Running eligibility checks…
            </div>
        );
    }

    if (error || !report) {
        return (
            <div className="p-4 border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 rounded-xl mb-6 text-sm text-amber-900">
                <p className="font-semibold mb-1">Eligibility check failed</p>
                <p>{error || 'Unknown error.'}</p>
                <button
                    type="button"
                    onClick={load}
                    className="mt-2 text-xs font-medium text-amber-900 dark:text-amber-200 underline"
                >
                    Try again
                </button>
            </div>
        );
    }

    const blocked = report.summary === 'blocked';
    return (
        <div
            className={`p-4 rounded-xl border mb-6 ${
                blocked
                    ? 'border-red-200 dark:border-red-500/30 bg-red-50/40'
                    : 'border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/40'
            }`}
        >
            <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    {blocked ? (
                        <AlertTriangle size={14} className="text-red-600 dark:text-red-300" />
                    ) : (
                        <Check size={14} className="text-emerald-600 dark:text-emerald-300" />
                    )}
                    Serving eligibility
                    <span
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md uppercase tracking-wider ${
                            blocked
                                ? 'bg-red-100 text-red-700 dark:text-red-300'
                                : 'bg-emerald-100 text-emerald-700 dark:text-emerald-300'
                        }`}
                    >
                        {blocked ? 'Not serving' : 'Ready to serve'}
                    </span>
                </h2>
                <button
                    type="button"
                    onClick={load}
                    className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900"
                    disabled={loading}
                >
                    <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                    Re-check
                </button>
            </div>

            <ul className="space-y-1.5">
                {report.checks.map((c) => (
                    <CheckRow
                        key={c.key}
                        check={c}
                        action={renderInlineAction(c, report, load)}
                    />
                ))}
            </ul>

            {report.kind === 'ad' && report.audience.total_employees != null && (
                <div className="mt-3 pt-3 border-t border-gray-200/70 text-[11px] text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-4 gap-y-1">
                    <span>
                        Audience: <strong>{report.audience.total_employees}</strong> targeted
                    </span>
                    <span>
                        Consented:{' '}
                        <strong>{report.audience.consenting_employees ?? 0}</strong>
                    </span>
                    <span>
                        Ad-free: <strong>{report.audience.ad_free_employees ?? 0}</strong>
                    </span>
                    {report.audience.funding_company_name && (
                        <span className="ml-auto">
                            Advertiser: {report.audience.funding_company_name}
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}

function CheckRow({
    check,
    action,
}: {
    check: EligibilityCheck;
    action?: React.ReactNode;
}) {
    const icon =
        check.level === 'ok' ? (
            <Check size={14} className="text-emerald-600 dark:text-emerald-300 shrink-0 mt-0.5" />
        ) : check.level === 'fail' ? (
            <X size={14} className="text-red-600 dark:text-red-300 shrink-0 mt-0.5" />
        ) : (
            <Info size={14} className="text-gray-400 dark:text-gray-500 shrink-0 mt-0.5" />
        );
    return (
        <li className="flex items-start gap-2 text-sm">
            {icon}
            <div className="flex-1">
                <p
                    className={`font-medium ${
                        check.level === 'fail' ? 'text-red-700 dark:text-red-300' : 'text-gray-900 dark:text-gray-100'
                    }`}
                >
                    {check.label}
                </p>
                {check.detail && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{check.detail}</p>
                )}
                {check.hint && (
                    <p className="text-xs text-gray-700 dark:text-gray-300 mt-0.5">
                        <span className="font-semibold">Fix:</span> {check.hint}
                    </p>
                )}
                {action && <div className="mt-1.5">{action}</div>}
            </div>
        </li>
    );
}

/** Inline one-click fix shown next to a failing check when we can apply the
 *  fix from this panel. Today: only the Company.ads_enabled gate, because
 *  it's the one that's structurally hidden on `/admin/employers/[id]` and
 *  has a stable single-call API to flip. Status changes / window edits live
 *  on the form below; ENABLED_KINDS is an env var only ops can touch. */
function renderInlineAction(
    check: EligibilityCheck,
    report: EligibilityReport,
    onApplied: () => void | Promise<void>,
): React.ReactNode {
    if (
        check.key === 'ads_enabled' &&
        check.level === 'fail' &&
        report.audience.funding_company_id != null
    ) {
        return (
            <EnableAdsButton
                companyId={report.audience.funding_company_id}
                companyName={report.audience.funding_company_name ?? `#${report.audience.funding_company_id}`}
                onApplied={onApplied}
            />
        );
    }
    return null;
}

function EnableAdsButton({
    companyId,
    companyName,
    onApplied,
}: {
    companyId: number;
    companyName: string;
    onApplied: () => void | Promise<void>;
}) {
    const [saving, setSaving] = useState(false);
    async function enable() {
        if (
            !confirm(
                `Enable third-party ads for ${companyName}? Employees with consent will start seeing kind='ad' cards.`,
            )
        )
            return;
        setSaving(true);
        try {
            await setCompanyAdsEnabled(companyId, true);
            toast.success(`Ads enabled for ${companyName}.`);
            await onApplied();
        } catch {
            toast.error('Could not enable ads — try the toggle on /admin/employers.');
        } finally {
            setSaving(false);
        }
    }
    return (
        <button
            type="button"
            onClick={enable}
            disabled={saving}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
        >
            {saving ? <Loader2 size={11} className="animate-spin" /> : <Megaphone size={11} />}
            {saving ? 'Enabling…' : `Enable ads for ${companyName}`}
        </button>
    );
}
