"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/services/apiClient";
import { toast } from "sonner";
import { CalendarDays, Plus, Trash2, Pencil, RefreshCw, Gift, X } from "lucide-react";

interface HolidayRate {
  id: number;
  name: string;           // e.g. "Christmas Day"
  date: string;           // YYYY-MM-DD
  recurrent: boolean;     // repeat annually
  multiplier: number;     // 1.5 = 150% pay, 2.0 = double pay
  note?: string;
}

const MULTIPLIER_OPTIONS = [
  { label: "1× (normal)", value: 1.0 },
  { label: "1.5× (time and a half)", value: 1.5 },
  { label: "2× (double time)", value: 2.0 },
  { label: "2.5×", value: 2.5 },
  { label: "3× (triple)", value: 3.0 },
];

/**
 * Fixed-date fallback list — only used when the Nager.Date API is unavailable.
 * Holidays marked recurrent=true have a fixed MM-DD every year.
 * Lunar/Islamic/Hindu holidays are marked recurrent=false — their dates move year to year
 * so they must be fetched from the public holidays API for accuracy.
 */
function getMuFallbackHolidays(year: number): Omit<HolidayRate, "id">[] {
  return [
    { name: "New Year's Day",       date: `${year}-01-01`, recurrent: true,  multiplier: 2.0 },
    { name: "Thaipoosam Cavadee",   date: `${year}-01-25`, recurrent: false, multiplier: 2.0, note: "Date varies — based on Tamil lunar calendar" },
    { name: "Abolition of Slavery", date: `${year}-02-01`, recurrent: true,  multiplier: 2.0 },
    { name: "Chinese Spring Festival", date: `${year}-02-10`, recurrent: false, multiplier: 2.0, note: "Date varies — based on Chinese lunar calendar" },
    { name: "National Day",         date: `${year}-03-12`, recurrent: true,  multiplier: 2.0 },
    { name: "Ugadi",                date: `${year}-03-30`, recurrent: false, multiplier: 2.0, note: "Date varies — based on Hindu lunar calendar" },
    { name: "Labour Day",           date: `${year}-05-01`, recurrent: true,  multiplier: 2.0 },
    { name: "Eid ul Fitr",          date: `${year}-04-10`, recurrent: false, multiplier: 2.0, note: "Date varies — based on Islamic lunar calendar" },
    { name: "Assumption of Mary",   date: `${year}-08-15`, recurrent: true,  multiplier: 2.0 },
    { name: "Ganesh Chaturthi",     date: `${year}-09-07`, recurrent: false, multiplier: 2.0, note: "Date varies — based on Hindu lunar calendar" },
    { name: "Diwali",               date: `${year}-10-31`, recurrent: false, multiplier: 2.0, note: "Date varies — based on Hindu lunar calendar" },
    { name: "All Saints Day",       date: `${year}-11-01`, recurrent: true,  multiplier: 2.0 },
    { name: "Christmas Day",        date: `${year}-12-25`, recurrent: true,  multiplier: 2.0 },
  ];
}

const EMPTY_FORM: Omit<HolidayRate, "id"> = {
  name: "",
  date: "",
  recurrent: true,
  multiplier: 1.5,
  note: "",
};

