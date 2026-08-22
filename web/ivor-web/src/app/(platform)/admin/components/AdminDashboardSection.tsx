"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/services/apiClient";
import SolarisBackground from "@/components/ui/SolarisBackground";
import DashboardHeader from "@/components/ui/DashboardHeader";
import {
  Building2,
  UserCog,
  Shield,
  Activity,
  Users,
  TrendingUp,
  ArrowRight,
  Clock,
  Database,
  FileText,
  Globe,
  Scale,
  Sparkles,
  Eye,
  Settings,
  Tablet,
} from "lucide-react";
import { COUNTRY_FLAGS } from "@/utils/countryDisplay";
import { ALL_COUNTRIES, useCountry } from "@/contexts/CountryContext";

interface PlatformStats {
  total_companies: number;
  total_users: number;
  unassigned_users: number;
  pending_verifications: number;
  recent_companies: Array<{ company_id: number; company_name: string; brn: string; email: string; country_code?: string }>;
  recent_activity: Array<{ id: number; action: string; resource_type: string; user_id: number; created_at: string }>;
}

interface LinkSpec {
  href: string;
  label: string;
  desc: string;
  icon: React.ElementType;
  color: string;
}

interface LinkGroup {
  title: string;
  blurb: string;
  links: LinkSpec[];
}

// Grouped admin destinations. The grouping mirrors the sidebar's mental model
// (Foundations control how the platform behaves; People manages accounts;
// Content covers ads; Operations is the watch-and-audit layer).
// Color-tile classes for the icon tile next to each link. Dark variants use
// a deep tinted background + brighter foreground so the tile still reads
// against a near-black card without overpowering it.
const TILE_BLUE = "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300";
const TILE_EMERALD = "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300";
const TILE_AMBER = "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300";
const TILE_VIOLET = "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300";
const TILE_RED = "bg-red-50 text-red-500 dark:bg-red-500/15 dark:text-red-300";
const TILE_GRAY = "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";

const linkGroups: LinkGroup[] = [
  {
    title: "Foundations",
    blurb: "Country rules and reference data the engine depends on",
    links: [
      { href: "/admin/payroll-rules", label: "Payroll Rules", desc: "Tax bands, statutory deductions, leave & bonus per country", icon: FileText, color: TILE_BLUE },
      { href: "/admin/sectors", label: "Sectors", desc: "Rate tables & versioned salary references (mobile salary calculator)", icon: Globe, color: TILE_EMERALD },
      { href: "/admin/kiosks", label: "Kiosks", desc: "Shared-device clock-in terminals", icon: Tablet, color: TILE_GRAY },
      { href: "/admin/platform-settings", label: "Platform Settings", desc: "Global config & deployment flags", icon: Settings, color: TILE_GRAY },
    ],
  },
  {
    title: "People & companies",
    blurb: "Accounts, access, and the company roster",
    links: [
      { href: "/admin/employers", label: "Employers", desc: "Registered companies on the platform", icon: Building2, color: TILE_GRAY },
      { href: "/admin/users", label: "Platform Users", desc: "Admin & support accounts (incl. invites)", icon: UserCog, color: TILE_BLUE },
      { href: "/admin/roles", label: "Roles", desc: "Permissions & access control", icon: Shield, color: TILE_AMBER },
    ],
  },
  {
    title: "Content & monetization",
    blurb: "House sponsored fill + moderation (paid 'ad' campaigns arrive in Phase 2)",
    links: [
      { href: "/admin/ads/house", label: "House Content", desc: "Kiruko-wide sponsored fill", icon: Sparkles, color: TILE_VIOLET },
      { href: "/admin/sponsored", label: "Sponsored Moderation", desc: "Moderate announcements + house cards platform-wide", icon: Eye, color: TILE_AMBER },
    ],
  },
  {
    title: "Compliance & audit",
    blurb: "Workflow + immutable trail",
    links: [
      { href: "/admin/compliance", label: "Compliance", desc: "External & aging Your Right reports", icon: Scale, color: TILE_RED },
      { href: "/admin/logs", label: "Audit Logs", desc: "System activity trail", icon: Activity, color: TILE_GRAY },
    ],
  },
];

function StatCard({ label, value, icon: Icon, sub }: { label: string; value: number | string; icon: React.ElementType; sub?: string }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">{label}</p>
          <p className="text-2xl font-semibold text-gray-900 dark:text-white leading-none">{value}</p>
          {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{sub}</p>}
        </div>
        <div className="w-9 h-9 bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center text-gray-500 dark:text-gray-400 shrink-0">
          <Icon size={16} />
        </div>
      </div>
    </div>
  );
}

