"use client";
import NotificationPreferencesSection from "./components/NotificationPreferencesSection";
import SolarisBackground from "@/components/ui/SolarisBackground";
import DashboardHeader from "@/components/ui/DashboardHeader";

export default function NotificationPreferencesPage() {
  return (
    <SolarisBackground>
      <div className="w-full max-w-7xl mx-auto p-6">
        <DashboardHeader
          title="Notification Preferences"
          breadcrumbs={[
            { label: "Settings", href: "/dashboard/settings" },
            { label: "Notification Preferences" },
          ]}
          back="/dashboard/settings"
        />
        <NotificationPreferencesSection />
      </div>
    </SolarisBackground>
  );
}
