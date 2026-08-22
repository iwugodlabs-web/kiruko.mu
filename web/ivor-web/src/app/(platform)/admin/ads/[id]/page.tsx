"use client";

import { useCallback, useEffect, useState, use as usePromise } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Copy, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import DashboardHeader from '@/components/ui/DashboardHeader';
import RoleGuard from '../../../components/RoleGuard';
import AdCampaignForm from '../components/AdCampaignForm';
import EligibilityPanel from '../components/EligibilityPanel';
import StatsPanel from '../components/StatsPanel';
import ServingWindowBanner from '../../../dashboard/announcements/components/ServingWindowBanner';
import type { AnnouncementStats, AnnouncementVersion } from '../../../../../../services/announcements';
import {
    AdCampaign,
    AdTargeting,
    adCsvUrl,
    createAdCampaign,
    deleteAdCampaign,
    getAdCampaign,
    getAdStats,
    listAdVersions,
} from '../../../../../../services/ads';

function AdDetailContent({ id }: { id: number }) {
    const router = useRouter();
    const [ad, setAd] = useState<AdCampaign | null>(null);
    const [versions, setVersions] = useState<AnnouncementVersion[]>([]);
    const [stats, setStats] = useState<AnnouncementStats | null>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [a, v, s] = await Promise.all([
                getAdCampaign(id),
                listAdVersions(id),
                getAdStats(id, 'day').catch(() => null),
            ]);
            setAd(a);
            setVersions(v);
            setStats(s);
        } catch {
            toast.error('Failed to load campaign.');
            router.push('/admin/ads');
        } finally {
            setLoading(false);
        }
    }, [id, router]);
    useEffect(() => { load(); }, [load]);

    async function handleDuplicate() {
        if (!ad) return;
        if (ad.funding_company_id == null || ad.paid_amount_cents == null || !ad.paid_currency) {
            toast.error('Cannot duplicate — missing advertiser or payment data.');
            return;
        }
        try {
            const dup = await createAdCampaign({
                funding_company_id: ad.funding_company_id,
                title: ad.title + ' (copy)',
                body: ad.body,
                image_url: ad.image_url,
                cta_label: ad.cta_label,
                cta_url: ad.cta_url,
                // The backend stores `targeting` as JSONB; the typed field
                // declares the employer shape, but for an ad row it actually
                // holds the cross-company shape. Cast through `unknown` so we
                // forward whatever's there without lying about the schema.
                targeting: ad.targeting as unknown as AdTargeting,
                paid_amount_cents: ad.paid_amount_cents,
                paid_currency: ad.paid_currency,
                payment_notes: ad.payment_notes,
                variant_group: ad.variant_group,
                variant_label: ad.variant_label,
            });
            toast.success('Duplicated as draft.');
            router.push(`/admin/ads/${dup.sponsored_content_id}`);
        } catch {
            toast.error('Duplicate failed.');
        }
    }

    async function handleDelete() {
        if (!ad) return;
        if (!confirm('End this campaign?')) return;
        try {
            await deleteAdCampaign(ad.sponsored_content_id);
            toast.success('Ended.');
            router.push('/admin/ads');
        } catch {
            toast.error('Delete failed.');
        }
    }

    if (loading || !ad) {
        return <div className="py-20 text-center text-gray-400 dark:text-gray-500 text-sm">Loading…</div>;
    }

    return (
        <div className="w-full py-8 px-6">
            <DashboardHeader
                title={ad.title}
                subtitle={`ID #${ad.sponsored_content_id} · advertiser #${ad.funding_company_id} · created ${new Date(ad.created_at).toLocaleString()}`}
                breadcrumbs={[
                    { label: 'Ad Campaigns', href: '/admin/ads' },
                    { label: ad.title },
                ]}
                back="/admin/ads"
                extra={
                    <>
                        <a
                            href={adCsvUrl(ad.sponsored_content_id)}
                            className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 px-3 py-1.5 rounded-lg hover:bg-gray-100"
                        >
                            <Download size={14} />
                            Export CSV
                        </a>
                        <button
                            onClick={handleDuplicate}
                            className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 px-3 py-1.5 rounded-lg hover:bg-gray-100"
                        >
                            <Copy size={14} />
                            Duplicate
                        </button>
                        <button
                            onClick={handleDelete}
                            className="inline-flex items-center gap-1.5 text-sm font-medium text-red-600 dark:text-red-300 hover:text-red-700 px-3 py-1.5 rounded-lg hover:bg-red-50"
                        >
                            <Trash2 size={14} />
                            End
                        </button>
                    </>
                }
            />

            <ServingWindowBanner
                status={ad.status}
                startAt={ad.start_at}
                endAt={ad.end_at}
            />

            <EligibilityPanel contentId={ad.sponsored_content_id} />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                <div className="lg:col-span-2 p-4 border border-gray-100 dark:border-gray-800 rounded-xl">
                    <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Performance</h2>
                    <StatsPanel stats={stats} />
                </div>
                <div className="p-4 border border-gray-100 dark:border-gray-800 rounded-xl">
                    <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Version history</h2>
                    {versions.length === 0 && (
                        <p className="text-sm text-gray-400 dark:text-gray-500">No versions.</p>
                    )}
                    <ul className="space-y-2">
                        {versions.slice().reverse().map((v) => (
                            <li
                                key={v.version_id}
                                className={`text-xs border-l-2 pl-2 ${
                                    v.version_id === ad.current_version_id
                                        ? 'border-emerald-500'
                                        : 'border-gray-200 dark:border-gray-800'
                                }`}
                            >
                                <p className="font-semibold text-gray-700 dark:text-gray-300">
                                    v{v.version_number}
                                    {v.version_id === ad.current_version_id && (
                                        <span className="ml-1.5 text-emerald-600 dark:text-emerald-300">(current)</span>
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

            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">Edit</h2>
            {ad.deleted_at ? (
                <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 text-sm text-amber-900">
                    <p className="font-semibold mb-1">
                        This campaign was ended on {new Date(ad.deleted_at).toLocaleString()}.
                    </p>
                    <p>
                        Soft-deleted campaigns are kept for analytics + audit but can no
                        longer be edited. Use <strong>Duplicate</strong> above to
                        revive — it creates a fresh draft you can republish.
                    </p>
                </div>
            ) : (
                <AdCampaignForm
                    mode="edit"
                    initial={ad}
                    onSaved={(a) => {
                        setAd(a);
                        load();
                    }}
                />
            )}
        </div>
    );
}

export default function AdDetailPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = usePromise(params);
    const numId = parseInt(id, 10);
    return (
        <RoleGuard requiredRole={['platform_admin']}>
            <AdDetailContent id={numId} />
        </RoleGuard>
    );
}
