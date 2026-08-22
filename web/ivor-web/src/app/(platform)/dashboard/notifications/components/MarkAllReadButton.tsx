"use client";

import { CheckCheck } from "lucide-react";

interface Props {
  unreadCount: number;
  onMarkAll: () => void;
  loading: boolean;
}

export default function MarkAllReadButton({ unreadCount, onMarkAll, loading }: Props) {
  if (unreadCount === 0) return null;

  return (
    <button
      onClick={onMarkAll}
      disabled={loading}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
    >
      <CheckCheck size={13} />
      Mark all read ({unreadCount})
    </button>
  );
}
