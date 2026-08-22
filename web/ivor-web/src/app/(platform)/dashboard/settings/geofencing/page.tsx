import GeofencingSettings from "../../components/GeofencingSettings";
import SolarisBackground from "@/components/ui/SolarisBackground";
import DashboardHeader from "@/components/ui/DashboardHeader";

export const metadata = { title: "Geofencing — Kiruko" };

export default function GeofencingPage() {
  return (
    <SolarisBackground>
      <div className="w-full max-w-7xl mx-auto p-6">
        <DashboardHeader
          title="Geofencing"
          breadcrumbs={[{ label: "Settings", href: "/dashboard/settings" }, { label: "Geofencing" }]}
          back="/dashboard/settings"
        />
        <GeofencingSettings />
      </div>
    </SolarisBackground>
  );
}