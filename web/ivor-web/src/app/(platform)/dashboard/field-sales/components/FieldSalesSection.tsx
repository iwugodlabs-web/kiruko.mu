"use client";

import { useEffect, useState } from "react";
import { BarChart3, Boxes, ClipboardCheck, Loader2, ReceiptText, ShieldCheck, Target } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import {
  getFieldSalesSettings,
  updateFieldSalesSettings,
  type FieldSalesSettings,
} from "@/services/fieldSales";
import OverviewTab from "./OverviewTab";
import CatalogTab from "./CatalogTab";
import PlansTab from "./PlansTab";
import SalesTab from "./SalesTab";
import RunsTab from "./RunsTab";
import type { TabId } from "./types";

const TABS: Array<{ id: TabId; label: string; icon: typeof BarChart3; step?: number }> = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "catalog", label: "Catalog", icon: Boxes, step: 1 },
  { id: "plans", label: "Plans", icon: Target, step: 2 },
  { id: "sales", label: "Sales", icon: ClipboardCheck, step: 3 },
  { id: "runs", label: "Runs", icon: ReceiptText, step: 4 },
];

export default function FieldSalesSection() {
  const [tab, setTab] = useState<TabId>("overview");
  const { companyId } = useAuth();
  const [settings, setSettings] = useState<FieldSalesSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    getFieldSalesSettings(companyId).then(setSettings).catch(() => {});
  }, [companyId]);

  async function toggleMakerChecker(next: boolean) {
    if (!companyId) return;
    setSavingSettings(true);
    try {
      setSettings(await updateFieldSalesSettings(companyId, next));
      toast.success(next ? "Maker-checker enabled." : "Maker-checker disabled.");
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      toast.error(err.response?.data?.detail || "Could not update the setting.");
    } finally {
      setSavingSettings(false);
    }
  }

  return (
    <div className="w-full py-8 px-6">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold text-gray-900 dark:text-white">
          Field Sales &amp; Commissions
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Set up your products and pay plans, capture what reps sell in the field, then run
          commissions — every payout lands on the next payslip.
        </p>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-gray-100 dark:border-gray-800 px-3 py-2">
        <label className="inline-flex items-center gap-2 text-xs font-medium text-gray-700 dark:text-gray-200">
          <input
            type="checkbox"
            checked={!!settings?.maker_checker}
            disabled={!settings || savingSettings}
            onChange={(e) => toggleMakerChecker(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          <ShieldCheck className="h-3.5 w-3.5 text-gray-400" />
          Maker-checker
          {savingSettings && <Loader2 className="h-3 w-3 animate-spin" />}
        </label>
        <span className="text-[11px] text-gray-500 dark:text-gray-400">
          A second admin must approve plan and price changes. Off by default.
        </span>
        {settings && settings.admin_count < 2 && (
          <span className="text-[11px] text-amber-600 dark:text-amber-400">
            Needs at least two active admins.
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2 border-b border-gray-100 dark:border-gray-800 mb-6">
        {TABS.map(({ id, label, icon: Icon, step }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              title={step ? `Step ${step}: ${label}` : label}
              className={`inline-flex items-center gap-2 px-4 py-2 -mb-px text-sm font-medium border-b-2 transition-colors ${
                active
                  ? "border-gray-900 dark:border-white text-gray-900 dark:text-white"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
              }`}
            >
              {step ? (
                <span
                  className={`flex h-4.5 w-4.5 items-center justify-center rounded-full text-[10px] font-semibold ${
                    active
                      ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                      : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                  }`}
                >
                  {step}
                </span>
              ) : (
                <Icon className="h-4 w-4" />
              )}
              {label}
            </button>
          );
        })}
      </div>

      {tab === "overview" && <OverviewTab onNavigate={setTab} />}
      {tab === "catalog" && <CatalogTab onNavigate={setTab} />}
      {tab === "plans" && <PlansTab onNavigate={setTab} />}
      {tab === "sales" && <SalesTab onNavigate={setTab} />}
      {tab === "runs" && <RunsTab onNavigate={setTab} />}
    </div>
  );
}
