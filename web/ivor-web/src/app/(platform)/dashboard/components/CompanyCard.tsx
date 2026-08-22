"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  MoreVertical,
  Building2,
  Edit3,
  Trash2,
  Calendar,
  Mail,
  Hash,
  Users2,
  Clock3,
  Rocket,
  ChevronRight,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

type CompanySummary = {
  company_id: number;
  company_name: string;
  email?: string;
  brn?: string;
  created_at?: string;
  status?: 'active' | 'disabled' | 'deleted';
};

type CompanyStats = {
  verified_headcount?: number;
  pending_verifications?: number;
  open_jobs_count?: number
} | null;

export default function CompanyCard({
  company,
  stats = null,
  onView,
  onManage,
  onEdit,
  onDelete,
  disabledActions = false,
}: {
  company: CompanySummary;
  stats?: CompanyStats;
  onView?: (id: number) => void;
  onManage?: (id: number) => void;
  onEdit?: (id: number) => void;
  onDelete?: (id: number) => void;
  disabledActions?: boolean;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleManage = (e: React.MouseEvent) => {
    e.stopPropagation();
    onManage && onManage(company.company_id);
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(false);
    onEdit && onEdit(company.company_id);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(false);
    onDelete && onDelete(company.company_id);
  };

  const handleView = () => {
    onView && onView(company.company_id);
  };

  const formattedDate = company.created_at
    ? new Date(company.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : '—';

  return (
    <div
      onClick={handleView}
      className="group relative bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 hover:border-gray-300 dark:hover:border-gray-700 hover:shadow-md transition-all cursor-pointer"
    >
      <div className="flex flex-col h-full space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-600 dark:text-gray-400">
              <Building2 size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white leading-tight">
                  {company.company_name}
                </h3>
                {company.status && company.status !== 'active' && (
                  <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${company.status === 'disabled' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>
                    {company.status}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Calendar size={11} className="text-gray-400" />
                <span className="text-xs text-gray-400">Since {formattedDate}</span>
              </div>
            </div>
          </div>

          <div className="relative" ref={menuRef}>
            <button
              onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
            >
              <MoreVertical size={16} />
            </button>

            {showMenu && (
              <div className="absolute right-0 mt-1 w-44 bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-gray-200 dark:border-gray-800 p-1 z-50">
                <button
                  onClick={handleEdit}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                >
                  <Edit3 size={14} /> Edit
                </button>
                <button
                  onClick={handleDelete}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                >
                  <Trash2 size={14} /> Remove
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Contact Info */}
        <div className="grid grid-cols-2 gap-2">
          <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
            <div className="flex items-center gap-1.5 mb-1">
              <Mail size={11} className="text-gray-400" />
              <span className="text-[11px] text-gray-400">Email</span>
            </div>
            <p className="text-xs font-medium text-gray-900 dark:text-white truncate">{company.email || '—'}</p>
          </div>
          <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
            <div className="flex items-center gap-1.5 mb-1">
              <Hash size={11} className="text-gray-400" />
              <span className="text-[11px] text-gray-400">BRN</span>
            </div>
            <p className="text-xs font-medium text-gray-900 dark:text-white truncate">{company.brn || '—'}</p>
          </div>
        </div>

        {/* Stats Row */}
        <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">
          <div className="flex flex-col items-center flex-1">
            <div className="flex items-center gap-1 text-gray-400 mb-1">
              <Users2 size={12} className="text-blue-500" />
              <span className="text-[11px] text-gray-400">Staff</span>
            </div>
            <p className="text-base font-semibold text-gray-900 dark:text-white">{stats?.verified_headcount ?? 0}</p>
          </div>
          <div className="w-px h-8 bg-gray-200 dark:bg-gray-700" />
          <div className="flex flex-col items-center flex-1">
            <div className="flex items-center gap-1 text-gray-400 mb-1">
              <Clock3 size={12} className="text-amber-500" />
              <span className="text-[11px] text-gray-400">Pending</span>
            </div>
            <p className="text-base font-semibold text-gray-900 dark:text-white">{stats?.pending_verifications ?? 0}</p>
          </div>
          <div className="w-px h-8 bg-gray-200 dark:bg-gray-700" />
          <div className="flex flex-col items-center flex-1">
            <div className="flex items-center gap-1 text-gray-400 mb-1">
              <Rocket size={12} className="text-emerald-500" />
              <span className="text-[11px] text-gray-400">Jobs</span>
            </div>
            <p className="text-base font-semibold text-gray-900 dark:text-white">{stats?.open_jobs_count ?? 0}</p>
          </div>
        </div>

        {/* CTA */}
        <button
          onClick={handleManage}
          disabled={disabledActions}
          className="w-full py-2.5 flex items-center justify-center gap-2 bg-gray-900 hover:bg-gray-800 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        >
          Manage
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}
