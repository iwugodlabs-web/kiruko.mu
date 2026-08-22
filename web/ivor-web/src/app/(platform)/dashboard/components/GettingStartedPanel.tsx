"use client";

import { useRouter } from "next/navigation";
import { ArrowRight, Check, Users, DollarSign, CalendarDays } from "lucide-react";

interface GettingStartedPanelProps {
  companyName: string;
}

interface ChecklistItem {
  label: string;
  done: boolean;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  href: string;
  cta: string;
}

export default function GettingStartedPanel({ companyName }: GettingStartedPanelProps) {
  const router = useRouter();

  const items: ChecklistItem[] = [
    {
      label: "Company created",
      done: true,
      icon: Check,
      href: "/dashboard/settings",
      cta: "Edit details",
    },
    {
      label: "Onboard or invite your first employee",
      done: false,
      icon: Users,
      href: "/dashboard/employees",
      cta: "Add employee",
    },
    {
      label: "Set up a payroll structure",
      done: false,
      icon: DollarSign,
      href: "/dashboard/salary-structures",
      cta: "Configure",
    },
    {
      label: "Create your first schedule",
      done: false,
      icon: CalendarDays,
      href: "/dashboard/schedule",
      cta: "Open schedule",
    },
  ];

  const remaining = items.filter((i) => !i.done).length;

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5 mb-6">
      <div className="flex items-start justify-between mb-4 gap-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            Get started with {companyName}
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            {remaining} {remaining === 1 ? "step" : "steps"} left to finish setting up your workspace.
          </p>
        </div>
        <span className="text-[11px] font-medium text-blue-600 bg-blue-50 dark:bg-blue-950/30 px-2.5 py-1 rounded-md whitespace-nowrap">
          {items.length - remaining}/{items.length} done
        </span>
      </div>

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.label}>
              <button
                onClick={() => router.push(item.href)}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${
                  item.done
                    ? "border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/10 dark:border-emerald-900/40"
                    : "border-gray-200 dark:border-gray-800 hover:border-blue-300 hover:bg-blue-50/40 dark:hover:bg-blue-950/10"
                }`}
              >
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                    item.done
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                      : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                  }`}
                >
                  <Icon size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-sm font-medium truncate ${
                      item.done ? "text-gray-500 line-through" : "text-gray-900 dark:text-white"
                    }`}
                  >
                    {item.label}
                  </p>
                </div>
                {!item.done && (
                  <span className="text-[11px] font-medium text-blue-600 flex items-center gap-1 shrink-0">
                    {item.cta} <ArrowRight size={10} />
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
