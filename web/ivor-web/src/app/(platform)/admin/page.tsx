"use client";

import AdminDashboardSection from "./components/AdminDashboardSection";
import RoleGuard from "../components/RoleGuard";

export default function AdminPage() {
  return (
    <RoleGuard>
      <AdminDashboardSection />
    </RoleGuard>
  );
}
