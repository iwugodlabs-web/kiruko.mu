"use client";
import React, { useState } from "react";
import { Mail, ChevronDown } from "lucide-react";
import Modal from "@/components/Modal";

type InviteUserModalProps = {
    isOpen: boolean;
    onClose: () => void;
    onInvite?: (email: string, role: string) => void;
};

export default function InviteUserModal({ isOpen, onClose, onInvite }: InviteUserModalProps) {
    const [email, setEmail] = useState("");
    const [role, setRole] = useState("employee");
    const [loading, setLoading] = useState(false);

    const handleInvite = async () => {
        if (!email) return;
        setLoading(true);
        try {
            if (onInvite) {
                await onInvite(email, role);
            } else {
                await new Promise(resolve => setTimeout(resolve, 1000));
                onClose();
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Invite Member"
            size="sm"
        >
            <div className="p-6 space-y-5">
                <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Email Address</label>
                    <div className="relative group">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-gray-600 transition-colors" size={16} />
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="colleague@company.com"
                            className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-gray-400 transition-colors placeholder:text-gray-300"
                            autoFocus
                        />
                    </div>
                </div>

                <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1.5">Role</label>
                    <div className="relative group">
                        <select
                            value={role}
                            onChange={(e) => setRole(e.target.value)}
                            className="w-full pl-3 pr-9 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm focus:outline-none focus:border-gray-400 transition-colors appearance-none bg-white dark:bg-gray-800 text-gray-700 dark:text-white"
                        >
                            <option value="employee">Employee</option>
                            <option value="manager">Manager</option>
                            <option value="admin">Admin</option>
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 pointer-events-none" />
                    </div>
                    <p className="mt-2 text-xs text-gray-400 leading-relaxed">
                        {role === 'employee' && "Can view and manage their own tasks and records."}
                        {role === 'manager' && "Can manage team members and view department reports."}
                        {role === 'admin' && "Full access to all organization settings and data."}
                    </p>
                </div>
            </div>

            <div className="flex gap-3 px-6 pb-6">
                <button
                    onClick={onClose}
                    className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-900 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                    Cancel
                </button>
                <button
                    onClick={handleInvite}
                    disabled={!email || loading}
                    className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-gray-900 hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                    {loading ? (
                        <>
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Sending...
                        </>
                    ) : (
                        'Send Invite'
                    )}
                </button>
            </div>
        </Modal>
    );
}
