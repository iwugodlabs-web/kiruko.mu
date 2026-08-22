"use client";
import SectorManagementSection from "./components/SectorManagementSection";
import RoleGuard from "../../components/RoleGuard";

export default function SectorsPage() {
  return (
    <RoleGuard requiredRole="platform_admin">
      <SectorManagementSection />
    </RoleGuard>
  );
}
