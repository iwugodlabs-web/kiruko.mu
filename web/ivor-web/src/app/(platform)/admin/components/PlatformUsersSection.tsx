"use client";
import React, { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  Users,
  Search,
  Crown,
  Shield,
  UserCheck,
  UserX,
  Calendar,
  MoreVertical,
  Edit,
  Trash2,
  Plus,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Clock,
  TrendingUp,
  Mail,
  Send,
  XCircle,
  LayoutList
} from "lucide-react";
import { api } from "@/services/apiClient";
import DashboardHeader from "@/components/ui/DashboardHeader";
import SectionHeader from "@/components/ui/SectionHeader";
import MetricCard from "@/components/ui/MetricCard";
import FilterSelect from "@/components/ui/FilterSelect";
import InviteAdminModal, { InviteData } from "./InviteAdminModal";
import { toast } from "sonner";

interface PlatformUser {
  user_id: number;
  email: string;
  roles: string[];
  is_active: boolean;
  created_at: string;
  last_login?: string;
  company?: {
    company_name: string;
    brn: string;
  };
}

interface PlatformInvite {
  invite_id: number;
  email: string;
  role: string;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  invited_by: number;
  created_at: string;
  expires_at: string;
  accepted_at?: string;
}

import SolarisBackground from "@/components/ui/SolarisBackground";

