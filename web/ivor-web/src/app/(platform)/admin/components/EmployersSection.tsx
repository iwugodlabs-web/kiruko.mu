"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Search,
  Plus,
  Briefcase,
  Clock3,
  CheckCircle2,
  TrendingUp,
  Settings2,
  LayoutGrid,
  ShieldCheck,
} from "lucide-react";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import CompanyCard from "@/app/(platform)/dashboard/components/CompanyCard";
import { getAdminCompanies, getAdminCompaniesStats, getCompanyStats, deleteCompany, CompanySummary, CompanyStats } from "@/services/api";
import AddCompanyModal from "./modals/AddCompanyModal";
import EditCompanyModal from "./modals/EditCompanyModal";
import { ConfirmModal } from "@/components/Modal";
import CompanyDetails from "./CompanyDetails";
import AdsEnabledToggle from "../employers/[id]/AdsEnabledToggle";
import DashboardHeader from "@/components/ui/DashboardHeader";
import SolarisBackground from "@/components/ui/SolarisBackground";
import FilterPillGroup from "@/components/ui/FilterPillGroup";
import { ALL_COUNTRIES, useCountry } from "@/contexts/CountryContext";

export default function EmployersSection() {
  // The switcher in the admin bar is the only country control — no local
  // copy here. ALL_COUNTRIES means "no filter."
  const { activeCountry } = useCountry();
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [statsMap, setStatsMap] = useState<Record<number, CompanyStats | null>>({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | "verified" | "pending">("all");
  const [totals, setTotals] = useState({ totalCompanies: 0, verified: 0, pending: 0, openJobs: 0 });
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingCompany, setEditingCompany] = useState<CompanySummary | null>(null);
  const [selectedEmployer, setSelectedEmployer] = useState<CompanySummary | null>(null);
  const [showConfirm, setShowConfirm] = useState<{ show: boolean, id?: number }>({ show: false });
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const countryFilter = activeCountry !== ALL_COUNTRIES ? activeCountry : undefined;
    const load = async () => {
      setLoading(true);
      try {
        // Stat cards come from a server-side COUNT (getAdminCompaniesStats),
        // NOT summed from `list` below — `list` is capped/paginated (100 at
        // a time), so summing it would silently undercount past that page,
        // and previously never re-scoped to the Country Switcher at all.
        const [res, statsRes] = await Promise.all([
          getAdminCompanies(100, 0, countryFilter),
          getAdminCompaniesStats(countryFilter),
        ]);
        if ('error' in res) { setError(res.error); setLoading(false); return; }
        const list = res as CompanySummary[];
        setCompanies(list);

        if (!('error' in statsRes)) {
          setTotals({
            totalCompanies: statsRes.total_companies,
            verified: statsRes.total_verified_headcount,
            pending: statsRes.total_pending_verifications,
            openJobs: statsRes.total_open_jobs,
          });
        }

        // Per-company stats still fetched per-row — used for the table's
        // individual badges/filtering, not the headline totals above.
        const statsPromises = list.map(c => getCompanyStats(c.company_id));
        const perCompanyStats = await Promise.all(statsPromises);
        const map: Record<number, CompanyStats | null> = {};
        list.forEach((c, i) => {
          const s = perCompanyStats[i];
          map[c.company_id] = (s as any)?.error ? null : (s as CompanyStats);
        });
        setStatsMap(map);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [activeCountry]);

  const filtered = useMemo(() => {
    return companies.filter(c => {
      const matchesSearch =
        c.company_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.brn?.toLowerCase().includes(searchTerm.toLowerCase());

      if (!matchesSearch) return false;
      if (activeCountry !== ALL_COUNTRIES && c.country_code !== activeCountry) return false;

      const stats = statsMap[c.company_id];
      if (activeFilter === "verified") return (stats?.verified_headcount || 0) > 0;
      if (activeFilter === "pending") return (stats?.pending_verifications || 0) > 0;

      return true;
    });
  }, [companies, searchTerm, activeFilter, activeCountry, statsMap]);


  const router = useRouter();
  const handleView = (c: any) => {
    const id = typeof c === 'number' ? c : c?.company_id;
    if (id) router.push(`/admin/employers/${id}`);
  };

  const { user } = useAuth();

  return (
    <SolarisBackground>
      <div className="w-full space-y-8 py-10 px-6 animate-in fade-in duration-700">
        {!selectedEmployer ? (
          <>
            <DashboardHeader
              title="Employers"
              subtitle={`Manage company accounts • ${user?.email || 'Admin'}`}
              extra={
                <div className="flex flex-col xl:flex-row items-center gap-3 w-full xl:w-auto">
                  <div className="relative flex-1 group min-w-[280px] w-full">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                    <input
                      type="text"
                      placeholder="Search companies..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full pl-9 pr-4 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-900/5 dark:focus:ring-white/10 focus:border-gray-300 dark:focus:border-gray-600 transition-colors"
                    />
                  </div>
                  <button
                    onClick={() => setShowAddModal(true)}
                    className="w-full xl:w-auto px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors flex items-center justify-center gap-2"
                  >
                    <Plus size={14} />
                    Add Company
                  </button>
                </div>
              }
            />

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Companies', value: totals.totalCompanies, icon: Briefcase },
                { label: 'Verified Staff', value: totals.verified, icon: CheckCircle2 },
                { label: 'Pending', value: totals.pending, icon: Clock3 },
                { label: 'Open Jobs', value: totals.openJobs, icon: TrendingUp },
              ].map((m, i) => (
                <div key={i} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500 dark:text-gray-400">
                      <m.icon size={16} />
                    </div>
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{m.label}</span>
                  </div>
                  <div className="text-2xl font-semibold text-gray-900 dark:text-white">
                    {loading ? '—' : m.value}
                  </div>
                </div>
              ))}
            </div>

            <FilterPillGroup
              value={activeFilter}
              onChange={setActiveFilter}
              options={[
                { value: 'all', label: 'All', icon: LayoutGrid },
                { value: 'verified', label: 'Verified', icon: ShieldCheck },
                { value: 'pending', label: 'Pending', icon: Clock3, badge: totals.pending },
              ]}
            />

            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
                <Settings2 className="text-red-500 mt-0.5 shrink-0" size={15} />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            {loading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {[1, 2, 3, 4, 5, 6].map(i => (
                  <div key={i} className="h-48 bg-gray-100 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 pb-20 duration-1000 delay-300">
                {filtered.length === 0 ? (
                  <div className="col-span-full py-16 text-center bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 border-dashed">
                    <div className="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center mx-auto mb-4">
                      <Search className="w-4 h-4 text-gray-400" />
                    </div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">No companies found</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">Try adjusting your search or filters</p>
                    <button
                      onClick={() => setSearchTerm("")}
                      className="px-4 py-2 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-800 transition-colors"
                    >
                      Clear search
                    </button>
                  </div>
                ) : (
                  filtered.map((c: any) => {
                    const s = statsMap[c.company_id];
                    return (
                      <CompanyCard
                        key={c.company_id}
                        company={c}
                        stats={s ? {
                          verified_headcount: s.verified_headcount ?? 0,
                          pending_verifications: s.pending_verifications ?? 0,
                          open_jobs_count: s.open_jobs_count ?? 0
                        } : null}
                        onView={handleView}
                        onManage={handleView}
                        onEdit={() => setEditingCompany(c)}
                        onDelete={(id: number) => setShowConfirm({ show: true, id })}
                        disabledActions={false}
                      />
                    );
                  })
                )}
              </div>
            )}

            {showAddModal && (
              <AddCompanyModal onClose={() => setShowAddModal(false)} onCreated={(c) => {
                setCompanies((prev) => [c, ...prev]);
                (async () => {
                  const s = await getCompanyStats(c.company_id);
                  setStatsMap(prev => ({ ...prev, [c.company_id]: (s as any)?.error ? null : (s as CompanyStats) }));
                })();
              }} />
            )}

            {editingCompany && (
              <EditCompanyModal company={editingCompany as any} onClose={() => setEditingCompany(null)} onSaved={(c) => {
                setCompanies(prev => prev.map(p => p.company_id === c.company_id ? c : p));
              }} />
            )}

            <ConfirmModal
              isOpen={showConfirm.show}
              onClose={() => setShowConfirm({ show: false })}
              title="Delete Company"
              message="This soft-deletes the company: it will be hidden and access blocked for its users. You can restore it later from the company's detail page."
              type="danger"
              confirmText="Delete"
              loading={deleting}
              onConfirm={async () => {
                setDeleting(true);
                try {
                  const res = await deleteCompany(showConfirm.id!);
                  if ((res as any)?.error) {
                    setError((res as any).error);
                  } else {
                    setCompanies(prev => prev.filter(p => p.company_id !== showConfirm.id));
                    setShowConfirm({ show: false });
                  }
                } catch (e: any) {
                  setError(e?.message || String(e));
                } finally {
                  setDeleting(false);
                }
              }}
            />
          </>
        ) : (
          <>
            <CompanyDetails company={selectedEmployer as any} onBack={() => setSelectedEmployer(null)} canEdit onUpdate={(c: any) => setCompanies(prev => prev.map(p => p.company_id === c.company_id ? c : p))} />
            <div className="mt-8 max-w-6xl mx-auto px-6">
              <AdsEnabledToggle
                companyId={selectedEmployer.company_id}
                initial={(selectedEmployer as { ads_enabled?: boolean }).ads_enabled ?? false}
              />
            </div>
          </>
        )}
      </div>
    </SolarisBackground>
  );
}
