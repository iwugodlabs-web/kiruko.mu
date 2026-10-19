export type TabId = "overview" | "catalog" | "plans" | "sales" | "runs";

export type NavigateTab = (tab: TabId) => void;
