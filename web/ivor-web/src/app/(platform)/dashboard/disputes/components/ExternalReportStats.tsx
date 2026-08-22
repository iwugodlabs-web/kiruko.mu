"use client";

import { ExternalStats } from "./types";
import { Shield, Info } from "lucide-react";

interface Props {
  stats: ExternalStats;
  loading: boolean;
}

export default function ExternalReportStats({ stats, loading }: Props) {
  const categoryEntries = Object.entries(stats.by_category ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5 space-y-4">
      {/* Privacy notice */}
      <div className="flex items-start gap-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-xl px-4 py-3">
        <Shield size={15} className="text-blue-500 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-blue-800 dark:text-blue-300">External Reports — Anonymised View Only</p>
          <p className="text-xs text-blue-700 dark:text-blue-400 mt-0.5 leading-relaxed">
            These reports were filed directly to external mediators (labour authority, NGO, embassy).
            Kiruko does not expose employee identities or report content to employers.
            This protects workers from potential retaliation.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-6">
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400">Total Filed</p>
          {loading ? (
            <div className="h-8 w-12 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mt-1" />
          ) : (
            <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">{stats.total}</p>
          )}
        </div>
        <div className="flex-1">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">By Category</p>
          {loading ? (
            <div className="space-y-1">
              {[1, 2, 3].map((i) => <div key={i} className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />)}
            </div>
          ) : categoryEntries.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500">No external reports filed.</p>
          ) : (
            <div className="space-y-1.5">
              {categoryEntries.map(([cat, count]) => (
                <div key={cat} className="flex items-center gap-2">
                  <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-1.5">
                    <div
                      className="bg-blue-400 dark:bg-blue-500 h-1.5 rounded-full"
                      style={{ width: `${(count / stats.total) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-600 dark:text-gray-400 capitalize w-28 truncate">
                    {cat.replace(/_/g, " ")}
                  </span>
                  <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 w-4 text-right">{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
