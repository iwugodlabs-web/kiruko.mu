"use client";
import React, { useState } from "react";
import CompanyUsersSection from "./CompanyUsersSection";
import { useAuth } from "@/contexts/AuthContext";

export default function ManageUsersButton({ employerId }: { employerId: number }) {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();

  const isSuper = (user as unknown as { is_superuser?: boolean })?.is_superuser;
  // Note: employerId is a company id; owners are tracked by company.user_id. For simplicity, we grant superusers global manage rights here.
  const isOwner = false; // If you need owner detection, pass owner_user_id to this component
  const canManage = Boolean(isSuper) || (user as unknown as { private_user?: { role?: string } })?.private_user?.role === 'admin';

  if (!canManage) return null;

  return (
    <>
      <button onClick={() => setOpen(true)} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors">Manage Users</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-6">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-3xl mt-12 bg-white dark:bg-gray-900 rounded-lg p-6 shadow-lg border border-gray-200 dark:border-gray-800">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Manage Company Users</h3>
              <button onClick={() => setOpen(false)} className="text-sm text-gray-600">Close</button>
            </div>
            <CompanyUsersSection companyId={employerId} />
          </div>
        </div>
      )}
    </>
  );
}
