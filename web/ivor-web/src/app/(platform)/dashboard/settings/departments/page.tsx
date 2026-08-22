import DepartmentsSection from "./components/DepartmentsSection";
import SolarisBackground from "@/components/ui/SolarisBackground";
import DashboardHeader from "@/components/ui/DashboardHeader";
import RoleGuard from "../../../components/RoleGuard";

export const metadata = { title: "Departments — Kiruko" };

export default function DepartmentsPage() {
  return (
    <RoleGuard companyPermissions={["view_departments"]}>
    <SolarisBackground>
      <div className="w-full max-w-7xl mx-auto p-6">
        <DashboardHeader
          title="Departments"
          breadcrumbs={[{ label: "Settings", href: "/dashboard/settings" }, { label: "Departments" }]}
          back="/dashboard/settings"
        />
        <DepartmentsSection />
      </div>
    </SolarisBackground>
    </RoleGuard>
  );
}
