"use client";
import DisputesSection from "./components/DisputesSection";
import RoleGuard from "../../components/RoleGuard";

export default function DisputesPage() {
  return (
    <RoleGuard companyPermissions={["view_disputes"]}>
      <DisputesSection />
    </RoleGuard>
  );
}
