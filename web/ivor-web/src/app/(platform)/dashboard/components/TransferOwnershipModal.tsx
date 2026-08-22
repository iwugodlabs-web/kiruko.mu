"use client";
import React, { useState } from "react";

type CompanyMember = { user_id: number; private_user?: { role?: string; first_name?: string; last_name?: string; } };

type Props = { users: CompanyMember[]; onClose: () => void; onTransfer: (newOwnerUserId: number) => void };

export default function TransferOwnershipModal({ users, onClose, onTransfer }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl p-6 shadow-xl border border-gray-200 dark:border-gray-800">
        <h4 className="text-base font-semibold text-gray-900 dark:text-white mb-4">Transfer Ownership</h4>
        <select className="w-full p-2.5 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg text-sm mb-4 focus:outline-none focus:border-gray-400 dark:focus:border-gray-500" value={selected ?? ''} onChange={(e) => setSelected(Number(e.target.value))}>
          <option value="">Select new owner</option>
          {users.filter(u => u.private_user?.role !== 'owner').map(u => (
            <option key={u.user_id} value={u.user_id}>{u.private_user?.first_name || u.user_id}</option>
          ))}
        </select>
        <div className="flex gap-2 justify-end">
          <button disabled={!selected} onClick={() => selected && onTransfer(selected)} className="px-4 py-2 bg-gray-900 dark:bg-gray-100 hover:bg-gray-800 dark:hover:bg-gray-200 text-white dark:text-gray-900 text-sm font-medium rounded-lg transition-colors disabled:opacity-50">Transfer</button>
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-lg transition-colors">Cancel</button>
        </div>
      </div>
    </div>
  );
}
