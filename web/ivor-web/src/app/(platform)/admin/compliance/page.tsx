"use client";
import ComplianceSection from "./components/ComplianceSection";
import RoleGuard from "../../components/RoleGuard";

export default function CompliancePage() {
  return (
    <RoleGuard
      requiredRole={["compliance_officer", "platform_admin"]}
      requiredPermissions={["manage_compliance_cases"]}
    >
      <ComplianceSection />
    </RoleGuard>
  );
}
