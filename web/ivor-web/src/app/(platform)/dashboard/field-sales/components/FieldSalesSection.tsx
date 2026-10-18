"use client";

import { useState } from "react";
import { BarChart3, Boxes, ClipboardCheck, ReceiptText, Target } from "lucide-react";
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
