"use client";
import { MessageSquare } from "lucide-react";

export default function Support({ refreshKey }: { refreshKey?: number } = {}) {
  void refreshKey;
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <div className="w-14 h-14 bg-gray-100 dark:bg-gray-800 rounded-2xl flex items-center justify-center">
        <MessageSquare size={24} className="text-gray-300 dark:text-gray-600" />
      </div>
      <div className="text-center space-y-1">
        <p className="text-sm font-semibold text-gray-900 dark:text-white">Support Tickets</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 max-w-xs">
          Employee support ticket management is coming soon. Tickets submitted via the mobile app will appear here.
        </p>
      </div>
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs font-medium text-gray-500 dark:text-gray-400">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
        Coming Soon
      </span>
    </div>
  );
}

