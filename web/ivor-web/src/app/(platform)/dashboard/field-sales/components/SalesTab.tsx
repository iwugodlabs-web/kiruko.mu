"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Loader2, MapPin, Plus } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { fetchCompanyUsers, type User } from "@/services/api";
import {
  listPendingSales,
  listSales,
  reviewSale,
  listOutlets,
  createOutlet,
  type Sale,
  type Outlet,
} from "@/services/fieldSales";

function money(v?: string | null, currency = "MUR"): string {
  if (v == null) return "—";
  return `${currency} ${Number(v).toFixed(2)}`;
}

export default function SalesTab() {
  const { companyId } = useAuth();
  const [pending, setPending] = useState<Sale[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [reps, setReps] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [newOutlet, setNewOutlet] = useState({ name: "", code: "", address: "", latitude: "", longitude: "" });

  async function load() {
    if (!companyId) return;
    setLoading(true);
    try {
      const [p, s, o, u] = await Promise.all([
        listPendingSales(companyId),
        listSales(companyId),
        listOutlets(companyId, true),
        fetchCompanyUsers(companyId),
      ]);
      setPending(p);
      setSales(s);
      setOutlets(o);
      if (Array.isArray(u)) setReps(u);
    } catch {
      toast.error("Failed to load sales.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  function repName(id: number): string {
    const u = reps.find((r) => r.private_user?.private_user_id === id);
    return u ? `${u.private_user?.first_name ?? ""} ${u.private_user?.last_name ?? ""}`.trim() || u.email : `Rep #${id}`;
  }

  async function handleReview(sale: Sale, decision: "approve" | "reject") {
    if (!companyId) return;
    setBusyId(sale.id);
    try {
      await reviewSale(companyId, sale.id, decision);
      toast.success(decision === "approve" ? "Sale approved." : "Sale rejected.");
      load();
    } catch {
      toast.error("Review failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleCreateOutlet() {
    if (!companyId || !newOutlet.name.trim()) {
      toast.error("Outlet name is required.");
      return;
    }
    try {
      await createOutlet(companyId, {
        name: newOutlet.name.trim(),
        code: newOutlet.code || null,
        address: newOutlet.address || null,
        latitude: newOutlet.latitude ? Number(newOutlet.latitude) : null,
        longitude: newOutlet.longitude ? Number(newOutlet.longitude) : null,
      });
      toast.success("Outlet created.");
      setNewOutlet({ name: "", code: "", address: "", latitude: "", longitude: "" });
      load();
    } catch {
      toast.error("Could not create outlet.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5">
        <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Pending approval <span className="text-sm font-normal text-gray-500">({pending.length})</span>
        </h2>
        {loading ? (
          <div className="py-8 text-center text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin inline" /></div>
        ) : pending.length === 0 ? (
          <div className="py-6 text-center text-sm text-gray-500">Nothing waiting for review.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-gray-400 border-b border-gray-100 dark:border-gray-800">
                  <th className="py-2 pr-3">Rep</th>
                  <th className="py-2 pr-3">Sold</th>
                  <th className="py-2 pr-3">Outlet</th>
                  <th className="py-2 pr-3">Visit</th>
                  <th className="py-2 pr-3 text-right">Lines</th>
                  <th className="py-2 pr-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((s) => (
                  <tr key={s.id} className="border-b border-gray-50 dark:border-gray-800/60">
                    <td className="py-2 pr-3">{repName(s.rep_private_user_id)}</td>
                    <td className="py-2 pr-3 text-gray-500">{s.sold_at?.slice(0, 10)}</td>
                    <td className="py-2 pr-3 text-gray-500">{outlets.find((o) => o.id === s.outlet_id)?.name ?? "—"}</td>
                    <td className="py-2 pr-3 text-gray-500">
                      {s.visit_verified == null ? "—" : s.visit_verified ? (
                        <span className="text-emerald-600">verified</span>
                      ) : (
                        <span className="text-amber-600">flagged{s.visit_distance_m != null ? ` (${Math.round(s.visit_distance_m)}m)` : ""}</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right">{s.lines?.length ?? 0}</td>
                    <td className="py-2 pr-3">
                      <div className="flex justify-end gap-2">
                        <button
                          disabled={busyId === s.id}
                          onClick={() => handleReview(s, "approve")}
                          className="inline-flex items-center gap-1 rounded-md border border-emerald-200 text-emerald-700 px-2 py-1 text-xs font-medium disabled:opacity-50"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                        </button>
                        <button
                          disabled={busyId === s.id}
                          onClick={() => handleReview(s, "reject")}
                          className="inline-flex items-center gap-1 rounded-md border border-red-200 text-red-600 px-2 py-1 text-xs font-medium disabled:opacity-50"
                        >
                          <XCircle className="h-3.5 w-3.5" /> Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5">
          <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-white mb-4">Recent sales</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-gray-400 border-b border-gray-100 dark:border-gray-800">
                  <th className="py-2 pr-3">Rep</th>
                  <th className="py-2 pr-3">Sold</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Payment</th>
                  <th className="py-2 pr-3 text-right">Collected</th>
                </tr>
              </thead>
              <tbody>
                {sales.slice(0, 25).map((s) => (
                  <tr key={s.id} className="border-b border-gray-50 dark:border-gray-800/60">
                    <td className="py-2 pr-3">{repName(s.rep_private_user_id)}</td>
                    <td className="py-2 pr-3 text-gray-500">{s.sold_at?.slice(0, 10)}</td>
                    <td className="py-2 pr-3">
                      <span className="rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-xs">{s.status}</span>
                    </td>
                    <td className="py-2 pr-3 text-gray-500">{s.payment_status}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{money(s.collected_amount, s.currency)}</td>
                  </tr>
                ))}
                {sales.length === 0 && (
                  <tr><td colSpan={5} className="py-8 text-center text-gray-500">No sales yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5">
          <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <MapPin className="h-4 w-4" /> Outlets
          </h2>
          <div className="space-y-2 mb-3">
            <input
              placeholder="Outlet name"
              value={newOutlet.name}
              onChange={(e) => setNewOutlet((s) => ({ ...s, name: e.target.value }))}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm"
            />
            <div className="flex gap-2">
              <input
                placeholder="Code"
                value={newOutlet.code}
                onChange={(e) => setNewOutlet((s) => ({ ...s, code: e.target.value }))}
                className="w-24 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm"
              />
              <input
                placeholder="Address"
                value={newOutlet.address}
                onChange={(e) => setNewOutlet((s) => ({ ...s, address: e.target.value }))}
                className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <input
                placeholder="Latitude"
                value={newOutlet.latitude}
                onChange={(e) => setNewOutlet((s) => ({ ...s, latitude: e.target.value }))}
                className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm"
              />
              <input
                placeholder="Longitude"
                value={newOutlet.longitude}
                onChange={(e) => setNewOutlet((s) => ({ ...s, longitude: e.target.value }))}
                className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1.5 text-sm"
              />
            </div>
            <button
              onClick={handleCreateOutlet}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-sm font-medium"
            >
              <Plus className="h-4 w-4" /> Add outlet
            </button>
          </div>
          <ul className="space-y-1 text-sm max-h-72 overflow-y-auto">
            {outlets.map((o) => (
              <li key={o.id} className="flex items-center justify-between rounded-md px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-800">
                <span>{o.name}</span>
                <span className="text-xs text-gray-400">
                  {o.latitude != null && o.longitude != null ? "geo" : "no geo"}
                </span>
              </li>
            ))}
            {outlets.length === 0 && <li className="text-gray-400 text-xs py-2">No outlets yet.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
