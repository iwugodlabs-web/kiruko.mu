"use client";

import { AppNotification, FilterTab, FILTER_TABS, filterNotifications } from "./types";
import FilterPillGroup from "@/components/ui/FilterPillGroup";

interface Props {
  active: FilterTab;
  onChange: (tab: FilterTab) => void;
  notifications: AppNotification[];
}

export default function NotificationFilterTabs({ active, onChange, notifications }: Props) {
  return (
    <FilterPillGroup
      value={active}
      onChange={onChange}
      options={FILTER_TABS.map((tab) => ({
        value: tab.id,
        label: tab.label,
        badge: filterNotifications(notifications, tab.id).length,
        badgeVariant: tab.id === "unread" ? "red" : "amber",
      }))}
    />
  );
}
