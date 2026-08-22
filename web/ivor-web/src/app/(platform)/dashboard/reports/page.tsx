import ReportsSection from "./components/ReportsSection";
import RoleGuard from "../../components/RoleGuard";

export const metadata = { title: "Reports — Kiruko" };

export default function ReportsPage() {
  return (
    <RoleGuard companyPermissions={["view_reports"]}>
      <ReportsSection />
    </RoleGuard>
  );
}
