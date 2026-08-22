"use client";

import LeaveTypesTable from "./components/LeaveTypesTable";
import SolarisBackground from "@/components/ui/SolarisBackground";
import DashboardHeader from "@/components/ui/DashboardHeader";
import RoleGuard from "../../../components/RoleGuard";

export default function LeaveTypesPage() {
  return (
    <RoleGuard companyPermissions={["view_leave"]}>
    <SolarisBackground>
      <div className="w-full max-w-7xl mx-auto p-6">
        <DashboardHeader
          title="Leave Types"
          subtitle="The catalog of leave types employees can apply for. Country-default types (annual, sick, maternity, paternity for Mauritius) are seeded from platform rules; you can add custom ones on top."
          breadcrumbs={[{ label: "Settings", href: "/dashboard/settings" }, { label: "Leave Types" }]}
          back="/dashboard/settings"
        />
        <LeaveTypesTable />
      </div>
    </SolarisBackground>
    </RoleGuard>
  );
}
