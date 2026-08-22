"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
    Building2, Users, Shield, Bell, FileText,
    TrendingUp, Activity, ExternalLink, Settings2,
    Clock, CheckCircle
} from "lucide-react";
import { api } from "@/services/apiClient";
import { useAuth } from "@/contexts/AuthContext";
import SolarisBackground from "@/components/ui/SolarisBackground";
import DashboardHeader from "@/components/ui/DashboardHeader";
import MetricCard from "@/components/ui/MetricCard";
import { ConfirmModal } from "@/components/Modal";

interface PlatformStats {
    total_companies: number;
    total_users: number;
    pending_verifications: number;
    active_sessions?: number;
    recent_companies: Array<{
        company_id: number;
        company_name: string;
        brn: string;
        email: string;
        created_at: string | null;
    }>;
    recent_activity: Array<{
        id: number;
        user_id: number;
        action: string;
        resource_type: string;
        resource_id: number;
        details: string;
        created_at: string;
    }>;
}

export default function PlatformDashboard() {
    const { user } = useAuth();
    const [stats, setStats] = useState<PlatformStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const response = await api.get('/admin/stats');
                setStats(response.data);
            } catch (err) {
                console.error('Failed to fetch platform stats:', err);
                setError('Failed to load dashboard data');
            } finally {
                setLoading(false);
            }
        };

        fetchStats();
    }, []);

    const u = user as any;

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center p-12">
                <div className="text-center">
                    <div className="w-6 h-6 border-2 border-gray-200 dark:border-gray-700 border-t-gray-800 dark:border-t-gray-300 rounded-full animate-spin mb-3 mx-auto"></div>
                    <p className="text-gray-600 dark:text-gray-400">Loading dashboard...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="h-full flex items-center justify-center p-12">
                <div className="text-center text-red-500 dark:text-red-400">
                    <p>{error}</p>
                    <button
                        onClick={() => window.location.reload()}
                        className="mt-4 px-4 py-2 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-950/60 transition"
                    >
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <SolarisBackground>
            <div className="w-full space-y-8 py-10 px-6 animate-in fade-in duration-700">
                <DashboardHeader
                    title="Platform Dashboard"
                    subtitle={`Master Administration • ${u?.user_name || u?.email?.split('@')[0] || 'Administrator'}`}
                />

                {/* Primary Metrics Strip */}
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm p-2">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        {[
                            { label: 'Total Companies', value: stats?.total_companies || 0, icon: Building2, subtitle: 'Registered entities', href: '/admin/employers' },
                            { label: 'Verified Users', value: stats?.total_users || 0, icon: Users, subtitle: 'Managed accounts', href: '/admin/users' },
                            { label: 'Pending Review', value: stats?.pending_verifications || 0, icon: CheckCircle, subtitle: 'Integrity queue', href: '/admin/invites' },
                            { label: 'Active Sessions', value: stats?.active_sessions ?? '—', icon: Activity, subtitle: 'Live connections', href: '/admin/logs' },
                        ].map((m, i) => (
                            <Link key={i} href={m.href} className="bg-gray-50 dark:bg-gray-800 rounded-xl p-5 border border-transparent hover:border-gray-200 dark:hover:border-gray-700 hover:bg-white dark:hover:bg-gray-700 transition-colors group block">
                                <div className="flex items-center gap-3 mb-3">
                                    <div className="w-8 h-8 rounded-lg bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 flex items-center justify-center text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-colors">
                                        <m.icon size={16} />
                                    </div>
                                    <div>
                                        <div className="text-xs font-medium text-gray-500 dark:text-gray-400 leading-none">{m.label}</div>
                                        <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 leading-none">{m.subtitle}</div>
                                    </div>
                                </div>
                                <div className="text-xl font-semibold text-gray-900 dark:text-white tabular-nums">
                                    {m.value}
                                </div>
                            </Link>
                        ))}
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Registered Entities */}
                    <div className="lg:col-span-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm p-8">
                        <div className="flex items-center justify-between mb-6">
                            <div>
                                <h2 className="text-base font-semibold text-gray-900 dark:text-white">Registered Companies</h2>
                                <p className="text-xs text-gray-400 dark:text-gray-500">Latest platform registrations</p>
                            </div>
                            <Link href="/admin/employers" className="px-3 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 transition-colors">
                                View All
                            </Link>
                        </div>

                        {stats?.recent_companies && stats.recent_companies.length > 0 ? (
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                        <tr className="text-left border-b border-gray-100 dark:border-gray-800">
                                            <th className="pb-3 text-xs font-medium text-gray-500 dark:text-gray-400">Company</th>
                                            <th className="pb-3 text-xs font-medium text-gray-500 dark:text-gray-400">BRN</th>
                                            <th className="pb-3 text-xs font-medium text-gray-500 dark:text-gray-400">Email</th>
                                            <th className="pb-3 text-xs font-medium text-gray-500 dark:text-gray-400 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                                        {stats.recent_companies.map((company) => (
                                            <tr key={company.company_id} className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                                                <td className="py-3">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-600 dark:text-gray-400 text-xs font-semibold">
                                                            {company.company_name?.[0]?.toUpperCase() || 'C'}
                                                        </div>
                                                        <span className="text-sm font-medium text-gray-900 dark:text-white">{company.company_name}</span>
                                                    </div>
                                                </td>
                                                <td className="py-3">
                                                    <span className="text-xs text-gray-500 dark:text-gray-400">{company.brn}</span>
                                                </td>
                                                <td className="py-3">
                                                    <span className="text-xs text-gray-500 dark:text-gray-400">{company.email}</span>
                                                </td>
                                                <td className="py-3 text-right">
                                                    <Link
                                                        href={`/admin/employers/${company.company_id}`}
                                                        className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
                                                    >
                                                        Details <ExternalLink size={12} />
                                                    </Link>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div className="text-center py-12 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-dashed border-gray-200 dark:border-gray-800">
                                <Building2 className="w-8 h-8 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
                                <p className="text-sm font-semibold text-gray-500 dark:text-gray-400">Registry empty</p>
                            </div>
                        )}
                    </div>

                    {/* Quick Management */}
                    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm p-8">
                        <div className="mb-6">
                            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Management</h2>
                            <p className="text-xs text-gray-400 dark:text-gray-500">Quick navigation</p>
                        </div>

                        <div className="space-y-1">
                            {[
                                { href: "/admin/users", icon: Users, label: "Users", desc: "Manage accounts" },
                                { href: "/admin/roles", icon: Shield, label: "Roles & Permissions", desc: "Access control" },
                                { href: "/admin/employers", icon: Building2, label: "Companies", desc: "All registered companies" },
                                { href: "/admin/logs", icon: Activity, label: "Audit Logs", desc: "System activity" },
                                { href: "/admin/platform-settings", icon: Settings2, label: "Settings", desc: "Global configuration" }
                            ].map((action, i) => (
                                <Link
                                    key={i}
                                    href={action.href}
                                    className="flex items-center gap-3 p-3 rounded-lg border border-transparent hover:border-gray-200 dark:hover:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group"
                                >
                                    <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500 dark:text-gray-400 group-hover:text-gray-700 dark:group-hover:text-gray-200 transition-colors">
                                        <action.icon size={15} />
                                    </div>
                                    <div className="flex-1">
                                        <p className="text-sm font-medium text-gray-900 dark:text-white leading-none mb-0.5">{action.label}</p>
                                        <p className="text-xs text-gray-400 dark:text-gray-500">{action.desc}</p>
                                    </div>
                                    <ExternalLink className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600 group-hover:text-gray-500 dark:group-hover:text-gray-400 transition-colors" />
                                </Link>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Platform Activity Feed */}
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm p-8">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Platform Activity</h2>
                            <p className="text-xs text-gray-400 dark:text-gray-500">Recent system events</p>
                        </div>
                        <Link href="/admin/logs" className="px-3 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 transition-colors">
                            View Logs
                        </Link>
                    </div>

                    {stats?.recent_activity && stats.recent_activity.length > 0 ? (
                        <div className="space-y-1">
                            {stats.recent_activity.slice(0, 6).map((activity) => (
                                <div key={activity.id} className="flex items-center gap-3 p-3 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors">
                                    <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-400 dark:text-gray-500 shrink-0">
                                        <Activity size={14} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-0.5">
                                            <span className="text-sm font-medium text-gray-900 dark:text-white">{activity.action}</span>
                                            {activity.resource_type && (
                                                <span className="text-xs text-gray-400 dark:text-gray-500">· {activity.resource_type}</span>
                                            )}
                                        </div>
                                        {activity.details && (
                                            <p className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-2xl">{activity.details}</p>
                                        )}
                                    </div>
                                    <div className="text-right shrink-0">
                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                            {activity.created_at ? new Date(activity.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-12 bg-gray-50 dark:bg-gray-800/60 rounded-xl border border-dashed border-gray-200 dark:border-gray-800">
                            <Activity className="w-8 h-8 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
                            <p className="text-sm font-semibold text-gray-500 dark:text-gray-400">No activity detected</p>
                        </div>
                    )}
                </div>
            </div>
        </SolarisBackground>
    );
}
