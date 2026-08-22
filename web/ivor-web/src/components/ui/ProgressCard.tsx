"use client";

import React from 'react';
import { LucideIcon } from 'lucide-react';

interface ProgressCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  progress: number;
  color?: 'red' | 'green' | 'purple' | 'amber' | 'blue';
  className?: string;
  loading?: boolean;
}

const colorMap: Record<string, { iconBg: string; iconText: string; bar: string }> = {
  red:    { iconBg: 'bg-red-50 dark:bg-red-950/40',         iconText: 'text-red-600 dark:text-red-400',         bar: 'bg-red-500' },
  green:  { iconBg: 'bg-emerald-50 dark:bg-emerald-950/40', iconText: 'text-emerald-600 dark:text-emerald-400', bar: 'bg-emerald-500' },
  purple: { iconBg: 'bg-violet-50 dark:bg-violet-950/40',   iconText: 'text-violet-600 dark:text-violet-400',   bar: 'bg-violet-500' },
  amber:  { iconBg: 'bg-amber-50 dark:bg-amber-950/40',     iconText: 'text-amber-600 dark:text-amber-400',     bar: 'bg-amber-500' },
  blue:   { iconBg: 'bg-blue-50 dark:bg-blue-950/40',       iconText: 'text-blue-600 dark:text-blue-400',       bar: 'bg-blue-500' },
};

export default function ProgressCard({
  title,
  value,
  icon: IconComponent,
  progress,
  color = 'red',
  className = '',
  loading,
}: ProgressCardProps) {
  const c = colorMap[color] ?? colorMap.red;
  const pct = Math.min(100, Math.max(0, progress));

  return (
    <div className={`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 ${c.iconBg} rounded-lg flex items-center justify-center shrink-0`}>
            <IconComponent className={`w-4 h-4 ${c.iconText}`} />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">{title}</p>
            {loading ? (
              <div className="h-6 w-12 bg-gray-100 dark:bg-gray-800 animate-pulse rounded mt-0.5" />
            ) : (
              <p className="text-xl font-bold text-gray-900 dark:text-white tabular-nums">{value}</p>
            )}
          </div>
        </div>
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-200 tabular-nums">{pct}%</span>
      </div>
      <div className="w-full h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`${c.bar} h-full rounded-full transition-all duration-700`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
