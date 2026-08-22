"use client";

import LeaveAndRequestsSection from "../components/LeaveAndRequestsSection";
import RoleGuard from "../../components/RoleGuard";

export default function Page() {
  return (
    <RoleGuard companyPermissions={["view_leave"]}>
      <LeaveAndRequestsSection />
    </RoleGuard>
  );
}
