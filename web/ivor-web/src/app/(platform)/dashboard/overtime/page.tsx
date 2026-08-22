import OvertimeSection from "./components/OvertimeSection";
import RoleGuard from "../../components/RoleGuard";

export const metadata = { title: "Overtime — Kiruko" };

export default function OvertimePage() {
  return (
    <RoleGuard companyPermissions={["view_overtime"]}>
      <OvertimeSection />
    </RoleGuard>
  );
}
