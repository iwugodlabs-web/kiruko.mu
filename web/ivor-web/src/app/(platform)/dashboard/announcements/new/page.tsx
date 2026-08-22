"use client";

import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import DashboardHeader from '@/components/ui/DashboardHeader';
import RoleGuard from '../../../components/RoleGuard';
import AnnouncementForm from '../components/AnnouncementForm';

function NewAnnouncementContent() {
    const router = useRouter();
    const { user, companyId } = useAuth();
    const companyName = user?.company?.company_name;

    return (
        <div className="w-full py-8 px-6">
            <DashboardHeader
                title="New announcement"
                subtitle="Drafts don't serve. Change the status to Active after creating to start showing it to your workforce."
                breadcrumbs={[
                    { label: 'Announcements', href: '/dashboard/announcements' },
                    { label: 'New' },
                ]}
                back="/dashboard/announcements"
            />

            <AnnouncementForm
                mode="create"
                fundingCompanyName={companyName}
                fundingCompanyId={companyId ?? undefined}
                onSaved={(a) => router.push(`/dashboard/announcements/${a.sponsored_content_id}`)}
                onCancel={() => router.push('/dashboard/announcements')}
            />
        </div>
    );
}

export default function NewAnnouncementPage() {
    return (
        <RoleGuard companyPermissions={["manage_announcements"]}>
            <NewAnnouncementContent />
        </RoleGuard>
    );
}
