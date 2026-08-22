"use client";
import SalariesSection from "./components/SalariesSection";
import RoleGuard from "../../components/RoleGuard";

export default function SalariesPage() {
  return (
    <RoleGuard companyPermissions={["view_salary", "view_payslip", "manage_payroll"]}>
      <SalariesSection />
    </RoleGuard>
  );
}
