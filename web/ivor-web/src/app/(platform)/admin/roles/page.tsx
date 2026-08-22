"use client";
import RolesManagementSection from "../components/RolesManagementSection";
import RoleGuard from "../../components/RoleGuard";

export default function RolesPage() {
    return (
        <RoleGuard>
            <RolesManagementSection />
        </RoleGuard>
    );
}
