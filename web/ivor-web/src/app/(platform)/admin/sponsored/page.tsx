"use client";

/**
 * Cross-kind moderation listing for platform admins.
 *
 * Actionable — kind-specific edit pages exist for employer + ad, but
 * platform admins still need a single place to take cross-kind actions
 * (pause an employer post that violates the Ad Content Policy, end a
 * house draft that's no longer needed, etc). Each row exposes a status
 * selector + End button wired to /admin/sponsored/{id} PATCH and DELETE.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, Filter, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import RoleGuard from '../../components/RoleGuard';
import FilterPillGroup from '@/components/ui/FilterPillGroup';
import {
    deleteSponsored,
    listSponsoredModeration,
    patchSponsored,
} from '../../../../../services/sponsored-admin';
import type {
    Announcement,
    AnnouncementKind,
    AnnouncementStatus,
} from '../../../../../services/announcements';

const KIND_OPTS: Array<{ label: string; value: AnnouncementKind | 'all' }> = [
    { label: 'All', value: 'all' },
    { label: 'Employer', value: 'employer' },
    { label: 'House', value: 'house' },
    { label: 'Ad', value: 'ad' },
];

const STATUS_OPTS: Array<{ label: string; value: AnnouncementStatus | 'all' }> = [
    { label: 'All', value: 'all' },
    { label: 'Draft', value: 'draft' },
    { label: 'Active', value: 'active' },
    { label: 'Paused', value: 'paused' },
    { label: 'Ended', value: 'ended' },
];

function KindPill({ kind }: { kind: AnnouncementKind }) {
    const cls = {
        employer: 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400',
        ad: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400',
        house: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400',
    }[kind];
    return (
        <span className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${cls}`}>
            {kind}
        </span>
    );
}

function ModerationContent() {
    const [rows, setRows] = useState<Announcement[]>([]);
    const [loading, setLoading] = useState(true);
    const [kind, setKind] = useState<AnnouncementKind | 'all'>('all');
    const [status, setStatus] = useState<AnnouncementStatus | 'all'>('all');
    const [companyIdInput, setCompanyIdInput] = useState('');
    const [includeDeleted, setIncludeDeleted] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await listSponsoredModeration({
                kind: kind === 'all' ? undefined : kind,
                status: status === 'all' ? undefined : status,
                funding_company_id: companyIdInput.trim()
                    ? parseInt(companyIdInput.trim(), 10) || undefined
                    : undefined,
                include_deleted: includeDeleted,
                limit: 200,
            });
            setRows(data);
        } finally {
            setLoading(false);
        }
    }, [kind, status, companyIdInput, includeDeleted]);

    useEffect(() => {
        load();
    }, [load]);

    async function handleStatus(id: number, next: AnnouncementStatus) {
        try {
            await patchSponsored(id, { status: next });
            toast.success(`Status: ${next}.`);
            load();
        } catch {
            toast.error('Status change failed.');
        }
    }

    async function handleEnd(id: number) {
        if (!confirm('End this row? It stops serving and is soft-deleted.')) return;
        try {
            await deleteSponsored(id);
            toast.success('Ended.');
            load();
        } catch {
            toast.error('Delete failed.');
        }
    }

    const totals = useMemo(() => {
        const t = { employer: 0, ad: 0, house: 0 };
        for (const r of rows) t[r.kind] += 1;
        return t;
    }, [rows]);

    return (
        <div className="w-full max-w-7xl mx-auto py-8 px-6">
            <div className="mb-6 pb-5 border-b border-gray-200 dark:border-gray-800">
                <h1 className="flex items-center gap-2 text-[2rem] font-display font-semibold text-gray-900 dark:text-white leading-tight tracking-tight">
                    <Eye size={20} className="text-gray-400" />
                    Sponsored content moderation
                </h1>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Cross-kind view of every active campaign — employer announcements,
                    Kiruko house content, and (Phase 2) paid third-party ads.
                </p>
            </div>

            {/* Summary tiles */}
            <div className="grid grid-cols-3 gap-3 mb-6">
                <SummaryTile label="Employer" value={totals.employer} accent="text-blue-700 dark:text-blue-400" />
                <SummaryTile label="House" value={totals.house} accent="text-emerald-700 dark:text-emerald-400" />
                <SummaryTile label="Ad (Phase 2)" value={totals.ad} accent="text-amber-700 dark:text-amber-400" />
            </div>

            {/* Filter bar */}
            <div className="flex flex-wrap items-center gap-3 mb-4">
                <Filter size={14} className="text-gray-400 shrink-0" />
                <FilterPillGroup label="Kind:" value={kind} onChange={setKind} options={KIND_OPTS} />
                <FilterPillGroup label="Status:" value={status} onChange={setStatus} options={STATUS_OPTS} />
                <input
                    type="number"
                    placeholder="Company ID…"
                    value={companyIdInput}
                    onChange={(e) => setCompanyIdInput(e.target.value)}
                    className="text-xs px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg w-32 ml-3 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
                />
                <label className="text-xs text-gray-500 dark:text-gray-400 inline-flex items-center gap-1 ml-2">
                    <input
                        type="checkbox"
                        checked={includeDeleted}
                        onChange={(e) => setIncludeDeleted(e.target.checked)}
                    />
                    Include deleted
                </label>
            </div>

            <div className="border border-gray-100 dark:border-gray-800 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-800/60 text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
                        <tr>
                            <th className="text-left px-4 py-2 font-semibold">ID</th>
                            <th className="text-left px-4 py-2 font-semibold">Kind</th>
                            <th className="text-left px-4 py-2 font-semibold">Title</th>
                            <th className="text-left px-4 py-2 font-semibold">Funder</th>
                            <th className="text-left px-4 py-2 font-semibold">Status</th>
                            <th className="text-right px-4 py-2 font-semibold">Views</th>
                            <th className="text-right px-4 py-2 font-semibold">Clicks</th>
                            <th className="text-left px-4 py-2 font-semibold">Created</th>
                            <th className="px-4 py-2 w-10" />
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr>
                                <td colSpan={9} className="px-4 py-12 text-center text-gray-400 dark:text-gray-500">
                                    Loading…
                                </td>
                            </tr>
                        )}
                        {!loading && rows.length === 0 && (
                            <tr>
                                <td colSpan={9} className="px-4 py-12 text-center text-gray-400 dark:text-gray-500">
                                    No matching rows.
                                </td>
                            </tr>
                        )}
                        {!loading &&
                            rows.map((a) => (
                                <tr key={a.sponsored_content_id} className="border-t border-gray-100 dark:border-gray-800">
                                    <td className="px-4 py-2.5 tabular-nums text-xs text-gray-500 dark:text-gray-400">
                                        #{a.sponsored_content_id}
                                    </td>
                                    <td className="px-4 py-2.5">
                                        <KindPill kind={a.kind} />
                                    </td>
                                    <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-white">{a.title}</td>
                                    <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                                        {a.funding_company_id ?? '—'}
                                    </td>
                                    <td className="px-4 py-2.5">
                                        {/* Editable status — the cross-kind admin
                                            endpoint lets a moderator flip any row.
                                            Disabled once 'ended' since the row is
                                            soft-deleted and patch returns 410. */}
                                        <select
                                            value={a.status}
                                            disabled={a.status === 'ended' || a.deleted_at !== null}
                                            onChange={(e) =>
                                                handleStatus(
                                                    a.sponsored_content_id,
                                                    e.target.value as AnnouncementStatus,
                                                )
                                            }
                                            className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-1 rounded-md border ${
                                                a.status === 'active'
                                                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900'
                                                    : a.status === 'paused'
                                                    ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-900'
                                                    : a.status === 'ended'
                                                    ? 'bg-gray-50 dark:bg-gray-800/60 text-gray-400 dark:text-gray-500 border-gray-200 dark:border-gray-700'
                                                    : 'bg-gray-50 dark:bg-gray-800/60 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700'
                                            }`}
                                        >
                                            <option value="draft">draft</option>
                                            <option value="active">active</option>
                                            <option value="paused">paused</option>
                                            <option value="ended">ended</option>
                                        </select>
                                    </td>
                                    <td className="px-4 py-2.5 text-right tabular-nums">{a.view_count}</td>
                                    <td className="px-4 py-2.5 text-right tabular-nums">{a.click_count}</td>
                                    <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 text-xs">
                                        {new Date(a.created_at).toLocaleDateString()}
                                    </td>
                                    <td className="px-4 py-2.5 text-right">
                                        {!a.deleted_at && (
                                            <button
                                                onClick={() => handleEnd(a.sponsored_content_id)}
                                                className="text-gray-400 dark:text-gray-500 hover:text-red-500"
                                                aria-label="End"
                                                title="End (soft delete)"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function SummaryTile({
    label,
    value,
    accent,
}: {
    label: string;
    value: number;
    accent: string;
}) {
    return (
        <div className="px-4 py-3 rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">{label}</p>
            <p className={`text-2xl font-semibold tabular-nums ${accent}`}>{value}</p>
        </div>
    );
}

export default function ModerationPage() {
    return (
        <RoleGuard requiredRole={['platform_admin']}>
            <ModerationContent />
        </RoleGuard>
    );
}
