"use client";

import FieldSalesSection from "./components/FieldSalesSection";
import RoleGuard from "../../components/RoleGuard";

export default function FieldSalesPage() {
  return (
    <RoleGuard
      companyPermissions={["view_salary", "manage_payroll", "view_payslip"]}
      requiredModules={["field_sales"]}
    >
      <FieldSalesSection />
    </RoleGuard>
  );
}
