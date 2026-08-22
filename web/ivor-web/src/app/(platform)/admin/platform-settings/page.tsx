"use client";

import RoleGuard from "../../components/RoleGuard";
import PlatformSettingsSection from "../../dashboard/components/PlatformSettingsSection";

export default function Page() {
  return (
    <RoleGuard requiredRole="platform_admin">
      <PlatformSettingsSection />
    </RoleGuard>
  );
}
