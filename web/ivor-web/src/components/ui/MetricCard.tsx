"use client";

import React from 'react';
import { LucideIcon, TrendingUp, TrendingDown } from 'lucide-react';

interface MetricCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  subtitle?: string;
  trend?: string;
  trendUp?: boolean;
  loading?: boolean;
  color?: 'red' | 'blue' | 'green' | 'purple' | 'amber' | 'gray';
  onClick?: () => void;
}

const colorMap: Record<string, { bg: string; text: string }> = {
  red:    { bg: 'bg-red-50',     text: 'text-red-600' },
  blue:   { bg: 'bg-blue-50',    text: 'text-blue-600' },
  green:  { bg: 'bg-emerald-50', text: 'text-emerald-600' },
  purple: { bg: 'bg-violet-50',  text: 'text-violet-600' },
  amber:  { bg: 'bg-amber-50',   text: 'text-amber-600' },
  gray:   { bg: 'bg-gray-100',   text: 'text-gray-600' },
};

export default function MetricCard({
  title,
  value,
  icon: IconComponent,
  subtitle,
  trend,
  trendUp,
  loading,
  color = 'gray',
  onClick,
}: MetricCardProps) {
  const c = colorMap[color] ?? colorMap.gray;

  return (
    <div
      className={`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5 transition-colors ${
        onClick ? 'cursor-pointer hover:border-gray-300 dark:hover:border-gray-700' : ''
      }`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-4">
        <div className={`w-9 h-9 ${c.bg} rounded-lg flex items-center justify-center shrink-0`}>
          <IconComponent className={`w-4 h-4 ${c.text}`} />
        </div>
        {trend && (
          <div className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${
            trendUp ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
          }`}>
            {trendUp
              ? <TrendingUp className="w-3 h-3" />
              : <TrendingDown className="w-3 h-3" />
            }
            {trend}
          </div>
        )}
      </div>

      <div>
        {loading ? (
          <div className="h-7 w-20 bg-gray-100 dark:bg-gray-800 animate-pulse rounded mb-1.5" />
        ) : (
          <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{value}</p>
        )}
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{title}</p>
        {subtitle && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{subtitle}</p>
        )}
      </div>
    </div>
  );
}
