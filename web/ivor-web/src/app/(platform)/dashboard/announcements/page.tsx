"use client";

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Megaphone, Trash2, Pause, Square } from 'lucide-react';
import { toast } from 'sonner';
import RoleGuard from '../../components/RoleGuard';
import {
    Announcement,
    AnnouncementStatus,
    listAnnouncements,
    deleteAnnouncement,
    patchAnnouncement,
} from '../../../../../services/announcements';

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
        active: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400',
        paused: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400',
        ended: 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500',
    }[status];
    return (
        <span className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${cls}`}>
            {status}
        </span>
    );
}

function AnnouncementsContent() {
    const [rows, setRows] = useState<Announcement[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<AnnouncementStatus | 'all'>('all');
    const [dateFrom, setDateFrom] = useState<string>('');
    const [dateTo, setDateTo] = useState<string>('');
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [bulkBusy, setBulkBusy] = useState(false);

    async function load() {
        setLoading(true);
        setSelected(new Set());
        try {
            const data = await listAnnouncements({ limit: 200 });
            setRows(data);
        } catch {
            toast.error('Failed to load announcements.');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
    }, []);

    const filtered = useMemo(() => {
        const fromTs = dateFrom ? new Date(dateFrom).getTime() : null;
        // Treat the to-date as inclusive: extend to end-of-day so a single-day
        // selection (from == to) still returns rows created on that date.
        const toTs = dateTo ? new Date(dateTo).getTime() + 24 * 60 * 60 * 1000 - 1 : null;
        return rows.filter((r) => {
            if (filter !== 'all' && r.status !== filter) return false;
            if (fromTs !== null || toTs !== null) {
                const created = new Date(r.created_at).getTime();
                if (fromTs !== null && created < fromTs) return false;
                if (toTs !== null && created > toTs) return false;
            }
            return true;
        });
    }, [rows, filter, dateFrom, dateTo]);

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
        if (allSelected) {
            setSelected(new Set());
        } else {
            setSelected(new Set(filtered.map((r) => r.sponsored_content_id)));
        }
    }

    async function handleDelete(id: number) {
        if (!confirm('End this announcement? It will stop serving immediately and be hidden from the default list.')) return;
        try {
            await deleteAnnouncement(id);
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
        if (!confirm(`${verb} ${ids.length} announcement${ids.length === 1 ? '' : 's'}?`)) return;

        setBulkBusy(true);
        let ok = 0;
        let failed = 0;
        // Bulk = sequential calls to the per-row endpoints. Slower than a
        // batch endpoint, but the alternative is a new backend route that
        // wasn't in M2's scope. Acceptable for admin workflows (typically
        // small selection counts).
        for (const id of ids) {
            try {
                if (action === 'pause') {
                    await patchAnnouncement(id, { status: 'paused' });
                } else {
                    await deleteAnnouncement(id); // soft-delete → status='ended'
                }
                ok += 1;
            } catch {
                failed += 1;
            }
        }
        setBulkBusy(false);
        if (failed === 0) {
            toast.success(`${verb}d ${ok} announcement${ok === 1 ? '' : 's'}.`);
        } else if (ok === 0) {
            toast.error(`${verb} failed for all ${failed} selected.`);
        } else {
            toast.message(`${verb}d ${ok}; ${failed} failed.`);
        }
        load();
    }

    function clearDates() {
        setDateFrom('');
        setDateTo('');
    }

    return (
        <div className="w-full py-8 px-6">
            <div className="flex items-center justify-between mb-6 pb-5 border-b border-gray-200 dark:border-gray-800">
                <div>
                    <h1 className="flex items-center gap-2 text-[2rem] font-display font-semibold text-gray-900 dark:text-white leading-tight tracking-tight">
                        <Megaphone size={20} className="text-gray-400" />
                        Announcements
                    </h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Share HR updates, perks, and notices with your workforce on the mobile app.
                    </p>
                </div>
                <Link
                    href="/dashboard/announcements/new"
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                >
                    <Plus size={14} />
                    New announcement
                </Link>
            </div>

            <div className="flex flex-wrap items-center gap-2 mb-4">
                {STATUS_FILTERS.map((f) => (
                    <button
                        key={f.value}
                        onClick={() => setFilter(f.value)}
                        className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                            filter === f.value
                                ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900'
                                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                    >
                        {f.label}
                    </button>
                ))}

                {/* Date range — filters on `created_at`. Local date pickers,
                    converted to UTC ms for the comparator. */}
                <div className="ml-2 inline-flex items-center gap-1 text-xs">
                    <span className="text-gray-500 dark:text-gray-400">Created</span>
                    <input
                        type="date"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                        className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                        aria-label="Date from"
                    />
                    <span className="text-gray-400 dark:text-gray-500">→</span>
                    <input
                        type="date"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                        className="px-2 py-1 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                        aria-label="Date to"
                    />
                    {(dateFrom || dateTo) && (
                        <button
                            onClick={clearDates}
                            className="text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-white"
                            aria-label="Clear date range"
                        >
                            ×
                        </button>
                    )}
                </div>
            </div>

            {/* Bulk action bar — only renders when something is selected so it
                doesn't take vertical space in the common case. */}
            {someSelected && (
                <div className="mb-3 flex items-center justify-between px-4 py-2 rounded-lg bg-gray-900 text-white">
                    <p className="text-sm font-medium">
                        {selected.size} selected
                    </p>
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
                            className="text-xs text-gray-300 hover:text-white ml-2"
                        >
                            Clear
                        </button>
                    </div>
                </div>
            )}

            <div className="border border-gray-100 dark:border-gray-800 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-800/60 text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
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
                            <th className="text-left px-4 py-2 font-semibold">Status</th>
                            <th className="text-right px-4 py-2 font-semibold">Views</th>
                            <th className="text-right px-4 py-2 font-semibold">Clicks</th>
                            <th className="text-right px-4 py-2 font-semibold">CTR</th>
                            <th className="text-left px-4 py-2 font-semibold">Created</th>
                            <th className="px-4 py-2 w-10" />
                        </tr>
                    </thead>
                    <tbody>
                        {loading &&
                            Array.from({ length: 5 }).map((_, i) => (
                                <tr key={`skeleton-${i}`} className="border-t border-gray-100 dark:border-gray-800">
                                    <td className="px-3 py-2.5">
                                        <div className="h-4 w-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                                    </td>
                                    <td className="px-4 py-2.5">
                                        <div className="h-4 w-40 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                                    </td>
                                    <td className="px-4 py-2.5">
                                        <div className="h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded-full animate-pulse" />
                                    </td>
                                    <td className="px-4 py-2.5 text-right">
                                        <div className="h-4 w-8 bg-gray-200 dark:bg-gray-700 rounded animate-pulse ml-auto" />
                                    </td>
                                    <td className="px-4 py-2.5 text-right">
                                        <div className="h-4 w-8 bg-gray-200 dark:bg-gray-700 rounded animate-pulse ml-auto" />
                                    </td>
                                    <td className="px-4 py-2.5 text-right">
                                        <div className="h-4 w-10 bg-gray-200 dark:bg-gray-700 rounded animate-pulse ml-auto" />
                                    </td>
                                    <td className="px-4 py-2.5">
                                        <div className="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                                    </td>
                                    <td className="px-4 py-2.5">
                                        <div className="h-4 w-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse ml-auto" />
                                    </td>
                                </tr>
                            ))}
                        {!loading && filtered.length === 0 && (
                            <tr>
                                <td colSpan={8} className="px-4 py-12 text-center text-gray-400 dark:text-gray-500">
                                    No announcements match the current filters.
                                </td>
                            </tr>
                        )}
                        {!loading &&
                            filtered.map((a) => {
                                const ctr =
                                    a.view_count > 0
                                        ? ((a.click_count / a.view_count) * 100).toFixed(1) + '%'
                                        : '—';
                                const isSel = selected.has(a.sponsored_content_id);
                                return (
                                    <tr
                                        key={a.sponsored_content_id}
                                        className={`border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 ${
                                            isSel ? 'bg-gray-50 dark:bg-gray-800/60' : ''
                                        }`}
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
                                                href={`/dashboard/announcements/${a.sponsored_content_id}`}
                                                className="font-medium text-gray-900 dark:text-white hover:underline"
                                            >
                                                {a.title}
                                            </Link>
                                        </td>
                                        <td className="px-4 py-2.5">
                                            <StatusPill status={a.status} />
                                        </td>
                                        <td className="px-4 py-2.5 text-right tabular-nums">{a.view_count}</td>
                                        <td className="px-4 py-2.5 text-right tabular-nums">{a.click_count}</td>
                                        <td className="px-4 py-2.5 text-right tabular-nums text-gray-500 dark:text-gray-400">{ctr}</td>
                                        <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 text-xs">
                                            {new Date(a.created_at).toLocaleDateString()}
                                        </td>
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

export default function AnnouncementsPage() {
    return (
        <RoleGuard companyPermissions={["manage_announcements"]}>
            <AnnouncementsContent />
        </RoleGuard>
    );
}
