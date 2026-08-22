"use client";

import { useCallback, useEffect, useState, use as usePromise } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Copy, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import DashboardHeader from '@/components/ui/DashboardHeader';
import RoleGuard from '../../../components/RoleGuard';
import AnnouncementForm from '../components/AnnouncementForm';
import ServingWindowBanner from '../components/ServingWindowBanner';
import EligibilityPanel from '../../../admin/ads/components/EligibilityPanel';
import {
    Announcement,
    AnnouncementVersion,
    AnnouncementStats,
    announcementCsvUrl,
    createAnnouncement,
    deleteAnnouncement,
    getAnnouncement,
    getAnnouncementStats,
    listAnnouncementVersions,
} from '../../../../../../services/announcements';

function StatsPanel({ stats }: { stats: AnnouncementStats | null }) {
    if (!stats) {
        return <div className="text-sm text-gray-400 dark:text-gray-500">No stats yet.</div>;
    }
    if (stats.total_views === 0 && stats.total_clicks === 0) {
        return (
            <div className="text-sm text-gray-400 dark:text-gray-500">
                Awaiting first impression. Stats appear here once employees see this card.
            </div>
        );
    }
    // Simple SVG bar chart: views per bucket, normalized to 100px height. No
    // chart-lib dependency — this is a single intent (compare buckets) and
    // doesn't need axes / legends / tooltips for the MVP.
    const max = Math.max(1, ...stats.buckets.map((b) => Math.max(b.views, b.clicks)));
    const W = Math.max(stats.buckets.length * 32 + 20, 200);
    return (
        <div>
            <div className="grid grid-cols-3 gap-3 mb-3">
                <Stat label="Views" value={stats.total_views} />
                <Stat label="Clicks" value={stats.total_clicks} />
                <Stat label="CTR" value={`${(stats.ctr * 100).toFixed(1)}%`} />
            </div>
            {stats.buckets.length > 0 && (
                <svg viewBox={`0 0 ${W} 130`} className="w-full h-32">
                    {stats.buckets.map((b, i) => {
                        const x = 10 + i * 32;
                        const vH = (b.views / max) * 100;
                        const cH = (b.clicks / max) * 100;
                        return (
                            <g key={i}>
                                <rect x={x} y={110 - vH} width={10} height={vH} fill="#111827" />
                                <rect x={x + 12} y={110 - cH} width={10} height={cH} fill="#9CA3AF" />
                                <text x={x + 11} y={124} textAnchor="middle" fontSize="9" fill="#9CA3AF">
                                    {new Date(b.bucket).toLocaleDateString(undefined, {
                                        month: 'numeric',
                                        day: 'numeric',
                                    })}
                                </text>
                            </g>
                        );
                    })}
                </svg>
            )}
            <div className="flex items-center gap-3 text-[10px] text-gray-500 dark:text-gray-400 mt-1">
                <span className="inline-flex items-center gap-1">
                    <span className="inline-block w-2 h-2 bg-gray-900 rounded-sm" /> Views
                </span>
                <span className="inline-flex items-center gap-1">
                    <span className="inline-block w-2 h-2 bg-gray-400 rounded-sm" /> Clicks
                </span>
                <span className="ml-auto">Dismissals: {stats.total_dismissals}</span>
            </div>
        </div>
    );
}

function Stat({ label, value }: { label: string; value: string | number }) {
    return (
        <div className="px-3 py-2 rounded-lg border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">{label}</p>
            <p className="text-lg font-semibold tabular-nums text-gray-900 dark:text-white">{value}</p>
        </div>
    );
}

