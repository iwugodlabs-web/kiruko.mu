"use client";
import React, { useState, useEffect } from "react";
import { Mail, Crown, Shield, AlertCircle, CheckCircle } from "lucide-react";
import { api } from "@/services/apiClient";
import Modal from "@/components/Modal";

interface InviteAdminModalProps {
    isOpen: boolean;
    onClose: () => void;
    onInvite: (data: InviteData) => Promise<void>;
}

export interface InviteData {
    email: string;
    role: string;
    first_name?: string;
    last_name?: string;
}

interface Role {
    role_id: number;
    name: string;
    description?: string;
    system: boolean;
}

export default function InviteAdminModal({ isOpen, onClose, onInvite }: InviteAdminModalProps) {
    const [email, setEmail] = useState("");
    const [role, setRole] = useState("");
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [availableRoles, setAvailableRoles] = useState<Role[]>([]);
    const [loadingRoles, setLoadingRoles] = useState(false);

    useEffect(() => {
        if (isOpen) {
            fetchRoles();
        }
    }, [isOpen]);

    useEffect(() => {
        if (availableRoles.length > 0 && !role) {
            setRole(availableRoles[0].name);
        }
    }, [availableRoles]);

    const fetchRoles = async () => {
        setLoadingRoles(true);
        setError(null);
        try {
            const resp = await api.get("/admin/roles");
            const roles = resp.data?.data || [];
            const filteredRoles = roles.filter((r: Role) => r.name !== "platform_admin");
            setAvailableRoles(filteredRoles);
            if (filteredRoles.length === 0) {
                // Either roles aren't seeded, the API returned an empty list,
                // or every returned role is `platform_admin` (filtered out).
                // Surface this so the admin doesn't try to submit a blank role.
                setError("No assignable roles found. Seed roles in /admin/roles first.");
            }
        } catch (e: unknown) {
            const err = e as { response?: { status?: number; data?: { detail?: unknown } }; message?: string };
            const status = err?.response?.status;
            const detail = err?.response?.data?.detail;
            const msg = typeof detail === "string"
                ? detail
                : (status === 403 ? "You don't have permission to load roles." : (err?.message || "Failed to load roles."));
            console.error("Error fetching roles:", e);
            setError(msg);
        } finally {
            setLoadingRoles(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(false);

        if (!email || !email.includes("@")) {
            setError("Please enter a valid email address");
            return;
        }

        if (!role) {
            setError("Please select an authority level.");
            return;
        }

        setLoading(true);
        try {
            await onInvite({
                email,
                role,
                first_name: firstName || undefined,
                last_name: lastName || undefined,
            });
            setSuccess(true);
            setTimeout(() => {
                handleClose();
            }, 1500);
        } catch (err: any) {
            setError(err.message || "Failed to send invitation");
        } finally {
            setLoading(false);
        }
    };

    const handleClose = () => {
        setEmail("");
        setRole(availableRoles.length > 0 ? availableRoles[0].name : "");
        setFirstName("");
        setLastName("");
        setError(null);
        setSuccess(false);
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={handleClose} size="lg">
            <div className="p-8">
                {/* Header */}
                <div className="flex items-center gap-4 mb-8">
                    <div className="w-14 h-14 bg-slate-900 dark:bg-gray-100 rounded-xl flex items-center justify-center shadow-sm">
                        <Crown size={24} className="text-white dark:text-gray-900" strokeWidth={1.5} />
                    </div>
                    <div>
                        <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white uppercase tracking-tight leading-none">Invite Administrator</h2>
                        <p className="text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest mt-1.5">Dispatch platform access protocol</p>
                    </div>
                </div>

                {/* Status messages */}
                {success && (
                    <div className="mb-8 p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900/50 rounded-2xl flex items-center gap-3">
                        <CheckCircle size={18} className="text-emerald-600 dark:text-emerald-400" />
                        <p className="text-[10px] font-black text-emerald-800 dark:text-emerald-300 uppercase tracking-widest">
                            Invitation dispatched. Node authorization pending acceptance.
                        </p>
                    </div>
                )}

                {error && (
                    <div className="mb-8 p-4 bg-red-50 dark:bg-red-950/40 border border-red-100 dark:border-red-900/50 rounded-2xl flex items-center gap-3">
                        <AlertCircle size={18} className="text-red-600 dark:text-red-400" />
                        <p className="text-[10px] font-black text-red-800 dark:text-red-300 uppercase tracking-widest">{error}</p>
                    </div>
                )}

                {/* Form */}
                <form onSubmit={handleSubmit} className="space-y-6">
                    {/* Email */}
                    <div>
                        <label className="block text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest mb-2.5">
                            Target Email <span className="text-red-500 font-black">*</span>
                        </label>
                        <div className="relative group">
                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500 group-focus-within:text-slate-900 dark:group-focus-within:text-white transition-colors" size={16} strokeWidth={2} />
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="administrator@kontokaz.protocol"
                                required
                                className="w-full pl-12 pr-5 py-3.5 rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-800 text-sm font-bold text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-600/5 focus:border-red-600/20 transition-all font-mono"
                            />
                        </div>
                    </div>

                    {/* Role Selection */}
                    <div>
                        <label className="block text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest mb-3">
                            Authority Level <span className="text-red-500 font-black">*</span>
                        </label>
                        {loadingRoles ? (
                            <div className="p-8 text-center text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest bg-slate-50 dark:bg-gray-800 rounded-2xl border border-slate-100 dark:border-gray-700">Synchronizing schemas...</div>
                        ) : availableRoles.length === 0 ? (
                            <div className="p-6 text-center bg-slate-50 dark:bg-gray-800 rounded-2xl border border-dashed border-slate-200 dark:border-gray-700">
                                <Shield size={20} className="text-slate-300 dark:text-gray-600 mx-auto mb-2" strokeWidth={1.5} />
                                <p className="text-[10px] font-black text-slate-500 dark:text-gray-400 uppercase tracking-widest">No assignable roles</p>
                                <p className="text-xs text-slate-500 dark:text-gray-400 mt-2">Seed platform roles at <span className="font-mono text-slate-700 dark:text-gray-200">/admin/roles</span> before inviting.</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {availableRoles.map((r) => (
                                    <button
                                        key={r.role_id}
                                        type="button"
                                        onClick={() => setRole(r.name)}
                                        className={`p-4 rounded-xl border-2 transition-all text-left relative overflow-hidden group ${role === r.name
                                            ? "border-blue-600 bg-blue-50/30 dark:bg-blue-950/30"
                                            : "border-slate-100 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-slate-200 dark:hover:border-gray-600"
                                            }`}
                                    >
                                        <div className="flex items-start gap-3 relative z-10">
                                            <div className={`p-2 rounded-lg transition-colors ${role === r.name ? 'bg-red-600 text-white' : 'bg-slate-50 dark:bg-gray-900 text-slate-400 dark:text-gray-500'}`}>
                                                {r.system ? <Shield size={16} strokeWidth={2} /> : <Crown size={16} strokeWidth={2} />}
                                            </div>
                                            <div className="flex-1">
                                                <p className={`font-bold text-xs uppercase tracking-tight ${role === r.name ? 'text-red-900 dark:text-red-200' : 'text-slate-900 dark:text-white'}`}>{r.name}</p>
                                                {r.description && <p className="text-[9px] font-bold text-slate-400 dark:text-gray-500 mt-1 leading-tight uppercase tracking-tight">{r.description}</p>}
                                            </div>
                                        </div>
                                        {role === r.name && (
                                            <div className="absolute top-0 right-0 w-8 h-8 bg-red-600/10 rounded-bl-3xl flex items-center justify-center">
                                                <CheckCircle size={10} className="text-red-600" />
                                            </div>
                                        )}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Optional Fields */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest mb-2">First Name</label>
                            <input
                                type="text"
                                value={firstName}
                                onChange={(e) => setFirstName(e.target.value)}
                                placeholder="Primary"
                                className="w-full px-5 py-3 rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-bold text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-600/5 transition-all"
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest mb-2">Last Name</label>
                            <input
                                type="text"
                                value={lastName}
                                onChange={(e) => setLastName(e.target.value)}
                                placeholder="Descriptor"
                                className="w-full px-5 py-3 rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-bold text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-600/5 transition-all"
                            />
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3 pt-6 border-t border-slate-100 dark:border-gray-800">
                        <button
                            type="button"
                            onClick={handleClose}
                            className="flex-1 px-6 py-3.5 rounded-xl border border-slate-200 dark:border-gray-700 font-black text-[10px] uppercase tracking-widest text-slate-400 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-gray-800 transition-all"
                        >
                            Abort
                        </button>
                        <button
                            type="submit"
                            disabled={loading || success || !role || availableRoles.length === 0}
                            className="flex-1 px-6 py-3.5 rounded-xl bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 font-black text-[10px] uppercase tracking-widest hover:bg-black dark:hover:bg-gray-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loading ? "Transmitting..." : "Send Protocol Link"}
                        </button>
                    </div>
                </form>
            </div>
        </Modal>
    );
}
