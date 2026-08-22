"use client";
import React, { useState } from "react";
import { X, AlertCircle, CheckCircle } from "lucide-react";

interface CreateEditRoleModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: RoleData) => Promise<void>;
    editingRole?: RoleData | null;
}

export interface RoleData {
    role_id?: number;
    name: string;
    description?: string;
}

export default function CreateEditRoleModal({ isOpen, onClose, editingRole, onSave }: CreateEditRoleModalProps) {
    const [name, setName] = useState(editingRole?.name || "");
    const [description, setDescription] = useState(editingRole?.description || "");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    React.useEffect(() => {
        if (editingRole) {
            setName(editingRole.name);
            setDescription(editingRole.description || "");
        } else {
            setName("");
            setDescription("");
        }
    }, [editingRole]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(false);

        if (!name.trim()) {
            setError("Role name is required");
            return;
        }

        setLoading(true);
        try {
            await onSave({
                role_id: editingRole?.role_id,
                name: name.trim(),
                description: description.trim() || undefined,
            });
            setSuccess(true);
            setTimeout(() => {
                handleClose();
            }, 1000);
        } catch (err: any) {
            setError(err.message || "Failed to save role");
        } finally {
            setLoading(false);
        }
    };

    const handleClose = () => {
        setName("");
        setDescription("");
        setError(null);
        setSuccess(false);
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl max-w-md w-full p-8 animate-in zoom-in-95 duration-300 border border-slate-200 dark:border-gray-800">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white uppercase tracking-tight leading-none">
                            {editingRole ? "Reconfigure Role" : "Deploy Role"}
                        </h2>
                        <p className="text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest mt-2">
                            {editingRole ? "Modify internal permission node" : "Add a custom platform authority link"}
                        </p>
                    </div>
                    <button
                        onClick={handleClose}
                        className="w-10 h-10 rounded-xl hover:bg-slate-100 dark:hover:bg-gray-800 flex items-center justify-center transition-all group"
                    >
                        <X size={18} className="text-slate-400 dark:text-gray-500 group-hover:text-slate-900 dark:group-hover:text-white" />
                    </button>
                </div>

                {/* Status Messages */}
                {success && (
                    <div className="mb-6 p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900/50 rounded-2xl flex items-center gap-3">
                        <CheckCircle size={18} className="text-emerald-600 dark:text-emerald-400" />
                        <p className="text-[10px] font-black text-emerald-800 dark:text-emerald-300 uppercase tracking-widest">
                            Node {editingRole ? "synchronized" : "deployed"} successfully
                        </p>
                    </div>
                )}

                {error && (
                    <div className="mb-6 p-4 bg-red-50 dark:bg-red-950/40 border border-red-100 dark:border-red-900/50 rounded-2xl flex items-center gap-3">
                        <AlertCircle size={18} className="text-red-600 dark:text-red-400" />
                        <p className="text-[10px] font-black text-red-800 dark:text-red-300 uppercase tracking-widest">
                            {error}
                        </p>
                    </div>
                )}

                {/* Form */}
                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <label className="block text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest mb-2">
                            Role Descriptor <span className="text-red-500 font-black">*</span>
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g., support_admin"
                            required
                            disabled={!!editingRole}
                            className="w-full px-5 py-3 rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-800 text-sm font-bold text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-600/5 focus:border-red-600/20 transition-all disabled:opacity-50"
                        />
                        {editingRole && (
                            <p className="text-[9px] font-black text-slate-300 dark:text-gray-600 uppercase tracking-widest mt-2 leading-none">Descriptor locking engaged after initialization</p>
                        )}
                    </div>

                    <div>
                        <label className="block text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest mb-2">Operational Scope</label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Define the functional scope of this node..."
                            rows={3}
                            className="w-full px-5 py-3 rounded-xl border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-bold text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-600/5 focus:border-red-600/20 transition-all resize-none"
                        />
                    </div>

                    <div className="flex gap-3 pt-6 border-t border-slate-100 dark:border-gray-800">
                        <button
                            type="button"
                            onClick={handleClose}
                            className="flex-1 px-6 py-3 rounded-xl border border-slate-200 dark:border-gray-700 font-black text-[10px] uppercase tracking-widest text-slate-400 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-gray-800 transition-all"
                        >
                            Abort
                        </button>
                        <button
                            type="submit"
                            disabled={loading || success}
                            className="flex-1 px-6 py-3 rounded-xl bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 font-black text-[10px] uppercase tracking-widest hover:bg-black dark:hover:bg-gray-200 transition-all disabled:opacity-50"
                        >
                            {loading ? "Transmitting..." : editingRole ? "Sync Node" : "Confirm Deployment"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
