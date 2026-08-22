"use client";

import { CheckCircle, XCircle, X } from "lucide-react";

interface Props {
  count: number;
  onApprove: () => void;
  onReject: () => void;
  onClear: () => void;
  loading: boolean;
}

export default function BulkActionBar({ count, onApprove, onReject, onClear, loading }: Props) {
  if (count === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-2xl shadow-xl px-5 py-3">
      <span className="text-sm font-semibold">{count} selected</span>
      <div className="w-px h-5 bg-white/20 dark:bg-gray-900/20" />
      <button
        onClick={onApprove}
        disabled={loading}
        className="flex items-center gap-1.5 text-sm font-medium text-green-400 dark:text-green-600 hover:text-green-300 dark:hover:text-green-700 disabled:opacity-50 transition-colors"
      >
        <CheckCircle size={15} />
        Approve All
      </button>
      <button
        onClick={onReject}
        disabled={loading}
        className="flex items-center gap-1.5 text-sm font-medium text-red-400 dark:text-red-500 hover:text-red-300 dark:hover:text-red-600 disabled:opacity-50 transition-colors"
      >
        <XCircle size={15} />
        Reject All
      </button>
      <button
        onClick={onClear}
        className="p-1 rounded-lg hover:bg-white/10 dark:hover:bg-gray-900/10 transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  );
}
