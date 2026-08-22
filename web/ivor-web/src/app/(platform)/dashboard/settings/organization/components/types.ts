export interface OrgMember {
  private_user_id: number;
  user_id: number;
  first_name: string;
  last_name: string;
  role: string;
  job_title: string | null;
  department_id: number | null;
  department_name: string | null;
  verified: boolean;
}

export interface OrgDepartment {
  department_id: number;
  name: string;
  members: OrgMember[];
}

export type RoleTier = "owner" | "admin" | "manager" | "employee" | "other";

export function getTier(role: string): RoleTier {
  const r = role.toLowerCase();
  if (r === "owner") return "owner";
  if (r === "admin" || r === "company_admin") return "admin";
  if (r === "manager") return "manager";
  if (r === "employee") return "employee";
  return "other";
}

export const TIER_LABEL: Record<RoleTier, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  employee: "Employee",
  other: "Member",
};

export const TIER_BADGE: Record<RoleTier, string> = {
  owner: "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300",
  admin: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300",
  manager: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300",
  employee: "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400",
  other: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
};

export const TIER_AVATAR: Record<RoleTier, string> = {
  owner: "bg-purple-200 dark:bg-purple-800 text-purple-800 dark:text-purple-200",
  admin: "bg-red-200 dark:bg-red-800 text-red-800 dark:text-red-200",
  manager: "bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200",
  employee: "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300",
  other: "bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200",
};
