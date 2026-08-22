"use client";

import { AppNotification, FilterTab, filterNotifications } from "./types";
import NotificationItem from "./NotificationItem";
import { Bell } from "lucide-react";

interface Props {
  notifications: AppNotification[];
  activeTab: FilterTab;
  loading: boolean;
  onMarkRead: (id: number) => void;
}

function SkeletonItem() {
  return (
    <div className="flex items-start gap-3 px-5 py-4 border-l-4 border-l-gray-200 dark:border-l-gray-700">
      <div className="w-6 h-6 bg-gray-200 dark:bg-gray-700 rounded animate-pulse shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-3/4" />
        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-full" />
        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-1/2" />
      </div>
    </div>
  );
}

export default function NotificationList({ notifications, activeTab, loading, onMarkRead }: Props) {
  const filtered = filterNotifications(notifications, activeTab);

  if (loading) {
    return (
      <div className="divide-y divide-gray-100 dark:divide-gray-700">
        {[...Array(6)].map((_, i) => <SkeletonItem key={i} />)}
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-400 dark:text-gray-500">
        <Bell size={32} className="mb-3 opacity-30" />
        <p className="font-medium text-sm">No notifications</p>
        <p className="text-xs mt-1 text-gray-400 dark:text-gray-600">
          {activeTab === "unread" ? "You're all caught up!" : `No ${activeTab} notifications yet.`}
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-700">
      {filtered.map((n) => (
        <NotificationItem key={n.notification_id} notification={n} onMarkRead={onMarkRead} />
      ))}
    </div>
  );
}