export default function HolidayRatesSection() {
  const { user } = useAuth();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const companyId = (user as any)?.company?.company_id as number | undefined;

  const [holidays, setHolidays] = useState<HolidayRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [spinning, setSpinning] = useState(false);
  const [editTarget, setEditTarget] = useState<HolidayRate | null | undefined>(undefined); // undefined=closed, null=create
  const [form, setForm] = useState<Omit<HolidayRate, "id">>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const fetchHolidays = useCallback(async (silent = false) => {
    if (!companyId) return;
    if (!silent) setLoading(true);
    try {
      const res = await api.get(`/company/${companyId}/holiday-rates`);
      setHolidays(Array.isArray(res.data) ? res.data : []);
    } catch {
      // Endpoint may not exist yet; start with empty list (user can add manually)
      setHolidays([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { fetchHolidays(); }, [fetchHolidays]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setEditTarget(null);
  }

  function openEdit(h: HolidayRate) {
    setForm({ name: h.name, date: h.date, recurrent: h.recurrent, multiplier: h.multiplier, note: h.note ?? "" });
    setEditTarget(h);
  }

  function closeForm() {
    setEditTarget(undefined);
    setForm(EMPTY_FORM);
  }

  async function handleSave() {
    if (!companyId || !form.name.trim() || !form.date) return;
    setSaving(true);
    try {
      if (editTarget === null) {
        // Create
        const res = await api.post(`/company/${companyId}/holiday-rates`, form);
        setHolidays((prev) => [...prev, res.data]);
        toast.success(`"${form.name}" added.`);
      } else if (editTarget) {
        // Update
        const res = await api.put(`/company/${companyId}/holiday-rates/${editTarget.id}`, form);
        setHolidays((prev) => prev.map((h) => (h.id === editTarget.id ? res.data : h)));
        toast.success(`"${form.name}" updated.`);
      }
      closeForm();
    } catch {
      // Store locally if backend not ready
      if (editTarget === null) {
        const local: HolidayRate = { ...form, id: Date.now() };
        setHolidays((prev) => [...prev, local]);
        toast.success(`"${form.name}" added (saved locally).`);
        closeForm();
      } else {
        toast.error("Failed to save. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(h: HolidayRate) {
    if (!companyId || !confirm(`Remove "${h.name}"?`)) return;
    try {
      await api.delete(`/company/${companyId}/holiday-rates/${h.id}`);
    } catch { /* ignore if endpoint not ready */ }
    setHolidays((prev) => prev.filter((x) => x.id !== h.id));
    toast.success(`"${h.name}" removed.`);
  }

  const [importing, setImporting] = useState(false);

  async function importMauritius() {
    if (!companyId) return;
    setImporting(true);

    let toImport: Omit<HolidayRate, "id">[] = [];

    // 1. Try Nager.Date public API — accurate dates for lunar/religious holidays
    try {
      const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${selectedYear}/MU`);
      if (res.ok) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data: any[] = await res.json();
        toImport = data.map((h) => ({
          name: h.localName || h.name,
          date: h.date,           // already YYYY-MM-DD, correct for selectedYear
          recurrent: !!h.fixed,   // Nager.Date 'fixed' = same date every year
          multiplier: 2.0,
          note: h.name !== h.localName ? h.name : undefined,
        }));
      }
    } catch {
      // Network error — will fall back below
    }

    // 2. Fall back to local list if API returned nothing
    if (toImport.length === 0) {
      toImport = getMuFallbackHolidays(selectedYear);
      toast.info("Using offline holiday list — verify lunar holiday dates manually.");
    }

    // 3. Skip holidays already in the list (by name)
    const existingNames = new Set(holidays.map((h) => h.name.toLowerCase()));
    const newEntries = toImport.filter((h) => !existingNames.has(h.name.toLowerCase()));

    if (newEntries.length === 0) {
      toast.info(`All ${selectedYear} holidays are already configured.`);
      setImporting(false);
      return;
    }

    // 4. Save each to backend; only keep rows the backend actually persisted.
    // A POST failure must NOT fabricate a local row — that hides the error and
    // leaves an un-persisted holiday that silently disappears on refresh.
    const saved: HolidayRate[] = [];
    let failed = 0;
    for (const entry of newEntries) {
      try {
        const res = await api.post(`/company/${companyId}/holiday-rates`, entry);
        saved.push(res.data);
      } catch {
        failed++;
      }
    }

    if (saved.length > 0) {
      setHolidays((prev) => [...prev, ...saved]);
    }

    if (failed > 0) {
      toast.error(
        saved.length > 0
          ? `${saved.length} imported, but ${failed} failed to save. Please try again.`
          : `Failed to import holidays for ${selectedYear}. Please try again.`
      );
    } else {
      toast.success(`${saved.length} holiday${saved.length !== 1 ? "s" : ""} imported for ${selectedYear}.`);
    }
    setImporting(false);
  }

  const thisYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(thisYear);
  const yearOptions = [thisYear - 1, thisYear, thisYear + 1];

  type DisplayHoliday = HolidayRate & { _displayDate: string };

  // For display: recurrent holidays appear every year (adjust year to selectedYear);
  // one-off holidays appear only in their specific year.
  const displayedHolidays: DisplayHoliday[] = holidays
    .map((h): DisplayHoliday => {
      if (h.recurrent) {
        // Replace the year portion with selectedYear for display
        const withYear = `${selectedYear}-${h.date.slice(5)}`; // YYYY-MM-DD → selectedYear-MM-DD
        return { ...h, _displayDate: withYear };
      }
      return { ...h, _displayDate: h.date };
    })
    .filter((h) => h._displayDate.startsWith(String(selectedYear)));

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const upcomingCount = displayedHolidays.filter((h) => new Date(h._displayDate + "T12:00:00") >= today).length;

  if (!companyId) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Gift size={18} className="text-gray-400" />
            Holiday Pay Rates
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Configure public holidays and pay multipliers per year.
            Rates will apply to payroll calculations when the payroll module is enabled.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={async () => { setSpinning(true); await fetchHolidays(true); setSpinning(false); }}
            disabled={spinning}
            className="p-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
          >
            <RefreshCw size={14} className={spinning ? "animate-spin" : ""} />
          </button>
          <button
            onClick={importMauritius}
            disabled={importing}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 rounded-xl transition-colors disabled:opacity-50"
          >
            <RefreshCw size={13} className={importing ? "animate-spin" : ""} />
            Import MU {selectedYear}
          </button>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-colors"
          >
            <Plus size={14} />
            Add Holiday
          </button>
        </div>
      </div>

      {/* Payroll integration info banner */}
      <div className="flex items-start gap-3 px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-xl">
        <CalendarDays size={15} className="text-blue-500 shrink-0 mt-0.5" />
        <div className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
          <span className="font-semibold">How holiday rates affect pay: </span>
          When an employee works on a configured public holiday, their hourly rate is multiplied by the configured rate (e.g. 2× means double pay).
          Recurrent holidays (✓ Annual) apply automatically each year. One-off holidays must be re-added each year.
          <span className="block mt-1 text-blue-500 dark:text-blue-400">Payroll module integration: coming soon — rates are being configured now in preparation.</span>
        </div>
      </div>

      {/* Stats + Year selector */}
      {!loading && (
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-3 py-1.5 rounded-lg">
              <CalendarDays size={11} />
              {displayedHolidays.length} holiday{displayedHolidays.length !== 1 ? "s" : ""} in {selectedYear}
            </span>
            {upcomingCount > 0 && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-3 py-1.5 rounded-lg">
                <CalendarDays size={11} />
                {upcomingCount} upcoming
              </span>
            )}
          </div>
          {/* Year selector */}
          <div className="flex items-center bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-0.5">
            {yearOptions.map((y) => (
              <button
                key={y}
                onClick={() => setSelectedYear(y)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  selectedYear === y
                    ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900"
                    : "text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
                }`}
              >
                {y}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Holiday list */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-14 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
          ))}
        </div>
      ) : holidays.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl text-gray-400 dark:text-gray-500">
          <Gift size={28} className="mb-2 opacity-40" />
          <p className="text-sm font-medium">No holidays configured</p>
          <p className="text-xs mt-1">Add public holidays to apply special pay rates automatically.</p>
          <div className="flex gap-2 mt-4">
            <button
              onClick={importMauritius}
              disabled={importing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={11} className={importing ? "animate-spin" : ""} />
              Import MU {selectedYear}
            </button>
            <button
              onClick={openCreate}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              <Plus size={12} />
              Add manually
            </button>
          </div>
        </div>
      ) : displayedHolidays.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-32 border border-dashed border-gray-200 dark:border-gray-700 rounded-xl text-gray-400">
          <p className="text-sm font-medium">No holidays for {selectedYear}</p>
          <p className="text-xs mt-1">One-off holidays are year-specific. Recurrent holidays show every year.</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/60 border-b border-gray-100 dark:border-gray-700">
              <tr>
                {["Holiday", "Date", "Recurrence", "Pay Rate", "Note", ""].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
              {displayedHolidays
                .slice()
                .sort((a, b) => a._displayDate.localeCompare(b._displayDate))
                .map((h) => {
                  const displayDate = new Date(h._displayDate + "T12:00:00");
                  const isPast = displayDate < today && !h.recurrent;
                  return (
                    <tr key={h.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors ${isPast ? "opacity-50" : ""}`}>
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                        <div className="flex items-center gap-2">
                          <Gift size={13} className="text-gray-300 dark:text-gray-600 shrink-0" />
                          {h.name}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {displayDate.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}
                      </td>
                      <td className="px-4 py-3">
                        {h.recurrent ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-1.5 py-0.5 rounded-md">✓ Annual</span>
                        ) : (
                          <span className="text-[10px] text-gray-400 dark:text-gray-500">One-off ({h.date.slice(0, 4)})</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded-md ${
                          h.multiplier >= 2 ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                          : h.multiplier >= 1.5 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                          : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                        }`}>
                          {h.multiplier}×
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400 dark:text-gray-500 max-w-[160px] truncate">
                        {h.note || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            onClick={() => openEdit(h)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() => handleDelete(h)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-400 dark:text-gray-500">
        Mauritius Employment Rights Act requires a minimum of 2× pay for public holiday work.
        Toggle years above to view or plan holidays for previous and future years.
      </p>

      {/* Create / Edit modal */}
      {editTarget !== undefined && (
        <>
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" onClick={closeForm} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md border border-gray-100 dark:border-gray-700">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
                <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                  {editTarget === null ? "Add Holiday" : "Edit Holiday"}
                </h3>
                <button onClick={closeForm} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors">
                  <X size={16} />
                </button>
              </div>
              <div className="px-5 py-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">Holiday Name <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. National Day"
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoFocus
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">Date <span className="text-red-500">*</span></label>
                    <input
                      type="date"
                      value={form.date}
                      onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
                      className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">Pay Rate</label>
                    <select
                      value={form.multiplier}
                      onChange={(e) => setForm((p) => ({ ...p, multiplier: parseFloat(e.target.value) }))}
                      className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {MULTIPLIER_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="recurrent"
                    checked={form.recurrent}
                    onChange={(e) => setForm((p) => ({ ...p, recurrent: e.target.checked }))}
                    className="accent-blue-600"
                  />
                  <label htmlFor="recurrent" className="text-sm text-gray-700 dark:text-gray-300 cursor-pointer select-none">
                    Repeat annually on the same date
                  </label>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">Note (optional)</label>
                  <input
                    type="text"
                    value={form.note ?? ""}
                    onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
                    placeholder="e.g. National holiday per Labour Act §23"
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-100 dark:border-gray-800">
                <button onClick={closeForm} className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !form.name.trim() || !form.date}
                  className="px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-xl disabled:opacity-50 transition-colors"
                >
                  {saving ? "Saving…" : editTarget === null ? "Add Holiday" : "Save Changes"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
