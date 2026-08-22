"use client";

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, BadgeDollarSign, Trash2, Pause, Square } from 'lucide-react';
import { toast } from 'sonner';
import RoleGuard from '../../components/RoleGuard';
import FilterPillGroup from '@/components/ui/FilterPillGroup';
import {
    AdCampaign,
    listAdCampaigns,
    patchAdCampaign,
    deleteAdCampaign,
} from '../../../../../services/ads';
import type { AnnouncementStatus } from '../../../../../services/announcements';

const STATUS_FILTERS: Array<{ label: string; value: AnnouncementStatus | 'all' }> = [
    { label: 'All', value: 'all' },
    { label: 'Draft', value: 'draft' },
    { label: 'Active', value: 'active' },
    { label: 'Paused', value: 'paused' },
    { label: 'Ended', value: 'ended' },
];

function StatusPill({ status }: { status: AnnouncementStatus }) {
    const cls = {
        draft: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
        active: 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
        paused: 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300',
        ended: 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500',
    }[status];
    return (
        <span className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${cls}`}>
            {status}
        </span>
    );
}

function formatMoney(cents: number | null, currency: string | null): string {
    if (cents == null || currency == null) return '—';
    const major = cents / 100;
    return `${major.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function AdsListContent() {
    const [rows, setRows] = useState<AdCampaign[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<AnnouncementStatus | 'all'>('all');
    const [advertiserFilter, setAdvertiserFilter] = useState<string>('');
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [bulkBusy, setBulkBusy] = useState(false);

    async function load() {
        setLoading(true);
        setSelected(new Set());
        try {
            // include_deleted=true so soft-deleted ("Ended") campaigns show up
            // under the Ended/All status filters. Soft-delete sets BOTH
            // status='ended' AND deleted_at, so the prior `include_deleted=false`
            // call dropped every ended row — admins lost the history view.
            // The status filter pills above do the user-visible work.
            const data = await listAdCampaigns({ limit: 200, include_deleted: true });
            setRows(data);
        } catch {
            toast.error('Failed to load campaigns.');
        } finally {
            setLoading(false);
        }
    }
    useEffect(() => { load(); }, []);

    const filtered = useMemo(() => {
        const advId = advertiserFilter.trim() ? parseInt(advertiserFilter.trim(), 10) : null;
        return rows.filter((r) => {
            if (filter !== 'all' && r.status !== filter) return false;
            if (advId !== null && !Number.isNaN(advId) && r.funding_company_id !== advId) return false;
            return true;
        });
    }, [rows, filter, advertiserFilter]);

    const allSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.sponsored_content_id));
    const someSelected = selected.size > 0;
    function toggleRow(id: number) {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }
    function toggleAllVisible() {
        if (allSelected) setSelected(new Set());
        else setSelected(new Set(filtered.map((r) => r.sponsored_content_id)));
    }

    async function handleDelete(id: number) {
        if (!confirm('End this campaign? It stops serving immediately.')) return;
        try {
            await deleteAdCampaign(id);
            toast.success('Ended.');
            load();
        } catch {
            toast.error('Delete failed.');
        }
    }

    async function runBulk(action: 'pause' | 'end') {
        const ids = Array.from(selected);
        if (ids.length === 0) return;
        const verb = action === 'pause' ? 'Pause' : 'End';
        if (!confirm(`${verb} ${ids.length} campaign${ids.length === 1 ? '' : 's'}?`)) return;
        setBulkBusy(true);
        let ok = 0;
        let failed = 0;
        for (const id of ids) {
            try {
                if (action === 'pause') await patchAdCampaign(id, { status: 'paused' });
                else await deleteAdCampaign(id);
                ok += 1;
            } catch {
                failed += 1;
            }
        }
        setBulkBusy(false);
        if (failed === 0) toast.success(`${verb}d ${ok} campaign${ok === 1 ? '' : 's'}.`);
        else if (ok === 0) toast.error(`${verb} failed for all ${failed} selected.`);
        else toast.message(`${verb}d ${ok}; ${failed} failed.`);
        load();
    }

    return (
        <div className="w-full py-8 px-6">
            <div className="flex items-center justify-between mb-6 pb-5 border-b border-gray-200 dark:border-gray-800">
                <div>
                    <h1 className="flex items-center gap-2 text-[2rem] font-display font-semibold text-gray-900 dark:text-white leading-tight tracking-tight">
                        <BadgeDollarSign size={20} className="text-gray-400 dark:text-gray-500" />
                        Ad campaigns
                    </h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Paid third-party ads (kind=&apos;ad&apos;). Serving is also gated by{' '}
                        <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">ENABLED_KINDS</code>{' '}
                        in the deployment env.
                    </p>
                </div>
                <Link
                    href="/admin/ads/new"
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-gray-900 rounded-lg hover:bg-gray-800"
                >
                    <Plus size={14} />
                    New campaign
                </Link>
            </div>

            <div className="flex flex-wrap items-center gap-2 mb-4">
                <FilterPillGroup value={filter} onChange={setFilter} options={STATUS_FILTERS} />
                <div className="ml-2 inline-flex items-center gap-1 text-xs">
                    <span className="text-gray-500 dark:text-gray-400">Advertiser ID</span>
                    <input
                        type="text"
                        value={advertiserFilter}
                        onChange={(e) => setAdvertiserFilter(e.target.value)}
                        placeholder="e.g. 42"
                        className="px-2 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-gray-900 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 w-20"
                    />
                </div>
            </div>

            {someSelected && (
                <div className="mb-3 flex items-center justify-between px-4 py-2 rounded-lg bg-gray-900 text-white">
                    <p className="text-sm font-medium">{selected.size} selected</p>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => runBulk('pause')}
                            disabled={bulkBusy}
                            className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-md bg-gray-700 hover:bg-gray-600 disabled:opacity-60"
                        >
                            <Pause size={12} />
                            Pause selected
                        </button>
                        <button
                            onClick={() => runBulk('end')}
                            disabled={bulkBusy}
                            className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-500 disabled:opacity-60"
                        >
                            <Square size={12} />
                            End selected
                        </button>
                        <button
                            onClick={() => setSelected(new Set())}
                            className="text-xs text-gray-300 dark:text-gray-600 hover:text-white ml-2"
                        >
                            Clear
                        </button>
                    </div>
                </div>
            )}

            <div className="border border-gray-100 dark:border-gray-800 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-900/40 text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
                        <tr>
                            <th className="px-3 py-2 w-8">
                                <input
                                    type="checkbox"
                                    aria-label="Select all visible"
                                    checked={allSelected}
                                    onChange={toggleAllVisible}
                                    disabled={filtered.length === 0}
                                />
                            </th>
                            <th className="text-left px-4 py-2 font-semibold">Title</th>
                            <th className="text-left px-4 py-2 font-semibold">Advertiser</th>
                            <th className="text-left px-4 py-2 font-semibold">Status</th>
                            <th className="text-right px-4 py-2 font-semibold">Paid</th>
                            <th className="text-right px-4 py-2 font-semibold">Views</th>
                            <th className="text-right px-4 py-2 font-semibold">Clicks</th>
                            <th className="text-right px-4 py-2 font-semibold">CTR</th>
                            <th className="px-4 py-2 w-10" />
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr>
                                <td colSpan={9} className="px-4 py-12 text-center text-gray-400 dark:text-gray-500">Loading…</td>
                            </tr>
                        )}
                        {!loading && filtered.length === 0 && (
                            <tr>
                                <td colSpan={9} className="px-4 py-12 text-center text-gray-400 dark:text-gray-500">
                                    No campaigns match the current filters.
                                </td>
                            </tr>
                        )}
                        {!loading && filtered.map((a) => {
                            const ctr = a.view_count > 0 ? ((a.click_count / a.view_count) * 100).toFixed(1) + '%' : '—';
                            const isSel = selected.has(a.sponsored_content_id);
                            return (
                                <tr
                                    key={a.sponsored_content_id}
                                    className={`border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50 ${isSel ? 'bg-gray-50 dark:bg-gray-900/40' : ''}`}
                                >
                                    <td className="px-3 py-2.5">
                                        <input
                                            type="checkbox"
                                            aria-label={`Select ${a.title}`}
                                            checked={isSel}
                                            onChange={() => toggleRow(a.sponsored_content_id)}
                                        />
                                    </td>
                                    <td className="px-4 py-2.5">
                                        <Link
                                            href={`/admin/ads/${a.sponsored_content_id}`}
                                            className="font-medium text-gray-900 dark:text-gray-100 hover:underline"
                                        >
                                            {a.title}
                                        </Link>
                                    </td>
                                    <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 text-xs">
                                        #{a.funding_company_id ?? '—'}
                                    </td>
                                    <td className="px-4 py-2.5"><StatusPill status={a.status} /></td>
                                    <td className="px-4 py-2.5 text-right text-xs tabular-nums">
                                        {formatMoney(a.paid_amount_cents, a.paid_currency)}
                                    </td>
                                    <td className="px-4 py-2.5 text-right tabular-nums">{a.view_count}</td>
                                    <td className="px-4 py-2.5 text-right tabular-nums">{a.click_count}</td>
                                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-500 dark:text-gray-400">{ctr}</td>
                                    <td className="px-4 py-2.5 text-right">
                                        <button
                                            onClick={() => handleDelete(a.sponsored_content_id)}
                                            className="text-gray-400 dark:text-gray-500 hover:text-red-500"
                                            aria-label="End"
                                            title="End"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default function AdsPage() {
    return (
        <RoleGuard requiredRole={['platform_admin']}>
            <AdsListContent />
        </RoleGuard>
    );
}
