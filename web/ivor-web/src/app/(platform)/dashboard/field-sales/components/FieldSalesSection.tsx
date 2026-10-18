"use client";

import { useState } from "react";
import { BarChart3, Boxes, ClipboardCheck, ReceiptText, Target } from "lucide-react";
import OverviewTab from "./OverviewTab";
import CatalogTab from "./CatalogTab";
import PlansTab from "./PlansTab";
import SalesTab from "./SalesTab";
import RunsTab from "./RunsTab";

type TabId = "overview" | "catalog" | "plans" | "sales" | "runs";

const TABS: Array<{ id: TabId; label: string; icon: typeof BarChart3 }> = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "catalog", label: "Catalog", icon: Boxes },
  { id: "plans", label: "Plans", icon: Target },
  { id: "sales", label: "Sales", icon: ClipboardCheck },
  { id: "runs", label: "Runs", icon: ReceiptText },
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
          Catalog, plans, field sales and commission runs — paid through the payslip.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-gray-100 dark:border-gray-800 mb-6">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-2 px-4 py-2 -mb-px text-sm font-medium border-b-2 transition-colors ${
                active
                  ? "border-gray-900 dark:border-white text-gray-900 dark:text-white"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
              }`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          );
        })}
      </div>

      {tab === "overview" && <OverviewTab />}
      {tab === "catalog" && <CatalogTab />}
      {tab === "plans" && <PlansTab />}
      {tab === "sales" && <SalesTab />}
      {tab === "runs" && <RunsTab />}
    </div>
  );
}
