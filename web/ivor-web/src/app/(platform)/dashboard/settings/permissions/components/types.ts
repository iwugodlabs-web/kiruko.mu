export interface CompanyRole {
  role_id: number;
  company_id: number;
  name: string;
  description: string | null;
  is_system: boolean;
  permissions: string[];
  created_at: string | null;
  user_count: number;
  permission_count: number;
}

export interface PermissionItem {
  key: string;
  used_by_roles: number;
}

export interface PermissionGroup {
  group: string;
  permissions: PermissionItem[];
}

export interface PermissionsResponse {
  groups: PermissionGroup[];
  total: number;
}

export interface CompanyUser {
  private_user_id: number;
  first_name: string;
  last_name: string;
  role: string;
  job_title?: string | null;
}

// Human-readable label for a permission key
export function permLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Map role name to badge color
export function roleBadgeColor(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("owner")) return "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300";
  if (n.includes("admin")) return "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300";
  if (n.includes("hr")) return "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300";
  if (n.includes("manager")) return "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300";
  if (n.includes("supervisor")) return "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300";
  return "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400";
}
