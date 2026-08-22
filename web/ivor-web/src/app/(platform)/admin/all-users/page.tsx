"use client";
import AllUsersSection from "../components/AllUsersSection";
import RoleGuard from "../../components/RoleGuard";

export default function AllUsersPage() {
  return (
    <RoleGuard>
      <AllUsersSection />
    </RoleGuard>
  );
}