export default function PlatformUsersSection() {
  const [activeTab, setActiveTab] = useState<'users' | 'invites'>('users');
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [invites, setInvites] = useState<PlatformInvite[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'platform_admin' | 'company_admin'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  useEffect(() => {
    if (activeTab === 'users') {
      loadUsers();
    } else {
      loadInvites();
    }
  }, [activeTab]);

  const loadUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await api.get('/admin/platform-users');
      setUsers(resp.data?.data || resp.data || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load platform users');
      console.error('Error loading platform users:', e);
    } finally {
      setLoading(false);
    }
  };

  const loadInvites = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await api.get('/admin/platform-invites');
      setInvites(resp.data?.data || resp.data || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load invites');
    } finally {
      setLoading(false);
    }
  };

  const handleInviteAdmin = async (data: InviteData) => {
    try {
      await api.post('/admin/invite-platform-user', data);
      toast.success(`Invitation sent to ${data.email}`);
      if (activeTab === 'invites') {
        loadInvites();
      }
    } catch (e: any) {
      throw new Error(e.response?.data?.detail || e.message || 'Failed to send invitation');
    }
  };

  const handleResendInvite = async (inviteId: number) => {
    setActionLoading(inviteId);
    try {
      await api.post(`/admin/invites/${inviteId}/resend`);
      toast.success("Invitation resent successfully");
      loadInvites();
    } catch (e: any) {
      toast.error(e.response?.data?.detail || "Failed to resend invite");
    } finally {
      setActionLoading(null);
    }
  };

  const handleRevokeInvite = async (inviteId: number) => {
    if (!confirm("Are you sure you want to revoke this invitation?")) return;
    setActionLoading(inviteId);
    try {
      await api.delete(`/admin/invites/${inviteId}`);
      toast.success("Invitation revoked");
      loadInvites();
    } catch (e: any) {
      toast.error(e.response?.data?.detail || "Failed to revoke invite");
    } finally {
      setActionLoading(null);
    }
  };

  const filteredUsers = users.filter(user => {
    const matchesSearch =
      user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.company?.company_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.roles.some(role => role.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesRole = roleFilter === 'all' || user.roles.includes(roleFilter);
    const matchesStatus = statusFilter === 'all' ||
      (statusFilter === 'active' && user.is_active) ||
      (statusFilter === 'inactive' && !user.is_active);

    return matchesSearch && matchesRole && matchesStatus;
  });

  const stats = {
    total: users.length,
    active: users.filter(u => u.is_active).length,
    inactive: users.filter(u => !u.is_active).length,
    admins: users.filter(u => u.roles.includes('platform_admin')).length
  };

  const getRoleIcon = (roles: string[]) => {
    if (roles.includes('platform_admin')) return Crown;
    if (roles.includes('company_admin')) return Shield;
    return UserCheck;
  };

  const getInviteStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'text-amber-600 bg-amber-500/10';
      case 'accepted': return 'text-green-600 bg-green-500/10';
      case 'expired': return 'text-red-600 bg-red-500/10';
      case 'revoked': return 'text-gray-600 bg-gray-500/10';
      default: return 'text-gray-400 bg-gray-900/[0.03]';
    }
  };

  const { user } = useAuth();

  return (
    <SolarisBackground>
      <div className="w-full space-y-8 py-10 px-6 animate-in fade-in duration-700">
        <DashboardHeader
          title="Platform Users"
          subtitle={`Manage users & access • ${user?.email || 'Admin'}`}
          extra={(
            <div className="flex flex-col xl:flex-row items-center gap-3 w-full xl:w-auto">
              <div className="relative flex-1 group min-w-[280px] w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                <input
                  type="text"
                  placeholder={activeTab === 'users' ? "Search users..." : "Search invitations..."}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-900/5 dark:focus:ring-white/10 focus:border-gray-300 dark:focus:border-gray-600 transition-colors"
                />
              </div>
              <button
                onClick={() => setShowInviteModal(true)}
                className="w-full xl:w-auto px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors flex items-center justify-center gap-2"
              >
                <Plus size={14} />
                Invite User
              </button>
            </div>
          )}
        >
          <div className="flex items-center gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg w-fit">
            <button
              onClick={() => setActiveTab('users')}
              className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-md transition-all ${
                activeTab === 'users'
                  ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm"
                  : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              <Users size={12} />
              Users
            </button>
            <button
              onClick={() => setActiveTab('invites')}
              className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-md transition-all ${
                activeTab === 'invites'
                  ? "bg-white dark:bg-gray-900 text-gray-900 dark:text-white shadow-sm"
                  : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              <Mail size={12} />
              Invitations
            </button>
          </div>
        </DashboardHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 animate-in fade-in slide-in-from-bottom-8 duration-1000 ease-out">
          <MetricCard title="Total Users" value={stats.total.toString()} icon={Users} color="blue" />
          <MetricCard title="Active" value={stats.active.toString()} icon={CheckCircle} color="green" />
          <MetricCard title="Inactive" value={stats.inactive.toString()} icon={UserX} color="red" />
          <MetricCard title="Admins" value={stats.admins.toString()} icon={Crown} color="amber" />
        </div>

        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4 px-5 py-4 border-b border-gray-100 dark:border-gray-800">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center">
                {activeTab === 'users' ? <Users size={14} className="text-gray-600 dark:text-gray-400" /> : <Mail size={14} className="text-gray-600 dark:text-gray-400" />}
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                  {activeTab === 'users' ? 'Users' : 'Invitations'}
                </h2>
                <p className="text-xs text-gray-400">
                  {activeTab === 'users' ? `${filteredUsers.length} users` : `${invites.length} invitations`}
                </p>
              </div>
            </div>

            {activeTab === 'users' && (
              <div className="flex items-center gap-3">
                <FilterSelect
                  label="Role"
                  value={roleFilter}
                  onChange={setRoleFilter}
                  options={[
                    { value: 'all', label: 'All roles' },
                    { value: 'platform_admin', label: 'Platform Admin' },
                    { value: 'company_admin', label: 'Company Admin' },
                  ]}
                />
                <FilterSelect
                  label="Status"
                  value={statusFilter}
                  onChange={setStatusFilter}
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'active', label: 'Active' },
                    { value: 'inactive', label: 'Inactive' },
                  ]}
                />
              </div>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-800 rounded-full animate-spin" />
            </div>
          ) : activeTab === 'users' ? (
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredUsers.length === 0 && (
                <div className="col-span-full py-16 text-center bg-white rounded-xl border border-gray-200 border-dashed">
                  <div className="w-9 h-9 bg-gray-100 rounded-lg flex items-center justify-center mx-auto mb-3">
                    <Users className="w-4 h-4 text-gray-400" />
                  </div>
                  <p className="text-sm font-medium text-gray-900 mb-1">No users found</p>
                  <p className="text-xs text-gray-500">Try adjusting your search or filters</p>
                </div>
              )}
              {filteredUsers.map((u) => {
                const RoleIcon = getRoleIcon(u.roles);
                return (
                  <div key={u.user_id} className="group bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5 hover:border-gray-300 dark:hover:border-gray-700 transition-colors">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center text-gray-500 dark:text-gray-400">
                          <RoleIcon size={15} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{u.email.split('@')[0]}</p>
                          <p className="text-xs text-gray-400 truncate">{u.email}</p>
                        </div>
                      </div>
                      <button className="p-1.5 text-gray-300 hover:text-gray-600 transition-colors opacity-0 group-hover:opacity-100">
                        <MoreVertical size={14} />
                      </button>
                    </div>

                    {u.company?.company_name && (
                      <div className="mb-3 px-3 py-2 bg-gray-50 dark:bg-gray-800 rounded-lg">
                        <p className="text-[10px] font-medium text-gray-400 mb-0.5">Company</p>
                        <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{u.company.company_name}</p>
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-gray-800">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border ${
                        u.is_active
                          ? 'bg-green-50 text-green-700 border-green-100'
                          : 'bg-gray-50 text-gray-500 border-gray-100'
                      }`}>
                        <span className={`w-1 h-1 rounded-full ${u.is_active ? 'bg-green-500' : 'bg-gray-400'}`} />
                        {u.is_active ? 'Active' : 'Inactive'}
                      </span>
                      <span className="text-xs text-gray-400">{new Date(u.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="divide-y divide-gray-50 dark:divide-gray-800">
              {invites.map((inv) => (
                <div key={inv.invite_id} className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 px-5 py-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center text-gray-500 dark:text-gray-400 shrink-0">
                      <Mail size={14} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{inv.email}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`px-2 py-0.5 rounded-md text-xs font-medium border border-gray-200/50 ${getInviteStatusColor(inv.status)}`}>
                          {inv.status}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-gray-400">
                          <Clock size={11} />
                          Expires {new Date(inv.expires_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {inv.status !== 'accepted' && (
                      <>
                        <button
                          onClick={() => handleResendInvite(inv.invite_id)}
                          disabled={actionLoading === inv.invite_id}
                          className="px-3 py-1.5 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-700 transition-colors disabled:opacity-50"
                        >
                          {actionLoading === inv.invite_id ? 'Sending...' : 'Resend'}
                        </button>
                        <button
                          onClick={() => handleRevokeInvite(inv.invite_id)}
                          disabled={actionLoading === inv.invite_id}
                          className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-medium rounded-lg border border-red-100 transition-colors disabled:opacity-50"
                        >
                          Revoke
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
              {invites.length === 0 && (
                <div className="py-16 text-center bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 border-dashed">
                  <div className="w-9 h-9 bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center mx-auto mb-3">
                    <Mail className="w-4 h-4 text-gray-400" />
                  </div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">No invitations</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Sent invitations will appear here</p>
                </div>
              )}
            </div>
          )}
        </div>

        <InviteAdminModal
          isOpen={showInviteModal}
          onClose={() => setShowInviteModal(false)}
          onInvite={handleInviteAdmin}
        />
      </div>
    </SolarisBackground>
  );
}
