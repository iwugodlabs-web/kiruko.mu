"use client";

import PayrollRunList from "./components/PayrollRunList";
import RoleGuard from "../../../components/RoleGuard";

export default function PayrollRunsPage() {
  return (
    <RoleGuard companyPermissions={["view_salary", "view_payslip", "manage_payroll"]}>
      <PayrollRunList />
    </RoleGuard>
  );
}
