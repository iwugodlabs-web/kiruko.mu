"use client";

import EmployeeVerificationSection from "../components/EmployeeVerificationSection";
import RoleGuard from "../../components/RoleGuard";

export default function Page() {
  return (
    <RoleGuard companyPermissions={["view_employee"]}>
      <EmployeeVerificationSection />
    </RoleGuard>
  );
}
