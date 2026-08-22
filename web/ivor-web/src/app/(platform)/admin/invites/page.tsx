"use client";
import InvitesSection from "../components/InvitesSection";
import RoleGuard from "../../components/RoleGuard";

export default function InvitesPage() {
  return (
    <RoleGuard>
      <InvitesSection />
    </RoleGuard>
  );
}
