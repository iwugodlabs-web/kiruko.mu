"use client";
import React, { useEffect, useMemo, useState } from "react";
import { Globe, Plus, Loader2, RefreshCw, Search } from "lucide-react";
import { sectorAdmin, Sector } from "@/services/sectorAdmin";
import { toast } from "sonner";
import SectorTree from "./SectorTree";
import { SectorFormModal, ConfirmDialog } from "./EntityFormModals";
import { ALL_COUNTRIES, useCountry } from "@/contexts/CountryContext";
import DashboardHeader from "@/components/ui/DashboardHeader";
import SolarisBackground from "@/components/ui/SolarisBackground";

export default function SectorManagementSection() {
  const { countries, activeCountry: country } = useCountry();
  const isAllCountries = country === ALL_COUNTRIES;
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editSector, setEditSector] = useState<Sector | null>(null);
  const [deleteSector, setDeleteSector] = useState<Sector | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const loadSectors = async () => {
    if (!country || isAllCountries) { setSectors([]); return; }
    setLoading(true);
    try {
      const list = await sectorAdmin.listSectors(country);
      setSectors(list);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Failed to load sectors");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSectors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country, reloadKey]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sectors;
    return sectors.filter((s) =>
      (s.activity ?? s.name ?? "").toLowerCase().includes(q),
    );
  }, [sectors, search]);

  const selectedCountry = countries.find((c) => c.code === country);

  return (
    <SolarisBackground>
      <div className="w-full space-y-8 py-10 px-6 animate-in fade-in duration-700">
        <DashboardHeader
          title="Sectors"
          subtitle="Manage rate tables, categories, grades, and salary versions used by the mobile calculator. Salary rows are append-only: to fix a mistake, void the bad row and append a corrective version."
          extra={
            <button
              onClick={() => setReloadKey((k) => k + 1)}
              className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-900 dark:text-white rounded-lg text-sm font-medium transition-colors"
              title="Reload"
            >
              <RefreshCw size={14} />
              Reload
            </button>
          }
        />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
          <input
            className="pl-9 pr-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-gray-400 dark:focus:border-gray-600 transition-colors"
            placeholder="Filter sectors…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <button
          onClick={() => setCreateOpen(true)}
          disabled={isAllCountries}
          title={isAllCountries ? "Pick a specific country above to create a sector" : undefined}
          className="ml-auto flex items-center gap-2 px-4 py-2 bg-gray-900 hover:bg-gray-800 dark:bg-white dark:hover:bg-gray-100 text-white dark:text-gray-900 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus size={14} />
          Create sector
        </button>
      </div>

      {isAllCountries ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 p-12 text-center">
          <Globe className="h-8 w-8 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Select a country to manage its sectors</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Sectors always belong to one country — use the switcher above.</p>
        </div>
      ) : (
        <>
          {loading && (
            <div className="flex items-center gap-2 py-6 text-sm text-gray-500 dark:text-gray-400">
              <Loader2 className="animate-spin" size={16} /> Loading sectors…
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 p-8 text-center text-sm text-gray-600 dark:text-gray-400">
              No sectors for {selectedCountry?.name ?? country}.{" "}
              <button
                onClick={() => setCreateOpen(true)}
                className="text-gray-900 dark:text-white underline hover:no-underline"
              >
                Create the first one
              </button>
              .
            </div>
          )}

          <div className="space-y-3">
            {filtered.map((s) => (
              <SectorTree
                key={s.sector_id ?? s.id}
                sector={s}
                reloadKey={reloadKey}
                onChanged={() => setReloadKey((k) => k + 1)}
                onSectorEdit={() => setEditSector(s)}
                onSectorDelete={() => setDeleteSector(s)}
              />
            ))}
          </div>
        </>
      )}

      {createOpen && (
        <SectorFormModal
          mode="create"
          countries={countries}
          initial={{ country_code: country }}
          onClose={() => setCreateOpen(false)}
          onSubmit={async (v) => {
            try {
              await sectorAdmin.createSector(v);
              toast.success("Sector created");
              setCreateOpen(false);
              setReloadKey((k) => k + 1);
            } catch (e: any) {
              toast.error(e?.response?.data?.detail || "Failed to create sector");
            }
          }}
        />
      )}

      {editSector && (
        <SectorFormModal
          mode="edit"
          countries={countries}
          initial={{
            activity: editSector.activity ?? editSector.name,
            description: editSector.description ?? "",
            country_code: editSector.country_code,
            currency: editSector.currency,
          }}
          onClose={() => setEditSector(null)}
          onSubmit={async (v) => {
            try {
              const id = editSector.sector_id ?? editSector.id!;
              await sectorAdmin.updateSector(id, {
                activity: v.activity,
                description: v.description,
                currency: v.currency,
              });
              toast.success("Sector updated");
              setEditSector(null);
              setReloadKey((k) => k + 1);
            } catch (e: any) {
              toast.error(e?.response?.data?.detail || "Failed to update sector");
            }
          }}
        />
      )}

      {deleteSector && (
        <ConfirmDialog
          title="Delete sector?"
          destructive
          confirmLabel="Delete"
          message={
            <p>
              Deletes <strong>{deleteSector.activity ?? deleteSector.name}</strong>. The request is refused
              if categories still exist. (Cascade delete with <code>?force=true</code> is supported by the
              backend; the UI does not expose it yet — use the API directly for now.)
            </p>
          }
          onClose={() => setDeleteSector(null)}
          onConfirm={async () => {
            try {
              const id = deleteSector.sector_id ?? deleteSector.id!;
              await sectorAdmin.deleteSector(id, false);
              toast.success("Sector deleted");
              setDeleteSector(null);
              setReloadKey((k) => k + 1);
            } catch (e: any) {
              toast.error(e?.response?.data?.detail || "Failed to delete sector");
            }
          }}
        />
      )}
      </div>
    </SolarisBackground>
  );
}
