"use client";

import { Suspense } from "react";
import EmployeesSection from "../components/EmployeesSection";
import RoleGuard from "../../components/RoleGuard";

export default function Page() {
  return (
    <RoleGuard companyPermissions={["view_employee"]}>
      <Suspense fallback={null}>
        <EmployeesSection />
      </Suspense>
    </RoleGuard>
  );
}
