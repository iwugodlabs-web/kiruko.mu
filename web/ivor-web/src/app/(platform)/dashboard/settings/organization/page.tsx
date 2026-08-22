import OrgChartSection from "./components/OrgChartSection";
import SolarisBackground from "@/components/ui/SolarisBackground";
import DashboardHeader from "@/components/ui/DashboardHeader";
import RoleGuard from "../../../components/RoleGuard";

export const metadata = { title: "Organisation Chart — Kiruko" };

export default function OrganizationPage() {
  return (
    <RoleGuard companyPermissions={["view_departments"]}>
    <SolarisBackground>
      <div className="w-full max-w-7xl mx-auto p-6">
        <DashboardHeader
          title="Organisation"
          breadcrumbs={[{ label: "Settings", href: "/dashboard/settings" }, { label: "Organisation" }]}
          back="/dashboard/settings"
        />
        <OrgChartSection />
      </div>
    </SolarisBackground>
    </RoleGuard>
  );
}
