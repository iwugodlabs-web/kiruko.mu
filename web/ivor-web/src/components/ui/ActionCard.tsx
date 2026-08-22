"use client";

import React from 'react';
import { LucideIcon } from 'lucide-react';

interface ActionCardProps {
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  active?: boolean;
  urgent?: boolean;
  color?: string;
  className?: string;
  onClick?: () => void;
}

export default function ActionCard({
  title,
  subtitle,
  icon: IconComponent,
  active = false,
  urgent = false,
  color,
  className = '',
  onClick,
}: ActionCardProps) {
  return (
    <button
      onClick={onClick}
      className={`group flex flex-col items-start gap-3 p-4 rounded-xl transition-colors text-left w-full active:scale-[0.99] ${
        active
          ? 'bg-gray-900 border border-gray-900 text-white'
          : 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-900 dark:text-white hover:border-gray-300 dark:hover:border-gray-700'
      } ${className}`}
    >
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
        active ? 'bg-white/15' : 'bg-gray-50 dark:bg-gray-800/60 group-hover:bg-red-50 dark:group-hover:bg-red-950/40'
      }`}>
        <IconComponent className={`w-4 h-4 transition-colors ${
          active ? 'text-white' : 'text-gray-500 dark:text-gray-400 group-hover:text-red-600 dark:group-hover:text-red-400'
        }`} />
      </div>

      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold leading-tight ${
          active ? 'text-white' : 'text-gray-900 dark:text-white'
        }`}>{title}</p>
        {subtitle && (
          <p className={`text-xs mt-0.5 leading-relaxed ${
            active ? 'text-gray-300' : 'text-gray-500 dark:text-gray-400'
          }`}>
            {subtitle}
          </p>
        )}
        {urgent && (
          <span className="inline-block mt-1.5 px-2 py-0.5 bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400 rounded text-[10px] font-semibold">
            URGENT
          </span>
        )}
      </div>
    </button>
  );
}
