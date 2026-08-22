"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import RoleGuard from "../../../components/RoleGuard";
import CompanyDetails from "../../components/CompanyDetails";
import SolarisBackground from "@/components/ui/SolarisBackground";
import { getAdminCompanyById, Company } from "@/services/api";
import AdsEnabledToggle from "./AdsEnabledToggle";
import AdminEmployeesTab from "./components/AdminEmployeesTab";
import AdminDepartmentsTab from "./components/AdminDepartmentsTab";
import CompanyLifecycleControls from "./components/CompanyLifecycleControls";

// The backend's /admin/companies/{id} endpoint now surfaces `ads_enabled`
// (M9). The CompanySummary type doesn't declare it, so widen locally.
type CompanyWithAds = Company & { ads_enabled?: boolean };

type LifecycleStatus = "active" | "disabled" | "deleted";
const TABS = ["details", "employees", "departments"] as const;
type Tab = (typeof TABS)[number];

function CompanyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const id = Number(params.id);

  const canEditCompany = user?.hasPermission("manage_companies") ?? false;
  const canDeleteCompany = user?.hasPermission("delete_company") ?? false;
  const canManageData = user?.hasPermission("act_on_behalf_of_company") ?? false;

  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("details");

  useEffect(() => {
    if (!id || isNaN(id)) {
      setError("Invalid company ID");
      setLoading(false);
      return;
    }

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await getAdminCompanyById(id);
        if ("error" in res) {
          setError(res.error);
        } else {
          setCompany(res as Company);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load company");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [id]);

  if (loading) {
    return (
      <SolarisBackground>
        <div className="w-full h-full flex items-center justify-center py-32">
          <div className="w-5 h-5 border-2 border-gray-200 dark:border-gray-800 border-t-gray-800 dark:border-t-gray-200 rounded-full animate-spin" />
        </div>
      </SolarisBackground>
    );
  }

  if (error || !company) {
    return (
      <SolarisBackground>
        <div className="w-full py-10 px-6">
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => router.push("/admin/employers")}
              className="p-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:border-gray-300 dark:hover:border-gray-700 transition-colors"
            >
              <ArrowLeft size={16} />
            </button>
            <span className="text-sm text-gray-500 dark:text-gray-400">Back to Companies</span>
          </div>
          <div className="p-5 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl">
            <p className="text-sm font-medium text-red-700 dark:text-red-400">{error || "Company not found"}</p>
          </div>
        </div>
      </SolarisBackground>
    );
  }

  const adsEnabled = (company as CompanyWithAds).ads_enabled ?? false;
  const status = (company.status ?? "active") as LifecycleStatus;
  const companyId = company.company_id;

  return (
    <SolarisBackground>
      <div className="w-full py-10 px-6">
        {/* Tab bar */}
        <div className="flex items-center gap-1 mb-8 border-b border-gray-200 dark:border-gray-800">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm font-medium capitalize border-b-2 -mb-px transition-colors ${
                tab === t
                  ? "border-slate-900 dark:border-white text-slate-900 dark:text-white"
                  : "border-transparent text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-white"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "details" && (
          <>
            <CompanyDetails
              company={company}
              onBack={() => router.push("/admin/employers")}
              canEdit={canEditCompany}
              onUpdate={(updated) => setCompany(updated as Company)}
            />
            <div className="mt-8 space-y-8">
              {(canEditCompany || canDeleteCompany) && (
                <CompanyLifecycleControls
                  companyId={companyId}
                  status={status}
                  canManage={canEditCompany}
                  canDelete={canDeleteCompany}
                  onChanged={(s) => setCompany({ ...company, status: s })}
                />
              )}
              <AdsEnabledToggle companyId={companyId} initial={adsEnabled} />
            </div>
          </>
        )}

        {tab === "employees" && <AdminEmployeesTab companyId={companyId} canManage={canManageData} />}
        {tab === "departments" && <AdminDepartmentsTab companyId={companyId} canManage={canManageData} />}
      </div>
    </SolarisBackground>
  );
}

export default function CompanyDetailPageGuarded() {
  return (
    <RoleGuard requiredPermissions={["view_companies"]}>
      <CompanyDetailPage />
    </RoleGuard>
  );
}