function AnnouncementDetailContent({ id }: { id: number }) {
    const router = useRouter();
    const { user, companyId } = useAuth();
    const companyName = user?.company?.company_name;
    const [announcement, setAnnouncement] = useState<Announcement | null>(null);
    const [versions, setVersions] = useState<AnnouncementVersion[]>([]);
    const [stats, setStats] = useState<AnnouncementStats | null>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [a, v, s] = await Promise.all([
                getAnnouncement(id),
                listAnnouncementVersions(id),
                getAnnouncementStats(id, 'day').catch(() => null),
            ]);
            setAnnouncement(a);
            setVersions(v);
            setStats(s);
        } catch {
            toast.error('Failed to load announcement.');
            router.push('/dashboard/announcements');
        } finally {
            setLoading(false);
        }
    }, [id, router]);

    useEffect(() => {
        load();
    }, [load]);

    async function handleDuplicate() {
        if (!announcement) return;
        try {
            const dup = await createAnnouncement({
                title: announcement.title + ' (copy)',
                body: announcement.body,
                image_url: announcement.image_url,
                cta_label: announcement.cta_label,
                cta_url: announcement.cta_url,
                targeting: announcement.targeting,
            });
            toast.success('Duplicated as draft.');
            router.push(`/dashboard/announcements/${dup.sponsored_content_id}`);
        } catch {
            toast.error('Duplicate failed.');
        }
    }

    async function handleDelete() {
        if (!announcement) return;
        if (!confirm('End this announcement?')) return;
        try {
            await deleteAnnouncement(announcement.sponsored_content_id);
            toast.success('Ended.');
            router.push('/dashboard/announcements');
        } catch {
            toast.error('Delete failed.');
        }
    }

    if (loading || !announcement) {
        return (
            <div className="py-20 text-center text-gray-400 dark:text-gray-500 text-sm">Loading…</div>
        );
    }

    return (
        <div className="w-full py-8 px-6">
            <DashboardHeader
                title={announcement.title}
                subtitle={`ID #${announcement.sponsored_content_id} · created ${new Date(announcement.created_at).toLocaleString()}`}
                breadcrumbs={[
                    { label: 'Announcements', href: '/dashboard/announcements' },
                    { label: announcement.title },
                ]}
                back="/dashboard/announcements"
                extra={
                    <>
                        <a
                            href={announcementCsvUrl(announcement.sponsored_content_id)}
                            className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                        >
                            <Download size={14} />
                            Export CSV
                        </a>
                        <button
                            onClick={handleDuplicate}
                            className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                        >
                            <Copy size={14} />
                            Duplicate
                        </button>
                        <button
                            onClick={handleDelete}
                            className="inline-flex items-center gap-1.5 text-sm font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 px-3 py-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/40"
                        >
                            <Trash2 size={14} />
                            End
                        </button>
                    </>
                }
            />

            <ServingWindowBanner
                status={announcement.status}
                startAt={announcement.start_at}
                endAt={announcement.end_at}
            />

            {/* Eligibility panel is platform-admin only — the endpoint is
                gated server-side. Company admins see the window banner above
                but not this richer diagnostic. */}
            {user?.isPlatformAdmin && (
                <EligibilityPanel contentId={announcement.sponsored_content_id} />
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                <div className="lg:col-span-2 p-4 border border-gray-100 dark:border-gray-800 rounded-xl">
                    <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Performance</h2>
                    <StatsPanel stats={stats} />
                </div>
                <div className="p-4 border border-gray-100 dark:border-gray-800 rounded-xl">
                    <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Version history</h2>
                    {versions.length === 0 && (
                        <p className="text-sm text-gray-400 dark:text-gray-500">No versions.</p>
                    )}
                    <ul className="space-y-2">
                        {versions
                            .slice()
                            .reverse()
                            .map((v) => (
                                <li
                                    key={v.version_id}
                                    className={`text-xs border-l-2 pl-2 ${
                                        v.version_id === announcement.current_version_id
                                            ? 'border-emerald-500'
                                            : 'border-gray-200 dark:border-gray-700'
                                    }`}
                                >
                                    <p className="font-semibold text-gray-700 dark:text-gray-200">
                                        v{v.version_number}
                                        {v.version_id === announcement.current_version_id && (
                                            <span className="ml-1.5 text-emerald-600 dark:text-emerald-400">(current)</span>
                                        )}
                                    </p>
                                    <p className="text-gray-500 dark:text-gray-400">{v.title}</p>
                                    <p className="text-gray-400 dark:text-gray-500">
                                        {new Date(v.created_at).toLocaleString()}
                                    </p>
                                </li>
                            ))}
                    </ul>
                </div>
            </div>

            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">Edit</h2>
            {announcement.deleted_at ? (
                // The backend rejects PATCH on soft-deleted rows with HTTP 410.
                // Hide the edit form entirely instead of rendering an interactive
                // form whose Save button always errors — duplicate the campaign
                // if a revival is needed.
                <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 text-sm text-amber-900 dark:text-amber-400">
                    <p className="font-semibold mb-1">This announcement was ended on{' '}
                        {new Date(announcement.deleted_at).toLocaleString()}.
                    </p>
                    <p>
                        Soft-deleted announcements are kept for analytics + audit
                        but can no longer be edited. To bring this content back,
                        use the <strong>Duplicate</strong> action above —
                        it creates a fresh draft you can republish.
                    </p>
                </div>
            ) : (
                <AnnouncementForm
                    mode="edit"
                    initial={announcement}
                    fundingCompanyName={companyName}
                    fundingCompanyId={companyId ?? undefined}
                    onSaved={(a) => {
                        setAnnouncement(a);
                        load();
                    }}
                />
            )}
        </div>
    );
}

export default function AnnouncementDetailPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    // Next.js 15 — params is a Promise; unwrap with React.use().
    const { id } = usePromise(params);
    const numId = parseInt(id, 10);
    return (
        <RoleGuard companyPermissions={["manage_announcements"]}>
            <AnnouncementDetailContent id={numId} />
        </RoleGuard>
    );
}
