"use client";

/**
 * Shared stats visualization for sponsored content. Consumes the shape
 * returned by `/admin/ads/campaigns/{id}/stats` (kind='ad') OR the cross-
 * kind `/admin/sponsored/{id}/stats` (works for ad / employer / house).
 *
 * Same component on both the ad detail page and the inline house listing
 * expansion, so a typography or chart-style tweak lands in both at once.
 */

import type { AnnouncementStats } from '../../../../../../services/announcements';

export default function StatsPanel({ stats }: { stats: AnnouncementStats | null }) {
    if (!stats) return <div className="text-sm text-gray-400 dark:text-gray-500">No stats yet.</div>;
    if (stats.total_views === 0 && stats.total_clicks === 0) {
        return (
            <div className="text-sm text-gray-400 dark:text-gray-500">
                Awaiting first impression. Stats appear once the campaign serves.
            </div>
        );
    }
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
                                    {new Date(b.bucket).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}
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
        <div className="px-3 py-2 rounded-lg border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/40">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500">{label}</p>
            <p className="text-lg font-semibold tabular-nums text-gray-900 dark:text-gray-100">{value}</p>
        </div>
    );
}
