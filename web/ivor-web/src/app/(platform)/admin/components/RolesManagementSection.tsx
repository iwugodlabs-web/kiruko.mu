"use client";
import React, { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
    Shield,
    Search,
    Plus,
    Edit,
    Key,
    Trash2,
    RefreshCw,
    AlertTriangle,
    Crown,
    Lock,
    Users
} from "lucide-react";
import { api } from "@/services/apiClient";
import DashboardHeader from "@/components/ui/DashboardHeader";
import SectionHeader from "@/components/ui/SectionHeader";
import MetricCard from "@/components/ui/MetricCard";
import CreateEditRoleModal, { RoleData } from "./CreateEditRoleModal";
import EditPlatformPermissionsModal from "./EditPlatformPermissionsModal";
import SolarisBackground from "@/components/ui/SolarisBackground";

interface Role {
    role_id: number;
    name: string;
    description?: string;
    system: boolean;
    permissions?: string[];
    user_count: number;
    created_at: string;
}

export default function RolesManagementSection() {
    const [roles, setRoles] = useState<Role[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [showModal, setShowModal] = useState(false);
    const [editingRole, setEditingRole] = useState<Role | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<{ open: boolean; roleId: number | null; roleName: string }>({ open: false, roleId: null, roleName: '' });
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [editingPermissions, setEditingPermissions] = useState<Role | null>(null);

    useEffect(() => {
        loadRoles();
    }, []);

    const loadRoles = async () => {
        setLoading(true);
        setError(null);
        try {
            const resp = await api.get("/admin/roles");
            setRoles(resp.data?.data || resp.data || []);
        } catch (e: any) {
            setError(e.message || "Failed to load roles");
            console.error("Error loading roles:", e);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateRole = async (data: RoleData) => {
        try {
            await api.post("/admin/roles", data);
            await loadRoles();
        } catch (e: any) {
            throw new Error(e.response?.data?.detail || e.message || "Failed to create role");
        }
    };

    const handleUpdateRole = async (data: RoleData) => {
        try {
            await api.put(`/admin/roles/${data.role_id}`, {
                description: data.description,
            });
            await loadRoles();
        } catch (e: any) {
            throw new Error(e.response?.data?.detail || e.message || "Failed to update role");
        }
    };

    const handleDeleteRole = async (roleId: number, roleName: string) => {
        setConfirmDelete({ open: true, roleId, roleName });
    };

    const confirmDeleteRole = async () => {
        if (!confirmDelete.roleId) return;
        setIsDeleting(true);
        setDeleteError(null);
        try {
            await api.delete(`/admin/roles/${confirmDelete.roleId}`);
            setConfirmDelete({ open: false, roleId: null, roleName: '' });
            await loadRoles();
        } catch (e: any) {
            setDeleteError(e.response?.data?.detail || 'Failed to delete role');
        } finally {
            setIsDeleting(false);
        }
    };

    const handleSaveRole = async (data: RoleData) => {
        if (editingRole) {
            await handleUpdateRole(data);
        } else {
            await handleCreateRole(data);
        }
    };

    const filteredRoles = roles.filter((role) =>
        role.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        role.description?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const stats = {
        total: roles.length,
        system: roles.filter((r) => r.system).length,
        custom: roles.filter((r) => !r.system).length,
        totalUsers: roles.reduce((sum, r) => sum + r.user_count, 0),
    };

    const { user } = useAuth();

    return (
        <SolarisBackground>
            <div className="w-full space-y-8 py-10 px-6 animate-in fade-in duration-700">
                <DashboardHeader
                    title="Roles"
                    subtitle={`Manage permissions • ${user?.email || 'Admin'}`}
                    extra={
                        <div className="flex items-center gap-2">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                                <input
                                    type="text"
                                    placeholder="Search roles..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-9 pr-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-gray-400 transition-colors w-56"
                                />
                            </div>
                            <button
                                onClick={() => { setEditingRole(null); setShowModal(true); }}
                                className="flex items-center gap-2 px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white rounded-lg text-sm font-medium transition-colors"
                            >
                                <Plus size={14} />
                                New Role
                            </button>
                        </div>
                    }
                />

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 animate-in fade-in slide-in-from-bottom-6 duration-1000 ease-out">
                    <MetricCard title="Total Roles" value={stats.total.toString()} icon={Shield} color="blue" />
                    <MetricCard title="System Roles" value={stats.system.toString()} icon={Lock} color="red" />
                    <MetricCard title="Custom Roles" value={stats.custom.toString()} icon={Crown} color="amber" />
                    <MetricCard title="Assigned Users" value={stats.totalUsers.toString()} icon={Users} color="green" />
                </div>

                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300">
                    <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
                        <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center">
                                <Shield size={14} className="text-gray-600 dark:text-gray-400" />
                            </div>
                            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Permission Roles</h2>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="text-xs text-gray-400">{filteredRoles.length} roles</span>
                            <button onClick={loadRoles} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors">
                                <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
                            </button>
                        </div>
                    </div>

                    {loading ? (
                        <div className="flex items-center justify-center py-20">
                            <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-800 rounded-full animate-spin" />
                        </div>
                    ) : error ? (
                        <div className="py-12 text-center px-5">
                            <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-3" />
                            <p className="text-sm font-medium text-gray-700 mb-3">{error}</p>
                            <button onClick={loadRoles} className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors">Retry</button>
                        </div>
                    ) : filteredRoles.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16">
                            <Shield className="w-8 h-8 text-gray-200 mb-3" />
                            <p className="text-sm font-medium text-gray-500">No roles found</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
                            {filteredRoles.map((role) => (
                                <div key={role.role_id} className="group border border-gray-200 dark:border-gray-800 rounded-xl p-4 bg-white dark:bg-gray-900 hover:border-gray-300 dark:hover:border-gray-700 transition-colors">
                                    <div className="flex justify-between items-start mb-3">
                                        <div className="flex items-center gap-3">
                                            <div className="w-9 h-9 bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center text-gray-500 dark:text-gray-400">
                                                {role.system ? <Lock size={15} /> : <Shield size={15} />}
                                            </div>
                                            <div>
                                                <p className="text-sm font-semibold text-gray-900 dark:text-white">{role.name}</p>
                                                <span className="text-xs text-gray-400">{role.system ? 'System' : 'Custom'}</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={() => setEditingPermissions(role)}
                                                className="p-1.5 text-gray-400 hover:text-red-600 rounded-md hover:bg-red-50 transition-colors"
                                                title={role.system ? "View permissions (read-only)" : "Edit permissions"}
                                            >
                                                <Key size={13} />
                                            </button>
                                            <button onClick={() => { setEditingRole(role); setShowModal(true); }} disabled={role.system} className="p-1.5 text-gray-400 hover:text-gray-700 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-30" title="Edit name / description">
                                                <Edit size={13} />
                                            </button>
                                            <button onClick={() => handleDeleteRole(role.role_id, role.name)} disabled={role.system || role.user_count > 0} className="p-1.5 text-gray-400 hover:text-red-600 rounded-md hover:bg-red-50 transition-colors disabled:opacity-30">
                                                <Trash2 size={13} />
                                            </button>
                                        </div>
                                    </div>
                                    {role.description && (
                                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 leading-relaxed">{role.description}</p>
                                    )}
                                    <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-gray-800">
                                        <div className="flex items-center gap-3">
                                            <div className="flex items-center gap-1.5">
                                                <Users size={12} className="text-gray-400" />
                                                <span className="text-xs text-gray-500 dark:text-gray-400">{role.user_count} {role.user_count === 1 ? 'user' : 'users'}</span>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <Key size={12} className="text-gray-400" />
                                                <span className="text-xs text-gray-500 dark:text-gray-400">{(role.permissions ?? []).length} {(role.permissions ?? []).length === 1 ? 'permission' : 'permissions'}</span>
                                            </div>
                                        </div>
                                        <span className="text-xs text-gray-400">{new Date(role.created_at).toLocaleDateString()}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <CreateEditRoleModal
                    isOpen={showModal}
                    onClose={() => {
                        setShowModal(false);
                        setEditingRole(null);
                    }}
                    onSave={handleSaveRole}
                    editingRole={editingRole}
                />

                {editingPermissions && (
                    <EditPlatformPermissionsModal
                        role={editingPermissions}
                        onSaved={(roleId, perms) => {
                            // Optimistic local update so the count refreshes
                            // immediately; loadRoles() picks up server truth.
                            setRoles((prev) => prev.map((r) =>
                                r.role_id === roleId ? { ...r, permissions: perms } : r,
                            ));
                            loadRoles();
                        }}
                        onClose={() => setEditingPermissions(null)}
                    />
                )}

                {/* Confirm Delete Modal */}
                {confirmDelete.open && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <div onClick={() => setConfirmDelete({ open: false, roleId: null, roleName: '' })} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
                        <div className="relative w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-xl p-6 animate-in zoom-in-95 fade-in duration-200">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-9 h-9 bg-red-50 rounded-lg flex items-center justify-center shrink-0">
                                    <Trash2 size={16} className="text-red-600" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Delete role</h3>
                                    <p className="text-xs text-gray-500 mt-0.5">This action cannot be undone.</p>
                                </div>
                            </div>
                            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                                Are you sure you want to delete <span className="font-semibold text-gray-900 dark:text-white">&quot;{confirmDelete.roleName}&quot;</span>?
                            </p>
                            {deleteError && (
                                <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-4">{deleteError}</p>
                            )}
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => { setConfirmDelete({ open: false, roleId: null, roleName: '' }); setDeleteError(null); }}
                                    className="flex-1 py-2.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={confirmDeleteRole}
                                    disabled={isDeleting}
                                    className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                                >
                                    {isDeleting ? 'Deleting...' : 'Delete'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </SolarisBackground>
    );
}
