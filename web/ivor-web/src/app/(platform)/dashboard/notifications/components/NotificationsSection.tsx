"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/services/apiClient";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { AppNotification, FilterTab } from "./types";
import NotificationFilterTabs from "./NotificationFilterTabs";
import NotificationList from "./NotificationList";
import MarkAllReadButton from "./MarkAllReadButton";
import { Bell, RefreshCw } from "lucide-react";
import DashboardHeader from "@/components/ui/DashboardHeader";

const POLL_MS = 2 * 60 * 1000; // 2 minutes

interface CompanyNotifResponse {
  total: number;
  unread: number;
  data: AppNotification[];
}

export default function NotificationsSection() {
  const { user } = useAuth();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const companyId = (user as any)?.company?.company_id as number | undefined;

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [spinning, setSpinning] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchNotifications = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      if (companyId) {
        // Company admin — fetch all company-scoped notifications
        const res = await api.get<CompanyNotifResponse>(
          `/company/${companyId}/notifications?limit=200`
        );
        setNotifications(res.data.data ?? []);
      } else {
        // Fallback: personal notifications only
        const res = await api.get<AppNotification[]>("/notification");
        setNotifications(res.data);
      }
    } catch {
      // If company endpoint fails, fall back to personal
      try {
        const res = await api.get<AppNotification[]>("/notification");
        setNotifications(res.data);
      } catch {
        if (!silent) toast.error("Failed to load notifications.");
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    fetchNotifications();
    pollRef.current = setInterval(() => fetchNotifications(true), POLL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchNotifications]);

  async function handleMarkRead(id: number) {
    setNotifications((prev) =>
      prev.map((n) => n.notification_id === id ? { ...n, is_read: true } : n)
    );
    try {
      await api.put(`/notification/${id}/read`);
    } catch {
      setNotifications((prev) =>
        prev.map((n) => n.notification_id === id ? { ...n, is_read: false } : n)
      );
      toast.error("Could not mark notification as read.");
    }
  }

  async function handleMarkAllRead() {
    setMarkingAll(true);
    try {
      await api.put("/notification/read-all");
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      toast.success("All notifications marked as read.");
    } catch {
      toast.error("Could not mark all as read.");
    } finally {
      setMarkingAll(false);
    }
  }

  async function handleRefresh() {
    setSpinning(true);
    await fetchNotifications(true);
    setSpinning(false);
  }

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <div className="w-full max-w-7xl mx-auto flex flex-col gap-6 p-6">
      <DashboardHeader
        title="Notifications"
        subtitle="Company-wide alerts — leaves, overtime, compliance, disputes, and schedules. Refreshes every 2 minutes."
        extra={
          <>
            {unreadCount > 0 && (
              <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-sm font-bold rounded-full">
                {unreadCount}
              </span>
            )}
            <button
              onClick={handleRefresh}
              disabled={spinning}
              className="p-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <RefreshCw size={15} className={spinning ? "animate-spin" : ""} />
            </button>
          </>
        }
      />

      {/* Card */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex-wrap">
          <NotificationFilterTabs
            active={activeTab}
            onChange={setActiveTab}
            notifications={notifications}
          />
          <MarkAllReadButton
            unreadCount={unreadCount}
            onMarkAll={handleMarkAllRead}
            loading={markingAll}
          />
        </div>

        <NotificationList
          notifications={notifications}
          activeTab={activeTab}
          loading={loading}
          onMarkRead={handleMarkRead}
        />
      </div>

      {!loading && notifications.length > 0 && (
        <p className="text-xs text-center text-gray-400 dark:text-gray-500">
          Showing {notifications.length} notification{notifications.length !== 1 ? "s" : ""} ·{" "}
          <button onClick={handleRefresh} className="hover:underline">Refresh</button>
        </p>
      )}
    </div>
  );
}
