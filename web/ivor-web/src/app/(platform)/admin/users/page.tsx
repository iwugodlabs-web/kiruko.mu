"use client";
import PlatformUsersSection from "../components/PlatformUsersSection";
import RoleGuard from "../../components/RoleGuard";

export default function UsersPage() {
  return (
    <RoleGuard>
      <PlatformUsersSection />
    </RoleGuard>
  );
}
