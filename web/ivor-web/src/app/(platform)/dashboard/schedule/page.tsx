import ScheduleSection from "./components/ScheduleSection";
import RoleGuard from "../../components/RoleGuard";

export const metadata = { title: "Schedule — Kiruko" };

export default function SchedulePage() {
  return (
    <RoleGuard companyPermissions={["view_schedule"]}>
      <ScheduleSection />
    </RoleGuard>
  );
}
