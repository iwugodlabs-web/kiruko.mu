"use client";

import { AppNotification, configForType, relativeTime } from "./types";

interface Props {
  notification: AppNotification;
  onMarkRead: (id: number) => void;
}

export default function NotificationItem({ notification, onMarkRead }: Props) {
  const cfg = configForType(notification.type);
  const unread = !notification.is_read;

  function handleClick() {
    if (unread) onMarkRead(notification.notification_id);
  }

  return (
    <div
      onClick={handleClick}
      className={`flex items-start gap-3 px-5 py-4 border-l-4 transition-colors cursor-pointer ${cfg.color} ${
        unread
          ? "bg-white dark:bg-gray-800/80 hover:bg-gray-50 dark:hover:bg-gray-700/80"
          : "bg-gray-50/50 dark:bg-gray-800/30 hover:bg-gray-100/50 dark:hover:bg-gray-700/30"
      }`}
    >
      {/* Emoji icon */}
      <span className="text-lg shrink-0 mt-0.5">{cfg.emoji}</span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <p className={`text-sm leading-snug ${unread ? "font-semibold text-gray-900 dark:text-gray-100" : "font-medium text-gray-700 dark:text-gray-300"}`}>
            {notification.title}
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[10px] text-gray-400 dark:text-gray-500 whitespace-nowrap">
              {relativeTime(notification.created_at)}
            </span>
            {unread && (
              <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
            )}
          </div>
        </div>
        <p className={`text-xs mt-0.5 leading-relaxed ${unread ? "text-gray-600 dark:text-gray-400" : "text-gray-500 dark:text-gray-500"}`}>
          {notification.message}
        </p>
        {notification.type && (
          <span className="inline-block mt-1.5 text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-medium">
            {notification.type.replace(/_/g, " ")}
          </span>
        )}
      </div>
    </div>
  );
}
