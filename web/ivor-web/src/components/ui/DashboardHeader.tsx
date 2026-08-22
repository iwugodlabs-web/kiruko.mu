"use client";

import React from 'react';
import { LucideIcon } from 'lucide-react';
import Breadcrumbs, { BreadcrumbItem } from './Breadcrumbs';

interface DashboardHeaderProps {
  title: string;
  subtitle?: string;
  icon?: LucideIcon | React.ReactNode;
  extra?: React.ReactNode;
  children?: React.ReactNode;
  /**
   * Optional breadcrumb trail rendered above the title. Supplying this also
   * surfaces a back button (router.back() unless `back` is overridden).
   */
  breadcrumbs?: BreadcrumbItem[];
  /** Override the back behavior — see Breadcrumbs.back for accepted values. */
  back?: boolean | string | (() => void);
}

export default function DashboardHeader({
  title,
  subtitle,
  extra,
  children,
  breadcrumbs,
  back,
}: DashboardHeaderProps) {
  // If breadcrumbs are provided, default to enabling the back button unless
  // the caller explicitly opts out by passing `back={false}`.
  const showBack = back !== false && (back !== undefined || !!breadcrumbs);

  return (
    <div className="mb-8">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <Breadcrumbs items={breadcrumbs} back={showBack ? (back ?? true) : false} className="mb-3" />
      )}
      <div className="flex items-start justify-between gap-4 pb-5 border-b border-gray-200 dark:border-gray-800">
        <div>
          <h1 className="font-display font-semibold text-gray-900 dark:text-white text-[2rem] leading-tight tracking-tight">
            {title}
          </h1>
          {subtitle && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 font-normal">{subtitle}</p>
          )}
        </div>
        {extra && (
          <div className="flex items-center gap-2 shrink-0 mt-1">
            {extra}
          </div>
        )}
      </div>
      {children && (
        <div className="mt-4">{children}</div>
      )}
    </div>
  );
}
