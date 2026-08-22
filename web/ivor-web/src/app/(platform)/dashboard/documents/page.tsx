import DocumentsSection from "./components/DocumentsSection";
import RoleGuard from "../../components/RoleGuard";

export const metadata = { title: "Documents — Kiruko" };

export default function DocumentsPage() {
  return (
    <RoleGuard companyPermissions={["view_documents"]}>
      <DocumentsSection />
    </RoleGuard>
  );
}
