"use client";

import React from 'react';
import { LucideIcon } from 'lucide-react';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  className?: string;
  action?: React.ReactNode;
}

export default function SectionHeader({
  title,
  subtitle,
  icon: IconComponent,
  className = '',
  action,
}: SectionHeaderProps) {
  return (
    <div className={`flex items-center justify-between mb-5 ${className}`}>
      <div className="flex items-center gap-2.5 min-w-0">
        {IconComponent && (
          <div className="w-7 h-7 bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center shrink-0">
            <IconComponent className="w-3.5 h-3.5 text-gray-600 dark:text-gray-400" />
          </div>
        )}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white leading-none">{title}</h3>
          {subtitle && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
