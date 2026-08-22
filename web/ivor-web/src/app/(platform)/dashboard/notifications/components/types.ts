export interface AppNotification {
  notification_id: number;
  user_id: number;
  title: string;
  message: string;
  type: string;
  notification_type?: string;
  is_read: boolean;
  meta: Record<string, unknown> | null;
  related_entity_id?: number | null;
  created_at: string | null;
}

export type FilterTab = "all" | "unread" | "leave" | "overtime" | "schedule" | "compliance" | "disputes";

export const FILTER_TABS: { id: FilterTab; label: string }[] = [
  { id: "all",        label: "All" },
  { id: "unread",     label: "Unread" },
  { id: "leave",      label: "Leave" },
  { id: "overtime",   label: "Overtime" },
  { id: "schedule",   label: "Schedule" },
  { id: "compliance", label: "Compliance" },
  { id: "disputes",   label: "Disputes" },
];

// Maps notification type strings → filter tabs
export function tabForType(type: string): FilterTab {
  const t = type.toLowerCase();
  if (t.includes("leave")) return "leave";
  if (t.includes("overtime")) return "overtime";
  if (t.includes("schedule") || t.includes("shift") || t.includes("clock")) return "schedule";
  if (t.includes("compliance") || t.includes("permit") || t.includes("visa")) return "compliance";
  if (t.includes("dispute") || t.includes("right") || t.includes("complaint")) return "disputes";
  return "all";
}

export function filterNotifications(
  notifications: AppNotification[],
  tab: FilterTab
): AppNotification[] {
  if (tab === "all") return notifications;
  if (tab === "unread") return notifications.filter((n) => !n.is_read);
  return notifications.filter((n) => tabForType(n.type) === tab);
}

// Type → visual config
export const TYPE_CONFIG: Record<string, { color: string; emoji: string }> = {
  leave:       { color: "border-l-blue-400",   emoji: "🏖" },
  overtime:    { color: "border-l-amber-400",  emoji: "⏰" },
  schedule:    { color: "border-l-purple-400", emoji: "📅" },
  compliance:  { color: "border-l-red-400",    emoji: "🛡" },
  disputes:    { color: "border-l-orange-400", emoji: "⚖" },
  default:     { color: "border-l-gray-300",   emoji: "🔔" },
};

export function configForType(type: string) {
  const tab = tabForType(type);
  return TYPE_CONFIG[tab] ?? TYPE_CONFIG.default;
}

export function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString([], { dateStyle: "medium" });
}
