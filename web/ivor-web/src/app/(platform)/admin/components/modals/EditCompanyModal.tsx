import { useState, useEffect } from "react";
import { Company, updateCompany } from "@/services/api";
import { X, Save, Building2, User, Mail, MapPin, Phone, FileText, AlertTriangle, Loader2 } from "lucide-react";

interface EditCompanyModalProps {
    company: Company;
    onClose: () => void;
    onSaved: (company: Company) => void;
}

export default function EditCompanyModal({ company, onClose, onSaved }: EditCompanyModalProps) {
    const [form, setForm] = useState<Partial<Company>>({});
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setForm({ ...company });
    }, [company]);

    const submit = async () => {
        setBusy(true);
        setError(null);
        try {
            const res = await updateCompany(company.company_id, form);
            if ((res as any)?.error) {
                setError((res as any).error);
            } else {
                onSaved(res as Company);
                onClose();
            }
        } catch (e: any) {
            setError(e.message || String(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-white dark:bg-gray-900 rounded-[2.5rem] shadow-2xl max-w-xl w-full overflow-hidden animate-in zoom-in-95 duration-300 border border-slate-200 dark:border-gray-800 flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="px-10 py-8 border-b border-slate-100 dark:border-gray-800 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 bg-slate-900 dark:bg-gray-100 rounded-xl flex items-center justify-center text-white dark:text-gray-900 shadow-sm">
                            <Building2 className="w-6 h-6" strokeWidth={1.5} />
                        </div>
                        <div>
                            <h3 className="font-display text-xl font-bold text-slate-900 dark:text-white uppercase tracking-tight leading-none">Reconfigure Entity</h3>
                            <p className="text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest mt-1.5">Modify operational parameters for {company.company_name}</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-10 h-10 rounded-xl hover:bg-slate-50 dark:hover:bg-gray-800 flex items-center justify-center transition-all group"
                    >
                        <X size={18} className="text-slate-400 dark:text-gray-500 group-hover:text-slate-900 dark:group-hover:text-white" />
                    </button>
                </div>

                {/* Form Content */}
                <div className="p-10 overflow-y-auto custom-scrollbar">
                    {error && (
                        <div className="mb-8 p-4 bg-red-50 dark:bg-red-950/40 border border-red-100 dark:border-red-900/50 rounded-2xl flex items-start gap-3">
                            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                            <p className="text-[10px] font-black text-red-800 dark:text-red-300 uppercase tracking-widest leading-relaxed">{error}</p>
                        </div>
                    )}

                    <div className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest ml-1">Entity Name</label>
                                <div className="relative group">
                                    <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-red-600 transition-colors" />
                                    <input
                                        placeholder="Enter company name"
                                        value={form.company_name}
                                        onChange={(e) => setForm({ ...form, company_name: e.target.value })}
                                        className="w-full pl-12 pr-5 py-3.5 bg-slate-50 dark:bg-gray-800 border border-slate-100 dark:border-gray-700 rounded-2xl text-sm font-bold text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-600/5 focus:border-red-600/20 transition-all uppercase tracking-tight"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest ml-1">Registry Identifier (BRN)</label>
                                <div className="relative group">
                                    <FileText className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                    <input
                                        placeholder="Business Registration No."
                                        value={form.brn}
                                        readOnly
                                        disabled
                                        className="w-full pl-12 pr-5 py-3.5 bg-slate-50 border border-slate-100 rounded-2xl text-sm font-bold text-slate-400 focus:outline-none transition-all cursor-not-allowed opacity-60 font-mono"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest ml-1">Core Communication Link</label>
                            <div className="relative group">
                                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-red-600 transition-colors" />
                                <input
                                    placeholder="contact@company.com"
                                    value={form.email || ""}
                                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                                    className="w-full pl-12 pr-5 py-3.5 bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-2xl text-sm font-bold text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-red-600/5 focus:border-red-600/20 transition-all shadow-sm"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest ml-1">Geolocation coordinates</label>
                            <div className="relative group">
                                <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-red-600 transition-colors" />
                                <input
                                    placeholder="Full physical business address"
                                    value={form.address || ""}
                                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                                    className="w-full pl-12 pr-5 py-3.5 bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-2xl text-sm font-bold text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-red-600/5 focus:border-red-600/20 transition-all shadow-sm font-mono text-xs"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest ml-1">Voice Protocol (Phone)</label>
                            <div className="relative group">
                                <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-red-600 transition-colors" />
                                <input
                                    placeholder="+230 1234 5678"
                                    value={form.phone || ""}
                                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                                    className="w-full pl-12 pr-5 py-3.5 bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-2xl text-sm font-bold text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-red-600/5 focus:border-red-600/20 transition-all shadow-sm"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-10 py-8 border-t border-slate-100 dark:border-gray-800 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-8 py-3 rounded-2xl border border-slate-200 dark:border-gray-700 font-black text-[10px] uppercase tracking-widest text-slate-400 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-gray-800 transition-all"
                    >
                        Abort
                    </button>
                    <button
                        onClick={submit}
                        disabled={busy}
                        className="px-10 py-3 rounded-2xl bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 font-black text-[10px] uppercase tracking-widest hover:bg-black dark:hover:bg-gray-200 transition-all flex items-center gap-2"
                    >
                        {busy ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Transmitting...
                            </>
                        ) : (
                            <>
                                <Save className="w-4 h-4" />
                                Update Registry
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
