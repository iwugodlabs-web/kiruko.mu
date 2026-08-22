"use client";

import { Send, CheckCircle } from "lucide-react";

interface Props {
  newCount: number;   // shifts created this session
  onPublish: () => void;
  publishing: boolean;
  published: boolean;
}

export default function PublishBar({ newCount, onPublish, publishing, published }: Props) {
  if (newCount === 0 && !published) return null;

  return (
    <div className="fixed bottom-6 right-6 z-40">
      {published ? (
        <div className="flex items-center gap-2 bg-green-600 text-white rounded-2xl shadow-xl px-5 py-3 text-sm font-medium">
          <CheckCircle size={15} />
          Schedule published — employees notified
        </div>
      ) : (
        <div className="flex items-center gap-3 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-2xl shadow-xl px-5 py-3">
          <div className="text-sm">
            <span className="font-bold">{newCount}</span>
            <span className="text-gray-300 dark:text-gray-600 ml-1">new shift{newCount !== 1 ? "s" : ""} this week</span>
          </div>
          <div className="w-px h-5 bg-white/20 dark:bg-gray-900/20" />
          <button
            onClick={onPublish}
            disabled={publishing}
            className="flex items-center gap-1.5 text-sm font-semibold text-green-400 dark:text-green-600 hover:text-green-300 dark:hover:text-green-700 disabled:opacity-50 transition-colors"
          >
            <Send size={14} />
            {publishing ? "Notifying…" : "Notify Employees"}
          </button>
        </div>
      )}
    </div>
  );
}