export default function AdminDashboardSection() {
  const { user } = useAuth();
  // The switcher in the admin bar is the only country control — no local
  // copy here. ALL_COUNTRIES means "no filter" (platform-wide totals).
  const { activeCountry, loading: countryLoading } = useCountry();
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // CountryContext's own localStorage restore happens inside ITS effect,
    // which (as a parent) runs after this component's effect on first
    // mount — so without this guard, a returning admin with e.g. "TZ"
    // stored would see this fire once against the pre-restore "MU"
    // default, then again moments later once the real value loads: a
    // visible stat flash plus a wasted request. `countryLoading` covers
    // both the localStorage restore and the country-list fetch settling.
    if (countryLoading) return;
    let mounted = true;
    setLoading(true);
    const params = activeCountry !== ALL_COUNTRIES ? { country_code: activeCountry } : {};
    api.get("/admin/stats", { params })
      .then((r) => { if (mounted) setStats(r.data); })
      .catch(() => {})
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [activeCountry, countryLoading]);

  const displayName = user?.user_name || user?.email?.split("@")[0] || "Admin";
  const scopeSub = activeCountry === ALL_COUNTRIES ? "across all countries" : "in the selected country";

  return (
    <SolarisBackground>
      <div className="w-full space-y-8 py-10 px-6 animate-in fade-in duration-700">
        <DashboardHeader
          title={`Welcome back, ${displayName}`}
          subtitle="Platform administration overview"
        />

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {loading ? (
            [...Array(3)].map((_, i) => (
              <div key={i} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5 animate-pulse">
                <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-1/2 mb-3" />
                <div className="h-7 bg-gray-100 dark:bg-gray-800 rounded w-1/3" />
              </div>
            ))
          ) : (
            <>
              <StatCard label="Registered Companies" value={stats?.total_companies ?? 0} icon={Building2} sub={scopeSub} />
              <StatCard
                label="Platform Users"
                value={stats?.total_users ?? 0}
                icon={Users}
                sub={
                  // Users with no Company/PrivateUser row yet (mid-signup)
                  // aren't counted under any single country, so the sum of
                  // every country's total can come up short of this
                  // "All countries" figure — surfaced here instead of
                  // leaving that gap unexplained.
                  activeCountry === ALL_COUNTRIES && (stats?.unassigned_users ?? 0) > 0
                    ? `${scopeSub} · ${stats!.unassigned_users} not yet assigned to a country`
                    : scopeSub
                }
              />
              <StatCard label="Pending Verifications" value={stats?.pending_verifications ?? 0} icon={TrendingUp} sub={scopeSub} />
            </>
          )}
        </div>

        {/* Grouped admin sections */}
        <div className="space-y-5">
          {linkGroups.map((group) => (
            <div
              key={group.title}
              className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden"
            >
              <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{group.title}</h2>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{group.blurb}</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-gray-100 dark:bg-gray-700/60">
                {group.links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="bg-white dark:bg-gray-900 px-5 py-4 flex items-center gap-3.5 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group"
                  >
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${link.color}`}>
                      <link.icon size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">{link.label}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{link.desc}</p>
                    </div>
                    <ArrowRight size={14} className="text-gray-300 dark:text-gray-600 group-hover:text-gray-500 dark:group-hover:text-gray-300 transition-colors shrink-0" />
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Recent companies */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center">
                  <Building2 size={13} className="text-gray-600 dark:text-gray-400" />
                </div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Recent Companies</h2>
              </div>
              <Link href="/admin/employers" className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">View all →</Link>
            </div>
            {loading ? (
              <div className="divide-y divide-gray-50 dark:divide-gray-800">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="px-5 py-3 animate-pulse flex items-center gap-3">
                    <div className="w-7 h-7 bg-gray-100 dark:bg-gray-800 rounded-lg shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-2/3" />
                      <div className="h-2.5 bg-gray-100 dark:bg-gray-800 rounded w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : !stats?.recent_companies?.length ? (
              <div className="px-5 py-10 text-center text-xs text-gray-400 dark:text-gray-500">No companies yet</div>
            ) : (
              <div className="divide-y divide-gray-50 dark:divide-gray-800">
                {stats.recent_companies.map((c) => (
                  <Link
                    key={c.company_id}
                    href={`/admin/employers/${c.company_id}`}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group"
                  >
                    <div className="w-7 h-7 bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center text-[10px] font-bold text-gray-600 dark:text-gray-400 shrink-0">
                      {c.company_name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate flex items-center gap-1.5">
                        {c.company_name}
                        {c.country_code && <span title={c.country_code}>{COUNTRY_FLAGS[c.country_code] ?? c.country_code}</span>}
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{c.email || c.brn}</p>
                    </div>
                    <ArrowRight size={12} className="text-gray-300 dark:text-gray-600 group-hover:text-gray-500 dark:group-hover:text-gray-300 shrink-0" />
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Recent activity */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center">
                  <Activity size={13} className="text-gray-600 dark:text-gray-400" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Recent Activity</h2>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500">Platform-wide — not scoped to the country switcher</p>
                </div>
              </div>
              <Link href="/admin/logs" className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">View all →</Link>
            </div>
            {loading ? (
              <div className="divide-y divide-gray-50 dark:divide-gray-800">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="px-5 py-3 animate-pulse flex items-center gap-3">
                    <div className="w-7 h-7 bg-gray-100 dark:bg-gray-800 rounded-lg shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-2/3" />
                      <div className="h-2.5 bg-gray-100 dark:bg-gray-800 rounded w-1/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : !stats?.recent_activity?.length ? (
              <div className="px-5 py-10 text-center text-xs text-gray-400 dark:text-gray-500">No recent activity</div>
            ) : (
              <div className="divide-y divide-gray-50 dark:divide-gray-800">
                {stats.recent_activity.slice(0, 5).map((log, i) => (
                  <div key={log.id ?? i} className="flex items-center gap-3 px-5 py-3">
                    <div className="w-7 h-7 bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center text-gray-500 dark:text-gray-400 shrink-0">
                      <Database size={12} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{log.action}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">{log.resource_type || "—"}</p>
                    </div>
                    <div className="shrink-0 flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                      <Clock size={10} />
                      <span>{log.created_at ? new Date(log.created_at).toLocaleDateString() : "—"}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </SolarisBackground>
  );
}
