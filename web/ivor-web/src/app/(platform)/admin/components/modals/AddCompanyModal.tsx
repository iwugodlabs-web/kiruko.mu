"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { CompanyPayload, createCompany } from "../../../../../services/api";
import { ALL_COUNTRIES, useCountry } from "@/contexts/CountryContext";

export default function AddCompanyModal({ onClose, onCreated }: { onClose: () => void; onCreated: (c: any) => void }) {
  const { countries, activeCountry } = useCountry();
  // Defaults the new company to whatever country you're currently working
  // in (the switcher in the admin bar), not always MU. A company always
  // needs one real country, so "All countries" falls back to the first one.
  const defaultCountry = activeCountry === ALL_COUNTRIES ? (countries[0]?.code ?? "MU") : activeCountry;
  const [form, setForm] = useState<CompanyPayload>({ company_name: "", brn: "", email: undefined, address: undefined, phone: undefined, country_code: defaultCountry });
  // CountryContext resolves activeCountry/countries asynchronously
  // (localStorage restore, then a network fetch) — an admin who opens this
  // modal in that window would otherwise get frozen at whatever
  // defaultCountry happened to be at mount (e.g. the pre-restore "MU"
  // fallback). Keep following the resolving value until the admin actually
  // picks something themselves.
  const [countryTouched, setCountryTouched] = useState(false);
  useEffect(() => {
    if (!countryTouched) setForm((f) => ({ ...f, country_code: defaultCountry }));
  }, [defaultCountry, countryTouched]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!form.company_name || !form.brn) {
      setError('Company name and BRN are required');
      return;
    }
    setBusy(true);
    try {
      const res = await createCompany(form);
      if ((res as any)?.error) {
        setError((res as any).error || 'Failed to create');
        return;
      }
      onCreated(res as any);
      onClose();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white dark:bg-gray-900 rounded-[2.5rem] shadow-2xl max-w-lg w-full overflow-hidden animate-in zoom-in-95 duration-300 border border-slate-200 dark:border-gray-800">
        <div className="p-10">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="font-display text-xl font-bold text-slate-900 dark:text-white uppercase tracking-tight leading-none">Initialize Company</h3>
              <p className="text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest mt-2.5">Register a new employer node in the registry</p>
            </div>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 dark:bg-red-950/40 border border-red-100 dark:border-red-900/50 rounded-2xl flex items-center gap-3">
              <div className="w-1.5 h-1.5 rounded-full bg-red-600" />
              <p className="text-[10px] font-black text-red-800 dark:text-red-300 uppercase tracking-widest">{error}</p>
            </div>
          )}

          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Entity Name</label>
                <input
                  placeholder="e.g. Acme Corp"
                  value={form.company_name}
                  onChange={(e) => setForm({ ...form, company_name: e.target.value })}
                  className="w-full p-4 bg-slate-50 dark:bg-gray-800 border border-slate-100 dark:border-gray-700 rounded-2xl text-sm font-bold text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-600/5 focus:border-red-600/20 transition-all font-mono uppercase"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest mb-1.5 ml-1">BRN String</label>
                <input
                  placeholder="BRN-000-000"
                  value={form.brn}
                  onChange={(e) => setForm({ ...form, brn: e.target.value })}
                  className="w-full p-4 bg-slate-50 dark:bg-gray-800 border border-slate-100 dark:border-gray-700 rounded-2xl text-sm font-bold text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-600/5 focus:border-red-600/20 transition-all font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest mb-1.5 ml-1">
                Country <span className="text-red-500">— set once, not editable after creation</span>
              </label>
              <select
                value={form.country_code ?? "MU"}
                onChange={(e) => { setForm({ ...form, country_code: e.target.value }); setCountryTouched(true); }}
                className="w-full p-4 bg-slate-50 dark:bg-gray-800 border border-slate-100 dark:border-gray-700 rounded-2xl text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-600/5 focus:border-red-600/20 transition-all"
              >
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>{c.name} ({c.code})</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Communication Link</label>
              <input
                placeholder="administrator@domain.com"
                value={form.email || ""}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full p-4 bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-2xl text-sm font-bold text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-600/5 transition-all"
              />
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Geolocation</label>
              <input
                placeholder="HQ Physical Coordinates"
                value={form.address || ""}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                className="w-full p-4 bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-2xl text-sm font-bold text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-600/5 transition-all"
              />
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Contact Protocol</label>
              <input
                placeholder="+00 (0) 0000 000"
                value={form.phone || ""}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full p-4 bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-2xl text-sm font-bold text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-600/5 transition-all"
              />
            </div>
          </div>

          <div className="mt-10 pt-8 border-t border-slate-100 dark:border-gray-800 flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-8 py-3.5 rounded-2xl border border-slate-200 dark:border-gray-700 font-black text-[10px] uppercase tracking-widest text-slate-400 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-gray-800 transition-all"
            >
              Abort
            </button>
            <button
              onClick={submit}
              disabled={busy}
              className="px-10 py-3.5 rounded-2xl bg-slate-900 dark:bg-gray-100 text-white dark:text-gray-900 font-black text-[10px] uppercase tracking-widest hover:bg-black dark:hover:bg-gray-200 transition-all disabled:opacity-50"
            >
              {busy ? 'Integrating…' : 'Deploy Entity'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
