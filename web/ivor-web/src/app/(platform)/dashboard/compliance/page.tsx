"use client";
import ComplianceSection from "./components/ComplianceSection";
import RoleGuard from "../../components/RoleGuard";

export default function CompliancePage() {
  return (
    <RoleGuard companyPermissions={["view_compliance"]}>
      <ComplianceSection />
    </RoleGuard>
  );
}
