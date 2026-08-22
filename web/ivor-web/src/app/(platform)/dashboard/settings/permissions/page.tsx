import PermissionManagerSection from "./components/PermissionManagerSection";
import SolarisBackground from "@/components/ui/SolarisBackground";
import DashboardHeader from "@/components/ui/DashboardHeader";
import RoleGuard from "../../../components/RoleGuard";

export const metadata = { title: "Permission Manager — Kiruko" };

export default function PermissionsPage() {
  return (
    // Gate on the view_roles company permission so delegated management roles
    // (e.g. HR Manager) can open the page; owners/admins bypass inside
    // hasCompanyPermission. Write actions stay gated server-side by
    // _require_role_access (edit_role / manage_roles).
    <RoleGuard companyPermissions={["view_roles"]}>
      <SolarisBackground>
        <div className="w-full max-w-7xl mx-auto p-6">
          <DashboardHeader
            title="Permissions"
            breadcrumbs={[{ label: "Settings", href: "/dashboard/settings" }, { label: "Permissions" }]}
            back="/dashboard/settings"
          />
          <PermissionManagerSection />
        </div>
      </SolarisBackground>
    </RoleGuard>
  );
}
