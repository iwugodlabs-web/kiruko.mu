"use client";
import AttendanceSection from "./components/AttendanceSection";
import RoleGuard from "../../components/RoleGuard";

export default function AttendancePage() {
  return (
    <RoleGuard companyPermissions={["view_attendance"]}>
      <AttendanceSection />
    </RoleGuard>
  );
}
