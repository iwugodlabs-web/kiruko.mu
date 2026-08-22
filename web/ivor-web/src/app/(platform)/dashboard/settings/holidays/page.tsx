import HolidayRatesSection from "./components/HolidayRatesSection";
import SolarisBackground from "@/components/ui/SolarisBackground";
import DashboardHeader from "@/components/ui/DashboardHeader";
import RoleGuard from "../../../components/RoleGuard";

export const metadata = { title: "Holiday Pay Rates — Kiruko" };

export default function HolidaysPage() {
  return (
    <RoleGuard companyPermissions={["view_attendance"]}>
    <SolarisBackground>
      <div className="w-full max-w-7xl mx-auto p-6">
        <DashboardHeader
          title="Holidays"
          breadcrumbs={[{ label: "Settings", href: "/dashboard/settings" }, { label: "Holidays" }]}
          back="/dashboard/settings"
        />
        <HolidayRatesSection />
      </div>
    </SolarisBackground>
    </RoleGuard>
  );
}
