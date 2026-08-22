"use client";
import AuditLogsSection from "../components/AuditLogsSection";
import RoleGuard from "../../components/RoleGuard";

export default function LogsPage() {
  return (
    <RoleGuard>
      <AuditLogsSection />
    </RoleGuard>
  );
}
