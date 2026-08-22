"use client";
import EmployersSection from "../components/EmployersSection";
import RoleGuard from "../../components/RoleGuard";

export default function EmployersPage() {
  return (
    <RoleGuard requiredPermissions={["view_companies"]}>
      <EmployersSection />
    </RoleGuard>
  );
}
