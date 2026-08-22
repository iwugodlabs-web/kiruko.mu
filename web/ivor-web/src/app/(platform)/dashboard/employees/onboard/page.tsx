import OnboardingWizard from "./components/OnboardingWizard";
import RoleGuard from "../../../components/RoleGuard";

export const metadata = { title: "Onboard Employee — Kiruko" };

export default function OnboardPage() {
  return (
    <RoleGuard companyPermissions={["view_employee"]}>
      <OnboardingWizard />
    </RoleGuard>
  );
}
