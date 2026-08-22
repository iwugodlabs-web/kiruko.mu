"use client";

import { useRouter } from 'next/navigation';
import DashboardHeader from '@/components/ui/DashboardHeader';
import RoleGuard from '../../../components/RoleGuard';
import AdCampaignForm from '../components/AdCampaignForm';

function NewAdContent() {
    const router = useRouter();
    return (
        <div className="w-full py-8 px-6">
            <DashboardHeader
                title="New ad campaign"
                subtitle="Drafts don't serve. Set status to Active after creation; serving also requires the deployment's ENABLED_KINDS env var to include 'ad'."
                breadcrumbs={[
                    { label: 'Ad Campaigns', href: '/admin/ads' },
                    { label: 'New' },
                ]}
                back="/admin/ads"
            />

            <AdCampaignForm
                mode="create"
                onSaved={(a) => router.push(`/admin/ads/${a.sponsored_content_id}`)}
                onCancel={() => router.push('/admin/ads')}
            />
        </div>
    );
}

export default function NewAdPage() {
    return (
        <RoleGuard requiredRole={['platform_admin']}>
            <NewAdContent />
        </RoleGuard>
    );
}
